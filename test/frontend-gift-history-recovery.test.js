'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  createLyricToggleButton,
  loadModuleExports,
} = require('./helpers/frontend-modules');

const LIVE_EMPTY = {
  items: [], total: 0, totalPages: 1, hasMore: false,
  syncState: 'LIVE', partial: false,
};
const UNAVAILABLE = {
  ok: false, code: 'GIFT_SOURCE_UNAVAILABLE', error: '当前礼物来源尚未就绪。',
};

test('gift history recovers an empty ledger without receiving a gift', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply(UNAVAILABLE, 409);
  assert.match(ui.body(), /正在更新礼物记录/);
  assert.doesNotMatch(ui.body(), /失败|暂无礼物记录|尚未就绪/);
  assert.equal(ui.get('giftHistoryTotal').hidden, true);
  assert.equal(ui.get('giftLedgerSyncStatus').hidden, true);

  ui.runTimer();
  await ui.reply({ ok: true, data: { ...LIVE_EMPTY, syncState: 'BOOTSTRAPPING', partial: true } });
  assert.doesNotMatch(ui.body(), /暂无礼物记录/);
  ui.runTimer();
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  assert.match(ui.body(), /暂无礼物记录/);
  assert.equal(ui.get('giftHistoryTotal').textContent, '共 0 条');
  assert.equal(ui.get('giftHistoryTotal').hidden, false);
  assert.equal(ui.get('giftHistoryRetryBtn').hidden, true);
  assert.equal([...ui.timers.values()][0].delay, 10000);
  assert.equal(ui.requests.every((request) => request.url.startsWith('/api/gifts/history?')), true);
  ui.runTimer();
  await ui.reply({ ok: true, data: {
    ...LIVE_EMPTY, total: 1,
    items: [{ eventId: 'new', gift: { giftName: '新收到的礼物' } }],
  } });
  assert.match(ui.body(), /新收到的礼物/);
  ui.close();
  assert.equal(ui.timers.size, 0);
});

test('slow gift history recovery exposes retry and cancels work on close', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply(UNAVAILABLE, 409);
  ui.elapse(16000);
  ui.runTimer();
  await ui.reply(UNAVAILABLE, 409);
  assert.match(ui.body(), /更新较慢，请稍后重试/);
  assert.equal(ui.get('giftHistoryRetryBtn').hidden, false);
  assert.equal([...ui.timers.values()][0].delay, 10000);

  ui.click('giftHistoryRetryBtn');
  assert.equal(ui.timers.size, 0);
  await ui.reply(UNAVAILABLE, 409);
  assert.match(ui.body(), /正在更新礼物记录/);
  const staleTimer = [...ui.timers.values()][0];
  ui.close();
  const count = ui.requests.length;
  staleTimer.callback();
  assert.equal(ui.requests.length, count);

  ui.open();
  const pending = ui.requests.at(-1);
  const body = ui.body();
  ui.close();
  assert.equal(pending.options.signal.aborted, true);
  await ui.reply({ ok: true, data: LIVE_EMPTY }, 200, pending);
  assert.equal(ui.body(), body);
  assert.equal(ui.timers.size, 0);
});

test('gift history preserves loaded rows on update failures and reconnects offline records', async () => {
  const ui = await createFixture();
  const data = {
    ...LIVE_EMPTY, total: 1, partial: true, syncState: 'CATCHING_UP',
    items: [{ eventId: 'one', gift: { giftName: '保留的礼物' } }],
  };
  ui.open();
  await ui.reply({ ok: true, data });
  const rows = ui.body();
  ui.runTimer();
  await ui.reply({ ok: false, error: 'SQLITE_INTERNAL: private detail' }, 500);
  assert.equal(ui.body(), rows);
  assert.equal(ui.get('giftHistoryTotal').textContent, '共 1 条');
  assert.equal(ui.get('giftLedgerSyncStatus').textContent, '记录暂未更新，请稍后重试。');
  assert.equal(ui.get('giftHistoryRetryBtn').hidden, false);
  assert.doesNotMatch(ui.get('giftLedgerSyncStatus').title, /SQLITE|private/);

  ui.runTimer();
  await ui.reply({ ok: true, data: { ...data, syncState: 'OFFLINE' } });
  assert.equal(ui.body(), rows);
  assert.equal(ui.get('giftLedgerSyncStatus').textContent, '当前离线，显示已保存的记录');
  ui.runTimer();
  await ui.reply({ ok: true, data: { ...data, syncState: 'LIVE', partial: false } });
  assert.equal(ui.get('giftLedgerSyncStatus').hidden, true);
  assert.equal([...ui.timers.values()][0].delay, 10000);
  ui.close();
});

test('a switching gift source removes previously loaded rows before retrying', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply({ ok: true, data: {
    ...LIVE_EMPTY, partial: true, syncState: 'CATCHING_UP', total: 1,
    items: [{ eventId: 'old', gift: { giftName: '之前账号的礼物' } }],
  } });
  ui.runTimer();
  await ui.reply(UNAVAILABLE, 409);
  assert.doesNotMatch(ui.body(), /之前账号/);
  assert.equal(ui.get('giftHistoryTotal').hidden, true);
  ui.close();
});

test('clearing gifts submits once, rejects stale reads, and recovers without gifts', async () => {
  const ui = await createFixture();
  ui.open();
  const staleRead = ui.requests.at(-1);
  const clearing = ui.click('giftHistoryClearDatabaseBtn');
  assert.match(ui.dialog().innerHTML, /清空全部礼物记录|本机和云端|无法撤销/);
  await ui.confirm(true);
  const clearRequest = ui.requests.at(-1);
  assert.equal(clearRequest.url, '/api/database/clear-gifts');
  assert.equal(JSON.parse(clearRequest.options.body).confirm, true);
  assert.equal(ui.get('giftHistoryClearDatabaseBtn').disabled, true);
  assert.equal(ui.get('giftHistoryClearDatabaseBtn').textContent, '正在清空…');
  await ui.click('giftHistoryClearDatabaseBtn');
  assert.equal(ui.requests.at(-1), clearRequest);
  assert.equal(staleRead.options.signal.aborted, true);

  await ui.reply({ ok: true, data: {} }, 200, clearRequest);
  await clearing;
  const newRead = ui.requests.at(-1);
  await ui.reply({ ok: true, data: {
    ...LIVE_EMPTY, total: 1,
    items: [{ eventId: 'stale', gift: { giftName: '已删除的礼物' } }],
  } }, 200, staleRead);
  assert.doesNotMatch(ui.body(), /已删除的礼物/);
  await ui.reply(UNAVAILABLE, 409, newRead);
  assert.match(ui.body(), /正在更新礼物记录/);
  ui.runTimer();
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  assert.equal(ui.get('giftHistoryTotal').textContent, '共 0 条');
  assert.equal(ui.get('giftHistoryClearDatabaseBtn').disabled, false);
  assert.equal(ui.requests.filter((request) => request.options.method === 'POST').length, 1);
  ui.close();
});

test('a successful gift clear is not reported as failed when its follow-up read fails', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  const clearing = ui.click('giftHistoryClearDatabaseBtn');
  await ui.confirm(true);
  await ui.reply({ ok: true, data: {} });
  await clearing;
  await ui.reply({ ok: false, error: 'HTTP 500 raw error' }, 500);
  assert.match(ui.body(), /礼物记录已清空，列表暂未更新/);
  assert.doesNotMatch(ui.body(), /清空失败|HTTP|raw error/);
  ui.close();
});

test('a partially completed clear retries only the gift history read', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  const clearing = ui.click('giftHistoryClearDatabaseBtn');
  await ui.confirm(true);
  await ui.reply({ ok: false, partial: true, error: 'server internals' }, 500);
  await clearing;
  await ui.reply({ ok: false }, 500);
  assert.match(ui.body(), /云端记录已清空，本机记录尚未更新/);
  assert.equal(ui.get('giftHistoryRetryBtn').textContent, '重试更新');
  ui.click('giftHistoryRetryBtn');
  assert.equal(ui.requests.filter((request) => request.options.method === 'POST').length, 1);
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  assert.match(ui.body(), /暂无礼物记录/);
  ui.close();
});

test('an uncertain gift clear never claims records were preserved or repeats deletion', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  const clearing = ui.click('giftHistoryClearDatabaseBtn');
  await ui.confirm(true);
  ui.requests.at(-1).reject(new TypeError('network disconnected'));
  await clearing;
  assert.match(ui.body(), /暂时无法确认清空结果/);
  assert.doesNotMatch(ui.body(), /未删除|network disconnected/);
  ui.click('giftHistoryRetryBtn');
  assert.equal(ui.requests.filter((request) => request.options.method === 'POST').length, 1);
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  ui.close();
});

test('canceling the clear confirmation preserves records and resumes pending recovery', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply(UNAVAILABLE, 409);
  const clearing = ui.click('giftHistoryClearDatabaseBtn');
  ui.runTimer();
  await ui.confirm(false);
  await clearing;
  assert.equal(ui.requests.some((request) => request.options.method === 'POST'), false);
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  assert.match(ui.body(), /暂无礼物记录/);
  ui.close();
});

async function createFixture() {
  function element() {
    return {
      ...createLyricToggleButton(), dataset: {}, handlers: {},
      hidden: false, textContent: '', innerHTML: '', disabled: false,
      addEventListener(type, handler) { this.handlers[type] = handler; },
      focus() {},
    };
  }
  const elements = new Map([
    'giftHistoryOpenBtn', 'giftHistoryClose', 'giftHistoryBackdrop',
    'giftHistoryDrawer', 'giftHistoryClearDatabaseBtn', 'giftHistoryRetryBtn',
    'giftHistoryPrev', 'giftHistoryNext', 'giftHistoryState', 'giftHistoryTotal',
    'giftHistoryBody', 'giftHistoryPageInfo', 'giftLedgerSyncStatus',
  ].map((id) => [id, element()]));
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  let clock = 0;
  let dialog;
  const document = {
    body: { children: [], appendChild(node) { this.children.push(node); } },
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      const nodes = new Map([
        '.lira-confirm-dialog', '.lira-confirm-cancel', '.lira-confirm-confirm',
      ].map((selector) => [selector, element()]));
      dialog = {
        ...element(), querySelector: (selector) => nodes.get(selector),
        remove() { document.body.children = []; },
      };
      return dialog;
    },
  };
  const ledger = await loadModuleExports(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'gifts', 'history.js'),
    {
      document, URLSearchParams, AbortController, AbortSignal,
      Date: class extends Date { static now() { return clock; } },
      console: { warn() {} },
      requestAnimationFrame: (callback) => callback(),
      window: { matchMedia: () => ({ matches: true }) },
      setTimeout(callback, delay) {
        timers.set(++timerId, { callback, delay });
        return timerId;
      },
      clearTimeout(id) { timers.delete(id); },
      fetch: (url, options = {}) => new Promise((resolve, reject) => {
        requests.push({ url, options, resolve, reject });
      }),
    },
  );
  ledger.initGiftHistoryDrawer();
  const flush = () => new Promise(setImmediate);
  function runTimer() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    clock += timer.delay;
    timer.callback();
  }
  return {
    requests, timers, runTimer,
    get: (id) => elements.get(id),
    body: () => elements.get('giftHistoryBody').innerHTML,
    dialog: () => dialog,
    click: (id) => elements.get(id).handlers.click(),
    open: () => elements.get('giftHistoryOpenBtn').handlers.click(),
    close: () => ledger.closeGiftHistoryDrawer(),
    elapse(ms) { clock += ms; },
    async reply(payload, status = 200, request = requests.at(-1)) {
      request.resolve({ ok: status < 400, status, text: async () => JSON.stringify(payload) });
      await flush();
    },
    async confirm(value) {
      dialog.querySelector(value ? '.lira-confirm-confirm' : '.lira-confirm-cancel').handlers.click();
      const [id, timer] = [...timers.entries()].find(([, entry]) => entry.delay === 0);
      timers.delete(id);
      timer.callback();
      await flush();
    },
  };
}
