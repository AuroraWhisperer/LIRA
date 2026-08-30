'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  createLicenseManager,
  LicenseState,
  mapSongForSync,
  parseExpiresIn,
  resolveTokenExpiresAt,
} = require('../src/electron/license/license-manager');
const {
  RemoteLicenseError,
} = require('../src/electron/license/remote-license-client');

function createHarness({
  identity = null,
  challengeError = null,
  verifyExpiresIn = () => '10m',
  verifyExpiresInSeconds = () => undefined,
  verifyExpiresAt = () => undefined,
} = {}) {
  const state = { value: identity };
  const backgroundCalls = [];
  const calls = {
    challenges: 0,
    verifies: 0,
    heartbeatTokens: [],
    syncTokens: [],
    catalog: [],
  };
  const generated = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const keyPair = {
    privateKeyPem: generated.privateKey,
    publicKeyPem: generated.publicKey,
    keyProtection: 'dpapi',
  };
  const stateStore = {
    read: () => state.value,
    write: (value) => (state.value = value),
  };
  const keyStore = {
    loadPrivateKey: () => (identity ? keyPair.privateKeyPem : null),
    loadOrCreate: () => keyPair,
  };
  const fingerprintProvider = {
    collect: async () => ({
      version: 1,
      machineGuidHash: 'a'.repeat(64),
      smbiosUuidHash: 'b'.repeat(64),
    }),
  };
  const remote = {
    baseUrl: 'https://api.example.test',
    challenge: async () => {
      calls.challenges += 1;
      if (challengeError) throw challengeError;
      return { challengeId: `c${calls.challenges}`, nonce: 'n' };
    },
    verify: async () => {
      calls.verifies += 1;
      const accessToken =
        calls.verifies === 1 ? 'token' : `token-${calls.verifies}`;
      const result = {
        accessToken,
        expiresIn: verifyExpiresIn(calls.verifies),
        deviceId: 'd',
        licenseId: 'l',
        streamer: { accountName: 'mlbb', subdomain: 'mlbb' },
      };
      const expiresInSeconds = verifyExpiresInSeconds(calls.verifies);
      const expiresAt = verifyExpiresAt(calls.verifies);
      if (expiresInSeconds !== undefined)
        result.expiresInSeconds = expiresInSeconds;
      if (expiresAt !== undefined) result.expiresAt = expiresAt;
      return result;
    },
    activate: async () => ({
      deviceId: 'd',
      licenseId: 'l',
      streamerId: 1,
      streamer: { accountName: 'mlbb', subdomain: 'mlbb' },
    }),
    heartbeat: async (token) => {
      calls.heartbeatTokens.push(token);
      return { ok: true };
    },
    profile: async () => ({ streamer: { accountName: 'mlbb' } }),
    syncSongs: async (songs, token) => {
      calls.syncTokens.push(token);
      return { ok: true, count: songs.length };
    },
    getCloudSongs: async (token) => {
      calls.cloudSongsTokens = calls.cloudSongsTokens || [];
      calls.cloudSongsTokens.push(token);
      return { songs: [{ name: '云端歌' }] };
    },
    getGiftCatalog: async (etag, token) => {
      calls.catalog.push({ etag, token });
      return {
        ok: true,
        version: 'catalog-1',
        gifts: [
          {
            id: '100',
            name: '服务器礼物',
            imageUrl: '/gift-media/images/hash.webp',
          },
        ],
        etag: '"catalog-1"',
      };
    },
    getSongPageBackground: async (token) => ({
      ok: true,
      background: { url: '/background.png' },
      token,
    }),
    uploadSongPageBackground: async (bytes, contentType, token) => {
      backgroundCalls.push({ bytes, contentType, token });
      return { ok: true, background: { url: '/background.png' } };
    },
    deleteSongPageBackground: async (token) => ({
      ok: true,
      background: null,
      token,
    }),
  };
  const manager = createLicenseManager({
    stateStore,
    keyStore,
    fingerprintProvider,
    remoteClient: remote,
    buildInfoProvider: () => ({
      appVersion: '3.7.11',
      buildId: 'dev',
      integrityStatus: 'unverified',
    }),
  });
  return { manager, state, backgroundCalls, calls, remote };
}

test('manager requires activation without a local identity', async () => {
  const { manager } = createHarness();
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.NEEDS_ACTIVATION);
  manager.dispose();
});

test('manager maps network timeout to connection state and can recover', async () => {
  const { manager } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
    challengeError: Object.assign(new Error('timeout'), {
      code: 'REQUEST_TIMEOUT',
    }),
  });
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.NEEDS_CONNECTION);
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
  assert.equal(
    resolveTokenExpiresAt({ expiresIn: '2d', expiresInSeconds: 3600 }, now),
    now + 3600 * 1000,
  );
  assert.equal(
    resolveTokenExpiresAt(
      { expiresIn: '0s', expiresAt: '2026-08-29T01:00:00.000Z' },
      now,
    ),
    Date.parse('2026-08-29T01:00:00.000Z'),
  );
  assert.equal(
    resolveTokenExpiresAt({ expiresIn: '2h', expiresInSeconds: null }, now),
    now + 2 * 60 * 60 * 1000,
  );
  assert.equal(
    resolveTokenExpiresAt({ expiresIn: '2h', expiresInSeconds: true }, now),
    now + 2 * 60 * 60 * 1000,
  );
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

test('activation does not become authorized until verify succeeds', async () => {
  const { manager } = createHarness();
  const result = await manager.activate({
    accountName: 'MLBB',
    password: '123456',
    activationCode: 'ABCD-EFGH',
  });
  assert.equal(result.ok, true);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(manager.getAccessToken(), 'token');
  manager.dispose();
});

test('song sync maps local snake_case song fields to the remote contract', () => {
  assert.deepEqual(
    mapSongForSync({
      title: 'Song',
      artist: 'Artist',
      category_name: 'Pop',
      source_platform: 'QQ',
      request_price: '30',
      song_clip: 'clip',
      is_enabled: 0,
      sort_order: 3,
    }),
    {
      name: 'Song',
      artist: 'Artist',
      categoryName: 'Pop',
      tags: '',
      language: '',
      sourcePlatform: 'QQ',
      note: '',
      requestPrice: '30',
      songClip: 'clip',
      isEnabled: false,
      sortOrder: 3,
    },
  );
});

test('song background operations use the authorized device token and preserve binary bytes', async () => {
  const { manager, backgroundCalls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();

  assert.deepEqual(await manager.getSongPageBackground(), {
    ok: true,
    background: {
      url: '/background.png',
      previewUrl: 'https://api.example.test/background.png',
    },
  });
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(await manager.uploadSongPageBackground(bytes, 'cover.JPG'), {
    ok: true,
    background: {
      url: '/background.png',
      previewUrl: 'https://api.example.test/background.png',
    },
  });
  assert.equal(Buffer.isBuffer(backgroundCalls[0].bytes), true);
  assert.deepEqual([...backgroundCalls[0].bytes], [1, 2, 3]);
  assert.equal(backgroundCalls[0].contentType, 'image/jpeg');
  assert.equal(backgroundCalls[0].token, 'token');
  assert.deepEqual(await manager.deleteSongPageBackground(), {
    ok: true,
    background: null,
  });
  manager.dispose();
});

test('gift catalog refresh is authorization-gated but uses the public endpoint without a bearer token', async () => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();

  const result = await manager.getGiftCatalog({ etag: '"old-catalog"' });
  assert.equal(result.version, 'catalog-1');
  assert.equal(result.imageBaseUrl, 'https://api.example.test');
  assert.deepEqual(calls.catalog, [
    { etag: '"old-catalog"', token: undefined },
  ]);
  manager.dispose();
});

test('song background preview rejects credential query parameters', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.getSongPageBackground = async () => ({
    ok: true,
    background: { url: '/background.png?token=secret&v=1' },
  });

  await assert.rejects(
    manager.getSongPageBackground(),
    (error) => error.code === 'BACKGROUND_URL_INVALID',
  );
  manager.dispose();
});

test('protected remote responses cannot echo credentials across the renderer boundary', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.syncSongs = async () => ({
    ok: true,
    count: 0,
    accessToken: 'secret-token',
    nested: {
      refresh_token: 'secret-refresh-token',
      private_key_pem: 'secret-key',
      safe: 'keep',
    },
  });

  assert.deepEqual(await manager.syncSongs([]), {
    ok: true,
    count: 0,
    nested: { safe: 'keep' },
  });
  manager.dispose();
});

test('song background upload validates size and filename before authorization request', async () => {
  const { manager, backgroundCalls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();

  await assert.rejects(
    manager.uploadSongPageBackground(new Uint8Array([1]), 'cover.txt'),
    (error) => error.code === 'BACKGROUND_FORMAT_UNSUPPORTED',
  );
  await assert.rejects(
    manager.uploadSongPageBackground(
      new Uint8Array(5 * 1024 * 1024 + 1),
      'cover.png',
    ),
    (error) => error.code === 'PAYLOAD_TOO_LARGE',
  );
  assert.equal(backgroundCalls.length, 0);
  manager.dispose();
});

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
