'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { openBilibiliLoginWindow } = require('../src/electron/bilibili-login-window');

class FakeCookies extends EventEmitter {}

class FakeBrowserWindow extends EventEmitter {
  static latest = null;
  static loadError = null;

  constructor() {
    super();
    FakeBrowserWindow.latest = this;
    this.destroyed = false;
    this.webContents = new EventEmitter();
    this.webContents.session = {
      cookies: new FakeCookies(),
      setPermissionRequestHandler() {}
    };
    this.webContents.setWindowOpenHandler = () => {};
  }

  loadURL() {
    return FakeBrowserWindow.loadError
      ? Promise.reject(FakeBrowserWindow.loadError)
      : Promise.resolve();
  }

  isDestroyed() {
    return this.destroyed;
  }

  close() {
    this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

function createAuth(overrides = {}) {
  return {
    BILIBILI_LOGIN_CONFIG: {
      name: 'Bilibili',
      partition: 'persist:bilibili',
      loginUrl: 'https://passport.bilibili.com/login'
    },
    isAllowedBilibiliLoginUrl: () => true,
    persistBilibiliCookieSnapshot: async () => ({ saved: true }),
    getBilibiliAuthState: async () => ({ loggedIn: false }),
    ...overrides
  };
}

function open(auth, writeLog = () => {}) {
  return openBilibiliLoginWindow({
    BrowserWindow: FakeBrowserWindow,
    shell: { openExternal: async () => {} },
    auth,
    dataDir: 'test-data',
    writeLog
  });
}

test('login window removes its cookie listener when initial navigation fails', async () => {
  FakeBrowserWindow.loadError = new Error('navigation failed');
  try {
    await assert.rejects(open(createAuth()), /navigation failed/);
    assert.equal(FakeBrowserWindow.latest.webContents.session.cookies.listenerCount('changed'), 0);
    assert.equal(FakeBrowserWindow.latest.isDestroyed(), true);
  } finally {
    FakeBrowserWindow.loadError = null;
  }
});

test('login window resolves with a logged-out state when final auth lookup fails', async () => {
  const logs = [];
  const resultPromise = open(createAuth({
    getBilibiliAuthState: async () => { throw new Error('auth unavailable'); }
  }), (scope, error) => logs.push({ scope, error }));

  await new Promise((resolve) => setImmediate(resolve));
  FakeBrowserWindow.latest.close();
  const result = await resultPromise;

  assert.deepEqual(result.state, { loggedIn: false });
  assert.equal(logs.some((entry) => entry.scope === 'bilibili-auth-state'), true);
  assert.equal(FakeBrowserWindow.latest.webContents.session.cookies.listenerCount('changed'), 0);
});

test('login completion is logged and closed once when several cookie changes arrive together', async () => {
  const logs = [];
  const resultPromise = open(createAuth({
    getBilibiliAuthState: async () => ({ loggedIn: true })
  }), (scope, message) => logs.push({ scope, message }));

  await new Promise((resolve) => setImmediate(resolve));
  const cookies = FakeBrowserWindow.latest.webContents.session.cookies;
  cookies.emit('changed');
  cookies.emit('changed');
  cookies.emit('changed');
  await resultPromise;

  assert.deepEqual(logs, [{
    scope: 'bilibili-login-auto-close',
    message: 'Bilibili 登录成功，自动关闭登录窗口'
  }]);
});
