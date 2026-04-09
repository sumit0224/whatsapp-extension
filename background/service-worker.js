/* ═══════════════════════════════════════════════════
   WAuto Pro — Background Service Worker (Phase 4)
   Queue processor, reply handler, follow-up engine,
   scheduler, retry logic, template rotation
   ═══════════════════════════════════════════════════ */

importScripts('../libs/dexie.min.js', '../libs/db.js');

// ── CONSTANTS ──
const MIN_DELAY_MS = 5000;
const TAB_CLOSE_DELAY_MS = 4000;
const SEND_MESSAGE_TIMEOUT_MS = 30000;
const WA_LOAD_WAIT_MS = 6000;
const BREAK_DURATION_BASE_S = 180;
const BREAK_DURATION_JITTER_S = 60;
const FOLLOWUP_ALARM = 'followUpChecker';
const SCHEDULER_ALARM = 'schedulerCheck';
const RETRY_ALARM = 'retryChecker';

// ── STATE ──
let isProcessing = false;
let whatsappTabId = null;
let activeCampaignMedia = null;

// ═══════════════════════════════════════
//  MESSAGE LISTENER
// ═══════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_CAMPAIGN') {
    (async () => {
      try {
        const data = await storageGet('campaignState');
        const state = data.campaignState || {};
        const runtimeSettings = await loadRuntimeToggleSettings();
        if (msg.campaignId) state.campaignId = msg.campaignId;
        if (msg.campaignDbId !== undefined) state.campaignDbId = msg.campaignDbId;
        if (msg.hasMedia !== undefined) state.hasMedia = !!msg.hasMedia;
        if (msg.mediaPayload) activeCampaignMedia = sanitizeMediaPayload(msg.mediaPayload);
        else if (!state.hasMedia) activeCampaignMedia = null;
        state.runtimeSettings = runtimeSettings;
        state.isRunning = true;
        state.status = 'running';

        await syncCampaignProgressState(state);
        await storageSet({ campaignState: state });

        if (!isProcessing) { isProcessing = true; processQueue(); }
        sendResponse({ status: 'started', campaignId: state.campaignId || null });
      } catch (e) {
        sendResponse({ status: 'error', error: e.message });
      }
    })();
    return true;
  }
  if (msg.action === 'QUICK_SEND') {
    if (isProcessing) {
      sendResponse({ status: 'busy', reason: 'Another send is already in progress' });
      return true;
    }
    isProcessing = true;
    processQuickSend(msg);
    sendResponse({ status: 'started' });
  }
  if (msg.action === 'STOP_CAMPAIGN') {
    isProcessing = false;
    activeCampaignMedia = null;
    sendResponse({ status: 'stopped' });
  }
  if (msg.action === 'CHECK_WA_SESSION') {
    (async () => { try { sendResponse(await checkWhatsAppSession()); } catch (e) { sendResponse({ status: 'not_open' }); } })();
    return true;
  }
  if (msg.action === 'OPEN_WHATSAPP_TAB') {
    (async () => { try { await findOrOpenWhatsAppTab(); sendResponse({ status: 'opened' }); } catch (e) { sendResponse({ status: 'error', error: e.message }); } })();
    return true;
  }
  if (msg.action === 'REPLY_DETECTED') {
    (async () => { try { await handleReplyDetected(msg); sendResponse({ status: 'ok' }); } catch (e) { sendResponse({ status: 'error' }); } })();
    return true;
  }
  return true;
});

// ═══════════════════════════════════════
//  REPLY HANDLER
// ═══════════════════════════════════════
async function handleReplyDetected(data) {
  const lead = await getLead(data.phone);
  if (!lead || lead.status === 'pending') return;
  const campaignDbId = lead.campaignDbId || (typeof lead.campaignId === 'number' ? lead.campaignId : null);
  const runtimeSettings = await loadRuntimeToggleSettings();

  const autoTag = classifyReply(data.previewText);
  const updates = { status: 'replied', replyText: data.previewText, repliedAt: lead.repliedAt || data.timestamp };
  if (!lead.tag) updates.tag = autoTag;
  await updateLead(lead.id, updates);

  await addMessage({ leadId: lead.id, campaignId: campaignDbId || lead.campaignId || null, direction: 'inbound', body: data.previewText || '', sentAt: data.timestamp, type: 'manual' });
  await skipFollowUpsForLead(lead.id);

  if (campaignDbId) {
    const campaign = await getCampaign(campaignDbId);
    if (campaign) await updateCampaign(campaignDbId, { replied: (campaign.replied || 0) + 1 });
  }

  // Update template reply rate
  const outboundMsgs = await getMessages(lead.id);
  const lastOutbound = outboundMsgs.filter((m) => m.direction === 'outbound' && m.templateId).pop();
  if (lastOutbound && lastOutbound.templateId) {
    const tpl = await getTemplateById(lastOutbound.templateId);
    if (tpl) {
      const totalSent = tpl.usageCount || 1;
      const allLeadsWithTpl = await db.messages.where('templateId').equals(lastOutbound.templateId).toArray();
      const leadIds = new Set(allLeadsWithTpl.map((m) => m.leadId));
      let replied = 0;
      for (const lid of leadIds) {
        const l = await getLeadById(lid);
        if (l && l.repliedAt) replied++;
      }
      await updateTemplate(lastOutbound.templateId, { replyRate: totalSent > 0 ? (replied / totalSent * 100) : 0 });
    }
  }

  broadcastMessage({ action: 'REPLY_NOTIFICATION', leadName: lead.name, phone: lead.phone, tag: updates.tag || lead.tag, previewText: data.previewText });

  const finalTag = updates.tag || lead.tag || autoTag;
  if (finalTag === 'hot' && runtimeSettings.notifyHotLead) {
    try {
      chrome.notifications.create(`reply_${lead.id}_${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Hot lead replied',
        message: `${lead.name || lead.phone} replied to your message`,
      });
    } catch (e) { /* */ }
  }
}

// ═══════════════════════════════════════
//  FOLLOW-UP ENGINE
// ═══════════════════════════════════════
async function processFollowUps() {
  try {
    const due = await getPendingFollowUps();
    if (due.length === 0) return;
    const config = await storageGet('followUpConfig');
    const followUpConfig = config.followUpConfig || {};

    for (const entry of due) {
      const lead = await getLeadById(entry.leadId);
      if (!lead) { await markFollowUpDone(entry.id, 'skipped'); continue; }
      if (['replied', 'converted', 'closed'].includes(lead.status)) { await markFollowUpDone(entry.id, 'skipped'); continue; }

      const dayKey = `day${entry.day}`;
      if (followUpConfig[dayKey] && followUpConfig[dayKey].enabled === false) { await markFollowUpDone(entry.id, 'skipped'); continue; }

      let template = entry.template || (followUpConfig[dayKey] && followUpConfig[dayKey].template) || '';
      if (!template) { await markFollowUpDone(entry.id, 'skipped'); continue; }

      const message = replaceVariables(template, lead);
      const modeData = await storageGet('sendMode');
      let sent = false;

      if ((modeData.sendMode || 'dom') === 'dom') {
        try {
          if (!whatsappTabId) await findOrOpenWhatsAppTab();
          const resp = await executeDomSend(whatsappTabId, lead.phone, message);
          sent = resp && resp.success;
        } catch (e) { /* */ }
      }
      if (!sent && (modeData.sendMode === 'link' || !whatsappTabId)) {
        try {
          const tab = await chrome.tabs.create({ url: `https://wa.me/${lead.phone.replace('+', '')}?text=${encodeURIComponent(message)}`, active: false });
          await delay(TAB_CLOSE_DELAY_MS);
          try { await chrome.tabs.remove(tab.id); } catch (e) { /* */ }
          sent = true;
        } catch (e) { /* */ }
      }

      await markFollowUpDone(entry.id, sent ? 'sent' : 'skipped');
      if (sent) {
        await updateLead(lead.id, { followUpDay: entry.day, followUpSentAt: Date.now() });
        await addMessage({ leadId: lead.id, campaignId: entry.campaignId, direction: 'outbound', body: message, sentAt: Date.now(), type: `followup_d${entry.day}` });
      }
      await delay(Math.max(MIN_DELAY_MS, 8000 + Math.random() * 5000));
    }
  } catch (err) { console.error('[WAuto] processFollowUps error:', err); }
}

async function scheduleFollowUps(lead, campaignId) {
  try {
    const config = await storageGet('followUpConfig');
    const followUpConfig = config.followUpConfig || {};
    for (const day of [1, 2, 3]) {
      const dk = `day${day}`;
      const dc = followUpConfig[dk];
      if (dc && dc.enabled === false) continue;
      const template = (dc && dc.template) || '';
      if (!template) continue;
      await addToFollowUpQueue({ leadId: lead.id, campaignId, day, scheduledFor: Date.now() + day * 86400000, template });
    }
  } catch (err) { console.error('[WAuto] scheduleFollowUps error:', err); }
}

// ═══════════════════════════════════════
//  SCHEDULER ENGINE (Phase 4)
// ═══════════════════════════════════════
async function processScheduledCampaigns() {
  try {
    const waiting = await getWaitingScheduledCampaigns();
    const now = Date.now();

    for (const sc of waiting) {
      if (sc.scheduledFor > now) continue;

      await updateScheduledCampaign(sc.id, { status: 'running' });
      const runtimeSettings = await loadRuntimeToggleSettings();

      // Create campaign record
      const counts = await getLeadCounts();
      const campaignId = await addCampaign({ name: sc.name, status: 'active', template: sc.template, totalContacts: counts.pending });

      // Mark pending leads with campaign ID
      const pendingLeads = await getAllLeads({ status: 'pending' });
      for (const lead of pendingLeads) { await updateLead(lead.id, { campaignId, campaignDbId: campaignId }); }

      // Save follow-up config
      if (sc.followUpTemplates) await storageSet({ followUpConfig: sc.followUpTemplates });

      // Build campaign state
      const campaignState = {
        isRunning: true, status: 'running', currentIndex: 0, total: counts.pending,
        sent: 0, failed: 0, template: sc.template,
        delayFixed: sc.delayConfig ? sc.delayConfig.fixed : 10,
        delayJitter: sc.delayConfig ? sc.delayConfig.jitter : 3,
        campaignId,
        campaignDbId: campaignId,
        runtimeSettings,
        rotateTemplates: sc.rotateTemplates || false,
        templateIds: sc.templateIds || [],
        rotationIndex: 0,
      };

      await storageSet({ campaignState, sendMode: sc.sendMode || 'dom' });

      // Browser notification
      if (runtimeSettings.notifyScheduledStart) {
        try {
          chrome.notifications.create(`sched_${sc.id}`, { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Scheduled campaign started', message: `Sending to ${counts.pending} contacts` });
        } catch (e) { /* */ }
      }

      broadcastMessage({ action: 'SCHEDULED_CAMPAIGN_STARTED', name: sc.name, total: counts.pending });

      // Start processing
      if (!isProcessing) { isProcessing = true; processQueue(); }

      // Mark scheduled campaign complete (it handed off to main queue)
      await updateScheduledCampaign(sc.id, { status: 'completed', completedAt: Date.now() });
    }
  } catch (err) { console.error('[WAuto] processScheduledCampaigns error:', err); }
}

// ═══════════════════════════════════════
//  RETRY ENGINE (Phase 4)
// ═══════════════════════════════════════
async function processRetries() {
  try {
    const pending = await getPendingRetries();
    if (pending.length === 0) return;

    // Check if campaign is running — don't interfere
    const stateData = await storageGet('campaignState');
    if (stateData.campaignState && stateData.campaignState.isRunning) return;

    for (const entry of pending) {
      const lead = await getLeadById(entry.leadId);
      if (!lead) { await updateRetryEntry(entry.id, { status: 'exhausted' }); continue; }

      const modeData = await storageGet('sendMode');
      let sent = false;

      if ((modeData.sendMode || 'dom') === 'dom') {
        try {
          if (!whatsappTabId) await findOrOpenWhatsAppTab();
          const resp = await executeDomSend(whatsappTabId, entry.phone, entry.message);
          sent = resp && resp.success;
        } catch (e) { /* */ }
      }

      if (sent) {
        await updateRetryEntry(entry.id, { status: 'succeeded', lastAttemptAt: Date.now() });
        await updateLead(lead.id, { status: 'sent', sentAt: Date.now() });
        await addMessage({ leadId: lead.id, campaignId: entry.campaignId, direction: 'outbound', body: entry.message, type: 'initial' });
      } else {
        const settingsData = await storageGet('wAutoSettings');
        const settings = settingsData.wAutoSettings || {};
        const maxRetries = settings.maxRetries !== undefined ? settings.maxRetries : 3;
        const retryIntervalMul = settings.retryInterval !== undefined ? settings.retryInterval : 5;
        const calcNext = (attempt) => Date.now() + (retryIntervalMul * Math.pow(3, attempt - 1) * 60000);

        const newAttempt = (entry.attemptCount || 1) + 1;
        if (newAttempt > maxRetries) {
          await updateRetryEntry(entry.id, { status: 'exhausted', attemptCount: newAttempt, lastAttemptAt: Date.now() });
        } else {
          await updateRetryEntry(entry.id, { attemptCount: newAttempt, lastAttemptAt: Date.now(), nextRetryAt: calcNext(newAttempt) });
        }
      }

      await delay(Math.max(MIN_DELAY_MS, 6000));
    }
  } catch (err) { console.error('[WAuto] processRetries error:', err); }
}

async function handleSendFailure(lead, reason, message, campaignId) {
  // Permanent failures — no retry
  if (PERMANENT_FAILURES.includes(reason)) {
    await updateLead(lead.id, { status: 'failed', _failReason: reason });
    return;
  }

  const settingsData = await storageGet('wAutoSettings');
  const settings = settingsData.wAutoSettings || {};
  const maxRetries = settings.maxRetries !== undefined ? settings.maxRetries : 3;
  const retryIntervalMul = settings.retryInterval !== undefined ? settings.retryInterval : 5;
  const calcNext = (attempt) => Date.now() + (retryIntervalMul * Math.pow(3, attempt - 1) * 60000);

  // Check existing retry entry
  const existing = await getRetryEntryForLead(lead.id);
  if (existing) {
    const newAttempt = (existing.attemptCount || 1) + 1;
    if (newAttempt > maxRetries) {
      await updateRetryEntry(existing.id, { status: 'exhausted', attemptCount: newAttempt, lastAttemptAt: Date.now(), failureReason: reason });
      await updateLead(lead.id, { status: 'failed', _failReason: 'max_retries_exhausted' });
    } else {
      await updateRetryEntry(existing.id, { attemptCount: newAttempt, lastAttemptAt: Date.now(), nextRetryAt: calcNext(newAttempt), failureReason: reason });
    }
  } else {
    await addRetryEntry({ leadId: lead.id, phone: lead.phone, message, campaignId, attemptCount: 1, maxAttempts: maxRetries, nextRetryAt: calcNext(1), failureReason: reason });
  }

  await updateLead(lead.id, { status: 'failed', _failReason: reason });
}

// ═══════════════════════════════════════
//  WHATSAPP TAB MANAGEMENT
// ═══════════════════════════════════════
async function findOrOpenWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length > 0) {
    whatsappTabId = tabs[0].id;
    await chrome.tabs.update(whatsappTabId, { active: true });
    await storageSet({ whatsappTabId });
    return whatsappTabId;
  }
  const tab = await chrome.tabs.create({ url: 'https://web.whatsapp.com', active: true });
  whatsappTabId = tab.id; await storageSet({ whatsappTabId }); await delay(WA_LOAD_WAIT_MS); return whatsappTabId;
}

async function checkWhatsAppSession() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length === 0) return { status: 'not_open' };
  whatsappTabId = tabs[0].id; await storageSet({ whatsappTabId });
  try {
    const resp = await sendMessageToTab(whatsappTabId, { action: 'CHECK_LOGIN' }, 5000);
    return resp && resp.loggedIn ? { status: 'connected' } : { status: 'qr_needed' };
  } catch (e) { return { status: 'loading' }; }
}

function sendMessageToTab(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tab message timeout')), timeoutMs || SEND_MESSAGE_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    } catch (e) { clearTimeout(timer); reject(e); }
  });
}

async function executeDomSend(tabId, phone, message, runtimeSettings = {}, mediaPayload = null) {
  try {
    const cleanPhone = phone.replace(/\+/g, '');
    console.log(`[executeDomSend] Existing WA tab found: ${tabId}`);
    await chrome.tabs.update(tabId, { 
      active: true,
      url: `https://web.whatsapp.com/send?phone=${cleanPhone}`
    });

    // Wait for page to start reloading
    await delay(2000);

    let isReady = false;
    for (let i = 0; i < 30; i++) {
      await delay(2000);
      try {
        const ping = await sendMessageToTab(
          tabId, 
          { action: 'PING' }, 
          2000
        );
        if (ping && ping.alive) { 
          // Extra wait after PING — let WhatsApp fully render
          await delay(3000);
          isReady = true; 
          break; 
        }
      } catch (e) {}
    }

    if (isReady) {
      console.log(`[executeDomSend] Content script alive, sending TYPE_AND_SEND`);
      if (runtimeSettings.enableTyping !== false) {
        await delay(1000 + Math.random() * 1000);
      }
      await storageSet({ lastSentPhone: phone });
      return await sendMessageToTab(tabId, {
        action: 'TYPE_AND_SEND',
        phone: phone,
        message: message,
        media: sanitizeMediaPayload(mediaPayload),
      }, SEND_MESSAGE_TIMEOUT_MS);
    } else {
      console.warn(`[executeDomSend] Content script failed to respond to PING`);
      return { success: false, reason: 'chat_load_timeout' };
    }
  } catch (err) {
    return { success: false, reason: 'send_failed' };
  }
}

// ═══════════════════════════════════════
//  TAB CLOSE DETECTION
// ═══════════════════════════════════════
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === whatsappTabId && isProcessing) {
    isProcessing = false; whatsappTabId = null;
    try {
      const data = await storageGet('campaignState');
      const state = data.campaignState || {};
      state.isRunning = false; state.status = 'paused_tab_closed';
      await storageSet({ campaignState: state, whatsappTabId: null });
    } catch (e) { /* */ }
    broadcastMessage({ action: 'CAMPAIGN_ERROR', error: 'WhatsApp tab was closed. Reopen and resume campaign.' });
  }
});

// ═══════════════════════════════════════
//  QUEUE PROCESSOR
// ═══════════════════════════════════════
async function processQueue() {
  const modeData = await storageGet('sendMode');
  if ((modeData.sendMode || 'dom') === 'dom') await processQueueDomMode();
  else await processQueueLinkMode();
}

async function loadRuntimeToggleSettings() {
  const settings = await storageGet([
    'enableJitter',
    'enableTyping',
    'enableBreaks',
    'notifyHotLead',
    'notifyScheduledStart',
    'wAutoSettings',
  ]);
  const wa = settings.wAutoSettings || {};
  return {
    enableJitter: (settings.enableJitter ?? wa.enableJitter) !== false,
    enableTyping: (settings.enableTyping ?? wa.enableTyping) !== false,
    enableBreaks: (settings.enableBreaks ?? wa.enableBreaks) !== false,
    notifyHotLead: (settings.notifyHotLead ?? wa.notifyHotLead) !== false,
    notifyScheduledStart: (settings.notifyScheduledStart ?? wa.notifyScheduledStart) !== false,
  };
}

function getRuntimeToggleSettings(state) {
  const runtime = (state && state.runtimeSettings) || {};
  return {
    enableJitter: runtime.enableJitter !== false,
    enableTyping: runtime.enableTyping !== false,
    enableBreaks: runtime.enableBreaks !== false,
    notifyHotLead: runtime.notifyHotLead !== false,
    notifyScheduledStart: runtime.notifyScheduledStart !== false,
  };
}

async function syncCampaignProgressState(state) {
  // Legacy campaigns may not have campaignId — keep historical behavior for them.
  if (!state || !state.campaignId) return state;
  const scoped = await getLeadCounts({ campaignId: state.campaignId });
  state.total = scoped.total;
  state.sent = scoped.sent;
  state.failed = scoped.failed;
  return state;
}

async function getTodaySentCount(todayMidnightTs) {
  return db.leads
    .where('sentAt')
    .aboveOrEqual(todayMidnightTs)
    .and((lead) => lead.status === 'sent')
    .count();
}

async function getPendingLeadsForState(state) {
  if (state && state.campaignId) return getAllLeads({ campaignId: state.campaignId, status: 'pending' });
  return getAllLeads({ status: 'pending' });
}

function getCampaignDbIdFromState(state) {
  if (!state) return null;
  if (state.campaignDbId) return state.campaignDbId;
  if (typeof state.campaignId === 'number') return state.campaignId;
  return null;
}

function getPerMessageDelayMs(state, runtimeSettings) {
  const fixedSeconds = Math.max(5, state.delayFixed || 10);
  const jitterSeconds = Math.max(0, state.delayJitter || 3);
  if (!runtimeSettings.enableJitter) return Math.max(MIN_DELAY_MS, fixedSeconds * 1000);
  return Math.max(MIN_DELAY_MS, (fixedSeconds + Math.random() * jitterSeconds) * 1000);
}

function getBreakDurationMs(breakMinutes) {
  const baseSeconds = Math.max(1, breakMinutes || 1) * 60;
  return (baseSeconds + Math.random() * 30) * 1000;
}

function sanitizeMediaPayload(mediaPayload) {
  if (!mediaPayload || typeof mediaPayload !== 'object') return null;
  if (!mediaPayload.dataUrl || typeof mediaPayload.dataUrl !== 'string') return null;
  if (!mediaPayload.dataUrl.startsWith('data:')) return null;
  const size = Number(mediaPayload.size || 0);
  if (size <= 0 || size > 16 * 1024 * 1024) return null;
  const kind = mediaPayload.kind === 'video' ? 'video' : 'image';
  return {
    name: String(mediaPayload.name || 'media'),
    type: String(mediaPayload.type || ''),
    size,
    kind,
    dataUrl: mediaPayload.dataUrl,
  };
}

// ═══════════════════════════════════════
//  DOM MODE
// ═══════════════════════════════════════
async function processQueueDomMode() {
  try { await findOrOpenWhatsAppTab(); } catch (err) {
    isProcessing = false; broadcastMessage({ action: 'CAMPAIGN_ERROR', error: 'Could not open WhatsApp Web tab.' }); return;
  }

  try {
    const session = await checkWhatsAppSession();
    if (session.status === 'qr_needed') {
      const d = await storageGet('campaignState'); const s = d.campaignState || {};
      s.status = 'paused_login'; s.isRunning = false; await storageSet({ campaignState: s });
      isProcessing = false; broadcastMessage({ action: 'CAMPAIGN_ERROR', error: 'Please scan QR code in the WhatsApp Web tab.' }); return;
    }
  } catch (e) { /* */ }

  // Get settings
  const settingsData = await storageGet('wAutoSettings');
  const settings = settingsData.wAutoSettings || {};
  const dailyLimit = settings.dailyLimit || 150;
  const breakAfter = settings.breakAfterMessages || 30;
  const breakMins = settings.breakDurationMinutes || 3;

  // Check daily limit
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  let messagesSinceBreak = 0;
  const breakEvery = Math.max(1, breakAfter || 20);

  while (isProcessing) {
    try {
      const data = await storageGet('campaignState');
      const state = data.campaignState || {};
      if (!state.isRunning) { isProcessing = false; break; }
      const campaignDbId = getCampaignDbIdFromState(state);
      const runtimeSettings = getRuntimeToggleSettings(state);

      // Daily limit check
      if (settings.showBanWarning !== false) {
        const todaySent = await getTodaySentCount(todayStart.getTime());
        if (todaySent >= dailyLimit) {
          state.isRunning = false; state.status = 'daily_limit';
          await storageSet({ campaignState: state });
          isProcessing = false;
          broadcastMessage({ action: 'CAMPAIGN_ERROR', error: `Daily message limit (${dailyLimit}) reached today. Campaign paused.` });
          break;
        }
      }

      // Get next pending lead
      const allLeads = await getPendingLeadsForState(state);
      const validLeads = allLeads.filter((l) => isValidPhone(l.phone));
      const nextLead = validLeads[0];

      if (!nextLead) {
        state.isRunning = false; state.status = 'completed';
        await storageSet({ campaignState: state });
        isProcessing = false;
        activeCampaignMedia = null;
        if (campaignDbId) {
          await updateCampaign(campaignDbId, {
            status: 'completed',
            completedAt: Date.now(),
            sent: state.sent || 0,
            failed: state.failed || 0,
            totalContacts: state.total || 0,
          });
        }

        // Notification
        const notifSettings = await storageGet('wAutoSettings');
        if ((notifSettings.wAutoSettings || {}).notifyCampaignComplete !== false) {
          try { chrome.notifications.create('campaign_done', { type: 'basic', iconUrl: 'icons/icon128.png', title: '✅ Campaign Complete', message: `Sent ${state.sent || 0} of ${state.total || 0} messages` }); } catch (e) { /* */ }
        }

        broadcastMessage({ action: 'CAMPAIGN_COMPLETE', sent: state.sent || 0, failed: state.failed || 0, total: state.total || 0, campaignId: state.campaignId || null });
        break;
      }

      // Anti-ban break
      if (runtimeSettings.enableBreaks && messagesSinceBreak >= breakEvery) {
        const breakDuration = getBreakDurationMs(breakMins);
        broadcastMessage({ action: 'BREAK_STARTED', breakEndTime: Date.now() + breakDuration, breakDurationMs: breakDuration });
        await delay(breakDuration);
        messagesSinceBreak = 0;
        broadcastMessage({ action: 'BREAK_ENDED' });
        const fs = await storageGet('campaignState');
        if (!fs.campaignState || !fs.campaignState.isRunning) { isProcessing = false; break; }
        continue;
      }

      // Template rotation
      let personalised;
      if (state.rotateTemplates && state.templateIds && state.templateIds.length >= 2) {
        const tplIndex = (state.rotationIndex || 0) % state.templateIds.length;
        const tplId = state.templateIds[tplIndex];
        const tpl = await getTemplateById(tplId);
        personalised = replaceVariables(tpl ? tpl.body : state.template, nextLead);
        state.rotationIndex = (state.rotationIndex || 0) + 1;
        // Track template usage
        if (tpl) await incrementTemplateUsage(tplId);
        state._currentTemplateId = tplId;
      } else {
        personalised = replaceVariables(state.template || '', nextLead);
        state._currentTemplateId = null;
      }

      broadcastMessage({ action: 'PROGRESS_UPDATE', sent: state.sent || 0, failed: state.failed || 0, total: state.total || 0, currentContact: nextLead.name || nextLead.phone, campaignId: state.campaignId || null });

      let response;
      const campaignMedia = state.hasMedia ? activeCampaignMedia : null;
      if (state.hasMedia && !campaignMedia) {
        state.isRunning = false;
        state.status = 'media_missing';
        await storageSet({ campaignState: state });
        isProcessing = false;
        broadcastMessage({ action: 'CAMPAIGN_ERROR', error: 'Campaign media is unavailable. Reattach media and restart campaign.' });
        break;
      }
      try { response = await executeDomSend(whatsappTabId, nextLead.phone, personalised, runtimeSettings, campaignMedia); }
      catch (e) { response = { success: false, reason: 'send_failed' }; }

      if (response && response.success) {
        const sentAt = Date.now();
        await updateLead(nextLead.id, {
          status: 'sent',
          sentAt,
          campaignId: state.campaignId || nextLead.campaignId || null,
          campaignDbId: campaignDbId || nextLead.campaignDbId || null,
        });
        state.sent = (state.sent || 0) + 1;
        console.log(`[processQueue] Lead marked sent: ${nextLead.phone}`);
        await addMessage({ leadId: nextLead.id, campaignId: campaignDbId || state.campaignId || null, direction: 'outbound', body: personalised, sentAt, type: 'initial', templateId: state._currentTemplateId });
        await scheduleFollowUps(nextLead, campaignDbId || state.campaignId || null);
      } else {
        const reason = (response && response.reason) || 'send_failed';
        await handleSendFailure(nextLead, reason, personalised, campaignDbId || state.campaignId || null);
        state.failed = (state.failed || 0) + 1;

        if (reason === 'whatsapp_disconnected') {
          state.isRunning = false; state.status = 'paused_login';
          await storageSet({ campaignState: state });
          isProcessing = false;
          broadcastMessage({ action: 'CAMPAIGN_ERROR', error: 'WhatsApp disconnected. Please scan QR code and resume.' });
          break;
        }
      }

      state.currentIndex = (state.currentIndex || 0) + 1;
      await storageSet({ campaignState: state });
      messagesSinceBreak++;

      broadcastMessage({ action: 'PROGRESS_UPDATE', sent: state.sent || 0, failed: state.failed || 0, total: state.total || 0, currentContact: nextLead.name || nextLead.phone, campaignId: state.campaignId || null });

      const cs = await storageGet('campaignState');
      if (!cs.campaignState || !cs.campaignState.isRunning) { isProcessing = false; break; }

      await delay(getPerMessageDelayMs(state, runtimeSettings));

    } catch (err) { console.error('[WAuto] processQueueDomMode error:', err); await delay(3000); }
  }
}

// ═══════════════════════════════════════
//  LINK MODE
// ═══════════════════════════════════════
async function processQueueLinkMode() {
  const settingsData = await storageGet('wAutoSettings');
  const settings = settingsData.wAutoSettings || {};
  const breakAfter = settings.breakAfterMessages || 30;
  const breakMins = settings.breakDurationMinutes || 3;
  const breakEvery = Math.max(1, breakAfter || 20);
  let messagesSinceBreak = 0;

  while (isProcessing) {
    try {
      const data = await storageGet('campaignState');
      const state = data.campaignState || {};
      if (!state.isRunning) { isProcessing = false; break; }
      const campaignDbId = getCampaignDbIdFromState(state);
      const runtimeSettings = getRuntimeToggleSettings(state);
      if (state.hasMedia) {
        state.isRunning = false;
        state.status = 'media_dom_required';
        await storageSet({ campaignState: state });
        isProcessing = false;
        broadcastMessage({ action: 'CAMPAIGN_ERROR', error: 'Media campaigns require DOM mode. Please switch send mode to DOM.' });
        break;
      }

      const allLeads = await getPendingLeadsForState(state);
      const nextLead = allLeads.filter((l) => isValidPhone(l.phone))[0];

      if (!nextLead) {
        state.isRunning = false; state.status = 'completed';
        await storageSet({ campaignState: state }); isProcessing = false;
        activeCampaignMedia = null;
        if (campaignDbId) {
          await updateCampaign(campaignDbId, {
            status: 'completed',
            completedAt: Date.now(),
            sent: state.sent || 0,
            failed: state.failed || 0,
            totalContacts: state.total || 0,
          });
        }
        broadcastMessage({ action: 'CAMPAIGN_COMPLETE', sent: state.sent || 0, failed: state.failed || 0, total: state.total || 0, campaignId: state.campaignId || null }); break;
      }

      if (runtimeSettings.enableBreaks && messagesSinceBreak >= breakEvery) {
        const breakDuration = getBreakDurationMs(breakMins);
        broadcastMessage({ action: 'BREAK_STARTED', breakEndTime: Date.now() + breakDuration, breakDurationMs: breakDuration });
        await delay(breakDuration);
        messagesSinceBreak = 0;
        broadcastMessage({ action: 'BREAK_ENDED' });
        const fs = await storageGet('campaignState');
        if (!fs.campaignState || !fs.campaignState.isRunning) { isProcessing = false; break; }
      }

      // Template rotation for link mode too
      let personalised;
      if (state.rotateTemplates && state.templateIds && state.templateIds.length >= 2) {
        const i = (state.rotationIndex || 0) % state.templateIds.length;
        const tpl = await getTemplateById(state.templateIds[i]);
        personalised = replaceVariables(tpl ? tpl.body : state.template, nextLead);
        state.rotationIndex = (state.rotationIndex || 0) + 1;
        if (tpl) await incrementTemplateUsage(state.templateIds[i]);
      } else {
        personalised = replaceVariables(state.template || '', nextLead);
      }

      try {
        const sendUrl = `https://web.whatsapp.com/send?phone=${nextLead.phone.replace('+', '')}&text=${encodeURIComponent(personalised)}`;
        const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
        if (tabs.length > 0) {
          whatsappTabId = tabs[0].id;
          await chrome.tabs.update(whatsappTabId, { url: sendUrl, active: true });
        } else {
          const tab = await chrome.tabs.create({ url: sendUrl, active: true });
          whatsappTabId = tab.id;
        }
        await storageSet({ whatsappTabId });
        await delay(TAB_CLOSE_DELAY_MS);
        const sentAt = Date.now();
        await updateLead(nextLead.id, {
          status: 'sent',
          sentAt,
          campaignId: state.campaignId || nextLead.campaignId || null,
          campaignDbId: campaignDbId || nextLead.campaignDbId || null,
        });
        state.sent = (state.sent || 0) + 1;
        await addMessage({ leadId: nextLead.id, campaignId: campaignDbId || state.campaignId || null, direction: 'outbound', body: personalised, sentAt, type: 'initial' });
        await scheduleFollowUps(nextLead, campaignDbId || state.campaignId || null);
      } catch (e) {
        await handleSendFailure(nextLead, 'send_failed', personalised, campaignDbId || state.campaignId || null);
        state.failed = (state.failed || 0) + 1;
      }

      state.currentIndex = (state.currentIndex || 0) + 1;
      await storageSet({ campaignState: state });
      messagesSinceBreak++;
      broadcastMessage({ action: 'PROGRESS_UPDATE', sent: state.sent || 0, failed: state.failed || 0, total: state.total || 0, currentContact: nextLead.name || nextLead.phone, campaignId: state.campaignId || null });

      const fd = await storageGet('campaignState');
      if (!fd.campaignState || !fd.campaignState.isRunning) { isProcessing = false; break; }
      await delay(getPerMessageDelayMs(state, runtimeSettings));
    } catch (err) { console.error('[WAuto] processQueueLinkMode error:', err); await delay(2000); }
  }
}

// ═══════════════════════════════════════
//  QUICK SEND (Phase 4.1)
// ═══════════════════════════════════════
async function processQuickSend(data) {
  const { numbers, message, delayFixed, delayJitter, sendMode } = data;
  const mediaPayload = sanitizeMediaPayload(data.mediaPayload);
  let sent = 0;

  try {
    if (mediaPayload && sendMode !== 'dom') {
      broadcastMessage({ action: 'CAMPAIGN_ERROR', error: 'Quick send with media requires DOM mode.' });
      return;
    }

    if (sendMode === 'dom') {
      try { await findOrOpenWhatsAppTab(); } catch (err) {
        broadcastMessage({ action: 'CAMPAIGN_ERROR', error: 'Could not open WhatsApp Web tab.' });
        return;
      }
      try {
        const session = await checkWhatsAppSession();
        if (session.status === 'qr_needed') {
          broadcastMessage({ action: 'CAMPAIGN_ERROR', error: 'Please scan QR code in the WhatsApp Web tab.' });
          return;
        }
      } catch (e) { /* */ }
    }

    for (let i = 0; i < numbers.length; i++) {
      if (!isProcessing) break;
      const phone = numbers[i];

      broadcastMessage({ action: 'QUICK_SEND_PROGRESS', sent, total: numbers.length });

      if (sendMode === 'dom') {
        let response;
        try { response = await executeDomSend(whatsappTabId, phone, message, {}, mediaPayload); }
        catch (e) { response = { success: false }; }
        if (response && response.success) sent++;
      } else {
        try {
          const tab = await chrome.tabs.create({ url: `https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(message)}`, active: false });
          await delay(TAB_CLOSE_DELAY_MS);
          try { await chrome.tabs.remove(tab.id); } catch (e) { /* */ }
          sent++;
        } catch (e) { /* */ }
      }

      if (i < numbers.length - 1) {
        const fD = Math.max(5, delayFixed || 10);
        const jD = Math.max(0, delayJitter || 3);
        await delay(Math.max(MIN_DELAY_MS, (fD + Math.random() * jD) * 1000));
      }
    }
  } catch (err) {
    console.error('[WAuto] processQuickSend error:', err);
  } finally {
    isProcessing = false;
    broadcastMessage({ action: 'QUICK_SEND_COMPLETE', sent, total: numbers.length });
  }
}

// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════
function replaceVariables(tpl, c) {
  return tpl.replace(/\{\{name\}\}/gi, c.name || '').replace(/\{\{course\}\}/gi, c.course || '').replace(/\{\{city\}\}/gi, c.city || '');
}
function isValidPhone(p) { return /^\+\d{10,15}$/.test(p); }
function broadcastMessage(msg) { try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) { /* */ } }
function storageGet(keys) { return new Promise((res, rej) => { chrome.storage.local.get(keys, (r) => { if (chrome.runtime.lastError) rej(chrome.runtime.lastError); else res(r); }); }); }
function storageSet(data) { return new Promise((res, rej) => { chrome.storage.local.set(data, () => { if (chrome.runtime.lastError) rej(chrome.runtime.lastError); else res(); }); }); }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ═══════════════════════════════════════
//  ALARMS
// ═══════════════════════════════════════
function setupAlarms() {
  chrome.alarms.create(FOLLOWUP_ALARM, { periodInMinutes: 5 });
  chrome.alarms.create(SCHEDULER_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FOLLOWUP_ALARM) await processFollowUps();
  if (alarm.name === SCHEDULER_ALARM) await processScheduledCampaigns();
  if (alarm.name === RETRY_ALARM) await processRetries();

  try {
    const d = await storageGet('campaignState');
    if (d.campaignState && d.campaignState.isRunning && !isProcessing) {
      isProcessing = true;
      processQueue();
    }
  } catch (e) { /* */ }
});

// ═══════════════════════════════════════
//  LIFECYCLE
// ═══════════════════════════════════════
chrome.runtime.onInstalled.addListener(async () => {
  setupAlarms();
  try { await runMigration(); } catch (e) { /* */ }
  try { const d = await storageGet('campaignState'); if (d.campaignState && d.campaignState.isRunning) { isProcessing = true; processQueue(); } } catch (e) { /* */ }
});

chrome.runtime.onStartup.addListener(async () => {
  setupAlarms();
  try { await runMigration(); } catch (e) { /* */ }
  try { const d = await storageGet('campaignState'); if (d.campaignState && d.campaignState.isRunning) { isProcessing = true; processQueue(); } } catch (e) { /* */ }
});
