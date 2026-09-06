'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');
const {
  createLyricToggleButton,
  loadModuleExports,
  response,
} = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

function runnableRecentScript(source) {
  return `const eventBus = window.AdminApp.eventBus || { on: () => () => {} };
const Events = { GIFT_CATALOG_UPDATED: 'gift:catalog_updated' };
const getLegacyAdminModules = () => window.AdminApp;
${source.replace(/^import .*?;\r?\n/gm, '')}`;
}

async function flushBlindboxTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function createBlindboxFixture({
  roomId = '',
  loggedIn = false,
} = {}) {
  const container = { innerHTML: '' };
  const textarea = { value: '[]' };
  const status = { textContent: '' };
  const windowListeners = new Map();
  const documentListeners = new Map();
  const refreshRequests = [];
  let currentRoomId = roomId;
  let currentAuthState = { loggedIn };

  const document = {
    readyState: 'loading',
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    },
    dispatchEvent(event) {
      documentListeners.get(event.type)?.(event);
    },
    getElementById(id) {
      return {
        blindBoxList: container,
        giftBlindBoxCustomConfigV2: textarea,
        blindBoxMappingStatus: status,
      }[id] || null;
    },
  };
  const window = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    },
    dispatchEvent(event) {
      windowListeners.get(event.type)?.(event);
    },
    AdminApp: {
      utils: {
        escapeHtml: (value) => String(value),
        escapeAttr: (value) => String(value),
        formatTime: (value) => String(value),
        formatMoney: (value) => String(value),
        readJsonResponse: async (result) => result.payload,
      },
      state: {
        getAppState: () => ({
          settings: { roomId: currentRoomId },
          blindBoxMapping: { mode: 'v2', applied: true, customCount: 1 },
        }),
      },
      gifts: { recent: { getBlindBoxIcon: () => null } },
    },
    bilibiliAuth: {
      getAuthState: async () => currentAuthState,
    },
  };

  const fetchCalls = [];
  const fetch = (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === '/api/overtime/gifts/catalog') {
      return Promise.resolve(response({
        ok: true,
        data: { schemaVersion: 2, gifts: [], blindBoxes: [] },
      }));
    }
    if (url === '/api/overtime/gifts/refresh') {
      return new Promise((resolve) => refreshRequests.push({ resolve, options }));
    }
    return Promise.resolve(response({ ok: true, data: {} }));
  };

  await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'),
    { document, window, fetch },
  );
  await flushBlindboxTasks();

  return {
    container,
    textarea,
    status,
    window,
    document,
    fetchCalls,
    refreshRequests,
    setAuth(nextAuthState) {
      currentAuthState = nextAuthState;
    },
    dispatchSettings(nextRoomId) {
      currentRoomId = nextRoomId;
      window.dispatchEvent({
        type: 'app:settings-state',
        detail: { roomId: nextRoomId },
      });
    },
    dispatchAuthChanged() {
      document.dispatchEvent({ type: 'app:bilibili-auth-changed' });
    },
    async resolveRefresh(data) {
      const request = refreshRequests.shift();
      assert.ok(request, 'expected a pending blind-box refresh request');
      request.resolve(response({ ok: true, data }));
      await flushBlindboxTasks();
    },
    module: window.AdminApp.gifts.blindbox,
  };
}

test('gift workspace exposes one page heading and seven semantic panel titles', () => {
  const page = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'gifts', 'page.html'),
    'utf8',
  );
  const styles = [
    readCssBundle('public', 'css', 'admin', 'gifts.css'),
    readCssBundle('public', 'css', 'admin', 'workspace.css'),
  ].join('\n');

  assert.doesNotMatch(page, /<h1 class="ui-page-title">礼物<\/h1>/);
  assert.equal(
    (page.match(/class="gift-section-title ui-section-title"/g) || []).length,
    7,
  );
  assert.match(styles, /\.gift-recent-heading \.gift-section-title\s*\{/);
  assert.match(styles, /\.blind-stats-heading \.gift-section-title\s*\{/);
  assert.doesNotMatch(
    styles,
    /\.(?:gift-recent-heading|blind-stats-heading) h3\s*\{/,
  );
  assert.match(
    styles,
    /\.app-shell \.gift-page \.panel-header h2\s*\{[\s\S]*?font-size:\s*var\(--type-size-section-title\)/,
  );
});

test('admin blind box summary shows one row per viewer and opens analysis', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'),
    'utf8',
  );

  assert.match(html, /id="blindBoxAnalysisOpenBtn"/);
  assert.match(html, /title="查看完整盲盒分析"/);
  assert.match(html, /<th>观众<\/th>\s*<th>盒数<\/th>\s*<th>盒型<\/th>/);
  assert.match(
    html,
    /<th>总成本<\/th>\s*<th>开出价值<\/th>\s*<th>观众盈亏<\/th>/,
  );
  assert.doesNotMatch(html, /id="blindBoxStatsTable"[\s\S]*?<th>时间<\/th>/);
  assert.match(source, /const users = Array\.isArray\(perUser\)/);
  assert.match(source, /data-viewer=/);
  assert.match(source, /analysis\?\.open/);
  assert.match(source, /closest\('#blindBoxAnalysisOpenBtn'/);
});

test('blind box summary refreshes on gift events and coalesces in-flight updates', async () => {
  const { EventBus } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'event-bus.js'),
  );
  const section = { dataset: {}, querySelector: () => null };
  const summary = { innerHTML: '', closest: () => section };
  const body = { innerHTML: '', addEventListener() {} };
  const pending = [];
  let statsRequests = 0;
  const window = {
    addEventListener() {},
    AdminApp: {
      eventBus: new EventBus(),
      utils: {
        escapeHtml: String,
        escapeAttr: String,
        formatMoney: (value) => Number(value).toFixed(2),
        readJsonResponse: async (result) => result.payload,
      },
    },
  };
  await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'),
    {
      window,
      document: {
        readyState: 'complete',
        addEventListener() {},
        querySelector: () => section,
        getElementById: (id) => ({
          blindBoxStatsSummary: summary,
          blindBoxStatsBody: body,
        })[id] || null,
      },
      fetch: (url) => {
        if (url !== '/api/gifts/blind-box-stats') {
          return Promise.resolve(response({ ok: true, data: { gifts: [] } }));
        }
        statsRequests += 1;
        return new Promise((resolve) => pending.push(resolve));
      },
    },
  );
  const empty = {
    summary: { boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 },
    perUser: [],
  };
  const finishRequest = async (data) => {
    pending.shift()(response({ ok: true, data }));
    await new Promise(setImmediate);
  };

  assert.equal(statsRequests, 1);
  await finishRequest(empty);
  assert.equal(section.dataset.state, 'empty');

  const eventBus = window.AdminApp.eventBus;
  eventBus.emit('state:loaded', { state: {} });
  assert.equal(statsRequests, 1);
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(statsRequests, 2);
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  eventBus.emit('gift:received', { reason: 'bilibili:gift' });
  assert.equal(statsRequests, 2);
  await finishRequest(empty);
  assert.equal(statsRequests, 3);
  await finishRequest({
    summary: { boxCount: 2, totalCost: 48, totalValue: 49, totalProfit: 1 },
    perUser: [{
      userName: 'Test viewer',
      viewer: 'name:Test viewer',
      boxCount: 2,
      boxTypeCount: 2,
      totalCost: 48,
      totalValue: 49,
      totalProfit: 1,
    }],
  });
  assert.equal(section.dataset.state, 'ready');
  assert.match(summary.innerHTML, /<strong>48\.00<\/strong>/);
  assert.match(summary.innerHTML, /<strong>49\.00<\/strong>/);
  assert.match(summary.innerHTML, /<strong>\+1\.00<\/strong>/);
  assert.match(body.innerHTML, /Test viewer/);
  assert.match(body.innerHTML, /<td>2<\/td>/);

  window.AdminApp.gifts.blindbox.initBlindBoxStatsToggle();
  assert.equal(eventBus.listenerCount('gift:received'), 1);
  assert.equal(statsRequests, 3);
  eventBus.emit('gift:received', { reason: 'database:clear-gifts' });
  assert.equal(statsRequests, 4);
  await finishRequest(empty);
  assert.equal(section.dataset.state, 'empty');
  assert.doesNotMatch(body.innerHTML, /Test viewer/);
});

test('gift history drawer restores the 3.x table without search or date toolbars', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'gifts', 'history.html'),
    'utf8',
  );

  assert.doesNotMatch(html, /giftHistorySearch|data-gift-range|gift-ledger-toolbar|gift-ledger-sync/);
  assert.doesNotMatch(html, /时间范围|重置筛选|giftLedgerSyncDetail/);
  assert.match(html, /id="giftHistoryClearDisplayBtn"[^>]*>\s*清理显示\s*<\/button>/);
  assert.match(html, /id="giftLedgerSyncStatus"[^>]*role="status"[^>]*hidden/);
  assert.match(
    html,
    /<th[^>]*>时间<\/th>\s*<th[^>]*>礼物<\/th>\s*<th[^>]*>数量<\/th>\s*<th[^>]*>金额<\/th>\s*<th[^>]*>用户<\/th>\s*<th[^>]*>备注<\/th>/,
  );
  assert.doesNotMatch(html, /giftLedgerSummary|giftLedgerTopGifts|giftLedgerTimeSeries/);
  assert.doesNotMatch(html, /礼物排行|时间趋势/);
  assert.match(html, /id="giftHistoryState"[^>]*role="status"/);
  assert.match(html, /id="giftHistoryPrev"/);
  assert.match(html, /id="giftHistoryNext"/);
});

test('gift history always requests all dates and never exposes source identity', async () => {
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
  assert.doesNotMatch(source, /buildGiftStatisticsUrl|loadGiftStatistics|loadGiftLedger/);
  assert.doesNotMatch(source, /\/api\/gifts\/statistics/);
  assert.doesNotMatch(source, /sourceId|source_id/);
  assert.doesNotMatch(source, /giftHistorySearch|data-gift-range|syncedAt/);
  assert.equal(ledger.buildGiftHistoryUrl(), '/api/gifts/history?range=all&limit=50');
  assert.equal(
    ledger.buildGiftHistoryUrl({
      cursor: 'opaque/+ token',
      limit: 50,
    }),
    '/api/gifts/history?range=all&limit=50&cursor=opaque%2F%2B+token',
  );
  assert.deepEqual(
    { ...ledger.describeGiftSyncStatus('LIVE', false) },
    { state: 'live', label: '历史记录已同步' },
  );
  assert.equal(ledger.describeGiftSyncStatus('LIVE', true).state, 'partial');
  assert.equal(
    ledger.describeGiftSyncStatus('LEGACY_PARTIAL', true).state,
    'partial',
  );
  assert.equal(
    ledger.describeGiftSyncStatus('OFFLINE', true).state,
    'offline',
  );
  assert.equal(ledger.describeGiftSyncStatus('ERROR', true).state, 'error');
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
                    totalPrice: 12.5,
                    userName: 'Alice & <img src=x>',
                    isBlindBox: true,
                    blindProfit: -3.5,
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
              syncState: 'LIVE',
              partial: false,
              syncedAt: '2025-01-03T04:05:06.000Z',
            },
          }),
      };
    },
  });

  await ledger.loadGiftHistory();

  assert.deepEqual(requests, ['/api/gifts/history?range=all&limit=50']);
  const body = elements.get('giftHistoryBody').innerHTML;
  const renderedRows = [
    ...body.matchAll(/<tr data-event-id="[^"]*">([\s\S]*?)<\/tr>/g),
  ];
  assert.equal(renderedRows.length, 2);
  assert.deepEqual(
    renderedRows.map(([, row]) => (row.match(/<td\b/g) || []).length),
    [6, 6],
  );
  assert.match(body, /&lt;script&gt;alert\(&quot;gift&quot;\)&lt;\/script&gt;/);
  assert.match(body, /Alice &amp; &lt;img src=x&gt;/);
  assert.doesNotMatch(body, /<script>alert\("gift"\)<\/script>/);
  assert.match(body, /2<\/td>\s*<td>¥12\.50<\/td>/);
  assert.match(body, /盲盒 -¥3\.50/);
  assert.match(body, /Box &lt;one&gt;/);
  assert.match(body, /盲盒 成本未知/);

  assert.equal(elements.get('giftHistoryTotal').textContent, '本页 2 条');
  assert.equal(elements.get('giftHistoryState').textContent, '已加载');
  assert.equal(elements.get('giftHistoryPrev').disabled, true);
  assert.equal(elements.get('giftHistoryNext').disabled, false);
  assert.equal(elements.get('giftHistoryPageInfo').textContent, '第 1 页');
  assert.equal(elements.get('giftLedgerSyncStatus').dataset.state, 'live');
  assert.equal(elements.get('giftLedgerSyncStatus').hidden, true);
  assert.equal(
    elements.get('giftLedgerSyncStatus').textContent,
    '历史记录已同步',
  );
});

test('clear display resets the displayed rows and cursor history without deleting data', async () => {
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
  const state = ledger.createGiftLedgerState();
  state.cursor = 'next-token';
  state.nextCursor = 'following-token';
  state.page = 3;
  state.items = [{ eventId: 'event-1' }];
  state.hasMore = true;
  state.cursorHistory.push(null, 'previous-token');

  ledger.resetGiftLedgerDisplay(state);

  assert.equal(state.cursor, null);
  assert.equal(state.nextCursor, null);
  assert.equal(state.page, 1);
  assert.equal(state.hasMore, false);
  assert.deepEqual(Array.from(state.items), []);
  assert.deepEqual(Array.from(state.cursorHistory), []);
  assert.doesNotMatch(source, /\/api\/gifts\/clear-recent/);
});

test('gift history keeps cursor navigation, ignores responses after clear, and reloads on reopen', async () => {
  const elements = new Map();
  for (const id of [
    'giftHistoryOpenBtn', 'giftHistoryClose', 'giftHistoryBackdrop',
    'giftHistoryDrawer', 'giftHistoryClearDisplayBtn', 'giftHistoryPrev',
    'giftHistoryNext', 'giftHistoryState', 'giftHistoryTotal',
    'giftHistoryBody', 'giftHistoryPageInfo', 'giftLedgerSyncStatus',
  ]) {
    elements.set(id, {
      ...createLyricToggleButton(),
      dataset: {},
      handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      focus() { this.focused = true; },
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
    syncState: 'LIVE',
    partial: false,
  };

  ledger.initGiftHistoryDrawer();
  click('giftHistoryOpenBtn');
  await finishRequest(firstPage);
  assert.equal(elements.get('giftHistoryClose').focused, true);
  assert.match(elements.get('giftHistoryBody').innerHTML, /测试礼物/);
  click('giftHistoryNext');
  await finishRequest({ items: [], syncState: 'OFFLINE', partial: true });
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=50&cursor=page-2');
  assert.equal(elements.get('giftHistoryPageInfo').textContent, '第 2 页');
  assert.equal(elements.get('giftLedgerSyncStatus').hidden, false);
  assert.equal(elements.get('giftLedgerSyncStatus').textContent, '离线，正在显示本地记录');
  click('giftHistoryPrev');
  await finishRequest(firstPage);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=50');
  assert.equal(elements.get('giftHistoryPageInfo').textContent, '第 1 页');

  click('giftHistoryNext');
  const countBeforeClear = requests.length;
  click('giftHistoryClearDisplayBtn');
  await finishRequest(firstPage);
  assert.equal(requests.length, countBeforeClear);
  assert.match(elements.get('giftHistoryBody').innerHTML, /已清理显示/);
  assert.doesNotMatch(elements.get('giftHistoryBody').innerHTML, /测试礼物/);
  assert.equal(elements.get('giftHistoryPrev').disabled, true);
  assert.equal(elements.get('giftHistoryNext').disabled, true);
  assert.equal(elements.get('giftLedgerSyncStatus').hidden, true);

  click('giftHistoryClose');
  assert.equal(elements.get('giftHistoryOpenBtn').focused, true);
  click('giftHistoryOpenBtn');
  await finishRequest(firstPage);
  assert.equal(requests.at(-1), '/api/gifts/history?range=all&limit=50');
  assert.match(elements.get('giftHistoryBody').innerHTML, /测试礼物/);
});

test('blind box analysis is a separate accessible workspace module', () => {
  const html = readAdminHtml();
  const entry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'),
    'utf8',
  );
  const stylesEntry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'),
    'utf8',
  );
  const source = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'admin',
      'gifts',
      'blindbox-analysis.js',
    ),
    'utf8',
  );

  assert.match(entry, /import '\.\/gifts\/blindbox-analysis\.js';/);
  assert.match(stylesEntry, /admin\/blindbox-analysis\.css/);
  assert.match(
    html,
    /id="blindBoxAnalysisWorkspace"[^>]*role="region"[^>]*aria-labelledby="blindBoxAnalysisTitle"/,
  );
  assert.doesNotMatch(html, /id="blindBoxAnalysisWorkspace"[^>]*aria-modal/);
  assert.match(
    html,
    /id="blindBoxAnalysisClose"[^>]*aria-label="关闭盲盒分析"/,
  );
  assert.match(html, /id="blindBoxAnalysisViewer"/);
  assert.match(html, /id="blindBoxAnalysisBox"/);
  assert.match(html, /id="blindBoxAnalysisViewer"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="blindBoxAnalysisViewerMenu"[^>]*role="listbox"/);
  assert.match(html, /id="blindBoxAnalysisBoxMenu"[^>]*role="listbox"/);
  assert.match(html, /data-blind-analysis-view="users"/);
  assert.match(html, /data-blind-analysis-view="boxes"/);
  assert.match(html, /data-blind-analysis-view="records"/);
  assert.match(html, /id="blindBoxAnalysisBody"/);
  assert.match(html, /id="blindBoxAnalysisPrev"/);
  assert.match(html, /id="blindBoxAnalysisNext"/);
  assert.match(source, /refreshIfOpen/);
  assert.match(source, /AbortController/);
  assert.match(source, /setTimeout/);
});

test('blind box analysis refreshes only for gift snapshot reasons', () => {
  const stateSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'state.js'),
    'utf8',
  );
  const analysisSource = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'admin',
      'gifts',
      'blindbox-analysis.js',
    ),
    'utf8',
  );

  assert.match(stateSource, /isGiftSnapshotReason\(payload\.reason\)/);
  assert.match(stateSource, /eventBus\.emit\(Events\.GIFT_RECEIVED/);
  assert.match(
    analysisSource,
    /eventBus\.on\(Events\.GIFT_RECEIVED, refreshIfOpen\)/,
  );
  assert.match(analysisSource, /REFRESH_DELAY_MS = 500/);
  assert.doesNotMatch(analysisSource, /Events\.STATE_LOADED/);
});

test('gift notifications detect delayed records that are not first in the list', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'notification.js'),
    'utf8',
  );
  const toasts = [];
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatMoney: (value) => `¥${Number(value).toFixed(2)}`,
          showStackedToast: (options) => toasts.push(options),
        },
      },
    },
    document: {
      getElementById: () => ({ checked: true }),
    },
  };
  vm.runInNewContext(source, sandbox);
  const notify = sandbox.window.AdminApp.gifts.notification.notifyNewGift;
  const newestByTime = {
    id: 10,
    gift_id: '1',
    gift_name: 'Rose',
    user_name: 'Alice',
    num: 1,
    total_price: 1,
  };

  notify([newestByTime]);
  notify([
    newestByTime,
    {
      id: 11,
      gift_id: '2',
      gift_name: 'Delayed Gift',
      user_name: 'Bob',
      num: 1,
      total_price: 2,
    },
  ]);

  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].key, 'gift:11:1:2');
  assert.match(toasts[0].html, /Delayed Gift/);
  assert.match(toasts[0].html, />¥2\.00<\/span>/);
  assert.doesNotMatch(toasts[0].html, /¥¥/);
});

test('admin overlay links always use the IPv4 loopback host and current port', () => {
  const html = readAdminHtml();
  const utilitySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'),
    'utf8',
  );
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8',
  );
  const settingsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
    'utf8',
  );

  assert.doesNotMatch(html, /localhost:3000\/blindbox/);
  assert.doesNotMatch(displaySource, /localhost:3000/);
  assert.doesNotMatch(settingsSource, /localhost:3000/);
  assert.doesNotMatch(
    displaySource,
    /replace\(['"]127\.0\.0\.1['"],\s*['"]localhost['"]\)/,
  );
  assert.match(
    utilitySource,
    /function localOverlayOrigin\(locationLike = location\)/,
  );
  assert.match(utilitySource, /127\.0\.0\.1/);
  assert.match(displaySource, /localOverlayOrigin\(location\)/);
  assert.match(settingsSource, /localOverlayOrigin\(locationRef\)/);
  assert.doesNotMatch(displaySource, /location\.origin/);
  assert.doesNotMatch(settingsSource, /location\.host/);
});

test('blindbox broadcast controls live below gift profit stats', () => {
  const html = readAdminHtml();
  const giftPageStart = html.indexOf('<section id="giftAssistantPage"');
  const statsStart = html.indexOf('class="panel gift-blindbox-panel"');
  const broadcastStart = html.indexOf(
    'class="panel gift-blindbox-broadcast-panel"',
  );
  const mappingStart = html.indexOf(
    'class="panel gift-blindbox-mapping-panel"',
  );
  const overlayTabEnd = html.indexOf('<div id="importPage"');

  assert.ok(giftPageStart > -1);
  assert.ok(statsStart > giftPageStart);
  assert.ok(broadcastStart > statsStart);
  assert.ok(mappingStart > broadcastStart);
  assert.ok(html.indexOf('id="blindboxOverlayTitle"') > broadcastStart);
  assert.equal(
    html.slice(0, overlayTabEnd).includes('id="blindboxOverlayTitle"'),
    false,
  );
});

test('blindbox broadcast settings expose audience filters and one open action', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
    'utf8',
  );

  assert.match(html, /<span class="panel-kicker ui-eyebrow">观众画面<\/span>/);
  assert.match(
    html,
    /<h2 class="gift-section-title ui-section-title">盲盒盈亏榜<\/h2>/,
  );
  assert.match(html, /id="blindboxWinnersOnly"[^>]*checked/);
  assert.match(html, /id="blindboxHeartBoxOnly"/);
  assert.doesNotMatch(
    html,
    /blindboxCompact|blindboxNoScroll|blindboxLowPower|blindboxOpenUrlBtn/,
  );
  assert.equal((html.match(/>\s*打开画面\s*<\/a\s*>/g) || []).length, 1);
  assert.match(source, /liveLink\.href = url/);
  assert.match(source, /add\(\s*['"]heartBox['"]\s*,\s*['"]1['"]\s*\)/);
  assert.doesNotMatch(source, /add\("compact"|add\("noScroll"|add\("quality"/);
});

test('blind-box settings persist an explicit empty JSON array', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
    'utf8',
  );

  assert.doesNotMatch(
    source,
    /config\.length\s*\?\s*JSON\.stringify\(config,[^)]+\)\s*:\s*''/,
  );
  assert.match(
    source,
    /const newRaw = JSON\.stringify\(config, null, 2\)/,
  );
  assert.match(source, /let raw = textarea\.value\.trim\(\) \|\| '\[\]'/);
});

test('blind-box mapping refreshes the logged-in room and sorts sale entries first', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123', loggedIn: true });
  fixture.textarea.value = JSON.stringify([
    {
      giftId: null,
      name: '主播自定义盒',
      price: 5,
      outputs: [{ giftId: '102', name: '自定义产物', price: 2 }],
    },
    { giftId: '200', name: '在售自定义盒', price: 10, outputs: [] },
  ]);
  const snapshot = {
    schemaVersion: 2,
    source: 'server',
    roomId: '',
    gifts: [
      { id: '100', name: '官方盲盒', rmb: 5, isBlindBox: true, active: true },
      { id: '101', name: '官方产物', rmb: 3, isBlindBox: false },
      { id: '103', name: '在售官方盒甲', rmb: 5, isBlindBox: true },
      { id: '102', name: '历史官方盒', rmb: 5, isBlindBox: true, active: false },
      { id: '104', name: '在售官方盒乙', rmb: 10, isBlindBox: true },
    ],
    blindBoxes: [{ giftId: '100', outputGiftIds: ['101'] }],
  };
  const { applyOfficialCatalogSnapshot, renderBlindBoxList } = fixture.module;
  applyOfficialCatalogSnapshot(snapshot);

  assert.equal(
    fixture.fetchCalls.filter(({ url }) => url === '/api/overtime/gifts').length,
    0,
  );
  assert.equal(fixture.refreshRequests.length, 1);
  assert.equal(fixture.fetchCalls.at(-1).url, '/api/overtime/gifts/refresh');
  assert.equal(fixture.fetchCalls.at(-1).options.method, 'POST');
  assert.equal(fixture.fetchCalls.at(-1).options.body, '{}');

  const catalogEvents = [];
  fixture.window.AdminApp.eventBus.on('gift:catalog_updated', (data) => {
    catalogEvents.push(data);
  });
  await fixture.resolveRefresh({
    roomId: '123',
    gifts: [{ id: 104 }, { id: '103' }, { id: '200' }],
  });

  const renderedNames = () => [...fixture.container.innerHTML.matchAll(
    /<span class="bb-chip-name">([^<]+)<\/span>/g,
  )].map(([, name]) => name);
  assert.deepEqual(renderedNames(), [
    '在售官方盒甲', '在售官方盒乙', '在售自定义盒',
    '官方盲盒', '历史官方盒', '主播自定义盒',
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(catalogEvents)), [{
    snapshot: {
      roomId: '123',
      gifts: [{ id: 104 }, { id: '103' }, { id: '200' }],
    },
  }]);
  assert.match(fixture.container.innerHTML, /官方盲盒/);
  assert.match(fixture.container.innerHTML, /官方产物<small>#101<\/small><small>3<\/small>/);
  assert.match(fixture.container.innerHTML, /<span class="bb-chip-source">官方<\/span>/);
  assert.match(fixture.container.innerHTML, /主播自定义盒/);
  assert.equal((fixture.container.innerHTML.match(/class="chip-delete"/g) || []).length, 2);
  assert.deepEqual([...fixture.container.innerHTML.matchAll(/data-blind-index="(\d+)"/g)]
    .map(([, index]) => index), ['1', '0']);
  assert.equal(JSON.parse(fixture.textarea.value)[0].name, '主播自定义盒');
  renderBlindBoxList();
  assert.equal(JSON.parse(fixture.textarea.value)[0].name, '主播自定义盒');
  fixture.dispatchSettings('123');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 0);
});

test('blind-box mapping sorts alphabetically until both room and Bilibili auth exist', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123', loggedIn: false });
  fixture.textarea.value = JSON.stringify([
    { giftId: '200', name: '在售自定义盒', price: 10, outputs: [] },
    { giftId: null, name: '主播自定义盒', price: 5, outputs: [] },
  ]);
  fixture.module.applyOfficialCatalogSnapshot({
    gifts: [
      { id: '100', name: '官方盲盒', rmb: 5, isBlindBox: true },
      { id: '101', name: '历史官方盒', rmb: 5, isBlindBox: true },
    ],
    blindBoxes: [],
  });

  const names = () => [...fixture.container.innerHTML.matchAll(
    /<span class="bb-chip-name">([^<]+)<\/span>/g,
  )].map(([, name]) => name);
  fixture.module.applyOfficialCatalogSnapshot({
    roomId: '123', gifts: [{ id: '200' }],
  });
  assert.equal(fixture.refreshRequests.length, 0);
  assert.deepEqual(names(), [
    '官方盲盒', '历史官方盒', '在售自定义盒', '主播自定义盒',
  ]);

  fixture.setAuth({ loggedIn: true });
  fixture.dispatchAuthChanged();
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), [
    '在售自定义盒', '官方盲盒', '历史官方盒', '主播自定义盒',
  ]);

  fixture.dispatchSettings('');
  assert.deepEqual(names(), [
    '官方盲盒', '历史官方盒', '在售自定义盒', '主播自定义盒',
  ]);
  assert.equal(fixture.refreshRequests.length, 0);
  fixture.dispatchSettings('');
  fixture.dispatchAuthChanged();
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 0);

  fixture.dispatchSettings('456');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  fixture.setAuth({ loggedIn: false });
  fixture.dispatchAuthChanged();
  assert.deepEqual(names(), [
    '官方盲盒', '历史官方盒', '在售自定义盒', '主播自定义盒',
  ]);
  await fixture.resolveRefresh({ roomId: '456', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), [
    '官方盲盒', '历史官方盒', '在售自定义盒', '主播自定义盒',
  ]);
  assert.equal(fixture.refreshRequests.length, 0);
});

test('blind-box mapping skips obsolete room requests and retries a wrong-room response once', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123', loggedIn: true });
  fixture.textarea.value = '[]';
  fixture.module.applyOfficialCatalogSnapshot({
    gifts: [
      { id: 'old', name: '旧盒', rmb: 5, isBlindBox: true },
      { id: 'final', name: '最终盒', rmb: 5, isBlindBox: true },
    ],
    blindBoxes: [],
  });
  assert.equal(fixture.refreshRequests.length, 1);

  fixture.dispatchSettings('456');
  fixture.dispatchSettings('789');
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: 'old' }] });
  await flushBlindboxTasks();
  assert.equal(
    fixture.fetchCalls.filter(({ url }) => url === '/api/overtime/gifts/refresh').length,
    2,
  );
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '789', gifts: [{ id: 'final' }] });
  assert.deepEqual(
    [...fixture.container.innerHTML.matchAll(/<span class="bb-chip-name">([^<]+)<\/span>/g)]
      .map(([, name]) => name),
    ['最终盒', '旧盒'],
  );

  fixture.dispatchSettings('999');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: 'stale', gifts: [{ id: 'wrong' }] });
  await flushBlindboxTasks();
  assert.deepEqual(
    [...fixture.container.innerHTML.matchAll(/<span class="bb-chip-name">([^<]+)<\/span>/g)]
      .map(([, name]) => name),
    ['旧盒', '最终盒'],
  );
  assert.equal(
    fixture.fetchCalls.filter(({ url }) => url === '/api/overtime/gifts/refresh').length,
    4,
  );
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '999', gifts: [{ id: 'current' }] });
});

test('blind-box mapping stays alphabetical after a failed refresh and can refresh the next room', async () => {
  const fixture = await createBlindboxFixture({ roomId: '123', loggedIn: true });
  fixture.module.applyOfficialCatalogSnapshot({
    gifts: [
      { id: '100', name: '官方盲盒', rmb: 5, isBlindBox: true },
      { id: '200', name: '在售盲盒', rmb: 5, isBlindBox: true },
    ],
    blindBoxes: [],
  });
  const names = () => [...fixture.container.innerHTML.matchAll(
    /<span class="bb-chip-name">([^<]+)<\/span>/g,
  )].map(([, name]) => name);
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), ['在售盲盒', '官方盲盒']);

  fixture.dispatchSettings('456');
  await flushBlindboxTasks();
  fixture.refreshRequests.shift().resolve(response({ ok: false, error: 'offline' }));
  await flushBlindboxTasks();
  assert.deepEqual(names(), ['官方盲盒', '在售盲盒']);
  assert.equal(fixture.refreshRequests.length, 0);

  fixture.dispatchSettings('789');
  await flushBlindboxTasks();
  await fixture.resolveRefresh({ roomId: '789', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), ['在售盲盒', '官方盲盒']);
});

test('blind-box advanced editor remains available without changing values, drafts, or expansion', async () => {
  const textarea = { value: 'null', dataset: {} };
  const toggle = { hidden: false, textContent: '高级 ▾' };
  const advanced = { hidden: true };
  const elements = {
    blindBoxList: { innerHTML: '' },
    giftBlindBoxCustomConfigV2: textarea,
    blindBoxAdvancedToggle: toggle,
    blindBoxAdvanced: advanced,
  };
  const window = {
    addEventListener() {},
    AdminApp: {
      utils: { escapeHtml: String, escapeAttr: String, formatMoney: String },
      gifts: { recent: { getBlindBoxIcon: () => null } },
    },
  };
  await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'),
    {
      document: {
        readyState: 'loading',
        addEventListener() {},
        getElementById: (id) => elements[id] || null,
      },
      window,
      fetch: () => new Promise(() => {}),
    },
  );
  const { renderBlindBoxList } = window.AdminApp.gifts.blindbox;

  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(advanced.hidden, true);

  for (const raw of ['null', '[]', '']) {
    textarea.value = raw;
    toggle.hidden = false;
    toggle.textContent = '高级 ▴';
    advanced.hidden = false;
    renderBlindBoxList();
    assert.equal(toggle.hidden, false);
    assert.equal(advanced.hidden, false);
    assert.equal(toggle.textContent, '高级 ▴');
    assert.equal(textarea.value, raw);
    assert.equal(textarea.dataset.dirty, undefined);
  }

  const config = '[{"name":"Custom box","price":5,"outputs":[]}]';
  advanced.hidden = true;
  toggle.textContent = '高级 ▾';
  textarea.value = config;
  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(advanced.hidden, true);
  assert.equal(textarea.value, config);

  advanced.hidden = false;
  textarea.dataset.dirty = 'true';
  for (const draft of ['', '[]', 'null', '[']) {
    textarea.value = draft;
    renderBlindBoxList();
    assert.equal(toggle.hidden, false);
    assert.equal(advanced.hidden, false);
    assert.equal(textarea.value, draft);
    assert.equal(textarea.dataset.dirty, 'true');
  }

  textarea.value = '[]';
  textarea.dataset.dirty = 'false';
  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(advanced.hidden, false);
  assert.equal(textarea.value, '[]');

  textarea.value = config;
  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(advanced.hidden, false);

  textarea.value = '{';
  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(textarea.value, '{');

  const page = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'gifts', 'page.html'),
    'utf8',
  );
  assert.doesNotMatch(page, /id="blindBoxAdvancedToggle"[^>]*\bhidden\b/);
  assert.match(page, /id="blindBoxAdvanced"[^>]*\bhidden\b/);
  assert.doesNotMatch(page, /id="blindBoxAddBtn"[^>]*\bhidden\b/);
});

test('blind-box JSON draft survives state refresh and a failed save', async () => {
  const draft = '[{"name":"未保存草稿"}]';
  const textarea = {
    value: draft,
    dataset: { preserveDirty: 'true', dirty: 'true' },
    closest: () => null,
    addEventListener() {},
  };
  const document = {
    activeElement: null,
    getElementById: (id) =>
      id === 'giftBlindBoxCustomConfigV2' ? textarea : null,
    querySelectorAll: () => [],
  };
  const window = { AdminApp: {} };
  const { FormsService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    { document, window },
  );
  const forms = new FormsService();
  forms.fillForm({ giftBlindBoxCustomConfigV2: '[]' });
  assert.equal(textarea.value, draft);

  const elements = new Map();
  const makeElement = (value = '') => {
    const listeners = new Map();
    return {
      value,
      checked: false,
      dataset: {},
      hidden: false,
      textContent: '',
      href: '',
      addEventListener: (type, handler) => listeners.set(type, handler),
      listeners,
    };
  };
  for (const id of [
    'blindBoxAddBtn', 'blindBoxList', 'blindBoxAdvancedToggle',
    'giftBlindBoxSaveBtn', 'blindboxOverlayTitle', 'blindboxOverlayTop',
    'blindboxWinnersOnly', 'blindboxHeartBoxOnly', 'blindboxCopyUrlBtn',
    'giftBlindBoxCustomConfigV2', 'importBtn', 'blindBoxAdvanced',
    'blindboxOverlayUrl', 'blindboxLiveLink',
  ]) elements.set(id, makeElement());
  const editable = elements.get('giftBlindBoxCustomConfigV2');
  editable.value = 'null';
  const advanced = elements.get('blindBoxAdvanced');
  advanced.hidden = true;
  const { createBlindboxSettings } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
  );
  const settings = createBlindboxSettings({
    documentRef: { getElementById: (id) => elements.get(id) || null },
    navigatorRef: { clipboard: { writeText: async () => {} } },
    promptRef() {},
    locationRef: {},
    value: (id) => elements.get(id)?.value || '',
    toast() {},
    saveSettings: async () => { throw new Error('offline'); },
    getGifts: () => null,
    getState: () => null,
    getImports: () => null,
    localOverlayOrigin: () => 'http://127.0.0.1:3000',
  });
  settings.init();
  const toggle = elements.get('blindBoxAdvancedToggle');
  toggle.listeners.get('click')();
  assert.equal(advanced.hidden, false);
  assert.equal(toggle.textContent, '高级 ▴');
  toggle.listeners.get('click')();
  assert.equal(advanced.hidden, true);
  assert.equal(toggle.textContent, '高级 ▾');
  toggle.listeners.get('click')();
  assert.equal(advanced.hidden, false);
  editable.value = draft;
  editable.listeners.get('input')();
  await assert.rejects(
    elements.get('giftBlindBoxSaveBtn').listeners.get('click')(),
    /offline/,
  );
  assert.equal(editable.value, draft);
  assert.equal(editable.dataset.dirty, 'true');
});

test('blindbox ranking count supports all, summary-only, and one-to-ten modes', () => {
  const html = readAdminHtml();
  const settingsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
    'utf8',
  );
  const overlaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'blindbox.js'),
    'utf8',
  );
  const overlayStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'overlays', 'blindbox.css'),
    'utf8',
  );

  assert.match(
    html,
    /<input\b(?=[^>]*\bid="blindboxOverlayTop")[^>]*\bmin="-1"[^>]*\bmax="10"[^>]*\bvalue="3"[^>]*>/s,
  );
  assert.match(html, /-1\s*显示全部，0\s*仅显示汇总，1\s*至 10\s*显示对应人数/);
  assert.match(
    settingsSource,
    /if\s*\(\s*top\s*!==\s*['"]['"]\s*\)\s*add\(\s*['"]top['"]\s*,\s*top\s*\)/,
  );
  assert.match(overlaySource, /param\('top', 't'\) \|\| '3'/);
  assert.match(overlaySource, /Math\.min\(10, Math\.max\(-1, requestedTop\)\)/);
  assert.match(overlaySource, /const SUMMARY_ONLY = TOP_N === 0/);
  assert.match(
    overlaySource,
    /if \(TOP_N > 0\)[\s\S]*?users = users\.slice\(0, TOP_N\)/,
  );
  assert.match(
    overlaySource,
    /if \(SUMMARY_ONLY\)[\s\S]*?leaderboard\.innerHTML = ''/,
  );
  assert.match(overlaySource, /HEART_BOX_ONLY/);
  assert.match(overlaySource, /boxName=.*心动盲盒/);
  assert.match(
    overlayStyles,
    /\.blindbox-panel\.summary-only \.blindbox-header[\s\S]*?display:\s*none/,
  );

  const readMode = (search) => {
    const sandbox = {
      URLSearchParams,
      location: { search },
      document: { addEventListener() {} },
    };
    const executableSource = overlaySource.replace(
      /^import\s+\{\s*createOverlaySocket\s*\}\s+from\s+['"]\.\/socket-client\.js['"];\s*/m,
      '',
    );
    vm.runInNewContext(
      `${executableSource}\nthis.result = { top: TOP_N, summaryOnly: SUMMARY_ONLY };`,
      sandbox,
    );
    return { top: sandbox.result.top, summaryOnly: sandbox.result.summaryOnly };
  };

  assert.deepEqual(readMode('?top=-1'), { top: -1, summaryOnly: false });
  assert.deepEqual(readMode('?top=0'), { top: 0, summaryOnly: true });
  assert.deepEqual(readMode(''), { top: 3, summaryOnly: false });
  assert.deepEqual(readMode('?top=25'), { top: 10, summaryOnly: false });
});

test('blindbox overlay fills the capture width and reflows without hiding data', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'blindbox.html'),
    'utf8',
  );
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'overlays', 'blindbox.css'),
    'utf8',
  );
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'blindbox.js'),
    'utf8',
  );
  const panelRule = styles.match(/\.blindbox-panel\s*\{[\s\S]*?\n\}/)?.[0];

  assert.match(
    html,
    /<script type="module" src="\/js\/overlays\/blindbox\.js\?v=[^"]+"><\/script>/,
  );
  assert.ok(panelRule, 'blindbox panel styles should remain defined');
  assert.doesNotMatch(html, /blindbox-live-status|>实时</);
  assert.doesNotMatch(styles, /blindbox-live-status/);
  assert.match(panelRule, /width:\s*420px/);
  assert.match(panelRule, /margin:\s*var\(--overlay-edge\)/);
  assert.match(
    styles,
    /\.overlay-body\.blindbox-viewport-resized \.blindbox-panel\s*\{[\s\S]*?width:\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)/,
  );
  assert.match(panelRule, /container-type:\s*inline-size/);
  assert.match(
    styles,
    /@container \(min-width: 680px\)[\s\S]*?grid-template-columns:\s*minmax\(240px, 0\.8fr\) minmax\(360px, 1\.35fr\)/,
  );
  assert.match(
    styles,
    /@container \(max-width: 259px\)[\s\S]*?grid-template-areas:\s*["']rank user user["']\s*["']rank count profit["']/,
  );
  assert.doesNotMatch(styles, /\.box-count\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(styles, /\.profit-value\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(source, /panel\.style\.overflow\s*=\s*['"]hidden['"]/);
  assert.match(source, /initialBlindboxViewportWidth\s*=\s*window\.innerWidth/);
  assert.match(source, /blindbox-viewport-resized/);
});

test('recent gift cards keep a wider responsive minimum width', () => {
  const source = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const giftCardsRule = source.match(
    /\.gift-page \.panel-body \.gift-cards\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(giftCardsRule, 'gift card layout styles should remain defined');
  assert.match(
    giftCardsRule,
    /grid-template-columns:\s*repeat\(auto-fill, minmax\(270px, 1fr\)\)/,
  );
});

test('admin gift styles load feature-owned stylesheets in order', () => {
  const giftEntry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'),
    'utf8',
  );

  assert.match(giftEntry, /@import url\('\.\/gifts\/recent\.css'\);/);
});

test('recent gift cards stay within six rows as the grid width changes', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const cards = [];
  let gridTemplateColumns = '270px 270px 270px';
  let resizeCallback;
  const list = {
    classList: { toggle() {} },
    querySelectorAll: () => cards,
    set innerHTML(value) {
      cards.length = (value.match(/class="gift-card/g) ?? []).length;
      for (let index = 0; index < cards.length; index += 1)
        cards[index] = { hidden: false };
    },
  };
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
      },
      getComputedStyle: () => ({ gridTemplateColumns }),
      ResizeObserver: class {
        constructor(callback) {
          resizeCallback = callback;
        }
        observe() {}
      },
    },
    document: { getElementById: () => list },
  };
  const items = Array.from({ length: 30 }, (_, index) => ({
    gift_name: `Gift ${index + 1}`,
    user_name: 'Viewer',
    total_price: 1,
    created_at: index,
  }));

  vm.runInNewContext(runnableRecentScript(source), sandbox);
  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList(items);

  assert.equal(cards.filter((card) => !card.hidden).length, 18);

  gridTemplateColumns = '270px 270px';
  resizeCallback();
  assert.equal(cards.filter((card) => !card.hidden).length, 12);

  gridTemplateColumns = '270px 270px 270px 270px 270px';
  resizeCallback();
  assert.equal(cards.filter((card) => !card.hidden).length, 30);
});

test('recent gift cards reserve artwork space and keep metadata in named slots', () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');

  assert.match(script, /class="gift-card-content"/);
  assert.match(script, /class="gift-user"/);
  assert.match(script, /class="gift-amount"/);
  assert.match(script, /class="gift-result/);
  assert.match(script, /class="gift-time"/);
  assert.doesNotMatch(
    script,
    /item\.is_blind_box \? '' : `<span>\$\{formatTime/,
  );
  assert.match(
    styles,
    /\.gift-card\.has-type-icon\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 52px/,
  );
  assert.match(
    styles,
    /\.gift-card \.gift-meta\s*\{[\s\S]*?grid-template-areas:/,
  );
  assert.match(
    styles,
    /\.gift-card \.gift-type-icon\s*\{[\s\S]*?position:\s*static/,
  );
});

test('recent guard gift cards use subtle matching guard level colors', () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');

  assert.match(script, /guard-card guard-\$\{guardBadge\.level\}/);
  assert.match(script, /name:\s*['"]总督['"],\s*level:\s*1/);
  assert.match(script, /name:\s*['"]提督['"],\s*level:\s*2/);
  assert.match(script, /name:\s*['"]舰长['"],\s*level:\s*3/);
  assert.match(
    styles,
    /\.gift-card\.guard-card\.guard-1\s*\{[^}]*border-left-color:\s*#f25f72[^}]*background:\s*linear-gradient/,
  );
  assert.match(
    styles,
    /\.gift-card\.guard-card\.guard-2\s*\{[^}]*border-left-color:\s*#8d67e8[^}]*background:\s*linear-gradient/,
  );
  assert.match(
    styles,
    /\.gift-card\.guard-card\.guard-3\s*\{[^}]*border-left-color:\s*#4b91e8[^}]*background:\s*linear-gradient/,
  );
  assert.doesNotMatch(
    styles,
    /\.gift-card\.guard-card\s*\{[^}]*color:\s*var\(--color-bg-primary\)/,
  );
});

test('recent blind box cards keep heart and lucky colors and default all others to purple', () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');

  assert.match(
    script,
    /profitClass\s*=\s*blindProfit\s*>\s*0\s*\?\s*['"]profit-up['"]\s*:\s*blindProfit\s*<\s*0\s*\?\s*['"]profit-down['"]\s*:\s*['"]profit-neutral['"]/,
  );
  assert.match(script, /className: 'blind-box-heart'/);
  assert.match(script, /className: 'blind-box-lucky'/);
  assert.match(script, /className: type\?\.className \|\| 'blind-box-default'/);
  assert.doesNotMatch(script, /className: 'blind-box-(?:bear|qixi|bond)'/);
  assert.doesNotMatch(script, /\/img\/bilibili-gifts/);
  assert.match(
    styles,
    /\.gift-card\.blind-box-card\.blind-box-heart\s*\{[^}]*border-left-color:\s*#f3a2aa/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card\.blind-box-lucky\s*\{[^}]*border-left-color:\s*#b8d983/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card\.blind-box-default\s*\{[^}]*border-left-color:\s*#8459c7[^}]*background:\s*linear-gradient/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card \.profit-up\s*\{[^}]*color:\s*#c0392b/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card \.profit-down\s*\{[^}]*color:\s*#21b6a8/,
  );
  assert.match(
    styles,
    /\.gift-card\.blind-box-card \.profit-neutral\s*\{[^}]*color:\s*#647181/,
  );
});

test('same-name 七夕鹊匣 gift card uses server artwork for its exact ID', async () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const list = {
    classList: { toggle() {} },
    querySelectorAll: () => [],
    innerHTML: '',
  };
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
      },
      fetch: async (url) => {
        assert.equal(url, '/api/overtime/gifts/catalog');
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              gifts: [
                {
                  id: '35786',
                  imagePath: '/overtime-gift-images/35786.webp',
                },
                {
                  id: '45786',
                  imagePath: '/overtime-gift-images/45786.webp',
                },
              ],
            },
          }),
        };
      },
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
    },
    document: { getElementById: () => list },
  };

  vm.runInNewContext(runnableRecentScript(script), sandbox);
  await sandbox.window.AdminApp.gifts.recent.loadGiftArtworkCatalog();
  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '45786',
      gift_name: '七夕鹊匣',
      user_name: 'Alice',
      num: 1,
      unit_price: 25,
      total_price: 25,
      is_blind_box: true,
      blind_box_price: 25,
    },
  ]);

  assert.match(list.innerHTML, /blind-box-card blind-box-default/);
  assert.match(list.innerHTML, /\/overtime-gift-images\/45786\.webp/);
  assert.doesNotMatch(list.innerHTML, /\/overtime-gift-images\/35786\.webp/);

  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '99999',
      gift_name: '盲盒产物',
      blind_box_id: '35786',
      blind_box_name: '七夕鹊匣',
      user_name: 'Alice',
      num: 1,
      unit_price: 1,
      total_price: 1,
      is_blind_box: true,
      blind_box_price: 25,
    },
  ]);
  assert.match(list.innerHTML, /\/overtime-gift-images\/35786\.webp/);

  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '99999',
      gift_name: '七夕鹊匣',
      user_name: 'Alice',
      num: 1,
      unit_price: 25,
      total_price: 25,
      is_blind_box: true,
      blind_box_price: 25,
    },
  ]);
  assert.match(list.innerHTML, /\/img\/overtime-machine\/gift-placeholder\.svg/);
  assert.doesNotMatch(list.innerHTML, /\/overtime-gift-images\/35786\.webp/);

  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '35786',
      gift_name: '七夕鹊匣产物',
      user_name: 'Alice',
      num: 1,
      unit_price: 1,
      total_price: 1,
      is_blind_box: false,
      blind_box_id: null,
    },
  ]);
  assert.doesNotMatch(list.innerHTML, /blind-box-card/);
});

test('recent gift artwork refreshes from live catalog events without a slow fetch rollback', async () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const list = {
    classList: { toggle() {} },
    querySelectorAll: () => [],
    innerHTML: '',
  };
  let resolveFetch;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  let eventHandler;
  const eventBus = {
    on(event, handler) {
      assert.equal(event, 'gift:catalog_updated');
      eventHandler = handler;
      return () => {
        eventHandler = null;
      };
    },
  };
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
        eventBus,
      },
      fetch: () => fetchPromise,
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
    },
    document: { getElementById: () => list },
  };

  vm.runInNewContext(runnableRecentScript(script), sandbox);
  const recent = sandbox.window.AdminApp.gifts.recent;
  recent.renderGiftRecentList([
    {
      gift_id: '35792',
      gift_name: '宸星定情',
      user_name: 'Alice',
      num: 1,
      unit_price: 1200,
      total_price: 1200,
    },
  ]);
  const initialPromise = recent.loadGiftArtworkCatalog();

  eventHandler({
    snapshot: {
      source: 'server',
      version: 'v2',
      gifts: [
        { id: '35792', imagePath: '/overtime-gift-images/35792-new.webp' },
      ],
    },
  });
  assert.match(list.innerHTML, /\/overtime-gift-images\/35792-new\.webp/);

  resolveFetch({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        gifts: [
          { id: '35792', imagePath: '/overtime-gift-images/35792-old.webp' },
        ],
      },
    }),
  });
  await initialPromise;

  assert.match(list.innerHTML, /\/overtime-gift-images\/35792-new\.webp/);
  assert.doesNotMatch(list.innerHTML, /\/overtime-gift-images\/35792-old\.webp/);

  eventHandler({
    snapshot: {
      source: 'server',
      version: 'v3',
      gifts: [{ id: '35792', imagePath: 'https://example.test/gift.webp' }],
    },
  });
  assert.match(list.innerHTML, /\/overtime-gift-images\/35792-new\.webp/);
});

test('recent gift totals worth at least 1000 RMB use gold while unit-value artwork comes from the catalog', async () => {
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');
  const list = {
    classList: { toggle() {} },
    querySelectorAll: () => [],
    innerHTML: '',
  };
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
      },
      fetch: async (url) => {
        assert.equal(url, '/api/overtime/gifts/catalog');
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              gifts: [
                {
                  id: '35792',
                  imagePath: '/overtime-gift-images/35792.webp',
                },
              ],
            },
          }),
        };
      },
      getComputedStyle: () => ({ gridTemplateColumns: '270px' }),
    },
    document: { getElementById: () => list },
  };

  vm.runInNewContext(runnableRecentScript(script), sandbox);
  await sandbox.window.AdminApp.gifts.recent.loadGiftArtworkCatalog();
  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    {
      gift_id: '35792',
      gift_name: '宸星定情',
      user_name: 'Alice',
      num: 1,
      unit_price: 1200,
      total_price: 1200,
    },
    {
      gift_id: '35792',
      gift_name: '宸星定情',
      user_name: 'Bob',
      num: 2,
      unit_price: 600,
      total_price: 1200,
    },
  ]);

  assert.equal((list.innerHTML.match(/high-value-gift-card/g) || []).length, 2);
  assert.equal((list.innerHTML.match(/gift-high-value-icon/g) || []).length, 1);
  assert.equal(
    (
      list.innerHTML.match(/\/overtime-gift-images\/35792\.webp/g) || []
    ).length,
    1,
  );
  assert.doesNotMatch(script, /HIGH_VALUE_GIFT_ARTWORK/);
  assert.match(
    styles,
    /\.gift-card\.high-value-gift-card\s*\{[\s\S]*?background:\s*linear-gradient\(90deg/,
  );
  assert.match(
    styles,
    /\.gift-card \.gift-high-value-icon\s*\{[\s\S]*?object-fit:\s*contain/,
  );
});

test('blind box mapping cards use a purple default gradient and keep distinct known colors', () => {
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');

  const defaultCardRule = styles.match(/\.blind-box-chip\s*\{([^}]+)\}/)?.[1];
  assert.ok(defaultCardRule);
  assert.match(defaultCardRule, /border:\s*1px solid #d8c4ef/);
  assert.match(
    defaultCardRule,
    /background:\s*linear-gradient\(135deg, #f5edff 0%, #e9d8fa 100%\)/,
  );

  for (const name of [
    '心动盲盒',
    '幸运盲盒',
    '小熊虫',
    '七夕鹊匣',
    '羁绊宝盒',
  ]) {
    const selectorPattern = new RegExp(
      `\\.blind-box-chip:has\\(img\\[alt\\*=['"]${name}['"]\\]\\)\\s*\\{`,
    );
    const ruleMatch = styles.match(selectorPattern);
    const ruleStart = ruleMatch?.index ?? -1;
    const ruleEnd = styles.indexOf('\n}', ruleStart);

    assert.ok(
      ruleStart >= 0,
      `${name} mapping card should have a dedicated style`,
    );
    assert.match(
      styles.slice(ruleStart, ruleEnd),
      /border-color:\s*#[0-9a-f]{6}/i,
    );
    assert.match(
      styles.slice(ruleStart, ruleEnd),
      /background:\s*linear-gradient/,
    );
    assert.match(
      styles,
      new RegExp(
        `\\.blind-box-chip:has\\(img\\[alt\\*=['"]${name}['"]\\]\\)\\s*\\.bb-chip-name\\s*\\{`,
      ),
    );
    assert.match(
      styles,
      new RegExp(
        `\\.blind-box-chip:has\\(img\\[alt\\*=['"]${name}['"]\\]\\)\\s*\\.bb-chip-price\\s*\\{`,
      ),
    );
  }
});
