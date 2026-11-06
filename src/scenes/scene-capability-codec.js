'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { SceneError } = require('./scene-contract');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function matchesToken(token, hash) {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)
    && typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)
    && timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(hash, 'hex'));
}

function createSceneCapabilityCodec(secretCodec) {
  function decodeCapability(scope, id, capability) {
    try {
      if (secretCodec.isAvailable() !== true) throw new Error();
      const decoded = JSON.parse(secretCodec.decrypt(capability.encrypted));
      if (!decoded || Object.keys(decoded).length !== 5 || decoded.schemaVersion !== 1
        || decoded.ownerScope !== scope || decoded.sceneId !== id
        || decoded.capabilityVersion !== capability.version || !matchesToken(decoded.token, capability.hash)) {
        throw new Error();
      }
      return decoded.token;
    } catch {
      throw new SceneError('SCENE_SOURCE_UNAVAILABLE', 503, '无法安全读取场景来源，请检查系统凭据保护。');
    }
  }

  function issueCapability(scope, id, version) {
    try {
      if (!Number.isSafeInteger(version) || version < 1 || secretCodec.isAvailable() !== true) throw new Error();
      const token = randomBytes(32).toString('hex');
      const encrypted = secretCodec.encrypt(JSON.stringify({
        schemaVersion: 1,
        ownerScope: scope,
        sceneId: id,
        capabilityVersion: version,
        token,
      }));
      if (typeof encrypted !== 'string' || !encrypted) throw new Error();
      const capability = { version, hash: hashToken(token), encrypted };
      decodeCapability(scope, id, capability);
      return { capability, token };
    } catch {
      throw new SceneError('SCENE_SOURCE_UNAVAILABLE', 503, '无法安全保存场景来源，请检查系统凭据保护。');
    }
  }

  return { issue: issueCapability, decode: decodeCapability, matchesToken };
}

module.exports = { createSceneCapabilityCodec };
