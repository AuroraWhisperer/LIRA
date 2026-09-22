'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createDeviceKeyStore(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || process.cwd()));
  const keyDir = path.join(dataDir, 'license');
  const keyPath = path.join(keyDir, 'device-key.bin');
  const pendingKeyPath = path.join(keyDir, 'device-key.pending.bin');
  const storage = options.safeStorage || null;

  function canEncrypt() {
    return Boolean(storage && typeof storage.isEncryptionAvailable === 'function' && storage.isEncryptionAvailable());
  }

  function readStoredKey(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const encrypted = fs.readFileSync(filePath);
    if (!encrypted.length || !canEncrypt()) throw new Error('DEVICE_KEY_UNAVAILABLE');
    try {
      const pem = storage.decryptString(encrypted);
      if (!pem || !pem.includes('BEGIN PRIVATE KEY')) throw new Error('DEVICE_KEY_CORRUPT');
      return { privateKeyPem: pem, encrypted };
    } catch (error) {
      const wrapped = new Error('DEVICE_KEY_CORRUPT');
      wrapped.cause = error;
      throw wrapped;
    }
  }

  function loadPrivateKey() {
    return readStoredKey(keyPath)?.privateKeyPem || null;
  }

  function writeEncryptedKey(filePath, encrypted) {
    fs.mkdirSync(keyDir, { recursive: true });
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tempPath, encrypted, { mode: 0o600, flag: 'wx' });
      fs.renameSync(tempPath, filePath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }

  function prepareKey(keyPair, encrypted) {
    return {
      keyPair,
      stage: () => writeEncryptedKey(pendingKeyPath, encrypted),
      commit: () => writeEncryptedKey(keyPath, encrypted),
      complete: () => fs.rmSync(pendingKeyPath, { force: true }),
    };
  }

  function prepareNew() {
    if (!canEncrypt()) throw new Error('DEVICE_KEY_UNAVAILABLE');
    const pair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const encrypted = storage.encryptString(pair.privateKey);
    return prepareKey(
      {
        privateKeyPem: pair.privateKey,
        publicKeyPem: pair.publicKey,
        keyProtection: 'dpapi',
      },
      encrypted,
    );
  }

  function createNew() {
    const pending = prepareNew();
    pending.commit();
    return pending.keyPair;
  }

  function toKeyPair(existing) {
    if (existing) {
      const publicKeyPem = crypto.createPublicKey(existing).export({ type: 'spki', format: 'pem' });
      return { privateKeyPem: existing, publicKeyPem, keyProtection: 'dpapi' };
    }
    return null;
  }

  function loadOrCreate() {
    return toKeyPair(loadPrivateKey()) || createNew();
  }

  function loadPendingActivation() {
    const stored = readStoredKey(pendingKeyPath);
    return stored ? prepareKey(toKeyPair(stored.privateKeyPem), stored.encrypted) : null;
  }

  function prepareActivation() {
    // An earlier request may have bound this key even if its reply was lost.
    // Never replace an unreadable pending key or generate a new one over it.
    const pending = loadPendingActivation();
    if (pending) return pending;
    try {
      const keyPair = toKeyPair(loadPrivateKey());
      if (keyPair) return { keyPair, stage() {}, commit() {}, complete() {} };
    } catch (error) {
      // Keep the installed file while a replacement is prepared separately.
      void error;
    }
    return prepareNew();
  }

  return {
    keyPath,
    pendingKeyPath,
    loadPrivateKey,
    createNew,
    loadOrCreate,
    prepareActivation,
    loadPendingActivation,
    getPublicKey() {
      const privateKeyPem = loadPrivateKey();
      return privateKeyPem ? crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }) : null;
    },
  };
}

module.exports = { createDeviceKeyStore };
