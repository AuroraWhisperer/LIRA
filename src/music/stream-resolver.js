// 编写人：Aurora
// 在线音源解析 — 解析可播放 URL。
'use strict';

const { normalizeMusicTrackForProvider } = require('./track-contract');

function resolveMusicStream(registry, track, options = {}) {
  const normalizedTrack = normalizeMusicTrackForProvider(track);
  const provider = registry.get(normalizedTrack.source);
  return provider.resolvePlayableUrl(normalizedTrack, {
    forceRefresh: options.forceRefresh === true
  });
}

module.exports = { resolveMusicStream, normalizeMusicTrackForProvider };
