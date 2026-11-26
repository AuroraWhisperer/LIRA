'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { openSqliteDatabase } = require('../../src/storage/database');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createSettingsStore } = require('../../src/storage/settings-store');
const { createCloudSyncRuntime } = require('../../src/server/cloud-sync-runtime');
const { createFixture } = require('../helpers/cloud-sync-controller-fixture');

function fixture(t, { trackRevision = true } = {}) {
  const root = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'bilibili-recovery-'));
  let db;
  let settings;
  let active;
  let identity = { accountName: 'first', streamerId: 1 };
  let localLoggedIn = true;
  let sessionRevision = 0;
  let clearLocal = async () => {};
  let deleteCloud = async () => {};
  let login = async () => ({ state: { loggedIn: true } });
  const cloud = new Map();
  const writes = [];
  const localClears = [];
  const imports = [];
  const key = () => JSON.stringify(['https://api.example.test', identity.accountName, identity.streamerId]);
  function state() {
    if (!cloud.has(key())) cloud.set(key(), { loggedIn: true, revision: 1 });
    return cloud.get(key());
  }
  function open() {
    db = openSqliteDatabase(path.join(directory, 'settings.sqlite'));
    db.exec(SONG_SCHEMA);
    settings = createSettingsStore(db);
    const runtime = createCloudSyncRuntime({ getSettingsStore: () => settings });
    active = createFixture({
      licenseManager: {
        getCloudSyncIdentity: () => identity,
        watchCloudStateChangesInternal: undefined,
        getCloudState: async () => ({
          settings: { initialized: true, revision: 1, values: {} },
          songs: { initialized: true, revision: 1 },
          bilibili: { initialized: true, ...state() },
        }),
        getBilibiliCredentialsInternal: async () => ({ ...state(), cookie: 'synthetic-cookie' }),
        async clearBilibiliCredentialsInternal() {
          const account = key();
          writes.push(['delete', account]);
          await deleteCloud();
          const next = { loggedIn: false, revision: cloud.get(account).revision + 1 };
          cloud.set(account, next);
          return next;
        },
        async setBilibiliCredentialsInternal() {
          writes.push(['put', key()]);
          const next = { loggedIn: true, revision: state().revision + 1 };
          cloud.set(key(), next);
          return next;
        },
      },
      runtime: {
        capturePendingCloudBilibiliLogout: runtime.capturePendingCloudBilibiliLogout,
        getPendingCloudBilibiliLogout: runtime.getPendingCloudBilibiliLogout,
        acknowledgePendingCloudBilibiliLogout: runtime.acknowledgePendingCloudBilibiliLogout,
      },
      bilibiliAuth: {
        getSessionRevision: trackRevision ? () => sessionRevision : undefined,
        getAuthState: async () => ({ loggedIn: localLoggedIn }),
        getCookieHeader: async () => 'synthetic-cookie',
        async replaceCookieHeader() { sessionRevision++; imports.push(key()); localLoggedIn = true; },
        async logout({ isCurrent, signal } = {}) {
          if (isCurrent) {
            const queued = sessionRevision;
            await Promise.resolve();
            if (queued !== sessionRevision) return null;
          }
          if (signal?.aborted || (isCurrent && !isCurrent())) return null;
          sessionRevision++;
          localClears.push(key());
          await clearLocal();
          localLoggedIn = false;
          return { loggedIn: false };
        },
        async login(options) {
          sessionRevision++;
          const result = await login(options);
          if (!options.signal.aborted) localLoggedIn = result.state.loggedIn;
          return result;
        },
      },
    });
  }
  open();
  t.after(async () => {
    active.controller.dispose();
    await active.controller.whenIdle();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    get controller() { return active.controller; },
    get db() { return db; },
    get settings() { return settings; },
    get localLoggedIn() { return localLoggedIn; },
    key, cloud, writes, imports, localClears,
    setLocalClear(fn) { clearLocal = fn; },
    changeSession(loggedIn) { sessionRevision++; localLoggedIn = loggedIn; },
    restoreLocalLogin() { localLoggedIn = true; },
    setDelete(fn) { deleteCloud = fn; },
    setLogin(fn) { login = fn; },
    setAccount(accountName, streamerId) { identity = { accountName, streamerId }; active.emitState('authorized'); },
    async restart() {
      active.controller.dispose();
      await active.controller.whenIdle();
      db.close();
      open();
      return active.controller.start();
    },
  };
}

test('one explicit logout clears the local partition and cloud credentials once each', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  assert.deepEqual(await f.controller.logoutBilibili(), { loggedIn: false });
  await f.controller.whenIdle();
  assert.deepEqual(f.localClears, [f.key()]);
  assert.deepEqual(f.writes, [['delete', f.key()]]);
  assert.equal(f.settings.getPendingCloudBilibiliLogout(f.key()), null);
});

test('a flush during an explicit local cleanup waits for success before deleting credentials', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const release = Promise.withResolvers();
  f.setLocalClear(() => release.promise);
  const logout = f.controller.logoutBilibili();
  const flush = f.controller.syncNow();
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.localClears, [f.key()]);
  } finally {
    release.resolve();
    await Promise.all([logout, flush]);
    await f.controller.whenIdle();
  }
  assert.deepEqual(f.localClears, [f.key()]);
  assert.deepEqual(f.writes, [['delete', f.key()]]);
});

test('local cleanup failure keeps the intent until a successful local retry', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.setLocalClear(async () => { throw new Error('synthetic local failure'); });
  await assert.rejects(f.controller.logoutBilibili(), /synthetic local failure/);
  await f.controller.whenIdle();
  assert.equal(f.localLoggedIn, true);
  assert.deepEqual(f.writes, []);
  assert.ok(f.settings.getPendingCloudBilibiliLogout(f.key()));
  const attempts = f.localClears.length;
  f.setLocalClear(async () => {});
  await f.controller.syncNow();
  assert.equal(f.localClears.length, attempts + 1);
  assert.deepEqual(f.writes, [['delete', f.key()]]);
  assert.equal(f.settings.getPendingCloudBilibiliLogout(f.key()), null);
});

test('a new desktop session revision invalidates a successful cleanup for the same pending intent', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.setDelete(async () => { throw new Error('OFFLINE'); });
  await f.controller.logoutBilibili();
  await f.controller.whenIdle();
  const pending = f.settings.getPendingCloudBilibiliLogout(f.key());
  f.changeSession(false);
  await f.controller.syncNow();
  assert.deepEqual(f.localClears, [f.key(), f.key()]);
  assert.deepEqual(f.settings.getPendingCloudBilibiliLogout(f.key()), pending);
  await f.controller.syncNow();
  assert.equal(f.localClears.length, 2, 'the newly completed cleanup also survives a remote retry');
  f.restoreLocalLogin();
  f.setDelete(async () => {});
  await f.controller.syncNow();
  assert.equal(f.localClears.length, 3, 'observed credentials require cleanup even at the same revision');
  assert.equal(f.localLoggedIn, false);
  assert.equal(f.settings.getPendingCloudBilibiliLogout(f.key()), null);
});

test('a missing session revision falls back to a guarded local cleanup and still completes DELETE', async (t) => {
  const f = fixture(t, { trackRevision: false });
  await f.controller.start();
  await f.controller.logoutBilibili();
  await f.controller.whenIdle();
  assert.deepEqual(f.localClears, [f.key(), f.key()]);
  assert.deepEqual(f.writes, [['delete', f.key()]]);
  assert.equal(f.settings.getPendingCloudBilibiliLogout(f.key()), null);
});

test('a later session reservation cannot be credited to the cleanup that was already running', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const release = Promise.withResolvers();
  f.setLocalClear(() => release.promise);
  const logout = f.controller.logoutBilibili();
  f.changeSession(false);
  release.resolve();
  await logout;
  await f.controller.whenIdle();
  assert.deepEqual(f.localClears, [f.key(), f.key()]);
  assert.deepEqual(f.writes, [['delete', f.key()]]);
});

test('a stopped and resumed controller cleans again for the same account and pending mutation', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.setDelete(async () => { throw new Error('OFFLINE'); });
  await f.controller.logoutBilibili();
  await f.controller.whenIdle();
  f.controller.stop();
  assert.ok(f.settings.getPendingCloudBilibiliLogout(f.key()));
  f.setDelete(async () => {});
  await f.controller.start();
  assert.deepEqual(f.localClears, [f.key(), f.key()]);
  assert.equal(f.settings.getPendingCloudBilibiliLogout(f.key()), null);
});

test('a session change during DELETE keeps the intent for another local cleanup', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  f.setDelete(async () => { started.resolve(); await release.promise; });
  await f.controller.logoutBilibili();
  await started.promise;
  const pending = f.settings.getPendingCloudBilibiliLogout(f.key());
  f.changeSession(true);
  release.resolve();
  await f.controller.whenIdle();
  assert.equal(f.localLoggedIn, true);
  assert.deepEqual(f.settings.getPendingCloudBilibiliLogout(f.key()), pending);
  await f.controller.syncNow();
  assert.deepEqual(f.localClears, [f.key(), f.key()]);
  assert.equal(f.localLoggedIn, false);
  assert.equal(f.settings.getPendingCloudBilibiliLogout(f.key()), null);
});

test('failed Bilibili logout survives database reopen and blocks old cloud credentials until DELETE succeeds', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.setDelete(async () => { throw new Error('OFFLINE'); });
  await f.controller.logoutBilibili();
  await f.controller.whenIdle();
  assert.equal(f.localLoggedIn, false);
  assert.equal(f.cloud.get(f.key()).loggedIn, true);
  await f.controller.syncNow();
  assert.deepEqual(f.localClears, [f.key()]);
  assert.equal(f.writes.length, 2, 'retry DELETE without repeating a completed cleanup');
  await f.restart();
  assert.equal(f.localClears.length, 2, 'the reopened process must clear again');
  assert.equal(f.localLoggedIn, false);
  assert.equal(f.imports.length, 1, 'restart must not restore the old cloud login');
  const pending = f.settings.getPendingCloudBilibiliLogout(f.key());
  assert.deepEqual(Object.keys(pending), ['mutationId']);
  assert.ok(!Object.keys(f.settings.getSettings()).some(key => key.startsWith('cloudBilibiliLogoutPending:')));
  f.setDelete(async () => {});
  await f.controller.syncNow();
  assert.equal(f.localClears.length, 2);
  assert.equal(f.cloud.get(f.key()).loggedIn, false);
  assert.equal(f.settings.getPendingCloudBilibiliLogout(f.key()), null);
  await f.restart();
  assert.equal(f.localLoggedIn, false);
});

test('a committed logout is recovered if the process stopped before clearing local credentials', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.settings.capturePendingCloudBilibiliLogout(f.key());
  assert.equal(f.localLoggedIn, true);
  await f.restart();
  assert.equal(f.localLoggedIn, false);
  assert.equal(f.cloud.get(f.key()).loggedIn, false);
});

test('a successful explicit login supersedes its own pending logout', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.setDelete(async () => { throw new Error('OFFLINE'); });
  await f.controller.logoutBilibili();
  await f.controller.whenIdle();
  await f.controller.loginBilibili();
  await f.controller.whenIdle();
  assert.equal(f.localLoggedIn, true);
  assert.equal(f.settings.getPendingCloudBilibiliLogout(f.key()), null);
  assert.deepEqual(f.writes.at(-1), ['put', f.key()]);
});

test('pending logout stays with its owner when switching accounts and returning', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const firstKey = f.key();
  f.setDelete(async () => { throw new Error('OFFLINE'); });
  await f.controller.logoutBilibili();
  await f.controller.whenIdle();
  f.setAccount('second', 2);
  await f.controller.whenIdle();
  assert.equal(f.localLoggedIn, true);
  assert.ok(f.settings.getPendingCloudBilibiliLogout(firstKey));
  assert.ok(f.writes.every(([, account]) => account === firstKey));
  f.setDelete(async () => {});
  f.setAccount('first', 1);
  await f.controller.whenIdle();
  assert.equal(f.localLoggedIn, false);
  assert.equal(f.settings.getPendingCloudBilibiliLogout(firstKey), null);
});

test('an older DELETE acknowledgement cannot clear a newer logout intent', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const requested = Promise.withResolvers();
  const release = Promise.withResolvers();
  f.setDelete(async () => { requested.resolve(); await release.promise; });
  await f.controller.logoutBilibili();
  await requested.promise;
  const newer = f.settings.capturePendingCloudBilibiliLogout(f.key());
  release.resolve();
  await f.controller.whenIdle();
  assert.deepEqual(f.settings.getPendingCloudBilibiliLogout(f.key()), newer);
  await f.controller.syncNow();
  assert.equal(f.settings.getPendingCloudBilibiliLogout(f.key()), null);
  assert.deepEqual(f.localClears, [f.key(), f.key()], 'each distinct mutation requires its own cleanup');
});

test('a login window completing after an owner change cannot upload its Cookie for the new owner', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const completion = Promise.withResolvers();
  let signal;
  f.setLogin((options) => { signal = options.signal; return completion.promise; });
  const loggingIn = f.controller.loginBilibili();
  f.setAccount('second', 2);
  assert.equal(signal.aborted, true);
  completion.resolve({ state: { loggedIn: true } });
  assert.equal((await loggingIn).state.loggedIn, false);
  await f.controller.whenIdle();
  assert.deepEqual(f.writes, []);
});

test('logout intent persistence failure leaves the local login intact', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  f.db.exec(`CREATE TRIGGER fail_logout BEFORE INSERT ON settings
    WHEN NEW.key LIKE 'cloudBilibiliLogoutPending:%' BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END`);
  await assert.rejects(f.controller.logoutBilibili(), /storage unavailable/);
  assert.equal(f.localLoggedIn, true);
  assert.deepEqual(f.writes, []);
});
