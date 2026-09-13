'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LicenseState } = require('../src/electron/license/license-manager');
const {
  RemoteLicenseError,
} = require('../src/electron/license/remote-license-client');
const { createHarness } = require('./helpers/license-manager-harness');

test('concurrent protected calls share one token renewal', async () => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    verifyExpiresIn: (count) => (count === 1 ? '0s' : '10m'),
  });
  await manager.bootstrap();

  await Promise.all([manager.syncSongs([]), manager.syncSongs([])]);

  assert.equal(calls.challenges, 2);
  assert.equal(calls.verifies, 2);
  assert.deepEqual(calls.syncTokens, ['token-2', 'token-2']);
  manager.dispose();
});

test('protected revocation immediately blocks the manager and clears the token', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.profile = async () => {
    throw new RemoteLicenseError('DEVICE_REVOKED', 'revoked', {
      status: 503,
      retryable: true,
    });
  };

  await assert.rejects(
    manager.getProfile(),
    (error) => error.code === 'DEVICE_REVOKED',
  );

  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

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

  await assert.rejects(
    manager.syncSongs([]),
    (error) => error.code === 'DEVICE_REVOKED',
  );

  assert.equal(calls.verifies, 2);
  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('missing streamer blocks the manager and clears the token', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.profile = async () => {
    throw new RemoteLicenseError('STREAMER_NOT_FOUND', 'missing', {
      status: 404,
    });
  };

  await assert.rejects(
    manager.getProfile(),
    (error) => error.code === 'STREAMER_NOT_FOUND',
  );

  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('non-JSON authorization rejection remains fail-closed', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.profile = async () => {
    throw new RemoteLicenseError('INVALID_RESPONSE', 'proxy rejection', {
      status: 401,
    });
  };

  await assert.rejects(
    manager.getProfile(),
    (error) => error.code === 'INVALID_RESPONSE',
  );

  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('plain unauthorized protected failures also clear the session', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.profile = async () => {
    throw Object.assign(new Error('accessToken=secret-value'), { status: 401 });
  };

  await assert.rejects(manager.getProfile());

  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('HTTP authorization status fails closed even when a wrapper marks it retryable', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.profile = async () => {
    throw Object.assign(new Error('temporary proxy error'), {
      status: 403,
      retryable: true,
    });
  };

  await assert.rejects(manager.getProfile());

  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('retryable server failure during bootstrap preserves identity and needs connection', async () => {
  const identity = { deviceId: 'd', publicKeyPem: 'public' };
  const failure = new RemoteLicenseError('HTTP_503', 'unavailable', {
    status: 503,
    retryable: true,
  });
  const { manager, state } = createHarness({
    identity,
    challengeError: failure,
  });

  await manager.bootstrap();

  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  assert.equal(state.value, identity);
  manager.dispose();
});

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

  await assert.rejects(
    manager.syncSongs([]),
    (error) => error.code === 'HTTP_503',
  );

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
