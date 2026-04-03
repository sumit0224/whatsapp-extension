/* ═══════════════════════════════════════════════════
   WAuto Pro — Campaign Scheduler (Phase 4)
   Schedule campaigns for future execution
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';
  const DB = window.WAutoDB;

  // ═══════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════
  async function initScheduler() {
    setupScheduleToggle();
    setupScheduleForm();
    await renderScheduledList();
  }

  // ═══════════════════════════════════════
  //  TOGGLE
  // ═══════════════════════════════════════
  function setupScheduleToggle() {
    const toggle = document.getElementById('schedule-toggle');
    const body = document.getElementById('schedule-body');
    const chevron = document.getElementById('schedule-chevron');

    if (toggle) {
      toggle.addEventListener('click', () => {
        const isOpen = !body.classList.contains('hidden');
        body.classList.toggle('hidden', isOpen);
        chevron.textContent = isOpen ? '▶' : '▼';
      });
    }
  }

  // ═══════════════════════════════════════
  //  SCHEDULE FORM
  // ═══════════════════════════════════════
  function setupScheduleForm() {
    const chk = document.getElementById('chk-schedule-later');
    const fields = document.getElementById('schedule-fields');

    if (chk) {
      chk.addEventListener('change', () => {
        fields.classList.toggle('hidden', !chk.checked);
      });
    }

    // Set default date/time
    const dateInput = document.getElementById('schedule-date');
    const timeInput = document.getElementById('schedule-time');
    if (dateInput) {
      const today = new Date().toISOString().slice(0, 10);
      dateInput.value = today;
      dateInput.min = today;
    }
    if (timeInput) timeInput.value = '10:00';

    const saveBtn = document.getElementById('btn-schedule-campaign');
    if (saveBtn) {
      saveBtn.addEventListener('click', scheduleCampaign);
    }
  }

  // ═══════════════════════════════════════
  //  SCHEDULE A CAMPAIGN
  // ═══════════════════════════════════════
  async function scheduleCampaign() {
    const dateInput = document.getElementById('schedule-date');
    const timeInput = document.getElementById('schedule-time');
    const templateInput = document.getElementById('template-input');
    const errEl = document.getElementById('schedule-error');

    if (!dateInput || !dateInput.value || !timeInput || !timeInput.value) {
      showScheduleError('Please select a date and time.');
      return;
    }

    const template = templateInput ? templateInput.value.trim() : '';
    if (!template) {
      showScheduleError('Please write a message template first.');
      return;
    }

    const scheduledFor = new Date(`${dateInput.value}T${timeInput.value}`).getTime();
    if (scheduledFor <= Date.now()) {
      showScheduleError('Scheduled time must be in the future.');
      return;
    }

    // Get pending lead IDs
    const counts = await DB.getLeadCounts();
    if (counts.pending === 0) {
      showScheduleError('No pending contacts to schedule.');
      return;
    }

    // Get follow-up config
    let followUpTemplates = {};
    try {
      const fuConfig = await chromeGet('followUpConfig');
      followUpTemplates = fuConfig.followUpConfig || {};
    } catch (e) { /* */ }

    // Get delay config
    const fixedEl = document.getElementById('delay-fixed');
    const jitterEl = document.getElementById('delay-jitter');
    const fixed = fixedEl ? Math.max(5, parseInt(fixedEl.value, 10) || 10) : 10;
    const jitter = jitterEl ? Math.max(0, parseInt(jitterEl.value, 10) || 3) : 3;

    // Get send mode
    const modeData = await chromeGet('sendMode');
    const sendMode = modeData.sendMode || 'dom';

    // Check template rotation
    let templateIds = [];
    let rotateTemplates = false;
    const rotateRadio = document.getElementById('tpl-mode-rotate');
    if (rotateRadio && rotateRadio.checked) {
      const checkboxes = document.querySelectorAll('.rotate-tpl-chk:checked');
      templateIds = Array.from(checkboxes).map((c) => parseInt(c.dataset.id, 10));
      rotateTemplates = templateIds.length >= 2;
    }

    const name = `Campaign — ${dateInput.value} ${timeInput.value}`;

    await DB.addScheduledCampaign({
      name, template, followUpTemplates, scheduledFor,
      delayConfig: { fixed, jitter }, sendMode, templateIds, rotateTemplates,
    });

    hideScheduleError();
    await renderScheduledList();
    showScheduleSuccess('Campaign scheduled! ⏰');
  }

  // ═══════════════════════════════════════
  //  SCHEDULED CAMPAIGNS LIST
  // ═══════════════════════════════════════
  async function renderScheduledList() {
    const container = document.getElementById('scheduled-list');
    if (!container) return;

    const campaigns = await DB.getScheduledCampaigns();
    // Filter out completed ones older than 24h
    const now = Date.now();
    const visible = campaigns.filter((c) => {
      if (c.status === 'completed' && c.completedAt && now - c.completedAt > 86400000) return false;
      if (c.status === 'cancelled') return false;
      return true;
    });

    if (visible.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:11px;text-align:center;padding:8px;">No scheduled campaigns</p>';
      return;
    }

    container.innerHTML = `
      <table class="data-table" style="font-size:11px;">
        <thead><tr><th>Name</th><th>Scheduled</th><th>Status</th><th></th></tr></thead>
        <tbody>${visible.map((c) => `
          <tr>
            <td title="${esc(c.name)}">${esc(c.name)}</td>
            <td>${new Date(c.scheduledFor).toLocaleString()}</td>
            <td><span class="badge badge-${c.status === 'waiting' ? 'pending' : c.status}">${c.status}</span></td>
            <td>${c.status === 'waiting' ? `<button class="btn btn-ghost btn-sm cancel-scheduled-btn" data-id="${c.id}">Cancel</button>` : ''}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;

    container.querySelectorAll('.cancel-scheduled-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await DB.cancelScheduledCampaign(parseInt(btn.dataset.id, 10));
        await renderScheduledList();
      });
    });
  }

  // ═══════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════
  function showScheduleError(msg) {
    const el = document.getElementById('schedule-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  }

  function hideScheduleError() {
    const el = document.getElementById('schedule-error');
    if (el) el.classList.add('hidden');
  }

  function showScheduleSuccess(msg) {
    const el = document.getElementById('schedule-success');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3000); }
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function chromeGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (r) => resolve(r));
    });
  }

  window.WAScheduler = { init: initScheduler, refresh: renderScheduledList };
})();
