'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createLyricToggleButton,
  loadModuleExports,
} = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('unchanged background history refreshes preserve row nodes during selection', async () => {
  let renders = 0;
  const body = { set innerHTML(value) { renders += 1; } };
  const { renderGiftHistoryView } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/gifts/history-view.js'),
    { document: { getElementById: (id) => id === 'giftHistoryBody' ? body : null, querySelectorAll: () => [] } },
  );
  const ledger = { items: [{ eventId: 'synthetic-gift', gift: { giftName: '小花花', num: 1 } }],
    total: 1, page: 1, totalPages: 1, cursorHistory: [] };
  renderGiftHistoryView({ ledger });
  renderGiftHistoryView({ ledger });
  assert.equal(renders, 1);
  ledger.items[0].gift.num = 2;
  renderGiftHistoryView({ ledger });
  assert.equal(renders, 2);
});

test('gift history drawer preserves the six data columns and adds selection and independent filters', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'gifts', 'history.html'),
    'utf8',
  );

  assert.doesNotMatch(
    html,
    /giftHistorySearch|data-gift-range|gift-ledger-toolbar|gift-ledger-sync/,
  );
  assert.doesNotMatch(html, /时间范围|重置筛选|giftLedgerSyncDetail/);
  assert.doesNotMatch(html, /giftHistoryClearDisplayBtn|清理显示/);
  assert.match(html, /id="giftHistoryRetryBtn"[^>]*hidden[^>]*>\s*重新加载/);
  assert.match(html, /id="giftHistoryClearDatabaseBtn"[^>]*>\s*清空全部记录/);
  assert.match(html, /id="giftLedgerSyncStatus"[^>]*role="status"[^>]*hidden/);
  assert.match(
    html,
    /<th[^>]*data-sort="created_at"[^>]*aria-sort="none"[^>]*>\s*时间[\s\S]*?<span[^>]*class="sort-arrow"[\s\S]*?<\/th>\s*<th[^>]*data-sort="gift_name"[^>]*>\s*礼物[\s\S]*?<\/th>\s*<th[^>]*>\s*数量\s*<\/th>\s*<th[^>]*data-sort="price"[^>]*>\s*金额[\s\S]*?<\/th>\s*<th[^>]*>\s*用户\s*<\/th>\s*<th[^>]*data-sort="remarks"[^>]*>\s*备注[\s\S]*?<\/th>/,
  );
  assert.doesNotMatch(
    html,
    /giftLedgerSummary|giftLedgerTopGifts|giftLedgerTimeSeries/,
  );
  assert.doesNotMatch(html, /礼物排行|时间趋势/);
  assert.match(html, /id="giftHistoryState"[^>]*role="status"/);
  assert.match(html, /id="giftHistoryPrev"/);
  assert.match(html, /id="giftHistoryNext"/);
  assert.match(html, /← 上一页/);
  assert.match(html, /第 1\/1 页/);
  assert.match(html, /下一页 →/);
  for (const id of ['giftHistorySelectPage', 'giftHistoryUserQuery', 'giftHistoryGiftQuery', 'giftHistoryStartDate', 'giftHistoryEndDate', 'giftHistoryExport']) {
    assert.ok(html.includes(`id="${id}"`));
  }
});

test('gift history defaults to all dates and never exposes source identity', async () => {
  const modulePath = path.join(
    ROOT_DIR,
    'public',
    'js',
    'admin',
    'gifts',
    'history.js',
  );
  const source = fs.readFileSync(modulePath, 'utf8');
  const ledger = await loadModuleExports(modulePath, {
    document: {},
    location: {},
    URLSearchParams,
  });

  assert.match(source, /^export function buildGiftHistoryUrl/m);
  assert.doesNotMatch(
    source,
    /buildGiftStatisticsUrl|loadGiftStatistics|loadGiftLedger/,
  );
  assert.doesNotMatch(source, /\/api\/gifts\/statistics/);
  assert.doesNotMatch(source, /sourceId|source_id/);
  assert.doesNotMatch(source, /giftHistorySearch|data-gift-range|syncedAt/);
  assert.match(source, /清空全部礼物记录/);
  assert.match(source, /永久删除当前账号在本机和云端的全部礼物记录/);
  assert.match(source, /无法撤销/);
  assert.match(source, /礼物记录已清空/);
  assert.doesNotMatch(
    source,
    /resetGiftLedgerDisplay|giftHistoryClearDisplayBtn/,
  );
  assert.doesNotMatch(source, /重新同步当前账号的历史记录/);
  assert.equal(
    ledger.buildGiftHistoryUrl(),
    '/api/gifts/history?range=all&limit=100',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({
      cursor: 'opaque/+ token',
      limit: 50,
    }),
    '/api/gifts/history?range=all&limit=50&cursor=opaque%2F%2B+token',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({
      limit: 50,
      sortField: 'price',
      sortDirection: 'asc',
    }),
    '/api/gifts/history?range=all&limit=50&sortField=price&sortDirection=asc',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({ sortField: null, sortDirection: null }),
    '/api/gifts/history?range=all&limit=100',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({ filters: { amountAbove: '10.01' } }),
    '/api/gifts/history?range=all&limit=100&amountAbove=10.01',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({ filters: { amountAbove: 0 } }),
    '/api/gifts/history?range=all&limit=100&amountAbove=0',
  );
  assert.equal(
    ledger.buildGiftHistoryUrl({ filters: { amountAbove: '' } }),
    '/api/gifts/history?range=all&limit=100',
  );
  assert.deepEqual(
    { ...ledger.describeGiftSyncStatus('LIVE', false) },
    { state: 'live', label: '礼物记录已更新' },
  );
  assert.equal(ledger.describeGiftSyncStatus('LIVE', true).state, 'partial');
  assert.equal(
    ledger.describeGiftSyncStatus('LEGACY_PARTIAL', true).state,
    'partial',
  );
  assert.equal(ledger.describeGiftSyncStatus('OFFLINE', true).state, 'offline');
  assert.equal(ledger.describeGiftSyncStatus('ERROR', true).state, 'error');
});

test('gift history headers sort from page one with click and keyboard input', async () => {
  const modulePath = path.join(
    ROOT_DIR,
    'public',
    'js',
    'admin',
    'gifts',
    'history.js',
  );
  const elements = new Map();
  for (const id of [
    'giftHistoryOpenBtn',
    'giftHistoryClose',
    'giftHistoryBackdrop',
    'giftHistoryDrawer',
    'giftHistoryClearDatabaseBtn',
    'giftHistoryPrev',
    'giftHistoryNext',
    'giftHistoryState',
    'giftHistoryTotal',
    'giftHistoryBody',
    'giftHistoryPageInfo',
    'giftLedgerSyncStatus',
  ]) {
    elements.set(id, {
      ...createLyricToggleButton(),
      style: { setProperty() {} },
      dataset: {},
      hidden: false,
      disabled: false,
      handlers: {},
      addEventListener(type, handler) {
        this.handlers[type] = handler;
      },
      focus() {},
    });
  }
  const headers = ['created_at', 'gift_name', 'price', 'remarks'].map(
    (sort) => {
      const arrow = { textContent: '' };
      const attributes = new Map();
      return {
        dataset: { sort },
        handlers: {},
        arrow,
        attributes,
        querySelector(selector) {
          return selector === '.sort-arrow' ? arrow : null;
        },
        setAttribute(name, value) {
          attributes.set(name, value);
        },
        addEventListener(type, handler) {
          this.handlers[type] = handler;
        },
      };
    },
  );
  const requests = [];
  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      return selector === '#giftHistoryDrawer th[data-sort]' ? headers : [];
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
  };
  const ledger = await loadModuleExports(modulePath, {
    document,
    location: {},
    URLSearchParams,
    AbortController,
    AbortSignal,
    clearTimeout() {},
    setTimeout() {},
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            data: {
              items: [],
              hasMore: false,
              total: 0,
              totalPages: 1,
              syncState: 'LIVE',
              partial: false,
            },
          }),
      };
    },
  });

  ledger.initGiftHistoryDrawer();
  assert.equal(
    headers.every((header) => header.attributes.get('aria-sort') === 'none'),
    true,
  );
  elements.get('giftHistoryOpenBtn').handlers.click();
  await new Promise(setImmediate);
  headers[1].handlers.click();
  await new Promise(setImmediate);
  assert.equal(
    requests.at(-1),
    '/api/gifts/history?range=all&limit=100&sortField=gift_name&sortDirection=asc',
  );
  assert.equal(headers[1].attributes.get('aria-sort'), 'ascending');
  assert.equal(headers[1].arrow.textContent, ' ▲');
  assert.equal(headers[0].attributes.get('aria-sort'), 'none');
  headers[1].handlers.click();
  await new Promise(setImmediate);
  assert.equal(
    requests.at(-1),
    '/api/gifts/history?range=all&limit=100&sortField=gift_name&sortDirection=desc',
  );
  headers[1].handlers.click();
  await new Promise(setImmediate);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=100');
  assert.equal(
    headers.every((header) => header.attributes.get('aria-sort') === 'none'),
    true,
  );
  assert.equal(
    headers.every((header) => header.arrow.textContent === ''),
    true,
  );
  headers[2].handlers.keydown({
    key: 'Enter',
    preventDefault() {},
  });
  await new Promise(setImmediate);
  assert.equal(
    requests.at(-1),
    '/api/gifts/history?range=all&limit=100&sortField=price&sortDirection=asc',
  );
  headers[2].handlers.keydown({
    key: ' ',
    preventDefault() {},
  });
  await new Promise(setImmediate);
  assert.equal(
    requests.at(-1),
    '/api/gifts/history?range=all&limit=100&sortField=price&sortDirection=desc',
  );
  headers[2].handlers.keydown({ key: 'Enter', preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=100');
  assert.equal(headers[2].attributes.get('aria-sort'), 'none');
  for (const header of [headers[0], headers[3]]) {
    for (const direction of ['asc', 'desc', null]) {
      header.handlers.click();
      await new Promise(setImmediate);
      const params = new URL(requests.at(-1), 'http://localhost').searchParams;
      const isDefault =
        direction === null ||
        (header.dataset.sort === 'created_at' && direction === 'desc');
      assert.equal(
        params.get('sortField'),
        isDefault ? null : header.dataset.sort,
      );
      assert.equal(params.get('sortDirection'), isDefault ? null : direction);
      assert.equal(
        header.attributes.get('aria-sort'),
        direction === null
          ? 'none'
          : direction === 'asc'
            ? 'ascending'
            : 'descending',
      );
    }
  }
  assert.equal(
    requests.some((url) => /source(?:Id|_id)/u.test(url)),
    false,
  );
});

test('loadGiftHistory requests one history page and renders canonical escaped rows', async () => {
  const modulePath = path.join(
    ROOT_DIR,
    'public',
    'js',
    'admin',
    'gifts',
    'history.js',
  );
  const elements = new Map(
    [
      'giftHistoryState',
      'giftHistoryTotal',
      'giftHistoryBody',
      'giftHistoryPrev',
      'giftHistoryNext',
      'giftHistoryPageInfo',
      'giftLedgerSyncStatus',
    ].map((id) => [
      id,
      { dataset: {}, disabled: false, innerHTML: '', textContent: '' },
    ]),
  );
  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  const requests = [];
  const ledger = await loadModuleExports(modulePath, {
    document,
    location: {},
    URLSearchParams,
    AbortController,
    AbortSignal,
    clearTimeout() {},
    setTimeout() {},
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            data: {
              items: [
                {
                  eventId: 'event-escaped',
                  gift: {
                    createdAt: '2025-01-02T03:04:05.000Z',
                    giftName: '<script>alert("gift")</script>',
                    num: 2,
                    totalPrice: 12.56,
                    userName: 'Alice & <img src=x>',
                    isBlindBox: true,
                    blindProfit: -3.56,
                    blindBoxName: 'Box <one>',
                  },
                },
                {
                  eventId: 'event-unknown-cost',
                  gift: {
                    createdAt: '2025-01-03T03:04:05.000Z',
                    giftName: '心动盲盒',
                    num: 1,
                    totalPrice: 0,
                    userName: 'Bob',
                    isBlindBox: true,
                    blindProfit: null,
                  },
                },
              ],
              nextCursor: 'next-page-token',
              hasMore: true,
              total: 52,
              totalPages: 2,
              syncState: 'LIVE',
              partial: false,
              syncedAt: '2025-01-03T04:05:06.000Z',
            },
          }),
      };
    },
  });

  await ledger.loadGiftHistory();

  assert.deepEqual(requests, ['/api/gifts/history?range=all&limit=100']);
  const body = elements.get('giftHistoryBody').innerHTML;
  const renderedRows = [
    ...body.matchAll(/<tr data-event-id="[^"]*">([\s\S]*?)<\/tr>/g),
  ];
  assert.equal(renderedRows.length, 2);
  assert.deepEqual(
    renderedRows.map(([, row]) => (row.match(/<td\b/g) || []).length),
    [7, 7],
  );
  assert.match(body, /&lt;script&gt;alert\(&quot;gift&quot;\)&lt;\/script&gt;/);
  assert.match(body, /Alice &amp; &lt;img src=x&gt;/);
  assert.doesNotMatch(body, /<script>alert\("gift"\)<\/script>/);
  assert.match(body, /2<\/td>\s*<td>¥12\.56<\/td>/);
  assert.match(body, /盲盒 -¥3\.56/);
  assert.match(body, /<td>¥0\.0<\/td>/);
  assert.match(body, /Box &lt;one&gt;/);
  assert.match(body, /盲盒 成本未知/);

  assert.equal(elements.get('giftHistoryTotal').textContent, '共 52 条');
  assert.equal(elements.get('giftHistoryState').textContent, '已加载');
  assert.equal(elements.get('giftHistoryPrev').disabled, true);
  assert.equal(elements.get('giftHistoryNext').disabled, false);
  assert.equal(elements.get('giftHistoryPageInfo').textContent, '第 1/2 页');
  assert.equal(elements.get('giftLedgerSyncStatus').dataset.state, 'live');
  assert.equal(elements.get('giftLedgerSyncStatus').hidden, true);
  assert.equal(
    elements.get('giftLedgerSyncStatus').textContent,
    '礼物记录已更新',
  );
});

test('gift history keeps cursor navigation, ignores responses after close, and reloads on reopen', async () => {
  const elements = new Map();
  for (const id of [
    'giftHistoryOpenBtn',
    'giftHistoryClose',
    'giftHistoryBackdrop',
    'giftHistoryDrawer',
    'giftHistoryPrev',
    'giftHistoryNext',
    'giftHistoryState',
    'giftHistoryTotal',
    'giftHistoryBody',
    'giftHistoryPageInfo',
    'giftLedgerSyncStatus',
  ]) {
    elements.set(id, {
      ...createLyricToggleButton(),
      style: { setProperty() {} },
      dataset: {},
      handlers: {},
      addEventListener(type, handler) {
        this.handlers[type] = handler;
      },
      focus() {
        this.focused = true;
      },
    });
  }
  const requests = [];
  const pending = [];
  const ledger = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'history.js'),
    {
      document: {
        getElementById: (id) => elements.get(id) || null,
        querySelector: () => null,
        addEventListener() {},
      },
      location: {},
      URLSearchParams,
      AbortController,
      AbortSignal,
      clearTimeout() {},
      setTimeout() {},
      fetch: (url) => {
        requests.push(url);
        return new Promise((resolve) => pending.push(resolve));
      },
    },
  );
  const click = (id) => elements.get(id).handlers.click();
  const finishRequest = async (data) => {
    pending.shift()({
      ok: true,
      text: async () => JSON.stringify({ ok: true, data }),
    });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const firstPage = {
    items: [{ eventId: 'first', gift: { giftName: '测试礼物' } }],
    hasMore: true,
    nextCursor: 'page-2',
    total: 2,
    totalPages: 2,
    syncState: 'LIVE',
    partial: false,
  };

  ledger.initGiftHistoryDrawer();
  click('giftHistoryOpenBtn');
  await finishRequest(firstPage);
  assert.equal(elements.get('giftHistoryClose').focused, true);
  assert.match(elements.get('giftHistoryBody').innerHTML, /测试礼物/);
  click('giftHistoryNext');
  await finishRequest({
    items: [{ eventId: 'second', gift: { giftName: '另一礼物' } }],
    total: 2,
    totalPages: 2,
    syncState: 'OFFLINE',
    partial: true,
  });
  assert.equal(
    requests.at(-1),
    '/api/gifts/history?range=all&limit=100&cursor=page-2',
  );
  assert.equal(elements.get('giftHistoryPageInfo').textContent, '第 2/2 页');
  assert.equal(elements.get('giftLedgerSyncStatus').hidden, false);
  assert.equal(
    elements.get('giftLedgerSyncStatus').textContent,
    '当前离线，显示已保存的记录',
  );
  click('giftHistoryPrev');
  await finishRequest(firstPage);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=100');
  assert.equal(elements.get('giftHistoryPageInfo').textContent, '第 1/2 页');

  click('giftHistoryNext');
  const countBeforeClose = requests.length;
  click('giftHistoryClose');
  const bodyBeforeResponse = elements.get('giftHistoryBody').innerHTML;
  await finishRequest(firstPage);
  assert.equal(requests.length, countBeforeClose);
  assert.equal(elements.get('giftHistoryBody').innerHTML, bodyBeforeResponse);
  assert.doesNotMatch(elements.get('giftHistoryBody').innerHTML, /测试礼物/);
  assert.equal(elements.get('giftHistoryPrev').disabled, true);
  assert.equal(elements.get('giftHistoryNext').disabled, true);
  assert.equal(elements.get('giftLedgerSyncStatus').hidden, true);

  assert.equal(elements.get('giftHistoryOpenBtn').focused, true);
  click('giftHistoryOpenBtn');
  await finishRequest(firstPage);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=100');
  assert.match(elements.get('giftHistoryBody').innerHTML, /测试礼物/);
});
