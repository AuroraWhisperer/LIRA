'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LicenseState } = require('../src/electron/license/license-manager');
const { RemoteLicenseError } = require('../src/electron/license/remote-license-client');
const { createHarness } = require('./helpers/license-manager-harness');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function createAccountHarness(t) {
  const accounts = {
    alpha: { deviceId: 'device-a', licenseId: 'license-a', streamerId: 1 },
    beta: { deviceId: 'device-b', licenseId: 'license-b', streamerId: 2 },
  };
  const harness = createHarness({
    identity: { ...accounts.alpha, accountName: 'alpha', publicKeyPem: 'public' },
  });
  t.after(() => harness.manager.dispose());
  harness.remote.activate = async ({ accountName }) => ({
    ...accounts[accountName],
    streamer: { accountName, subdomain: accountName },
  });
  harness.remote.verify = async ({ deviceId }) => {
    harness.calls.verifies += 1;
    const accountName = deviceId === 'device-a' ? 'alpha' : 'beta';
    return {
      ...accounts[accountName],
      accessToken: `token-${accountName}`,
      sessionId: `session-${accountName}`,
      expiresIn: '10m',
      streamer: { accountName, subdomain: accountName },
    };
  };
  return harness;
}

async function activateAccount(harness, accountName = 'beta') {
  const result = await harness.manager.activate({
    accountName,
    password: '123456',
    activationCode: 'ABCD-EFGH',
  });
  assert.equal(result.ok, true);
}

function assertCurrentAccount(manager, accountName = 'beta') {
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(manager.getCloudSyncIdentity().accountName, accountName);
  assert.equal(manager.getSnapshot().streamer.accountName, accountName);
  assert.equal(manager.getAccessToken(), `token-${accountName}`);
}

test('late invalid-token writes never retry under the next account', async (t) => {
  const harness = createAccountHarness(t);
  const { manager, remote } = harness;
  await manager.bootstrap();
  const entered = deferred();
  const delayed = deferred();
  const calls = [];
  remote.syncSongs = (songs, token) => {
    calls.push({ songs, token });
    entered.resolve();
    return delayed.promise;
  };
  const pending = manager.syncSongs([{ name: 'Alpha song', artist: 'Synthetic' }]);
  const rejected = assert.rejects(pending, { code: 'DEVICE_TOKEN_INVALID' });
  await entered.promise;
  await activateAccount(harness);
  delayed.reject(
    new RemoteLicenseError('DEVICE_TOKEN_INVALID', 'invalid', {
      status: 401,
    }),
  );
  await rejected;

  assert.deepEqual(
    calls.map(({ token }) => token),
    ['token-alpha'],
  );
  assert.equal(calls[0].songs[0].name, 'Alpha song');
  assertCurrentAccount(manager);
});

for (const method of ['getProfile', 'getCloudSongs', 'getBilibiliCredentialsInternal']) {
  test(`${method} discards a successful reply from the previous account`, async (t) => {
    const harness = createAccountHarness(t);
    const { manager, remote } = harness;
    await manager.bootstrap();
    const entered = deferred();
    const delayed = deferred();
    const remoteMethod = {
      getProfile: 'profile',
      getCloudSongs: 'getCloudSongs',
      getBilibiliCredentialsInternal: 'getBilibiliCredentials',
    }[method];
    remote[remoteMethod] = () => {
      entered.resolve();
      return delayed.promise;
    };
    const pending = manager[method]();
    const rejected = assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
    await entered.promise;
    await activateAccount(harness);
    delayed.resolve({ streamer: { accountName: 'alpha' }, cookie: 'synthetic' });
    await rejected;

    assertCurrentAccount(manager);
  });
}

for (const failure of [
  new RemoteLicenseError('DEVICE_REVOKED', 'revoked', { status: 403 }),
  new RemoteLicenseError('INVALID_RESPONSE', 'unauthorized', { status: 401 }),
  new RemoteLicenseError('NETWORK_UNAVAILABLE', 'offline', { retryable: true }),
]) {
  test(`late ${failure.code} cannot change the next account session`, async (t) => {
    const harness = createAccountHarness(t);
    const { manager, remote } = harness;
    await manager.bootstrap();
    const entered = deferred();
    const delayed = deferred();
    remote.getCloudSongs = () => {
      entered.resolve();
      return delayed.promise;
    };
    const pending = manager.getCloudSongs();
    const rejected = assert.rejects(pending, (error) => error === failure);
    await entered.promise;
    await activateAccount(harness);
    const snapshots = [];
    manager.onStateChanged((snapshot) => snapshots.push(snapshot));
    delayed.reject(failure);
    await rejected;

    assert.deepEqual(snapshots, []);
    assertCurrentAccount(manager);
  });
}

test('account switching before the first remote call cancels the old intent', async (t) => {
  const harness = createAccountHarness(t);
  const { manager, calls } = harness;
  await manager.bootstrap();
  const pending = manager.syncSongs([{ name: 'Alpha song' }]);
  const rejected = assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
  await activateAccount(harness);
  await rejected;

  assert.deepEqual(calls.syncTokens, []);
  assertCurrentAccount(manager);
});

test('returning to the same account and token does not revive old requests', async (t) => {
  const harness = createAccountHarness(t);
  const { manager, remote } = harness;
  await manager.bootstrap();
  const profileEntered = deferred();
  const writeEntered = deferred();
  const profileReply = deferred();
  const writeReply = deferred();
  const tokens = [];
  remote.profile = () => {
    profileEntered.resolve();
    return profileReply.promise;
  };
  remote.syncSongs = (_songs, token) => {
    tokens.push(token);
    writeEntered.resolve();
    return writeReply.promise;
  };
  const profileRejected = assert.rejects(manager.getProfile(), {
    code: 'LICENSE_NOT_AUTHORIZED',
  });
  const writeRejected = assert.rejects(manager.syncSongs([]), {
    code: 'DEVICE_TOKEN_INVALID',
  });
  await Promise.all([profileEntered.promise, writeEntered.promise]);
  await activateAccount(harness);
  await activateAccount(harness, 'alpha');
  profileReply.resolve({ streamer: { accountName: 'stale-alpha' } });
  writeReply.reject(new RemoteLicenseError('DEVICE_TOKEN_INVALID'));
  await Promise.all([profileRejected, writeRejected]);

  assert.deepEqual(tokens, ['token-alpha']);
  assertCurrentAccount(manager, 'alpha');
});

test('a delayed invalid-token write can retry after renewal of the same owner', async (t) => {
  const harness = createAccountHarness(t);
  const { manager, remote, calls } = harness;
  await manager.bootstrap();
  const entered = deferred();
  const delayed = deferred();
  const tokens = [];
  const verify = remote.verify;
  remote.verify = async (input) => ({
    ...(await verify(input)),
    accessToken: 'token-alpha-renewed',
  });
  remote.syncSongs = (_songs, token) => {
    tokens.push(token);
    if (token !== 'token-alpha') return { ok: true };
    entered.resolve();
    return delayed.promise;
  };
  remote.getCloudSongs = async (token) => {
    if (token === 'token-alpha') throw new RemoteLicenseError('DEVICE_TOKEN_INVALID');
    return { songs: [] };
  };
  const pending = manager.syncSongs([]);
  await entered.promise;
  await manager.getCloudSongs();
  delayed.reject(new RemoteLicenseError('DEVICE_TOKEN_INVALID'));
  assert.deepEqual(await pending, { ok: true });

  assert.deepEqual(tokens, ['token-alpha', 'token-alpha-renewed']);
  assert.equal(calls.verifies, 2);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
});

for (const outcome of ['success', 'revoked', 'unavailable']) {
  test(`late renewal ${outcome} cannot affect the next account or its waiting calls`, async (t) => {
    const harness = createAccountHarness(t);
    const { manager, remote } = harness;
    await manager.bootstrap();
    const entered = deferred();
    const delayed = deferred();
    const verify = remote.verify;
    remote.verify = (input) => {
      if (input.deviceId !== 'device-a') return verify(input);
      entered.resolve();
      return delayed.promise;
    };
    const tokens = [];
    remote.syncSongs = async (_songs, token) => {
      tokens.push(token);
      if (token === 'token-alpha') throw new RemoteLicenseError('DEVICE_TOKEN_INVALID');
      return { ok: true };
    };
    const pendingWrite = manager.syncSongs([]);
    const writeRejected = assert.rejects(pendingWrite);
    await entered.promise;
    const pendingRead = manager.getCloudSongs();
    const readRejected = assert.rejects(pendingRead);
    await activateAccount(harness);
    await manager.syncSongs([]);
    if (outcome === 'success') {
      delayed.resolve({ ...(await verify({ deviceId: 'device-a' })), accessToken: 'stale' });
    } else {
      delayed.reject(
        new RemoteLicenseError(outcome === 'revoked' ? 'DEVICE_REVOKED' : 'NETWORK_UNAVAILABLE', 'old renewal failed', {
          retryable: outcome === 'unavailable',
        }),
      );
    }
    await Promise.all([writeRejected, readRejected]);

    assert.deepEqual(tokens, ['token-alpha', 'token-beta']);
    assert.equal(harness.calls.cloudSongsTokens, undefined);
    assertCurrentAccount(manager);
  });
}

for (const endSession of ['dispose', 'block']) {
  test(`${endSession} discards in-flight profile success without restoring data`, async (t) => {
    const harness = createAccountHarness(t);
    const { manager, remote } = harness;
    await manager.bootstrap();
    const entered = deferred();
    const delayed = deferred();
    remote.profile = () => {
      entered.resolve();
      return delayed.promise;
    };
    const rejected = assert.rejects(manager.getProfile(), { code: 'LICENSE_NOT_AUTHORIZED' });
    await entered.promise;
    if (endSession === 'dispose') manager.dispose();
    else {
      remote.getCloudSongs = async () => {
        throw new RemoteLicenseError('DEVICE_REVOKED');
      };
      await assert.rejects(manager.getCloudSongs(), { code: 'DEVICE_REVOKED' });
    }
    const snapshot = manager.getSnapshot();
    delayed.resolve({ streamer: { accountName: 'stale-alpha' } });
    await rejected;

    assert.deepEqual(manager.getSnapshot(), snapshot);
    assert.equal(manager.getAccessToken(), '');
    if (endSession === 'block') assert.equal(manager.getState(), LicenseState.BLOCKED);
  });
}

test('old renewal cleanup cannot detach the next account shared renewal', async (t) => {
  const harness = createAccountHarness(t);
  const { manager, remote, calls } = harness;
  await manager.bootstrap();
  const alphaEntered = deferred();
  const betaEntered = deferred();
  const alphaReply = deferred();
  const betaReply = deferred();
  const verify = remote.verify;
  let betaVerifies = 0;
  remote.verify = (input) => {
    if (input.deviceId === 'device-a') {
      alphaEntered.resolve();
      return alphaReply.promise;
    }
    betaVerifies += 1;
    if (betaVerifies === 1) return verify(input);
    betaEntered.resolve();
    return betaReply.promise;
  };
  remote.syncSongs = async (_songs, token) => {
    calls.syncTokens.push(token);
    if (token !== 'token-beta-renewed') throw new RemoteLicenseError('DEVICE_TOKEN_INVALID');
    return { ok: true };
  };
  const oldWriteRejected = assert.rejects(manager.syncSongs([]), {
    code: 'DEVICE_TOKEN_INVALID',
  });
  await alphaEntered.promise;
  await activateAccount(harness);
  const newWrite = manager.syncSongs([]);
  await betaEntered.promise;
  alphaReply.resolve(await verify({ deviceId: 'device-a' }));
  await oldWriteRejected;
  const pendingRead = manager.getCloudSongs();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.cloudSongsTokens, undefined);
  betaReply.resolve({
    ...(await verify({ deviceId: 'device-b' })),
    accessToken: 'token-beta-renewed',
  });
  await Promise.all([newWrite, pendingRead]);

  assert.deepEqual(calls.syncTokens, ['token-alpha', 'token-beta', 'token-beta-renewed']);
  assert.deepEqual(calls.cloudSongsTokens, ['token-beta-renewed']);
  assert.equal(betaVerifies, 2);
});

test('new account heartbeat is independent of the old heartbeat completion', async (t) => {
  const harness = createAccountHarness(t);
  const { manager, remote } = harness;
  await manager.bootstrap();
  const alphaEntered = deferred();
  const betaEntered = deferred();
  const alphaReply = deferred();
  const betaReply = deferred();
  const tokens = [];
  remote.heartbeat = (token) => {
    tokens.push(token);
    (token === 'token-alpha' ? alphaEntered : betaEntered).resolve();
    return (token === 'token-alpha' ? alphaReply : betaReply).promise;
  };
  const oldResume = manager.resume();
  await alphaEntered.promise;
  await activateAccount(harness);
  const newResume = manager.resume();
  await betaEntered.promise;
  alphaReply.reject(new RemoteLicenseError('DEVICE_REVOKED'));
  assert.equal(await oldResume, false);
  const sharedResume = manager.resume();
  betaReply.resolve({ ok: true });
  assert.deepEqual(await Promise.all([newResume, sharedResume]), [true, true]);

  assert.deepEqual(tokens, ['token-alpha', 'token-beta']);
  assertCurrentAccount(manager);
});
