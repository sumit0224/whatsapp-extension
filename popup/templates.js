/* ═══════════════════════════════════════════════════
   WAuto Pro — Template Library Manager (Phase 4)
   CRUD, rotation selection, performance stats
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';
  const DB = window.WAutoDB;

  let editingTemplateId = null;

  // ═══════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════
  async function initTemplates() {
    await renderTemplateGrid();
    await renderLeaderboard();
    setupEditor();
  }

  // ═══════════════════════════════════════
  //  TEMPLATE GRID
  // ═══════════════════════════════════════
  async function renderTemplateGrid() {
    const container = document.getElementById('template-grid');
    if (!container) return;

    const templates = await DB.getTemplates();

    if (templates.length === 0) {
      container.innerHTML = `
        <div class="tpl-empty">
          <p>No saved templates yet.</p>
          <p style="font-size:11px;color:var(--text-muted);">Click "New Template" to create your first one.</p>
        </div>`;
      return;
    }

    container.innerHTML = templates.map((t) => {
      const catBadge = categoryBadge(t.category);
      const preview = (t.body || '').slice(0, 80) + ((t.body || '').length > 80 ? '…' : '');
      const rate = t.usageCount > 0 ? ((t.replyRate || 0)).toFixed(1) : '—';
      return `
        <div class="tpl-card" data-id="${t.id}">
          <div class="tpl-card-header">
            <span class="tpl-card-name">${esc(t.name)}</span>
            ${catBadge}
          </div>
          <p class="tpl-card-preview">${esc(preview)}</p>
          <div class="tpl-card-stats">
            <span>📤 ${t.usageCount || 0} sent</span>
            <span>💬 ${rate}% reply</span>
          </div>
          <div class="tpl-card-actions">
            <button class="btn btn-ghost btn-sm tpl-edit-btn" data-id="${t.id}">Edit</button>
            <button class="btn btn-ghost btn-sm tpl-dup-btn" data-id="${t.id}">Duplicate</button>
            <button class="btn btn-ghost btn-sm tpl-del-btn" data-id="${t.id}" style="color:var(--red-500)">Delete</button>
            <button class="btn btn-outline btn-sm tpl-use-btn" data-id="${t.id}">Use in Campaign</button>
          </div>
        </div>`;
    }).join('');

    // Wire actions
    container.querySelectorAll('.tpl-edit-btn').forEach((b) => b.addEventListener('click', () => editTemplate(parseInt(b.dataset.id, 10))));
    container.querySelectorAll('.tpl-dup-btn').forEach((b) => b.addEventListener('click', () => duplicateTemplate(parseInt(b.dataset.id, 10))));
    container.querySelectorAll('.tpl-del-btn').forEach((b) => b.addEventListener('click', () => deleteTemplateHandler(parseInt(b.dataset.id, 10))));
    container.querySelectorAll('.tpl-use-btn').forEach((b) => b.addEventListener('click', () => useInCampaign(parseInt(b.dataset.id, 10))));
  }

  // ═══════════════════════════════════════
  //  TEMPLATE EDITOR
  // ═══════════════════════════════════════
  function setupEditor() {
    const newBtn = document.getElementById('btn-new-template');
    const saveBtn = document.getElementById('btn-save-template');
    const cancelBtn = document.getElementById('btn-cancel-template');

    if (newBtn) newBtn.addEventListener('click', openNewEditor);
    if (saveBtn) saveBtn.addEventListener('click', saveTemplateHandler);
    if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);

    // Variable buttons in template editor
    document.querySelectorAll('.tpl-var-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const textarea = document.getElementById('tpl-editor-body');
        if (!textarea) return;
        const v = btn.dataset.var;
        const start = textarea.selectionStart;
        textarea.value = textarea.value.slice(0, start) + v + textarea.value.slice(textarea.selectionEnd);
        textarea.selectionStart = textarea.selectionEnd = start + v.length;
        textarea.focus();
        updateCharCount();
      });
    });

    const bodyEl = document.getElementById('tpl-editor-body');
    if (bodyEl) bodyEl.addEventListener('input', updateCharCount);
  }

  function openNewEditor() {
    editingTemplateId = null;
    const panel = document.getElementById('tpl-editor-panel');
    const nameEl = document.getElementById('tpl-editor-name');
    const catEl = document.getElementById('tpl-editor-category');
    const bodyEl = document.getElementById('tpl-editor-body');

    if (nameEl) nameEl.value = '';
    if (catEl) catEl.value = 'initial';
    if (bodyEl) bodyEl.value = '';
    updateCharCount();

    if (panel) panel.classList.remove('hidden');
    document.getElementById('tpl-editor-title').textContent = 'New Template';
  }

  async function editTemplate(id) {
    const tpl = await DB.getTemplateById(id);
    if (!tpl) return;

    editingTemplateId = id;
    const panel = document.getElementById('tpl-editor-panel');
    document.getElementById('tpl-editor-name').value = tpl.name || '';
    document.getElementById('tpl-editor-category').value = tpl.category || 'initial';
    document.getElementById('tpl-editor-body').value = tpl.body || '';
    updateCharCount();

    if (panel) panel.classList.remove('hidden');
    document.getElementById('tpl-editor-title').textContent = 'Edit Template';
  }

  async function saveTemplateHandler() {
    const name = document.getElementById('tpl-editor-name').value.trim();
    const category = document.getElementById('tpl-editor-category').value;
    const body = document.getElementById('tpl-editor-body').value.trim();

    if (!name) { alert('Please enter a template name.'); return; }
    if (!body) { alert('Please enter a message body.'); return; }

    if (editingTemplateId) {
      await DB.updateTemplate(editingTemplateId, { name, category, body });
    } else {
      await DB.saveTemplate({ name, category, body });
    }

    closeEditor();
    await renderTemplateGrid();
    await renderLeaderboard();
  }

  function closeEditor() {
    const panel = document.getElementById('tpl-editor-panel');
    if (panel) panel.classList.add('hidden');
    editingTemplateId = null;
  }

  async function duplicateTemplate(id) {
    const tpl = await DB.getTemplateById(id);
    if (!tpl) return;
    await DB.saveTemplate({ name: tpl.name + ' (Copy)', category: tpl.category, body: tpl.body });
    await renderTemplateGrid();
  }

  async function deleteTemplateHandler(id) {
    if (!confirm('Delete this template?')) return;
    await DB.deleteTemplate(id);
    await renderTemplateGrid();
    await renderLeaderboard();
  }

  async function useInCampaign(id) {
    const tpl = await DB.getTemplateById(id);
    if (!tpl) return;

    // Switch to campaign tab and set template
    const templateInput = document.getElementById('template-input');
    if (templateInput) templateInput.value = tpl.body;

    // Save to storage
    chrome.storage.local.set({ savedTemplate: tpl.body });

    // Switch tab
    document.querySelector('[data-tab="campaign"]').click();
  }

  function updateCharCount() {
    const bodyEl = document.getElementById('tpl-editor-body');
    const countEl = document.getElementById('tpl-char-count');
    if (!bodyEl || !countEl) return;
    const len = bodyEl.value.length;
    countEl.textContent = `${len} / 4096`;
    countEl.style.color = len > 4096 ? 'var(--red-500)' : 'var(--text-muted)';
  }

  // ═══════════════════════════════════════
  //  LEADERBOARD
  // ═══════════════════════════════════════
  async function renderLeaderboard() {
    const tbody = document.getElementById('tpl-leaderboard-tbody');
    if (!tbody) return;

    const templates = await DB.getTemplates();
    const sorted = templates.filter((t) => t.usageCount > 0).sort((a, b) => (b.replyRate || 0) - (a.replyRate || 0)).slice(0, 5);

    if (sorted.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:12px;">No usage data yet</td></tr>';
      return;
    }

    tbody.innerHTML = sorted.map((t, i) => {
      const rate = (t.replyRate || 0).toFixed(1);
      return `
        <tr>
          <td>${i + 1}</td>
          <td title="${esc(t.name)}">${esc(t.name)}</td>
          <td>${t.usageCount || 0}</td>
          <td>${Math.round((t.usageCount || 0) * (t.replyRate || 0) / 100)}</td>
          <td><strong>${rate}%</strong></td>
        </tr>`;
    }).join('');
  }

  // ═══════════════════════════════════════
  //  ROTATION SELECTOR
  // ═══════════════════════════════════════
  async function renderRotationSelector() {
    const container = document.getElementById('rotate-template-list');
    if (!container) return;

    const templates = await DB.getTemplates();
    if (templates.length === 0) {
      container.innerHTML = '<p style="font-size:11px;color:var(--text-muted);">No saved templates. Create some in the Templates tab.</p>';
      return;
    }

    container.innerHTML = templates.map((t) => `
      <label class="checkbox-row" style="margin-bottom:4px;">
        <input type="checkbox" class="rotate-tpl-chk" data-id="${t.id}">
        <span>${esc(t.name)} <small style="color:var(--text-muted)">(${t.category})</small></span>
      </label>
    `).join('');
  }

  function categoryBadge(cat) {
    const colors = { initial: '#3B82F6', followup: '#F59E0B', reminder: '#8B5CF6', custom: '#6B7280' };
    const c = colors[cat] || colors.custom;
    return `<span class="tag-badge" style="background:${c}22;color:${c}">${cat}</span>`;
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  window.WATemplates = { init: initTemplates, refresh: renderTemplateGrid, renderRotationSelector };
})();
