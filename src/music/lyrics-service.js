// 编写人：Aurora
// 歌词获取 + 搜索 + 推荐内容。
'use strict';

const { cleanText, cleanTextPreserveLines } = require('../shared/utils');
const { musicCacheKey, readMusicJsonCache, writeMusicJsonCache } = require('./music-cache');
const { parseLyricResult } = require('./lyrics');
const { rankTrackCandidates } = require('./song-matcher');
const { normalizeMusicPlatform } = require('./provider-registry');

const MUSIC_API_CACHE_TTL_MS = 5 * 60 * 1000;
const MUSIC_LYRIC_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let apiCacheDir = '';
let lyricCacheDir = '';

function initLyricsService(apiDir, lyricDir) {
  apiCacheDir = apiDir;
  lyricCacheDir = lyricDir;
}

async function searchMusicTracks(registry, body) {
  const input = body && typeof body === 'object' ? body : {};
  const platform = normalizeMusicPlatform(input.platform || input.source || 'netease');
  const keyword = cleanText(input.keyword || input.query || input.songName).slice(0, 120);
  if (!keyword) throw new Error('缺少搜索关键词。');

  const limit = Math.max(1, Math.min(30, Number(input.limit) || 20));
  const provider = registry.get(platform);
  return {
    source: platform, keyword,
    tracks: await provider.searchTracks(keyword, { limit })
  };
}

async function getMusicHomeContent(registry, body) {
  const input = body && typeof body === 'object' ? body : {};
  const platform = normalizeMusicPlatform(input.platform || input.source || 'netease');
  const action = cleanText(input.action || 'personalized');
  const limit = Math.max(1, Math.min(5000, Number(input.limit) || 100));
  const offset = Math.max(0, Number(input.offset) || 0);
  const provider = registry.get(platform);
  // radio / daily 的重点就是每次给新歌，缓存会让它们永远返回同一批，所以不缓存。
  const cacheable = ['personalized', 'playlist-tracks'].includes(action);
  const page = Math.max(1, Math.min(50, Number(input.page) || 1));
  const bypassCache = input.refresh === true || page > 1;
  const cacheKey = cacheable && !bypassCache
    ? musicCacheKey('home', { platform, action, limit, playlistId: cleanText(input.playlistId) })
    : '';
  if (cacheKey) {
    const cached = readMusicJsonCache(apiCacheDir, cacheKey, MUSIC_API_CACHE_TTL_MS);
    if (cached) return { ...cached, cached: true };
  }

  let result;
  if (action === 'personalized') {
    result = { source: platform, action, playlists: await provider.getPersonalizedPlaylists({ limit: Math.min(limit, 30), page }) };
    if (cacheKey) writeMusicJsonCache(apiCacheDir, cacheKey, result);
    return result;
  }
  if (action === 'playlist-tracks') {
    const playlistId = cleanText(input.playlistId);
    if (!playlistId) throw new Error('缺少歌单 ID。');
    result = { source: platform, action, playlistId, tracks: await provider.getPlaylistTracks(playlistId, { limit }) };
    writeMusicJsonCache(apiCacheDir, cacheKey, result);
    return result;
  }
  if (action === 'daily') return { source: platform, action, tracks: await provider.getDailyTracks({ limit, page }) };
  if (action === 'radio') return { source: platform, action, tracks: await provider.getRadioTracks({ limit, page }) };
  if (action === 'liked') return { source: platform, action, tracks: await provider.getLikedTracks({ limit, offset }) };
  if (action === 'created-playlists') return { source: platform, action, playlists: await provider.getCreatedPlaylists({ limit }) };
  if (action === 'collected-playlists') return { source: platform, action, playlists: await provider.getCollectedPlaylists({ limit }) };
  if (action === 'recent') return { source: platform, action, tracks: await provider.getRecentTracks({ limit }) };

  throw new Error('未知音乐首页动作。');
}

async function getMusicTrackLyrics(registry, body) {
  const input = body && typeof body === 'object' ? body : {};
  const normalizedTrack = normalizeMusicTrackForProvider(input.track || input);
  const cacheKey = musicCacheKey('lyrics', { source: normalizedTrack.source, sourceTrackId: normalizedTrack.sourceTrackId });
  const cached = readMusicJsonCache(lyricCacheDir, cacheKey, MUSIC_LYRIC_CACHE_TTL_MS);
  if (cached) return { ...cached, cached: true };
  const provider = registry.get(normalizedTrack.source);
  const result = await provider.getLyrics(normalizedTrack);
  writeMusicJsonCache(lyricCacheDir, cacheKey, result);
  return result;
}

function parseLyricPayload(body) {
  const lyric = cleanTextPreserveLines(body.lyric).slice(0, 512 * 1024);
  const translation = cleanTextPreserveLines(body.translation).slice(0, 512 * 1024);
  const wordLyric = cleanTextPreserveLines(body.wordLyric || body.yrc).slice(0, 512 * 1024);
  return { lines: parseLyricResult(lyric, translation, wordLyric) };
}

function matchMusicTrackCandidates(body) {
  const request = {
    songName: cleanText(body.songName || body.title).slice(0, 120),
    artist: cleanText(body.artist).slice(0, 80),
    durationMs: Math.max(0, Number(body.durationMs) || 0)
  };
  if (!request.songName) throw new Error('缺少要匹配的歌名。');

  const candidates = Array.isArray(body.candidates) && body.candidates.length > 0
    ? body.candidates.slice(0, 50)
    : []; // local candidates need db access — pass from caller

  return { request, threshold: 70, results: rankTrackCandidates(request, candidates) };
}

function normalizeMusicTrackForProvider(track) {
  if (!track || typeof track !== 'object') throw new Error('缺少歌曲信息。');
  const source = normalizeMusicPlatform(track.source);
  const id = cleanText(track.id || track.sourceTrackId);
  const sourceTrackId = cleanText(track.sourceTrackId || track.id);
  const title = cleanText(track.title);
  if (!id || !sourceTrackId || !title) throw new Error('歌曲信息不完整。');
  const artists = Array.isArray(track.artists)
    ? track.artists.map(cleanText).filter(Boolean).slice(0, 8) : [];

  return {
    id, source, title, artists,
    album: cleanText(track.album),
    durationMs: Math.max(0, Number(track.durationMs) || 0),
    coverUrl: cleanText(track.coverUrl),
    sourceTrackId, sourceAlbumId: cleanText(track.sourceAlbumId),
    playable: track.playable !== false, vip: track.vip === true
  };
}

module.exports = {
  initLyricsService, searchMusicTracks, getMusicHomeContent,
  getMusicTrackLyrics, parseLyricPayload, matchMusicTrackCandidates,
  normalizeMusicTrackForProvider
};
