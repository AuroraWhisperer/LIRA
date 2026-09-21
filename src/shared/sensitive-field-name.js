'use strict';

function isSensitiveFieldName(key) {
  const normalizedKey = String(key).toLowerCase().replace(/[_-]/g, '');
  return (
    normalizedKey === 'password' ||
    normalizedKey === 'passwd' ||
    normalizedKey === 'key' ||
    normalizedKey === 'activationcode' ||
    normalizedKey === 'pairingcode' ||
    normalizedKey === 'fingerprint' ||
    normalizedKey === 'hardwareid' ||
    normalizedKey === 'authorization' ||
    normalizedKey === 'cookie' ||
    normalizedKey.endsWith('apikey') ||
    normalizedKey.endsWith('secret') ||
    normalizedKey.endsWith('token') ||
    normalizedKey.endsWith('signature') ||
    normalizedKey.includes('privatekey')
  );
}

module.exports = { isSensitiveFieldName };
