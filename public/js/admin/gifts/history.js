// 编写人：Aurora
// 礼物流水抽屉：活动来源的历史、统计与同步完整性状态。
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
const DEFAULT_GIFT_RANGE = '30d';
const GIFT_RANGES = new Set(['7d', '30d', '90d', 'all']);

let initialized = false;
let historyRequestSequence = 0;
let statisticsRequestSequence = 0;
let previousFocus = null;
const giftLedgerState = createGiftLedgerState();

export function createGiftLedgerState() {
  return {
    query: '',
    range: DEFAULT_GIFT_RANGE,
    cursor: null,
    nextCursor: null,
    cursorHistory: [],
    page: 1,
    items: [],
    hasMore: false,
  };
}

export function resetGiftLedgerDisplay(state) {
  state.query = '';
  state.range = DEFAULT_GIFT_RANGE;
  resetGiftLedgerPagination(state);
}

export function buildGiftHistoryUrl({
  query = '',
  range = DEFAULT_GIFT_RANGE,
  cursor = null,
  limit = GIFT_HISTORY_LIMIT,
} = {}) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  params.set('range', normalizeRange(range));
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  return `/api/gifts/history?${params}`;
}

export function buildGiftStatisticsUrl({
  query = '',
  range = DEFAULT_GIFT_RANGE,
} = {}) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  params.set('range', normalizeRange(range));
  return `/api/gifts/statistics?${params}`;
}

export function initGiftHistoryDrawer() {
  if (initialized) return;
  initialized = true;

  const openButton = get('giftHistoryOpenBtn');
  const closeButton = get('giftHistoryClose');
  const backdrop = get('giftHistoryBackdrop');
  const searchForm = get('giftHistorySearchForm');
  const clearDisplayButton = get('giftHistoryClearDisplayBtn');
  const clearDatabaseButton = get('giftHistoryClearDatabaseBtn');
  const previousButton = get('giftHistoryPrev');
  const nextButton = get('giftHistoryNext');

  openButton?.addEventListener('click', () => {
    previousFocus = openButton;
    resetGiftLedgerPagination(giftLedgerState);
    openGiftHistoryDrawer();
    loadGiftLedger();
  });
  closeButton?.addEventListener('click', closeGiftHistoryDrawer);
  backdrop?.addEventListener('click', closeGiftHistoryDrawer);

  searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    giftLedgerState.query = String(get('giftHistorySearch')?.value || '').trim();
    resetGiftLedgerPagination(giftLedgerState);
    loadGiftLedger();
  });

  document.querySelectorAll('[data-gift-range]').forEach((button) => {
    button.addEventListener('click', () => {
      const range = normalizeRange(button.dataset.giftRange);
      if (range === giftLedgerState.range) return;
      giftLedgerState.range = range;
      resetGiftLedgerPagination(giftLedgerState);
      syncFilterControls();
      loadGiftLedger();
    });
  });

  clearDisplayButton?.addEventListener('click', () => {
    resetGiftLedgerDisplay(giftLedgerState);
    syncFilterControls();
    loadGiftLedger();
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
  syncFilterControls();
}

export function openGiftHistoryDrawer() {
  get('giftHistoryDrawer')?.classList.add('open');
  get('giftHistoryBackdrop')?.classList.add('open');
  get('giftHistorySearch')?.focus();
}

export function closeGiftHistoryDrawer() {
  historyRequestSequence += 1;
  statisticsRequestSequence += 1;
  get('giftHistoryDrawer')?.classList.remove('open');
  get('giftHistoryBackdrop')?.classList.remove('open');
  previousFocus?.focus?.();
  previousFocus = null;
}

export async function loadGiftLedger() {
  await Promise.all([loadGiftHistory(), loadGiftStatistics()]);
}

export async function loadGiftHistory() {
  const sequence = ++historyRequestSequence;
  renderHistoryLoading();

  try {
    const response = await fetch(
      buildGiftHistoryUrl({
        query: giftLedgerState.query,
        range: giftLedgerState.range,
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
  }
}

export async function loadGiftStatistics() {
  const sequence = ++statisticsRequestSequence;
  renderStatisticsLoading();

  try {
    const response = await fetch(
      buildGiftStatisticsUrl({
        query: giftLedgerState.query,
        range: giftLedgerState.range,
      }),
    );
    const payload = await readJsonResponse(response, '礼物统计加载失败');
    if (!response.ok || !payload.ok) {
      throw new Error(
        payload.error || `礼物统计加载失败（HTTP ${response.status}）`,
      );
    }
    if (sequence !== statisticsRequestSequence) return;

    const data = payload.data || {};
    renderGiftStatistics(data);
    renderSyncStatus(data);
  } catch (error) {
    if (sequence !== statisticsRequestSequence) return;
    renderStatisticsError(error);
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

function normalizeRange(range) {
  return GIFT_RANGES.has(range) ? range : DEFAULT_GIFT_RANGE;
}

function syncFilterControls() {
  const search = get('giftHistorySearch');
  if (search) search.value = giftLedgerState.query;
  document.querySelectorAll('[data-gift-range]').forEach((button) => {
    const active = button.dataset.giftRange === giftLedgerState.range;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function clearGiftDatabase() {
  const confirmed = await dangerConfirm({
    title: '清空数据库礼物记录',
    message:
      '此操作会删除全部礼物流水并重新同步当前账号的历史记录。同步完成前统计会标记为不完整。',
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
    loadGiftLedger();
  } catch (error) {
    toast(error.message || '清空礼物失败');
  }
}

function renderHistoryLoading() {
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
    items.length === 0
      ? giftLedgerState.query
        ? '没有匹配的礼物记录'
        : '暂无礼物记录'
      : '已加载',
  );
  setHistoryBody(
    items.length === 0
      ? `<tr><td colspan="6" class="empty">${giftLedgerState.query ? '没有匹配的礼物或盲盒' : '暂无礼物记录'}</td></tr>`
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

function renderStatisticsLoading() {
  renderPlaceholder('giftLedgerSummary', '正在加载统计…', 'loading');
  renderPlaceholder('giftLedgerTopGifts', '正在加载…', 'loading');
  renderPlaceholder('giftLedgerTimeSeries', '正在加载…', 'loading');
}

function renderStatisticsError(error) {
  const message = error.message || '统计加载失败';
  renderPlaceholder('giftLedgerSummary', message, 'error');
  renderPlaceholder('giftLedgerTopGifts', '排行加载失败', 'error');
  renderPlaceholder('giftLedgerTimeSeries', '趋势加载失败', 'error');
}

function renderGiftStatistics(data) {
  const summary = data.summary || {};
  const summaryElement = get('giftLedgerSummary');
  if (summaryElement) {
    summaryElement.dataset.state = 'ready';
    summaryElement.innerHTML = [
      renderSummaryItem('事件', formatCount(summary.eventCount)),
      renderSummaryItem('礼物数量', formatCount(summary.itemCount)),
      renderSummaryItem('礼物金额', formatGiftCents(summary.totalPriceCents)),
      renderSummaryItem(
        '盲盒事件',
        formatCount(summary.blindBoxEventCount),
      ),
      renderSummaryItem(
        '盲盒成本',
        formatGiftCents(summary.blindBoxPriceCents),
      ),
      renderSummaryItem(
        '盲盒价值',
        formatGiftCents(summary.blindBoxValueCents),
      ),
      renderSummaryItem('盲盒盈亏', formatSignedCents(summary.blindProfitCents)),
      renderSummaryItem(
        '成本未知',
        formatCount(summary.blindBoxUnknownCostEventCount),
      ),
    ].join('');
  }
  renderTopGifts(data.topGifts);
  renderTimeSeries(data.timeSeries);
}

function renderSummaryItem(label, value) {
  return `<div class="gift-ledger-summary-item"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderTopGifts(topGifts) {
  const element = get('giftLedgerTopGifts');
  if (!element) return;
  const rows = Array.isArray(topGifts) ? topGifts : [];
  element.dataset.state = rows.length ? 'ready' : 'empty';
  element.innerHTML = rows.length
    ? rows
        .map(
          (gift) => `
            <div class="gift-ledger-top-row">
              <strong title="${escapeAttr(gift.giftName || '')}">${escapeHtml(gift.giftName || '未知礼物')}</strong>
              <span>${formatCount(gift.itemCount)} 个</span>
              <span>${formatGiftCents(gift.totalPriceCents)}</span>
            </div>`,
        )
        .join('')
    : '<div class="gift-ledger-placeholder">暂无排行数据</div>';
}

function renderTimeSeries(timeSeries) {
  const element = get('giftLedgerTimeSeries');
  if (!element) return;
  const rows = Array.isArray(timeSeries) ? timeSeries : [];
  const maximum = Math.max(
    1,
    ...rows.map((bucket) => Number(bucket.totalPriceCents || 0)),
  );
  element.dataset.state = rows.length ? 'ready' : 'empty';
  element.innerHTML = rows.length
    ? rows
        .map((bucket) => {
          const cents = Number(bucket.totalPriceCents || 0);
          const width = Math.max(2, Math.round((cents / maximum) * 100));
          return `
            <div class="gift-ledger-series-row">
              <span>${formatBucket(bucket.bucketStart)}</span>
              <span class="gift-ledger-series-bar" aria-hidden="true"><span style="width:${width}%"></span></span>
              <strong>${formatGiftCents(cents)}</strong>
            </div>`;
        })
        .join('')
    : '<div class="gift-ledger-placeholder">暂无趋势数据</div>';
}

function renderSyncStatus(data) {
  const element = get('giftLedgerSyncStatus');
  if (!element) return;
  const syncState = String(data.syncState || '').toUpperCase();
  const partial = data.partial !== false;
  const status = describeGiftSyncStatus(syncState, partial);
  element.dataset.state = status.state;
  setText('giftLedgerSyncLabel', status.label);

  const details = [];
  if (data.syncedAt) details.push(`更新于 ${formatDateTime(data.syncedAt)}`);
  if (partial) details.push('当前统计可能不完整');
  setText('giftLedgerSyncDetail', details.join(' · '));
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
  if (element) element.dataset.state = 'error';
  setText('giftLedgerSyncLabel', '无法读取同步状态');
  setText('giftLedgerSyncDetail', error.message || '请稍后重试');
}

export function formatGiftCents(value) {
  const cents = Number(value);
  return formatMoney(Number.isFinite(cents) ? cents / 100 : 0);
}

function formatSignedCents(value) {
  const cents = Number(value);
  if (!Number.isFinite(cents) || cents === 0) return formatGiftCents(0);
  return `${cents > 0 ? '+' : '-'}${formatGiftCents(Math.abs(cents))}`;
}

function formatCount(value) {
  const count = Number(value);
  return Number.isFinite(count)
    ? Math.max(0, count).toLocaleString('zh-CN')
    : '0';
}

function formatBucket(value) {
  const text = String(value || '');
  return giftLedgerState.range === 'all' ? text.slice(0, 7) : text.slice(5, 10);
}

function renderPlaceholder(id, message, state) {
  const element = get(id);
  if (!element) return;
  element.dataset.state = state;
  element.innerHTML = `<div class="gift-ledger-placeholder">${escapeHtml(message)}</div>`;
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
