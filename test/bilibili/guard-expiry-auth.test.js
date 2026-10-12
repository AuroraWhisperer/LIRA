'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createGuardExpiryAuth, publicAccount } = require('../../src/electron/guard-expiry-auth');
const { createLicenseOperations } = require('../../src/electron/license/license-operations');
const { createRemoteCloudSync } = require('../../src/electron/license/remote-cloud-sync');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const empty = { source: 'separate', loggedIn: false, uid: null, displayName: null, revision: 1 };

function fixture(t, openLogin) {
  const events = new EventEmitter();
  const sessions = [];
  const uploads = [];
  const identity = { authorized: true, generation: 1, streamerId: 1 };
  let account = { ...empty };
  const licenseManager = {
    isAuthorized: () => identity.authorized,
    getCloudSyncIdentity: () => ({ streamerId: identity.streamerId }),
    getAuthorizationGeneration: () => identity.generation,
    onStateChanged(fn) { events.on('state', fn); return () => events.off('state', fn); },
    getGuardExpiryAccountInternal: async () => account,
    async updateGuardExpiryAccountInternal(input, options) {
      uploads.push({ input, options });
      account = { ...empty, source: input.source, revision: account.revision + 1,
        ...(input.cookie ? { loggedIn: true, uid: '123', displayName: '主播' } : {}) };
      return account;
    },
    async clearGuardExpiryAccountInternal() { account = { ...empty }; return account; },
  };
  const auth = createGuardExpiryAuth({
    licenseManager, BrowserWindow: function () {}, shell: {}, getMainWindow: () => null,
    loginConfig: { partition: 'persist:main-bot', allowedHosts: ['passport.bilibili.com'] },
    session: { fromPartition(partition) {
      const value = { partition, cleared: false, closed: false,
        cookies: { get: async () => Object.entries({ DedeUserID: '123', SESSDATA: 'test-secret', bili_jct: 'csrf' })
          .map(([name, value]) => ({ name, value })) },
        async clearStorageData() { this.cleared = true; },
        async closeAllConnections() { this.closed = true; },
      };
      sessions.push(value);
      return value;
    } },
    openLogin: openLogin || (async ({ auth: adapter }) => {
      assert.equal(await adapter.persistBilibiliCookieSnapshot(), null);
      return { state: await adapter.getBilibiliAuthState() };
    }),
  });
  t.after(async () => { auth.dispose(); await auth.whenIdle(); assert.equal(events.listenerCount('state'), 0); });
  return { auth, events, sessions, uploads, identity, licenseManager };
}

test('owner login uses a fresh ephemeral session, cloud upload and secret-free return', async (t) => {
  const f = fixture(t);
  assert.equal((await f.auth.login()).uid, '123');
  assert.equal(f.uploads.length, 1);
  assert.match(f.uploads[0].input.cookie, /SESSDATA=test-secret/);
  assert.equal(f.uploads[0].options.signal.aborted, false);
  await f.auth.login();
  assert.notEqual(f.sessions[0].partition, f.sessions[1].partition);
  for (const session of f.sessions) {
    assert.match(session.partition, /^guard-expiry-/);
    assert.equal(session.cleared && session.closed, true);
  }
  assert.deepEqual(publicAccount({ ...empty, cookie: 'private' }), empty);
  assert.throws(() => publicAccount({ ...empty, loggedIn: true }), /INVALID_RESPONSE/);
});

test('cancelled and failed login clears temporary storage and never uploads', async (t) => {
  for (const failure of [false, true]) {
    const f = fixture(t, async () => {
      if (failure) throw new Error('navigation failure');
      return { state: { loggedIn: false } };
    });
    if (failure) await assert.rejects(f.auth.login(), /navigation failure/);
    else assert.equal(await f.auth.login(), null);
    assert.equal(f.uploads.length, 0);
    assert.equal(f.sessions[0].cleared && f.sessions[0].closed, true);
  }
});

test('authorization switch aborts owner login and prevents uploading to the new tenant', async (t) => {
  const f = fixture(t, ({ signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ state: { loggedIn: true } }), { once: true });
  }));
  const pending = f.auth.login();
  await settle();
  f.identity.streamerId = 2;
  f.identity.generation++;
  f.events.emit('state');
  await assert.rejects(pending, /GUARD_EXPIRY_SOURCE_CHANGED/);
  assert.equal(f.uploads.length, 0);
  assert.equal(f.sessions[0].cleared, true);
});

test('source change and logout cancel pending login before mutating the selected account', async (t) => {
  for (const action of ['setSource', 'logout']) {
    const f = fixture(t, ({ signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ state: { loggedIn: true } }), { once: true });
    }));
    const pending = f.auth.login();
    assert.equal(f.auth.login(), pending);
    await settle();
    const result = await f.auth[action]('shared');
    assert.equal(await pending, null);
    assert.equal(result.loggedIn, false);
    assert.equal(f.uploads.some(({ input }) => input.cookie), false);
  }
});

test('invalid source and missing authorization fail before session access', (t) => {
  const f = fixture(t);
  assert.throws(() => f.auth.setSource({ source: 'shared', cookie: 'secret' }), /INVALID_GUARD_EXPIRY_ACCOUNT/);
  f.identity.authorized = false;
  assert.throws(() => f.auth.login(), /LICENSE_NOT_AUTHORIZED/);
  assert.equal(f.sessions.length, 0);
});

test('account requests preserve authorization and cancellation and identify older servers', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const remote = createRemoteCloudSync(async (...args) => { calls.push(args); return empty; });
  const operations = createLicenseOperations({ remote, withAuthorizedToken: async (fn, _retry, _ready, _validate, received) => {
    assert.equal(received, signal);
    return fn('device-token');
  } });
  await operations.getGuardExpiryAccountInternal({ signal });
  await operations.updateGuardExpiryAccountInternal({ source: 'separate' }, { signal });
  await operations.clearGuardExpiryAccountInternal({ signal });
  assert.deepEqual(calls.map(([method]) => method), ['GET', 'PUT', 'DELETE']);
  for (const [, route, , token, options] of calls) {
    assert.equal(route, '/api/device/guard-expiry/account');
    assert.equal(token, 'device-token');
    assert.equal(options.signal, signal);
  }
  remote.getGuardExpiryAccount = async () => { throw Object.assign(new Error(), { status: 404 }); };
  await assert.rejects(operations.getGuardExpiryAccountInternal({ signal }), { code: 'GUARD_EXPIRY_UNSUPPORTED' });
  await operations.getGuardExpiryWarningsInternal({ signal });
  assert.deepEqual(calls.at(-1), ['GET', '/api/device/guard-expiry', undefined, 'device-token', { signal, maxResponseBytes: 8 * 1024 * 1024 }]);
  remote.getGuardExpiryWarnings = async () => { throw Object.assign(new Error(), { status: 405 }); };
  await assert.rejects(operations.getGuardExpiryWarningsInternal({ signal }), { code: 'GUARD_EXPIRY_UNSUPPORTED' });
});
