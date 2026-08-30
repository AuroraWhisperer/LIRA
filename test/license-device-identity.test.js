'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createDeviceKeyStore,
} = require('../src/electron/license/device-key-store');
const {
  createHardwareFingerprint,
  hashRaw,
} = require('../src/electron/license/hardware-fingerprint');

test('device private key is encrypted at rest and cannot use an unavailable machine store', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-device-key-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) =>
      Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
    decryptString: (bytes) =>
      Buffer.from(String(bytes).slice('encrypted:'.length), 'base64').toString(
        'utf8',
      ),
  };
  const store = createDeviceKeyStore({ dataDir, safeStorage });

  const created = store.createNew();
  const stored = fs.readFileSync(store.keyPath);

  assert.match(created.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.doesNotMatch(stored.toString('utf8'), /BEGIN PRIVATE KEY/);
  assert.equal(store.loadPrivateKey(), created.privateKeyPem);

  const copiedStore = createDeviceKeyStore({
    dataDir,
    safeStorage: {
      isEncryptionAvailable: () => true,
      decryptString: () => {
        throw new Error('different machine');
      },
    },
  });
  assert.throws(
    () => copiedStore.loadPrivateKey(),
    (error) => error.message === 'DEVICE_KEY_CORRUPT',
  );

  const unavailable = createDeviceKeyStore({
    dataDir: path.join(dataDir, 'other'),
    safeStorage: null,
  });
  assert.throws(
    () => unavailable.createNew(),
    (error) => error.message === 'DEVICE_KEY_UNAVAILABLE',
  );
});

test('Windows hardware fingerprint returns only SHA-256 values', async () => {
  const execFile = (command, _args, _options, callback) => {
    if (command === 'reg')
      return callback(null, 'MachineGuid    REG_SZ    raw-machine-guid');
    if (command === 'powershell.exe') return callback(null, 'raw-smbios-uuid');
    return callback(null, 'Volume Serial Number is RAW-DRIVE-ID');
  };
  const provider = createHardwareFingerprint({ platform: 'win32', execFile });

  const fingerprint = await provider.collect();

  assert.equal(fingerprint.machineGuidHash, hashRaw('raw-machine-guid'));
  assert.equal(fingerprint.smbiosUuidHash, hashRaw('raw-smbios-uuid'));
  assert.equal(fingerprint.systemDriveHash, hashRaw('RAW-DRIVE-ID'));
  assert.doesNotMatch(
    JSON.stringify(fingerprint),
    /raw-machine-guid|raw-smbios-uuid|RAW-DRIVE-ID/i,
  );
});
