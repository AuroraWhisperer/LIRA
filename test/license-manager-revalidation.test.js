'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LicenseState } = require('../src/electron/license/license-manager');
const {
  RemoteLicenseError,
} = require('../src/electron/license/remote-license-client');
const { createHarness } = require('./helpers/license-manager-harness');

test('cloud songs are read through the authorized device token', async () => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();

  const result = await manager.getCloudSongs();

  assert.deepEqual(calls.cloudSongsTokens, ['token']);
  assert.equal(result.songs.length, 1);
  manager.dispose();
});

test('current invalid session performs one shared reverify and retries once', async () => {
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  let syncAttempts = 0;
  remote.syncSongs = async (_songs, token) => {
    calls.syncTokens.push(token);
    syncAttempts += 1;
    if (syncAttempts === 1)
      throw new RemoteLicenseError('DEVICE_SESSION_INVALID', 'invalid', {
        status: 401,
      });
    return { ok: true };
  };

  await manager.syncSongs([]);

  assert.deepEqual(calls.syncTokens, ['token', 'token-2']);
  assert.equal(calls.challenges, 2);
  assert.equal(calls.verifies, 2);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  manager.dispose();
});

test('missing device session performs one reverify and retries once', async () => {
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  let syncAttempts = 0;
  remote.syncSongs = async (_songs, token) => {
    calls.syncTokens.push(token);
    syncAttempts += 1;
    if (syncAttempts === 1)
      throw new RemoteLicenseError('DEVICE_SESSION_NOT_FOUND', 'missing', {
        status: 401,
      });
    return { ok: true };
  };

  await manager.syncSongs([]);

  assert.deepEqual(calls.syncTokens, ['token', 'token-2']);
  assert.equal(calls.verifies, 2);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  manager.dispose();
});

test('device auth epoch change blocks without silently reauthorizing', async () => {
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.syncSongs = async () => {
    throw new RemoteLicenseError('DEVICE_AUTH_EPOCH_CHANGED', 'changed', {
      status: 401,
    });
  };

  await assert.rejects(
    manager.syncSongs([]),
    (error) => error.code === 'DEVICE_AUTH_EPOCH_CHANGED',
  );

  assert.equal(
    calls.verifies,
    1,
    'a terminal auth-epoch change must not issue another session',
  );
  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('successful renewal does not emit a duplicate authorized transition', async () => {
  const { manager } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    verifyExpiresIn: (count) => (count === 1 ? '0s' : '10m'),
  });
  await manager.bootstrap();
  const snapshots = [];
  const unsubscribe = manager.onStateChanged((snapshot) =>
    snapshots.push(snapshot),
  );

  await manager.syncSongs([]);

  assert.deepEqual(snapshots, []);
  unsubscribe();
  manager.dispose();
});

test('dispose prevents an in-flight renewal from restoring the session', async () => {
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    verifyExpiresIn: (count) => (count === 1 ? '0s' : '10m'),
  });
  await manager.bootstrap();
  let releaseVerify;
  let markVerifyStarted;
  const verifyStarted = new Promise((resolve) => {
    markVerifyStarted = resolve;
  });
  remote.verify = async () => {
    calls.verifies += 1;
    markVerifyStarted();
    await new Promise((resolve) => {
      releaseVerify = resolve;
    });
    return {
      accessToken: 'token-after-dispose',
      expiresIn: '10m',
      deviceId: 'd',
      licenseId: 'l',
    };
  };

  const pendingSync = manager.syncSongs([]);
  await verifyStarted;
  manager.dispose();
  releaseVerify();

  await assert.rejects(pendingSync, /LICENSE_NOT_AUTHORIZED/);
  assert.equal(manager.getAccessToken(), '');
});

test('terminal rejection cannot be undone by an in-flight reverify', async () => {
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();

  let releaseProfile;
  let markProfileStarted;
  const profileStarted = new Promise((resolve) => {
    markProfileStarted = resolve;
  });
  remote.profile = async () => {
    markProfileStarted();
    await new Promise((resolve) => {
      releaseProfile = resolve;
    });
    throw new RemoteLicenseError('DEVICE_REVOKED', 'revoked', { status: 403 });
  };

  let releaseChallenge;
  let markChallengeStarted;
  const challengeStarted = new Promise((resolve) => {
    markChallengeStarted = resolve;
  });
  remote.challenge = async () => {
    calls.challenges += 1;
    markChallengeStarted();
    await new Promise((resolve) => {
      releaseChallenge = resolve;
    });
    return { challengeId: `c${calls.challenges}`, nonce: 'n' };
  };
  remote.syncSongs = async (_songs, token) => {
    calls.syncTokens.push(token);
    if (token === 'token')
      throw new RemoteLicenseError('DEVICE_SESSION_INVALID', 'invalid', {
        status: 401,
      });
    return { ok: true };
  };

  const terminalRequest = manager.getProfile();
  await profileStarted;
  const pendingSync = manager.syncSongs([]);
  await challengeStarted;
  releaseProfile();
  await assert.rejects(
    terminalRequest,
    (error) => error.code === 'DEVICE_REVOKED',
  );
  releaseChallenge();
  await assert.rejects(
    pendingSync,
    (error) => error.code === 'DEVICE_SESSION_INVALID',
  );

  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('concurrent 401 storm triggers exactly one shared reverify', async () => {
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  assert.equal(calls.verifies, 1);

  remote.syncSongs = async (_songs, token) => {
    calls.syncTokens.push(token);
    if (token === 'token')
      throw new RemoteLicenseError('DEVICE_SESSION_INVALID', 'invalid', {
        status: 401,
      });
    return { ok: true, count: 0 };
  };

  const results = await Promise.all([
    manager.syncSongs([]),
    manager.syncSongs([]),
    manager.syncSongs([]),
  ]);

  assert.ok(results.every((result) => result?.ok));
  assert.equal(
    calls.verifies,
    2,
    'three concurrent 401s must share a single reverify',
  );
  assert.equal(calls.challenges, 2);
  assert.deepEqual(calls.syncTokens.slice(0, 3), ['token', 'token', 'token']);
  assert.deepEqual(calls.syncTokens.slice(3), [
    'token-2',
    'token-2',
    'token-2',
  ]);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  manager.dispose();
});

test('failed reverify after an invalid session becomes a recoverable connection state', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.syncSongs = async () => {
    throw new RemoteLicenseError('DEVICE_SESSION_INVALID', 'invalid', {
      status: 401,
    });
  };
  remote.challenge = async () => {
    throw new RemoteLicenseError('NETWORK_UNAVAILABLE', 'offline', {
      retryable: true,
    });
  };

  await assert.rejects(
    manager.syncSongs([]),
    (error) => error.code === 'NETWORK_UNAVAILABLE',
  );

  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('activation remains gated when post-activation verification cannot connect', async () => {
  const { manager, remote } = createHarness();
  remote.verify = async () => {
    throw new RemoteLicenseError('NETWORK_UNAVAILABLE', 'offline', {
      retryable: true,
    });
  };

  const result = await manager.activate({
    accountName: 'MLBB',
    password: '123456',
    activationCode: 'ABCD-EFGH',
  });

  assert.equal(result.ok, false);
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('resume retries a connection state with the preserved device identity', async () => {
  const failure = new RemoteLicenseError('NETWORK_UNAVAILABLE', 'offline', {
    retryable: true,
  });
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    challengeError: failure,
  });
  await manager.bootstrap();
  remote.challenge = async () => {
    calls.challenges += 1;
    return { challengeId: `c${calls.challenges}`, nonce: 'n' };
  };

  await manager.resume();

  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(manager.getAccessToken(), 'token');
  manager.dispose();
});

test('transient heartbeat failure keeps an unexpired token authorized', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.heartbeat = async () => {
    throw new RemoteLicenseError('INVALID_RESPONSE', 'proxy', {
      status: 502,
      retryable: true,
    });
  };

  assert.equal(await manager.resume(), false);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(manager.getAccessToken(), 'token');
  manager.dispose();
});

test('challenge race retries once and remains recoverable without deleting identity', async () => {
  const { manager, remote, calls, state } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  remote.verify = async () => {
    calls.verifies += 1;
    throw new RemoteLicenseError('CHALLENGE_ALREADY_USED', 'used', {
      status: 409,
    });
  };

  await manager.bootstrap();

  assert.equal(calls.challenges, 2);
  assert.equal(calls.verifies, 2);
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
  assert.equal(state.value.deviceId, 'd');
  manager.dispose();
});

test('challenge protocol mismatch fails closed without retrying the incompatible request', async () => {
  const { manager, remote, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  remote.verify = async () => {
    calls.verifies += 1;
    throw new RemoteLicenseError('CHALLENGE_PROTOCOL_MISMATCH', 'protocol', {
      status: 409,
    });
  };

  await manager.bootstrap();

  assert.equal(calls.challenges, 1);
  assert.equal(calls.verifies, 1);
  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});
