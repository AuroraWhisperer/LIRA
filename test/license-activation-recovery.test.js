'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDeviceKeyStore } = require('../src/electron/license/device-key-store');
const { createLicenseStateStore } = require('../src/electron/license/license-state-store');
const { createLicenseManager, LicenseState } = require('../src/electron/license/license-manager');
const { RemoteLicenseError } = require('../src/electron/license/remote-license-client');
const { buildAuthPayload } = require('../src/electron/license/license-protocol');

const input = { accountName: 'fixture', password: 'Fixture9!', activationCode: 'REINSTALL-FIXTURE' };

function fixture(t, { existingIdentity = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-license-recovery-'));
  const managers = [];
  t.after(() => {
    for (const manager of managers) manager.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
    decryptString: (bytes) => {
      if (!String(bytes).startsWith('encrypted:')) throw new Error('synthetic corrupt key');
      return Buffer.from(String(bytes).slice('encrypted:'.length), 'base64').toString('utf8');
    },
  };
  const createStore = () => createDeviceKeyStore({ dataDir, safeStorage });
  const keyStore = createStore();
  const oldKey = keyStore.createNew();
  const originalCipher = fs.readFileSync(keyStore.keyPath);
  fs.writeFileSync(keyStore.keyPath, 'synthetic-corrupt-installed-key');
  const original = fs.readFileSync(keyStore.keyPath);
  const pendingKeyPath = path.join(dataDir, 'license', 'device-key.pending.bin');
  const stateStore = createLicenseStateStore({ dataDir });
  if (existingIdentity)
    stateStore.write({
      deviceId: 'fixture-device',
      licenseId: 'fixture-license',
      streamerId: 1,
      accountName: 'fixture',
      publicKeyPem: oldKey.publicKeyPem,
      keyProtection: 'dpapi',
    });
  const calls = { activate: [], verify: 0 };
  let boundPublicKey = oldKey.publicKeyPem;
  const remote = {
    baseUrl: 'https://api.example.test',
    activate: async (body) => {
      calls.activate.push(body.publicKey);
      if (calls.activate.length > 1)
        throw new RemoteLicenseError('ACTIVATION_CODE_NOT_USABLE', 'used', { status: 409 });
      boundPublicKey = body.publicKey;
      throw new RemoteLicenseError('NETWORK_UNAVAILABLE', 'response lost after binding', { retryable: true });
    },
    challenge: async ({ deviceId }) => {
      assert.equal(deviceId, 'fixture-device');
      return { challengeId: 'fixture-challenge', nonce: 'fixture-nonce' };
    },
    verify: async (body) => {
      calls.verify += 1;
      const canonical = buildAuthPayload({ ...body, virtualization: body.environment.virtualization });
      if (!crypto.verify('sha256', Buffer.from(canonical), boundPublicKey, Buffer.from(body.signature, 'base64')))
        throw new RemoteLicenseError('SIGNATURE_INVALID', 'wrong key', { status: 401 });
      return {
        deviceId: 'fixture-device',
        licenseId: 'fixture-license',
        sessionId: 'fixture-session',
        accessToken: 'fixture-token',
        expiresIn: '10m',
        streamer: { accountName: 'fixture', subdomain: 'fixture' },
      };
    },
  };
  function createManager(extra = {}) {
    const manager = createLicenseManager({
      keyStore: createStore(),
      stateStore,
      remoteClient: remote,
      fingerprintProvider: {
        collect: async () => ({ version: 1, machineGuidHash: 'a'.repeat(64), smbiosUuidHash: 'b'.repeat(64) }),
      },
      buildInfoProvider: () => ({ appVersion: '4.2.3', buildId: 'fixture', integrityStatus: 'unverified' }),
      ...extra,
    });
    managers.push(manager);
    return manager;
  }
  return {
    createManager,
    createStore,
    keyStore,
    stateStore,
    safeStorage,
    remote,
    calls,
    original,
    originalCipher,
    pendingKeyPath,
  };
}

test('lost reinstall responses retain the encrypted candidate and recover after manager reconstruction without reusing the code', async (t) => {
  const f = fixture(t);
  const first = f.createManager();
  assert.equal((await first.activate(input)).error, 'NETWORK_UNAVAILABLE');
  assert.deepEqual(fs.readFileSync(f.keyStore.keyPath), f.original);
  assert.equal(fs.existsSync(f.pendingKeyPath), true);
  assert.doesNotMatch(fs.readFileSync(f.pendingKeyPath).toString(), /BEGIN PRIVATE KEY|Fixture9|REINSTALL-FIXTURE/);
  first.dispose();
  const recovered = f.createManager();
  const observed = [];
  recovered.onStateChanged((snapshot) => {
    if (snapshot.state === LicenseState.AUTHORIZED)
      observed.push({
        publicKey: f.createStore().getPublicKey(),
        identityKey: f.stateStore.read().publicKeyPem,
      });
  });
  await recovered.bootstrap();
  assert.equal(recovered.getState(), LicenseState.AUTHORIZED);
  assert.equal(f.calls.activate.length, 1);
  assert.equal(f.calls.verify, 1);
  assert.deepEqual(observed, [{ publicKey: f.calls.activate[0], identityKey: f.calls.activate[0] }]);
  assert.equal(fs.existsSync(f.pendingKeyPath), false);
  recovered.dispose();
  const restarted = f.createManager();
  await restarted.bootstrap();
  assert.equal(restarted.getState(), LicenseState.AUTHORIZED);
});

test('first activation without a returned device identity preserves and reuses its pending candidate', async (t) => {
  const f = fixture(t, { existingIdentity: false });
  fs.rmSync(f.keyStore.keyPath);
  const first = f.createManager();
  assert.equal((await first.activate(input)).error, 'NETWORK_UNAVAILABLE');
  first.dispose();
  const second = f.createManager();
  await second.bootstrap();
  assert.equal(second.getState(), LicenseState.NEEDS_ACTIVATION);
  assert.equal((await second.activate(input)).error, 'ACTIVATION_CODE_NOT_USABLE');
  assert.equal(f.calls.activate[0], f.calls.activate[1]);
  assert.equal(fs.existsSync(f.pendingKeyPath), true);
  assert.equal(fs.existsSync(f.keyStore.keyPath), false);
});

for (const failure of ['network', 'revoked', 'missing-token']) {
  test(`pending recovery retains both keys and does not fall back after ${failure}`, async (t) => {
    const f = fixture(t);
    await f.createManager().activate(input);
    fs.writeFileSync(f.keyStore.keyPath, f.originalCipher);
    let attempts = 0;
    f.remote.verify = async () => {
      attempts += 1;
      if (failure === 'network') throw new RemoteLicenseError('NETWORK_UNAVAILABLE', 'offline', { retryable: true });
      if (failure === 'revoked') throw new RemoteLicenseError('DEVICE_REVOKED', 'revoked', { status: 403 });
      return { sessionId: 'fixture-session', deviceId: 'fixture-device', licenseId: 'fixture-license' };
    };
    const manager = f.createManager();
    await manager.bootstrap();
    assert.equal(attempts, 1);
    assert.notEqual(manager.getState(), LicenseState.AUTHORIZED);
    assert.equal(manager.getAccessToken(), '');
    assert.deepEqual(fs.readFileSync(f.keyStore.keyPath), f.originalCipher);
    assert.equal(fs.existsSync(f.pendingKeyPath), true);
  });
}

test('only a server signature mismatch permits falling back to the installed key', async (t) => {
  const f = fixture(t);
  const boundVerify = f.remote.verify;
  f.remote.activate = async (body) => {
    f.calls.activate.push(body.publicKey);
    throw new RemoteLicenseError('NETWORK_UNAVAILABLE', 'request never reached server', { retryable: true });
  };
  await f.createManager().activate(input);
  fs.writeFileSync(f.keyStore.keyPath, f.originalCipher);
  f.remote.verify = boundVerify;
  const manager = f.createManager();
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(f.calls.verify, 2);
  assert.deepEqual(fs.readFileSync(f.keyStore.keyPath), f.originalCipher);
  assert.equal(fs.existsSync(f.pendingKeyPath), true);
});

test('disposing during candidate verification preserves both files without publishing authorization', async (t) => {
  const f = fixture(t);
  await f.createManager().activate(input);
  const verify = f.remote.verify;
  let finish;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  f.remote.verify = async (body) => {
    entered();
    await waiting;
    return verify(body);
  };
  const manager = f.createManager();
  const bootstrap = manager.bootstrap();
  await started;
  manager.dispose();
  finish();
  await bootstrap;
  assert.notEqual(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(manager.getAccessToken(), '');
  assert.deepEqual(fs.readFileSync(f.keyStore.keyPath), f.original);
  assert.equal(fs.existsSync(f.pendingKeyPath), true);
});

test('a candidate staging failure prevents the remote binding request', async (t) => {
  const f = fixture(t);
  const renameSync = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === f.pendingKeyPath) throw Object.assign(new Error('synthetic pending write failure'), { code: 'EIO' });
    return renameSync(source, target);
  });
  const result = await f.createManager().activate(input);
  assert.equal(result.error, 'EIO');
  assert.equal(f.calls.activate.length, 0);
  assert.deepEqual(fs.readFileSync(f.keyStore.keyPath), f.original);
  assert.equal(fs.existsSync(f.pendingKeyPath), false);
});

for (const failure of ['promotion', 'identity']) {
  test(`a ${failure} write failure retains the recovery key and never publishes authorization`, async (t) => {
    const f = fixture(t);
    await f.createManager().activate(input);
    const oldIdentity = f.stateStore.read();
    const stateStore = { ...f.stateStore };
    if (failure === 'promotion') {
      const renameSync = fs.renameSync;
      let failOnce = true;
      t.mock.method(fs, 'renameSync', (source, target) => {
        if (target === f.keyStore.keyPath && failOnce) {
          failOnce = false;
          throw Object.assign(new Error('synthetic promotion failure'), { code: 'EIO' });
        }
        return renameSync(source, target);
      });
    } else {
      stateStore.write = () => {
        throw Object.assign(new Error('synthetic identity failure'), { code: 'EIO' });
      };
    }
    const manager = f.createManager({ stateStore });
    const states = [];
    manager.onStateChanged((snapshot) => states.push(snapshot.state));
    await manager.bootstrap();
    assert.equal(states.includes(LicenseState.AUTHORIZED), false);
    assert.equal(manager.getAccessToken(), '');
    assert.equal(fs.existsSync(f.pendingKeyPath), true);
    assert.deepEqual(f.stateStore.read(), oldIdentity);
    if (failure === 'promotion') assert.deepEqual(fs.readFileSync(f.keyStore.keyPath), f.original);
    else assert.equal(f.createStore().getPublicKey(), f.calls.activate[0]);
    const retry = f.createManager();
    await retry.bootstrap();
    assert.equal(retry.getState(), LicenseState.AUTHORIZED);
    assert.equal(fs.existsSync(f.pendingKeyPath), false);
  });
}

test('an unreadable pending key is retained while an independently valid installed key can still authenticate', async (t) => {
  const f = fixture(t);
  f.remote.activate = async (body) => {
    f.calls.activate.push(body.publicKey);
    throw new RemoteLicenseError('NETWORK_UNAVAILABLE', 'request never reached server', { retryable: true });
  };
  await f.createManager().activate(input);
  const pending = fs.readFileSync(f.pendingKeyPath);
  fs.writeFileSync(f.keyStore.keyPath, f.originalCipher);
  const decryptString = f.safeStorage.decryptString;
  f.safeStorage.decryptString = (bytes) => {
    if (bytes.equals(pending)) throw new Error('synthetic pending decrypt failure');
    return decryptString(bytes);
  };
  assert.equal((await f.createManager().activate(input)).error, 'DEVICE_KEY_CORRUPT');
  assert.equal(f.calls.activate.length, 1);
  assert.deepEqual(fs.readFileSync(f.pendingKeyPath), pending);
  const manager = f.createManager();
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.deepEqual(fs.readFileSync(f.keyStore.keyPath), f.originalCipher);
  assert.deepEqual(fs.readFileSync(f.pendingKeyPath), pending);
});

test('a retried challenge still commits the verified candidate before authorizing', async (t) => {
  const f = fixture(t);
  await f.createManager().activate(input);
  const verify = f.remote.verify;
  let attempts = 0;
  f.remote.verify = (body) => {
    if (++attempts === 1) throw new RemoteLicenseError('CHALLENGE_EXPIRED', 'expired');
    return verify(body);
  };
  const manager = f.createManager();
  await manager.bootstrap();
  assert.equal(manager.getState(), LicenseState.AUTHORIZED);
  assert.equal(attempts, 2);
  assert.equal(f.createStore().getPublicKey(), f.calls.activate[0]);
  assert.equal(f.stateStore.read().publicKeyPem, f.calls.activate[0]);
  assert.equal(fs.existsSync(f.pendingKeyPath), false);
});
