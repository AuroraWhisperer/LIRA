'use strict';

const DEFAULT_PLATFORMS = ['qq', 'netease'];
const DEFAULT_PREFERRED_PLATFORM = 'netease';
const SUPPORTED_PLATFORMS = new Set(DEFAULT_PLATFORMS);
const MAX_DURATION_DISTANCE_MS = 5000;

/**
 * Matches online lyrics for WeSing fallback only.
 *
 * Provider access stays behind this function so the capture state machine does
 * not know about QQ/NetEase APIs, authentication, caching, or match scoring.
 */
function createWeSingOnlineLyricResolver(options = {}) {
  const getRegistry = typeof options.getRegistry === 'function' ? options.getRegistry : () => options.registry;
  const getPreferences =
    typeof options.getPreferences === 'function'
      ? options.getPreferences
      : () => ({
          preferredPlatform: options.preferredPlatform,
          smartMatch: options.smartMatch,
        });
  const lyricsService = options.lyricsService;
  const platforms = normalizePlatforms(options.platforms);

  if (
    !lyricsService ||
    typeof lyricsService.searchMusicTracks !== 'function' ||
    typeof lyricsService.getMusicTrackLyrics !== 'function'
  ) {
    throw new Error('全民 K 歌在线歌词解析器缺少歌词服务。');
  }

  return async function resolveWeSingOnlineLyrics(input = {}) {
    const title = String(input.title || '')
      .trim()
      .slice(0, 120);
    const artist = String(input.artist || input.artists?.[0] || '')
      .trim()
      .slice(0, 80);
    const durationMs = Math.max(0, Number(input.durationMs) || 0);
    if (!title) return null;

    const registry = getRegistry();
    if (!registry) throw new Error('音乐 Provider 尚未初始化。');
    const preferences = normalizeLyricPreferences(getPreferences(), platforms);
    const requestedPlatforms = preferences.smartMatch ? platforms : [preferences.preferredPlatform];

    // allSettled keeps one unavailable provider from suppressing the other.
    const settled = await Promise.allSettled(
      requestedPlatforms.map((platform) =>
        resolveProviderLyrics({
          registry,
          lyricsService,
          platform,
          title,
          artist,
          durationMs,
        }),
      ),
    );
    const candidates = settled.filter((item) => item.status === 'fulfilled' && item.value).map((item) => item.value);
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
  const searchArtist = artist.replace(/[（(].*?[）)]/g, '').trim();
  const keyword = [title, searchArtist].filter(Boolean).join(' ');
  const searchResult = await lyricsService.searchMusicTracks(registry, {
    platform,
    keyword,
    limit: 20,
  });
  const match = rankWeSingLyricTracks(title, durationMs, searchResult.tracks, artist)[0];
  if (!match) return null;

  const lyricResult = await lyricsService.getMusicTrackLyrics(registry, {
    track: match.track,
  });
  const lines = Array.isArray(lyricResult?.lines) ? lyricResult.lines : [];
  if (lines.length === 0) return null;

  return {
    platform,
    durationDistance: match.durationDistance,
    qualityScore: scoreLyricQuality(lines),
    result: {
      source: lyricResult.source || platform,
      songMid: String(match.track.sourceTrackId || match.track.id || ''),
      title: match.track.title || title,
      artists: Array.isArray(match.track.artists) ? match.track.artists : [],
      durationMs: Math.max(durationMs, Number(match.track.durationMs) || 0, getLastLineEnd(lines)),
      lines,
    },
  };
}

/**
 * Match the requested rendition, including covers, before comparing timelines.
 * The general song-request matcher prefers originals and is unsuitable here.
 */
function selectWeSingLyricTrack(title, durationMs, tracks, artist = '') {
  return rankWeSingLyricTracks(title, durationMs, tracks, artist)[0]?.track || null;
}

function rankWeSingLyricTracks(title, durationMs, tracks, artist = '') {
  const candidates = Array.isArray(tracks) ? tracks : [];
  const requestedTitle = normalizeMatchText(title);
  const baseTitle = requestedTitle.replace(/\([^)]*\)/g, '');
  const requestedArtists = getArtistNames(artist);
  return candidates
    .filter((track) => {
      const candidateTitle = normalizeMatchText(track?.title);
      if (!baseTitle || candidateTitle.replace(/\([^)]*\)/g, '') !== baseTitle) return false;
      const candidateDuration = Math.max(0, Number(track.durationMs) || 0);
      if (durationMs > 0 && candidateDuration > 0 && Math.abs(durationMs - candidateDuration) > MAX_DURATION_DISTANCE_MS) {
        return false;
      }
      // An explicit version must match; an unspecified version may be a cover or Live.
      if (requestedTitle !== baseTitle && candidateTitle !== requestedTitle) return false;
      const artists = Array.isArray(track.artists) ? track.artists : [track.artist];
      return (
        requestedArtists.length === 0 ||
        artists.some((name) => getArtistNames(name).some((candidate) => requestedArtists.includes(candidate)))
      );
    })
    .map((track, index) => {
      const candidateDuration = Math.max(0, Number(track?.durationMs) || 0);
      return {
        track,
        durationDistance:
          durationMs > 0 && candidateDuration > 0 ? Math.abs(candidateDuration - durationMs) : Number.MAX_SAFE_INTEGER,
        index,
      };
    })
    .sort((left, right) => left.durationDistance - right.durationDistance || left.index - right.index);
}

function normalizeMatchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s《》"'“”‘’]+/g, '');
}

function getArtistNames(value) {
  // WeSing may report an alias such as "en (王翊恩)" while providers use "en".
  return normalizeMatchText(value).split(/[()/、&]/).filter(Boolean);
}

function selectBestLyricCandidate(candidates, preferredPlatform) {
  return (
    [...candidates].sort(
      (left, right) =>
        left.durationDistance - right.durationDistance ||
        right.qualityScore - left.qualityScore ||
        getLyricLineCount(right) - getLyricLineCount(left) ||
        Number(right.platform === preferredPlatform) - Number(left.platform === preferredPlatform),
    )[0] || null
  );
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
    ? value
        .map((platform) => String(platform).trim().toLowerCase())
        .filter((platform) => SUPPORTED_PLATFORMS.has(platform))
    : DEFAULT_PLATFORMS;
  return [...new Set(platforms.length > 0 ? platforms : DEFAULT_PLATFORMS)];
}

function normalizeLyricPreferences(value, platforms) {
  const input = value && typeof value === 'object' ? value : {};
  const requestedPlatform = String(input.preferredPlatform || '')
    .trim()
    .toLowerCase();
  const preferredPlatform = platforms.includes(requestedPlatform)
    ? requestedPlatform
    : platforms.includes(DEFAULT_PREFERRED_PLATFORM)
      ? DEFAULT_PREFERRED_PLATFORM
      : platforms[0];
  const smartMatch = input.smartMatch === undefined ? true : input.smartMatch === true || input.smartMatch === 'true';
  return { preferredPlatform, smartMatch };
}

function getLastLineEnd(lines) {
  return lines.reduce((maximum, line) => Math.max(maximum, Number(line?.endMs) || Number(line?.startMs) || 0), 0);
}

module.exports = {
  createWeSingOnlineLyricResolver,
  selectBestLyricCandidate,
  selectWeSingLyricTrack,
};
