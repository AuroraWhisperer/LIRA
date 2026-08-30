'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  createLicenseManager,
  LicenseState,
} = require('../src/electron/license/license-manager');
const {
  RemoteLicenseError,
} = require('../src/electron/license/remote-license-client');

/**
 * Protocol E2E: a stateful in-memory fake of the LIRA Server device API.
 * It exercises the real client-side signing/canonical-payload code and the
 * real license-manager state machine; only the network and server storage
 * are faked. Signatures are recorded for presence, not verified.
 */
function createFakeLicenseServer() {
  const devices = new Map(); // deviceId → { deviceId, licenseId, accountName, revoked }
  const sessions = new Map(); // deviceId → { runtimeId, token, tokenInvalid }
  const supersededTokens = new Map(); // old token → deviceId (session replaced by a new runtime)
  const pairingCodes = new Map(); // id → { id, code, codePrefix, status, createdAt, expiresAt, usedAt, usedByDeviceName }
  const calls = {
    activate: 0,
    challenge: 0,
    verify: 0,
    heartbeat: 0,
    profile: 0,
    syncSongs: 0,
    getCloudSongs: 0,
  };
  let cloudSongs = [];
  let networkDown = false;
  let expiresIn = '10m';
  let nextPairingId = 1;
  let nextTokenId = 1;
  let lastVerifyBody = null;

  function ensureNetwork() {
    if (networkDown)
      throw new RemoteLicenseError('NETWORK_UNAVAILABLE', 'offline', {
        retryable: true,
      });
  }

  function findPairingCode(code) {
    for (const record of pairingCodes.values()) {
      if (record.code === code) return record;
    }
    return null;
  }

  function requireSession(token) {
    const supersededDeviceId = supersededTokens.get(token);
    if (supersededDeviceId) {
      const supersededDevice = devices.get(supersededDeviceId);
      if (supersededDevice?.revoked)
        throw new RemoteLicenseError('DEVICE_REVOKED', 'DEVICE_REVOKED', {
          status: 403,
        });
      throw new RemoteLicenseError('SESSION_SUPERSEDED', 'SESSION_SUPERSEDED', {
        status: 401,
      });
    }
    for (const [deviceId, session] of sessions) {
      if (session.token !== token) continue;
      const device = devices.get(deviceId);
      if (device?.revoked)
        throw new RemoteLicenseError('DEVICE_REVOKED', 'DEVICE_REVOKED', {
          status: 403,
        });
      if (session.tokenInvalid)
        throw new RemoteLicenseError(
          'DEVICE_SESSION_INVALID',
          'DEVICE_SESSION_INVALID',
          { status: 401 },
        );
      return { deviceId, session };
    }
    throw new RemoteLicenseError(
      'DEVICE_TOKEN_INVALID',
      'DEVICE_TOKEN_INVALID',
      { status: 401 },
    );
  }

  const remoteClient = {
    activate: async (body) => {
      ensureNetwork();
      calls.activate += 1;
      if (!body?.accountName || !body?.password)
        throw new RemoteLicenseError(
          'ACTIVATION_INPUT_INVALID',
          'ACTIVATION_INPUT_INVALID',
          { status: 400 },
        );
      const pairing = findPairingCode(String(body.code || ''));
      if (body.code !== 'VALID-CODE') {
        if (!pairing)
          throw new RemoteLicenseError(
            'ACTIVATION_CODE_INVALID',
            'ACTIVATION_CODE_INVALID',
            { status: 403 },
          );
        if (pairing.status !== 'active')
          throw new RemoteLicenseError(
            'PAIRING_CODE_ALREADY_CONSUMED',
            'PAIRING_CODE_ALREADY_CONSUMED',
            { status: 409 },
          );
      }
      if (pairing) {
        pairing.status = 'used';
        pairing.usedAt = '2026-08-29T12:00:00.000Z';
        pairing.usedByDeviceName = String(body.deviceName || '');
      }
      const deviceId = `device-${devices.size + 1}`;
      devices.set(deviceId, {
        deviceId,
        licenseId: `license-${devices.size + 1}`,
        accountName: body.accountName,
        revoked: false,
      });
      return {
        deviceId,
        licenseId: `license-${devices.size}`,
        streamerId: 1,
        streamer: {
          accountName: body.accountName,
          subdomain: body.accountName,
        },
      };
    },
    challenge: async (body) => {
      ensureNetwork();
      calls.challenge += 1;
      const device = devices.get(String(body?.deviceId || ''));
      if (!device)
        throw new RemoteLicenseError('DEVICE_NOT_FOUND', 'DEVICE_NOT_FOUND', {
          status: 404,
        });
      if (device.revoked)
        throw new RemoteLicenseError('DEVICE_REVOKED', 'DEVICE_REVOKED', {
          status: 403,
        });
      return {
        challengeId: `challenge-${calls.challenge}`,
        nonce: `nonce-${calls.challenge}`,
      };
    },
    verify: async (body) => {
      ensureNetwork();
      calls.verify += 1;
      lastVerifyBody = body;
      const device = devices.get(String(body?.deviceId || ''));
      if (!device)
        throw new RemoteLicenseError('DEVICE_NOT_FOUND', 'DEVICE_NOT_FOUND', {
          status: 404,
        });
      if (device.revoked)
        throw new RemoteLicenseError('DEVICE_REVOKED', 'DEVICE_REVOKED', {
          status: 403,
        });
      if (!body.signature)
        throw new RemoteLicenseError('SIGNATURE_INVALID', 'SIGNATURE_INVALID', {
          status: 403,
        });
      const existing = sessions.get(device.deviceId);
      if (existing && existing.runtimeId !== body.runtimeId)
        supersededTokens.set(existing.token, device.deviceId);
      const token = `token-${device.deviceId}-${nextTokenId++}`;
      if (existing) {
        existing.runtimeId = body.runtimeId;
        existing.token = token;
        existing.tokenInvalid = false;
      } else {
        sessions.set(device.deviceId, {
          runtimeId: body.runtimeId,
          token,
          superseded: false,
          tokenInvalid: false,
        });
      }
      return {
        accessToken: token,
        expiresIn,
        deviceId: device.deviceId,
        licenseId: device.licenseId,
        streamer: {
          accountName: device.accountName,
          subdomain: device.accountName,
        },
      };
    },
    heartbeat: async (token) => {
      ensureNetwork();
      calls.heartbeat += 1;
      requireSession(token);
      return { ok: true, serverTime: '2026-08-29T12:00:00.000Z' };
    },
    profile: async (token) => {
      ensureNetwork();
      calls.profile += 1;
      const { deviceId } = requireSession(token);
      const device = devices.get(deviceId);
      return {
        streamer: {
          accountName: device.accountName,
          subdomain: device.accountName,
        },
        device: { id: deviceId, name: 'test-device' },
      };
    },
    syncSongs: async (songs, token) => {
      ensureNetwork();
      calls.syncSongs += 1;
      requireSession(token);
      cloudSongs = [...songs];
      return { ok: true, count: songs.length };
    },
    getCloudSongs: async (token) => {
      ensureNetwork();
      calls.getCloudSongs += 1;
      requireSession(token);
      return { songs: [...cloudSongs] };
    },
    getSongPageBackground: async (token) => {
      ensureNetwork();
      requireSession(token);
      return { ok: true, background: null };
    },
    uploadSongPageBackground: async (bytes, contentType, token) => {
      ensureNetwork();
      requireSession(token);
      return { ok: true, background: { url: '/background.png', contentType } };
    },
    deleteSongPageBackground: async (token) => {
      ensureNetwork();
      requireSession(token);
      return { ok: true, background: null };
    },
    createPairingCode: async (token) => {
      ensureNetwork();
      requireSession(token);
      const id = nextPairingId++;
      const code = `PAIR-${String(id).padStart(4, '0')}`;
      pairingCodes.set(id, {
        id,
        code,
        codePrefix: code.slice(0, 4),
        status: 'active',
        createdAt: '2026-08-29T10:00:00.000Z',
        expiresAt: '2026-08-30T10:00:00.000Z',
        usedAt: null,
        usedByDeviceName: '',
      });
      return { ok: true, id, code, expiresAt: '2026-08-30T10:00:00.000Z' };
    },
    listPairingCodes: async (token) => {
      ensureNetwork();
      requireSession(token);
      return {
        items: [...pairingCodes.values()].map(({ code, ...rest }) => rest),
      };
    },
    revokePairingCode: async (id, token) => {
      ensureNetwork();
      requireSession(token);
      const record = pairingCodes.get(Number(id));
      if (!record)
        throw new RemoteLicenseError(
          'PAIRING_CODE_NOT_FOUND',
          'PAIRING_CODE_NOT_FOUND',
          { status: 404 },
        );
      if (record.status !== 'active')
        throw new RemoteLicenseError(
          'PAIRING_CODE_ALREADY_CONSUMED',
          'PAIRING_CODE_ALREADY_CONSUMED',
          { status: 409 },
        );
      record.status = 'revoked';
      return { ok: true };
    },
  };

  return {
    remoteClient,
    calls,
    getLastVerifyBody: () => lastVerifyBody,
    getCloudSongsSnapshot: () => [...cloudSongs],
    setExpiresIn: (value) => {
      expiresIn = value;
    },
    setNetworkDown: (value) => {
      networkDown = Boolean(value);
    },
    revokeDevice: (deviceId) => {
      const device = devices.get(deviceId);
      if (device) device.revoked = true;
    },
    invalidateSessionToken: (deviceId) => {
      const session = sessions.get(deviceId);
      if (session) session.tokenInvalid = true;
    },
  };
}

function createKeyStore() {
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
  return {
    loadPrivateKey: () => keyPair.privateKeyPem,
    loadOrCreate: () => keyPair,
    keyPair,
  };
}

function createStateStore(initial = null) {
  const box = { value: initial };
  return { read: () => box.value, write: (value) => (box.value = value), box };
}

function createClient({ server, runtimeId = 'rt-1', stateStore, keyStore }) {
  const clientStateStore = stateStore || createStateStore();
  const clientKeyStore = keyStore || createKeyStore();
  const manager = createLicenseManager({
    stateStore: clientStateStore,
    keyStore: clientKeyStore,
    fingerprintProvider: {
      collect: async () => ({
        version: 1,
        machineGuidHash: 'a'.repeat(64),
        smbiosUuidHash: 'b'.repeat(64),
      }),
    },
    remoteClient: server.remoteClient,
    buildInfoProvider: () => ({
      appVersion: '4.0.0',
      buildId: 'dev',
      integrityStatus: 'unverified',
    }),
    runtimeId,
  });
  return { manager, stateStore: clientStateStore, keyStore: clientKeyStore };
}

const ACTIVATION = {
  accountName: 'mlbb',
  password: '123456',
  activationCode: 'VALID-CODE',
};

test('first activation runs the full activate → challenge → verify chain', async () => {
  const server = createFakeLicenseServer();
  const { manager } = createClient({ server });

  const result = await manager.activate(ACTIVATION);

  assert.equal(result.ok, true);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.deepEqual(
    [server.calls.activate, server.calls.challenge, server.calls.verify],
    [1, 1, 1],
    'activation itself must not issue a token; challenge/verify must follow',
  );
  assert.ok(
    server.getLastVerifyBody().signature,
    'verify must carry a device signature',
  );
  assert.ok(manager.getAccessToken().startsWith('token-device-1-'));
  manager.dispose();
});

test('restart with a new runtimeId re-verifies and supersedes the previous session', async () => {
  const server = createFakeLicenseServer();
  const first = createClient({ server, runtimeId: 'rt-1' });
  await first.manager.activate(ACTIVATION);
  const firstToken = first.manager.getAccessToken();
  first.manager.dispose();

  // Same persisted identity + device key, new process runtimeId.
  const second = createClient({
    server,
    runtimeId: 'rt-2',
    stateStore: first.stateStore,
    keyStore: first.keyStore,
  });
  await second.manager.bootstrap();

  assert.equal(second.manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(server.getLastVerifyBody().runtimeId, 'rt-2');
  assert.notEqual(second.manager.getAccessToken(), firstToken);
  await assert.rejects(
    () => server.remoteClient.profile(firstToken),
    (error) => error.code === 'SESSION_SUPERSEDED',
  );
  second.manager.dispose();
});

test('proactive renewal stays single-flight across concurrent business calls', async () => {
  const server = createFakeLicenseServer();
  server.setExpiresIn('0s'); // the activation verify issues an already-expired token
  const { manager } = createClient({ server });
  await manager.activate(ACTIVATION);
  server.setExpiresIn('10m');
  assert.equal(server.calls.verify, 1);

  await Promise.all([
    manager.syncSongs([{ name: '歌A' }]),
    manager.getProfile(),
    manager.getCloudSongs(),
  ]);

  assert.equal(
    server.calls.verify,
    2,
    'three concurrent expired calls must share exactly one renewal',
  );
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  manager.dispose();
});

test('mid-session revocation blocks the client and clears the token', async () => {
  const server = createFakeLicenseServer();
  const { manager } = createClient({ server });
  await manager.activate(ACTIVATION);
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);

  server.revokeDevice('device-1');

  await assert.rejects(
    () => manager.syncSongs([{ name: '歌A' }]),
    (error) => error.code === 'DEVICE_REVOKED',
  );
  assert.equal(manager.getState(), LicenseState.BLOCKED);
  assert.equal(manager.getAccessToken(), '');
  manager.dispose();
});

test('a superseding process blocks the previous runtime on its next request', async () => {
  const server = createFakeLicenseServer();
  const first = createClient({ server, runtimeId: 'rt-1' });
  await first.manager.activate(ACTIVATION);

  // A second LIRA process on the same machine/identity supersedes the first session.
  const second = createClient({
    server,
    runtimeId: 'rt-2',
    stateStore: first.stateStore,
    keyStore: first.keyStore,
  });
  await second.manager.bootstrap();
  assert.equal(second.manager.getState(), LicenseState.AUTHORIZED);

  await assert.rejects(
    () => first.manager.syncSongs([{ name: '歌A' }]),
    (error) => error.code === 'SESSION_SUPERSEDED',
  );
  assert.equal(first.manager.getState(), LicenseState.BLOCKED);
  first.manager.dispose();
  second.manager.dispose();
});

test('network outage degrades to needs_connection and recovers with the preserved identity', async () => {
  const server = createFakeLicenseServer();
  const online = createClient({ server, runtimeId: 'rt-1' });
  await online.manager.activate(ACTIVATION);
  online.manager.dispose();

  // Process restarts while the server is unreachable.
  const offline = createClient({
    server,
    runtimeId: 'rt-2',
    stateStore: online.stateStore,
    keyStore: online.keyStore,
  });
  server.setNetworkDown(true);
  await offline.manager.bootstrap();
  assert.equal(offline.manager.getState(), LicenseState.NEEDS_CONNECTION);
  assert.ok(
    offline.stateStore.read(),
    'device identity must survive a network outage',
  );

  server.setNetworkDown(false);
  await offline.manager.resume();
  assert.equal(offline.manager.getState(), LicenseState.AUTHORIZED);
  offline.manager.dispose();
});

test('pairing codes let a second device join and can be revoked', async () => {
  const server = createFakeLicenseServer();
  const first = createClient({ server, runtimeId: 'rt-1' });
  await first.manager.activate(ACTIVATION);

  const created = await first.manager.createPairingCode();
  assert.ok(created.code, 'server must return the one-time pairing code');

  // Second device: fresh identity store and fresh device key, activated with the pairing code.
  const second = createClient({ server, runtimeId: 'rt-b' });
  const joined = await second.manager.activate({
    ...ACTIVATION,
    activationCode: created.code,
  });
  assert.equal(joined.ok, true);
  assert.equal(second.manager.getState(), LicenseState.AUTHORIZED);

  // Both devices share the same cloud playlist space.
  await first.manager.syncSongs([{ name: '共享歌' }]);
  const cloudForSecond = await second.manager.getCloudSongs();
  assert.equal(cloudForSecond.songs.length, 1);
  assert.equal(cloudForSecond.songs[0].name, '共享歌');

  const listed = await first.manager.listPairingCodes();
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].status, 'used');
  assert.ok(
    listed.items[0].usedByDeviceName,
    'the consuming device name must be recorded',
  );

  // A fresh code can be revoked, and a revoked code cannot activate another device.
  const spare = await first.manager.createPairingCode();
  await first.manager.revokePairingCode(spare.id);
  const afterRevoke = await first.manager.listPairingCodes();
  assert.equal(
    afterRevoke.items.find((item) => item.id === spare.id).status,
    'revoked',
  );

  const third = createClient({ server, runtimeId: 'rt-c' });
  const rejected = await third.manager.activate({
    ...ACTIVATION,
    activationCode: spare.code,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'PAIRING_CODE_ALREADY_CONSUMED');

  first.manager.dispose();
  second.manager.dispose();
  third.manager.dispose();
});

test('a concurrent 401 storm performs exactly one reverify', async () => {
  const server = createFakeLicenseServer();
  const { manager } = createClient({ server });
  await manager.activate(ACTIVATION);
  assert.equal(server.calls.verify, 1);

  // The server rotated the session token (e.g. after a restart): the client's copy is stale.
  server.invalidateSessionToken('device-1');

  const results = await Promise.all([
    manager.syncSongs([{ name: '歌A' }]),
    manager.syncSongs([{ name: '歌B' }]),
    manager.getProfile(),
  ]);

  assert.ok(results.every((result) => result && result.ok !== false));
  assert.equal(
    server.calls.verify,
    2,
    'the 401 storm must converge on a single reverify',
  );
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  manager.dispose();
});
