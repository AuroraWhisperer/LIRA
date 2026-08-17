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
    this.webContents.audioMuteCalls = [];
    this.webContents.setAudioMuted = (muted) => {
      this.webContents.audioMuteCalls.push(muted);
    };
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
      loginUrl: 'https://passport.bilibili.com/login',
      allowedHosts: [
        'bilibili.com', 'www.bilibili.com', 'live.bilibili.com',
        'passport.bilibili.com', 'api.bilibili.com', 'api.live.bilibili.com'
      ]
    },
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

test('login window is muted by default so the live homepage cannot play sound', async () => {
  const resultPromise = open(createAuth());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(FakeBrowserWindow.latest.webContents.audioMuteCalls, [true]);
  FakeBrowserWindow.latest.close();
  await resultPromise;
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

test('login window cleans up listeners on did-fail-load', async () => {
  const logs = [];
  const resultPromise = open(createAuth(), (scope, data) => logs.push({ scope, data }));

  await new Promise((resolve) => setImmediate(resolve));
  const win = FakeBrowserWindow.latest;

  // Simulate navigation failure
  win.webContents.emit('did-fail-load', null, -3, 'ERR_ABORTED');

  // Window should be destroyed and listeners cleaned up
  assert.equal(win.isDestroyed(), true);
  assert.equal(win.webContents.session.cookies.listenerCount('changed'), 0);

  const failureLog = logs.find((log) => log.scope === 'bilibili-login-load-failure');
  assert.ok(failureLog);
  assert.equal(failureLog.data.errorCode, -3);
  assert.equal(failureLog.data.errorDescription, 'ERR_ABORTED');
});

test('URL policy: allows navigation to allowedHosts domains', async () => {
  const { isAllowedLoginNavigation } = require('../src/electron/external-url-policy');
  const config = createAuth().BILIBILI_LOGIN_CONFIG;

  assert.equal(isAllowedLoginNavigation('https://bilibili.com', config.allowedHosts), true);
  assert.equal(isAllowedLoginNavigation('https://passport.bilibili.com', config.allowedHosts), true);
  assert.equal(isAllowedLoginNavigation('https://api.live.bilibili.com', config.allowedHosts), true);
});

test('URL policy: rejects navigation to disallowed domains', async () => {
  const { isAllowedLoginNavigation } = require('../src/electron/external-url-policy');
  const config = createAuth().BILIBILI_LOGIN_CONFIG;

  assert.equal(isAllowedLoginNavigation('https://evil.com', config.allowedHosts), false);
  assert.equal(isAllowedLoginNavigation('http://bilibili.com', config.allowedHosts), false);
  assert.equal(isAllowedLoginNavigation('file:///etc/passwd', config.allowedHosts), false);
});

test('URL policy: external URLs require https protocol', async () => {
  const { isAllowedExternal } = require('../src/electron/external-url-policy');

  assert.equal(isAllowedExternal('https://github.com'), true);
  assert.equal(isAllowedExternal('http://github.com'), false);
  assert.equal(isAllowedExternal('javascript:alert(1)'), false);
  assert.equal(isAllowedExternal('file:///C:/Windows/calc.exe'), false);
});
