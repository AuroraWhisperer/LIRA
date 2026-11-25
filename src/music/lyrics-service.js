// 编写人：Aurora
// 歌词获取、缓存与文本解析。
'use strict';

const { cleanTextPreserveLines } = require('../shared/utils');
const {
  musicCacheKey,
  readLyricJsonCache,
  writeLyricJsonCache,
} = require('./music-cache');
const { parseLyricResult } = require('./lyric-parser');
const { normalizeMusicTrackForProvider } = require('./track-contract');

function createLyricsService(options = {}) {
  const lyricCacheDir = String(options.lyricCacheDir || '');
  const inFlight = new WeakMap();
  return {
    getMusicTrackLyrics(registry, body) {
      return getMusicTrackLyrics(registry, body, lyricCacheDir, inFlight);
    },
    parseLyricPayload,
  };
}

async function getMusicTrackLyrics(registry, body, lyricCacheDir = '', inFlight = new WeakMap()) {
  const input = body && typeof body === 'object' ? body : {};
  const normalizedTrack = normalizeMusicTrackForProvider(input.track || input);
  const cacheKey = musicCacheKey(normalizedTrack.source === 'netease' ? 'lyrics-v6' : 'lyrics-v5', {
    source: normalizedTrack.source,
    sourceTrackId: normalizedTrack.sourceTrackId,
  });
  const cached = await readLyricJsonCache(lyricCacheDir, cacheKey);
  if (cached) return { ...cached, cached: true };
  const revision = await registry.getAuthorizationRevision?.(normalizedTrack.source);
  const requestKey = JSON.stringify([cacheKey, revision, normalizedTrack.durationMs, normalizedTrack.sourceSongId,
    normalizedTrack.source === 'qq' && !normalizedTrack.sourceSongId && [normalizedTrack.title, normalizedTrack.artists[0]]]);
  let requests = inFlight.get(registry);
  if (!requests) inFlight.set(registry, requests = new Map());
  if (requests.has(requestKey)) return structuredClone(await requests.get(requestKey));
  const provider = registry.get(normalizedTrack.source);
  const pending = (async () => {
    const result = await provider.getLyrics(normalizedTrack);
    // 空歌词结果允许登录后重试。
    if (Array.isArray(result?.lines) && result.lines.length) {
      await writeLyricJsonCache(lyricCacheDir, cacheKey, result,
        async () => revision === await registry.getAuthorizationRevision?.(normalizedTrack.source));
    }
    return result;
  })();
  requests.set(requestKey, pending);
  try { return await pending; }
  finally { requests.delete(requestKey); }
}

function parseLyricPayload(body) {
  const lyric = cleanTextPreserveLines(body.lyric).slice(0, 512 * 1024);
  const translation = cleanTextPreserveLines(body.translation).slice(0, 512 * 1024);
  const wordLyric = cleanTextPreserveLines(body.wordLyric || body.yrc).slice(0, 512 * 1024);
  const roma = cleanTextPreserveLines(body.roma || '').slice(0, 512 * 1024);
  return { lines: parseLyricResult(lyric, translation, wordLyric, roma) };
}

module.exports = {
  createLyricsService,
  getMusicTrackLyrics,
  parseLyricPayload,
};
