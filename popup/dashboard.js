/* ═══════════════════════════════════════════════════
   WAuto Pro — Analytics Dashboard (Phase 4)
   Pure SVG charts, KPI cards, funnel, campaign perf
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';
  const DB = window.WAutoDB;

  let currentRange = '7d';
  let autoRefreshTimer = null;
  let timestampTimer = null;
  let lastUpdated = Date.now();

  // ═══════════════════════════════════════
  //  DATE RANGE HELPERS
  // ═══════════════════════════════════════
  function getDateRange() {
    const now = Date.now();
    const dayMs = 86400000;
    switch (currentRange) {
      case 'today': { const s = new Date(); s.setHours(0,0,0,0); return { from: s.getTime(), to: now }; }
      case '7d': return { from: now - 7 * dayMs, to: now };
      case '30d': return { from: now - 30 * dayMs, to: now };
      case 'all': return { from: 0, to: now };
      default: return { from: now - 7 * dayMs, to: now };
    }
  }

  function isDashboardVisible() {
    const panel = document.getElementById('tab-dashboard');
    return !!panel && panel.classList.contains('active');
  }

  // ═══════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════
  async function initDashboard() {
    await refreshDashboard();
    startAutoRefresh();
    startTimestampTicker();
  }

  async function refreshDashboard() {
    try {
      const { from, to } = getDateRange();
      const stats = await DB.getDashboardStats(from, to);
      const retryStats = await DB.getRetryStats();

      renderKPICards(stats);
      renderBarChart(stats.dailyActivity);
      renderFunnel(stats.funnelData);
      renderFollowUpStats(stats.followUpStats);
      renderCampaignTable(stats.campaignPerformance);
      renderErrorStats(retryStats);

      lastUpdated = Date.now();
      updateTimestamp();
    } catch (err) {
      console.error('[WAuto] Dashboard error:', err);
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      if (isDashboardVisible()) refreshDashboard();
    }, 30000);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
    stopTimestampTicker();
  }

  function updateTimestamp() {
    const el = document.getElementById('dash-last-updated');
    if (!el) return;
    const sec = Math.round((Date.now() - lastUpdated) / 1000);
    el.textContent = sec < 5 ? 'just now' : `${sec}s ago`;
  }

  function startTimestampTicker() {
    if (timestampTimer) return;
    timestampTimer = setInterval(() => {
      if (isDashboardVisible()) updateTimestamp();
    }, 5000);
  }

  function stopTimestampTicker() {
    if (timestampTimer) {
      clearInterval(timestampTimer);
      timestampTimer = null;
    }
  }

  // ═══════════════════════════════════════
  //  KPI CARDS
  // ═══════════════════════════════════════
  function renderKPICards(stats) {
    const container = document.getElementById('kpi-grid');
    if (!container) return;

    container.innerHTML = `
      <div class="kpi-card kpi-card--blue">
        <div class="kpi-icon">📤</div>
        <div class="kpi-value">${stats.sent}</div>
        <div class="kpi-label">Total Sent</div>
        <div class="kpi-sub">+${stats.todaySent} today</div>
      </div>
      <div class="kpi-card kpi-card--green">
        <div class="kpi-icon">💬</div>
        <div class="kpi-value">${stats.replyRate}%</div>
        <div class="kpi-label">Reply Rate</div>
        <div class="kpi-sub">${stats.replied} leads replied</div>
      </div>
      <div class="kpi-card kpi-card--gold">
        <div class="kpi-icon">🎓</div>
        <div class="kpi-value">${stats.conversionRate}%</div>
        <div class="kpi-label">Conversion Rate</div>
        <div class="kpi-sub">${stats.converted} enrollments</div>
      </div>
      <div class="kpi-card kpi-card--orange">
        <div class="kpi-icon">🔥</div>
        <div class="kpi-value">${stats.hotLeads + stats.warmLeads}</div>
        <div class="kpi-label">Active Leads</div>
        <div class="kpi-sub">${stats.hotLeads} hot · ${stats.warmLeads} warm</div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  //  SVG BAR CHART
  // ═══════════════════════════════════════
  function renderBarChart(dailyActivity) {
    const container = document.getElementById('bar-chart-container');
    if (!container) return;

    if (!dailyActivity || dailyActivity.length === 0) {
      container.innerHTML = '<div class="dash-empty"><p>No activity data yet</p></div>';
      return;
    }

    const W = 500, H = 160, padL = 35, padR = 10, padT = 10, padB = 30;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const maxVal = Math.max(1, ...dailyActivity.map((d) => Math.max(d.sent, d.replied)));
    const barGroupW = chartW / dailyActivity.length;
    const barW = Math.min(barGroupW * 0.3, 20);
    const gap = 3;

    let bars = '';
    let labels = '';
    let gridLines = '';

    // Y-axis grid lines
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const y = padT + chartH - (i / ySteps) * chartH;
      const val = Math.round((i / ySteps) * maxVal);
      gridLines += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${i === 0 ? 'rgba(90,109,138,0.4)' : 'rgba(90,109,138,0.15)'}" stroke-width="1"/>`;
      gridLines += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#5A6D8A">${val}</text>`;
    }

    dailyActivity.forEach((d, i) => {
      const x = padL + i * barGroupW + barGroupW / 2;

      const sentH = (d.sent / maxVal) * chartH;
      const repliedH = (d.replied / maxVal) * chartH;

      const sentY = padT + chartH - sentH;
      const repliedY = padT + chartH - repliedH;

      bars += `<rect class="chart-bar" x="${x - barW - gap / 2}" y="${sentY}" width="${barW}" height="${sentH}" rx="2" fill="#3B82F6" data-val="Sent: ${d.sent}" data-day="${d.date}"></rect>`;
      bars += `<rect class="chart-bar" x="${x + gap / 2}" y="${repliedY}" width="${barW}" height="${repliedH}" rx="2" fill="#25D366" data-val="Replied: ${d.replied}" data-day="${d.date}"></rect>`;

      labels += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#5A6D8A">${d.date}</text>`;
    });

    container.innerHTML = `
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${gridLines}
        ${bars}
        ${labels}
      </svg>
    `;

    // Tooltips
    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.style.display = 'none';
    container.style.position = 'relative';
    container.appendChild(tooltip);

    container.querySelectorAll('.chart-bar').forEach((bar) => {
      bar.addEventListener('mouseenter', (e) => {
        tooltip.textContent = `${bar.dataset.day}: ${bar.dataset.val}`;
        tooltip.style.display = 'block';
      });
      bar.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        tooltip.style.left = (e.clientX - rect.left + 10) + 'px';
        tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
      });
      bar.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    });
  }

  // ═══════════════════════════════════════
  //  FUNNEL CHART
  // ═══════════════════════════════════════
  function renderFunnel(funnelData) {
    const container = document.getElementById('funnel-container');
    if (!container) return;

    const total = Math.max(1, funnelData.contacted);
    const stages = [
      { key: 'contacted', label: 'Contacted', cls: 'contacted', count: funnelData.contacted },
      { key: 'sent', label: 'Sent', cls: 'sent', count: funnelData.sent },
      { key: 'replied', label: 'Replied', cls: 'replied', count: funnelData.replied },
      { key: 'followedUp', label: 'Follow-up', cls: 'followup', count: funnelData.followedUp },
      { key: 'converted', label: 'Converted', cls: 'converted', count: funnelData.converted },
    ];

    container.innerHTML = stages.map((s) => {
      const pct = Math.max(5, (s.count / total) * 100);
      const pctLabel = total > 0 ? Math.round((s.count / total) * 100) : 0;
      return `
        <div class="funnel-row">
          <span class="funnel-label">${s.label}</span>
          <div class="funnel-bar-track">
            <div class="funnel-bar-fill funnel-bar--${s.cls}" style="width:${pct}%">${pctLabel}%</div>
          </div>
          <span class="funnel-count">${s.count}</span>
        </div>`;
    }).join('');
  }

  // ═══════════════════════════════════════
  //  FOLLOW-UP STATS
  // ═══════════════════════════════════════
  function renderFollowUpStats(fuStats) {
    const container = document.getElementById('fu-stats-container');
    if (!container) return;

    const days = ['d1', 'd2', 'd3'];
    const labels = ['Day 1 (24h)', 'Day 2 (48h)', 'Day 3 (72h)'];

    container.innerHTML = days.map((d, i) => {
      const s = fuStats[d] || { sent: 0, replied: 0 };
      const rate = s.sent > 0 ? ((s.replied / s.sent) * 100).toFixed(1) : '0.0';
      return `
        <div class="fu-stat-box">
          <div class="fu-stat-label">${labels[i]}</div>
          <div class="fu-stat-value">${rate}%</div>
          <div class="fu-stat-detail">${s.replied}/${s.sent} replied</div>
        </div>`;
    }).join('');
  }

  // ═══════════════════════════════════════
  //  CAMPAIGN TABLE
  // ═══════════════════════════════════════
  function renderCampaignTable(campaigns) {
    const tbody = document.getElementById('dash-campaign-tbody');
    if (!tbody) return;

    if (!campaigns || campaigns.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:16px;">No campaigns yet</td></tr>';
      return;
    }

    tbody.innerHTML = campaigns.slice(0, 5).map((c) => `
      <tr>
        <td title="${esc(c.name)}">${esc(c.name)}</td>
        <td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
        <td>${c.sent}</td>
        <td>${c.replied}</td>
        <td><strong>${c.replyRate}%</strong></td>
        <td><span class="badge badge-${c.status}">${c.status}</span></td>
      </tr>
    `).join('');
  }

  // ═══════════════════════════════════════
  //  ERROR STATS
  // ═══════════════════════════════════════
  function renderErrorStats(retryStats) {
    const container = document.getElementById('error-stats-container');
    if (!container) return;

    container.innerHTML = `
      <div class="error-stat-box">
        <div class="kpi-value" style="color:var(--red-500)">${retryStats.exhausted}</div>
        <div class="kpi-label">Permanently Failed</div>
      </div>
      <div class="error-stat-box">
        <div class="kpi-value" style="color:#F59E0B">${retryStats.pending}</div>
        <div class="kpi-label">Pending Retry</div>
      </div>
      <div class="error-stat-box">
        <div class="kpi-value" style="color:var(--emerald-400)">${retryStats.succeeded}</div>
        <div class="kpi-label">Retry Succeeded</div>
      </div>
    `;
  }

  // ═══════════════════════════════════════
  //  DASHBOARD EXPORT
  // ═══════════════════════════════════════
  async function exportDashboardReport() {
    if (typeof XLSX === 'undefined') return;

    const { from, to } = getDateRange();
    const stats = await DB.getDashboardStats(from, to);
    const wb = XLSX.utils.book_new();

    // Sheet 1: Overview
    const overview = [
      ['WAuto Pro — Dashboard Report', '', '', ''],
      ['Exported At', new Date().toISOString()],
      [''], ['KPI', 'Value'],
      ['Total Sent', stats.sent], ['Reply Rate', stats.replyRate + '%'],
      ['Conversion Rate', stats.conversionRate + '%'],
      ['Active Leads (Hot+Warm)', stats.hotLeads + stats.warmLeads],
      ['Hot Leads', stats.hotLeads], ['Warm Leads', stats.warmLeads],
      ['Today Sent', stats.todaySent],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(overview);
    ws1['!cols'] = [{ wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Overview');

    // Sheet 2: Daily Activity
    const dailyData = [['Date', 'Sent', 'Replied'], ...stats.dailyActivity.map((d) => [d.fullDate || d.date, d.sent, d.replied])];
    const ws2 = XLSX.utils.aoa_to_sheet(dailyData);
    ws2['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Daily Activity');

    // Sheet 3: Campaigns
    const campData = [['Name', 'Date', 'Sent', 'Replied', 'Reply Rate', 'Status'], ...stats.campaignPerformance.map((c) => [c.name, c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '', c.sent, c.replied, c.replyRate + '%', c.status])];
    const ws3 = XLSX.utils.aoa_to_sheet(campData);
    ws3['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Campaign Performance');

    XLSX.writeFile(wb, `WAuto_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // ═══════════════════════════════════════
  //  EXPOSE
  // ═══════════════════════════════════════
  window.WADashboard = {
    init: initDashboard,
    refresh: refreshDashboard,
    setRange: (r) => { currentRange = r; refreshDashboard(); },
    exportReport: exportDashboardReport,
    stop: stopAutoRefresh,
  };
})();
