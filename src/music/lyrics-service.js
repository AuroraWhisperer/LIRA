// 编写人：Aurora
// 歌词获取、缓存与文本解析。
'use strict';

const { cleanTextPreserveLines } = require('../shared/utils');
const {
  musicCacheKey,
  readLyricJsonCache,
  writeLyricJsonCache,
} = require('./music-cache');
const { estimateWordTimings, parseLyricResult } = require('./lyric-parser');
const { normalizeMusicTrackForProvider } = require('./track-contract');

const CONNECTION_ERRORS = new Set([
  'ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

function isConnectionFailure(error) {
  if (!error || error.name === 'AbortError' || error.statusCode || error.status) return false;
  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(isConnectionFailure);
  if (error.name === 'TimeoutError') return true;
  if (error.code) return CONNECTION_ERRORS.has(error.code);
  if (error.cause) return isConnectionFailure(error.cause);
  return error instanceof TypeError && error.message === 'fetch failed';
}

async function readLegacyLyrics(directory, { source, sourceTrackId }) {
  const versions = source === 'qq' ? ['lyrics-v6', 'lyrics-v5'] : ['lyrics-v6'];
  for (const version of versions) {
    const legacy = await readLyricJsonCache(directory, musicCacheKey(version, { source, sourceTrackId }));
    if (Array.isArray(legacy?.lines) && legacy.lines.length &&
        legacy.lines.every(line => Number.isFinite(line?.startMs) && typeof line.text === 'string')) return legacy;
  }
  return null;
}

function legacyLyricText({ source, sourceTrackId, lines }, durationMs) {
  // Only row anchors survive the old QQ word matching and NetEase duration estimates reliably.
  const trackEnd = source === 'netease' && durationMs > lines.at(-1).startMs ? durationMs : undefined;
  return {
    source, sourceTrackId, cached: true, retryable: true,
    lines: lines.map(({ startMs, text, translation, roma }, index) => ({
      startMs, text, translation, roma, endMs: lines[index + 1]?.startMs ?? trackEnd, words: [],
    })),
  };
}

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
  const { result, legacy } = await readTrackLyrics(registry, normalizedTrack, lyricCacheDir, inFlight);
  if (legacy) return legacyLyricText(legacy, normalizedTrack.durationMs);
  if (normalizedTrack.source !== 'netease') return result;
  const last = result?.lines?.at(-1);
  if (!last || last.endMs != null || last.words?.length) return result;
  const [timed] = estimateWordTimings([last], normalizedTrack.durationMs);
  return { ...result, lines: result.lines.with(-1, timed) };
}

async function readTrackLyrics(registry, normalizedTrack, lyricCacheDir, inFlight) {
  const { source, sourceTrackId } = normalizedTrack;
  const cacheKey = musicCacheKey('lyrics-v7', { source, sourceTrackId });
  const cached = await readLyricJsonCache(lyricCacheDir, cacheKey);
  if (cached) return { result: { ...cached, cached: true } };
  const revision = await registry.getAuthorizationRevision?.(normalizedTrack.source);
  const qqMatch = source === 'qq' && [normalizedTrack.durationMs, normalizedTrack.sourceSongId,
    !normalizedTrack.sourceSongId && [normalizedTrack.title, normalizedTrack.artists[0]]];
  const requestKey = JSON.stringify([cacheKey, revision, qqMatch]);
  let requests = inFlight.get(registry);
  if (!requests) inFlight.set(registry, requests = new Map());
  if (requests.has(requestKey)) return structuredClone(await requests.get(requestKey));
  const provider = registry.get(normalizedTrack.source);
  const pending = (async () => {
    let result;
    try {
      result = source === 'netease'
        ? await provider.getLyrics(normalizedTrack, { deferFinalTiming: true })
        : await provider.getLyrics(normalizedTrack);
    } catch (error) {
      if (isConnectionFailure(error)) {
        const legacy = await readLegacyLyrics(lyricCacheDir, normalizedTrack);
        if (legacy && revision === await registry.getAuthorizationRevision?.(source)) return { legacy };
      }
      throw error;
    }
    // 空歌词结果允许登录后重试。
    if (Array.isArray(result?.lines) && result.lines.length) {
      await writeLyricJsonCache(lyricCacheDir, cacheKey, result,
        async () => revision === await registry.getAuthorizationRevision?.(normalizedTrack.source));
    }
    return { result };
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
