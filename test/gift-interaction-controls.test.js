'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createCloudSyncController } = require('../src/electron/cloud-sync-controller');
const { registerGiftInteractionIpc } = require('../src/electron/ipc/gift-interaction-ipc');

const KEYS = ['giftAutoThanksEnabled', 'giftStatsQueryEnabled'];
const flags = (thanks = false, query = false) => ({ giftAutoThanksEnabled: thanks, giftStatsQueryEnabled: query });
const deferred = () => Promise.withResolvers();

function fixture(t) {
  let account = 'first';
  let local = { roomId: '123', enableBilibili: true, paused: false, queueLimit: 25,
    userCooldownSeconds: 5, onlyFromLibrary: false, allowDuplicate: true, giftBlindBoxConfig: [] };
  let cloud = { ...local, ...flags() };
  let revision = 1;
  let stateListener;
  const calls = [];
  const manager = {
    LicenseState: { AUTHORIZED: 'authorized' }, getState: () => 'authorized',
    getCloudSyncIdentity: () => ({ accountName: account, streamerId: account === 'first' ? 1 : 2 }),
    getRemoteBaseUrl: () => 'https://api.example.test',
    onStateChanged: (listener) => { stateListener = listener; return () => {}; },
    getCloudState: async () => ({ settings: { initialized: true, revision, values: { ...cloud } },
      songs: { initialized: true, revision: 1 }, bilibili: { initialized: false } }),
    getCloudSongs: async () => ({ songs: [], revision: 1 }),
    updateCloudSettings: async (values) => {
      calls.push(values);
      cloud = { ...cloud, ...values };
      return { revision: ++revision, values: { ...cloud } };
    },
  };
  const controller = createCloudSyncController({ licenseManager: manager,
    runtime: { prepareCloudRoomAccount: () => false, getCloudSettingsSnapshot: () => ({ ...local }),
      applyCloudSettingsSnapshot: (values) => { local = Object.fromEntries(Object.entries(values).filter(([key]) => !KEYS.includes(key))); },
      replaceCloudSongsSnapshot() {} },
    bilibiliAuth: { logout: async () => {} },
    timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} },
  });
  t.after(() => controller.dispose());
  return { controller, manager, calls,
    changeLocal: (values) => { local = { ...local, ...values }; controller.markDirty('settings'); },
    setCloud: (values) => { cloud = { ...cloud, ...values }; revision += 1; },
    switchAccount: () => { account = 'second'; cloud = { ...local, ...flags() }; stateListener({ state: 'authorized' }); },
  };
}

test('initially off; four combinations are independent complete settings writes with omitted peer field', async (t) => {
  const f = fixture(t);
  assert.deepEqual(f.controller.getGiftInteractionState().values, flags());
  await f.controller.start();
  for (const [key, enabled, expected] of [
    [KEYS[0], true, flags(true, false)], [KEYS[1], true, flags(true, true)],
    [KEYS[0], false, flags(false, true)], [KEYS[1], false, flags()],
  ]) {
    const result = await f.controller.setGiftInteraction({ key, enabled });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'confirmed');
    assert.deepEqual(result.values, expected);
    assert.equal(f.calls.at(-1).roomId, '123');
    assert.equal(f.calls.at(-1).queueLimit, 25);
    assert.equal(Object.hasOwn(f.calls.at(-1), KEYS.find((peer) => peer !== key)), false);
  }
  await assert.rejects(f.controller.setGiftInteraction({ key: KEYS[0], enabled: 'true' }), { code: 'INVALID_GIFT_INTERACTION' });
  await assert.rejects(f.controller.setGiftInteraction({ key: KEYS[0], enabled: true, token: 'secret' }), { code: 'INVALID_GIFT_INTERACTION' });
});

test('pending request preserves confirmed display, rejects repeat and response loss reconciles remotely', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const pending = deferred();
  f.manager.updateCloudSettings = () => pending.promise;
  const resultPromise = f.controller.setGiftInteraction({ key: KEYS[0], enabled: true });
  assert.equal(f.controller.getGiftInteractionState().status, 'pending');
  assert.deepEqual(f.controller.getGiftInteractionState().values, flags());
  await assert.rejects(f.controller.setGiftInteraction({ key: KEYS[1], enabled: true }), { code: 'GIFT_INTERACTION_PENDING' });
  f.setCloud(flags(true));
  pending.reject(Object.assign(new Error('Cookie=secret'), { code: 'NETWORK_UNAVAILABLE' }));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unconfirmed');
  assert.deepEqual(result.values, flags());
  assert.doesNotMatch(JSON.stringify(result), /Cookie|secret/);
  const refreshed = await f.controller.refreshGiftInteractionState();
  assert.equal(refreshed.status, 'confirmed');
  assert.deepEqual(refreshed.values, flags(true));
});

test('peer changes survive a narrow write; offline off and malformed acknowledgements stay unconfirmed', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.setCloud(flags(false, true)); // Another device wrote after this client's last read.
  assert.deepEqual((await f.controller.setGiftInteraction({ key: KEYS[0], enabled: true })).values, flags(true, true));
  f.manager.updateCloudSettings = async () => { throw new Error('offline'); };
  const failed = await f.controller.setGiftInteraction({ key: KEYS[0], enabled: false });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'unconfirmed');
  assert.deepEqual(failed.values, flags(true, true));
  f.manager.updateCloudSettings = async () => ({ values: { giftAutoThanksEnabled: false } });
  const malformed = await f.controller.setGiftInteraction({ key: KEYS[0], enabled: false });
  assert.equal(malformed.error, 'INVALID_RESPONSE');
  assert.deepEqual(malformed.values, flags(true, true));
});

test('local settings changed during the intent upload remain dirty and send after it', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const release = deferred();
  const upload = f.manager.updateCloudSettings;
  let first = true;
  f.manager.updateCloudSettings = async (values) => {
    const result = await upload(values);
    if (first) { first = false; await release.promise; }
    return result;
  };
  const pending = f.controller.setGiftInteraction({ key: KEYS[0], enabled: true });
  await new Promise(setImmediate);
  f.changeLocal({ queueLimit: 50 });
  release.resolve();
  assert.equal((await pending).ok, true);
  await f.controller.whenIdle();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].queueLimit, 25);
  assert.equal(f.calls[1].queueLimit, 50);
  assert.deepEqual(f.controller.getGiftInteractionState().values, flags(true));
});

test('gate errors do not enable; remote logout/room change resets; new account rejects late response', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  for (const code of ['BILIBILI_LOGIN_REQUIRED', 'BILIBILI_CREDENTIALS_INVALID', 'BILIBILI_ACCOUNT_CHECK_FAILED']) {
    f.manager.updateCloudSettings = async () => { throw Object.assign(new Error(), { code }); };
    const result = await f.controller.setGiftInteraction({ key: KEYS[0], enabled: true });
    assert.equal(result.error, code);
    assert.deepEqual(result.values, flags());
  }
  f.setCloud(flags(true, true));
  await f.controller.syncNow();
  assert.deepEqual(f.controller.getGiftInteractionState().values, flags(true, true));
  f.setCloud(flags());
  await f.controller.syncNow();
  assert.deepEqual(f.controller.getGiftInteractionState().values, flags());
  const pending = deferred();
  f.manager.updateCloudSettings = () => pending.promise;
  const write = f.controller.setGiftInteraction({ key: KEYS[0], enabled: true });
  await Promise.resolve();
  f.switchAccount();
  pending.resolve({ revision: 99, values: flags(true, true) });
  assert.equal((await write).ok, false);
  await f.controller.whenIdle();
  assert.deepEqual(f.controller.getGiftInteractionState().values, flags());
});

test('IPC checks exact frame and origin, sanitizes responses/events and removes handlers', async () => {
  const handlers = new Map();
  const frame = { url: 'http://127.0.0.1:3000/admin' };
  const sent = [];
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame, send: (...args) => sent.push(args) } };
  const state = { values: { ...flags(), cookie: 'secret' }, status: 'confirmed', token: 'secret' };
  let changed;
  const dispose = registerGiftInteractionIpc({
    ipcMain: { handle: (key, value) => handlers.set(key, value), removeHandler: (key) => handlers.delete(key) },
    controller: { refreshGiftInteractionState: async () => state, setGiftInteraction: async () => state,
      onGiftInteractionStateChanged: (listener) => { changed = listener; return () => { changed = null; }; } },
    getMainWindow: () => window, getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
  });
  const event = { sender: window.webContents, senderFrame: frame };
  for (const handler of handlers.values()) {
    for (const invalid of [{}, { ...event, sender: {} }, { ...event, senderFrame: { ...frame } }]) {
      assert.equal((await handler(invalid)).error, 'IPC_SOURCE_INVALID');
    }
    assert.doesNotMatch(JSON.stringify(await handler(event)), /cookie|token|secret/);
    frame.url = 'https://evil.test/admin';
    assert.equal((await handler(event)).error, 'IPC_SOURCE_INVALID');
    frame.url = 'http://127.0.0.1:3000/admin';
  }
  changed(state);
  assert.doesNotMatch(JSON.stringify(sent), /cookie|token|secret/);
  dispose();
  assert.equal(handlers.size, 0);
  assert.equal(changed, null);
});

test('preload exposes explicit boolean intents and removable state subscription only', () => {
  const exposed = new Map();
  const calls = [];
  const listeners = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/electron/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (key, value) => exposed.set(key, value) },
      ipcRenderer: { invoke: (...args) => calls.push(args), on: (name, handler) => listeners.set(name, handler),
        removeListener: (name) => listeners.delete(name) } }),
  });
  const bridge = exposed.get('liraLicense');
  bridge.setGiftInteraction(KEYS[1], true);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['license:set-gift-interaction', { key: KEYS[1], enabled: true }]));
  const unsubscribe = bridge.onGiftInteractionStateChanged(() => {});
  assert.equal(listeners.size, 1);
  unsubscribe();
  assert.equal(listeners.size, 0);
});

async function uiFixture() {
  function element() {
    const listeners = new Map();
    return { checked: false, disabled: false, hidden: true, textContent: '', listeners,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name) };
  }
  const ids = [...KEYS, 'giftInteractionControls', 'giftInteractionStatus', 'giftInteractionRefresh'];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  const windowRef = element();
  const toasts = [];
  let listener;
  const bridge = { getGiftInteractionState: async () => ({ status: 'confirmed', values: flags() }),
    onGiftInteractionStateChanged: (callback) => { listener = callback; return () => { listener = null; }; },
    setGiftInteraction: async () => ({ ok: false, status: 'unconfirmed', values: flags(), error: 'BILIBILI_LOGIN_REQUIRED' }) };
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../public/js/admin/gifts/interaction-controls.js'), 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(['toast'], function () { this.setExport('toast', () => {}); }, { context }));
  await module.evaluate();
  const dispose = module.namespace.initGiftInteractionControls({ documentRef: { getElementById: (id) => elements[id] }, windowRef, bridge, notify: (text) => toasts.push(text) });
  await new Promise(setImmediate);
  return { elements, toasts, bridge, dispose, emit: (state) => listener?.(state),
    async click(key, enabled) { elements[key].checked = enabled; elements[key].listeners.get('change')(); await new Promise(setImmediate); } };
}

test('renderer keeps logged-out control clickable, distinct errors, pending rollback and offline-off warning', async () => {
  const ui = await uiFixture();
  assert.equal(ui.elements[KEYS[0]].disabled, false);
  await ui.click(KEYS[0], true);
  assert.equal(ui.toasts.at(-1), '请先登录 B 站，再同步到服务器。');
  assert.equal(ui.elements[KEYS[0]].checked, false);
  for (const [error, message] of [['BILIBILI_CREDENTIALS_INVALID', 'B 站登录已失效，请重新登录并同步。'], ['BILIBILI_ACCOUNT_CHECK_FAILED', 'B 站登录验证超时，请稍后再试。']]) {
    ui.bridge.setGiftInteraction = async () => ({ ok: false, status: 'unconfirmed', values: flags(), error });
    await ui.click(KEYS[0], true);
    assert.equal(ui.toasts.at(-1), message);
  }
  ui.emit({ status: 'confirmed', values: flags(true, true) });
  const pending = deferred();
  ui.bridge.setGiftInteraction = () => pending.promise;
  await ui.click(KEYS[0], false);
  assert.equal(ui.elements[KEYS[0]].checked, true);
  assert.equal(ui.elements[KEYS[1]].disabled, true);
  pending.resolve({ ok: false, status: 'unconfirmed', values: flags(true, true) });
  await new Promise(setImmediate);
  assert.equal(ui.toasts.at(-1), '关闭还没同步，服务器可能仍在运行。');
  ui.emit({ status: 'confirmed', values: flags() });
  assert.equal(ui.elements[KEYS[0]].checked, false);
  assert.equal(ui.elements[KEYS[1]].checked, false);
  ui.dispose();
  assert.equal(ui.elements[KEYS[0]].listeners.size, 0);
});

test('renderer preserves a newer account snapshot when an older change response arrives', async () => {
  const ui = await uiFixture();
  const pending = deferred();
  ui.bridge.setGiftInteraction = () => pending.promise;
  await ui.click(KEYS[0], true);
  ui.emit({ status: 'confirmed', values: flags(), error: null });
  pending.resolve({ ok: true, status: 'confirmed', values: flags(true), error: null });
  await new Promise(setImmediate);
  assert.equal(ui.elements[KEYS[0]].checked, false);
  assert.equal(ui.elements[KEYS[0]].disabled, false);
  assert.equal(ui.toasts.length, 0);
  ui.dispose();
});
