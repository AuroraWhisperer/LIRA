'use strict';

const { SceneError, MAX_SCENE_BYTES } = require('./scene-contract');
const { normalizeBrowserSourceConfig } = require('../../public/js/shared/scene-browser-source.js');

function createSceneBrowserSourceCodec(secretCodec) {
  function unavailable() {
    return new SceneError('SCENE_BROWSER_SOURCE_UNAVAILABLE', 503, '无法安全读取或保存浏览器源，请检查系统凭据保护。');
  }
  function decodeUrl(value, binding) {
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 2
      || value.schemaVersion !== 1 || typeof value.encrypted !== 'string' || !value.encrypted) throw unavailable();
    const decoded = JSON.parse(secretCodec.decrypt(value.encrypted));
    if (!decoded || Object.keys(decoded).length !== 5 || decoded.schemaVersion !== 1
      || decoded.ownerScope !== binding.ownerScope || decoded.sceneId !== binding.sceneId
      || decoded.itemId !== binding.itemId || typeof decoded.url !== 'string') throw unavailable();
    return decoded.url;
  }
  function transform(document, ownerScope, encrypt) {
    if (!document?.items.some((item) => item.type === 'browser')) return document;
    try {
      if (secretCodec.isAvailable() !== true) throw unavailable();
      const result = JSON.parse(JSON.stringify(document));
      for (const item of result.items) {
        if (item.type !== 'browser') continue;
        const binding = { schemaVersion: 1, ownerScope, sceneId: result.id, itemId: item.id };
        const config = item.appearance.config;
        if (encrypt) {
          const encrypted = secretCodec.encrypt(JSON.stringify({ ...binding, url: config.url }));
          const sealed = { schemaVersion: 1, encrypted };
          if (decodeUrl(sealed, binding) !== config.url) throw unavailable();
          config.url = sealed;
        } else {
          config.url = decodeUrl(config.url, binding);
          item.appearance.config = normalizeBrowserSourceConfig(config);
        }
      }
      if (encrypt && Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_SCENE_BYTES) {
        throw new SceneError('SCENE_INVALID_DOCUMENT', 400, '加密后的场景文档超过 256 KiB，请减少浏览器源或缩短地址。');
      }
      return result;
    } catch (error) {
      if (error instanceof SceneError) throw error;
      throw unavailable();
    }
  }
  return {
    encode: (document, scope) => transform(document, scope, true),
    decodeDocument: (document, scope) => transform(document, scope, false),
    decode(record, scope) {
      return record && { ...record, document: transform(record.document, scope, false),
        publishedDocument: transform(record.publishedDocument, scope, false) };
    },
  };
}

module.exports = { createSceneBrowserSourceCodec };
