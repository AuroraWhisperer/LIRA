'use strict';

/**
 * Wrap Electron safeStorage behind a tiny interface so domain code and tests do
 * not depend on Electron. Plaintext fallback is intentionally not provided.
 */
function createElectronSecretCodec(safeStorageOverride = null) {
  let safeStorage = safeStorageOverride;
  if (!safeStorage) {
    try {
      ({ safeStorage } = require('electron'));
    } catch {
      safeStorage = null;
    }
  }

  return {
    isAvailable() {
      return Boolean(safeStorage?.isEncryptionAvailable?.());
    },
    encrypt(value) {
      if (!this.isAvailable()) throw new Error('当前系统无法安全加密 API Key，未保存密钥。');
      return safeStorage.encryptString(String(value)).toString('base64');
    },
    decrypt(value) {
      if (!value) return '';
      if (!this.isAvailable()) throw new Error('当前系统无法解密已保存的 API Key。');
      return safeStorage.decryptString(Buffer.from(String(value), 'base64'));
    }
  };
}

module.exports = { createElectronSecretCodec };
