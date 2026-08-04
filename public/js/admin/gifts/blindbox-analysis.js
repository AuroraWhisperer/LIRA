// 盲盒分析工作区：独立管理筛选、视图、分页和请求生命周期。
'use strict';

import { eventBus, Events } from '../../shared/event-bus.js';

(function () {
  const { escapeHtml, escapeAttr, formatDateTime, formatMoney, readJsonResponse } = window.AdminApp.utils;
  const PAGE_SIZE = 25;
  const REFRESH_DELAY_MS = 500;
  const VIEW_META = {
    users: { title: '观众排行', unit: '人' },
    boxes: { title: '盲盒汇总', unit: '种' },
    records: { title: '开盒记录', unit: '条' }
  };
  const state = {
    open: false,
    viewer: '',
    box: '',
    view: 'users',
    page: 1,
    requestId: 0,
    controller: null,
    refreshTimer: null,
    returnFocus: null
  };

  function init() {
    const workspace = get('blindBoxAnalysisWorkspace');
    if (!workspace || workspace.dataset.initialized === 'true') return;
    workspace.dataset.initialized = 'true';

    get('blindBoxAnalysisClose')?.addEventListener('click', close);
    initSelect('blindBoxAnalysisViewer', 'viewer');
    initSelect('blindBoxAnalysisBox', 'box');
    get('blindBoxAnalysisClear')?.addEventListener('click', () => {
      state.viewer = '';
      state.box = '';
      state.page = 1;
      load();
    });
    workspace.querySelectorAll('[data-blind-analysis-view]').forEach(button => {
      button.addEventListener('click', () => {
        state.view = button.dataset.blindAnalysisView;
        state.page = 1;
        load();
      });
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
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !state.open) return;
      const openButton = document.querySelector('.blind-analysis-select[aria-expanded="true"]');
      if (closeSelects()) openButton?.focus();
      else close();
    });
    document.addEventListener('click', event => {
      if (state.open && !event.target.closest('.blind-analysis-filter')) closeSelects();
    });
    eventBus.on(Events.GIFT_RECEIVED, refreshIfOpen);
  }

  function open(filters = {}) {
    const workspace = get('blindBoxAnalysisWorkspace');
    if (!workspace) return;
    closeCompetingLayers();
    state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.viewer = typeof filters.viewer === 'string' ? filters.viewer : '';
    state.box = typeof filters.box === 'string' ? filters.box : '';
    state.view = Object.hasOwn(VIEW_META, filters.view) ? filters.view : 'users';
    state.page = 1;
    state.open = true;
    workspace.hidden = false;
    document.body.classList.add('blind-analysis-open');
    get('blindBoxAnalysisTitle')?.focus();
    load();
  }

  function close() {
    const workspace = get('blindBoxAnalysisWorkspace');
    if (!workspace || !state.open) return;
    state.open = false;
    state.controller?.abort();
    clearTimeout(state.refreshTimer);
    workspace.hidden = true;
    document.body.classList.remove('blind-analysis-open');
    state.returnFocus?.focus?.();
  }

  function refreshIfOpen() {
    if (!state.open) return;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => load({ quiet: true }), REFRESH_DELAY_MS);
  }

  async function load({ quiet = false } = {}) {
    if (!state.open) return;
    const requestId = ++state.requestId;
    state.controller?.abort();
    state.controller = new AbortController();
    if (!quiet) renderLoading();

    const params = new URLSearchParams({
      view: state.view,
      page: String(state.page),
      limit: String(PAGE_SIZE)
    });
    if (state.viewer) params.set('viewer', state.viewer);
    if (state.box) params.set('box', state.box);

    try {
      const response = await fetch(`/api/gifts/blind-box-analysis?${params}`, {
        signal: state.controller.signal
      });
      const payload = await readJsonResponse(response, '盲盒分析读取失败');
      if (!response.ok || !payload.ok) throw new Error(payload.error || '盲盒分析读取失败');
      if (requestId !== state.requestId || !state.open) return;
      render(payload.data);
    } catch (error) {
      if (error.name === 'AbortError' || requestId !== state.requestId) return;
      renderError(error.message || '数据读取失败');
    }
  }

  function render(data) {
    state.page = data.pagination?.page || 1;
    state.viewer = data.filters?.selectedViewer || '';
    state.box = data.filters?.selectedBox || '';
    renderFilters(data.filters || {});
    renderSummary(data.summary || {});
    renderViewControls();
    renderTable(data.items || []);
    renderPagination(data.pagination || {});
    renderContext(data);
    const results = document.querySelector('.blind-analysis-results');
    results?.setAttribute('aria-busy', 'false');
  }

  function renderFilters(filters) {
    renderSelect('blindBoxAnalysisViewer', [
      { value: '', label: '全部观众' },
      ...(filters.viewers || [])
    ], state.viewer);
    renderSelect('blindBoxAnalysisBox', [
      { value: '', label: '全部盲盒' },
      ...(filters.boxes || []).map(name => ({ value: name, label: name }))
    ], state.box);
    const clearButton = get('blindBoxAnalysisClear');
    if (clearButton) clearButton.disabled = !state.viewer && !state.box;
  }

  function initSelect(id, stateKey) {
    const button = get(id);
    const menu = get(`${id}Menu`);
    if (!button || !menu) return;
    button.addEventListener('click', () => {
      const willOpen = menu.hidden;
      closeSelects();
      if (willOpen) openSelect(button, menu);
    });
    button.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (menu.hidden) openSelect(button, menu);
      moveOptionFocus(menu, event.key);
    });
    menu.addEventListener('click', event => {
      const option = event.target.closest('[role="option"]');
      if (option) selectOption(id, stateKey, option.dataset.value || '');
    });
    menu.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        moveOptionFocus(menu, event.key);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const option = menu.querySelector('.focused') || menu.querySelector('[aria-selected="true"]');
        if (option) selectOption(id, stateKey, option.dataset.value || '');
      } else if (event.key === 'Tab') {
        closeSelects();
      }
    });
  }

  function renderSelect(id, options, selectedValue) {
    const button = get(id);
    const menu = get(`${id}Menu`);
    if (!button || !menu) return;
    const selected = options.find(option => option.value === selectedValue) || options[0];
    button.querySelector('span').textContent = selected.label;
    menu.innerHTML = options.map(option =>
      `<div class="blind-analysis-option" role="option" tabindex="-1" data-value="${escapeAttr(option.value)}" aria-selected="${option.value === selected.value}">${escapeHtml(option.label)}</div>`
    ).join('');
  }

  function openSelect(button, menu) {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const selected = menu.querySelector('[aria-selected="true"]') || menu.firstElementChild;
    focusOption(menu, selected);
  }

  function closeSelects() {
    let closed = false;
    document.querySelectorAll('.blind-analysis-select[aria-expanded="true"]').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      const menu = get(button.getAttribute('aria-controls'));
      if (menu) menu.hidden = true;
      closed = true;
    });
    return closed;
  }

  function moveOptionFocus(menu, key) {
    const options = [...menu.querySelectorAll('[role="option"]')];
    if (!options.length) return;
    const focusedIndex = options.findIndex(option => option.classList.contains('focused'));
    const nextIndex = key === 'Home' ? 0
      : key === 'End' ? options.length - 1
        : key === 'ArrowUp' ? Math.max(0, focusedIndex - 1)
          : Math.min(options.length - 1, focusedIndex + 1);
    focusOption(menu, options[nextIndex]);
  }

  function focusOption(menu, option) {
    if (!option) return;
    menu.querySelector('.focused')?.classList.remove('focused');
    option.classList.add('focused');
    option.focus({ preventScroll: true });
    option.scrollIntoView({ block: 'nearest' });
  }

  function selectOption(id, stateKey, value) {
    state[stateKey] = value;
    state.page = 1;
    closeSelects();
    get(id)?.focus();
    load();
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
    document.querySelectorAll('[data-blind-analysis-view]').forEach(button => {
      const active = button.dataset.blindAnalysisView === state.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    setText('blindBoxAnalysisViewTitle', VIEW_META[state.view].title);
  }

  function renderTable(items) {
    const head = get('blindBoxAnalysisHead');
    const body = get('blindBoxAnalysisBody');
    if (!head || !body) return;
    const columns = getColumns(state.view);
    head.innerHTML = `<tr>${columns.map(column => `<th>${column.label}</th>`).join('')}</tr>`;
    if (items.length === 0) {
      body.innerHTML = `<tr><td colspan="${columns.length}" class="blind-analysis-empty">当前选择下还没有盲盒数据</td></tr>`;
      return;
    }
    body.innerHTML = items.map(item => `<tr>${columns.map(column => `<td${column.className ? ` class="${column.className(item)}"` : ''}>${column.render(item)}</td>`).join('')}</tr>`).join('');
  }

  function getColumns(view) {
    const money = value => formatMoney(value);
    const profit = item => formatProfit(item.profit);
    if (view === 'boxes') return [
      { label: '盲盒', render: item => `<strong>${escapeHtml(item.boxName)}</strong>` },
      { label: '盒数', render: item => String(item.boxCount) },
      { label: '观众', render: item => `${item.viewerCount} 人` },
      { label: '总成本', render: item => money(item.totalCost) },
      { label: '开出价值', render: item => money(item.totalValue) },
      { label: '观众盈亏', render: profit, className: profitClass }
    ];
    if (view === 'records') return [
      { label: '时间', render: item => formatDateTime(item.createdAt) },
      { label: '观众', render: item => `<strong>${escapeHtml(item.userName)}</strong>` },
      { label: '盲盒', render: item => escapeHtml(item.boxName) },
      { label: '开出礼物', render: item => escapeHtml(item.giftName) },
      { label: '数量', render: item => String(item.num) },
      { label: '成本', render: item => money(item.cost) },
      { label: '开出价值', render: item => money(item.value) },
      { label: '观众盈亏', render: profit, className: profitClass }
    ];
    return [
      { label: '观众', render: item => `<strong>${escapeHtml(item.userName)}</strong>` },
      { label: '盒数', render: item => String(item.boxCount) },
      { label: '盒型', render: item => `${item.boxTypeCount} 种` },
      { label: '总成本', render: item => money(item.totalCost) },
      { label: '开出价值', render: item => money(item.totalValue) },
      { label: '观众盈亏', render: profit, className: profitClass }
    ];
  }

  function renderPagination(pagination) {
    const total = Number(pagination.total || 0);
    const totalPages = Number(pagination.totalPages || 1);
    const page = Number(pagination.page || 1);
    setText('blindBoxAnalysisResultCount', `共 ${total} ${VIEW_META[state.view].unit}`);
    setText('blindBoxAnalysisPageInfo', `第 ${page} 页，共 ${totalPages} 页`);
    const container = get('blindBoxAnalysisPagination');
    if (container) container.hidden = totalPages <= 1;
    if (get('blindBoxAnalysisPrev')) get('blindBoxAnalysisPrev').disabled = page <= 1;
    if (get('blindBoxAnalysisNext')) get('blindBoxAnalysisNext').disabled = page >= totalPages;
  }

  function renderContext(data) {
    const viewerLabel = (data.filters?.viewers || []).find(item => item.value === state.viewer)?.label;
    const parts = [viewerLabel || '全部观众', state.box || '全部盲盒'];
    setText('blindBoxAnalysisSubtitle', parts.join(' · '));
    setText('blindBoxAnalysisUpdated', `刚刚更新`);
  }

  function renderLoading() {
    document.querySelector('.blind-analysis-results')?.setAttribute('aria-busy', 'true');
    const body = get('blindBoxAnalysisBody');
    if (body) body.innerHTML = '<tr><td class="blind-analysis-empty">正在读取今天的数据…</td></tr>';
  }

  function renderError(message) {
    document.querySelector('.blind-analysis-results')?.setAttribute('aria-busy', 'false');
    const body = get('blindBoxAnalysisBody');
    if (body) body.innerHTML = `<tr><td class="blind-analysis-empty"><strong>数据读取失败</strong><span>${escapeHtml(message)}</span><button type="button" id="blindBoxAnalysisRetry">重新读取</button></td></tr>`;
    get('blindBoxAnalysisRetry')?.addEventListener('click', () => load());
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

  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts.analysis = { open, close, refreshIfOpen };
})();
