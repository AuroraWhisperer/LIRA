// 编写人：Aurora
// 音乐 Provider 健康检查聚合。
'use strict';

const { normalizeMusicPlatform } = require('./provider-registry');

function getMusicProviderHealth(registry, platform) {
  if (platform) return registry.healthCheck(normalizeMusicPlatform(platform));
  return registry.healthCheck();
}

module.exports = { getMusicProviderHealth };
