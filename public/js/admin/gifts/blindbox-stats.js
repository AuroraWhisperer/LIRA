import { giftAnalysis } from './blindbox-analysis.js';
import { eventBus, Events } from '../../shared/event-bus.js';
import { escapeHtml, escapeAttr } from '../../shared/html-escape.js';
import { formatMoney } from '../../shared/display-format.js';
import { readJsonResponse } from '../../shared/json-response.js';

let disposeStats = null;

export function initBlindBoxStats() {
  if (disposeStats) return disposeStats;
  let blindBoxStatsDirty = true;
  let blindBoxStatsController = null;
  let blindBoxStatsDisposed = false;

  function isBlindBoxStatsVisible() {
    const page = document.getElementById('giftAssistantPage');
    const section = document.querySelector('.gift-blindbox-panel');
    const workspace = document.getElementById('blindBoxAnalysisWorkspace');
    return !blindBoxStatsDisposed && !document.hidden && page?.classList.contains('active') &&
      !section?.classList.contains('is-collapsed') && (!workspace || workspace.hidden);
  }

  function syncBlindBoxStatsVisibility() {
    if (!isBlindBoxStatsVisible()) {
      blindBoxStatsDirty = true;
      blindBoxStatsController?.abort();
      blindBoxStatsController = null;
      return;
    }
    void refreshBlindBoxStats();
  }

  /**
   * 加载盲盒统计数据
   */
  function loadBlindBoxStats({ reason } = {}) {
    blindBoxStatsDirty = true;
    if (reason === 'gift:source' || reason === 'connect') {
      blindBoxStatsController?.abort();
      blindBoxStatsController = null;
      if (section) section.dataset.state = 'loading';
      const summary = document.getElementById('blindBoxStatsSummary');
      if (summary) summary.innerHTML = '<div class="blind-stats-status" role="status">正在加载统计…</div>';
      const body = document.getElementById('blindBoxStatsBody');
      if (body) body.innerHTML = '';
    }
    return refreshBlindBoxStats();
  }

  async function refreshBlindBoxStats() {
    if (!blindBoxStatsDirty || blindBoxStatsController || !isBlindBoxStatsVisible()) return;
    blindBoxStatsDirty = false;
    const controller = new AbortController();
    blindBoxStatsController = controller;
    try {
      const response = await fetch('/api/gifts/blind-box-stats?top=10', { signal: controller.signal });
      const payload = await readJsonResponse(response, '盲盒统计加载失败');
      if (controller !== blindBoxStatsController) return;
      if (!isBlindBoxStatsVisible()) { blindBoxStatsDirty = true; return; }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `盲盒统计加载失败（HTTP ${response.status}）`);
      }
      renderBlindBoxStats(payload.data);
    } catch (error) {
      if (controller !== blindBoxStatsController) return;
      if (!isBlindBoxStatsVisible()) { blindBoxStatsDirty = true; return; }
      const summary = document.getElementById('blindBoxStatsSummary');
      const section = summary && summary.closest('.gift-blindbox-panel');
      if (section) section.dataset.state = 'error';
      if (summary) {
        summary.innerHTML = `
          <div class="blind-stats-status is-error" role="status">
            <span class="blind-stats-status-icon" aria-hidden="true">!</span>
            <strong>统计加载失败</strong>
            <span>请稍后重试</span>
          </div>
        `;
      }
      const body = document.getElementById('blindBoxStatsBody');
      if (body) body.innerHTML = '<tr><td colspan="6" class="empty">加载失败</td></tr>';
    } finally {
      if (controller === blindBoxStatsController) {
        blindBoxStatsController = null;
        if (blindBoxStatsDirty) void refreshBlindBoxStats();
      }
    }
  }

  /**
   * 渲染盲盒统计数据
   * @param {Object} stats - 统计数据
   */
  function renderBlindBoxStats(stats) {
    if (!stats) return;

    const { summary, perUser } = stats;

    // 汇总行
    const summaryEl = document.getElementById('blindBoxStatsSummary');
    const section = summaryEl && summaryEl.closest('.gift-blindbox-panel');
    if (summaryEl) {
      if (!summary || summary.boxCount === 0) {
        if (section) section.dataset.state = 'empty';
        summaryEl.innerHTML = `
          <div class="blind-stats-status" role="status">
            <span class="blind-stats-status-icon" aria-hidden="true">◇</span>
            <strong>今天还没有盲盒礼物</strong>
            <span>收到盲盒后，这里会自动汇总成本、开出价值和盈亏</span>
          </div>
        `;
      } else {
        const profitSign = summary.totalProfit > 0 ? '+' : summary.totalProfit < 0 ? '-' : '';
        const profitClass = summary.totalProfit > 0 ? 'profit-up' : summary.totalProfit < 0 ? 'profit-down' : '';
        if (section) section.dataset.state = 'ready';
        summaryEl.innerHTML = `
          <div class="stats-summary-row">
            <div class="stat-chip">
              <span class="stat-chip-icon">盒</span>
              <span class="stat-chip-copy"><small>盲盒数量</small><strong>${summary.boxCount}</strong></span>
            </div>
            <div class="stat-chip">
              <span class="stat-chip-icon">¥</span>
              <span class="stat-chip-copy"><small>总成本</small><strong>${formatMoney(summary.totalCost)}</strong></span>
            </div>
            <div class="stat-chip">
              <span class="stat-chip-icon">礼</span>
              <span class="stat-chip-copy"><small>开出价值</small><strong>${formatMoney(summary.totalValue)}</strong></span>
            </div>
            <div class="stat-chip ${profitClass}">
              <span class="stat-chip-icon">${summary.totalProfit >= 0 ? '↗' : '↘'}</span>
              <span class="stat-chip-copy"><small>观众盈亏</small><strong>${profitSign}${formatMoney(Math.abs(summary.totalProfit))}</strong></span>
            </div>
          </div>
        `;
      }
    }

    // 首页只展示按观众汇总；完整记录放在独立分析工作区。
    const body = document.getElementById('blindBoxStatsBody');
    if (!body) return;

    const users = Array.isArray(perUser) ? perUser : [];
    if (users.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="empty">暂无数据</td></tr>';
      return;
    }

    body.innerHTML = users
      .slice(0, 10)
      .map((user) => {
        const profitSign = user.totalProfit > 0 ? '+' : user.totalProfit < 0 ? '-' : '';
        const profitClass = user.totalProfit > 0 ? 'profit-up' : user.totalProfit < 0 ? 'profit-down' : '';
        return `
        <tr class="blind-stats-user-row" tabindex="0" data-viewer="${escapeAttr(user.viewer || '')}" title="查看${escapeAttr(user.userName || '观众')}的开盒记录">
          <td class="user-cell">${escapeHtml(user.userName || '观众')}</td>
          <td>${Number(user.boxCount || 0)}</td>
          <td>${Number(user.boxTypeCount || 0)} 种</td>
          <td>${formatMoney(user.totalCost)}</td>
          <td>${formatMoney(user.totalValue)}</td>
          <td class="${profitClass}">${profitSign}${formatMoney(Math.abs(user.totalProfit))}</td>
        </tr>
      `;
      })
      .join('');
  }

  const section = document.querySelector('.gift-blindbox-panel');
  const toggle = document.getElementById('blindBoxStatsToggle');
  const panelHeader = section?.querySelector('.panel-header');
  const content = document.getElementById('blindBoxStatsCollapsible');

  const setCollapsed = (collapsed) => {
    if (collapsed && content?.contains(document.activeElement)) toggle?.focus();
    section?.classList.toggle('is-collapsed', collapsed);
    if (content) {
      content.inert = collapsed;
      content.setAttribute('aria-hidden', String(collapsed));
    }
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.title = collapsed ? '展开盲盒盈亏' : '折叠盲盒盈亏';
    }
  };
  setCollapsed(section?.classList.contains('is-collapsed') || false);
  const onHeaderClick = (e) => {
    if (e.target.closest('#blindBoxAnalysisOpenBtn')) return;
    setCollapsed(!section.classList.contains('is-collapsed'));
  };
  const openButton = document.getElementById('blindBoxAnalysisOpenBtn');
  const body = document.getElementById('blindBoxStatsBody');
  const onOpenAnalysis = () => giftAnalysis.open({ view: 'users' });
  const onRowClick = (event) => {
    const row = event.target.closest('[data-viewer]');
    if (row)
      giftAnalysis.open({
        viewer: row.dataset.viewer,
        view: 'records',
      });
  };

  const onRowKeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('[data-viewer]');
    if (!row) return;
    event.preventDefault();
    giftAnalysis.open({
      viewer: row.dataset.viewer,
      view: 'records',
    });
  };
  panelHeader?.addEventListener('click', onHeaderClick);
  openButton?.addEventListener('click', onOpenAnalysis);
  body?.addEventListener('click', onRowClick);
  body?.addEventListener('keydown', onRowKeydown);

  const observer = new MutationObserver(syncBlindBoxStatsVisibility);
  for (const element of [section, document.getElementById('giftAssistantPage')]) {
    if (element) observer.observe(element, { attributes: true, attributeFilter: ['class'] });
  }
  const workspace = document.getElementById('blindBoxAnalysisWorkspace');
  if (workspace) observer.observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', syncBlindBoxStatsVisibility);
  const unsubscribe = eventBus.on(Events.GIFT_RECEIVED, loadBlindBoxStats);
  const dispose = () => {
    if (blindBoxStatsDisposed) return;
    blindBoxStatsDisposed = true;
    unsubscribe();
    observer.disconnect();
    document.removeEventListener('visibilitychange', syncBlindBoxStatsVisibility);
    blindBoxStatsController?.abort();
    blindBoxStatsController = null;
    panelHeader?.removeEventListener('click', onHeaderClick);
    openButton?.removeEventListener('click', onOpenAnalysis);
    body?.removeEventListener('click', onRowClick);
    body?.removeEventListener('keydown', onRowKeydown);
    disposeStats = null;
  };
  disposeStats = dispose;
  syncBlindBoxStatsVisibility();
  return dispose;
}
