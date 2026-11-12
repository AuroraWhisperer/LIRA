'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createLotteryAuthStore } = require('../../src/electron/dynamic-lottery-auth-store');
const { createDynamicLotteryAuth } = require('../../src/electron/dynamic-lottery-auth');
const { createLotteryProvider } = require('../../src/bilibili/dynamic-lottery/provider');
const { createFixture, settle, authCookies, uid } = require('../helpers/dynamic-lottery-auth-fixture');

test('dedicated login, provider context, encrypted restore and logout never touch live credentials', async (t) => {
  const f = createFixture(t);
  const live = f.session.fromPartition('persist:bilibili');
  live.cookies.items = authCookies('123', 'live-test-secret');
  const liveBefore = [...live.cookies.items];
  assert.equal((await f.auth.getAuthState()).loggedIn, false);
  assert.equal((await f.signIn()).uid, uid);
  const first = await f.auth.getContext();
  assert.match(first.cookieHeader, /lottery-test-secret/);
  assert.doesNotMatch(first.cookieHeader, /live-test-secret/);
  const snapshots = fs
    .readdirSync(path.join(f.dataDir, 'dynamic-lottery-auth'), {
      recursive: true,
    })
    .filter((name) => name.endsWith('.enc'));
  assert.equal(snapshots.length, 1);
  const encrypted = fs.readFileSync(path.join(f.dataDir, 'dynamic-lottery-auth', snapshots[0]));
  assert.equal(encrypted.includes(Buffer.from('lottery-test-secret')), false);
  const store = createLotteryAuthStore({ ...f, streamerId: 'streamer-a', serverOrigin: f.license.serverOrigin });
  f.lotteryCookies().items = [];
  await store.restore();
  assert.equal((await store.getAuthState()).uid, uid);

  let called = false;
  const provider = createLotteryProvider({
    getContext: f.auth.getContext,
    request: async ({ init, scope }) => {
      called = true;
      assert.equal(scope, f.auth.getIdentity().streamerId);
      assert.match(init.headers.Cookie, /lottery-test-secret/);
      assert.doesNotMatch(init.headers.Cookie, /live-test-secret/);
      return new Response(JSON.stringify({ code: -101 }));
    },
  });
  await assert.rejects(provider.inspectDynamic('https://www.bilibili.com/opus/123'));
  assert.equal(called, true);
  const sessionSignal = f.auth.getIdentity().signal;
  await f.auth.logout();
  assert.equal(sessionSignal.aborted, true);
  assert.equal((await f.auth.getAuthState()).loggedIn, false);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'dynamic-lottery-auth', snapshots[0])), false);
  await assert.rejects(f.auth.getContext(), {
    code: 'LOTTERY_SESSION_UNAVAILABLE',
  });
  await f.signIn();
  assert.ok((await f.auth.getContext()).sessionEpoch > first.sessionEpoch);
  assert.deepEqual(live.cookies.items, liveBefore);
});

test('login is single-flight and logout cancels the window before clearing its snapshot', async (t) => {
  const f = createFixture(t);
  const pending = f.auth.login();
  const rejected = assert.rejects(pending, { code: 'LOTTERY_SESSION_CHANGED' });
  await settle();
  assert.equal(f.auth.login(), pending);
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].focusCount, 1);
  assert.deepEqual(f.windows[0].options.webPreferences, {
    partition: f.windows[0].options.webPreferences.partition,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  });
  await f.auth.logout();
  await rejected;
  assert.equal(f.windows[0].isDestroyed(), true);
  assert.equal(f.lotteryCookies().listenerCount('changed'), 0);
  assert.equal((await f.auth.getAuthState()).loggedIn, false);
});

test('LIRA identity changes cancel old login and select a different isolated partition', async (t) => {
  const f = createFixture(t);
  const pending = f.auth.login();
  const rejected = assert.rejects(pending, { code: 'LOTTERY_SESSION_CHANGED' });
  await settle();
  const previous = f.windows[0];
  f.license.streamerId = 'streamer-b';
  f.license.epoch += 1;
  f.stateChanges.emit('state');
  await rejected;
  assert.equal(previous.isDestroyed(), true);
  await f.auth.getAuthState();
  assert.equal(f.sessions.size, 2);
  f.license.state = 'blocked';
  f.stateChanges.emit('state');
  await assert.rejects(f.auth.getContext(), {
    code: 'LOTTERY_IDENTITY_UNAVAILABLE',
  });
});

test('an identity obtained before account restoration is invalidated on authorization changes and disposal', (t) => {
  const f = createFixture(t);
  const previous = f.auth.getIdentity();
  f.license.generation += 1;
  f.stateChanges.emit('state');
  assert.equal(previous.signal.aborted, true);
  const current = f.auth.getIdentity();
  assert.equal(current.signal.aborted, false);
  f.auth.dispose();
  assert.equal(current.signal.aborted, true);
  assert.equal(f.sessions.size, 0, 'identity cancellation does not need to restore account cookies');
});

test('same server restarts restore login while a different server with the same account ID remains isolated', async t => {
  const f = createFixture(t);
  await f.signIn();
  const originalScope = f.auth.getIdentity().streamerId;
  const originalSession = f.lotteryCookies();
  const originalHeader = (await f.auth.getContext()).cookieHeader;
  f.auth.dispose();
  await f.auth.whenIdle();

  async function restart() {
    const auth = createDynamicLotteryAuth({ ...f, getMainWindow: () => null });
    t.after(async () => { auth.dispose(); await auth.whenIdle(); });
    return auth;
  }
  f.license.serverOrigin = 'https://server-b.example.test';
  const serverB = await restart();
  assert.notEqual(serverB.getIdentity().streamerId, originalScope);
  assert.equal((await serverB.getAuthState()).loggedIn, false);
  await assert.rejects(serverB.getContext(), { code: 'LOTTERY_SESSION_UNAVAILABLE' });
  serverB.dispose();

  originalSession.items = [];
  f.license.serverOrigin = 'https://SERVER-A.EXAMPLE.TEST:443/';
  const serverA = await restart();
  assert.equal(serverA.getIdentity().streamerId, originalScope);
  assert.equal((await serverA.getAuthState()).uid, uid);
  assert.equal((await serverA.getContext()).cookieHeader, originalHeader);
});

test('unscoped legacy login is preserved without reading or claiming it for the current server', async t => {
  const f = createFixture(t);
  const legacyKey = crypto.createHash('sha256').update(f.license.streamerId).digest('hex');
  const directory = path.join(f.dataDir, 'dynamic-lottery-auth', legacyKey);
  fs.mkdirSync(directory, { recursive: true });
  const encrypted = f.safeStorage.encryptString(JSON.stringify({ version: 1, streamerId: f.license.streamerId, cookies: authCookies() }));
  const snapshot = path.join(directory, 'cookies.enc');
  fs.writeFileSync(snapshot, encrypted);
  const legacySession = f.session.fromPartition(`persist:bilibili-dynamic-lottery-${legacyKey}`);
  legacySession.cookies.items = authCookies();

  const state = await f.auth.getAuthState();
  assert.equal(state.loggedIn, false);
  assert.equal(state.warning, 'LOTTERY_AUTH_RELOGIN_REQUIRED');
  await assert.rejects(f.auth.getContext(), { code: 'LOTTERY_SESSION_UNAVAILABLE' });
  await f.auth.logout();
  assert.deepEqual(fs.readFileSync(snapshot), encrypted);
  assert.equal(legacySession.cookies.items.length, 3);
  assert.equal((await f.signIn()).warning, '');
  assert.deepEqual(fs.readFileSync(snapshot), encrypted);
});

test('cookie read completing after identity change cannot return an old context', async (t) => {
  const f = createFixture(t);
  await f.signIn();
  const pendingRead = Promise.withResolvers();
  f.lotteryCookies().get = () => pendingRead.promise;
  const pending = f.auth.getContext();
  await settle();
  f.license.epoch += 1;
  f.license.generation += 1;
  f.stateChanges.emit('state');
  pendingRead.resolve(authCookies());
  await assert.rejects(pending, { code: 'LOTTERY_SESSION_CHANGED' });
});

test('normal token renewal preserves a collecting session and an in-flight cookie read', async (t) => {
  const f = createFixture(t);
  await f.signIn();
  const before = await f.auth.getContext();
  const sessionSignal = f.auth.getIdentity().signal;
  const read = Promise.withResolvers();
  const cookies = f.lotteryCookies();
  const originalGet = cookies.get;
  cookies.get = () => read.promise;
  const pending = f.auth.getContext();
  await settle();
  f.license.epoch += 1;
  f.stateChanges.emit('state');
  cookies.get = originalGet;
  read.resolve(authCookies());
  assert.deepEqual(await pending, before);
  assert.deepEqual(await f.auth.getContext(), before);
  assert.equal(f.auth.getIdentity().signal, sessionSignal);
  assert.equal(sessionSignal.aborted, false);
});

test('a queued logout cannot clear the next LIRA identity after authorization changes', async (t) => {
  const f = createFixture(t);
  await f.signIn();
  const pending = f.auth.logout();
  f.license.streamerId = 'streamer-b';
  f.license.epoch += 1;
  f.stateChanges.emit('state');
  await assert.rejects(pending, { code: 'LOTTERY_SESSION_CHANGED' });
  assert.equal(f.sessions.size, 1);
  assert.equal(f.lotteryCookies().items.length, 3);
});

test('encryption failure rejects login without plaintext fallback or an open window', async (t) => {
  const f = createFixture(t);
  f.safeStorage.isEncryptionAvailable = () => false;
  await assert.rejects(f.auth.login(), {
    code: 'LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE',
  });
  assert.equal(f.windows.length, 0);
  assert.deepEqual(fs.readdirSync(f.dataDir), []);
});

test('logout invalidates a context read that was already waiting for cookies', async (t) => {
  const f = createFixture(t);
  await f.signIn();
  const cookies = f.lotteryCookies();
  const originalGet = cookies.get;
  const read = Promise.withResolvers();
  cookies.get = () => read.promise;
  const pending = f.auth.getContext();
  await settle();
  const logout = f.auth.logout();
  cookies.get = originalGet;
  read.resolve(authCookies());
  await assert.rejects(pending, { code: 'LOTTERY_AUTH_BUSY' });
  await logout;
});

test('corrupt encrypted snapshots report a safe warning and allow explicit recovery', async (t) => {
  const f = createFixture(t);
  const store = createLotteryAuthStore({ ...f, streamerId: 'streamer-a', serverOrigin: f.license.serverOrigin });
  f.session.fromPartition(store.partition).cookies.items = authCookies();
  await store.persist();
  f.session.fromPartition(store.partition).cookies.items = [];
  f.safeStorage.decryptString = () => {
    throw new Error('sensitive test error');
  };
  const state = await f.auth.getAuthState();
  assert.deepEqual(state, {
    loggedIn: false,
    uid: '',
    warning: 'LOTTERY_AUTH_RESTORE_FAILED',
  });
  assert.equal((await f.signIn()).loggedIn, true);
  assert.equal((await f.auth.getAuthState()).warning, '');
});

test('restore excludes other domains, expired cookies and malformed values', async (t) => {
  const f = createFixture(t);
  const store = createLotteryAuthStore({ ...f, streamerId: 'streamer-a', serverOrigin: f.license.serverOrigin });
  f.session.fromPartition(store.partition).cookies.items = [
    ...authCookies(),
    { ...authCookies()[0], name: 'other', domain: '.evil.example' },
    { ...authCookies()[0], name: 'expired', expirationDate: 1 },
    { ...authCookies()[0], name: 'invalid', value: 'bad\r\nvalue' },
  ];
  await store.persist();
  f.session.fromPartition(store.partition).cookies.items = [];
  await store.restore();
  assert.equal((await store.getCookieHeader()).split('; ').length, 3);
});

test('disposal cancels login and drains listeners without accessing another account', async (t) => {
  const f = createFixture(t);
  const pending = f.auth.login();
  const rejected = assert.rejects(pending);
  await settle();
  f.auth.dispose();
  f.auth.dispose();
  await f.auth.whenIdle();
  await rejected;
  assert.equal(f.windows[0].isDestroyed(), true);
  assert.equal(f.lotteryCookies().listenerCount('changed'), 0);
  assert.equal(f.stateChanges.listenerCount('state'), 0);
  await assert.rejects(f.auth.getAuthState(), {
    code: 'LOTTERY_SESSION_DISPOSED',
  });
});
