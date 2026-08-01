'use strict';

const { parseLyricResult } = require('../lyrics');

const NETEASE_BASE_URL = 'https://music.163.com';
const REQUEST_TIMEOUT_MS = 10000;
const STREAM_TTL_MS = 5 * 60 * 1000;

class NeteaseMusicProvider {
  constructor(options = {}) {
    this.source = 'netease';
    this.name = '网易云音乐';
    this.getAuthState = typeof options.getAuthState === 'function'
      ? options.getAuthState
      : () => null;
    this.getCookieHeader = typeof options.getCookieHeader === 'function'
      ? options.getCookieHeader
      : () => '';
  }

  async healthCheck() {
    const auth = await this.getSafeAuthState();
    try {
      await this.requestJson('/api/search/get/web', {
        s: '晴天',
        type: '1',
        limit: '1',
        offset: '0'
      });
      const loggedIn = Boolean(auth && auth.loggedIn);
      return {
        source: this.source,
        name: this.name,
        ok: true,
        status: loggedIn ? 'logged-in' : 'public-ok',
        message: loggedIn
          ? '网易云音乐接口可用，已读取登录 Cookie。'
          : '网易云音乐公开搜索接口可用，未检测到登录 Cookie。',
        auth: sanitizeAuthState(auth)
      };
    } catch (error) {
      return {
        source: this.source,
        name: this.name,
        ok: false,
        status: 'api-error',
        message: `网易云音乐接口检查失败：${error.message || String(error)}`,
        auth: sanitizeAuthState(auth)
      };
    }
  }

  async searchTracks(keyword, options = {}) {
    const query = String(keyword || '').trim();
    if (!query) throw new Error('缺少搜索关键词。');

    const limit = clampInteger(options.limit, 1, 30, 20);
    const offset = clampInteger(options.offset, 0, 300, 0);
    const data = await this.requestJson('/api/search/get/web', {
      s: query,
      type: '1',
      limit: String(limit),
      offset: String(offset)
    });
    const songs = data && data.result && Array.isArray(data.result.songs)
      ? data.result.songs
      : [];
    // 搜索 API 不返回 album.picUrl，封面回退到 artist.img1v1Url
    // 无需额外网络请求，零后端负荷
    return songs.map(mapNeteaseSong).filter(Boolean);
  }

  async getPersonalizedPlaylists(options = {}) {
    const limit = clampInteger(options.limit, 1, 30, 9);
    const data = await this.requestJson('/api/personalized/playlist', {
      limit: String(limit)
    });
    const playlists = data && Array.isArray(data.result) ? data.result : [];
    return playlists.map(mapNeteasePlaylist).filter(Boolean);
  }

  async getDailyTracks(options = {}) {
    await this.requireLogin('每日推荐需要先登录网易云音乐。');
    const limit = clampInteger(options.limit, 1, 100, 30);
    const page = clampInteger(options.page, 1, 50, 1);
    const data = await this.requestJson('/api/v1/discovery/recommend/songs');
    const songs = data && data.recommend && Array.isArray(data.recommend)
      ? data.recommend
      : [];
    // 网易云每日推荐是「当天固定一份」，接口不分页。这里按 page 开窗口往后取，
    // 取完就绕回开头 —— 换一批只能在当天这份列表里换，不会有全新的歌。
    return sliceByPage(songs, limit, page).map(mapNeteaseSong).filter(Boolean);
  }

  async getRadioTracks(options = {}) {
    const limit = clampInteger(options.limit, 1, 50, 20);
    const page = clampInteger(options.page, 1, 50, 1);
    // newsong 接口忽略 offset，但支持 limit 到 100，所以一次多拿再按 page 切窗口。
    const data = await this.requestJson('/api/personalized/newsong', {
      limit: '100'
    });
    const songs = data && Array.isArray(data.result)
      ? data.result.map((item) => item && (item.song || item))
      : [];
    return sliceByPage(songs, limit, page).map(mapNeteaseSong).filter(Boolean);
  }

  async getLikedTracks(options = {}) {
    await this.requireLogin('我喜欢需要先登录网易云音乐。');
    const limit = clampInteger(options.limit, 1, 5000, 200);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const profile = await this.getUserProfile();
    const playlists = await this.getUserPlaylists(profile.userId, { limit: 50 });
    const likedPlaylist = playlists.find((playlist) => /喜欢/.test(playlist.title))
      || playlists[0];
    if (!likedPlaylist) return [];
    return this.getPlaylistTracks(likedPlaylist.id, { limit, offset });
  }

  async getCreatedPlaylists(options = {}) {
    await this.requireLogin('我的歌单需要先登录网易云音乐。');
    const profile = await this.getUserProfile();
    const playlists = await this.getUserPlaylists(profile.userId, {
      limit: clampInteger(options.limit, 1, 500, 200)
    });
    return playlists.filter((playlist) => playlist.creatorUserId === profile.userId);
  }

  async getCollectedPlaylists(options = {}) {
    await this.requireLogin('收藏歌单需要先登录网易云音乐。');
    const profile = await this.getUserProfile();
    const playlists = await this.getUserPlaylists(profile.userId, {
      limit: clampInteger(options.limit, 1, 500, 200)
    });
    return playlists.filter((playlist) => playlist.creatorUserId !== profile.userId);
  }

  async getRecentTracks(options = {}) {
    await this.requireLogin('最近播放需要先登录网易云音乐。');
    const limit = clampInteger(options.limit, 1, 100, 50);
    const data = await this.requestJson('/api/play-record', {
      uid: (await this.getUserProfile()).userId,
      type: '1'
    });
    const rows = data && Array.isArray(data.weekData)
      ? data.weekData
      : [];
    return rows
      .map((row) => row && row.song)
      .filter(Boolean)
      .slice(0, limit)
      .map(mapNeteaseSong)
      .filter(Boolean);
  }

  async getPlaylistTracks(playlistId, options = {}) {
    const id = String(playlistId || '').trim();
    if (!id) throw new Error('缺少网易云歌单 ID。');
    const limit = clampInteger(options.limit, 1, 5000, 1000);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const data = await this.requestJson('/api/v6/playlist/detail', {
      id,
      n: String(limit),
      s: '0'
    });
    const tracks = data && data.playlist && Array.isArray(data.playlist.tracks)
      ? data.playlist.tracks
      : [];
    return tracks.slice(offset, offset + limit).map(mapNeteaseSong).filter(Boolean);
  }

  async getUserPlaylists(userId, options = {}) {
    const uid = String(userId || '').trim();
    if (!uid) throw new Error('缺少网易云用户 ID。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const data = await this.requestJson('/api/user/playlist', {
      uid,
      limit: String(limit),
      offset: '0'
    });
    const playlists = data && Array.isArray(data.playlist) ? data.playlist : [];
    return playlists.map(mapNeteasePlaylist).filter(Boolean);
  }

  async getLyrics(track) {
    const sourceTrackId = extractSourceTrackId(track);
    const data = await this.requestJson('/api/song/lyric', {
      id: sourceTrackId,
      lv: '-1',
      kv: '-1',
      tv: '-1',
      ytv: '-1'
    });
    return {
      source: this.source,
      sourceTrackId,
      lines: parseLyricResult(
        data && data.lrc ? data.lrc.lyric : '',
        data && data.tlyric ? data.tlyric.lyric : '',
        data && data.yrc ? data.yrc.lyric : '',
        data && data.romalrc ? data.romalrc.lyric : ''
      )
    };
  }

  async resolvePlayableUrl(track) {
    const sourceTrackId = extractSourceTrackId(track);
    const expiresAt = Date.now() + STREAM_TTL_MS;
    return {
      source: this.source,
      sourceTrackId,
      url: `${NETEASE_BASE_URL}/song/media/outer/url?id=${encodeURIComponent(sourceTrackId)}.mp3`,
      expireAt: expiresAt,
      playUrlExpireAt: expiresAt
    };
  }

  async requestJson(pathname, params = {}) {
    const url = new URL(pathname, NETEASE_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const headers = {
      Accept: 'application/json,text/plain,*/*',
      Referer: `${NETEASE_BASE_URL}/`,
      'User-Agent': 'Mozilla/5.0 SongAssistant/1.0'
    };
    const cookieHeader = await this.getSafeCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error(`网易云音乐返回了非 JSON 响应：${error.message}`);
    }
  }

  async getSafeAuthState() {
    try {
      return await this.getAuthState(this.source);
    } catch (_) {
      return null;
    }
  }

  async getSafeCookieHeader() {
    try {
      return String(await this.getCookieHeader(this.source) || '');
    } catch (_) {
      return '';
    }
  }

  async requireLogin(message) {
    const auth = await this.getSafeAuthState();
    if (!auth || !auth.loggedIn) {
      throw new Error(message || '需要先登录网易云音乐。');
    }
    return auth;
  }

  async getUserProfile() {
    const data = await this.requestJson('/api/nuser/account/get');
    const profile = data && data.profile ? data.profile : null;
    const userId = profile && profile.userId ? String(profile.userId) : '';
    if (!userId) throw new Error('未能读取网易云用户资料，请重新登录后再试。');
    return {
      userId,
      nickname: profile.nickname || ''
    };
  }
}

function mapNeteaseSong(song) {
  if (!song || !song.id || !song.name) return null;
  const album = song.album || song.al || {};
  const artists = Array.isArray(song.artists)
    ? song.artists
    : (Array.isArray(song.ar) ? song.ar : []);
  const sourceTrackId = String(song.id);

  // 封面来源优先级：
  // 1. 专辑 picUrl（歌单/推荐等接口有，搜索接口没有）
  // 2. 第一位艺术家的头像（搜索接口始终返回，零额外网络请求）
  var coverUrl = String(album && (album.picUrl || album.pic_url) || '');
  if (!coverUrl && artists.length > 0) {
    coverUrl = String(artists[0].img1v1Url || '');
  }

  return {
    id: `netease:${sourceTrackId}`,
    source: 'netease',
    sourceTrackId,
    sourceAlbumId: album && album.id ? String(album.id) : '',
    title: String(song.name || '').trim(),
    artists: artists.map((artist) => String(artist && artist.name || '').trim()).filter(Boolean),
    album: String(album && album.name || '').trim(),
    durationMs: Math.max(0, Number(song.duration || song.dt || 0)),
    coverUrl: coverUrl,
    playable: song.status !== -1,
    vip: Number(song.fee) === 1 || Number(song.fee) === 4
  };
}

function mapNeteasePlaylist(playlist) {
  if (!playlist || !playlist.id || !playlist.name) return null;
  return {
    id: String(playlist.id),
    source: 'netease',
    title: String(playlist.name || '').trim(),
    description: String(playlist.copywriter || playlist.description || '').trim(),
    coverUrl: String(playlist.picUrl || playlist.coverImgUrl || ''),
    trackCount: Math.max(0, Number(playlist.trackCount || 0)),
    playCount: Math.max(0, Number(playlist.playCount || 0)),
    creatorUserId: playlist.creator && playlist.creator.userId ? String(playlist.creator.userId) : ''
  };
}

function extractSourceTrackId(track) {
  const sourceTrackId = String(track && (track.sourceTrackId || track.id) || '')
    .replace(/^netease:/, '')
    .trim();
  if (!sourceTrackId) throw new Error('缺少网易云歌曲 ID。');
  return sourceTrackId;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

// 从固定长度的列表里按页取一段，超出末尾就绕回开头，保证永远有内容返回。
function sliceByPage(list, limit, page) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return [];
  if (items.length <= limit) return items.slice(0, limit);
  const start = ((page - 1) * limit) % items.length;
  const window = items.slice(start, start + limit);
  if (window.length >= limit) return window;
  return window.concat(items.slice(0, limit - window.length));
}

function sanitizeAuthState(auth) {
  return {
    loggedIn: Boolean(auth && auth.loggedIn),
    cookieCount: Number(auth && auth.cookieCount) || 0,
    keyCookieNames: Array.isArray(auth && auth.keyCookieNames) ? auth.keyCookieNames : [],
    encryptedSnapshotExists: Boolean(auth && auth.encryptedSnapshotExists),
    lastSavedAt: auth && auth.lastSavedAt ? auth.lastSavedAt : ''
  };
}

module.exports = {
  NeteaseMusicProvider
};
