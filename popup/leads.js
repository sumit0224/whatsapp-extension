/* ═══════════════════════════════════════════════════
   WAuto Pro — Leads Tab Logic (Phase 4)
   Table, filters, tags, notes, export modal, retry
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';
  const DB = window.WAutoDB;

  let currentFilter = { status: null, tag: null, search: '', sort: 'newest' };
  let openTagDropdownId = null;
  let toastTimeout = null;

  // ═══════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════
  async function initLeadsTab() {
    await renderPipeline();
    await renderLeadsTable();
  }

  // ═══════════════════════════════════════
  //  PIPELINE
  // ═══════════════════════════════════════
  async function renderPipeline() {
    const counts = await DB.getLeadCounts();
    const bar = document.getElementById('pipeline-bar');
    if (!bar) return;

    const chips = [
      { key: 'pending', label: 'Pending', cls: 'pending' },
      { key: 'sent', label: 'Sent', cls: 'sent' },
      { key: 'replied', label: 'Replied', cls: 'replied' },
      { key: 'converted', label: 'Converted', cls: 'converted' },
      { key: 'failed', label: 'Failed', cls: 'failed' },
    ];

    bar.innerHTML = chips.map((c) => {
      const isActive = currentFilter.status === c.key;
      return `<button class="pipeline-chip pipeline-chip--${c.cls} ${isActive ? 'active' : ''}" data-status="${c.key}">${c.label}: <span class="chip-count">${counts[c.key] || 0}</span></button>`;
    }).join('');

    bar.querySelectorAll('.pipeline-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const s = chip.dataset.status;
        currentFilter.status = currentFilter.status === s ? null : s;
        renderPipeline(); renderLeadsTable();
      });
    });
  }

  // ═══════════════════════════════════════
  //  SEARCH & SORT
  // ═══════════════════════════════════════
  function setupToolbar() {
    const searchInput = document.getElementById('leads-search-input');
    const sortSelect = document.getElementById('leads-sort-select');
    if (searchInput) searchInput.addEventListener('input', debounce(() => { currentFilter.search = searchInput.value.trim(); renderLeadsTable(); }, 300));
    if (sortSelect) sortSelect.addEventListener('change', () => { currentFilter.sort = sortSelect.value; renderLeadsTable(); });
  }

  function setupTagFilters() {
    const container = document.getElementById('tag-filters');
    if (!container) return;
    container.querySelectorAll('.tag-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const tag = pill.dataset.tag;
        if (tag === 'all') { currentFilter.tag = null; currentFilter.status = null; }
        else { currentFilter.tag = currentFilter.tag === tag ? null : tag; }
        container.querySelectorAll('.tag-pill').forEach((p) => {
          const pt = p.dataset.tag;
          if (pt === 'all') p.classList.toggle('active', !currentFilter.tag && !currentFilter.status);
          else p.classList.toggle('active', currentFilter.tag === pt);
        });
        renderPipeline(); renderLeadsTable();
      });
    });
  }

  // ═══════════════════════════════════════
  //  LEADS TABLE
  // ═══════════════════════════════════════
  async function renderLeadsTable() {
    const tbody = document.getElementById('leads-tbody');
    const emptyState = document.getElementById('leads-empty');
    const tableEl = document.getElementById('leads-table');
    const totalCount = document.getElementById('leads-total-count');

    const filters = {};
    if (currentFilter.status) filters.status = currentFilter.status;
    if (currentFilter.tag) filters.tag = currentFilter.tag;
    if (currentFilter.search) filters.search = currentFilter.search;
    if (currentFilter.sort) filters.sort = currentFilter.sort;

    const leads = await DB.getAllLeads(filters);
    if (totalCount) totalCount.textContent = `${leads.length} contacts`;

    if (leads.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (tableEl) tableEl.classList.add('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    if (tableEl) tableEl.classList.remove('hidden');

    tbody.innerHTML = leads.map((lead, i) => `
      <tr data-lead-id="${lead.id}">
        <td>${i + 1}</td>
        <td title="${esc(lead.name)}">${esc(lead.name)}</td>
        <td title="${esc(lead.phone)}">${esc(lead.phone)}</td>
        <td title="${esc(lead.course)}">${esc(lead.course)}</td>
        <td>${statusBadge(lead.status)}</td>
        <td>${tagBadge(lead.tag)}</td>
        <td class="td-activity">${lastActivity(lead)}</td>
        <td>
          <div class="lead-actions">
            <button class="lead-action-btn" title="Tag" data-action="tag" data-id="${lead.id}">🏷</button>
            <button class="lead-action-btn" title="Notes" data-action="notes" data-id="${lead.id}">📝</button>
            <button class="lead-action-btn" title="Chat" data-action="chat" data-id="${lead.id}" data-phone="${esc(lead.phone)}">💬</button>
            <button class="lead-action-btn" title="Convert" data-action="convert" data-id="${lead.id}">✓</button>
            ${lead.status === 'failed' ? `<button class="lead-action-btn" title="Retry" data-action="retry" data-id="${lead.id}" style="color:#F59E0B">↻</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.lead-action-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); handleAction(btn); });
    });
  }

  // ═══════════════════════════════════════
  //  ACTIONS
  // ═══════════════════════════════════════
  async function handleAction(btn) {
    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id, 10);

    switch (action) {
      case 'tag': toggleTagDropdown(btn, id); break;
      case 'notes': openNotesModal(id); break;
      case 'chat':
        const phone = btn.dataset.phone.replace('+', '');
        window.open(`https://wa.me/${phone}`, '_blank');
        break;
      case 'convert':
        await DB.updateLead(id, { status: 'converted' });
        await renderPipeline(); await renderLeadsTable();
        break;
      case 'retry':
        await DB.updateLead(id, { status: 'pending' });
        await renderPipeline(); await renderLeadsTable();
        break;
    }
  }

  // ═══════════════════════════════════════
  //  TAG DROPDOWN
  // ═══════════════════════════════════════
  function toggleTagDropdown(btn, leadId) {
    closeTagDropdown();
    if (openTagDropdownId === leadId) { openTagDropdownId = null; return; }
    openTagDropdownId = leadId;

    const dd = document.createElement('div');
    dd.className = 'tag-dropdown'; dd.id = 'active-tag-dropdown';
    dd.innerHTML = `<button class="tag-dropdown-item" data-tag="hot">🔥 Hot</button><button class="tag-dropdown-item" data-tag="warm">☀️ Warm</button><button class="tag-dropdown-item" data-tag="cold">❄️ Cold</button><button class="tag-dropdown-item" data-tag="">✕ Remove</button>`;
    btn.style.position = 'relative'; btn.appendChild(dd);

    dd.querySelectorAll('.tag-dropdown-item').forEach((item) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        await DB.updateLead(leadId, { tag: item.dataset.tag || null });
        closeTagDropdown(); await renderPipeline(); await renderLeadsTable();
      });
    });

    setTimeout(() => document.addEventListener('click', closeOnOutside), 10);
  }

  function closeTagDropdown() { const el = document.getElementById('active-tag-dropdown'); if (el) el.remove(); openTagDropdownId = null; document.removeEventListener('click', closeOnOutside); }
  function closeOnOutside(e) { const dd = document.getElementById('active-tag-dropdown'); if (dd && !dd.contains(e.target)) closeTagDropdown(); }

  // ═══════════════════════════════════════
  //  NOTES MODAL
  // ═══════════════════════════════════════
  async function openNotesModal(leadId) {
    const lead = await DB.getLeadById(leadId);
    if (!lead) return;
    closeNotesModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'notes-modal';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header"><div><div class="modal-title">📝 Notes — ${esc(lead.name || lead.phone)}</div><div class="modal-subtitle">${esc(lead.phone)} · ${esc(lead.course)}</div></div>
          <button class="modal-close" id="modal-close-btn">×</button></div>
        <textarea class="modal-textarea" id="modal-notes-text" placeholder="Add notes…">${esc(lead.notes || '')}</textarea>
        <div class="modal-actions"><button class="modal-btn modal-btn--cancel" id="modal-cancel-btn">Cancel</button><button class="modal-btn modal-btn--save" id="modal-save-btn">Save Notes</button></div>
      </div>`;

    document.body.appendChild(overlay);
    document.getElementById('modal-close-btn').addEventListener('click', closeNotesModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeNotesModal);
    document.getElementById('modal-save-btn').addEventListener('click', async () => { await DB.updateLead(leadId, { notes: document.getElementById('modal-notes-text').value }); closeNotesModal(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeNotesModal(); });
    document.getElementById('modal-notes-text').focus();
  }

  function closeNotesModal() { const m = document.getElementById('notes-modal'); if (m) m.remove(); }

  // ═══════════════════════════════════════
  //  EXPORT MODAL (Phase 4)
  // ═══════════════════════════════════════
  function openExportModal() {
    closeExportModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'export-modal';
    overlay.innerHTML = `
      <div class="modal-box" style="width:440px;">
        <div class="modal-header"><div class="modal-title">📥 Export Leads</div><button class="modal-close" id="export-close-btn">×</button></div>
        <div class="export-modal-options">
          <h4>Format</h4>
          <label class="checkbox-row"><input type="radio" name="export-format" value="xlsx" checked> Excel (.xlsx)</label>
          <label class="checkbox-row"><input type="radio" name="export-format" value="csv"> CSV (.csv)</label>
        </div>
        <div class="export-modal-options">
          <h4>Filter</h4>
          <label class="checkbox-row"><input type="radio" name="export-filter" value="current" checked> Current view</label>
          <label class="checkbox-row"><input type="radio" name="export-filter" value="all"> All leads</label>
          <label class="checkbox-row"><input type="radio" name="export-filter" value="hot"> Hot leads only</label>
          <label class="checkbox-row"><input type="radio" name="export-filter" value="replied"> Replied leads only</label>
          <label class="checkbox-row"><input type="radio" name="export-filter" value="converted"> Converted only</label>
          <label class="checkbox-row"><input type="radio" name="export-filter" value="failed"> Failed only</label>
        </div>
        <div class="export-modal-options">
          <h4>Columns</h4>
          <div class="export-columns-grid">
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="name" checked> Name</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="phone" checked> Phone</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="course" checked> Course</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="city" checked> City</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="status" checked> Status</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="tag" checked> Tag</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="notes" checked> Notes</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="sentAt" checked> Date Sent</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="repliedAt" checked> Date Replied</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="followUpDay" checked> Follow-up Day</label>
            <label class="checkbox-row"><input type="checkbox" class="export-col-chk" value="campaignName" checked> Campaign</label>
          </div>
        </div>
        <div class="modal-actions"><button class="modal-btn modal-btn--cancel" id="export-cancel-btn">Cancel</button><button class="modal-btn modal-btn--save" id="export-do-btn">📥 Export</button></div>
      </div>`;

    document.body.appendChild(overlay);
    document.getElementById('export-close-btn').addEventListener('click', closeExportModal);
    document.getElementById('export-cancel-btn').addEventListener('click', closeExportModal);
    document.getElementById('export-do-btn').addEventListener('click', doExport);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeExportModal(); });
  }

  function closeExportModal() { const m = document.getElementById('export-modal'); if (m) m.remove(); }

  async function doExport() {
    const format = document.querySelector('input[name="export-format"]:checked').value;
    const filter = document.querySelector('input[name="export-filter"]:checked').value;
    const cols = Array.from(document.querySelectorAll('.export-col-chk:checked')).map((c) => c.value);

    let filters = {};
    switch (filter) {
      case 'current':
        if (currentFilter.status) filters.status = currentFilter.status;
        if (currentFilter.tag) filters.tag = currentFilter.tag;
        break;
      case 'hot': filters.tag = 'hot'; break;
      case 'replied': filters.status = 'replied'; break;
      case 'converted': filters.status = 'converted'; break;
      case 'failed': filters.status = 'failed'; break;
    }

    const leads = await DB.getLeadsForExport(filters);
    if (leads.length === 0) { alert('No leads match the selected filter.'); return; }

    const colMap = {
      name: { h: 'Name', f: (l) => l.name }, phone: { h: 'Phone', f: (l) => l.phone },
      course: { h: 'Course', f: (l) => l.course }, city: { h: 'City', f: (l) => l.city },
      status: { h: 'Status', f: (l) => l.status }, tag: { h: 'Tag', f: (l) => l.tag || '' },
      notes: { h: 'Notes', f: (l) => l.notes || '' },
      sentAt: { h: 'Date Sent', f: (l) => l.sentAt ? new Date(l.sentAt).toLocaleString() : '' },
      repliedAt: { h: 'Date Replied', f: (l) => l.repliedAt ? new Date(l.repliedAt).toLocaleString() : '' },
      followUpDay: { h: 'Follow-up Day', f: (l) => l.followUpDay || 0 },
      campaignName: { h: 'Campaign', f: (l) => l.campaignName || '' },
    };

    const headers = cols.map((c) => colMap[c].h);
    const rows = leads.map((l) => cols.map((c) => colMap[c].f(l)));
    const data = [headers, ...rows];

    const filterLabel = filter === 'current' ? 'filtered' : filter;
    const dateStr = new Date().toISOString().slice(0, 10);

    if (format === 'xlsx' && typeof XLSX !== 'undefined') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length, 12) }));
      XLSX.utils.book_append_sheet(wb, ws, 'WAuto Leads Export');

      // Summary sheet
      const summary = [['WAuto Pro — Leads Export'], ['Date', dateStr], ['Filter', filterLabel], ['Total Leads', leads.length],
        [''], ['Status', 'Count'], ...['pending', 'sent', 'replied', 'converted', 'failed'].map((s) => [s, leads.filter((l) => l.status === s).length])];
      const ws2 = XLSX.utils.aoa_to_sheet(summary);
      ws2['!cols'] = [{ wch: 20 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

      XLSX.writeFile(wb, `WAuto_Leads_${dateStr}_${filterLabel}.xlsx`);
    } else {
      // CSV fallback
      const csv = data.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `WAuto_Leads_${dateStr}_${filterLabel}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
    }

    closeExportModal();
  }

  // ═══════════════════════════════════════
  //  REPLY TOAST
  // ═══════════════════════════════════════
  function showReplyToast(data) {
    const existing = document.querySelector('.reply-toast');
    if (existing) existing.remove();
    if (toastTimeout) clearTimeout(toastTimeout);

    const tagEmoji = { hot: '🔥', warm: '☀️', cold: '❄️' };
    const tagLabel = data.tag ? `${tagEmoji[data.tag] || ''} ${capitalize(data.tag)}` : '';

    const toast = document.createElement('div');
    toast.className = 'reply-toast';
    toast.innerHTML = `<span>💬 <strong>${esc(data.leadName || data.phone)}</strong> replied</span>${tagLabel ? `<span class="toast-tag toast-tag--${data.tag}">${tagLabel}</span>` : ''}`;

    toast.addEventListener('click', () => { toast.remove(); document.querySelector('[data-tab="leads"]').click(); });
    document.body.appendChild(toast);
    toastTimeout = setTimeout(() => { if (toast.parentElement) toast.remove(); }, 5000);
  }

  // ═══════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  function statusBadge(status) {
    const labels = { pending: 'Pending', sent: 'Sent', replied: 'Replied', failed: 'Failed', converted: 'Converted', closed: 'Closed' };
    return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
  }

  function tagBadge(tag) {
    if (!tag) return '<span style="color:var(--text-muted);font-size:11px">—</span>';
    const e = { hot: '🔥', warm: '☀️', cold: '❄️' };
    return `<span class="tag-badge tag-badge--${tag}">${e[tag] || ''} ${capitalize(tag)}</span>`;
  }

  function lastActivity(lead) {
    const ts = lead.repliedAt || lead.sentAt || lead.createdAt;
    if (!ts) return '<span style="color:var(--text-muted);font-size:11px">—</span>';
    return `<span style="font-size:11px;color:var(--text-muted)">${timeAgo(ts)}</span>`;
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts; const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function debounce(fn, delay) { let t; return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), delay); }; }

  // ═══════════════════════════════════════
  //  REPLY LISTENER
  // ═══════════════════════════════════════
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'REPLY_NOTIFICATION') {
      showReplyToast(msg);
      const panel = document.getElementById('tab-leads');
      if (panel && panel.classList.contains('active')) { renderPipeline(); renderLeadsTable(); }
    }
  });

  // ═══════════════════════════════════════
  //  EXPOSE
  // ═══════════════════════════════════════
  window.WALeads = {
    init: initLeadsTab, refresh: async () => { await renderPipeline(); await renderLeadsTable(); },
    setupToolbar, setupTagFilters, openExportModal, showReplyToast,
  };
})();
