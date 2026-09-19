// 编写人：Aurora
// 礼物流水抽屉：活动来源的逐行历史与同步完整性状态。
'use strict';

import { dangerConfirm, readJsonResponse, toast } from '../../shared/utils.js';
import { createGiftHistoryTools } from './history-tools.js';
import { eventBus, Events } from '../../shared/event-bus.js';

import {
  renderHistoryLoadingView,
  renderHistoryErrorView,
  renderHistoryWaitingView,
  renderGiftHistoryView,
  renderGiftHistorySortView,
  renderHistoryNoticeView,
  setSyncNotice,
  setRetryButtonView,
  describeGiftSyncStatus,
} from './history-view.js';

export { describeGiftSyncStatus };

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
let historyTools = null;

export function createGiftLedgerState() {
  return {
    selected: new Set(),
    filters: {},
    viewRevision: null,
    partial: true,
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
  filters = {},
  viewRevision = null,
} = {}) {
  const params = new URLSearchParams();
  params.set('range', 'all');
  params.set('limit', String(limit));
  for (const key of ['startDate', 'endDate', 'userQuery', 'giftQuery', 'amountAbove']) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') params.set(key, filters[key]);
  }
  if (cursor && viewRevision) params.set('viewRevision', viewRevision);
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
  historyTools = createGiftHistoryTools({ state: giftLedgerState,
    reload: () => loadGiftHistory(), resetPagination: () => resetGiftLedgerPagination(giftLedgerState) });
  eventBus.on(Events.STATE_LOADED, ({ state }) => {
    const revision = state?.gifts?.viewRevision;
    if (revision === undefined || !giftLedgerState.viewRevision || revision === giftLedgerState.viewRevision) return;
    historyTools.clear();
    giftLedgerState.viewRevision = null;
    resetGiftLedgerPagination(giftLedgerState);
    if (isGiftHistoryOpen()) loadGiftHistory();
  });

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
  historyTools?.close();
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
        filters: giftLedgerState.filters,
        viewRevision: giftLedgerState.viewRevision,
      }),
      {
        signal: AbortSignal.any([
          historyRequestController.signal,
          AbortSignal.timeout(HISTORY_SLOW_RETRY_INTERVAL_MS),
        ]),
      },
    );
    const payload = await readJsonResponse(response, '礼物记录加载失败');
    if (sequence !== historyRequestSequence) return;
    if (!response.ok || !payload.ok) {
      throw Object.assign(new Error('GIFT_HISTORY_REQUEST_FAILED'), {
        code: payload.code,
        status: response.status,
      });
    }

    const data = payload.data || {};
    if (giftLedgerState.viewRevision && data.viewRevision !== giftLedgerState.viewRevision) historyTools?.clear();
    giftLedgerState.viewRevision = data.viewRevision || null;
    giftLedgerState.partial = data.partial !== false;
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
    historyTools?.update();
  } catch (error) {
    if (sequence !== historyRequestSequence) return;
    if (error.code === 'GIFT_SOURCE_UNAVAILABLE' || error.code === 'GIFT_VIEW_STALE') {
      historyTools?.clear();
      giftLedgerState.viewRevision = null;
      historyLoaded = false;
      resetGiftLedgerPagination(giftLedgerState);
      renderHistoryWaiting();
    } else {
      console.warn(
        '[GiftHistory] Load failed',
        error.code || error.name,
        error.status,
      );
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
  const delay =
    interval ??
    (Date.now() - historyWaitStartedAt >= HISTORY_WAIT_MS
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
    historyTools?.clear();
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
        label:
          response.status === 503
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
    else if (!confirmed && isGiftHistoryOpen())
      loadGiftHistory({ background: true });
  }
}

function historyViewSnapshot() {
  return {
    ledger: giftLedgerState,
    clearOutcome,
    hasRows: hasHistoryRows(),
    loading: !historyLoaded || clearing,
    slow: Date.now() - historyWaitStartedAt >= HISTORY_WAIT_MS,
  };
}

function renderHistoryLoading() {
  renderHistoryLoadingView(historyViewSnapshot());
}

function renderHistoryError() {
  renderHistoryErrorView(historyViewSnapshot());
}

function renderHistoryWaiting() {
  renderHistoryWaitingView(historyViewSnapshot());
}

function renderGiftHistory() {
  renderGiftHistoryView(historyViewSnapshot());
}

function renderGiftHistorySort() {
  renderGiftHistorySortView(historyViewSnapshot());
}

function renderHistoryNotice(notice) {
  renderHistoryNoticeView(notice, historyViewSnapshot());
}

function setRetryButton(visible) {
  setRetryButtonView(visible, historyViewSnapshot());
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
    scheduleHistoryRetry(
      historyRequestSequence,
      HISTORY_SLOW_RETRY_INTERVAL_MS,
    );
    return;
  }
  if (hasHistoryRows()) renderGiftHistory();
  if (status.state === 'error') {
    renderHistoryError();
  } else if (syncState === 'LEGACY_PARTIAL') {
    renderHistoryNotice({ ...status, retry: true });
    scheduleHistoryRetry(
      historyRequestSequence,
      HISTORY_SLOW_RETRY_INTERVAL_MS,
    );
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

function hasHistoryRows() {
  return historyLoaded && giftLedgerState.items.length > 0;
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
