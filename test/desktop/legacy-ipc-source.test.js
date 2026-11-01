'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerBilibiliIpc } = require('../../src/electron/ipc/bilibili-ipc');
const { registerMusicIpc } = require('../../src/electron/ipc/music-ipc');
const { registerDesktopShellIpc } = require('../../src/electron/ipc/desktop-shell-ipc');
const { createMainWindowIpcRegistrar } = require('../../src/electron/ipc/main-window-ipc');

const BASE_URL = 'http://127.0.0.1:31001';

function fixture(register, channel, options = {}) {
  const handlers = new Map();
  let calls = 0;
  const mainFrame = { url: `${BASE_URL}/admin` };
  const webContents = { mainFrame, session: {} };
  const window = { webContents, isDestroyed: () => false };
  const run = () => {
    calls += 1;
    return { marker: 'authorized-result' };
  };
  register({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getMainWindow: () => window,
    getDesktopBaseUrl: () => BASE_URL,
    getAuthState: run,
    getProfile: run,
    login: run,
    logout: run,
    getMusicAuthState: run,
    loginMusicAccount: run,
    logoutMusicAccount: run,
    clearMusicBrowserCache: run,
    writePlaybackSnapshot: run,
    acknowledgePlaybackFlush: run,
    checkForUpdates: run,
    writeLog() {},
    ...options,
  });
  return {
    handlers,
    window,
    mainFrame,
    event: { sender: webContents, senderFrame: mainFrame },
    calls: () => calls,
    invoke: (event, ...args) => handlers.get(channel)(event, ...args),
  };
}

for (const allowLicense of [false, true]) {
  test(`main-window registrar checks frame identity, exact origin and page scope (license=${allowLicense})`, async () => {
    let mainWindow;
    const f = fixture(options => {
      mainWindow = options.getMainWindow();
      return createMainWindowIpcRegistrar({ ...options, getMainWindow: () => mainWindow, allowLicense })('policy:test', options.getAuthState);
    }, 'policy:test');
    assert.deepEqual(await f.invoke(f.event, 'qq'), { marker: 'authorized-result' });
    const rejected = [
      undefined,
      {},
      { ...f.event, sender: { ...f.window.webContents } },
      { ...f.event, senderFrame: { url: f.mainFrame.url } },
      { ...f.event, senderFrame: null },
    ];
    for (const event of rejected) assert.deepEqual(await f.invoke(event), { ok: false, error: 'IPC_SOURCE_INVALID' });
    for (const url of [
      'https://example.com/admin',
      'http://127.0.0.1:31002/admin',
      `${BASE_URL}/clock`,
      'file:///admin',
      'not a URL',
      'http://localhost:31001/admin',
      'http://127.0.0.1.evil.example:31001/admin',
      'http://127.0.0.1:31001@evil.example/admin',
    ]) {
      f.mainFrame.url = url;
      assert.deepEqual(await f.invoke(f.event), { ok: false, error: 'IPC_SOURCE_INVALID' });
    }
    assert.equal(f.calls(), 1);
    for (const pathname of ['/', '/settings', '/songs']) {
      f.mainFrame.url = `${BASE_URL}${pathname}`;
      assert.deepEqual(await f.invoke(f.event), { marker: 'authorized-result' });
    }
    f.mainFrame.url = `${BASE_URL}/license`;
    assert.deepEqual(
      await f.invoke(f.event),
      allowLicense ? { marker: 'authorized-result' } : { ok: false, error: 'IPC_SOURCE_INVALID' },
    );
    f.mainFrame.url = `${BASE_URL}/admin?desktop=1`;
    assert.deepEqual(await f.invoke(f.event), { marker: 'authorized-result' });
    f.window.isDestroyed = () => true;
    assert.deepEqual(await f.invoke(f.event), { ok: false, error: 'IPC_SOURCE_INVALID' });
    mainWindow = null;
    assert.deepEqual(await f.invoke(f.event), { ok: false, error: 'IPC_SOURCE_INVALID' });
  });

}

for (const [register, channel, allowLicense] of [
  [registerBilibiliIpc, 'bilibili:get-auth-state', false],
  [registerMusicIpc, 'music:get-auth-state', false],
  [registerDesktopShellIpc, 'desktop:check-for-updates', true],
]) {
  test(`every channel alongside ${channel} uses the shared source policy before side effects`, async () => {
    const f = fixture(register, channel);
    for (const [name, handler] of f.handlers) {
      assert.deepEqual(await handler(undefined), { ok: false, error: 'IPC_SOURCE_INVALID' }, name);
    }
    assert.equal(f.calls(), 0);
    assert.deepEqual(await f.invoke(f.event, 'qq'), { marker: 'authorized-result' });
    f.mainFrame.url = `${BASE_URL}/license`;
    assert.deepEqual(await f.invoke(f.event, 'qq'),
      allowLicense ? { marker: 'authorized-result' } : { ok: false, error: 'IPC_SOURCE_INVALID' });
  });
}

test('desktop:open-data-dir rejects shell error strings so the renderer can report failure', async () => {
  let result = '文件不存在';
  let directory = 'D:/synthetic-lira-directory';
  const calls = [];
  const f = fixture(registerDesktopShellIpc, 'desktop:open-data-dir', {
    getDataDir: () => directory,
    shell: { openPath: async (value) => { calls.push(value); return result; } },
  });
  await assert.rejects(f.invoke(f.event), /文件不存在/);
  result = '';
  assert.equal(await f.invoke(f.event), '');
  assert.deepEqual(calls, [directory, directory]);
  directory = '';
  await assert.rejects(f.invoke(f.event));
  assert.equal(calls.length, 2);
});

for (const channel of ['desktop:get-resource-integrity-state', 'desktop:check-resource-integrity']) {
  test(`${channel} permits only the main admin frame and rejects all arguments`, () => {
    let calls = 0;
    const state = { revision: 1, status: 'checking' };
    const action = () => {
      calls += 1;
      return state;
    };
    const f = fixture(registerDesktopShellIpc, channel, { resourceIntegrity: { getState: action, check: action } });
    assert.deepEqual(f.invoke(f.event), state);
    for (const arg of ['C:/secret', {}, undefined])
      assert.deepEqual(f.invoke(f.event, arg), { ok: false, error: 'IPC_ARGUMENTS_INVALID' });
    f.mainFrame.url = `${BASE_URL}/license`;
    assert.deepEqual(f.invoke(f.event), { ok: false, error: 'IPC_SOURCE_INVALID' });
    assert.equal(calls, 1);
  });
}
