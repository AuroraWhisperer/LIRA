'use strict';

const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { SCENE_TYPES, SceneError } = require('./scene-contract');

// Receipts retain only the active version's authorized type set, not documents or
// display data. The process key makes old receipts unusable after a restart.
function createSceneOutputProjection() {
  const key = randomBytes(32);
  function signature(payload, binding) {
    return createHmac('sha256', key).update(JSON.stringify(binding)).update('.').update(payload).digest();
  }
  function issue(binding, version, types) {
    const payload = Buffer.from(JSON.stringify({ version, types })).toString('base64url');
    return `${payload}.${signature(payload, binding).toString('base64url')}`;
  }
  function read(receipt, binding, version) {
    if (receipt == null || receipt === '') return [];
    try {
      if (typeof receipt !== 'string' || receipt.length > 512 || !/^[\w-]+\.[\w-]+$/.test(receipt)) throw new Error();
      const [payload, mac] = receipt.split('.');
      const supplied = Buffer.from(mac, 'base64url');
      const expected = signature(payload, binding);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error();
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (decoded.version !== version || !Array.isArray(decoded.types) || decoded.types.length > SCENE_TYPES.length
        || decoded.types.some((type) => !SCENE_TYPES.includes(type))) throw new Error();
      return decoded.types;
    } catch {
      throw new SceneError('SCENE_PROJECTION_EXPIRED', 403, '场景数据授权已失效，正在重新准备当前版本。');
    }
  }
  return { issue, read };
}

module.exports = { createSceneOutputProjection };
