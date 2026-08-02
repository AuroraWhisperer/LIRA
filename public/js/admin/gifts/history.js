// 编写人：Aurora
// 礼物历史模块 - 负责礼物历史抽屉和流水查询
'use strict';

(function () {
  const {
    escapeHtml,
    escapeAttr,
    formatTime,
    formatDateTime,
    formatMoney,
    toast,
    readJsonResponse,
    dangerConfirm
  } = window.AdminApp.utils;

  const GIFT_HISTORY_LIMIT = 50;
  let giftHistory = { page: 1, limit: GIFT_HISTORY_LIMIT, total: 0, totalPages: 1, items: [] };
  let giftHistorySeq = 0;
  let giftHistorySort = { field: 'created_at', direction: 'desc' };

  /**
   * 初始化礼物历史抽屉事件监听
   */
  function initGiftHistoryDrawer() {
    const openBtn = document.getElementById('giftHistoryOpenBtn');
    const closeBtn = document.getElementById('giftHistoryClose');
    const backdrop = document.getElementById('giftHistoryBackdrop');

    openBtn && openBtn.addEventListener('click', () => {
      giftHistory.page = 1;
      openGiftHistoryDrawer();
      loadGiftHistory(1);
    });
    closeBtn && closeBtn.addEventListener('click', closeGiftHistoryDrawer);
    backdrop && backdrop.addEventListener('click', closeGiftHistoryDrawer);

    const clearDisplayBtn = document.getElementById('giftHistoryClearDisplayBtn');
    const clearDatabaseBtn = document.getElementById('giftHistoryClearDatabaseBtn');

    clearDisplayBtn && clearDisplayBtn.addEventListener('click', async () => {
      const confirmed = await dangerConfirm({
        title: '清理显示',
        message: '将清理抽屉中显示的最近3000条礼物记录。更早的记录仍保留在数据库中。此操作无法恢复。',
        confirmLabel: '确认清理'
      });
      if (!confirmed) return;
      try {
        const response = await fetch('/api/gifts/clear-recent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true })
        });
        const payload = await readJsonResponse(response, '清理显示失败');
        if (!payload.ok) throw new Error(payload.error || '清理失败');
        toast(`已清理 ${payload.data.deletedCount} 条显示记录`);
        giftHistory = { page: 1, limit: GIFT_HISTORY_LIMIT, total: 0, totalPages: 1, items: [] };
        renderGiftHistory();
        if (window.AdminApp.state && window.AdminApp.state.reloadState) {
          window.AdminApp.state.reloadState();
        }
      } catch (error) {
        toast(error.message || '清理显示失败');
      }
    });

    clearDatabaseBtn && clearDatabaseBtn.addEventListener('click', async () => {
      const confirmed = await dangerConfirm({
        title: '清空数据库礼物记录',
        message: '此操作将永久删除数据库中的所有礼物流水（包括显示的和不显示的），无法恢复。',
        confirmLabel: '确认清空'
      });
      if (!confirmed) return;
      try {
        const response = await fetch('/api/database/clear-gifts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true })
        });
        const payload = await readJsonResponse(response, '清空礼物失败');
        if (!payload.ok) throw new Error(payload.error || '清空失败');
        toast('已清空全部礼物记录');
        giftHistory = { page: 1, limit: GIFT_HISTORY_LIMIT, total: 0, totalPages: 1, items: [] };
        renderGiftHistory();
        if (window.AdminApp.state && window.AdminApp.state.reloadState) {
          window.AdminApp.state.reloadState();
        }
      } catch (error) {
        toast(error.message || '清空礼物失败');
      }
    });

    const prevBtn = document.getElementById('giftHistoryPrev');
    const nextBtn = document.getElementById('giftHistoryNext');
    prevBtn && prevBtn.addEventListener('click', () => {
      if (giftHistory.page > 1) loadGiftHistory(giftHistory.page - 1);
    });
    nextBtn && nextBtn.addEventListener('click', () => {
      if (giftHistory.page < giftHistory.totalPages) loadGiftHistory(giftHistory.page + 1);
    });

    // 可排序列点击
    document.querySelectorAll('#giftHistoryDrawer th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (!field) return;
        if (giftHistorySort.field === field) {
          giftHistorySort.direction = giftHistorySort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          giftHistorySort.field = field;
          giftHistorySort.direction = 'asc';
        }
        // 重新从第一页加载（后端排序）
        giftHistory.page = 1;
        loadGiftHistory(1);
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeGiftHistoryDrawer();
    });
  }

  /**
   * 打开礼物历史抽屉
   */
  function openGiftHistoryDrawer() {
    const drawer = document.getElementById('giftHistoryDrawer');
    const backdrop = document.getElementById('giftHistoryBackdrop');
    drawer && drawer.classList.add('open');
    backdrop && backdrop.classList.add('open');
  }

  /**
   * 关闭礼物历史抽屉
   */
  function closeGiftHistoryDrawer() {
    const drawer = document.getElementById('giftHistoryDrawer');
    const backdrop = document.getElementById('giftHistoryBackdrop');
    drawer && drawer.classList.remove('open');
    backdrop && backdrop.classList.remove('open');
  }

  /**
   * 加载礼物历史数据
   * @param {number} page - 页码
   */
  async function loadGiftHistory(page) {
    const seq = ++giftHistorySeq;
    const body = document.getElementById('giftHistoryBody');
    if (body) body.innerHTML = '<tr><td colspan="6" class="empty">加载中…</td></tr>';

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(GIFT_HISTORY_LIMIT),
        sortField: giftHistorySort.field,
        sortDirection: giftHistorySort.direction
      });
      const response = await fetch(`/api/gifts/history?${params}`);
      const payload = await readJsonResponse(response, '礼物流水加载失败');
      if (!response.ok || !payload.ok) throw new Error(payload.error || `礼物流水加载失败（HTTP ${response.status}）`);
      if (seq !== giftHistorySeq) return;
      giftHistory = { ...giftHistory, ...payload.data };
      renderGiftHistory();
    } catch (error) {
      if (seq !== giftHistorySeq) return;
      if (body) body.innerHTML = `<tr><td colspan="6" class="empty">加载失败：${escapeHtml(error.message)}</td></tr>`;
    }
  }

  /**
   * 渲染礼物历史列表
   */
  function renderGiftHistory() {
    const totalEl = document.getElementById('giftHistoryTotal');
    const body = document.getElementById('giftHistoryBody');
    if (totalEl) totalEl.textContent = `共 ${giftHistory.total} 条`;

    if (!giftHistory.items || giftHistory.items.length === 0) {
      if (body) body.innerHTML = '<tr><td colspan="6" class="empty">暂无礼物记录</td></tr>';
    } else {
      if (body) body.innerHTML = giftHistory.items.map(renderGiftHistoryRow).join('');
    }

    // 排序箭头
    document.querySelectorAll('#giftHistoryDrawer th[data-sort]').forEach(th => {
      const arrow = th.querySelector('.sort-arrow');
      if (!arrow) return;
      if (th.dataset.sort === giftHistorySort.field) {
        arrow.textContent = giftHistorySort.direction === 'asc' ? ' ▲' : ' ▼';
      } else {
        arrow.textContent = '';
      }
    });

    const prev = document.getElementById('giftHistoryPrev');
    const next = document.getElementById('giftHistoryNext');
    const info = document.getElementById('giftHistoryPageInfo');
    if (prev) prev.disabled = giftHistory.page <= 1;
    if (next) next.disabled = giftHistory.page >= giftHistory.totalPages;
    if (info) info.textContent = `第 ${giftHistory.page}/${giftHistory.totalPages} 页`;
  }

  /**
   * 渲染礼物历史单行
   * @param {Object} item - 礼物项
   * @returns {string} HTML 字符串
   */
  function renderGiftHistoryRow(item) {
    // 使用 recent 模块的工具函数
    const getGuardBadge = window.AdminApp.gifts.recent.getGuardBadge;
    const getBlindBoxIcon = window.AdminApp.gifts.recent.getBlindBoxIcon;

    const price = item.sprint_count_price ?? item.total_price;
    const guardBadge = getGuardBadge(item);
    const blindBoxIcon = getBlindBoxIcon(item);
    const remarks = [];
    if (guardBadge) {
      remarks.push(`<span class="gift-remark-tag guard"><img class="gift-guard-icon" src="${escapeAttr(guardBadge.src)}" alt="${escapeAttr(guardBadge.name)}" style="width:16px;height:16px;vertical-align:middle" loading="lazy"> ${escapeHtml(guardBadge.name)}</span>`);
    }
    if (item.is_blind_box) {
      const blindProfit = item.blind_profit;
      const profitSign = blindProfit > 0 ? '+' : '';
      const profitClass = blindProfit > 0 ? 'profit-up' : blindProfit < 0 ? 'profit-down' : '';
      const iconHtml = blindBoxIcon
        ? `<img class="gift-blind-box-icon" src="${escapeAttr(blindBoxIcon.src)}" alt="${escapeAttr(blindBoxIcon.name)}" style="width:16px;height:16px;vertical-align:middle" loading="lazy">`
        : '🎁';
      remarks.push(`<span class="gift-remark-tag blind">${iconHtml} 盲盒 ${profitSign}${formatMoney(blindProfit || 0)}</span>`);
    }
    return `
      <tr>
        <td>${formatDateTime(item.created_at)}</td>
        <td class="gift-name-cell" title="${escapeAttr(item.gift_name || '')}">${escapeHtml(item.gift_name || '未知礼物')}</td>
        <td>${Number(item.num || 1)}</td>
        <td>${formatMoney(price)}</td>
        <td class="gift-user-cell" title="${escapeAttr(item.user_name || '')}">${escapeHtml(item.user_name || '观众')}</td>
        <td>${remarks.length ? remarks.join(' ') : '<span class="hint">—</span>'}</td>
      </tr>
    `;
  }

  /**
   * 初始化最近礼物面板折叠功能
   */
  function initGiftRecentToggle() {
    const section = document.querySelector('.gift-recent-panel');
    const toggle = document.getElementById('giftRecentToggle');
    const panelHeader = section?.querySelector('.panel-header');

    panelHeader?.addEventListener('click', (e) => {
      // 排除点击"查看全部"按钮的情况
      if (e.target.closest('#giftHistoryOpenBtn')) return;

      const collapsed = section?.classList.toggle('is-collapsed') || false;
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.title = collapsed ? '展开最近礼物' : '折叠最近礼物';
      }
    });
  }

  // 在 DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGiftRecentToggle);
  } else {
    initGiftRecentToggle();
  }

  // 导出
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts.history = {
    initGiftHistoryDrawer,
    openGiftHistoryDrawer,
    closeGiftHistoryDrawer,
    loadGiftHistory,
    initGiftRecentToggle
  };
})();
