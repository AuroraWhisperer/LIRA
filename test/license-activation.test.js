'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDeviceKeyStore } = require('../src/electron/license/device-key-store');
const { requestDeviceActivation } = require('../src/electron/license/license-activation');

function createFixture(t, existing) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-activation-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
    decryptString: (bytes) => {
      if (!String(bytes).startsWith('encrypted:')) throw new Error('synthetic corrupt key');
      return Buffer.from(String(bytes).slice('encrypted:'.length), 'base64').toString('utf8');
    },
  };
  const keyStore = createDeviceKeyStore({ dataDir, safeStorage });
  if (existing === 'valid') keyStore.createNew();
  if (existing === 'corrupt') {
    fs.mkdirSync(path.dirname(keyStore.keyPath), { recursive: true });
    fs.writeFileSync(keyStore.keyPath, 'synthetic-unreadable-device-key');
  }
  const readStored = () => (fs.existsSync(keyStore.keyPath) ? fs.readFileSync(keyStore.keyPath) : null);
  const original = readStored();
  const options = {
    keyStore,
    validated: { accountName: 'fixture', password: 'fixture-password', activationCode: 'FIXTURE-CODE' },
    fingerprintProvider: {
      collect: async () => ({ version: 1, machineGuidHash: 'a'.repeat(64), smbiosUuidHash: 'b'.repeat(64) }),
    },
    buildInfoProvider: () => ({ appVersion: '4.2.3', buildId: 'fixture', integrityStatus: 'unverified' }),
    deviceName: 'fixture-device',
    isActive: () => true,
    remote: {
      activate: async () => {
        assert.deepEqual(readStored(), original, 'binding must not replace the stored key before remote success');
        return { deviceId: 'fixture-device', licenseId: 'fixture-license', streamerId: 1 };
      },
    },
  };
  return { options, keyStore, safeStorage, readStored, original };
}

for (const existing of ['missing', 'corrupt', 'valid']) {
  test(`activation preserves a ${existing} key when fingerprint collection fails`, async (t) => {
    const { options, readStored, original } = createFixture(t, existing);
    options.fingerprintProvider.collect = async () => ({});
    options.remote.activate = () => assert.fail('insufficient fingerprint must not reach the server');
    await assert.rejects(requestDeviceActivation(options), { code: 'FINGERPRINT_UNAVAILABLE' });
    assert.deepEqual(readStored(), original);
  });

  test(`activation preserves a ${existing} key when remote binding fails`, async (t) => {
    const { options, readStored, original } = createFixture(t, existing);
    options.remote.activate = async () => {
      throw new Error('synthetic remote rejection');
    };
    await assert.rejects(requestDeviceActivation(options), /synthetic remote rejection/);
    assert.deepEqual(readStored(), original);
  });

  test(`activation preserves a ${existing} key when the remote reply has no device identity`, async (t) => {
    const { options, readStored, original } = createFixture(t, existing);
    options.remote.activate = async () => ({});
    await assert.rejects(requestDeviceActivation(options), { code: 'INVALID_RESPONSE' });
    assert.deepEqual(readStored(), original);
  });

  test(`activation preserves a ${existing} key when disposed during the remote request`, async (t) => {
    const { options, readStored, original } = createFixture(t, existing);
    const activate = options.remote.activate;
    options.remote.activate = async () => {
      const result = await activate();
      options.isActive = () => false;
      return result;
    };
    assert.equal(await requestDeviceActivation(options), null);
    assert.deepEqual(readStored(), original);
  });

  test(`activation commits a ${existing} key only after successful remote binding`, async (t) => {
    const { options, keyStore, readStored, original } = createFixture(t, existing);
    const activation = await requestDeviceActivation(options);
    assert.equal(keyStore.loadPrivateKey(), activation.keyPair.privateKeyPem);
    assert.equal(keyStore.getPublicKey(), activation.identity.publicKeyPem);
    assert.doesNotMatch(readStored().toString(), /BEGIN PRIVATE KEY/);
    if (existing === 'valid') assert.deepEqual(readStored(), original);
    else assert.notDeepEqual(readStored(), original);
    activation.complete();
    assert.deepEqual(fs.readdirSync(path.dirname(keyStore.keyPath)), ['device-key.bin']);
  });
}

for (const operation of ['write', 'rename']) {
  test(`failed key file ${operation} preserves the previous bytes and removes the temporary file`, async (t) => {
    const { options, keyStore, readStored, original } = createFixture(t, 'corrupt');
    if (operation === 'write') {
      const writeFileSync = fs.writeFileSync;
      t.mock.method(fs, 'writeFileSync', (target, bytes, settings) => {
        if (target.startsWith(`${keyStore.keyPath}.`)) {
          writeFileSync(target, bytes.subarray(0, 8), settings);
          throw new Error('synthetic write failure');
        }
        return writeFileSync(target, bytes, settings);
      });
    } else {
      const renameSync = fs.renameSync;
      t.mock.method(fs, 'renameSync', (source, target) => {
        if (target === keyStore.keyPath) throw new Error('synthetic rename failure');
        return renameSync(source, target);
      });
    }
    await assert.rejects(requestDeviceActivation(options), new RegExp(`synthetic ${operation} failure`));
    assert.deepEqual(readStored(), original);
    assert.deepEqual(fs.readdirSync(path.dirname(keyStore.keyPath)), ['device-key.bin', 'device-key.pending.bin']);
  });
}

test('encryption failure is detected before binding and leaves the existing key intact', async (t) => {
  const { options, safeStorage, readStored, original } = createFixture(t, 'corrupt');
  safeStorage.encryptString = () => {
    throw new Error('synthetic encryption failure');
  };
  options.remote.activate = () => assert.fail('unprotected keys must not reach the server');
  await assert.rejects(requestDeviceActivation(options), /synthetic encryption failure/);
  assert.deepEqual(readStored(), original);
});
