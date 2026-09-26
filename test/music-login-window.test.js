'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createFixture({ loadPending = false, getAuthState = async () => ({ loggedIn: false }) } = {}) {
  const timers = new Set();
  const asyncErrors = [];
  let window;
  let finishLoad;
  const load = loadPending ? new Promise((resolve) => (finishLoad = resolve)) : Promise.resolve();
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      window = this;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.session = { cookies: new EventEmitter(), setPermissionRequestHandler() {} };
      this.webContents.setWindowOpenHandler = () => {};
    }
    isDestroyed() {
      return this.destroyed;
    }
    loadURL() {
      return load;
    }
    close() {
      this.destroy();
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      for (const listener of this.rawListeners('closed')) {
        Promise.resolve(listener.call(this)).catch((error) => asyncErrors.push(error));
      }
    }
  }
  const module = { exports: {} };
  const addTimer = (callback) => {
    timers.add(callback);
    return callback;
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/electron/login-window.js'), 'utf8'), {
    module,
    console: { log() {} },
    setInterval: addTimer,
    setTimeout: addTimer,
    clearInterval: (timer) => timers.delete(timer),
    clearTimeout: (timer) => timers.delete(timer),
    require(name) {
      if (name === 'electron') return { BrowserWindow, shell: { openExternal: async () => {} } };
      if (name === './auth-manager') {
        return {
          MUSIC_LOGIN_CONFIG: {
            qq: { name: 'QQ音乐', partition: 'test', loginUrl: 'https://y.qq.com/', allowedHosts: ['y.qq.com'] },
          },
          normalizeMusicPlatform: (value) => value,
          persistMusicCookieSnapshot: async () => ({ cookieCount: 0 }),
          getMusicAuthState: getAuthState,
        };
      }
      if (name === './external-url-policy') return require('../src/electron/external-url-policy');
      return require(name);
    },
  });
  return {
    open: () => module.exports.loginMusicAccount(null, 'qq', 'synthetic-data'),
    get window() {
      return window;
    },
    timers,
    asyncErrors,
    finishLoad: () => finishLoad(),
  };
}

test('music login closed before the first page finishes still settles and releases timers', async () => {
  const fixture = createFixture({ loadPending: true });
  let result;
  const completion = fixture.open().then((value) => (result = value));
  fixture.window.close();
  fixture.finishLoad();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(result, 'closing during initial navigation must settle the IPC operation');
  assert.equal(result.platform, 'qq');
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.window.webContents.session.cookies.listenerCount('changed'), 0);
  await completion;
});

test('music login resolves safely when the final authentication lookup fails', async () => {
  const fixture = createFixture({
    getAuthState: async () => {
      throw new Error('session unavailable');
    },
  });
  let result;
  const completion = fixture.open().then((value) => (result = value));
  await new Promise((resolve) => setImmediate(resolve));
  fixture.window.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.asyncErrors.length, 0, 'closed listeners must not reject without an owner');
  assert.ok(result, 'a failed final lookup must not leave IPC pending');
  assert.equal(result.state.loggedIn, false);
  assert.equal(fixture.timers.size, 0);
  await completion;
});

test('music login remains usable after a subframe fails to load', async () => {
  const fixture = createFixture();
  const completion = fixture.open();
  await new Promise((resolve) => setImmediate(resolve));
  try {
    fixture.window.webContents.emit(
      'did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://invalid.example/', false,
    );
    assert.equal(fixture.window.isDestroyed(), false);
    assert.equal(fixture.window.webContents.session.cookies.listenerCount('changed'), 1);
  } finally {
    fixture.window.close();
    await completion;
  }
});

test('music login coalesces cookie bursts and retries after a failed pending auth check', async () => {
  let reads = 0;
  let rejectCheck;
  const pending = new Promise((_resolve, reject) => { rejectCheck = reject; });
  const fixture = createFixture({
    getAuthState: () => {
      reads += 1;
      return reads === 1 ? pending : Promise.resolve({ loggedIn: true });
    },
  });
  const completion = fixture.open();
  await new Promise(setImmediate);
  const poll = [...fixture.timers][0];
  try {
    for (let change = 0; change < 2000; change += 1) {
      fixture.window.webContents.session.cookies.emit('changed');
    }
    assert.equal(reads, 1, 'one pending cookie read must own all overlapping completion checks');
    rejectCheck(new Error('synthetic temporary session failure'));
    await new Promise(setImmediate);
    poll();
    const result = await completion;
    assert.equal(result.state.loggedIn, true);
    assert.equal(reads, 3, 'retry and final snapshot read must still run');
    assert.equal(fixture.timers.size, 0);
    assert.equal(fixture.window.webContents.session.cookies.listenerCount('changed'), 0);
    assert.deepEqual(fixture.asyncErrors, []);
  } finally {
    rejectCheck(new Error('synthetic cleanup'));
    fixture.window.close();
    await completion;
  }
});
