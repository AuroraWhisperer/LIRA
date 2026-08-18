'use strict';

const { scoreTrackMatch } = require('./song-matcher');

const DEFAULT_PLATFORMS = ['qq', 'netease'];
const DEFAULT_PREFERRED_PLATFORM = 'netease';
const SUPPORTED_PLATFORMS = new Set(DEFAULT_PLATFORMS);
const MIN_TITLE_MATCH_SCORE = 60;
const CLOSE_MATCH_SCORE_GAP = 5;

/**
 * Creates the optional online fallback used by the WeSing capture service.
 *
 * Provider access stays behind this function so the capture state machine does
 * not know about QQ/NetEase APIs, authentication, caching, or match scoring.
 */
function createWeSingOnlineLyricResolver(options = {}) {
  const getRegistry = typeof options.getRegistry === 'function'
    ? options.getRegistry
    : () => options.registry;
  const getPreferences = typeof options.getPreferences === 'function'
    ? options.getPreferences
    : () => ({
      preferredPlatform: options.preferredPlatform,
      smartMatch: options.smartMatch
    });
  const lyricsService = options.lyricsService;
  const platforms = normalizePlatforms(options.platforms);

  if (!lyricsService
      || typeof lyricsService.searchMusicTracks !== 'function'
      || typeof lyricsService.getMusicTrackLyrics !== 'function') {
    throw new Error('全民 K 歌在线歌词解析器缺少歌词服务。');
  }

  return async function resolveWeSingOnlineLyrics(input = {}) {
    const title = String(input.title || '').trim().slice(0, 120);
    const artist = String(input.artist || input.artists?.[0] || '').trim().slice(0, 80);
    const durationMs = Math.max(0, Number(input.durationMs) || 0);
    if (!title) return null;

    const registry = getRegistry();
    if (!registry) throw new Error('音乐 Provider 尚未初始化。');
    const preferences = normalizeLyricPreferences(getPreferences(), platforms);
    const requestedPlatforms = preferences.smartMatch
      ? platforms
      : [preferences.preferredPlatform];

    // allSettled keeps one unavailable provider from suppressing the other.
    const settled = await Promise.allSettled(requestedPlatforms.map((platform) => (
      resolveProviderLyrics({ registry, lyricsService, platform, title, artist, durationMs })
    )));
    const candidates = settled
      .filter((item) => item.status === 'fulfilled' && item.value)
      .map((item) => item.value);
    if (candidates.length === 0) {
      const rejected = settled.find((item) => item.status === 'rejected');
      if (rejected) throw rejected.reason;
      return null;
    }

    const selected = selectBestLyricCandidate(candidates, preferences.preferredPlatform);
    return selected ? selected.result : null;
  };
}

async function resolveProviderLyrics(options) {
  const { registry, lyricsService, platform, title, artist, durationMs } = options;
  const keyword = [title, artist].filter(Boolean).join(' ');
  const searchResult = await lyricsService.searchMusicTracks(registry, {
    platform,
    keyword,
    limit: 20
  });
  const match = rankWeSingLyricTracks(title, durationMs, searchResult.tracks, artist)[0];
  if (!match || match.score < MIN_TITLE_MATCH_SCORE) return null;

  const lyricResult = await lyricsService.getMusicTrackLyrics(registry, { track: match.track });
  const lines = Array.isArray(lyricResult?.lines) ? lyricResult.lines : [];
  if (lines.length === 0) return null;

  return {
    platform,
    matchScore: match.score,
    durationDistance: match.durationDistance,
    qualityScore: scoreLyricQuality(lines),
    result: {
      source: lyricResult.source || platform,
      songMid: String(match.track.sourceTrackId || match.track.id || ''),
      title: match.track.title || title,
      artists: Array.isArray(match.track.artists) ? match.track.artists : [],
      durationMs: Math.max(durationMs, Number(match.track.durationMs) || 0, getLastLineEnd(lines)),
      lines
    }
  };
}

/**
 * Uses the window duration as an extra discriminator for same-name covers.
 * Now Playing only has title/artist similarity here; the duration improves the
 * ambiguous no-artist case without weakening its strict title requirement.
 */
function selectWeSingLyricTrack(title, durationMs, tracks, artist = '') {
  return rankWeSingLyricTracks(title, durationMs, tracks, artist)[0]?.track || null;
}

function rankWeSingLyricTracks(title, durationMs, tracks, artist = '') {
  const candidates = Array.isArray(tracks) ? tracks : [];
  return candidates.map((track, index) => {
    const result = scoreTrackMatch({ songName: title, artist, durationMs }, track);
    const candidateDuration = Math.max(0, Number(track?.durationMs) || 0);
    return {
      track,
      score: result.score,
      durationDistance: durationMs > 0 && candidateDuration > 0
        ? Math.abs(candidateDuration - durationMs)
        : Number.MAX_SAFE_INTEGER,
      index
    };
  }).sort((left, right) => (
    right.score - left.score
    || left.durationDistance - right.durationDistance
    || left.index - right.index
  ));
}

function selectBestLyricCandidate(candidates, preferredPlatform) {
  return [...candidates].sort((left, right) => {
    const matchGap = Math.abs(left.matchScore - right.matchScore);
    if (matchGap > CLOSE_MATCH_SCORE_GAP) return right.matchScore - left.matchScore;
    return right.qualityScore - left.qualityScore
      || getLyricLineCount(right) - getLyricLineCount(left)
      || left.durationDistance - right.durationDistance
      || Number(right.platform === preferredPlatform) - Number(left.platform === preferredPlatform);
  })[0] || null;
}

function getLyricLineCount(candidate) {
  return Array.isArray(candidate?.result?.lines) ? candidate.result.lines.length : 0;
}

function scoreLyricQuality(lines) {
  const hasWords = lines.some((line) => Array.isArray(line?.words) && line.words.length > 0);
  const hasTranslation = lines.some((line) => String(line?.translation || '').trim());
  return 1 + Number(hasWords) + Number(hasTranslation);
}

function normalizePlatforms(value) {
  const platforms = Array.isArray(value)
    ? value.map((platform) => String(platform).trim().toLowerCase()).filter((platform) => SUPPORTED_PLATFORMS.has(platform))
    : DEFAULT_PLATFORMS;
  return [...new Set(platforms.length > 0 ? platforms : DEFAULT_PLATFORMS)];
}

function normalizeLyricPreferences(value, platforms) {
  const input = value && typeof value === 'object' ? value : {};
  const requestedPlatform = String(input.preferredPlatform || '').trim().toLowerCase();
  const preferredPlatform = platforms.includes(requestedPlatform)
    ? requestedPlatform
    : platforms.includes(DEFAULT_PREFERRED_PLATFORM) ? DEFAULT_PREFERRED_PLATFORM : platforms[0];
  const smartMatch = input.smartMatch === undefined
    ? true
    : input.smartMatch === true || input.smartMatch === 'true';
  return { preferredPlatform, smartMatch };
}

function getLastLineEnd(lines) {
  return lines.reduce((maximum, line) => Math.max(
    maximum,
    Number(line?.endMs) || Number(line?.startMs) || 0
  ), 0);
}

module.exports = {
  createWeSingOnlineLyricResolver,
  selectBestLyricCandidate,
  selectWeSingLyricTrack
};
