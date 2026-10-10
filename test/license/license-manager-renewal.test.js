'use strict';

const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const test = require('node:test');
const { LicenseState, parseExpiresIn, resolveTokenExpiresAt } = require('../../src/electron/license/license-manager');
const { RemoteLicenseError } = require('../../src/electron/license/remote-license-client');
const { createHarness } = require('../helpers/license-manager-harness');

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('an already cancelled protected call does not renew or send a request', async (t) => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    verifyExpiresIn: (count) => (count === 1 ? '0s' : '10m'),
  });
  t.after(() => manager.dispose());
  await manager.bootstrap();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(manager.getCloudSongs({ signal: controller.signal }), { name: 'AbortError' });

  assert.equal(calls.verifies, 1);
  assert.equal(calls.cloudSongsTokens, undefined);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

for (const phase of ['expired token', 'protected rejection']) {
  test(`cancelling a caller during ${phase} renewal leaves other callers active`, async (t) => {
    const { manager, remote, calls } = createHarness({
      identity: { deviceId: 'd', publicKeyPem: 'public' },
      verifyExpiresIn: (count) => (phase === 'expired token' && count === 1 ? '0s' : '10m'),
    });
    const renewal = Promise.withResolvers();
    const refreshed = { accessToken: 'token-2', sessionId: 'session-1', expiresIn: '10m' };
    t.after(() => {
      manager.dispose();
      renewal.resolve(refreshed);
    });
    await manager.bootstrap();
    remote.verify = () => {
      calls.verifies += 1;
      return renewal.promise;
    };
    if (phase === 'protected rejection') {
      remote.syncSongs = async (_songs, token) => {
        calls.syncTokens.push(token);
        throw new RemoteLicenseError('DEVICE_SESSION_INVALID', 'invalid', { status: 401 });
      };
    }
    const controller = new AbortController();
    let cancellation;
    const cancelled = manager.syncSongs([], { signal: controller.signal }).catch((error) => {
      cancellation = error;
    });
    await settle();
    assert.equal(calls.verifies, 2);
    const surviving = manager.getCloudSongs();

    controller.abort();
    await settle();
    assert.equal(cancellation?.name, 'AbortError', 'the cancelled caller settles before shared renewal');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal(calls.cloudSongsTokens, undefined);
    renewal.resolve(refreshed);
    await Promise.all([cancelled, surviving]);

    assert.deepEqual(calls.syncTokens, phase === 'expired token' ? [] : ['token']);
    assert.deepEqual(calls.cloudSongsTokens, ['token-2']);
    assert.equal(manager.getState(), LicenseState.AUTHORIZED);
    assert.equal(calls.verifies, 2);
  });
}

for (const outcome of ['success', 'failure']) {
  test(`authorization wait removes its abort listener after renewal ${outcome}`, async (t) => {
    const { manager, remote } = createHarness({
      identity: { deviceId: 'd', publicKeyPem: 'public' },
      verifyExpiresIn: () => '0s',
    });
    const renewal = Promise.withResolvers();
    t.after(() => {
      manager.dispose();
      renewal.resolve({});
    });
    await manager.bootstrap();
    remote.verify = () => renewal.promise;
    const controller = new AbortController();
    const operation = manager.getCloudSongs({ signal: controller.signal });
    const checked = outcome === 'failure' ? assert.rejects(operation, /LICENSE_NOT_AUTHORIZED/u) : operation;
    await settle();
    assert.equal(getEventListeners(controller.signal, 'abort').length, 1);

    if (outcome === 'success') {
      renewal.resolve({ accessToken: 'token-2', sessionId: 'session-1', expiresIn: '10m' });
    } else {
      renewal.reject(new RemoteLicenseError('NETWORK_UNAVAILABLE', 'offline', { retryable: true }));
    }
    await checked;
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
}

test('concurrent protected calls share one token renewal', async () => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    verifyExpiresIn: (count) => (count === 1 ? '0s' : '10m'),
  });
  await manager.bootstrap();

  await Promise.all([manager.syncSongs([]), manager.syncSongs([]), manager.getProfile(), manager.getCloudSongs()]);

  assert.equal(calls.challenges, 2);
  assert.equal(calls.verifies, 2);
  assert.deepEqual(calls.syncTokens, ['token-2', 'token-2']);
  assert.deepEqual(calls.cloudSongsTokens, ['token-2']);
  manager.dispose();
});

for (const scenario of [
  {
    name: 'protected revocation immediately blocks the manager and clears the token',
    createError: () =>
      new RemoteLicenseError('DEVICE_REVOKED', 'revoked', {
        status: 503,
        retryable: true,
      }),
  },
  {
    name: 'missing streamer blocks the manager and clears the token',
    createError: () =>
      new RemoteLicenseError('STREAMER_NOT_FOUND', 'missing', {
        status: 404,
      }),
  },
  {
    name: 'non-JSON authorization rejection remains fail-closed',
    createError: () =>
      new RemoteLicenseError('INVALID_RESPONSE', 'proxy rejection', {
        status: 401,
      }),
  },
  {
    name: 'plain unauthorized protected failures also clear the session',
    createError: () =>
      Object.assign(new Error('accessToken=secret-value'), {
        status: 401,
      }),
  },
  {
    name: 'HTTP authorization status fails closed even when a wrapper marks it retryable',
    createError: () =>
      Object.assign(new Error('temporary proxy error'), {
        status: 403,
        retryable: true,
      }),
  },
]) {
  test(scenario.name, async (t) => {
    const { manager, remote } = createHarness({
      identity: { deviceId: 'd', publicKeyPem: 'public' },
    });
    t.after(() => manager.dispose());
    await manager.bootstrap();
    const failure = scenario.createError();
    remote.profile = async () => {
      throw failure;
    };

    await assert.rejects(manager.getProfile(), (error) => (failure.code ? error.code === failure.code : true));
    assert.equal(manager.getState(), LicenseState.BLOCKED);
    assert.equal(manager.getAccessToken(), '');
  });
}

test('terminal renewal rejection stays blocked even when wrapped as retryable', async () => {
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.syncSongs = async () => {
    throw new RemoteLicenseError('DEVICE_SESSION_INVALID', 'invalid', {
      status: 401,
    });
  };
  remote.verify = async () => {
    calls.verifies += 1;
    throw new RemoteLicenseError('DEVICE_REVOKED', 'revoked', {
      status: 503,
      retryable: true,
    });
  };

  await assert.rejects(manager.syncSongs([]), (error) => error.code === 'DEVICE_REVOKED');

  assert.equal(calls.verifies, 2);
  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('manager requires activation without a local identity', async () => {
  const { manager } = createHarness();
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.NEEDS_ACTIVATION);
  manager.dispose();
});

for (const [name, failure] of [
  [
    'retryable server failure',
    new RemoteLicenseError('HTTP_503', 'unavailable', {
      status: 503,
      retryable: true,
    }),
  ],
  ['plain request timeout without a retryable flag', Object.assign(new Error('timeout'), { code: 'REQUEST_TIMEOUT' })],
]) {
  test(`${name} during bootstrap preserves identity and needs connection`, async () => {
    const identity = { deviceId: 'd', publicKeyPem: 'public' };
    const { manager, state } = createHarness({
      identity,
      challengeError: failure,
    });

    await manager.bootstrap();

    assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
    assert.equal(state.value, identity);
    manager.dispose();
  });
}

test('transient protected failure keeps a still-valid session authorized', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.syncSongs = async () => {
    throw new RemoteLicenseError('HTTP_503', 'unavailable', {
      status: 503,
      retryable: true,
    });
  };

  await assert.rejects(manager.syncSongs([]), (error) => error.code === 'HTTP_503');

  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(manager.getAccessToken(), 'token');
  manager.dispose();
});

test('resume immediately checks heartbeat and maps superseded session to blocked', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.heartbeat = async () => {
    throw new RemoteLicenseError('SESSION_SUPERSEDED');
  };

  await manager.resume();

  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('heartbeat waits for an in-flight renewal and uses the replacement token', async () => {
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    verifyExpiresIn: (count) => (count === 1 ? '0s' : '10m'),
  });
  await manager.bootstrap();
  let releaseVerify;
  remote.verify = async () => {
    calls.verifies += 1;
    await new Promise((resolve) => {
      releaseVerify = resolve;
    });
    return {
      accessToken: 'token-2',
      sessionId: 'session-1',
      expiresIn: '10m',
      deviceId: 'd',
      licenseId: 'l',
    };
  };

  const syncPromise = manager.syncSongs([]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof releaseVerify, 'function');
  const resumePromise = manager.resume();
  releaseVerify();
  await Promise.all([syncPromise, resumePromise]);

  assert.deepEqual(calls.syncTokens, ['token-2']);
  assert.deepEqual(calls.heartbeatTokens, ['token-2']);
  assert.equal(calls.challenges, 2);
  assert.equal(calls.verifies, 2);
  manager.dispose();
});

test('token expiry parsing accepts server TTL units and absolute metadata', () => {
  assert.equal(parseExpiresIn('2d'), 2 * 24 * 60 * 60 * 1000);
  assert.equal(parseExpiresIn('250ms'), 250);
  assert.equal(parseExpiresIn(600), 600 * 1000);
  assert.equal(parseExpiresIn('0s'), 0);
  assert.equal(parseExpiresIn('not-a-duration'), 10 * 60 * 1000);
  assert.equal(parseExpiresIn(Number.MAX_VALUE), 10 * 60 * 1000);

  const now = Date.parse('2026-08-29T00:00:00.000Z');
  assert.equal(resolveTokenExpiresAt({ expiresIn: '2d', expiresInSeconds: 3600 }, now), now + 3600 * 1000);
  assert.equal(
    resolveTokenExpiresAt({ expiresIn: '0s', expiresAt: '2026-08-29T01:00:00.000Z' }, now),
    Date.parse('2026-08-29T01:00:00.000Z'),
  );
  assert.equal(resolveTokenExpiresAt({ expiresIn: '2h', expiresInSeconds: null }, now), now + 2 * 60 * 60 * 1000);
  assert.equal(resolveTokenExpiresAt({ expiresIn: '2h', expiresInSeconds: true }, now), now + 2 * 60 * 60 * 1000);
});

test('manager prefers valid server expiry metadata over a legacy short TTL', async () => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    verifyExpiresIn: () => '0s',
    verifyExpiresInSeconds: () => 600,
  });
  await manager.bootstrap();
  await manager.syncSongs([]);
  assert.equal(calls.verifies, 1);
  manager.dispose();
});
