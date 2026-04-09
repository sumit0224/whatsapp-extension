/* ═══════════════════════════════════════════════════
   WAuto Pro — Popup Logic (Phase 4)
   Campaign tab, template mode, settings, tab routing
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';
  const DB = window.WAutoDB;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── DOM ──
  const tabBtns = $$('.tab-btn');
  const tabPanels = $$('.tab-panel');
  const sessionBanner = $('#session-banner');
  const sessionText = $('#session-text');
  const btnOpenWa = $('#btn-open-wa');
  const modeDom = $('#mode-dom');
  const modeLink = $('#mode-link');
  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');
  const fileInfo = $('#file-info');
  const fileName = $('#file-name');
  const rowCount = $('#row-count');
  const btnClearFile = $('#btn-clear-file');
  const duplicateInfo = $('#duplicate-info');
  const duplicateCount = $('#duplicate-count');
  const alreadyMessagedInfo = $('#already-messaged-info');
  const alreadyMessagedCount = $('#already-messaged-count');
  const resendRow = $('#resend-row');
  const chkResend = $('#chk-resend');
  const sectionPreview = $('#section-preview');
  const previewTbody = $('#preview-tbody');
  const contactCount = $('#contact-count');
  const templateInput = $('#template-input');
  const previewMessage = $('#preview-message');
  const followupToggle = $('#followup-toggle');
  const followupBody = $('#followup-body');
  const followupChevron = $('#followup-chevron');
  const btnSaveFollowups = $('#btn-save-followups');
  const delayFixed = $('#delay-fixed');
  const delayJitter = $('#delay-jitter');
  const delayHelper = $('#delay-helper');
  const btnStart = $('#btn-start');
  const btnStop = $('#btn-stop');
  const progressContainer = $('#progress-container');
  const progressBar = $('#progress-bar');
  const progressText = $('#progress-text');
  const statsRow = $('#stats-row');
  const statSent = $('#stat-sent');
  const statPending = $('#stat-pending');
  const statFailed = $('#stat-failed');
  const campaignError = $('#campaign-error');
  const campaignErrorText = $('#campaign-error-text');
  const completionMsg = $('#completion-msg');
  const completionText = $('#completion-text');
  const currentContact = $('#current-contact');
  const currentContactName = $('#current-contact-name');
  const breakBanner = $('#break-banner');
  const breakCountdown = $('#break-countdown');

  const quicksendToggle = $('#quicksend-toggle');
  const quicksendBody = $('#quicksend-body');
  const quicksendChevron = $('#quicksend-chevron');
  const quicksendNumbers = $('#quicksend-numbers');
  const quicksendMessage = $('#quicksend-message');
  const quicksendError = $('#quicksend-error');
  const quicksendStatus = $('#quicksend-status');
  const btnQuicksendAction = $('#btn-quicksend-action');
  const quicksendCount = $('#quicksend-count');
  const btnQuicksendMedia = $('#btn-quicksend-media');
  const quicksendMediaInput = $('#quicksend-media-input');
  const quicksendMediaDrop = $('#quicksend-media-drop');
  const quicksendMediaPreview = $('#quicksend-media-preview');
  const quicksendMediaImage = $('#quicksend-media-image');
  const quicksendMediaVideo = $('#quicksend-media-video');
  const quicksendMediaName = $('#quicksend-media-name');
  const btnQuicksendMediaRemove = $('#btn-quicksend-media-remove');

  const btnCampaignMedia = $('#btn-campaign-media');
  const campaignMediaInput = $('#campaign-media-input');
  const campaignMediaDrop = $('#campaign-media-drop');
  const campaignMediaPreview = $('#campaign-media-preview');
  const campaignMediaImage = $('#campaign-media-image');
  const campaignMediaVideo = $('#campaign-media-video');
  const campaignMediaName = $('#campaign-media-name');
  const btnCampaignMediaRemove = $('#btn-campaign-media-remove');

  // state
  let parsedContacts = [];
  let sessionCheckInterval = null;
  let breakCountdownInterval = null;
  let quickSendSafetyTimer = null;
  let quickSendMediaFile = null;
  let quickSendMediaUrl = null;
  let campaignMediaFile = null;
  let campaignMediaUrl = null;
  let lastSessionStatus = null;

  const MAX_MEDIA_SIZE_BYTES = 16 * 1024 * 1024;
  const ALLOWED_MEDIA_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'mp4', 'webm', 'mov']);
  const ALLOWED_MEDIA_MIME_PREFIX = ['image/', 'video/'];

  function setActiveTabState(target) {
    const tabName = target || 'campaign';
    document.body.setAttribute('data-active-tab', tabName);
    const scroller = document.scrollingElement || document.documentElement || document.body;
    if (scroller) scroller.scrollTop = 0;
  }

  // ═══════════════════════════════════════
  //  TAB SWITCHING (with persistence)
  // ═══════════════════════════════════════
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      setActiveTabState(target);
      tabBtns.forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
      tabPanels.forEach((p) => { p.classList.toggle('active', p.id === `tab-${target}`); });
      chrome.storage.local.set({ activeTab: target });

      if (target === 'leads' && window.WALeads) window.WALeads.init();
      if (target === 'dashboard' && window.WADashboard) window.WADashboard.init();
      if (target !== 'dashboard' && window.WADashboard) window.WADashboard.stop();
      if (target === 'templates' && window.WATemplates) window.WATemplates.init();
      if (target === 'campaign' && window.WAScheduler) window.WAScheduler.refresh();

      // Reduce background polling/jank on non-campaign tabs.
      if (target === 'campaign' && modeDom.checked) startSessionCheck();
      else stopSessionCheck();
    });
  });

  // ═══════════════════════════════════════
  //  SESSION BANNER
  // ═══════════════════════════════════════
  function updateSessionBanner(status) {
    if (status === lastSessionStatus) return;
    lastSessionStatus = status;
    sessionBanner.className = 'session-banner';
    btnOpenWa.classList.add('hidden');
    switch (status) {
      case 'connected': sessionBanner.classList.add('session-banner--connected'); sessionText.textContent = '✅ WhatsApp Web connected'; break;
      case 'qr_needed': sessionBanner.classList.add('session-banner--error'); sessionText.textContent = '🔴 Please scan QR code'; btnOpenWa.classList.remove('hidden'); btnOpenWa.textContent = 'Open Tab'; break;
      case 'not_open': sessionBanner.classList.add('session-banner--warning'); sessionText.textContent = '⚠️ WhatsApp Web not open'; btnOpenWa.classList.remove('hidden'); btnOpenWa.textContent = 'Open WhatsApp'; break;
      case 'loading': sessionBanner.classList.add('session-banner--checking'); sessionText.textContent = '⏳ Loading…'; break;
      default: sessionBanner.classList.add('session-banner--checking'); sessionText.textContent = 'Checking…';
    }
  }

  async function checkSession() { try { const r = await sendMsg({ action: 'CHECK_WA_SESSION' }); if (r) updateSessionBanner(r.status); } catch (e) { updateSessionBanner('not_open'); } }

  btnOpenWa.addEventListener('click', async () => { try { await sendMsg({ action: 'OPEN_WHATSAPP_TAB' }); updateSessionBanner('loading'); setTimeout(checkSession, 6000); } catch (e) { /* */ } });

  function startSessionCheck() {
    stopSessionCheck();
    checkSession();
    sessionCheckInterval = setInterval(checkSession, 10000);
  }
  function stopSessionCheck() { if (sessionCheckInterval) { clearInterval(sessionCheckInterval); sessionCheckInterval = null; } }

  // ═══════════════════════════════════════
  //  MODE SELECTOR
  // ═══════════════════════════════════════
  function handleModeChange() {
    const mode = modeDom.checked ? 'dom' : 'link';
    chrome.storage.local.set({ sendMode: mode });
    if (mode === 'dom') { sessionBanner.classList.remove('hidden'); startSessionCheck(); } else { sessionBanner.classList.add('hidden'); stopSessionCheck(); }
  }
  modeDom.addEventListener('change', handleModeChange);
  modeLink.addEventListener('change', handleModeChange);

  // ═══════════════════════════════════════
  //  TEMPLATE MODE (single vs rotate)
  // ═══════════════════════════════════════
  const tplModeSingle = $('#tpl-mode-single');
  const tplModeRotate = $('#tpl-mode-rotate');
  const singleSection = $('#single-template-section');
  const rotateSection = $('#rotate-template-section');

  if (tplModeSingle) tplModeSingle.addEventListener('change', () => { singleSection.classList.remove('hidden'); rotateSection.classList.add('hidden'); });
  if (tplModeRotate) tplModeRotate.addEventListener('change', () => {
    singleSection.classList.add('hidden'); rotateSection.classList.remove('hidden');
    if (window.WATemplates) window.WATemplates.renderRotationSelector();
  });

  // ═══════════════════════════════════════
  //  FILE UPLOAD
  // ═══════════════════════════════════════
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  btnClearFile.addEventListener('click', clearFile);

  function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) { showError('Please upload .xlsx, .xls, or .csv'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (json.length === 0) { showError('File is empty.'); return; }

        const parsed = parseContacts(json);
        parsedContacts = parsed.contacts;

        let am = 0;
        const existing = await DB.getAllLeadPhones();
        parsedContacts.forEach((c) => { if (existing.has(c.phone)) { c._alreadyMessaged = true; am++; } });

        fileName.textContent = file.name;
        rowCount.textContent = `${parsedContacts.length} rows`;
        fileInfo.classList.remove('hidden');
        dropZone.classList.add('hidden');

        duplicateInfo.classList.toggle('hidden', parsed.duplicatesRemoved === 0);
        if (parsed.duplicatesRemoved > 0) duplicateCount.textContent = parsed.duplicatesRemoved;

        alreadyMessagedInfo.classList.toggle('hidden', am === 0);
        resendRow.classList.toggle('hidden', am === 0);
        if (am > 0) alreadyMessagedCount.textContent = am;

        renderPreview();
        updateLivePreview();
      } catch (err) { showError('Failed to parse file.'); }
    };
    reader.readAsArrayBuffer(file);
  }

  function parseContacts(json) {
    const h = Object.keys(json[0]);
    const find = (kws) => h.find((k) => kws.some((w) => k.toLowerCase().trim() === w.toLowerCase()));
    const nameCol = find(['name', 'full name', 'student name', 'contact name']);
    const phoneCol = find(['phone', 'mobile', 'phone number', 'mobile number', 'contact', 'number', 'whatsapp']);
    const courseCol = find(['course', 'program', 'course name']);
    const cityCol = find(['city', 'location', 'place']);

    const seen = new Set(); let dup = 0; const list = [];
    json.forEach((row, i) => {
      const raw = String(row[phoneCol] || '').trim();
      const phone = cleanPhone(raw);
      if (phone && seen.has(phone)) { dup++; return; }
      if (phone) seen.add(phone);
      list.push({ id: i + 1, name: String(row[nameCol] || '').trim(), phone, course: String(row[courseCol] || '').trim(), city: String(row[cityCol] || '').trim(), _valid: /^\+\d{10,15}$/.test(phone), _alreadyMessaged: false });
    });
    return { contacts: list, duplicatesRemoved: dup };
  }

  function cleanPhone(raw) {
    let p = raw.replace(/[\s\-\(\)\.\+]/g, '');
    if (p.length === 12 && p.startsWith('91')) return '+' + p;
    if (p.length === 10 && /^\d{10}$/.test(p)) return '+91' + p;
    if (/^\d{11,15}$/.test(p)) return '+' + p;
    return raw.trim();
  }

  function clearFile() {
    parsedContacts = []; fileInput.value = '';
    fileInfo.classList.add('hidden'); dropZone.classList.remove('hidden');
    sectionPreview.classList.add('hidden'); duplicateInfo.classList.add('hidden');
    alreadyMessagedInfo.classList.add('hidden'); resendRow.classList.add('hidden');
    updateLivePreview();
  }

  chkResend.addEventListener('change', () => {
    if (chkResend.checked) { parsedContacts.forEach((c) => { c._alreadyMessaged = false; }); alreadyMessagedInfo.classList.add('hidden'); }
    else { recheckAlready(); }
  });

  async function recheckAlready() {
    const existing = await DB.getAllLeadPhones(); let count = 0;
    parsedContacts.forEach((c) => { if (existing.has(c.phone)) { c._alreadyMessaged = true; count++; } });
    if (count > 0) { alreadyMessagedCount.textContent = count; alreadyMessagedInfo.classList.remove('hidden'); }
  }

  function renderPreview() {
    if (parsedContacts.length === 0) { sectionPreview.classList.add('hidden'); return; }
    sectionPreview.classList.remove('hidden');
    contactCount.textContent = `${parsedContacts.length} contacts`;
    previewTbody.innerHTML = parsedContacts.slice(0, 50).map((c, i) => `<tr class="${c._valid ? '' : 'row-invalid'}"><td>${i + 1}</td><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.course)}</td><td>${esc(c.city)}</td></tr>`).join('');
  }

  // ═══════════════════════════════════════
  //  TEMPLATE
  // ═══════════════════════════════════════
  $$('.btn-variable').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.target;
      const ta = tid ? document.getElementById(tid) : templateInput;
      if (!ta) return;
      const v = btn.dataset.var;
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + v + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + v.length;
      ta.focus();
      if (!tid) { saveTemplate(); updateLivePreview(); }
    });
  });

  templateInput.addEventListener('input', () => { saveTemplate(); updateLivePreview(); });

  function replaceVars(tpl, c) { return tpl.replace(/\{\{name\}\}/gi, c.name || '').replace(/\{\{course\}\}/gi, c.course || '').replace(/\{\{city\}\}/gi, c.city || ''); }

  function updateLivePreview() {
    const t = templateInput.value;
    if (!t) { previewMessage.textContent = 'Your personalised message will appear here…'; return; }
    const sample = parsedContacts.find((c) => c._valid) || parsedContacts[0] || { name: 'John', course: 'Full Stack Dev', city: 'Mumbai' };
    previewMessage.textContent = replaceVars(t, sample);
  }

  function saveTemplate() { chrome.storage.local.set({ savedTemplate: templateInput.value }); }

  // ═══════════════════════════════════════
  //  FOLLOW-UP TEMPLATES
  // ═══════════════════════════════════════
  followupToggle.addEventListener('click', () => { const o = !followupBody.classList.contains('hidden'); followupBody.classList.toggle('hidden', o); followupChevron.textContent = o ? '▶' : '▼'; });
  btnSaveFollowups.addEventListener('click', saveFollowUpConfig);

  function saveFollowUpConfig() {
    const config = {
      day1: { enabled: $('#fu-day1-enabled').checked, template: $('#fu-day1-template').value },
      day2: { enabled: $('#fu-day2-enabled').checked, template: $('#fu-day2-template').value },
      day3: { enabled: $('#fu-day3-enabled').checked, template: $('#fu-day3-template').value },
    };
    chrome.storage.local.set({ followUpConfig: config }, () => {
      btnSaveFollowups.textContent = '✓ Saved!';
      setTimeout(() => { btnSaveFollowups.textContent = 'Save Follow-up Templates'; }, 1500);
    });
  }

  async function restoreFollowUpConfig() {
    return new Promise((r) => {
      chrome.storage.local.get('followUpConfig', (res) => {
        if (res.followUpConfig) {
          const c = res.followUpConfig;
          if (c.day1) { $('#fu-day1-enabled').checked = c.day1.enabled !== false; if (c.day1.template) $('#fu-day1-template').value = c.day1.template; }
          if (c.day2) { $('#fu-day2-enabled').checked = c.day2.enabled !== false; if (c.day2.template) $('#fu-day2-template').value = c.day2.template; }
          if (c.day3) { $('#fu-day3-enabled').checked = c.day3.enabled !== false; if (c.day3.template) $('#fu-day3-template').value = c.day3.template; }
        }
        r();
      });
    });
  }

  // ═══════════════════════════════════════
  //  DELAY
  // ═══════════════════════════════════════
  function updateDelayHelper() {
    const f = parseInt(delayFixed.value, 10) || 10; const j = parseInt(delayJitter.value, 10) || 0;
    delayHelper.innerHTML = `Each message: <strong>${f} ± ${j}</strong> seconds`;
    chrome.storage.local.set({ delayConfig: { fixed: Math.max(5, f), jitter: Math.max(0, j) } });
  }
  delayFixed.addEventListener('input', updateDelayHelper);
  delayJitter.addEventListener('input', updateDelayHelper);
  delayFixed.addEventListener('blur', () => { if (parseInt(delayFixed.value, 10) < 5) { delayFixed.value = 5; updateDelayHelper(); } });

  // ═══════════════════════════════════════
  //  MEDIA PICKERS (Campaign + Quick Send)
  // ═══════════════════════════════════════
  function isAllowedMediaFile(file) {
    if (!file) return false;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const mimeOk = ALLOWED_MEDIA_MIME_PREFIX.some((p) => (file.type || '').startsWith(p));
    const extOk = ALLOWED_MEDIA_EXTS.has(ext);
    return mimeOk || extOk;
  }

  function getMediaKind(file) {
    const t = file && file.type ? file.type.toLowerCase() : '';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('image/')) return 'image';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return ['mp4', 'webm', 'mov'].includes(ext) ? 'video' : 'image';
  }

  function showQuickSendError(msg) {
    if (!quicksendError) return;
    quicksendError.textContent = msg;
    quicksendError.classList.remove('hidden');
  }

  function showCampaignError(msg) {
    if (!campaignErrorText || !campaignError) return;
    campaignErrorText.textContent = msg;
    campaignError.classList.remove('hidden');
  }

  function clearPreviewMediaElements(imageEl, videoEl) {
    if (imageEl) { imageEl.classList.add('hidden'); imageEl.removeAttribute('src'); }
    if (videoEl) {
      videoEl.pause();
      videoEl.classList.add('hidden');
      videoEl.removeAttribute('src');
      try { videoEl.load(); } catch (e) { /* */ }
    }
  }

  function setMediaPreview(scope, file, objectUrl) {
    const isVideo = getMediaKind(file) === 'video';
    const isQuick = scope === 'quick';
    const preview = isQuick ? quicksendMediaPreview : campaignMediaPreview;
    const imageEl = isQuick ? quicksendMediaImage : campaignMediaImage;
    const videoEl = isQuick ? quicksendMediaVideo : campaignMediaVideo;
    const nameEl = isQuick ? quicksendMediaName : campaignMediaName;
    if (!preview || !imageEl || !videoEl || !nameEl) return;

    clearPreviewMediaElements(imageEl, videoEl);
    if (isVideo) {
      videoEl.src = objectUrl;
      videoEl.classList.remove('hidden');
    } else {
      imageEl.src = objectUrl;
      imageEl.classList.remove('hidden');
    }
    nameEl.textContent = `${file.name} • ${(file.size / (1024 * 1024)).toFixed(2)}MB`;
    preview.classList.remove('hidden');
  }

  function clearSelectedMedia(scope) {
    const isQuick = scope === 'quick';
    if (isQuick) {
      if (quickSendMediaUrl) URL.revokeObjectURL(quickSendMediaUrl);
      quickSendMediaUrl = null;
      quickSendMediaFile = null;
      if (quicksendMediaPreview) quicksendMediaPreview.classList.add('hidden');
      clearPreviewMediaElements(quicksendMediaImage, quicksendMediaVideo);
      if (quicksendMediaName) quicksendMediaName.textContent = 'media';
      if (quicksendMediaInput) quicksendMediaInput.value = '';
    } else {
      if (campaignMediaUrl) URL.revokeObjectURL(campaignMediaUrl);
      campaignMediaUrl = null;
      campaignMediaFile = null;
      if (campaignMediaPreview) campaignMediaPreview.classList.add('hidden');
      clearPreviewMediaElements(campaignMediaImage, campaignMediaVideo);
      if (campaignMediaName) campaignMediaName.textContent = 'media';
      if (campaignMediaInput) campaignMediaInput.value = '';
    }
  }

  function setSelectedMedia(scope, file) {
    if (!file) return false;
    if (!isAllowedMediaFile(file)) {
      const msg = 'Unsupported file format. Use JPG, JPEG, PNG, GIF, MP4, WEBM, or MOV.';
      if (scope === 'quick') showQuickSendError(msg); else showCampaignError(msg);
      return false;
    }
    if (file.size > MAX_MEDIA_SIZE_BYTES) {
      const msg = 'File too large. Max allowed size is 16MB.';
      if (scope === 'quick') showQuickSendError(msg); else showCampaignError(msg);
      return false;
    }

    if (scope === 'quick') {
      clearSelectedMedia('quick');
      quickSendMediaFile = file;
      quickSendMediaUrl = URL.createObjectURL(file);
      setMediaPreview('quick', file, quickSendMediaUrl);
    } else {
      clearSelectedMedia('campaign');
      campaignMediaFile = file;
      campaignMediaUrl = URL.createObjectURL(file);
      setMediaPreview('campaign', file, campaignMediaUrl);
    }
    return true;
  }

  function attachMediaDropHandlers(el, onFile) {
    if (!el) return;
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
      if (file) onFile(file);
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('media_read_failed'));
      reader.readAsDataURL(file);
    });
  }

  async function buildMediaPayload(file) {
    if (!file) return null;
    const dataUrl = await fileToDataUrl(file);
    return {
      name: file.name,
      type: file.type || '',
      size: file.size || 0,
      kind: getMediaKind(file),
      dataUrl,
    };
  }

  function setupMediaPickers() {
    if (btnQuicksendMedia && quicksendMediaInput) btnQuicksendMedia.addEventListener('click', () => quicksendMediaInput.click());
    if (btnCampaignMedia && campaignMediaInput) btnCampaignMedia.addEventListener('click', () => campaignMediaInput.click());

    if (quicksendMediaInput) quicksendMediaInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) setSelectedMedia('quick', e.target.files[0]);
    });
    if (campaignMediaInput) campaignMediaInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) setSelectedMedia('campaign', e.target.files[0]);
    });

    if (btnQuicksendMediaRemove) btnQuicksendMediaRemove.addEventListener('click', () => clearSelectedMedia('quick'));
    if (btnCampaignMediaRemove) btnCampaignMediaRemove.addEventListener('click', () => clearSelectedMedia('campaign'));

    attachMediaDropHandlers(quicksendMediaDrop, (file) => setSelectedMedia('quick', file));
    attachMediaDropHandlers(campaignMediaDrop, (file) => setSelectedMedia('campaign', file));
  }

  // ═══════════════════════════════════════
  //  QUICK SEND
  // ═══════════════════════════════════════
  if (quicksendToggle) quicksendToggle.addEventListener('click', () => { const o = !quicksendBody.classList.contains('hidden'); quicksendBody.classList.toggle('hidden', o); quicksendChevron.textContent = o ? '▶' : '▼'; });
  
  if (quicksendNumbers) quicksendNumbers.addEventListener('input', () => { quicksendCount.textContent = getQuickSendNumbers().length; });

  if (btnQuicksendAction) btnQuicksendAction.addEventListener('click', handleQuickSend);

  function clearQuickSendSafetyTimer() {
    if (quickSendSafetyTimer) {
      clearTimeout(quickSendSafetyTimer);
      quickSendSafetyTimer = null;
    }
  }

  function resetQuickSendButton() {
    if (!btnQuicksendAction) return;
    btnQuicksendAction.disabled = false;
    btnQuicksendAction.textContent = `🚀 Send to ${getQuickSendNumbers().length} Numbers`;
  }

  function startQuickSendSafetyTimer() {
    clearQuickSendSafetyTimer();
    quickSendSafetyTimer = setTimeout(() => {
      resetQuickSendButton();
      if (quicksendError) {
        quicksendError.textContent = 'Send timed out. Please try again.';
        quicksendError.classList.remove('hidden');
      }
    }, 60000);
  }

  function getQuickSendNumbers() {
    if (!quicksendNumbers) return [];
    return quicksendNumbers.value.split(',').map(n => n.replace(/[\s\-\(\)\.\+]/g, '')).map(p => {
      if (p.length === 12 && p.startsWith('91')) return '+' + p;
      if (p.length === 10 && /^\d{10}$/.test(p)) return '+91' + p;
      if (/^\d{11,15}$/.test(p)) return '+' + p;
      return null;
    }).filter(p => p !== null);
  }

  async function handleQuickSend() {
    quicksendError.classList.add('hidden');
    quicksendStatus.classList.add('hidden');
    const numbers = getQuickSendNumbers();
    const msg = quicksendMessage.value.trim();
    const hasMedia = !!quickSendMediaFile;
    if (numbers.length === 0) { quicksendError.textContent = 'Please enter valid phone numbers.'; quicksendError.classList.remove('hidden'); return; }
    if (numbers.length > 50) { quicksendError.textContent = 'Maximum 50 numbers allowed.'; quicksendError.classList.remove('hidden'); return; }
    if (!msg && !hasMedia) {
      quicksendError.textContent = 'Please enter a message or attach media.';
      quicksendError.classList.remove('hidden');
      return;
    }
    
    // Check if running
    const state = await cGet('campaignState');
    if (state.campaignState && state.campaignState.isRunning) {
      quicksendError.textContent = 'A campaign is running. Please stop it first.';
      quicksendError.classList.remove('hidden');
      return;
    }

    const f = Math.max(5, parseInt(delayFixed.value, 10) || 10);
    const j = Math.max(0, parseInt(delayJitter.value, 10) || 3);
    const currentSendMode = modeDom.checked ? 'dom' : 'link';

    if (hasMedia && currentSendMode === 'link') {
      showQuickSendError('Media quick send works only in DOM mode. Switch mode to DOM.');
      resetQuickSendButton();
      return;
    }

    let response;
    try {
      btnQuicksendAction.disabled = true;
      btnQuicksendAction.textContent = hasMedia ? '⏳ Preparing media...' : '⏳ Starting...';
      const mediaPayload = hasMedia ? await buildMediaPayload(quickSendMediaFile) : null;
      response = await sendMsg({
        action: 'QUICK_SEND',
        numbers: numbers,
        message: msg,
        delayFixed: f,
        delayJitter: j,
        sendMode: currentSendMode,
        mediaPayload,
      });
    } catch (e) {
      quicksendError.textContent = 'Could not start quick send. Please try again.';
      quicksendError.classList.remove('hidden');
      resetQuickSendButton();
      clearQuickSendSafetyTimer();
      return;
    }

    if (!response || response.status === 'busy') {
      quicksendError.textContent = 'A send is already running. Please wait for it to finish.';
      quicksendError.classList.remove('hidden');
      resetQuickSendButton();
      clearQuickSendSafetyTimer();
      return;
    }

    if (response.status !== 'started') {
      quicksendError.textContent = 'Could not start quick send. Please try again.';
      quicksendError.classList.remove('hidden');
      resetQuickSendButton();
      clearQuickSendSafetyTimer();
      return;
    }

    btnQuicksendAction.disabled = true;
    btnQuicksendAction.textContent = '⏳ Starting...';
    startQuickSendSafetyTimer();
  }

  // ═══════════════════════════════════════
  //  CAMPAIGN CONTROLS
  // ═══════════════════════════════════════
  btnStart.addEventListener('click', startCampaign);
  btnStop.addEventListener('click', stopCampaign);

  async function startCampaign() {
    hideError(); completionMsg.classList.add('hidden');

    // Check scheduling
    const schedChk = $('#chk-schedule-later');
    if (schedChk && schedChk.checked) return; // handled by scheduler

    const template = templateInput.value.trim();
    const isRotate = tplModeRotate && tplModeRotate.checked;
    const hasCampaignMedia = !!campaignMediaFile;

    if (!isRotate && !template && !hasCampaignMedia) {
      showError('Please write a message template or attach media.');
      return;
    }

    let rotateTemplates = false;
    let templateIds = [];

    if (isRotate) {
      const checked = document.querySelectorAll('.rotate-tpl-chk:checked');
      templateIds = Array.from(checked).map((c) => parseInt(c.dataset.id, 10));
      if (templateIds.length < 2) { showError('Select at least 2 templates for rotation.'); return; }
      rotateTemplates = true;
    }

    const skipAM = !chkResend.checked;
    const activeMode = modeDom.checked ? 'dom' : 'link';
    if (hasCampaignMedia && activeMode === 'link') {
      showError('Media campaign send works only in DOM mode. Switch mode to DOM.');
      return;
    }

    // Resume existing paused campaign only when no fresh upload exists
    if (parsedContacts.length === 0) {
      const rs = await cGet('campaignState');
      const existing = rs.campaignState || {};
      if (existing.campaignId) {
        const resumeCounts = await DB.getLeadCounts({ campaignId: existing.campaignId });
        if (resumeCounts.pending > 0) {
          let resumeMediaPayload = null;
          if (hasCampaignMedia) {
            try { resumeMediaPayload = await buildMediaPayload(campaignMediaFile); }
            catch (e) {
              showError('Failed to read selected media file.');
              return;
            }
          }
          existing.isRunning = true;
          existing.status = 'running';
          existing.total = resumeCounts.total;
          existing.sent = resumeCounts.sent;
          existing.failed = resumeCounts.failed;
          existing.hasMedia = hasCampaignMedia || !!existing.hasMedia;
          await cSet({ campaignState: existing });
          showRunningUI(existing);
          chrome.runtime.sendMessage({
            action: 'START_CAMPAIGN',
            campaignId: existing.campaignId,
            campaignDbId: existing.campaignDbId || null,
            mediaPayload: resumeMediaPayload,
            hasMedia: existing.hasMedia || false,
          });
          return;
        }
      }
      showError('No contacts loaded. Upload a file first.');
      return;
    }

    const campaignId = generateCampaignId();
    const campaignDbId = await DB.addCampaign({
      name: 'Campaign ' + new Date().toLocaleDateString(),
      status: 'active',
      campaignId,
      template,
      totalContacts: 0,
    });

    let snapshotCount = 0;

    if (parsedContacts.length > 0) {
      for (const c of parsedContacts) {
        if (!/^\+\d{10,15}$/.test(c.phone)) continue;
        if (skipAM && c._alreadyMessaged) continue;
        const ex = await DB.getLead(c.phone);
        if (ex) {
          await DB.updateLead(ex.id, {
            status: 'pending',
            name: c.name || ex.name,
            course: c.course || ex.course,
            city: c.city || ex.city,
            campaignId,
            campaignDbId,
          });
        } else {
          await DB.addLead({
            phone: c.phone,
            name: c.name,
            course: c.course,
            city: c.city,
            status: 'pending',
            campaignId,
            campaignDbId,
          });
        }
        snapshotCount++;
      }
    }

    if (snapshotCount === 0) {
      await DB.updateCampaign(campaignDbId, { status: 'cancelled', totalContacts: 0, completedAt: Date.now() });
      showError('No valid contacts to send after filters. Check numbers or resend setting.');
      return;
    }

    await DB.updateCampaign(campaignDbId, { totalContacts: snapshotCount, sent: 0, failed: 0 });

    const f = Math.max(5, parseInt(delayFixed.value, 10) || 10);
    const j = Math.max(0, parseInt(delayJitter.value, 10) || 3);

    saveFollowUpConfig();

    const cs = {
      isRunning: true, status: 'running', currentIndex: 0, total: snapshotCount,
      sent: 0, failed: 0, template, delayFixed: f, delayJitter: j, campaignId, campaignDbId,
      hasMedia: hasCampaignMedia,
      rotateTemplates, templateIds, rotationIndex: 0,
    };

    await cSet({ campaignState: cs, savedTemplate: template, delayConfig: { fixed: f, jitter: j }, sendMode: modeDom.checked ? 'dom' : 'link' });
    showRunningUI(cs);
    let mediaPayload = null;
    if (hasCampaignMedia) {
      try { mediaPayload = await buildMediaPayload(campaignMediaFile); }
      catch (e) {
        showError('Failed to read selected media file.');
        return;
      }
    }
    chrome.runtime.sendMessage({ action: 'START_CAMPAIGN', campaignId, campaignDbId, mediaPayload, hasMedia: hasCampaignMedia });
  }

  async function stopCampaign() {
    try { const r = await cGet('campaignState'); const s = r.campaignState || {}; s.isRunning = false; s.status = 'stopped'; await cSet({ campaignState: s }); } catch (e) { /* */ }
    chrome.runtime.sendMessage({ action: 'STOP_CAMPAIGN' });
    btnStop.classList.add('hidden'); btnStart.classList.remove('hidden');
    btnStart.querySelector('svg + *') || (btnStart.textContent = 'Resume Campaign');
    currentContact.classList.add('hidden'); breakBanner.classList.add('hidden'); clearBreakCD();
  }

  function showRunningUI(s) { btnStart.classList.add('hidden'); btnStop.classList.remove('hidden'); progressContainer.classList.remove('hidden'); statsRow.classList.remove('hidden'); completionMsg.classList.add('hidden'); updateProgress(s); }

  function updateProgress(s) {
    const t = s.total || 1; const sent = s.sent || 0; const f = s.failed || 0;
    const pct = Math.round((sent / t) * 100);
    progressBar.style.width = `${pct}%`; progressText.textContent = `${pct}%`;
    statSent.textContent = sent; statPending.textContent = Math.max(0, t - sent - f); statFailed.textContent = f;
    if (s.currentContact) { currentContactName.textContent = s.currentContact; currentContact.classList.remove('hidden'); }
  }

  function startBreakCD(endTime) {
    breakBanner.classList.remove('hidden'); clearBreakCD();
    breakCountdownInterval = setInterval(() => {
      const r = Math.max(0, endTime - Date.now());
      breakCountdown.textContent = `${Math.floor(r / 60000)}:${String(Math.floor((r % 60000) / 1000)).padStart(2, '0')}`;
      if (r <= 0) { clearBreakCD(); breakBanner.classList.add('hidden'); }
    }, 1000);
  }
  function clearBreakCD() { if (breakCountdownInterval) { clearInterval(breakCountdownInterval); breakCountdownInterval = null; } }

  // ═══════════════════════════════════════
  //  MESSAGE LISTENER
  // ═══════════════════════════════════════
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'PROGRESS_UPDATE') { updateProgress(msg); progressContainer.classList.remove('hidden'); statsRow.classList.remove('hidden'); }
    if (msg.action === 'CAMPAIGN_COMPLETE') {
      btnStop.classList.add('hidden'); btnStart.classList.remove('hidden');
      completionText.textContent = `Campaign complete! Sent ${msg.sent} of ${msg.total}.`;
      completionMsg.classList.remove('hidden'); currentContact.classList.add('hidden');
      breakBanner.classList.add('hidden'); clearBreakCD(); updateProgress(msg);
    }
    if (msg.action === 'CAMPAIGN_ERROR') { showError(msg.error); btnStop.classList.add('hidden'); btnStart.classList.remove('hidden'); currentContact.classList.add('hidden'); breakBanner.classList.add('hidden'); clearBreakCD(); }
    if (msg.action === 'BREAK_STARTED') { startBreakCD(msg.breakEndTime); currentContact.classList.add('hidden'); }
    if (msg.action === 'BREAK_ENDED') { breakBanner.classList.add('hidden'); clearBreakCD(); }
    if (msg.action === 'REPLY_NOTIFICATION' && window.WALeads) window.WALeads.showReplyToast(msg);
    if (msg.action === 'SCHEDULED_CAMPAIGN_STARTED') { showError(`⏰ Scheduled campaign "${msg.name}" started — ${msg.total} contacts`); campaignError.style.borderColor = 'var(--emerald-500)'; }
    
    // Quick send progress
    if (msg.action === 'QUICK_SEND_PROGRESS') {
      startQuickSendSafetyTimer();
      if (btnQuicksendAction) btnQuicksendAction.textContent = `⏳ Sending ${msg.sent}/${msg.total}...`;
    }
    if (msg.action === 'QUICK_SEND_COMPLETE') {
      clearQuickSendSafetyTimer();
      resetQuickSendButton();
      if (quicksendStatus) { quicksendStatus.textContent = `✅ Sent to ${msg.sent} numbers!`; quicksendStatus.classList.remove('hidden'); }
      if (quicksendMessage) quicksendMessage.value = '';
    }
  });

  // ═══════════════════════════════════════
  //  SETTINGS
  // ═══════════════════════════════════════
  function setupSettings() {
    $('#btn-save-settings').addEventListener('click', saveSettings);
    $('#btn-export-backup').addEventListener('click', exportBackup);
    $('#file-import-backup').addEventListener('change', importBackup);
    $('#btn-clear-history').addEventListener('click', clearHistory);
    $('#btn-reset-all').addEventListener('click', () => { $('#reset-confirm').classList.remove('hidden'); });
    $('#btn-confirm-reset').addEventListener('click', confirmReset);
  }

  async function saveSettings() {
    const maxRetriesRaw = parseInt($('#set-max-retries').value, 10);
    const maxRetries = isNaN(maxRetriesRaw) ? 3 : maxRetriesRaw;
    const retryIntervalRaw = parseInt($('#set-retry-interval').value, 10);
    const retryInterval = isNaN(retryIntervalRaw) ? 5 : retryIntervalRaw;
    const settings = {
      dailyLimit: parseInt($('#set-daily-limit').value, 10) || 150,
      breakAfterMessages: parseInt($('#set-break-after').value, 10) || 30,
      breakDurationMinutes: parseInt($('#set-break-duration').value, 10) || 3,
      enableJitter: $('#set-enable-jitter').checked,
      enableTyping: $('#set-enable-typing').checked,
      enableBreaks: $('#set-enable-breaks').checked,
      showBanWarning: $('#set-ban-warning').checked,
      notifyHotLead: $('#set-notif-hot').checked,
      notifyCampaignComplete: $('#set-notif-complete').checked,
      notifyScheduledStart: $('#set-notif-scheduled').checked,
      maxRetries: maxRetries,
      retryInterval: retryInterval,
    };
    await cSet({ wAutoSettings: settings });
    $('#btn-save-settings').textContent = '✓ Saved!';
    setTimeout(() => { $('#btn-save-settings').textContent = '💾 Save Settings'; }, 1500);
  }

  async function restoreSettings() {
    const r = await cGet('wAutoSettings');
    const s = r.wAutoSettings || {};
    if (s.dailyLimit) $('#set-daily-limit').value = s.dailyLimit;
    if (s.breakAfterMessages) $('#set-break-after').value = s.breakAfterMessages;
    if (s.breakDurationMinutes) $('#set-break-duration').value = s.breakDurationMinutes;
    if (s.enableJitter !== undefined) $('#set-enable-jitter').checked = s.enableJitter;
    if (s.enableTyping !== undefined) $('#set-enable-typing').checked = s.enableTyping;
    if (s.enableBreaks !== undefined) $('#set-enable-breaks').checked = s.enableBreaks;
    if (s.showBanWarning !== undefined) $('#set-ban-warning').checked = s.showBanWarning;
    if (s.notifyHotLead !== undefined) $('#set-notif-hot').checked = s.notifyHotLead;
    if (s.notifyCampaignComplete !== undefined) $('#set-notif-complete').checked = s.notifyCampaignComplete;
    if (s.notifyScheduledStart !== undefined) $('#set-notif-scheduled').checked = s.notifyScheduledStart;
    if (s.maxRetries !== undefined) $('#set-max-retries').value = s.maxRetries;
    if (s.retryInterval !== undefined) $('#set-retry-interval').value = s.retryInterval;
  }

  async function exportBackup() {
    const json = await DB.exportFullBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `WAuto_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  async function importBackup(e) {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    try { await DB.importFullBackup(text); alert('Backup restored successfully!'); location.reload(); }
    catch (err) { alert('Failed to restore backup: ' + err.message); }
  }

  async function clearHistory() {
    if (!confirm('Clear all message history? Leads will be kept.')) return;
    await DB.clearSendHistory(); alert('Send history cleared.');
  }

  async function confirmReset() {
    const v = $('#reset-confirm-input').value.trim();
    if (v !== 'RESET') { alert('Type RESET to confirm.'); return; }
    await DB.resetAllData();
    chrome.storage.local.clear();
    alert('All data has been reset.');
    location.reload();
  }

  // ═══════════════════════════════════════
  //  DASHBOARD WIRING
  // ═══════════════════════════════════════
  function setupDashboard() {
    const filter = $('#dash-date-filter');
    if (filter) filter.addEventListener('change', () => { if (window.WADashboard) window.WADashboard.setRange(filter.value); });
    const refresh = $('#dash-refresh-btn');
    if (refresh) refresh.addEventListener('click', () => { if (window.WADashboard) window.WADashboard.refresh(); });
    const exportBtn = $('#btn-export-report');
    if (exportBtn) exportBtn.addEventListener('click', () => { if (window.WADashboard) window.WADashboard.exportReport(); });
  }

  // ═══════════════════════════════════════
  //  RESTORE STATE
  // ═══════════════════════════════════════
  async function restoreState() {
    try {
      const r = await cGet(['savedTemplate', 'delayConfig', 'campaignState', 'sendMode', 'activeTab']);
      if (r.savedTemplate) templateInput.value = r.savedTemplate;
      if (r.delayConfig) { delayFixed.value = r.delayConfig.fixed || 10; delayJitter.value = r.delayConfig.jitter || 3; }
      updateDelayHelper();

      if (r.sendMode === 'link') { modeLink.checked = true; sessionBanner.classList.add('hidden'); } else { modeDom.checked = true; startSessionCheck(); }

      await restoreFollowUpConfig();
      await restoreSettings();

      // Restore active tab
      if (r.activeTab) {
        const btn = $(`[data-tab="${r.activeTab}"]`);
        if (btn) btn.click();
      }
      else {
        setActiveTabState('campaign');
      }

      // Restore campaign state
      if (r.campaignState) {
        const s = r.campaignState;
        if (s.campaignId) {
          const scopedCounts = await DB.getLeadCounts({ campaignId: s.campaignId });
          s.total = scopedCounts.total;
          s.sent = scopedCounts.sent;
          s.failed = scopedCounts.failed;
        }
        if (s.isRunning) { showRunningUI(s); }
        else if (s.sent > 0 || s.failed > 0) {
          progressContainer.classList.remove('hidden'); statsRow.classList.remove('hidden'); updateProgress(s);
          if (s.status === 'completed') { completionText.textContent = `Campaign complete! Sent ${s.sent} of ${s.total}.`; completionMsg.classList.remove('hidden'); }
          else if (['stopped', 'paused_login', 'paused_tab_closed', 'daily_limit'].includes(s.status)) {
            btnStart.textContent = 'Resume Campaign';
            if (s.status === 'paused_login') showError('WhatsApp disconnected. Scan QR code and resume.');
            if (s.status === 'paused_tab_closed') showError('WhatsApp tab was closed. Reopen and resume.');
            if (s.status === 'daily_limit') showError('Daily limit reached. Resume tomorrow.');
          }
        }
      }

      const counts = await DB.getLeadCounts();
      if (counts.total > 0) { fileName.textContent = 'Leads in database'; rowCount.textContent = `${counts.total} leads`; fileInfo.classList.remove('hidden'); dropZone.classList.add('hidden'); }

      updateLivePreview();
    } catch (err) { console.error('Restore error:', err); }
  }

  // ═══════════════════════════════════════
  //  UTILS
  // ═══════════════════════════════════════
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function showError(m) { if (campaignErrorText) campaignErrorText.textContent = m; campaignError.classList.remove('hidden'); campaignError.style.borderColor = ''; }
  function hideError() { campaignError.classList.add('hidden'); }
  function generateCampaignId() { return `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
  function sendMsg(m) { return new Promise((r, j) => { try { chrome.runtime.sendMessage(m, (res) => { if (chrome.runtime.lastError) j(chrome.runtime.lastError); else r(res); }); } catch (e) { j(e); } }); }
  function cGet(k) { return new Promise((r, j) => { chrome.storage.local.get(k, (res) => { if (chrome.runtime.lastError) j(chrome.runtime.lastError); else r(res); }); }); }
  function cSet(d) { return new Promise((r, j) => { chrome.storage.local.set(d, () => { if (chrome.runtime.lastError) j(chrome.runtime.lastError); else r(); }); }); }

  // ═══════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════
  setupMediaPickers();
  setupSettings();
  setupDashboard();
  restoreState();
  window.addEventListener('beforeunload', () => {
    clearSelectedMedia('quick');
    clearSelectedMedia('campaign');
    clearQuickSendSafetyTimer();
  });

  setTimeout(() => {
    if (window.WALeads) { window.WALeads.setupToolbar(); window.WALeads.setupTagFilters(); }
    if (window.WAScheduler) window.WAScheduler.init();

    // Wire export leads button
    const exportBtn = $('#btn-export-leads');
    if (exportBtn) exportBtn.addEventListener('click', () => { if (window.WALeads) window.WALeads.openExportModal(); });
  }, 100);
})();
