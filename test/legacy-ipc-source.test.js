'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerBilibiliIpc } = require('../src/electron/ipc/bilibili-ipc');
const { registerMusicIpc } = require('../src/electron/ipc/music-ipc');
const { registerUpdateIpc } = require('../src/electron/ipc/update-ipc');

const BASE_URL = 'http://127.0.0.1:31001';

function fixture(register, channel, options = {}) {
  const handlers = new Map();
  let calls = 0;
  const mainFrame = { url: `${BASE_URL}/admin` };
  const webContents = { mainFrame, session: {} };
  const window = { webContents, isDestroyed: () => false };
  const run = () => { calls += 1; return { marker: 'authorized-result' }; };
  register({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getMainWindow: () => window, getDesktopBaseUrl: () => BASE_URL,
    getAuthState: run, getProfile: run, login: run, logout: run,
    getMusicAuthState: run, loginMusicAccount: run, logoutMusicAccount: run,
    clearMusicBrowserCache: run, writePlaybackSnapshot: run, acknowledgePlaybackFlush: run,
    checkForUpdates: run, writeLog() {}, ...options,
  });
  return { handlers, window, mainFrame, event: { sender: webContents, senderFrame: mainFrame },
    calls: () => calls, invoke: (event, ...args) => handlers.get(channel)(event, ...args) };
}

for (const [register, channel, allowLicense] of [
  [registerBilibiliIpc, 'bilibili:get-auth-state', false],
  [registerMusicIpc, 'music:get-auth-state', false],
  [registerUpdateIpc, 'desktop:check-for-updates', true],
]) {
  test(`${channel} keeps legal pages and rejects other windows, frames and origins`, async () => {
    const f = fixture(register, channel);
    assert.deepEqual(await f.invoke(f.event, 'qq'), { marker: 'authorized-result' });
    const rejected = [undefined, {}, { ...f.event, sender: { ...f.window.webContents } },
      { ...f.event, senderFrame: { url: f.mainFrame.url } }, { ...f.event, senderFrame: null }];
    for (const event of rejected) assert.deepEqual(await f.invoke(event), { ok: false, error: 'IPC_SOURCE_INVALID' });
    for (const url of ['https://example.com/admin', 'http://127.0.0.1:31002/admin', `${BASE_URL}/clock`, 'file:///admin']) {
      f.mainFrame.url = url;
      assert.deepEqual(await f.invoke(f.event), { ok: false, error: 'IPC_SOURCE_INVALID' });
    }
    assert.equal(f.calls(), 1);
    for (const pathname of ['/', '/settings', '/songs']) {
      f.mainFrame.url = `${BASE_URL}${pathname}`;
      assert.deepEqual(await f.invoke(f.event), { marker: 'authorized-result' });
    }
    f.mainFrame.url = `${BASE_URL}/license`;
    assert.deepEqual(await f.invoke(f.event), allowLicense ? { marker: 'authorized-result' } : { ok: false, error: 'IPC_SOURCE_INVALID' });
    f.mainFrame.url = `${BASE_URL}/admin?desktop=1`;
    assert.deepEqual(await f.invoke(f.event), { marker: 'authorized-result' });
    f.window.isDestroyed = () => true;
    assert.deepEqual(await f.invoke(f.event), { ok: false, error: 'IPC_SOURCE_INVALID' });
  });

  test(`every channel registered alongside ${channel} rejects an unauthorized caller before side effects`, async () => {
    const f = fixture(register, channel);
    for (const [name, handler] of f.handlers) {
      assert.deepEqual(await handler(undefined), { ok: false, error: 'IPC_SOURCE_INVALID' }, name);
    }
    assert.equal(f.calls(), 0);
  });
}

test('authorized playback save and shutdown acknowledgement keep their existing return values', async () => {
  const f = fixture(registerMusicIpc, 'playback:save-state');
  assert.deepEqual(await f.invoke(f.event, { clientId: 'test', payload: {} }), { marker: 'authorized-result' });
  assert.deepEqual(await f.handlers.get('playback:flush-ack')(f.event), { ok: true });
  assert.equal(f.calls(), 2);
});
