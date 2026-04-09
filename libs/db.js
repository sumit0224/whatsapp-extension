/* ═══════════════════════════════════════════════════
   WAuto Pro — IndexedDB Abstraction Layer (Dexie)
   Database: WAuto_DB v2
   ═══════════════════════════════════════════════════ */

/* global Dexie */

const db = new Dexie('WAuto_DB');

// Version 1 — Phase 3 tables
db.version(1).stores({
  leads: '++id, &phone, name, course, city, status, tag, campaignId, sentAt, repliedAt, followUpDay, createdAt, updatedAt',
  campaigns: '++id, name, status, createdAt, completedAt',
  messages: '++id, leadId, campaignId, direction, sentAt, type',
  followUpQueue: '++id, leadId, campaignId, day, scheduledFor, status',
});

// Version 2 — Phase 4 tables
db.version(2).stores({
  leads: '++id, &phone, name, course, city, status, tag, campaignId, sentAt, repliedAt, followUpDay, createdAt, updatedAt',
  campaigns: '++id, name, status, createdAt, completedAt',
  messages: '++id, leadId, campaignId, direction, sentAt, type, templateId',
  followUpQueue: '++id, leadId, campaignId, day, scheduledFor, status',
  scheduledCampaigns: '++id, status, scheduledFor, createdAt',
  retryQueue: '++id, leadId, status, nextRetryAt, campaignId',
  templates: '++id, category, usageCount, createdAt, updatedAt',
});

// Version 3 — Campaign-scoped recipient snapshots
db.version(3).stores({
  leads: '++id, &phone, name, course, city, status, tag, campaignId, campaignDbId, [campaignId+status], sentAt, repliedAt, followUpDay, createdAt, updatedAt',
  campaigns: '++id, name, status, createdAt, completedAt',
  messages: '++id, leadId, campaignId, direction, sentAt, type, templateId',
  followUpQueue: '++id, leadId, campaignId, day, scheduledFor, status',
  scheduledCampaigns: '++id, status, scheduledFor, createdAt',
  retryQueue: '++id, leadId, status, nextRetryAt, campaignId',
  templates: '++id, category, usageCount, createdAt, updatedAt',
});

// ═══════════════════════════════════════
//  LEADS CRUD
// ═══════════════════════════════════════
async function addLead(lead) {
  const now = Date.now();
  return db.leads.add({
    phone: lead.phone, name: lead.name || '', course: lead.course || '', city: lead.city || '',
    customFields: lead.customFields || {}, status: lead.status || 'pending', tag: lead.tag || null,
    campaignId: lead.campaignId || null, campaignDbId: lead.campaignDbId || null, sentAt: lead.sentAt || null, repliedAt: lead.repliedAt || null,
    followUpDay: lead.followUpDay || 0, followUpSentAt: lead.followUpSentAt || null,
    notes: lead.notes || '', createdAt: lead.createdAt || now, updatedAt: now,
  });
}

async function addLeadBulk(leadsArr) {
  const now = Date.now();
  const prepared = leadsArr.map((l) => ({
    phone: l.phone, name: l.name || '', course: l.course || '', city: l.city || '',
    customFields: l.customFields || {}, status: l.status || 'pending', tag: l.tag || null,
    campaignId: l.campaignId || null, campaignDbId: l.campaignDbId || null, sentAt: l.sentAt || null, repliedAt: l.repliedAt || null,
    followUpDay: l.followUpDay || 0, followUpSentAt: l.followUpSentAt || null,
    notes: l.notes || '', createdAt: l.createdAt || now, updatedAt: now,
  }));
  return db.leads.bulkPut(prepared);
}

async function updateLead(id, changes) {
  changes.updatedAt = Date.now();
  return db.leads.update(id, changes);
}

async function getLead(phone) { return db.leads.where('phone').equals(phone).first(); }
async function getLeadById(id) { return db.leads.get(id); }

async function getAllLeads(filters = {}) {
  const hasStatus = filters.status !== undefined && filters.status !== null && filters.status !== '';
  const hasTag = filters.tag !== undefined && filters.tag !== null && filters.tag !== '';
  const hasCampaignId = filters.campaignId !== undefined && filters.campaignId !== null && filters.campaignId !== '';
  const hasCampaignDbId = filters.campaignDbId !== undefined && filters.campaignDbId !== null && filters.campaignDbId !== '';

  let collection = db.leads.toCollection();
  if (hasCampaignId && hasStatus) collection = db.leads.where('[campaignId+status]').equals([filters.campaignId, filters.status]);
  else if (hasCampaignId) collection = db.leads.where('campaignId').equals(filters.campaignId);
  else if (hasStatus) collection = db.leads.where('status').equals(filters.status);
  else if (hasTag) collection = db.leads.where('tag').equals(filters.tag);

  let results = await collection.toArray();
  if (hasStatus) results = results.filter((l) => l.status === filters.status);
  if (hasTag) results = results.filter((l) => l.tag === filters.tag);
  if (hasCampaignId) results = results.filter((l) => l.campaignId === filters.campaignId);
  if (hasCampaignDbId) results = results.filter((l) => l.campaignDbId === filters.campaignDbId);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    results = results.filter((l) =>
      (l.name && l.name.toLowerCase().includes(q)) ||
      (l.phone && l.phone.includes(q)) ||
      (l.course && l.course.toLowerCase().includes(q))
    );
  }
  if (filters.sort) {
    switch (filters.sort) {
      case 'newest': results.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); break;
      case 'oldest': results.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); break;
      case 'name': results.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
      case 'status':
        const so = { replied: 0, sent: 1, pending: 2, converted: 3, failed: 4, closed: 5 };
        results.sort((a, b) => (so[a.status] || 9) - (so[b.status] || 9)); break;
      case 'tag':
        const to = { hot: 0, warm: 1, cold: 2 };
        results.sort((a, b) => (to[a.tag] || 9) - (to[b.tag] || 9)); break;
    }
  }
  return results;
}

async function getLeadCounts(filters = {}) {
  const hasFilters = Object.keys(filters || {}).length > 0;
  const all = hasFilters ? await getAllLeads(filters) : await db.leads.toArray();
  const c = { total: all.length, pending: 0, sent: 0, replied: 0, failed: 0, converted: 0, closed: 0, hot: 0, warm: 0, cold: 0 };
  all.forEach((l) => { if (c[l.status] !== undefined) c[l.status]++; if (l.tag && c[l.tag] !== undefined) c[l.tag]++; });
  return c;
}

async function getAllLeadPhones() { return new Set((await db.leads.toArray()).map((l) => l.phone)); }

// ═══════════════════════════════════════
//  MESSAGES CRUD
// ═══════════════════════════════════════
async function addMessage(msg) {
  return db.messages.add({
    leadId: msg.leadId, campaignId: msg.campaignId || null, direction: msg.direction || 'outbound',
    body: msg.body || '', sentAt: msg.sentAt || Date.now(), type: msg.type || 'initial',
    templateId: msg.templateId || null,
  });
}

async function getMessages(leadId) { return db.messages.where('leadId').equals(leadId).sortBy('sentAt'); }

async function getMessagesByDateRange(from, to) {
  return db.messages.where('sentAt').between(from, to).toArray();
}

async function getAllMessages() { return db.messages.toArray(); }

// ═══════════════════════════════════════
//  CAMPAIGNS CRUD
// ═══════════════════════════════════════
async function addCampaign(campaign) {
  return db.campaigns.add({
    name: campaign.name || 'Campaign ' + Date.now(), status: campaign.status || 'active',
    campaignId: campaign.campaignId || null,
    template: campaign.template || '', totalContacts: campaign.totalContacts || 0,
    sent: campaign.sent || 0, failed: campaign.failed || 0, replied: campaign.replied || 0,
    converted: campaign.converted || 0, createdAt: Date.now(), completedAt: null,
  });
}

async function getCampaign(id) { return db.campaigns.get(id); }
async function updateCampaign(id, changes) { return db.campaigns.update(id, changes); }
async function getLatestCampaign() { return db.campaigns.orderBy('createdAt').last(); }
async function getAllCampaigns() { return db.campaigns.orderBy('createdAt').reverse().toArray(); }

// ═══════════════════════════════════════
//  FOLLOW-UP QUEUE
// ═══════════════════════════════════════
async function addToFollowUpQueue(entry) {
  return db.followUpQueue.add({
    leadId: entry.leadId, campaignId: entry.campaignId || null, day: entry.day,
    scheduledFor: entry.scheduledFor, status: 'pending', template: entry.template || '',
  });
}

async function getPendingFollowUps() {
  const now = Date.now();
  return db.followUpQueue.where('status').equals('pending').filter((e) => e.scheduledFor <= now).toArray();
}

async function markFollowUpDone(id, newStatus) { return db.followUpQueue.update(id, { status: newStatus || 'sent' }); }

async function skipFollowUpsForLead(leadId) {
  await db.followUpQueue.where('leadId').equals(leadId).and((e) => e.status === 'pending').modify({ status: 'skipped' });
}

// ═══════════════════════════════════════
//  TEMPLATES (Phase 4)
// ═══════════════════════════════════════
async function saveTemplate(tpl) {
  const now = Date.now();
  if (tpl.id) {
    return db.templates.update(tpl.id, { name: tpl.name, body: tpl.body, category: tpl.category, updatedAt: now });
  }
  return db.templates.add({
    name: tpl.name || 'Untitled', body: tpl.body || '', category: tpl.category || 'initial',
    usageCount: 0, replyRate: 0, createdAt: now, updatedAt: now,
  });
}

async function getTemplates(category) {
  if (category) return db.templates.where('category').equals(category).toArray();
  return db.templates.toArray();
}

async function getTemplateById(id) { return db.templates.get(id); }
async function updateTemplate(id, changes) { changes.updatedAt = Date.now(); return db.templates.update(id, changes); }
async function deleteTemplate(id) { return db.templates.delete(id); }
async function incrementTemplateUsage(id) {
  const tpl = await db.templates.get(id);
  if (tpl) await db.templates.update(id, { usageCount: (tpl.usageCount || 0) + 1 });
}

// ═══════════════════════════════════════
//  SCHEDULED CAMPAIGNS (Phase 4)
// ═══════════════════════════════════════
async function addScheduledCampaign(sc) {
  return db.scheduledCampaigns.add({
    name: sc.name || 'Scheduled Campaign', contactIds: sc.contactIds || [], template: sc.template || '',
    followUpTemplates: sc.followUpTemplates || {}, scheduledFor: sc.scheduledFor,
    status: 'waiting', delayConfig: sc.delayConfig || { fixed: 10, jitter: 3 },
    sendMode: sc.sendMode || 'dom', templateIds: sc.templateIds || [], rotateTemplates: sc.rotateTemplates || false,
    createdAt: Date.now(),
  });
}

async function getScheduledCampaigns() { return db.scheduledCampaigns.orderBy('scheduledFor').toArray(); }
async function getWaitingScheduledCampaigns() { return db.scheduledCampaigns.where('status').equals('waiting').toArray(); }
async function updateScheduledCampaign(id, changes) { return db.scheduledCampaigns.update(id, changes); }
async function cancelScheduledCampaign(id) { return db.scheduledCampaigns.update(id, { status: 'cancelled' }); }

// ═══════════════════════════════════════
//  RETRY QUEUE (Phase 4)
// ═══════════════════════════════════════
async function addRetryEntry(entry) {
  return db.retryQueue.add({
    leadId: entry.leadId, phone: entry.phone, message: entry.message || '',
    campaignId: entry.campaignId || null, attemptCount: entry.attemptCount || 1,
    maxAttempts: entry.maxAttempts || 3, lastAttemptAt: Date.now(),
    nextRetryAt: entry.nextRetryAt, failureReason: entry.failureReason || '',
    status: 'pending',
  });
}

async function getPendingRetries() {
  const now = Date.now();
  return db.retryQueue.where('status').equals('pending').filter((e) => e.nextRetryAt <= now).toArray();
}

async function getRetryEntryForLead(leadId) {
  return db.retryQueue.where('leadId').equals(leadId).and((e) => e.status === 'pending').first();
}

async function updateRetryEntry(id, changes) { return db.retryQueue.update(id, changes); }

async function getRetryStats() {
  const all = await db.retryQueue.toArray();
  return { total: all.length, pending: all.filter((r) => r.status === 'pending').length, exhausted: all.filter((r) => r.status === 'exhausted').length, succeeded: all.filter((r) => r.status === 'succeeded').length };
}

const PERMANENT_FAILURES = ['number_not_on_whatsapp', 'invalid_phone_format', 'account_banned'];

function calculateNextRetry(attemptCount) {
  const delays = [5 * 60000, 15 * 60000, 45 * 60000]; // 5min, 15min, 45min
  return Date.now() + (delays[attemptCount - 1] || delays[delays.length - 1]);
}

// ═══════════════════════════════════════
//  DASHBOARD STATS (Phase 4)
// ═══════════════════════════════════════
async function getDashboardStats(dateFrom, dateTo) {
  const allLeads = await db.leads.toArray();
  const allMessages = await db.messages.toArray();
  const allCampaigns = await getAllCampaigns();

  const filteredMessages = allMessages.filter((m) => {
    if (dateFrom && m.sentAt < dateFrom) return false;
    if (dateTo && m.sentAt > dateTo) return false;
    return true;
  });

  const outbound = filteredMessages.filter((m) => m.direction === 'outbound');
  const inbound = filteredMessages.filter((m) => m.direction === 'inbound');

  const sentCount = allLeads.filter((l) => l.status !== 'pending').length;
  const repliedCount = allLeads.filter((l) => l.status === 'replied' || l.repliedAt).length;
  const convertedCount = allLeads.filter((l) => l.status === 'converted').length;
  const hotCount = allLeads.filter((l) => l.tag === 'hot' && l.status !== 'converted').length;
  const warmCount = allLeads.filter((l) => l.tag === 'warm' && l.status !== 'converted').length;

  // Today's count
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todaySent = outbound.filter((m) => m.sentAt >= todayStart.getTime()).length;

  // 7-day activity
  const dailyActivity = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const dEnd = new Date(d); dEnd.setHours(23, 59, 59, 999);
    const ds = d.getTime(); const de = dEnd.getTime();
    const daySent = outbound.filter((m) => m.sentAt >= ds && m.sentAt <= de).length;
    const dayReplied = inbound.filter((m) => m.sentAt >= ds && m.sentAt <= de).length;
    dailyActivity.push({ date: d.toLocaleDateString('en-US', { weekday: 'short' }), fullDate: d.toISOString().slice(0, 10), sent: daySent, replied: dayReplied });
  }

  // Funnel
  const contacted = allLeads.length;
  const fSent = allLeads.filter((l) => l.sentAt).length;
  const fReplied = repliedCount;
  const fFollowedUp = allLeads.filter((l) => l.followUpDay > 0).length;
  const fConverted = convertedCount;

  // Follow-up effectiveness
  const fuStats = { d1: { sent: 0, replied: 0 }, d2: { sent: 0, replied: 0 }, d3: { sent: 0, replied: 0 } };
  const fuMessages = outbound.filter((m) => m.type && m.type.startsWith('followup_'));
  fuMessages.forEach((m) => {
    const day = m.type.replace('followup_d', '');
    if (fuStats['d' + day]) fuStats['d' + day].sent++;
  });
  // Check replies within 24h of each follow-up
  for (const fuMsg of fuMessages) {
    const lead = allLeads.find((l) => l.id === fuMsg.leadId);
    if (lead && lead.repliedAt && lead.repliedAt > fuMsg.sentAt && lead.repliedAt < fuMsg.sentAt + 86400000) {
      const day = fuMsg.type.replace('followup_d', '');
      if (fuStats['d' + day]) fuStats['d' + day].replied++;
    }
  }

  // Campaign performance
  const campaignPerf = allCampaigns.slice(0, 10).map((c) => ({
    id: c.id, name: c.name, status: c.status, createdAt: c.createdAt,
    sent: c.sent || 0, replied: c.replied || 0, converted: c.converted || 0,
    replyRate: c.sent > 0 ? ((c.replied || 0) / c.sent * 100).toFixed(1) : '0.0',
  }));

  return {
    sent: sentCount, replied: repliedCount, converted: convertedCount,
    replyRate: sentCount > 0 ? (repliedCount / sentCount * 100).toFixed(1) : '0.0',
    conversionRate: sentCount > 0 ? (convertedCount / sentCount * 100).toFixed(1) : '0.0',
    hotLeads: hotCount, warmLeads: warmCount, todaySent,
    dailyActivity, funnelData: { contacted, sent: fSent, replied: fReplied, followedUp: fFollowedUp, converted: fConverted },
    campaignPerformance: campaignPerf, followUpStats: fuStats,
  };
}

// ═══════════════════════════════════════
//  EXPORT / IMPORT (Phase 4)
// ═══════════════════════════════════════
async function exportLeadsCSV() {
  const leads = await db.leads.toArray();
  if (leads.length === 0) return '';
  const header = 'Name,Phone,Course,City,Status,Tag,Notes,SentAt,RepliedAt\n';
  const rows = leads.map((l) => {
    const esc = (s) => '"' + (s || '').replace(/"/g, '""') + '"';
    return [esc(l.name), esc(l.phone), esc(l.course), esc(l.city), esc(l.status), esc(l.tag || ''), esc(l.notes), esc(l.sentAt ? new Date(l.sentAt).toISOString() : ''), esc(l.repliedAt ? new Date(l.repliedAt).toISOString() : '')].join(',');
  }).join('\n');
  return header + rows;
}

async function exportFullBackup() {
  const data = {
    version: 2, exportedAt: new Date().toISOString(),
    leads: await db.leads.toArray(), campaigns: await db.campaigns.toArray(),
    messages: await db.messages.toArray(), followUpQueue: await db.followUpQueue.toArray(),
    templates: await db.templates.toArray(), scheduledCampaigns: await db.scheduledCampaigns.toArray(),
    retryQueue: await db.retryQueue.toArray(),
  };
  return JSON.stringify(data, null, 2);
}

async function importFullBackup(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data.version) throw new Error('Invalid backup file');
  await db.transaction('rw', db.leads, db.campaigns, db.messages, db.followUpQueue, db.templates, db.scheduledCampaigns, db.retryQueue, async () => {
    if (data.leads) { await db.leads.clear(); await db.leads.bulkAdd(data.leads); }
    if (data.campaigns) { await db.campaigns.clear(); await db.campaigns.bulkAdd(data.campaigns); }
    if (data.messages) { await db.messages.clear(); await db.messages.bulkAdd(data.messages); }
    if (data.followUpQueue) { await db.followUpQueue.clear(); await db.followUpQueue.bulkAdd(data.followUpQueue); }
    if (data.templates) { await db.templates.clear(); await db.templates.bulkAdd(data.templates); }
    if (data.scheduledCampaigns) { await db.scheduledCampaigns.clear(); await db.scheduledCampaigns.bulkAdd(data.scheduledCampaigns); }
    if (data.retryQueue) { await db.retryQueue.clear(); await db.retryQueue.bulkAdd(data.retryQueue); }
  });
}

async function clearSendHistory() { await db.messages.clear(); }

async function resetAllData() {
  await db.leads.clear(); await db.campaigns.clear(); await db.messages.clear();
  await db.followUpQueue.clear(); await db.templates.clear();
  await db.scheduledCampaigns.clear(); await db.retryQueue.clear();
}

async function getLeadsForExport(filters = {}) {
  let leads = await getAllLeads(filters);
  const campaigns = await getAllCampaigns();
  const campaignMap = {};
  campaigns.forEach((c) => { campaignMap[c.id] = c.name; });
  return leads.map((l) => ({ ...l, campaignName: campaignMap[l.campaignDbId || l.campaignId] || '' }));
}

// ═══════════════════════════════════════
//  DATA MIGRATION (Phase 1/2 → Phase 3)
// ═══════════════════════════════════════
async function runMigration() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['migrationComplete', 'contactList', 'sendLog'], async (result) => {
      if (result.migrationComplete) { resolve(false); return; }
      try {
        const contacts = result.contactList || [];
        if (contacts.length > 0) {
          const now = Date.now();
          for (const c of contacts) {
            const existing = await getLead(c.phone);
            if (!existing) await addLead({ phone: c.phone, name: c.name || '', course: c.course || '', city: c.city || '', status: c.status || 'pending', createdAt: now });
          }
        }
        const sendLog = result.sendLog || [];
        for (const entry of sendLog) {
          const lead = await getLead(entry.phone);
          if (lead) await addMessage({ leadId: lead.id, direction: 'outbound', body: '', sentAt: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(), type: 'initial' });
        }
        chrome.storage.local.set({ migrationComplete: true }, () => { chrome.storage.local.remove(['contactList', 'sendLog']); resolve(true); });
      } catch (err) { console.error('[WAuto] Migration error:', err); resolve(false); }
    });
  });
}

// ═══════════════════════════════════════
//  KEYWORD CLASSIFICATION
// ═══════════════════════════════════════
function classifyReply(text) {
  if (!text || typeof text !== 'string') return 'warm';
  const t = text.toLowerCase().trim();
  if (!t) return 'warm';
  const cold = ['not interested', 'nahi', 'no thanks', 'stop', "don't contact", 'remove', 'unsubscribe', 'wrong number', 'busy', 'later', 'abhi nahi', 'mat karo', 'band karo'];
  const hot = ['interested', 'yes', 'haan', ' ha ', 'how much', 'fees', 'fee', 'price', 'cost', 'kitna', 'batch', 'when', 'kab', 'join', 'enroll', 'details', 'syllabus', 'demo', 'call me', 'call karo', 'callback', 'register'];
  for (const kw of cold) { if (t.includes(kw)) return 'cold'; }
  for (const kw of hot) { if (t.includes(kw)) return 'hot'; }
  return 'warm';
}

// ═══════════════════════════════════════
//  GLOBAL EXPORT
// ═══════════════════════════════════════
if (typeof window !== 'undefined') {
  window.WAutoDB = {
    db, addLead, addLeadBulk, updateLead, getLead, getLeadById, getAllLeads, getLeadCounts, getAllLeadPhones,
    addMessage, getMessages, getMessagesByDateRange, getAllMessages,
    addCampaign, getCampaign, updateCampaign, getLatestCampaign, getAllCampaigns,
    addToFollowUpQueue, getPendingFollowUps, markFollowUpDone, skipFollowUpsForLead,
    saveTemplate, getTemplates, getTemplateById, updateTemplate, deleteTemplate, incrementTemplateUsage,
    addScheduledCampaign, getScheduledCampaigns, getWaitingScheduledCampaigns, updateScheduledCampaign, cancelScheduledCampaign,
    addRetryEntry, getPendingRetries, getRetryEntryForLead, updateRetryEntry, getRetryStats, PERMANENT_FAILURES, calculateNextRetry,
    getDashboardStats, exportLeadsCSV, exportFullBackup, importFullBackup, clearSendHistory, resetAllData, getLeadsForExport,
    runMigration, classifyReply,
  };
}
