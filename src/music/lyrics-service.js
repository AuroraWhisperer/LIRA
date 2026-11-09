// 编写人：Aurora
// 歌词获取、缓存与文本解析。
'use strict';

const { cleanTextPreserveLines } = require('../shared/utils');
const {
  musicCacheKey,
  readMusicJsonCache,
  writeMusicJsonCache,
  MUSIC_LYRIC_CACHE_TTL_MS,
  MUSIC_LYRIC_CACHE_MAX_BYTES,
} = require('./music-cache');
const { parseLyricResult } = require('./lyric-parser');
const { normalizeMusicTrackForProvider } = require('./track-contract');

function createLyricsService(options = {}) {
  const lyricCacheDir = String(options.lyricCacheDir || '');
  return {
    getMusicTrackLyrics(registry, body) {
      return getMusicTrackLyrics(registry, body, lyricCacheDir);
    },
    parseLyricPayload,
  };
}

async function getMusicTrackLyrics(registry, body, lyricCacheDir = '') {
  const input = body && typeof body === 'object' ? body : {};
  const normalizedTrack = normalizeMusicTrackForProvider(input.track || input);
  const cacheKey = musicCacheKey(normalizedTrack.source === 'netease' ? 'lyrics-v6' : 'lyrics-v5', {
    source: normalizedTrack.source,
    sourceTrackId: normalizedTrack.sourceTrackId,
  });
  const cached = readMusicJsonCache(lyricCacheDir, cacheKey, MUSIC_LYRIC_CACHE_TTL_MS);
  if (cached) return { ...cached, cached: true };
  const provider = registry.get(normalizedTrack.source);
  const result = await provider.getLyrics(normalizedTrack);
  // 空歌词结果不缓存：否则会压制 30 天内的重试（例如登录后才可获取的歌词）。
  const lines = Array.isArray(result && result.lines) ? result.lines : [];
  if (lines.length > 0) {
    writeMusicJsonCache(lyricCacheDir, cacheKey, result, MUSIC_LYRIC_CACHE_MAX_BYTES);
  }
  return result;
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
