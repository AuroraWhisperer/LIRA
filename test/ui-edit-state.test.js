'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createDatabases, closeDatabases, clearAllData } = require('../src/storage/database');
const { createOvertimeService } = require('../src/overtime');

const publicRoot = path.join(__dirname, '..', 'public');
const limits = { maxEnabledRules: 8, minRandomOutcomes: 2, maxRandomOutcomes: 10, maxDisplayTextLength: 6 };
const initialState = {
  revision: 10, enabled: true, status: 'paused', initialSeconds: 300,
  effectiveRemainingMs: 300000, limits, settlements: [],
  rules: [{ giftId: 'synthetic-gift', giftName: '测试礼物', mode: 'random',
    enabled: true, quantityMode: 'group', sortOrder: 0,
    outcomes: [60, 120, 180].map((value) => ({ operation: 'add', value, weight: 1 })) }],
};
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function fixture(t, kind = 'admin') {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(({ state }) => {
    window.initialState = state;
    window.pendingSaves = [];
    window.pendingSnapshots = [];
    window.messages = [];
    window.saveSetting = (key, value) => new Promise((resolve, reject) => {
      window.pendingSaves.push({ key, value, resolve, reject });
    });
    window.fetch = (url) => {
      if (url === '/api/state') return new Promise((resolve, reject) => {
        window.pendingSnapshots.push({ resolve: (overtime) => resolve({ json: async () => ({ ok: true, data: { overtime } }) }), reject });
      });
      if (url === '/api/overtime') return Promise.resolve({ json: async () => ({ ok: true, data: state }) });
      if (url === '/api/overtime/gifts') return Promise.resolve({ json: async () => ({ ok: true, data: { gifts: [] } }) });
      throw new Error(`Unexpected fixture fetch: ${url}`);
    };
  }, { state: initialState });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'lira-ui.test') {
      errors.push(`Unexpected external request: ${url.origin}`);
      return route.abort();
    }
    let body;
    let contentType = 'text/javascript';
    if (url.pathname === '/') {
      contentType = 'text/html';
      body = kind === 'admin'
        ? fs.readFileSync(path.join(publicRoot, 'pages/admin/toolbox/overtime.html'), 'utf8') +
          '<script type="module">import "/js/admin/overtime.js"; window.AdminApp.overtime.init(); window.ready = true;</script>'
        : kind === 'overlay'
          ? fs.readFileSync(path.join(publicRoot, 'pages/overlays/overtime.html'), 'utf8')
          : '<!doctype html><body></body>';
    } else if (url.pathname === '/js/shared/utils.js') {
      body = `export const api = (url, body) => new Promise((resolve, reject) => window.pendingSaves.push({ url, body: structuredClone(body), resolve, reject }));
        export const copyText = async () => {}; export const localOverlayOrigin = () => 'http://lira-ui.test';
        export const readJsonResponse = (response) => response.json();
        export const showError = (error) => window.messages.push(error.message);
        export const toast = (message) => window.messages.push(message);`;
    } else if (url.pathname === '/js/shared/event-bus.js') {
      body = `const listeners = new Map(); export const eventBus = { on: (name, callback) => listeners.set(name, callback) };
        export const Events = { STATE_LOADED: 'state', OVERTIME_UPDATED: 'overtime', GIFT_CATALOG_UPDATED: 'gifts' };
        window.pushState = (state) => listeners.get('state')({ state: { overtime: state } });`;
    } else if (url.pathname === '/js/overlays/socket-client.js') {
      body = 'export const createOverlaySocket = (options) => { window.socketOptions = options; return { start() {}, dispose() {} }; };';
    } else if (/^\/js\/[a-z0-9/-]+\.js$/i.test(url.pathname)) {
      body = fs.readFileSync(path.join(publicRoot, url.pathname.slice(1)), 'utf8');
    } else {
      contentType = 'text/html';
      body = '';
    }
    return route.fulfill({ status: 200, contentType, body });
  });
  await page.goto('http://lira-ui.test/');
  if (kind === 'admin') await page.waitForFunction(() => document.querySelector('[data-overtime-rule]'));
  if (kind === 'overlay') await page.waitForFunction(() => window.socketOptions);
  return page;
}

for (const action of ['add', 'remove']) {
  test(`S7-003: a clean saved random rule becomes dirty after outcome ${action}`, async (t) => {
    const page = await fixture(t);
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    const count = action === 'add' ? 4 : 2;
    await page.evaluate((action) => {
      document.querySelector(action === 'add' ? '[data-add-outcome]' : '[data-remove-outcome]').click();
      window.pushState(window.initialState);
    }, action);
    assert.equal(await page.locator('[data-random-outcome]').count(), count);
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), false);
    await page.evaluate(() => document.getElementById('overtimeSaveRulesBtn').click());
    assert.equal(await page.evaluate(() => window.pendingSaves[0].body.rules[0].outcomes.length), count);
    await page.evaluate(() => {
      const request = window.pendingSaves[0];
      request.resolve({ data: { ...window.initialState, rules: request.body.rules } });
    });
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    assert.equal(await page.locator('[data-random-outcome]').count(), count);
    if (action === 'remove') {
      await page.evaluate(() => document.querySelector('[data-remove-outcome]').click());
      assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    }
  });
}

test('S7-005: move controls follow empty, single, first, middle and last positions', async (t) => {
  const page = await fixture(t, 'libraries');
  await page.evaluate(async (limits) => {
    const { createOvertimeRuleEditor } = await import('/js/admin/overtime-rule-editor.js');
    const root = document.createElement('div');
    document.body.append(root);
    window.editor = createOvertimeRuleEditor(root, () => {});
    window.editor.setLimits(limits);
    window.editor.renderRules([]);
    window.rows = () => [...root.querySelectorAll('[data-overtime-rule]')];
    window.bounds = () => window.rows().map((row) => [row.dataset.giftId,
      row.querySelector('[aria-label="将这条规则上移"]').disabled,
      row.querySelector('[aria-label="将这条规则下移"]').disabled]);
    window.addRule = (id) => window.editor.createRule({ id, name: id });
    window.move = (index, direction) => window.rows()[index].querySelector(`[aria-label="将这条规则${direction}移"]`).click();
    window.removeRule = (index) => window.rows()[index].querySelector('[aria-label="删除规则"]').click();
  }, limits);
  assert.deepEqual(await page.evaluate(() => window.bounds()), []);
  await page.evaluate(() => window.addRule('a'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['a', true, true]]);
  await page.evaluate(() => window.addRule('b'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['a', true, false], ['b', false, true]]);
  await page.evaluate(() => window.addRule('c'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['a', true, false], ['b', false, false], ['c', false, true]]);
  await page.evaluate(() => window.move(0, '下'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['b', true, false], ['a', false, false], ['c', false, true]]);
  await page.evaluate(() => { window.move(1, '下'); window.move(2, '上'); window.move(1, '上'); });
  assert.deepEqual(await page.evaluate(() => window.editor.readRules().map((rule) => [rule.giftId, rule.sortOrder])), [['a', 0], ['b', 1], ['c', 2]]);
  await page.evaluate(() => window.removeRule(2));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['a', true, false], ['b', false, true]]);
  await page.evaluate(() => window.addRule('c'));
  await page.evaluate(() => window.removeRule(1));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['a', true, false], ['c', false, true]]);
  await page.evaluate(() => window.removeRule(0));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['c', true, true]]);
  await page.evaluate(() => window.removeRule(0));
  assert.deepEqual(await page.evaluate(() => window.bounds()), []);
  await page.evaluate(() => window.addRule('d'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['d', true, true]]);
});

for (const result of ['success-edit', 'failure-edit', 'failure-unchanged', 'success-unchanged', 'success-revert', 'success-add', 'success-remove']) {
  test(`S7-004: overtime save ${result}`, async (t) => {
    const page = await fixture(t);
    await page.evaluate(() => {
      const input = document.querySelector('[data-outcome-weight]');
      input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('overtimeSaveRulesBtn').click();
    });
    if (result.endsWith('-edit') || result === 'success-revert') await page.evaluate((result) => {
      const input = document.querySelector('[data-outcome-weight]');
      input.value = '3'; input.dispatchEvent(new Event('input', { bubbles: true }));
      if (result === 'success-revert') { input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true })); }
      document.getElementById('overtimeSaveRulesBtn').dispatchEvent(new Event('click'));
    }, result);
    if (result === 'success-add' || result === 'success-remove') await page.evaluate((result) => {
      if (result === 'success-add') document.querySelector('[data-add-outcome]').click();
      else [...document.querySelectorAll('[data-remove-outcome]')].at(-1).click();
    }, result);
    assert.equal(await page.evaluate(() => window.pendingSaves.length), 1);
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    await page.evaluate((result) => {
      const request = window.pendingSaves[0];
      if (result.startsWith('failure-')) request.reject(new Error('synthetic save failure'));
      else request.resolve({ data: { ...window.initialState, rules: request.body.rules } });
    }, result);
    const dirty = result !== 'success-unchanged';
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), !dirty);
    assert.equal(await page.locator('[data-outcome-weight]').first().inputValue(), result.endsWith('-edit') ? '3' : '2');
    const count = result === 'success-add' ? 4 : result === 'success-remove' ? 2 : 3;
    assert.equal(await page.locator('[data-random-outcome]').count(), count);
    if (dirty) {
      await page.evaluate(() => { window.pushState(window.initialState); document.getElementById('overtimeSaveRulesBtn').click(); });
      assert.equal(await page.evaluate(() => window.pendingSaves[1].body.rules[0].outcomes[0].weight), result.endsWith('-edit') ? 3 : 2);
      assert.equal(await page.evaluate(() => window.pendingSaves[1].body.rules[0].outcomes.length), count);
      await page.evaluate(() => {
        const request = window.pendingSaves[1];
        request.resolve({ data: { ...window.initialState, rules: request.body.rules } });
      });
      assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    }
  });
}

const libraries = [
  { name: 'Blessing', factory: 'createBlessingEditor', ids: ['List', 'Count', 'Input', 'AddBtn', 'SaveBtn', 'Status'],
    initial: ['A', 'second'], key: 'checkinBlessings' },
  { name: 'Fortune', factory: 'createFortuneEditor', ids: ['List', 'Count', 'LevelInput', 'NameInput', 'TextInput', 'AdviceInput', 'AddBtn', 'SaveBtn', 'Status'],
    initial: [{ level: 'A', name: 'name', text: 'text', advice: 'advice' }, { level: 'second', name: 'name', text: 'text', advice: 'advice' }], key: 'fortunePool' },
  { name: 'CustomReply', factory: 'createCustomReplyEditor', ids: ['List', 'Count', 'AddBtn', 'SaveBtn', 'Status'],
    extraIds: ['danmakuCustomKeywordInput', 'danmakuCustomReplyInput'],
    initial: [{ keyword: 'A', reply: 'reply', enabled: true }, { keyword: 'second', reply: 'reply', enabled: true }], key: 'customReplyRules' },
];

for (const library of libraries) {
  for (const result of ['success-edit', 'failure-edit', 'failure-unchanged', 'success-unchanged', 'success-revert', 'success-add', 'success-remove']) {
    test(`S7-004: ${library.name} save ${result}`, async (t) => {
      const page = await fixture(t, 'libraries');
      await page.evaluate(async (library) => {
        const ids = library.ids.map((suffix) => `danmaku${library.name}${suffix}`).concat(library.extraIds || []);
        for (const id of ids) {
          const node = document.createElement(/Btn$/.test(id) ? 'button' : /Input$/.test(id) ? 'input' : 'div');
          node.id = id; document.body.append(node);
        }
        const module = await import('/js/admin/danmaku-libraries.js');
        window.editor = module[library.factory]({ document, saveSetting: window.saveSetting, toast: (message) => window.messages.push(message) });
        window.editor.load(JSON.stringify(library.initial));
        window.list = document.getElementById(`danmaku${library.name}List`);
        window.saveButton = document.getElementById(`danmaku${library.name}SaveBtn`);
        window.statusNode = document.getElementById(`danmaku${library.name}Status`);
        window.edit = (value) => { const input = window.list.querySelector('input'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
        window.edit(' A ');
        window.saveButton.click();
      }, library);
      await page.evaluate(({ library, result }) => {
        if (result.endsWith('-edit') || result === 'success-revert') {
          window.edit('B'); if (result === 'success-revert') window.edit(' A ');
        } else if (result === 'success-add') {
          for (const input of document.querySelectorAll('body > input')) input.value = 'new';
          document.getElementById(`danmaku${library.name}AddBtn`).click();
        } else if (result === 'success-remove') {
          window.list.lastElementChild.querySelector('button').click();
        }
      }, { library, result });
      assert.equal(await page.evaluate(() => window.pendingSaves.length), 1);
      assert.equal(await page.evaluate(() => window.saveButton.disabled), true);
      await page.evaluate(() => window.saveButton.dispatchEvent(new Event('click')));
      assert.equal(await page.evaluate(() => window.pendingSaves.length), 1);
      assert.equal(await page.evaluate(() => window.pendingSaves[0].key), library.key);
      await page.evaluate((result) => {
        if (result.startsWith('failure-')) window.pendingSaves[0].reject(new Error('synthetic failure'));
        else window.pendingSaves[0].resolve();
      }, result);
      const dirty = result !== 'success-unchanged';
      assert.equal(await page.evaluate(() => window.saveButton.disabled), !dirty);
      assert.equal(await page.evaluate(() => window.list.querySelector('input').value), result.endsWith('-edit') ? 'B' : result === 'success-unchanged' ? 'A' : ' A ');
      assert.equal(await page.evaluate(() => window.list.children.length), result === 'success-add' ? 3 : result === 'success-remove' ? 1 : 2);
      if (dirty) {
        const before = await page.evaluate(() => window.list.innerHTML);
        await page.evaluate((initial) => window.editor.load(JSON.stringify(initial)), library.initial);
        assert.equal(await page.evaluate(() => window.list.innerHTML), before);
        await page.evaluate(() => window.saveButton.click());
        assert.equal(await page.evaluate(() => window.pendingSaves.length), 2);
        const saved = await page.evaluate(() => JSON.parse(window.pendingSaves[1].value));
        const first = typeof saved[0] === 'string' ? saved[0] : saved[0].level ?? saved[0].keyword;
        assert.equal(first, result.endsWith('-edit') ? 'B' : 'A');
        assert.equal(saved.length, result === 'success-add' ? 3 : result === 'success-remove' ? 1 : 2);
        await page.evaluate(() => window.pendingSaves[1].resolve());
        assert.equal(await page.evaluate(() => window.saveButton.disabled), true);
      }
    });
  }
}

function snapshot(revision, seconds) {
  return { revision, status: 'paused', effectiveRemainingMs: seconds * 1000, rules: [] };
}

async function openSocket(page, reconnect = false) {
  await page.evaluate((reconnect) => {
    window.socketOptions.onOpen?.();
    if (reconnect) window.socketOptions.onReconnect();
  }, reconnect);
}

async function sendState(page, state, type = 'snapshot', adjustment = null) {
  await page.evaluate(({ state, type, adjustment }) => window.socketOptions.onMessage({
    type, state: type === 'snapshot' ? { overtime: state } : state, adjustment,
  }), { state, type, adjustment });
}

async function resolveSnapshot(page, index, state) {
  await page.evaluate(({ index, state }) => window.pendingSnapshots[index].resolve(state), { index, state });
}

async function clockValue(page) {
  return page.locator('#overtimeClock').textContent();
}

test('S7-013: initial HTTP snapshot restores state before a socket is available', async (t) => {
  const page = await fixture(t, 'overlay');
  await resolveSnapshot(page, 0, snapshot(10, 300));
  assert.equal(await clockValue(page), '00:05:00');
});

test('S7-013: an old initial HTTP response cannot roll back a newer WebSocket state', async (t) => {
  const page = await fixture(t, 'overlay');
  await openSocket(page);
  await sendState(page, snapshot(11, 360));
  await resolveSnapshot(page, 0, snapshot(10, 300));
  assert.equal(await clockValue(page), '00:06:00');
  await sendState(page, snapshot(12, 420), 'overtime:update');
  assert.equal(await clockValue(page), '00:07:00');
});

test('S7-013: same-connection snapshots and updates share the revision guard', async (t) => {
  const page = await fixture(t, 'overlay');
  await openSocket(page);
  await sendState(page, snapshot(12, 420));
  for (const type of ['snapshot', 'overtime:update']) {
    for (const revision of [11, 12]) {
      await sendState(page, snapshot(revision, 120), type, { giftName: 'stale', appliedDeltaSeconds: 60 });
      assert.equal(await clockValue(page), '00:07:00');
      assert.equal(await page.locator('#overtimeAdjustmentStage').textContent(), '');
    }
  }
  await sendState(page, snapshot(13, 480), 'overtime:update', { giftName: 'fresh', appliedDeltaSeconds: 60 });
  assert.equal(await clockValue(page), '00:08:00');
  assert.match(await page.locator('#overtimeAdjustmentStage').textContent(), /fresh/);
});

test('clear-all synchronizes the existing overtime socket and rejects pre-clear HTTP state', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-overtime-overlay-'));
  const db = createDatabases({ dataDir });
  const service = createOvertimeService({ giftDb: db.giftDb });
  t.after(() => {
    service.dispose();
    closeDatabases(db);
    assert.equal(path.dirname(fs.realpathSync(dataDir)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  service.act('enable');
  service.setTime({ remainingSeconds: 600 });
  const previousState = service.getSnapshot();
  const page = await fixture(t, 'overlay');
  await openSocket(page, true);
  await sendState(page, previousState);
  assert.equal(await clockValue(page), '00:10:00');

  for (let reset = 0; reset < 2; reset += 1) {
    const { songDb, superChatDb, giftDb, musicDb, checkinDb } = db;
    assert.equal(clearAllData(songDb, superChatDb, giftDb, musicDb, checkinDb).cleared, true);
    service.reloadState();
    await sendState(page, service.getSnapshot());
    assert.equal(await clockValue(page), '00:00:00');
    service.act('enable');
    service.setTime({ remainingSeconds: 60 });
    await sendState(page, service.getSnapshot(), 'overtime:update');
    assert.equal(await clockValue(page), '00:01:00');
  }

  await resolveSnapshot(page, 1, previousState);
  assert.equal(await clockValue(page), '00:01:00');
});

test('S7-013: the first socket after an HTTP-only load can restore a restarted service', async (t) => {
  const page = await fixture(t, 'overlay');
  await resolveSnapshot(page, 0, snapshot(50, 600));
  await openSocket(page);
  await sendState(page, snapshot(1, 60));
  await sendState(page, snapshot(2, 120), 'overtime:update');
  assert.equal(await clockValue(page), '00:02:00');
});

for (const first of ['http', 'websocket']) {
  test(`S7-013: reconnect accepts a lower restart revision with ${first} first`, async (t) => {
    const page = await fixture(t, 'overlay');
    await openSocket(page);
    await sendState(page, snapshot(50, 600));
    await page.evaluate(() => window.socketOptions.onClose());
    await openSocket(page, true);
    if (first === 'http') {
      await resolveSnapshot(page, 1, snapshot(1, 60));
      await sendState(page, snapshot(2, 120));
    } else {
      await sendState(page, snapshot(2, 120));
      await resolveSnapshot(page, 1, snapshot(1, 60));
    }
    assert.equal(await clockValue(page), '00:02:00');
    await resolveSnapshot(page, 0, snapshot(99, 900));
    assert.equal(await clockValue(page), '00:02:00');
    await sendState(page, snapshot(3, 180), 'overtime:update');
    assert.equal(await clockValue(page), '00:03:00');
  });
}

for (const revision of [10, 11, 12]) {
  test(`S7-013: reconnect HTTP revision ${revision} is compared with current WS revision 11`, async (t) => {
    const page = await fixture(t, 'overlay');
    await openSocket(page);
    await sendState(page, snapshot(9, 300));
    await page.evaluate(() => window.socketOptions.onClose());
    await openSocket(page, true);
    await sendState(page, snapshot(11, 360));
    await resolveSnapshot(page, 1, snapshot(revision, 420));
    assert.equal(await clockValue(page), revision > 11 ? '00:07:00' : '00:06:00');
  });
}

test('S7-013: old-connection HTTP completion is ignored while disconnected', async (t) => {
  const page = await fixture(t, 'overlay');
  await openSocket(page);
  await sendState(page, snapshot(10, 300));
  await page.evaluate(() => window.socketOptions.onClose());
  await resolveSnapshot(page, 0, snapshot(99, 900));
  assert.equal(await clockValue(page), '00:05:00');
  assert.equal(await page.locator('#overtimeStatusText').textContent(), '连接中断');
});
