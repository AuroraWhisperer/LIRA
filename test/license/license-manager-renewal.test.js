'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LicenseState, parseExpiresIn, resolveTokenExpiresAt } = require('../../src/electron/license/license-manager');
const { RemoteLicenseError } = require('../../src/electron/license/remote-license-client');
const { createHarness } = require('../helpers/license-manager-harness');

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
