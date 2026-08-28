'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createDeviceKeyStore(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || process.cwd()));
  const keyDir = path.join(dataDir, 'license');
  const keyPath = path.join(keyDir, 'device-key.bin');
  const storage = options.safeStorage || null;

  function canEncrypt() {
    return Boolean(storage && typeof storage.isEncryptionAvailable === 'function' && storage.isEncryptionAvailable());
  }

  function loadPrivateKey() {
    if (!fs.existsSync(keyPath)) return null;
    const encrypted = fs.readFileSync(keyPath);
    if (!encrypted.length || !canEncrypt()) throw new Error('DEVICE_KEY_UNAVAILABLE');
    try {
      const pem = storage.decryptString(encrypted);
      if (!pem || !pem.includes('BEGIN PRIVATE KEY')) throw new Error('DEVICE_KEY_CORRUPT');
      return pem;
    } catch (error) {
      const wrapped = new Error('DEVICE_KEY_CORRUPT');
      wrapped.cause = error;
      throw wrapped;
    }
  }

  function createNew() {
    if (!canEncrypt()) throw new Error('DEVICE_KEY_UNAVAILABLE');
    const pair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.mkdirSync(keyDir, { recursive: true });
    const encrypted = storage.encryptString(pair.privateKey);
    fs.writeFileSync(keyPath, encrypted, { mode: 0o600 });
    return { privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey, keyProtection: 'dpapi' };
  }

  function loadOrCreate() {
    const existing = loadPrivateKey();
    if (existing) {
      const publicKeyPem = crypto.createPublicKey(existing).export({ type: 'spki', format: 'pem' });
      return { privateKeyPem: existing, publicKeyPem, keyProtection: 'dpapi' };
    }
    return createNew();
  }

  return {
    keyPath,
    loadPrivateKey,
    createNew,
    loadOrCreate,
    getPublicKey() {
      const privateKeyPem = loadPrivateKey();
      return privateKeyPem
        ? crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' })
        : null;
    }
  };
}

module.exports = { createDeviceKeyStore };
