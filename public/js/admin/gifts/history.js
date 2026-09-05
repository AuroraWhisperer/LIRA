// 编写人：Aurora
// 礼物流水抽屉：活动来源的逐行历史与同步完整性状态。
'use strict';

import {
  dangerConfirm,
  escapeAttr,
  escapeHtml,
  formatDateTime,
  formatMoney,
  readJsonResponse,
  toast,
} from '../../shared/utils.js';

const GIFT_HISTORY_LIMIT = 50;

let initialized = false;
let historyRequestSequence = 0;
let previousFocus = null;
const giftLedgerState = createGiftLedgerState();

export function createGiftLedgerState() {
  return {
    cursor: null,
    nextCursor: null,
    cursorHistory: [],
    page: 1,
    items: [],
    hasMore: false,
  };
}

export function resetGiftLedgerDisplay(state) {
  resetGiftLedgerPagination(state);
}

export function buildGiftHistoryUrl({
  cursor = null,
  limit = GIFT_HISTORY_LIMIT,
} = {}) {
  const params = new URLSearchParams();
  params.set('range', 'all');
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  return `/api/gifts/history?${params}`;
}

export function initGiftHistoryDrawer() {
  if (initialized) return;
  initialized = true;

  const openButton = get('giftHistoryOpenBtn');
  const closeButton = get('giftHistoryClose');
  const backdrop = get('giftHistoryBackdrop');
  const clearDisplayButton = get('giftHistoryClearDisplayBtn');
  const clearDatabaseButton = get('giftHistoryClearDatabaseBtn');
  const previousButton = get('giftHistoryPrev');
  const nextButton = get('giftHistoryNext');

  openButton?.addEventListener('click', () => {
    previousFocus = openButton;
    resetGiftLedgerPagination(giftLedgerState);
    openGiftHistoryDrawer();
    loadGiftHistory();
  });
  closeButton?.addEventListener('click', closeGiftHistoryDrawer);
  backdrop?.addEventListener('click', closeGiftHistoryDrawer);

  clearDisplayButton?.addEventListener('click', () => {
    historyRequestSequence += 1;
    resetGiftLedgerDisplay(giftLedgerState);
    renderGiftHistory();
    setText('giftHistoryState', '已清理显示');
    setHistoryBody('<tr><td colspan="6" class="empty">已清理显示</td></tr>');
    const syncStatus = get('giftLedgerSyncStatus');
    if (syncStatus) syncStatus.hidden = true;
  });

  clearDatabaseButton?.addEventListener('click', clearGiftDatabase);

  previousButton?.addEventListener('click', () => {
    if (giftLedgerState.cursorHistory.length === 0) return;
    giftLedgerState.cursor = giftLedgerState.cursorHistory.pop() ?? null;
    giftLedgerState.page = Math.max(1, giftLedgerState.page - 1);
    loadGiftHistory();
  });
  nextButton?.addEventListener('click', () => {
    if (!giftLedgerState.hasMore || !giftLedgerState.nextCursor) return;
    giftLedgerState.cursorHistory.push(giftLedgerState.cursor);
    giftLedgerState.cursor = giftLedgerState.nextCursor;
    giftLedgerState.page += 1;
    loadGiftHistory();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isGiftHistoryOpen()) {
      closeGiftHistoryDrawer();
    }
  });

  initGiftRecentToggle();
}

export function openGiftHistoryDrawer() {
  get('giftHistoryDrawer')?.classList.add('open');
  get('giftHistoryBackdrop')?.classList.add('open');
  get('giftHistoryClose')?.focus();
}

export function closeGiftHistoryDrawer() {
  historyRequestSequence += 1;
  get('giftHistoryDrawer')?.classList.remove('open');
  get('giftHistoryBackdrop')?.classList.remove('open');
  previousFocus?.focus?.();
  previousFocus = null;
}

export async function loadGiftHistory() {
  const sequence = ++historyRequestSequence;
  renderHistoryLoading();

  try {
    const response = await fetch(
      buildGiftHistoryUrl({
        cursor: giftLedgerState.cursor,
        limit: GIFT_HISTORY_LIMIT,
      }),
    );
    const payload = await readJsonResponse(response, '礼物流水加载失败');
    if (!response.ok || !payload.ok) {
      throw new Error(
        payload.error || `礼物流水加载失败（HTTP ${response.status}）`,
      );
    }
    if (sequence !== historyRequestSequence) return;

    const data = payload.data || {};
    giftLedgerState.items = Array.isArray(data.items) ? data.items : [];
    giftLedgerState.nextCursor = data.nextCursor || null;
    giftLedgerState.hasMore = data.hasMore === true;
    renderGiftHistory();
    renderSyncStatus(data);
  } catch (error) {
    if (sequence !== historyRequestSequence) return;
    renderHistoryError(error);
    renderSyncError(error);
  }
}

function resetGiftLedgerPagination(state) {
  state.cursor = null;
  state.nextCursor = null;
  state.cursorHistory.length = 0;
  state.page = 1;
  state.items = [];
  state.hasMore = false;
}

async function clearGiftDatabase() {
  const confirmed = await dangerConfirm({
    title: '清空数据库礼物记录',
    message:
      '此操作会删除全部礼物流水并重新同步当前账号的历史记录。同步完成前历史记录可能不完整。',
    confirmLabel: '确认清空',
  });
  if (!confirmed) return;

  try {
    const response = await fetch('/api/database/clear-gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    const payload = await readJsonResponse(response, '清空礼物失败');
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '清空礼物失败');
    }
    toast('礼物数据库已清空，正在重新同步');
    resetGiftLedgerPagination(giftLedgerState);
    loadGiftHistory();
  } catch (error) {
    toast(error.message || '清空礼物失败');
  }
}

function renderHistoryLoading() {
  const syncStatus = get('giftLedgerSyncStatus');
  if (syncStatus) syncStatus.hidden = true;
  setText('giftHistoryState', '正在加载…');
  setText('giftHistoryTotal', '正在加载');
  setHistoryBody('<tr><td colspan="6" class="empty">加载中…</td></tr>');
  updatePagination(true);
}

function renderHistoryError(error) {
  setText('giftHistoryState', '加载失败');
  setText('giftHistoryTotal', '读取失败');
  setHistoryBody(
    `<tr><td colspan="6" class="empty">${escapeHtml(error.message || '礼物流水加载失败')}</td></tr>`,
  );
  updatePagination(true);
}

function renderGiftHistory() {
  const items = giftLedgerState.items;
  setText('giftHistoryTotal', `本页 ${items.length} 条`);
  setText(
    'giftHistoryState',
    items.length === 0 ? '暂无礼物记录' : '已加载',
  );
  setHistoryBody(
    items.length === 0
      ? '<tr><td colspan="6" class="empty">暂无礼物记录</td></tr>'
      : items.map(renderGiftHistoryRow).join(''),
  );
  updatePagination(false);
}

function renderGiftHistoryRow(item) {
  const gift = item?.gift || {};
  const price = Number(gift.totalPrice || 0);
  const blindProfit = gift.blindProfit;
  const remarks = [];
  if (gift.isBlindBox) {
    if (blindProfit === null || blindProfit === undefined) {
      remarks.push(
        '<span class="gift-remark-tag blind">盲盒 成本未知</span>',
      );
    } else {
      const profitSign = blindProfit > 0 ? '+' : blindProfit < 0 ? '-' : '';
      const profitClass =
        blindProfit > 0 ? 'profit-up' : blindProfit < 0 ? 'profit-down' : '';
      remarks.push(
        `<span class="gift-remark-tag blind ${profitClass}">盲盒 ${profitSign}${formatMoney(Math.abs(Number(blindProfit) || 0))}</span>`,
      );
    }
  }
  if (gift.blindBoxName) {
    remarks.push(
      `<span class="gift-remark-tag">${escapeHtml(gift.blindBoxName)}</span>`,
    );
  }

  return `
    <tr data-event-id="${escapeAttr(item?.eventId || '')}">
      <td>${formatDateTime(gift.createdAt)}</td>
      <td class="gift-name-cell" title="${escapeAttr(gift.giftName || '')}">${escapeHtml(gift.giftName || '未知礼物')}</td>
      <td>${Number(gift.num || 1)}</td>
      <td>${formatMoney(price)}</td>
      <td class="gift-user-cell" title="${escapeAttr(gift.userName || '')}">${escapeHtml(gift.userName || '观众')}</td>
      <td>${remarks.length ? remarks.join(' ') : '<span class="hint">—</span>'}</td>
    </tr>
  `;
}

function updatePagination(loading) {
  const previousButton = get('giftHistoryPrev');
  const nextButton = get('giftHistoryNext');
  if (previousButton) {
    previousButton.disabled =
      loading || giftLedgerState.cursorHistory.length === 0;
  }
  if (nextButton) {
    nextButton.disabled =
      loading || !giftLedgerState.hasMore || !giftLedgerState.nextCursor;
  }
  setText('giftHistoryPageInfo', `第 ${giftLedgerState.page} 页`);
}

function renderSyncStatus(data) {
  const element = get('giftLedgerSyncStatus');
  if (!element) return;
  const syncState = String(data.syncState || '').toUpperCase();
  const partial = data.partial !== false;
  const status = describeGiftSyncStatus(syncState, partial);
  element.dataset.state = status.state;
  element.hidden = status.state === 'live';
  element.textContent = status.label;
  element.title = partial ? '历史记录可能不完整' : '';
}

export function describeGiftSyncStatus(syncState, partial) {
  if (syncState === 'LIVE' && !partial) {
    return { state: 'live', label: '历史记录已同步' };
  }
  if (syncState === 'OFFLINE') {
    return { state: 'offline', label: '离线，正在显示本地记录' };
  }
  if (syncState === 'ERROR') {
    return { state: 'error', label: '礼物同步异常' };
  }
  const labels = {
    SOURCE_SWITCHING: '正在切换账号',
    BOOTSTRAPPING: '正在同步历史记录',
    CATCHING_UP: '正在补齐最新记录',
    LEGACY_PARTIAL: '服务器不支持完整历史同步',
    LIVE: '历史记录尚未完成校验',
  };
  return {
    state: 'partial',
    label: labels[syncState] || '历史记录同步中',
  };
}

function renderSyncError(error) {
  const element = get('giftLedgerSyncStatus');
  if (!element) return;
  element.dataset.state = 'error';
  element.hidden = false;
  element.textContent = '无法读取同步状态';
  element.title = error.message || '请稍后重试';
}

function setHistoryBody(html) {
  const body = get('giftHistoryBody');
  if (body) body.innerHTML = html;
}

function setText(id, value) {
  const element = get(id);
  if (element) element.textContent = value;
}

function get(id) {
  return document.getElementById(id);
}

function isGiftHistoryOpen() {
  return get('giftHistoryDrawer')?.classList.contains('open') === true;
}

function initGiftRecentToggle() {
  const section = document.querySelector('.gift-recent-panel');
  const toggle = get('giftRecentToggle');
  const panelHeader = section?.querySelector('.panel-header');

  panelHeader?.addEventListener('click', (event) => {
    if (event.target.closest('#giftHistoryOpenBtn')) return;
    const collapsed = section?.classList.toggle('is-collapsed') || false;
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.title = collapsed ? '展开最近礼物' : '折叠最近礼物';
    }
  });
}
