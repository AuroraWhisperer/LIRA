import { escapeHtml } from '../../shared/html-escape.js';
import { formatDateTime, formatMoney } from '../../shared/display-format.js';
import { readJsonResponse, assertApiResponse } from '../../shared/json-response.js';
// 盲盒分析工作区：独立管理筛选、视图、分页和请求生命周期。
('use strict');

import { eventBus, Events } from '../../shared/event-bus.js';
import { stateService } from '../state.js';
import { createBlindBoxDatePicker } from './blindbox-analysis-dates.js';

export const giftAnalysis = (() => {
  const PAGE_SIZE = 25;
  const REFRESH_DELAY_MS = 500;
  const VIEWS = ['users', 'boxes', 'records'];
  const state = {
    open: false,
    viewer: '',
    viewerLabel: '',
    box: '',
    dateRange: null,
    view: 'users',
    viewRevision: null,
    sort: '',
    direction: 'desc',
    page: 1,
    requestId: 0,
    controller: null,
    refreshTimer: null,
    refreshPending: false,
    returnFocus: null,
  };
  let datePicker;
  const optionSignatures = new WeakMap();

  function init() {
    const workspace = get('blindBoxAnalysisWorkspace');
    if (!workspace || workspace.dataset.initialized === 'true') return;
    workspace.dataset.initialized = 'true';

    get('blindBoxAnalysisClose')?.addEventListener('click', close);
    datePicker = createBlindBoxDatePicker({
      onChange(dateRange) {
        state.dateRange = dateRange;
        state.page = 1;
        load();
      },
    });
    initSelect('blindBoxAnalysisViewer', 'viewer');
    initSelect('blindBoxAnalysisBox', 'box');
    get('blindBoxAnalysisClear')?.addEventListener('click', () => {
      state.viewer = '';
      state.box = '';
      state.page = 1;
      load();
    });
    workspace.querySelectorAll('[data-blind-analysis-view]').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.view !== button.dataset.blindAnalysisView) setView(button.dataset.blindAnalysisView);
        state.page = 1;
        load();
      });
    });
    get('blindBoxAnalysisHead')?.addEventListener('click', (event) => {
      const sort = event.target.closest('[data-blind-sort]')?.dataset.blindSort;
      if (!sort) return;
      const direction = state.sort === sort && state.direction === 'desc' ? 'asc' : 'desc';
      state.page = 1;
      load({ sort, direction });
    });
    get('blindBoxAnalysisPrev')?.addEventListener('click', () => {
      if (state.page <= 1) return;
      state.page -= 1;
      load();
    });
    get('blindBoxAnalysisNext')?.addEventListener('click', () => {
      state.page += 1;
      load();
    });
    document.addEventListener('keydown', (event) => {
      // An open shared select menu consumes Escape before the workspace closes.
      if (event.key === 'Escape' && state.open && !event.defaultPrevented) close();
    });
    eventBus.on(Events.GIFT_RECEIVED, refreshIfOpen);
  }

  function open(filters = {}) {
    const workspace = get('blindBoxAnalysisWorkspace');
    if (!workspace) return;
    closeCompetingLayers();
    state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.viewer = typeof filters.viewer === 'string' ? filters.viewer : '';
    state.viewerLabel = '';
    state.box = typeof filters.box === 'string' ? filters.box : '';
    state.viewRevision = giftViewRevision();
    setView(VIEWS.includes(filters.view) ? filters.view : 'users');
    state.page = 1;
    state.dateRange = null;
    datePicker.setSelection(null);
    state.open = true;
    workspace.hidden = false;
    document.body.classList.add('blind-analysis-open');
    get('blindBoxAnalysisTitle')?.focus();
    load();
  }

  function setView(view) {
    state.view = view;
    state.sort = '';
    state.direction = 'desc';
    get('blindBoxAnalysisHead')?.replaceChildren();
  }

  function close({ restoreFocus = true } = {}) {
    const workspace = get('blindBoxAnalysisWorkspace');
    if (!workspace || !state.open) return;
    state.open = false;
    state.controller?.abort();
    state.controller = null;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
    state.refreshPending = false;
    datePicker.close();
    workspace.hidden = true;
    document.body.classList.remove('blind-analysis-open');
    if (restoreFocus) state.returnFocus?.focus?.();
  }

  function giftViewRevision() {
    return stateService.getAppState()?.gifts?.viewRevision ?? null;
  }

  function refreshIfOpen({ reason } = {}) {
    const revision = giftViewRevision();
    const sourceChanged = revision !== state.viewRevision;
    if (sourceChanged || reason === 'gift:source' || reason === 'connect') {
      state.viewRevision = revision;
      state.dateRange = null;
      datePicker.setSelection(null);
      const keepSort = reason === 'connect' && revision && !sourceChanged;
      render(keepSort ? { sort: state.sort, direction: state.direction } : {});
      if (state.open) void load();
      return;
    }
    if (!state.open) return;
    state.refreshPending = true;
    scheduleRefresh();
  }

  function scheduleRefresh() {
    if (!state.open || !state.refreshPending || state.controller || state.refreshTimer !== null) return;
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      void load({ quiet: true });
    }, REFRESH_DELAY_MS);
  }

  async function load({ quiet = false, sort = state.sort, direction = state.direction } = {}) {
    if (!state.open) return;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
    state.refreshPending = false;
    const requestId = ++state.requestId;
    state.controller?.abort();
    state.controller = new AbortController();
    if (!quiet) renderLoading();

    const params = new URLSearchParams({
      view: state.view,
      page: String(state.page),
      limit: String(PAGE_SIZE),
    });
    if (sort) {
      params.set('sort', sort);
      params.set('direction', direction);
    }
    if (state.viewer) params.set('viewer', state.viewer);
    if (state.box) params.set('box', state.box);
    if (state.dateRange) {
      params.set('startDate', state.dateRange.startDate);
      params.set('endDate', state.dateRange.endDate);
    }

    try {
      const response = await fetch(`/api/gifts/blind-box-analysis?${params}`, {
        signal: state.controller.signal,
      });
      const payload = await readJsonResponse(response, '盲盒分析读取失败');
      assertApiResponse(response, payload, '盲盒分析读取失败');
      if (requestId !== state.requestId || !state.open) return;
      render(payload.data);
    } catch (error) {
      if (error.name === 'AbortError' || requestId !== state.requestId || !state.open) return;
      renderError(error.message || '数据读取失败', () => load({ sort, direction }));
    } finally {
      if (requestId === state.requestId) {
        state.controller = null;
        scheduleRefresh();
      }
    }
  }

  function render(data) {
    state.page = data.pagination?.page || 1;
    state.sort = data.sort || '';
    state.direction = data.direction || 'desc';
    state.viewer = data.filters?.selectedViewer || '';
    state.box = data.filters?.selectedBox || '';
    renderFilters(data.filters || {});
    renderSummary(data.summary || {});
    renderViewControls();
    renderTable(data.items || [], data.hasArchivedDetails === true, Number(data.pagination?.total || 0));
    renderPagination(data.pagination || {});
    renderContext(data.hasArchivedDetails === true, data.hasLegacyArchivedDates === true, data.archiveTimeZones, data.hasArchivedTimezoneMismatch);
    const results = document.querySelector('.blind-analysis-results');
    results?.setAttribute('aria-busy', 'false');
  }

  function renderFilters(filters) {
    const viewers = [...(filters.viewers || [])];
    if (state.viewer && !viewers.some((item) => item.value === state.viewer)) {
      viewers.push({ value: state.viewer, label: state.viewerLabel || state.viewer.replace(/^(uid|name):/, '') });
    }
    state.viewerLabel = viewers.find((item) => item.value === state.viewer)?.label || '';
    const boxes = [...(filters.boxes || [])];
    if (state.box && !boxes.includes(state.box)) boxes.push(state.box);
    renderSelect('blindBoxAnalysisViewer', [{ value: '', label: '全部观众' }, ...viewers], state.viewer);
    renderSelect(
      'blindBoxAnalysisBox',
      [{ value: '', label: '全部盲盒' }, ...boxes.map((name) => ({ value: name, label: name }))],
      state.box,
    );
    const clearButton = get('blindBoxAnalysisClear');
    if (clearButton) clearButton.disabled = !state.viewer && !state.box;
  }

  function initSelect(id, stateKey) {
    get(id)?.addEventListener('change', (event) => {
      state[stateKey] = event.target.value;
      state.page = 1;
      load();
    });
  }

  function renderSelect(id, options, selectedValue) {
    const select = get(id);
    if (!select) return;
    const selected = options.find((option) => option.value === selectedValue) || options[0];
    const signature = JSON.stringify(options);
    if (optionSignatures.get(select) !== signature) {
      select.replaceChildren(
        ...options.map((option) => new Option(option.label, option.value, false, option.value === selected.value)),
      );
      optionSignatures.set(select, signature);
    }
    select.value = selected.value;
  }

  function renderSummary(summary) {
    setText('blindBoxAnalysisCount', String(summary.boxCount || 0));
    setText('blindBoxAnalysisCost', formatMoney(summary.totalCost));
    setText('blindBoxAnalysisValue', formatMoney(summary.totalValue));
    const profit = Number(summary.totalProfit || 0);
    setText('blindBoxAnalysisProfit', `${profit > 0 ? '+' : profit < 0 ? '-' : ''}${formatMoney(Math.abs(profit))}`);
    const item = get('blindBoxAnalysisProfitItem');
    if (item) item.dataset.tone = profit > 0 ? 'up' : profit < 0 ? 'down' : 'flat';
  }

  function renderViewControls() {
    document.querySelectorAll('[data-blind-analysis-view]').forEach((button) => {
      const active = button.dataset.blindAnalysisView === state.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderTable(items, hasArchivedDetails, total) {
    const head = get('blindBoxAnalysisHead');
    const body = get('blindBoxAnalysisBody');
    if (!head || !body) return;
    const columns = getColumns(state.view, total);
    const headers = `<tr>${columns.map(({ label, sort }) => {
      if (!sort) return `<th scope="col">${label}</th>`;
      const active = sort === state.sort;
      const ascending = state.direction === 'asc';
      const order = active ? ` aria-sort="${ascending ? 'ascending' : 'descending'}"` : '';
      const arrow = active ? (ascending ? '▲' : '▼') : '↕';
      return `<th scope="col"${order}><button type="button" data-blind-sort="${sort}">${label} <span aria-hidden="true">${arrow}</span></button></th>`;
    }).join('')}</tr>`;
    if (head.innerHTML !== headers) {
      const focusedSort = document.activeElement?.dataset.blindSort;
      head.innerHTML = headers;
      if (focusedSort) head.querySelector(`[data-blind-sort="${focusedSort}"]`)?.focus({ preventScroll: true });
    }
    if (items.length === 0) {
      body.innerHTML = `<tr><td colspan="${columns.length}" class="blind-analysis-empty">${hasArchivedDetails && state.view === 'records' ? '该范围的逐笔开盒记录已过保留期，汇总仍可查' : '当前选择下还没有盲盒数据'}</td></tr>`;
      return;
    }
    body.innerHTML = items
      .map(
        (item) =>
          `<tr>${columns.map((column) => `<td${column.className ? ` class="${column.className(item)}"` : ''}>${column.render(item)}</td>`).join('')}</tr>`,
      )
      .join('');
  }

  function getColumns(view, total) {
    const profit = { label: '观众盈亏', sort: 'profit', render: (item) => formatProfit(item.profit), className: profitClass };
    if (view === 'boxes')
      return [
        {
          label: `盲盒（${total} 种）`,
          render: (item) => `<strong>${escapeHtml(item.boxName)}</strong>`,
        },
        { label: '盒数', sort: 'boxCount', render: (item) => String(item.boxCount) },
        { label: '观众', sort: 'viewerCount', render: (item) => `${item.viewerCount} 人` },
        { label: '总成本', sort: 'totalCost', render: (item) => formatMoney(item.totalCost) },
        { label: '开出价值', sort: 'totalValue', render: (item) => formatMoney(item.totalValue) },
        profit,
      ];
    if (view === 'records')
      return [
        { label: '时间', sort: 'createdAt', render: (item) => formatDateTime(item.createdAt) },
        {
          label: '观众',
          render: (item) => `<strong>${escapeHtml(item.userName)}</strong>`,
        },
        { label: '盲盒', render: (item) => escapeHtml(item.boxName) },
        { label: '开出礼物', render: (item) => escapeHtml(item.giftName) },
        { label: '数量', sort: 'num', render: (item) => String(item.num) },
        { label: '成本', sort: 'cost', render: (item) => formatMoney(item.cost) },
        { label: '开出价值', sort: 'value', render: (item) => formatMoney(item.value) },
        profit,
      ];
    return [
      {
        label: `观众（${total} 人）`,
        render: (item) => `<strong>${escapeHtml(item.userName)}</strong>`,
      },
      { label: '盒数', sort: 'boxCount', render: (item) => String(item.boxCount) },
      { label: '盒型', render: (item) => `${item.boxTypeCount} 种` },
      { label: '总成本', sort: 'totalCost', render: (item) => formatMoney(item.totalCost) },
      { label: '开出价值', sort: 'totalValue', render: (item) => formatMoney(item.totalValue) },
      profit,
    ];
  }

  function renderPagination(pagination) {
    const totalPages = Number(pagination.totalPages || 1);
    const page = Number(pagination.page || 1);
    setText('blindBoxAnalysisPageInfo', `第 ${page} 页，共 ${totalPages} 页`);
    const container = get('blindBoxAnalysisPagination');
    if (container) container.hidden = totalPages <= 1;
    if (get('blindBoxAnalysisPrev')) get('blindBoxAnalysisPrev').disabled = page <= 1;
    if (get('blindBoxAnalysisNext')) get('blindBoxAnalysisNext').disabled = page >= totalPages;
  }

  function renderContext(hasArchivedDetails, hasLegacyArchivedDates, archiveTimeZones, timezoneMismatch) {
    setText('blindBoxAnalysisTitle', state.dateRange ? '盲盒分析' : '今日盲盒分析');
    const notice = get('blindBoxAnalysisNotice');
    if (!notice) return;
    notice.textContent = archiveTimeZones?.length
      ? `一年外记录按归档日汇总（${archiveTimeZones.join('、')}）${timezoneMismatch ? '，无法精确换算为当前时区的自然日' : ''}`
      : hasLegacyArchivedDates
      ? '含旧版历史汇总，单日统计可能存在时区偏差'
      : hasArchivedDetails ? '含历史汇总，过期逐笔记录不可用' : '';
    notice.hidden = !notice.textContent;
  }

  function renderLoading() {
    document.querySelector('.blind-analysis-results')?.setAttribute('aria-busy', 'true');
    const body = get('blindBoxAnalysisBody');
    if (body) body.innerHTML = '<tr><td class="blind-analysis-empty">正在读取盲盒数据…</td></tr>';
  }

  function renderError(message, retry) {
    document.querySelector('.blind-analysis-results')?.setAttribute('aria-busy', 'false');
    const body = get('blindBoxAnalysisBody');
    if (body)
      body.innerHTML = `<tr><td class="blind-analysis-empty"><strong>数据读取失败</strong><span>${escapeHtml(message)}</span><button type="button" id="blindBoxAnalysisRetry">重新读取</button></td></tr>`;
    get('blindBoxAnalysisRetry')?.addEventListener('click', retry);
  }

  function closeCompetingLayers() {
    get('giftHistoryDrawer')?.classList.remove('open');
    get('giftHistoryBackdrop')?.classList.remove('open');
    get('playbackDrawer')?.classList.remove('open');
    get('playbackDrawerBackdrop')?.classList.remove('open');
    get('queuePopup')?.classList.remove('open');
    get('queuePopupBackdrop')?.classList.remove('open');
    get('playerFullscreen')?.classList.remove('open');
    document.body.classList.remove('player-fs-open');
  }

  function formatProfit(value) {
    const amount = Number(value || 0);
    return `${amount > 0 ? '+' : amount < 0 ? '-' : ''}${formatMoney(Math.abs(amount))}`;
  }

  function profitClass(item) {
    return Number(item.profit || 0) > 0 ? 'profit-up' : Number(item.profit || 0) < 0 ? 'profit-down' : '';
  }

  function get(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const element = get(id);
    if (element) element.textContent = value;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { open, close, refreshIfOpen };
})();
