'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ENCRYPTED_PREFIX = 'synthetic-encrypted:';

function createSafeStorage(available) {
  return {
    available,
    isEncryptionAvailable() {
      return this.available;
    },
    encryptString: (text) => Buffer.from(`${ENCRYPTED_PREFIX}${Buffer.from(text).toString('hex')}`),
    decryptString(buffer) {
      const text = buffer.toString();
      if (!text.startsWith(ENCRYPTED_PREFIX)) throw new Error('synthetic decrypt failure');
      return Buffer.from(text.slice(ENCRYPTED_PREFIX.length), 'hex').toString();
    },
  };
}

function createPartitions(initialCookies = {}) {
  const partitions = new Map();
  return {
    partitions,
    fromPartition(name) {
      if (!partitions.has(name)) {
        const partition = { cookieList: [...(initialCookies[name] || [])], set: [], cleared: [] };
        partition.cookies = {
          get: async () => partition.cookieList,
          set: async (details) => partition.set.push(details),
        };
        partition.clearStorageData = async (options) => {
          partition.cleared.push(options.storages);
          if (options.storages.includes('cookies')) partition.cookieList = [];
        };
        partitions.set(name, partition);
      }
      return partitions.get(name);
    },
  };
}

function loadAuthManager(cookies, { safeStorage = createSafeStorage(false), session } = {}) {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const modulePath = require.resolve('../../src/electron/music-auth-manager');
  const fakeElectron = {
    safeStorage,
    session: session || {
      fromPartition: () => ({
        cookies: { get: async () => cookies },
      }),
    },
  };

  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') return fakeElectron;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    delete require.cache[modulePath];
    Module._load = originalLoad;
  }
}

function qqCookie(name, value, domain = '.qq.com') {
  return { name, value, domain };
}

test('music platform normalization rejects inherited configuration keys', () => {
  const authManager = loadAuthManager([]);
  for (const platform of ['constructor', '__proto__', 'toString', 'unknown']) {
    assert.throws(() => authManager.normalizeMusicPlatform(platform), /qq 或 netease/);
    assert.equal(authManager.isAllowedMusicLoginUrl(platform, 'https://y.qq.com/'), false);
  }
  assert.equal(authManager.normalizeMusicPlatform(' QQ '), 'qq');
  assert.equal(authManager.normalizeMusicPlatform('NETEASE'), 'netease');
});

test('music login rejects invalid platforms before creating a window or session', async () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const modulePath = require.resolve('../../src/electron/music-login-window');
  const authManager = loadAuthManager([]);
  let createdWindows = 0;
  let loginWindow;
  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'electron')
        return {
          BrowserWindow: class {
            constructor() {
              createdWindows += 1;
              throw new Error('Unexpected login window');
            }
          },
        };
      if (request === './music-auth-manager' && parent.filename === modulePath) return authManager;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[modulePath];
    loginWindow = require(modulePath);
  } finally {
    delete require.cache[modulePath];
    Module._load = originalLoad;
  }
  for (const platform of ['constructor', '__proto__', 'unknown']) {
    await assert.rejects(loginWindow.loginMusicAccount(null, platform, ''), /qq 或 netease/);
  }
  assert.equal(createdWindows, 0);
});

test('QQ auth recognizes every non-empty QQ Music credential', async () => {
  for (const name of ['qqmusic_key', 'qm_keyst']) {
    const authManager = loadAuthManager([qqCookie(name, 'token')]);
    const state = await authManager.getMusicAuthState('qq', 'test-data');
    assert.equal(state.loggedIn, true, name);
  }
});

test('QQ auth does not treat generic QQ session cookies as music login', async () => {
  for (const name of ['p_skey', 'skey']) {
    const authManager = loadAuthManager([qqCookie(name, 'token'), qqCookie('uin', 'o123456')]);
    const state = await authManager.getMusicAuthState('qq', 'test-data');
    assert.equal(state.loggedIn, false, name);
  }
});

test('QQ auth ignores empty auth cookies and unrelated key cookies', async () => {
  const authManager = loadAuthManager([
    qqCookie('qqmusic_key', ''),
    qqCookie('qm_keyst', ''),
    qqCookie('p_skey', ''),
    qqCookie('skey', ''),
    qqCookie('uin', 'o123456'),
  ]);
  const state = await authManager.getMusicAuthState('qq', 'test-data');
  assert.equal(state.loggedIn, false);
  assert.deepEqual(state.keyCookieNames, ['uin', 'qqmusic_key', 'qm_keyst', 'p_skey', 'skey']);
});

test('QQ auth still filters auth cookies outside the allowed domains', async () => {
  const authManager = loadAuthManager([qqCookie('qqmusic_key', 'token', '.evil.example')]);
  const state = await authManager.getMusicAuthState('qq', 'test-data');
  assert.equal(state.loggedIn, false);
  assert.equal(state.cookieCount, 0);
});

function snapshotFixture(t, { available = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-music-auth-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const safeStorage = createSafeStorage(available);
  const session = createPartitions({
    'persist:music-qq': [
      qqCookie('qqmusic_key', 'synthetic-music-secret'),
      qqCookie('qqmusic_key', 'foreign-secret', '.evil.example'),
    ],
  });
  const authManager = loadAuthManager([], { safeStorage, session });
  const snapshotPath = (platform) => path.join(dataDir, 'music-auth', `${platform}.cookies.enc`);
  return { authManager, dataDir, safeStorage, session, snapshotPath };
}

test('music cookie snapshots are never written without safeStorage encryption', async (t) => {
  const { authManager, dataDir, snapshotPath } = snapshotFixture(t, { available: false });
  await assert.rejects(authManager.persistMusicCookieSnapshot('qq', dataDir), /明文/);
  assert.equal(fs.existsSync(snapshotPath('qq')), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'music-auth')), false);
});

test('music cookie snapshots are encrypted, restore only allowed cookies and report their metadata', async (t) => {
  const { authManager, dataDir, safeStorage, session, snapshotPath } = snapshotFixture(t);
  const saved = await authManager.persistMusicCookieSnapshot('qq', dataDir);
  assert.equal(saved.cookieCount, 1);
  const stored = fs.readFileSync(snapshotPath('qq'), 'utf8');
  assert.doesNotMatch(stored, /synthetic-music-secret|foreign-secret|qqmusic_key/);

  const restored = await authManager.restoreMusicCookieSnapshot('qq', dataDir);
  assert.deepEqual(restored, { savedAt: saved.savedAt, cookieCount: 1 });
  const partition = session.partitions.get('persist:music-qq');
  assert.equal(partition.set.length, 1);
  assert.equal(partition.set[0].value, 'synthetic-music-secret');
  assert.equal(partition.set[0].domain, '.qq.com');

  const state = await authManager.getMusicAuthState('qq', dataDir);
  assert.equal(state.encryptedSnapshotExists, true);
  assert.equal(state.lastSavedAt, saved.savedAt);
  assert.equal(JSON.stringify(state).includes('synthetic-music-secret'), false);

  safeStorage.available = false;
  assert.equal(await authManager.restoreMusicCookieSnapshot('qq', dataDir), null);
  assert.equal(partition.set.length, 1, 'restore must not run without decryption support');
});

test('corrupt music cookie snapshots restore nothing but remain visible as existing', async (t) => {
  const { authManager, dataDir, session, snapshotPath } = snapshotFixture(t);
  fs.mkdirSync(path.dirname(snapshotPath('qq')), { recursive: true });
  fs.writeFileSync(snapshotPath('qq'), Buffer.from('not encrypted').toString('base64'));

  assert.equal(await authManager.restoreMusicCookieSnapshot('qq', dataDir), null);
  assert.equal(session.partitions.get('persist:music-qq')?.set.length ?? 0, 0);
  const state = await authManager.getMusicAuthState('qq', dataDir);
  assert.equal(state.encryptedSnapshotExists, true);
  assert.equal(state.lastSavedAt, '');
});

test('music logout clears only its own partition and deletes only its own snapshot', async (t) => {
  const { authManager, dataDir, session, snapshotPath } = snapshotFixture(t);
  await authManager.persistMusicCookieSnapshot('qq', dataDir);
  await authManager.persistMusicCookieSnapshot('netease', dataDir);

  const state = await authManager.logoutMusicAccount('qq', dataDir);
  assert.equal(fs.existsSync(snapshotPath('qq')), false);
  assert.equal(fs.existsSync(snapshotPath('netease')), true);
  assert.deepEqual(session.partitions.get('persist:music-qq').cleared, [['cookies', 'localstorage', 'indexdb', 'websql']]);
  assert.deepEqual(session.partitions.get('persist:music-netease').cleared, []);
  assert.equal(state.loggedIn, false);
  assert.equal(state.encryptedSnapshotExists, false);
});
