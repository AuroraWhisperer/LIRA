// 编写人：Aurora
// 音乐目录搜索、首页内容与歌单写入。
'use strict';

const { createPublicError } = require('../shared/public-error');

const { cleanText } = require('../shared/utils');
const {
  musicCacheKey,
  readMusicJsonCache,
  writeMusicJsonCache,
  MUSIC_API_CACHE_TTL_MS,
  MUSIC_API_CACHE_MAX_BYTES,
} = require('./music-cache');
const { normalizeMusicPlatform } = require('./provider-registry');
const { clearLikedTracksSessions } = require('./providers/liked-tracks-session');

function createMusicCatalogService(options = {}) {
  const apiCacheDir = String(options.apiCacheDir || '');
  return {
    searchMusicTracks,
    getMusicHomeContent(registry, body) {
      return getMusicHomeContent(registry, body, apiCacheDir);
    },
    writeMusicPlaylistTracks,
  };
}

async function searchMusicTracks(registry, body) {
  const input = body && typeof body === 'object' ? body : {};
  const platform = normalizeMusicPlatform(input.platform || input.source || 'netease');
  const keyword = cleanText(input.keyword || input.query || input.songName).slice(0, 120);
  if (!keyword) throw createPublicError('缺少搜索关键词。', 501);

  const limit = Math.max(1, Math.min(30, Number(input.limit) || 20));
  const provider = registry.get(platform);
  return {
    source: platform,
    keyword,
    tracks: await provider.searchTracks(keyword, { limit }),
  };
}

async function getMusicHomeContent(registry, body, apiCacheDir = '') {
  const input = body && typeof body === 'object' ? body : {};
  const platform = normalizeMusicPlatform(input.platform || input.source || 'netease');
  const action = cleanText(input.action || 'personalized');
  const limit = Math.max(1, Math.min(5000, Number(input.limit) || 100));
  const offset = Math.max(0, Number(input.offset) || 0);
  const provider = registry.get(platform);
  // 歌单详情由播放器缓存并后台刷新，服务端不再缓存，避免写入后的刷新读到旧内容。
  const cacheable = action === 'personalized';
  const page = Math.max(1, Math.min(50, Number(input.page) || 1));
  const bypassCache = input.refresh === true || page > 1;
  const authorization = cacheable && !bypassCache ? await provider.getSafeCookieHeader() : '';
  const cacheKey =
    cacheable && !bypassCache
      ? musicCacheKey('home', {
          platform,
          action,
          limit,
          playlistId: cleanText(input.playlistId),
          authorization,
        })
      : '';
  if (cacheKey) {
    const cached = readMusicJsonCache(apiCacheDir, cacheKey, MUSIC_API_CACHE_TTL_MS);
    if (cached) return { ...cached, cached: true };
  }

  if (action === 'personalized') {
    const result = {
      source: platform,
      action,
      playlists: await provider.getPersonalizedPlaylists({
        limit: Math.min(limit, 30),
        page,
      }),
    };
    // Credentials only enter the hashed key. Do not cache a result across an account change.
    if (cacheKey && authorization === await provider.getSafeCookieHeader()) {
      writeMusicJsonCache(apiCacheDir, cacheKey, result, MUSIC_API_CACHE_MAX_BYTES);
    }
    return result;
  }
  if (action === 'playlist-tracks') {
    const playlistId = cleanText(input.playlistId);
    if (!playlistId) throw createPublicError('缺少歌单 ID。', 501);
    return {
      source: platform,
      action,
      playlistId,
      tracks: await provider.getPlaylistTracks(playlistId, { limit }),
    };
  }
  if (action === 'daily')
    return {
      source: platform,
      action,
      tracks: await provider.getDailyTracks({ limit, page }),
    };
  if (action === 'radio')
    return {
      source: platform,
      action,
      tracks: await provider.getRadioTracks({ limit, page }),
    };
  if (action === 'liked')
    return {
      source: platform,
      action,
      tracks: await provider.getLikedTracks({ limit, offset, loadingSession: cleanText(input.loadingSession).slice(0, 100) }),
    };
  if (action === 'created-playlists') {
    const playlists = await provider.getCreatedPlaylists({ limit });
    return {
      source: platform,
      action,
      playlists: input.track ? await annotatePlaylistMembership(provider, platform, playlists, input.track) : playlists,
    };
  }
  if (action === 'collected-playlists')
    return {
      source: platform,
      action,
      playlists: await provider.getCollectedPlaylists({ limit }),
    };
  if (action === 'recent')
    return {
      source: platform,
      action,
      tracks: await provider.getRecentTracks({ limit }),
    };

  throw createPublicError('未知音乐首页动作。', 501);
}

async function writeMusicPlaylistTracks(registry, body, operation) {
  const input = body && typeof body === 'object' ? body : {};
  const platform = normalizeMusicPlatform(input.platform || input.source || 'qq');
  const provider = registry.get(platform);
  const playlistInput = input.playlist && typeof input.playlist === 'object' ? input.playlist : {};
  const playlist = {
    id: cleanText(playlistInput.id || playlistInput.tid),
    tid: cleanText(playlistInput.tid || playlistInput.id),
    dirId: cleanText(playlistInput.dirId),
    title: cleanText(playlistInput.title || playlistInput.dirName).slice(0, 200),
  };
  const tracks = Array.isArray(input.tracks) ? input.tracks.slice(0, 100) : [];
  if (tracks.length === 0) throw createPublicError('缺少要修改的音乐歌曲。', 501);
  const method = operation === 'remove' ? 'removeTracksFromPlaylist' : 'addTracksToPlaylist';
  if (typeof provider[method] !== 'function') throw createPublicError('当前音乐 Provider 不支持修改歌单。', 501);
  const result = await provider[method](playlist, tracks);
  clearLikedTracksSessions(provider);
  return { source: platform, operation, playlist, result };
}

async function annotatePlaylistMembership(provider, platform, playlists, track) {
  const trackId = getProviderTrackId(platform, track);
  if (!trackId) throw createPublicError('缺少要检查的歌曲 ID。', 501);
  return mapWithConcurrency(Array.isArray(playlists) ? playlists : [], 6, async (playlist) => {
    try {
      const containsTrack =
        typeof provider.playlistContainsTrack === 'function'
          ? await provider.playlistContainsTrack(playlist.id, track)
          : (await provider.getPlaylistTracks(playlist.id, { limit: 5000 })).some(
              (item) => getProviderTrackId(platform, item) === trackId,
            );
      return {
        ...playlist,
        containsTrack,
      };
    } catch (_) {
      return { ...playlist, containsTrack: null };
    }
  });
}

function getProviderTrackId(platform, track) {
  if (!track || typeof track !== 'object') return '';
  if (platform === 'qq') {
    const sourceSongId = Number(track.sourceSongId);
    if (Number.isSafeInteger(sourceSongId) && sourceSongId > 0) return String(sourceSongId);
    return cleanText(track.sourceTrackId || track.id).replace(/^qq:/, '');
  }
  return cleanText(track.sourceTrackId || track.id).replace(/^netease:/, '');
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = {
  createMusicCatalogService,
  searchMusicTracks,
  getMusicHomeContent,
  writeMusicPlaylistTracks,
};
