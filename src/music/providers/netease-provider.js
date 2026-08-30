'use strict';

const { parseLyricResult } = require('../lyrics');
const { encryptNeteaseWeapiPayload } = require('./netease-weapi');
const {
  clampInteger,
  extractCookieValue,
  extractSourceTrackId,
  mapNeteasePlaylist,
  mapNeteaseSong,
  normalizeNeteasePlaylistTrackIds,
  normalizeTrialTimeMs,
  sanitizeAuthState,
  sliceByPage,
} = require('./netease-mappers');

const NETEASE_BASE_URL = 'https://music.163.com';
const REQUEST_TIMEOUT_MS = 10000;
const STREAM_TTL_MS = 5 * 60 * 1000;

class NeteaseMusicProvider {
  constructor(options = {}) {
    this.source = 'netease';
    this.name = '网易云音乐';
    this.getAuthState =
      typeof options.getAuthState === 'function'
        ? options.getAuthState
        : () => null;
    this.getCookieHeader =
      typeof options.getCookieHeader === 'function'
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
        offset: '0',
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
        auth: sanitizeAuthState(auth),
      };
    } catch (error) {
      return {
        source: this.source,
        name: this.name,
        ok: false,
        status: 'api-error',
        message: `网易云音乐接口检查失败：${error.message || String(error)}`,
        auth: sanitizeAuthState(auth),
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
      offset: String(offset),
    });
    const songs =
      data && data.result && Array.isArray(data.result.songs)
        ? data.result.songs
        : [];
    return this.mapTracksWithArtwork(songs);
  }

  async mapTracksWithArtwork(songs) {
    const list = Array.isArray(songs) ? songs : [];
    const coverUrls = await this.getMissingCoverUrls(list);
    return list
      .map((song) =>
        mapNeteaseSong(song, coverUrls.get(String(song && song.id))),
      )
      .filter(Boolean);
  }

  async getMissingCoverUrls(songs) {
    const ids = [
      ...new Set(
        (Array.isArray(songs) ? songs : [])
          .filter((song) => {
            const album = song && (song.album || song.al);
            return !String(
              (album && (album.picUrl || album.pic_url)) || '',
            ).trim();
          })
          .map((song) => song && song.id)
          .filter((id) => /^\d+$/.test(String(id))),
      ),
    ];
    const coverUrls = new Map();
    for (let index = 0; index < ids.length; index += 100) {
      const batch = ids.slice(index, index + 100);
      try {
        const data = await this.requestJson('/api/song/detail', {
          ids: JSON.stringify(batch),
        });
        const detailSongs = data && Array.isArray(data.songs) ? data.songs : [];
        for (const song of detailSongs) {
          const album = song && (song.album || song.al);
          const coverUrl = String(
            (album && (album.picUrl || album.pic_url)) || '',
          ).trim();
          if (song && song.id && coverUrl)
            coverUrls.set(String(song.id), coverUrl);
        }
      } catch (_) {
        // Preserve list results when one detail batch is unavailable.
      }
    }
    return coverUrls;
  }

  async getPersonalizedPlaylists(options = {}) {
    const limit = clampInteger(options.limit, 1, 30, 9);
    const data = await this.requestJson('/api/personalized/playlist', {
      limit: String(limit),
    });
    const playlists = data && Array.isArray(data.result) ? data.result : [];
    return playlists.map(mapNeteasePlaylist).filter(Boolean);
  }

  async getDailyTracks(options = {}) {
    await this.requireLogin('每日推荐需要先登录网易云音乐。');
    const limit = clampInteger(options.limit, 1, 100, 30);
    const page = clampInteger(options.page, 1, 50, 1);
    const data = await this.requestJson('/api/v1/discovery/recommend/songs');
    const songs =
      data && data.recommend && Array.isArray(data.recommend)
        ? data.recommend
        : [];
    // 网易云每日推荐是「当天固定一份」，接口不分页。这里按 page 开窗口往后取，
    // 取完就绕回开头 —— 换一批只能在当天这份列表里换，不会有全新的歌。
    return this.mapTracksWithArtwork(sliceByPage(songs, limit, page));
  }

  async getRadioTracks(options = {}) {
    const limit = clampInteger(options.limit, 1, 50, 20);
    const page = clampInteger(options.page, 1, 50, 1);
    // newsong 接口忽略 offset，但支持 limit 到 100，所以一次多拿再按 page 切窗口。
    const data = await this.requestJson('/api/personalized/newsong', {
      limit: '100',
    });
    const songs =
      data && Array.isArray(data.result)
        ? data.result.map((item) => item && (item.song || item))
        : [];
    return this.mapTracksWithArtwork(sliceByPage(songs, limit, page));
  }

  async getLikedTracks(options = {}) {
    await this.requireLogin('我喜欢需要先登录网易云音乐。');
    const limit = clampInteger(options.limit, 1, 5000, 200);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const profile = await this.getUserProfile();
    const playlists = await this.getUserPlaylists(profile.userId, {
      limit: 50,
    });
    const likedPlaylist = playlists.find((playlist) =>
      /喜欢/.test(playlist.title),
    );
    if (!likedPlaylist) {
      throw new Error(
        '没有从网易云音乐读取到“我喜欢”，当前登录凭证不完整或已失效，请重新登录网易云音乐。',
      );
    }
    return this.getPlaylistTracks(likedPlaylist.id, { limit, offset });
  }

  async getCreatedPlaylists(options = {}) {
    await this.requireLogin('我的歌单需要先登录网易云音乐。');
    const profile = await this.getUserProfile();
    const playlists = await this.getUserPlaylists(profile.userId, {
      limit: clampInteger(options.limit, 1, 500, 200),
    });
    return playlists.filter(
      (playlist) => playlist.creatorUserId === profile.userId,
    );
  }

  async getCollectedPlaylists(options = {}) {
    await this.requireLogin('收藏歌单需要先登录网易云音乐。');
    const profile = await this.getUserProfile();
    const playlists = await this.getUserPlaylists(profile.userId, {
      limit: clampInteger(options.limit, 1, 500, 200),
    });
    return playlists.filter(
      (playlist) => playlist.creatorUserId !== profile.userId,
    );
  }

  async getRecentTracks(options = {}) {
    await this.requireLogin('最近播放需要先登录网易云音乐。');
    const limit = clampInteger(options.limit, 1, 100, 50);
    const data = await this.requestJson('/api/play-record', {
      uid: (await this.getUserProfile()).userId,
      type: '1',
    });
    const rows = data && Array.isArray(data.weekData) ? data.weekData : [];
    return this.mapTracksWithArtwork(
      rows
        .map((row) => row && row.song)
        .filter(Boolean)
        .slice(0, limit),
    );
  }

  async getPlaylistTracks(playlistId, options = {}) {
    const id = String(playlistId || '').trim();
    if (!id) throw new Error('缺少网易云歌单 ID。');
    const limit = clampInteger(options.limit, 1, 5000, 1000);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const data = await this.requestJson('/api/v6/playlist/detail', {
      id,
      n: String(limit),
      s: String(offset),
    });
    const tracks =
      data && data.playlist && Array.isArray(data.playlist.tracks)
        ? data.playlist.tracks
        : [];
    return this.mapTracksWithArtwork(tracks);
  }

  async playlistContainsTrack(playlistId, track) {
    const id = String(playlistId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('缺少网易云歌单 ID。');
    const trackId = extractSourceTrackId(track);
    const data = await this.requestJson('/api/v6/playlist/detail', {
      id,
      n: '0',
      s: '0',
    });
    const trackIds =
      data && data.playlist && Array.isArray(data.playlist.trackIds)
        ? data.playlist.trackIds
        : null;
    if (trackIds) {
      return trackIds.some(
        (item) => String(item && (item.id || item)) === trackId,
      );
    }
    const tracks = await this.getPlaylistTracks(id, { limit: 5000 });
    return tracks.some((item) => extractSourceTrackId(item) === trackId);
  }

  async getUserPlaylists(userId, options = {}) {
    const uid = String(userId || '').trim();
    if (!uid) throw new Error('缺少网易云用户 ID。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const data = await this.requestJson('/api/user/playlist', {
      uid,
      limit: String(limit),
      offset: '0',
    });
    const playlists = data && Array.isArray(data.playlist) ? data.playlist : [];
    return playlists.map(mapNeteasePlaylist).filter(Boolean);
  }

  async addTracksToPlaylist(playlist, tracks) {
    return this.writePlaylistTracks('add', playlist, tracks);
  }

  async removeTracksFromPlaylist(playlist, tracks) {
    return this.writePlaylistTracks('del', playlist, tracks);
  }

  async writePlaylistTracks(operation, playlist, tracks) {
    await this.requireLogin('修改网易云音乐歌单需要先登录。');
    const playlistId = String((playlist && playlist.id) || '').trim();
    if (!/^\d+$/.test(playlistId)) throw new Error('缺少网易云歌单 ID。');
    const trackIds = normalizeNeteasePlaylistTrackIds(tracks);
    const data = await this.requestWeapiJson(
      '/weapi/playlist/manipulate/tracks',
      {
        op: operation,
        pid: playlistId,
        trackIds: JSON.stringify(trackIds),
        imme: 'true',
        tracks: JSON.stringify(trackIds.map((id) => ({ type: 3, id }))),
      },
    );
    const code = Number(data && data.code);
    if (operation === 'add' && code === 502) {
      return {
        playlistId,
        songlist: trackIds.map((songId) => ({ songId, existed: 1 })),
      };
    }
    if (code !== 200) {
      const message = data && (data.message || data.msg);
      throw new Error(
        `网易云音乐歌单写入失败（code=${Number.isFinite(code) ? code : 'unknown'}${message ? `，${message}` : ''}）。`,
      );
    }
    return {
      playlistId,
      songlist: trackIds.map((songId) => ({ songId, existed: 0 })),
    };
  }

  async getLyrics(track) {
    const sourceTrackId = extractSourceTrackId(track);
    const data = await this.requestJson('/api/song/lyric', {
      id: sourceTrackId,
      lv: '-1',
      kv: '-1',
      tv: '-1',
      rv: '-1',
      ytv: '-1',
    });
    return {
      source: this.source,
      sourceTrackId,
      lines: parseLyricResult(
        data && data.lrc ? data.lrc.lyric : '',
        data && data.tlyric ? data.tlyric.lyric : '',
        data && data.yrc ? data.yrc.lyric : '',
        data && data.romalrc ? data.romalrc.lyric : '',
      ),
    };
  }

  async resolvePlayableUrl(track, options = {}) {
    const sourceTrackId = extractSourceTrackId(track);
    if (!/^\d+$/.test(sourceTrackId))
      throw new Error('网易云歌曲 ID 必须是正整数。');
    const supportedLevels = new Set([
      'standard',
      'higher',
      'exhigh',
      'lossless',
      'hires',
    ]);
    const requestedQuality = supportedLevels.has(options.quality)
      ? options.quality
      : 'standard';
    const encodeType =
      requestedQuality === 'lossless' || requestedQuality === 'hires'
        ? 'flac'
        : 'mp3';

    const payload = await this.requestJson('/api/song/enhance/player/url/v1', {
      ids: JSON.stringify([Number(sourceTrackId)]),
      level: requestedQuality,
      encodeType,
    });
    const stream =
      payload && Array.isArray(payload.data) ? payload.data[0] : null;
    const streamUrl = String((stream && stream.url) || '').trim();
    if (!streamUrl) {
      throw new Error('当前网易云音乐账号无法播放或试听该歌曲。');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(streamUrl);
    } catch (_) {
      throw new Error('网易云音乐返回的播放地址无效。');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('网易云音乐返回的播放地址无效。');
    }

    const expiresInSeconds = Number(stream.expi);
    const expiresAt =
      Date.now() +
      (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? expiresInSeconds * 1000
        : STREAM_TTL_MS);
    const trialInfo =
      stream.freeTrialInfo && typeof stream.freeTrialInfo === 'object'
        ? stream.freeTrialInfo
        : null;
    return {
      source: this.source,
      sourceTrackId,
      url: parsedUrl.href,
      expireAt: expiresAt,
      playUrlExpireAt: expiresAt,
      trial: Boolean(trialInfo),
      trialStartMs: normalizeTrialTimeMs(trialInfo && trialInfo.start),
      trialEndMs: normalizeTrialTimeMs(trialInfo && trialInfo.end),
      requestedQuality,
      quality: String(stream.level || requestedQuality),
      level: String(stream.level || ''),
      type: String(stream.type || stream.encodeType || ''),
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
      'User-Agent': 'Mozilla/5.0 SongAssistant/1.0',
    };
    const cookieHeader = await this.getSafeCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

  async requestWeapiJson(pathname, payload) {
    const cookieHeader = await this.getSafeCookieHeader();
    const csrfToken = extractCookieValue(cookieHeader, '__csrf');
    const encrypted = encryptNeteaseWeapiPayload({
      ...payload,
      csrf_token: csrfToken,
    });
    const url = new URL(pathname, NETEASE_BASE_URL);
    url.searchParams.set('csrf_token', csrfToken);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader,
        Origin: NETEASE_BASE_URL,
        Referer: `${NETEASE_BASE_URL}/`,
        'User-Agent': 'Mozilla/5.0 SongAssistant/1.0',
      },
      body: new URLSearchParams(encrypted).toString(),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
      return String((await this.getCookieHeader(this.source)) || '');
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
      nickname: profile.nickname || '',
    };
  }
}

module.exports = {
  NeteaseMusicProvider,
};
