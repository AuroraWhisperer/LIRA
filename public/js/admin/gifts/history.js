// 编写人：Aurora
// 礼物流水抽屉：活动来源的逐行历史与同步完整性状态。
'use strict';

import {
  dangerConfirm,
  escapeAttr,
  escapeHtml,
  formatDateTime,
  readJsonResponse,
  toast,
} from '../../shared/utils.js';

const GIFT_HISTORY_LIMIT = 50;
const DEFAULT_HISTORY_SORT_FIELD = 'created_at';
const DEFAULT_HISTORY_SORT_DIRECTION = 'desc';
const HISTORY_RETRY_INTERVAL_MS = 2000;
const HISTORY_SLOW_RETRY_INTERVAL_MS = 10000;
const HISTORY_WAIT_MS = 15000;

let initialized = false;
let historyRequestSequence = 0;
let historyRequestController = null;
let historyRetryTimer = null;
let historyWaitStartedAt = 0;
let historyLoaded = false;
let clearing = false;
let clearOutcome = null;
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
    sortField: null,
    sortDirection: null,
    total: 0,
    totalPages: 1,
  };
}

export function buildGiftHistoryUrl({
  cursor = null,
  limit = GIFT_HISTORY_LIMIT,
  sortField = DEFAULT_HISTORY_SORT_FIELD,
  sortDirection = DEFAULT_HISTORY_SORT_DIRECTION,
} = {}) {
  const params = new URLSearchParams();
  params.set('range', 'all');
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  if (
    sortField &&
    (sortField !== DEFAULT_HISTORY_SORT_FIELD ||
      sortDirection !== DEFAULT_HISTORY_SORT_DIRECTION)
  ) {
    params.set('sortField', sortField);
    params.set('sortDirection', sortDirection);
  }
  return `/api/gifts/history?${params}`;
}

export function initGiftHistoryDrawer() {
  if (initialized) return;
  initialized = true;

  const openButton = get('giftHistoryOpenBtn');
  const closeButton = get('giftHistoryClose');
  const backdrop = get('giftHistoryBackdrop');
  const clearDatabaseButton = get('giftHistoryClearDatabaseBtn');
  const retryButton = get('giftHistoryRetryBtn');
  const previousButton = get('giftHistoryPrev');
  const nextButton = get('giftHistoryNext');
  const sortableHeaders = getSortableHeaders();

  openButton?.addEventListener('click', () => {
    previousFocus = openButton;
    resetGiftLedgerPagination(giftLedgerState);
    openGiftHistoryDrawer();
    loadGiftHistory();
  });
  closeButton?.addEventListener('click', closeGiftHistoryDrawer);
  backdrop?.addEventListener('click', closeGiftHistoryDrawer);

  retryButton?.addEventListener('click', () => {
    if (clearing) return;
    historyWaitStartedAt = Date.now();
    renderHistoryLoading();
    loadGiftHistory({ background: true });
  });

  clearDatabaseButton?.addEventListener('click', clearGiftDatabase);

  previousButton?.addEventListener('click', () => {
    if (clearing) return;
    if (giftLedgerState.cursorHistory.length === 0) return;
    giftLedgerState.cursor = giftLedgerState.cursorHistory.pop() ?? null;
    giftLedgerState.page = Math.max(1, giftLedgerState.page - 1);
    loadGiftHistory();
  });
  nextButton?.addEventListener('click', () => {
    if (clearing) return;
    if (!giftLedgerState.hasMore || !giftLedgerState.nextCursor) return;
    giftLedgerState.cursorHistory.push(giftLedgerState.cursor);
    giftLedgerState.cursor = giftLedgerState.nextCursor;
    giftLedgerState.page += 1;
    loadGiftHistory();
  });

  sortableHeaders.forEach((header) => {
    const sort = header.dataset?.sort;
    if (!sort) return;
    const applySort = () => {
      if (clearing) return;
      if (giftLedgerState.sortField === sort) {
        if (giftLedgerState.sortDirection === 'asc') {
          giftLedgerState.sortDirection = 'desc';
        } else {
          giftLedgerState.sortField = null;
          giftLedgerState.sortDirection = null;
        }
      } else {
        giftLedgerState.sortField = sort;
        giftLedgerState.sortDirection = 'asc';
      }
      resetGiftLedgerPagination(giftLedgerState);
      renderGiftHistorySort();
      loadGiftHistory();
    };
    header.addEventListener?.('click', applySort);
    header.addEventListener?.('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault?.();
      applySort();
    });
  });
  renderGiftHistorySort();

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
  cancelHistoryLoad();
  get('giftHistoryDrawer')?.classList.remove('open');
  get('giftHistoryBackdrop')?.classList.remove('open');
  previousFocus?.focus?.();
  previousFocus = null;
}

export async function loadGiftHistory({ background = false } = {}) {
  if (clearing) return;
  cancelHistoryLoad();
  const sequence = historyRequestSequence;
  historyRequestController = new AbortController();
  if (!background) {
    historyLoaded = false;
    historyWaitStartedAt = Date.now();
    renderHistoryLoading();
  }

  try {
    const response = await fetch(
      buildGiftHistoryUrl({
        cursor: giftLedgerState.cursor,
        limit: GIFT_HISTORY_LIMIT,
        sortField: giftLedgerState.sortField,
        sortDirection: giftLedgerState.sortDirection,
      }),
      {
        signal: AbortSignal.any([
          historyRequestController.signal,
          AbortSignal.timeout(HISTORY_SLOW_RETRY_INTERVAL_MS),
        ]),
      },
    );
    const payload = await readJsonResponse(response, '礼物流水加载失败');
    if (sequence !== historyRequestSequence) return;
    if (!response.ok || !payload.ok) {
      throw Object.assign(new Error('GIFT_HISTORY_REQUEST_FAILED'), {
        code: payload.code,
        status: response.status,
      });
    }

    const data = payload.data || {};
    giftLedgerState.items = Array.isArray(data.items) ? data.items : [];
    giftLedgerState.nextCursor = data.nextCursor || null;
    giftLedgerState.hasMore = data.hasMore === true;
    giftLedgerState.total = Number.isSafeInteger(Number(data.total))
      ? Number(data.total)
      : giftLedgerState.items.length;
    giftLedgerState.totalPages = Number.isSafeInteger(Number(data.totalPages))
      ? Math.max(1, Number(data.totalPages))
      : Math.max(
          1,
          giftLedgerState.hasMore
            ? giftLedgerState.page + 1
            : giftLedgerState.page,
        );
    historyLoaded = true;
    renderSyncStatus(data);
  } catch (error) {
    if (sequence !== historyRequestSequence) return;
    if (error.code === 'GIFT_SOURCE_UNAVAILABLE') {
      historyLoaded = false;
      resetGiftLedgerPagination(giftLedgerState);
      renderHistoryWaiting();
    } else {
      console.warn('[GiftHistory] Load failed', error.code || error.name, error.status);
      renderHistoryError();
    }
    scheduleHistoryRetry(sequence);
  } finally {
    if (sequence === historyRequestSequence) historyRequestController = null;
  }
}

function cancelHistoryLoad() {
  historyRequestSequence += 1;
  historyRequestController?.abort();
  historyRequestController = null;
  clearTimeout(historyRetryTimer);
  historyRetryTimer = null;
}

function scheduleHistoryRetry(sequence, interval) {
  if (!isGiftHistoryOpen()) return;
  const delay = interval ?? (Date.now() - historyWaitStartedAt >= HISTORY_WAIT_MS
    ? HISTORY_SLOW_RETRY_INTERVAL_MS
    : HISTORY_RETRY_INTERVAL_MS);
  historyRetryTimer = setTimeout(() => {
    historyRetryTimer = null;
    if (sequence !== historyRequestSequence || !isGiftHistoryOpen()) return;
    loadGiftHistory({ background: true });
  }, delay);
}

function resetGiftLedgerPagination(state) {
  state.cursor = null;
  state.nextCursor = null;
  state.cursorHistory.length = 0;
  state.page = 1;
  state.items = [];
  state.hasMore = false;
  state.total = 0;
  state.totalPages = 1;
}

async function clearGiftDatabase() {
  if (clearing) return;
  clearing = true;
  const button = get('giftHistoryClearDatabaseBtn');
  if (button) button.disabled = true;
  let reload = false;
  let confirmed = false;
  try {
    confirmed = await dangerConfirm({
      title: '清空全部礼物记录？',
      message:
        '将永久删除当前账号在本机和云端的全部礼物记录，其他设备同步后也会清空。此操作无法撤销。',
      confirmLabel: '清空全部记录',
    });
    if (!confirmed) return;

    cancelHistoryLoad();
    clearOutcome = null;
    historyLoaded = false;
    resetGiftLedgerPagination(giftLedgerState);
    setText('giftHistoryClearDatabaseBtn', '正在清空…');
    renderHistoryNotice({ label: '正在清空礼物记录…' });
    const response = await fetch('/api/database/clear-gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
      signal: AbortSignal.timeout(30000),
    });
    const payload = await readJsonResponse(response, '清空礼物失败');
    if (payload.partial === true) {
      clearOutcome = 'remote-cleared';
      reload = true;
      toast('云端记录已清空，本机记录尚未更新。');
      return;
    }
    if (!response.ok || !payload.ok) {
      console.warn('[GiftHistory] Clear failed', response.status);
      renderHistoryNotice({
        state: 'error',
        label: response.status === 503
          ? '暂时无法清空礼物记录。'
          : '暂时无法确认清空结果。',
        detail: '请重新加载记录后检查。',
        retry: true,
      });
      return;
    }
    clearOutcome = 'cleared';
    reload = true;
    toast('礼物记录已清空');
  } catch (error) {
    console.warn('[GiftHistory] Clear result unavailable', error.name);
    renderHistoryNotice({
      state: 'error',
      label: '暂时无法确认清空结果。',
      detail: '请重新加载记录后检查。',
      retry: true,
    });
  } finally {
    clearing = false;
    if (button) button.disabled = false;
    setText('giftHistoryClearDatabaseBtn', '清空全部记录');
    if (reload && isGiftHistoryOpen()) loadGiftHistory();
    else if (!confirmed && isGiftHistoryOpen()) loadGiftHistory({ background: true });
  }
}

function renderHistoryLoading() {
  renderHistoryNotice({
    label: clearOutcome === 'remote-cleared'
      ? '云端记录已清空，本机记录尚未更新。'
      : clearOutcome || hasHistoryRows()
        ? '正在更新礼物记录…'
        : '正在加载礼物记录…',
  });
}

function renderHistoryError() {
  renderHistoryNotice({
    state: 'error',
    label: clearOutcome === 'cleared'
      ? '礼物记录已清空，列表暂未更新。'
      : clearOutcome === 'remote-cleared'
        ? '云端记录已清空，本机记录尚未更新。'
        : hasHistoryRows()
          ? '记录暂未更新，请稍后重试。'
          : '暂时无法加载礼物记录。',
    detail: '请稍后重试。',
    retry: true,
  });
}

function renderHistoryWaiting() {
  const slow = Date.now() - historyWaitStartedAt >= HISTORY_WAIT_MS;
  renderHistoryNotice({
    label: clearOutcome === 'remote-cleared'
      ? '云端记录已清空，本机记录尚未更新。'
      : slow
        ? '更新较慢，请稍后重试。'
        : hasHistoryRows()
          ? '正在更新，当前记录可能不完整'
          : '正在更新礼物记录…',
    retry: slow || clearOutcome === 'remote-cleared',
  });
}

function renderGiftHistory() {
  const items = giftLedgerState.items;
  setText('giftHistoryTotal', `共 ${giftLedgerState.total} 条`);
  const total = get('giftHistoryTotal');
  if (total) total.hidden = false;
  setText(
    'giftHistoryState',
    items.length === 0 ? '暂无礼物记录' : '已加载',
  );
  setHistoryBody(
    items.length === 0
      ? '<tr><td colspan="6" class="empty"><strong>暂无礼物记录</strong><span>收到礼物后，记录会显示在这里。</span></td></tr>'
      : items.map(renderGiftHistoryRow).join(''),
  );
  renderGiftHistorySort();
  updatePagination(false);
}

function formatHistoryMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '¥0.0';
  return `¥${number.toFixed(1)}`;
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
        `<span class="gift-remark-tag blind ${profitClass}">盲盒 ${profitSign}${formatHistoryMoney(Math.abs(Number(blindProfit) || 0))}</span>`,
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
      <td>${formatHistoryMoney(price)}</td>
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
  setText(
    'giftHistoryPageInfo',
    `第 ${giftLedgerState.page}/${giftLedgerState.totalPages} 页`,
  );
}

function renderGiftHistorySort() {
  getSortableHeaders().forEach((header) => {
    const sort = header.dataset?.sort;
    if (!sort) return;
    const active = sort === giftLedgerState.sortField;
    header.setAttribute?.(
      'aria-sort',
      active
        ? giftLedgerState.sortDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none',
    );
    const arrow = header.querySelector?.('.sort-arrow');
    if (arrow) {
      arrow.textContent = active
        ? giftLedgerState.sortDirection === 'asc'
          ? ' ▲'
          : ' ▼'
        : '';
    }
  });
}

function renderSyncStatus(data) {
  const syncState = String(data.syncState || '').toUpperCase();
  const partial = data.partial !== false;
  const status = describeGiftSyncStatus(syncState, partial);
  if (status.state === 'live') {
    clearOutcome = null;
    historyWaitStartedAt = Date.now();
    renderGiftHistory();
    setSyncNotice(status, true);
    setRetryButton(false);
    scheduleHistoryRetry(historyRequestSequence, HISTORY_SLOW_RETRY_INTERVAL_MS);
    return;
  }
  if (hasHistoryRows()) renderGiftHistory();
  if (status.state === 'error') {
    renderHistoryError();
  } else if (syncState === 'LEGACY_PARTIAL') {
    renderHistoryNotice({ ...status, retry: true });
    scheduleHistoryRetry(historyRequestSequence, HISTORY_SLOW_RETRY_INTERVAL_MS);
    return;
  } else if (status.state === 'offline') {
    renderHistoryNotice({
      ...status,
      label: hasHistoryRows()
        ? status.label
        : '当前离线，暂时无法更新礼物记录。',
      retry: true,
    });
  } else {
    renderHistoryWaiting();
  }
  scheduleHistoryRetry(historyRequestSequence);
}

export function describeGiftSyncStatus(syncState, partial) {
  if (syncState === 'LIVE' && !partial) {
    return { state: 'live', label: '礼物记录已更新' };
  }
  if (syncState === 'OFFLINE') {
    return { state: 'offline', label: '当前离线，显示已保存的记录' };
  }
  if (syncState === 'ERROR') {
    return { state: 'error', label: '记录暂未更新，请稍后重试。' };
  }
  return {
    state: 'partial',
    label: syncState === 'LEGACY_PARTIAL'
      ? '当前仅能查看部分历史记录。'
      : '正在更新礼物记录…',
  };
}

function hasHistoryRows() {
  return historyLoaded && giftLedgerState.items.length > 0;
}

function renderHistoryNotice({ state = 'partial', label, detail = '', retry = false }) {
  const hasRows = hasHistoryRows();
  setText('giftHistoryState', label);
  setSyncNotice({ state, label }, !hasRows);
  const total = get('giftHistoryTotal');
  if (total) total.hidden = !hasRows;
  if (!hasRows) {
    setHistoryBody(`<tr><td colspan="6" class="empty"><strong>${escapeHtml(label)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</td></tr>`);
  }
  setRetryButton(retry);
  updatePagination(!historyLoaded || clearing);
}

function setSyncNotice({ state, label }, hidden) {
  const element = get('giftLedgerSyncStatus');
  if (!element) return;
  element.dataset.state = state;
  element.hidden = hidden;
  element.textContent = label;
  element.title = '';
}

function setRetryButton(visible) {
  const button = get('giftHistoryRetryBtn');
  if (!button) return;
  button.hidden = !visible;
  button.textContent = clearOutcome === 'remote-cleared'
    ? '重试更新'
    : hasHistoryRows() ? '重试' : '重新加载';
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

function getSortableHeaders() {
  return document.querySelectorAll?.('#giftHistoryDrawer th[data-sort]') || [];
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
