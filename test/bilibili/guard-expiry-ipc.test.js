'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { registerGuardExpiryIpc } = require('../../src/electron/ipc/guard-expiry-ipc');

test('guard expiry IPC authorizes every operation and exposes only safe account metadata', async () => {
  const handlers = new Map();
  const frame = { url: 'http://127.0.0.1:3000/admin' };
  const main = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: main.webContents, senderFrame: frame };
  const calls = [];
  const account = { source: 'separate', loggedIn: true, uid: '123', displayName: '主播', revision: 2 };
  const auth = Object.fromEntries(['getState', 'login', 'logout', 'setSource'].map((method) => [method, async (...args) => {
    calls.push({ method, args }); return { ...account, cookie: 'secret', cookieEnc: 'encrypted' };
  }]));
  const dispose = registerGuardExpiryIpc({
    auth, ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) },
    getMainWindow: () => main, getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
  });
  for (const fn of handlers.values()) {
    for (const invalid of [{}, { ...event, sender: {} }, { ...event, senderFrame: { ...frame } }]) {
      assert.equal((await fn(invalid)).error, 'IPC_SOURCE_INVALID');
    }
    for (const url of ['https://passport.bilibili.com/', 'http://127.0.0.1:3001/admin', 'http://127.0.0.1:3000/license']) {
      frame.url = url;
      assert.equal((await fn(event)).error, 'IPC_SOURCE_INVALID');
    }
    frame.url = 'http://127.0.0.1:3000/admin';
    assert.deepEqual(await fn(event, 'separate'), { ok: true, account });
  }
  assert.equal(calls.length, 4);
  auth.login = async () => { throw new Error('SESSDATA=secret'); };
  assert.deepEqual(await handlers.get('guard-expiry:login')(event), { ok: false, error: 'GUARD_EXPIRY_UNAVAILABLE' });
  dispose(); dispose();
  assert.equal(handlers.size, 0);
});

test('preload accepts only source choice and parameterless owner login/state/logout', async () => {
  const bridges = new Map();
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/electron/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (name, bridge) => bridges.set(name, bridge) },
      ipcRenderer: { invoke: (...args) => calls.push(args) } }),
  });
  const bridge = bridges.get('guardExpiryAuth');
  assert.deepEqual(Object.keys(bridge), ['getState', 'setSource', 'login', 'logout']);
  await bridge.getState('secret'); await bridge.login('secret'); await bridge.logout('secret');
  await bridge.setSource('shared');
  assert.deepEqual(calls, [['guard-expiry:get-state'], ['guard-expiry:login'], ['guard-expiry:logout'], ['guard-expiry:set-source', 'shared']]);
});
