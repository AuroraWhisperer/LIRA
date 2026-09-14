'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  createDynamicLotteryAuth,
} = require('../../src/electron/dynamic-lottery-auth');

const settle = () => new Promise((resolve) => setImmediate(resolve));
const uid = '9007199254740993123';

function authCookies(owner = uid, secret = 'lottery-test-secret') {
  return Object.entries({
    DedeUserID: owner,
    SESSDATA: secret,
    bili_jct: 'test-csrf',
  }).map(([name, value]) => ({
    name,
    value,
    domain: '.bilibili.com',
    path: '/',
    secure: true,
    httpOnly: true,
  }));
}

function createFixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-lottery-auth-'));
  const sessions = new Map();
  const windows = [];
  const session = {
    fromPartition(partition) {
      if (!sessions.has(partition)) {
        const cookies = new EventEmitter();
        cookies.items = [];
        cookies.get = async () => [...cookies.items];
        cookies.set = async (cookie) => {
          cookies.items.push(cookie);
          cookies.emit('changed');
        };
        cookies.flushStore = async () => {};
        sessions.set(partition, {
          cookies,
          setPermissionRequestHandler() {},
          async clearStorageData() {
            cookies.items = [];
            cookies.emit('changed');
          },
        });
      }
      return sessions.get(partition);
    },
  };
  const encryptionKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
      const encrypted = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const cipher = crypto.createDecipheriv(
        'aes-256-gcm',
        encryptionKey,
        value.subarray(0, 12),
      );
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([
        cipher.update(value.subarray(28)),
        cipher.final(),
      ]).toString('utf8');
    },
  };
  const stateChanges = new EventEmitter();
  const license = { streamerId: 'streamer-a', epoch: 1, state: 'authorized' };
  const licenseManager = {
    getState: () => license.state,
    getCloudSyncIdentity: () => ({ streamerId: license.streamerId }),
    getAuthorizationEpoch: () => license.epoch,
    onStateChanged(listener) {
      stateChanges.on('state', listener);
      return () => stateChanges.off('state', listener);
    },
  };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.focusCount = 0;
      this.webContents = Object.assign(new EventEmitter(), {
        session: session.fromPartition(options.webPreferences.partition),
        setAudioMuted() {},
        setWindowOpenHandler() {},
      });
      windows.push(this);
    }
    loadURL(url) {
      this.url = url;
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    focus() {
      this.focusCount += 1;
    }
    close() {
      this.destroy();
    }
    destroy() {
      if (!this.destroyed) {
        this.destroyed = true;
        this.emit('closed');
      }
    }
  }
  const auth = createDynamicLotteryAuth({
    session,
    safeStorage,
    dataDir,
    licenseManager,
    BrowserWindow,
    shell: { openExternal: async () => {} },
    getMainWindow: () => null,
  });
  t.after(async () => {
    auth.dispose();
    await auth.whenIdle();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  function lotteryCookies() {
    return [...sessions.entries()].find(([name]) =>
      name.startsWith('persist:bilibili-dynamic-lottery-'),
    )?.[1].cookies;
  }
  async function signIn() {
    const result = auth.login();
    await settle();
    const cookies = windows.at(-1).webContents.session.cookies;
    cookies.items = authCookies();
    cookies.emit('changed');
    return result;
  }
  return {
    auth,
    authCookies,
    session,
    sessions,
    safeStorage,
    dataDir,
    windows,
    license,
    licenseManager,
    stateChanges,
    lotteryCookies,
    signIn,
  };
}

module.exports = { createFixture, settle, authCookies, uid };
