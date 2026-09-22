'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { registerDynamicLotteryAuthIpc } = require('../src/electron/ipc/dynamic-lottery-auth-ipc');

function fixture(overrides = {}) {
  const handlers = new Map();
  const frame = { url: 'http://127.0.0.1:3000/admin?desktop=1' };
  const window = {
    isDestroyed: () => false,
    webContents: { mainFrame: frame },
  };
  const calls = [];
  const auth = Object.fromEntries(
    ['getAuthState', 'login', 'logout'].map((name) => [
      name,
      async () => {
        calls.push(name);
        return {
          loggedIn: true,
          uid: '9007199254740993123',
          cookieHeader: 'secret',
          ...overrides,
        };
      },
    ]),
  );
  const dispose = registerDynamicLotteryAuthIpc({
    ipcMain: {
      handle: (name, handler) => handlers.set(name, handler),
      removeHandler: (name) => handlers.delete(name),
    },
    auth,
    getMainWindow: () => window,
    getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
  });
  return {
    handlers,
    auth,
    calls,
    frame,
    window,
    dispose,
    event: { sender: window.webContents, senderFrame: frame },
  };
}

test('all dedicated auth IPC requires the actual main window, main frame and exact origin', async () => {
  const f = fixture();
  for (const handler of f.handlers.values()) {
    for (const event of [{}, { ...f.event, sender: {} }, { ...f.event, senderFrame: { url: f.frame.url } }])
      assert.deepEqual(await handler(event), {
        ok: false,
        error: 'IPC_SOURCE_INVALID',
      });
    f.frame.url = 'https://www.bilibili.com';
    assert.equal((await handler(f.event)).error, 'IPC_SOURCE_INVALID');
    f.frame.url = 'http://127.0.0.1:3001/admin';
    assert.equal((await handler(f.event)).error, 'IPC_SOURCE_INVALID');
    f.frame.url = 'http://127.0.0.1:3000/admin';
  }
  assert.deepEqual(f.calls, []);
  f.dispose();
  f.dispose();
  assert.equal(f.handlers.size, 0);
});

test('IPC serializes only public state and hides raw errors and cookie data', async () => {
  const f = fixture({ warning: 'secret warning', snapshot: { secret: true } });
  const state = await f.handlers.get('dynamic-lottery-auth:get-state')(f.event);
  assert.deepEqual(state, {
    ok: true,
    state: { loggedIn: true, uid: '9007199254740993123', warning: '' },
  });
  f.auth.login = async () => {
    throw new Error('Cookie=secret&token=secret');
  };
  assert.deepEqual(await f.handlers.get('dynamic-lottery-auth:login')(f.event), {
    ok: false,
    error: 'LOTTERY_AUTH_FAILED',
  });
  f.auth.logout = async () => {
    throw new Error('LOTTERY_IDENTITY_UNAVAILABLE');
  };
  assert.equal((await f.handlers.get('dynamic-lottery-auth:logout')(f.event)).error, 'LOTTERY_IDENTITY_UNAVAILABLE');
});

test('preload exposes separate parameterless state/login/logout methods, never a context or cookie getter', async () => {
  const exposed = new Map();
  const invocations = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/electron/preload.js'), 'utf8'), {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (name, value) => exposed.set(name, value),
      },
      ipcRenderer: {
        invoke: (channel, ...args) => {
          invocations.push([channel, args]);
        },
      },
    }),
  });
  const bridge = exposed.get('dynamicLotteryAuth');
  assert.deepEqual(Object.keys(bridge), ['getState', 'login', 'logout']);
  for (const method of Object.values(bridge)) await method({ cookie: 'must-not-be-forwarded' });
  assert.deepEqual(invocations, [
    ['dynamic-lottery-auth:get-state', []],
    ['dynamic-lottery-auth:login', []],
    ['dynamic-lottery-auth:logout', []],
  ]);
  assert.ok(exposed.get('bilibiliAuth'));
});
