'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createDesktopNotifications, configureNotificationIdentity } = require('../../src/electron/desktop-notifications');
const { registerDesktopNotificationsIpc } = require('../../src/electron/ipc/desktop-notifications-ipc');

test('notification identity separates development and repairs only its own legacy shortcut', () => {
  const productionId = 'com.aurorawhisperer.lira';
  const exe = path.resolve('tmp/qa-electron/electron.exe');
  const ids = [];
  const writes = [];
  let link = { target: exe, appUserModelId: productionId };
  const app = { isPackaged: false, setAppUserModelId: id => ids.push(id), getPath: key => key === 'exe' ? exe : path.resolve('tmp/qa-appdata') };
  const shell = { readShortcutLink: () => link, writeShortcutLink: (...args) => { writes.push(args); return true; } };
  const run = () => configureNotificationIdentity({ app, shell, fileSystem: { existsSync: () => true } });
  run();
  assert.equal(ids.at(-1), `${productionId}.development`);
  assert.equal(writes[0][1], 'update');
  assert.deepEqual(writes[0][2], { appUserModelId: `${productionId}.development` });
  link = { ...link, target: path.resolve('tmp/other-electron/electron.exe') };
  run();
  assert.equal(writes.length, 1, 'another checkout is not modified');
  app.isPackaged = true;
  run();
  assert.equal(ids.at(-1), productionId);
  assert.equal(writes.length, 1, 'the installed application keeps its existing production identity');
});

test('installed startup separates a verified legacy LIRA development shortcut and is idempotent', () => {
  const productionId = 'com.aurorawhisperer.lira';
  const project = path.resolve('tmp/legacy-lira');
  let link = { target: path.join(project, 'node_modules/electron/dist/electron.exe'), appUserModelId: productionId };
  const writes = [];
  const ids = [];
  const app = { isPackaged: true, setAppUserModelId: id => ids.push(id), getPath: key => path.resolve('tmp', key) };
  const shell = {
    readShortcutLink: () => link,
    writeShortcutLink: (shortcut, operation, patch) => { writes.push({ operation, patch }); link = { ...link, ...patch }; return true; },
  };
  const fileSystem = {
    existsSync: () => true,
    readFileSync: filename => {
      assert.equal(filename, path.join(project, 'package.json'));
      return JSON.stringify({ name: 'lira', build: { appId: productionId } });
    },
  };
  for (let startup = 0; startup < 2; startup++) configureNotificationIdentity({ app, shell, fileSystem });
  assert.deepEqual(ids, [productionId, productionId]);
  assert.deepEqual(writes, [{ operation: 'update', patch: { appUserModelId: `${productionId}.development` } }]);
});

test('installed identity repair leaves unrelated targets intact and retries a failed write on next startup', () => {
  const productionId = 'com.aurorawhisperer.lira';
  let link = { target: path.resolve('tmp/other/node_modules/electron/dist/electron.exe'), appUserModelId: productionId };
  let manifest = { name: 'other-app', build: { appId: productionId } };
  let writes = 0;
  let writable = false;
  const logs = [];
  const app = { isPackaged: true, setAppUserModelId() {}, getPath: key => path.resolve('tmp', key) };
  const shell = { readShortcutLink: () => link, writeShortcutLink: () => { writes++; return writable; } };
  const fileSystem = { existsSync: () => true, readFileSync: () => JSON.stringify(manifest) };
  const run = () => configureNotificationIdentity({ app, shell, fileSystem, writeLog: (...args) => logs.push(args) });
  run();
  assert.equal(writes, 0);
  manifest = { name: 'lira', build: { appId: productionId } };
  link = { ...link, target: path.resolve('tmp/other/random.exe') };
  run();
  assert.equal(writes, 0);
  link = { ...link, target: path.resolve('tmp/lira/node_modules/electron/dist/electron.exe') };
  run();
  assert.equal(logs.length, 1);
  writable = true;
  run();
  assert.equal(writes, 2);
  assert.equal(logs.length, 1);
});

function fixture(t, overrides = {}) {
  const root = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(root, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, 'desktop-notifications-'));
  const shown = [];
  const logs = [];
  const plannerChanges = [];
  const windowActions = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; }
    show() { shown.push(this); }
    close() { this.closed = true; this.emit('close'); }
  }
  const now = () => Date.parse('2026-11-04T12:00:00Z');
  const options = { dataDir, Notification, now, writeLog: (...args) => logs.push(args),
    onPlannerRemindersChanged: (value) => plannerChanges.push(value),
    getMainWindow: () => ({ isDestroyed: () => false, isMinimized: () => true,
      restore: () => windowActions.push('restore'), show: () => windowActions.push('show'), focus: () => windowActions.push('focus') }),
    ...overrides };
  const owner = createDesktopNotifications(options);
  t.after(async () => { owner.dispose(); await owner.whenIdle(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const gift = { detection_status: 'final', total_price: 1200, num: 10, user_name: '观众A', gift_name: '测试礼物',
    updated_at: new Date(now()).toISOString() };
  return { owner, options, dataDir, shown, gift, logs, plannerChanges, windowActions };
}

test('large gift notifications require opt-in and compare the final total strictly to the saved threshold', async (t) => {
  const f = fixture(t);
  f.owner.notifyGift(f.gift);
  assert.equal(f.shown.length, 0);
  await f.owner.update({ largeGiftEnabled: true });
  f.owner.notifyGift({ ...f.gift, updated_at: '2026-11-03T12:00:00Z' });
  f.owner.notifyGift({ ...f.gift, detection_status: 'progress' });
  f.owner.notifyGift({ ...f.gift, total_price: 999.99 });
  f.owner.notifyGift({ ...f.gift, total_price: 1000 });
  assert.equal(f.shown.length, 0);
  f.owner.notifyGift({ ...f.gift, total_price: 1000.01 });
  assert.equal(f.shown.length, 1);
  assert.match(f.shown[0].options.body, /1000\.01/);
  assert.doesNotMatch(f.shown[0].options.body, /10000\.10/);
  await f.owner.update({ largeGiftThresholdRmb: 1500 });
  f.owner.notifyGift(f.gift);
  assert.equal(f.shown.length, 1);
});

test('settings survive restart, serialize concurrent patches and notify the planner only after saving', async (t) => {
  const f = fixture(t);
  await Promise.all([
    f.owner.update({ plannerRemindersEnabled: false }),
    f.owner.update({ largeGiftEnabled: true, largeGiftThresholdRmb: 2000.50 }),
  ]);
  assert.deepEqual(f.plannerChanges, [false]);
  const restored = createDesktopNotifications(f.options);
  t.after(() => restored.dispose());
  assert.equal(restored.getState().settings.plannerRemindersEnabled, false);
  restored.notifyGift({ ...f.gift, total_price: 2000.51 });
  assert.equal(f.shown.length, 1);
  assert.deepEqual(fs.readdirSync(f.dataDir), ['desktop-notifications.json']);
});

test('invalid patches and failed writes preserve settings and allow a later retry', async (t) => {
  let fail = true;
  const f = fixture(t, { fileSystem: { ...fs, promises: { ...fs.promises, rename: async (...args) => {
    if (fail) throw new Error('private-path');
    return fs.promises.rename(...args);
  } } } });
  for (const patch of [{ largeGiftEnabled: 'true' }, { largeGiftThresholdRmb: -1 }, { largeGiftThresholdRmb: 0.001 }, { path: 'file' }]) {
    assert.equal((await f.owner.update(patch)).ok, false);
  }
  assert.equal((await f.owner.update({ plannerRemindersEnabled: false, largeGiftEnabled: true })).ok, false);
  assert.equal(f.owner.getState().settings.plannerRemindersEnabled, true);
  assert.deepEqual(f.plannerChanges, []);
  f.owner.notifyGift(f.gift);
  assert.equal(f.shown.length, 0);
  assert.deepEqual(fs.readdirSync(f.dataDir), []);
  assert.doesNotMatch(JSON.stringify(f.logs), /private-path/);
  fail = false;
  assert.equal((await f.owner.update({ plannerRemindersEnabled: false })).ok, true);
  assert.deepEqual(f.plannerChanges, [false]);
});

test('notification clicks restore the window; disabling and disposal release active notifications', async (t) => {
  const f = fixture(t);
  await f.owner.update({ largeGiftEnabled: true });
  f.owner.notifyGift(f.gift);
  f.shown[0].emit('click');
  assert.deepEqual(f.windowActions, ['restore', 'show', 'focus']);
  await f.owner.update({ largeGiftEnabled: false });
  assert.equal(f.shown[0].closed, true);
  f.owner.notifyGift(f.gift);
  assert.equal(f.shown.length, 1);
  await f.owner.update({ largeGiftEnabled: true });
  f.owner.notifyGift(f.gift);
  f.shown[1].emit('failed', {}, 'private-observer');
  assert.doesNotMatch(JSON.stringify(f.logs), /观众A|private-observer/);
  f.owner.notifyGift(f.gift);
  f.owner.dispose();
  assert.equal(f.shown[2].closed, true);
  f.owner.notifyGift(f.gift);
  assert.equal(f.shown.length, 3);
});

test('notification settings IPC rejects untrusted frames, extra arguments and unrelated pages', async () => {
  const handlers = new Map();
  const calls = [];
  const baseUrl = 'http://127.0.0.1:31001';
  const mainFrame = { url: `${baseUrl}/admin` };
  const webContents = { mainFrame };
  const win = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: mainFrame };
  const dispose = registerDesktopNotificationsIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) },
    notifications: { getState: () => ({ ok: true }), update: (patch) => { calls.push(patch); return { ok: true }; } },
    getMainWindow: () => win, getDesktopBaseUrl: () => baseUrl,
  });
  for (const handler of handlers.values()) {
    for (const source of [undefined, { ...event, sender: {} }, { ...event, senderFrame: { url: mainFrame.url } }]) {
      assert.equal(handler(source, {}).error, 'IPC_SOURCE_INVALID');
    }
    for (const url of [`${baseUrl}/songs`, `${baseUrl}/license`, 'https://example.com/admin']) {
      mainFrame.url = url;
      assert.equal(handler(event, {}).error, 'IPC_SOURCE_INVALID');
    }
    mainFrame.url = `${baseUrl}/admin`;
  }
  assert.equal(handlers.get('desktop-notifications:get-state')(event, {}).ok, false);
  assert.equal(handlers.get('desktop-notifications:update')(event).ok, false);
  assert.equal(handlers.get('desktop-notifications:update')(event, {}, {}).ok, false);
  assert.equal(handlers.get('desktop-notifications:get-state')(event).ok, true);
  assert.equal((await handlers.get('desktop-notifications:update')(event, { largeGiftEnabled: true })).ok, true);
  assert.equal(calls.length, 1);
  dispose();
  assert.equal(handlers.size, 0);
});
