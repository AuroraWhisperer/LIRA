'use strict';

const { createPublicError } = require('../../shared/public-error');
const { getLikedTracksSession } = require('./liked-tracks-session');

const { readResponseText } = require('../../shared/response-body');

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function responseLimitError() {
  return Object.assign(createPublicError('网易云音乐响应过大，无法处理。', 501), { code: 'MUSIC_RESPONSE_TOO_LARGE' });
}

const { estimateWordTimings, parseLyricResult } = require('../lyric-parser');
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
const PLAYLIST_DETAIL_BATCH_SIZE = 100;
const MAX_PLAYLIST_READS = 6; // Match the catalog's existing membership fan-out.
const STREAM_TTL_MS = 5 * 60 * 1000;

function assertPlaylistAccount(expected, currentCookie) {
  const cookie = typeof expected === 'object' && expected !== null ? expected.cookie : expected;
  if (cookie !== undefined && cookie !== currentCookie) {
    throw Object.assign(createPublicError('网易云音乐的会话信息已变化，请重新打开歌单。', 501), { code: 'NETEASE_PLAYLIST_ACCOUNT_CHANGED' });
  }
}

function readSearchSongs(data) {
  const code = Number(data?.code);
  if (code !== 200) {
    const message = data && (data.message || data.msg);
    throw Object.assign(new Error(
      `网易云音乐搜索失败（code=${Number.isFinite(code) ? code : 'unknown'}${message ? `，${message}` : ''}）。`,
    ), { statusCode: 501, publicMessage: '网易云音乐搜索失败，请稍后重试。' });
  }
  if (Array.isArray(data.result?.songs)) return data.result.songs;
  if (data.result?.songCount === 0) return [];
  throw createPublicError('网易云音乐搜索响应缺少歌曲结果。', 501);
}

class NeteaseMusicProvider {
  #activePlaylistReads = 0;
  #playlistReadWaiters = [];
  #activeLikedReads = new Set();

  constructor(options = {}) {
    this.source = 'netease';
    this.name = '网易云音乐';
    this.getAuthState = typeof options.getAuthState === 'function' ? options.getAuthState : () => null;
    this.getCookieHeader = typeof options.getCookieHeader === 'function' ? options.getCookieHeader : () => '';
  }

  async healthCheck() {
    const auth = await this.getSafeAuthState();
    try {
      const data = await this.requestJson('/api/search/get/web', {
        s: '晴天',
        type: '1',
        limit: '1',
        offset: '0',
      });
      readSearchSongs(data);
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
    if (!query) throw createPublicError('缺少搜索关键词。', 501);

    const limit = clampInteger(options.limit, 1, 30, 20);
    const offset = clampInteger(options.offset, 0, 300, 0);
    const data = await this.requestJson('/api/search/get/web', {
      s: query,
      type: '1',
      limit: String(limit),
      offset: String(offset),
    });
    return this.mapTracksWithArtwork(readSearchSongs(data));
  }

  async mapTracksWithArtwork(songs, expectedCookie) {
    const list = Array.isArray(songs) ? songs : [];
    const coverUrls = await this.getMissingCoverUrls(list, expectedCookie);
    return list.map((song) => mapNeteaseSong(song, coverUrls.get(String(song && song.id)))).filter(Boolean);
  }

  async getMissingCoverUrls(songs, expectedCookie) {
    const ids = [
      ...new Set(
        (Array.isArray(songs) ? songs : [])
          .filter((song) => {
            const album = song && (song.album || song.al);
            return !String((album && (album.picUrl || album.pic_url)) || '').trim();
          })
          .map((song) => song && song.id)
          .filter((id) => /^\d+$/.test(String(id))),
      ),
    ];
    const coverUrls = new Map();
    for (let index = 0; index < ids.length; index += 100) {
      const batch = ids.slice(index, index + 100);
      try {
        const readCoverBatch = () => this.requestJson('/api/song/detail', { ids: JSON.stringify(batch) }, expectedCookie);
        const data = expectedCookie === undefined ? await readCoverBatch() : await this.#withPlaylistReadSlot(readCoverBatch);
        const detailSongs = data && Array.isArray(data.songs) ? data.songs : [];
        for (const song of detailSongs) {
          const album = song && (song.album || song.al);
          const coverUrl = String((album && (album.picUrl || album.pic_url)) || '').trim();
          if (song && song.id && coverUrl) coverUrls.set(String(song.id), coverUrl);
        }
      } catch (error) {
        if (error?.code === 'NETEASE_PLAYLIST_ACCOUNT_CHANGED') throw error;
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
    const songs = data && data.recommend && Array.isArray(data.recommend) ? data.recommend : [];
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
    const songs = data && Array.isArray(data.result) ? data.result.map((item) => item && (item.song || item)) : [];
    return this.mapTracksWithArtwork(sliceByPage(songs, limit, page));
  }

  async getLikedTracks(options = {}) {
    const scope = { cookie: undefined };
    this.#activeLikedReads.add(scope);
    try {
      const cookie = await this.getSafeCookieHeader();
      assertPlaylistAccount(scope, cookie);
      // Notify older reads, including those still awaiting their first cookie. null stays invalid across A → B → A.
      for (const read of this.#activeLikedReads) {
        if (read.cookie === undefined) read.cookie = cookie;
        else if (read.cookie !== cookie) read.cookie = null;
        if (read === scope) break;
      }
      const session = await getLikedTracksSession(this, options.loadingSession, cookie);
      await this.requireLogin('我喜欢需要先登录网易云音乐。', scope);
      const playlistId = session ? await (session.playlist ||= this.getLikedPlaylistId(scope)) : await this.getLikedPlaylistId(scope);
      const limit = clampInteger(options.limit, 1, 5000, 200);
      const offset = clampInteger(options.offset, 0, 200000, 0);
      return await this.getPlaylistTracks(playlistId, { limit, offset, session, serialDetails: true }, scope);
    } finally {
      this.#activeLikedReads.delete(scope);
    }
  }

  async getLikedPlaylistId(expectedCookie) {
    const profile = await this.getUserProfile(expectedCookie);
    const playlists = await this.getUserPlaylists(profile.userId, {
      limit: 50,
    }, expectedCookie);
    const likedPlaylist = playlists.find((playlist) => /喜欢/.test(playlist.title));
    if (!likedPlaylist) {
      throw createPublicError('没有从网易云音乐读取到“我喜欢”，当前登录凭证不完整或已失效，请重新登录网易云音乐。', 501);
    }
    return likedPlaylist.id;
  }

  async getCreatedPlaylists(options = {}) {
    await this.requireLogin('我的歌单需要先登录网易云音乐。');
    const profile = await this.getUserProfile();
    const playlists = await this.getUserPlaylists(profile.userId, {
      limit: clampInteger(options.limit, 1, 500, 200),
    });
    return playlists.filter((playlist) => playlist.creatorUserId === profile.userId);
  }

  async getCollectedPlaylists(options = {}) {
    await this.requireLogin('收藏歌单需要先登录网易云音乐。');
    const profile = await this.getUserProfile();
    const playlists = await this.getUserPlaylists(profile.userId, {
      limit: clampInteger(options.limit, 1, 500, 200),
    });
    return playlists.filter((playlist) => playlist.creatorUserId !== profile.userId);
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

  async #withPlaylistReadSlot(read) {
    if (this.#activePlaylistReads < MAX_PLAYLIST_READS) {
      this.#activePlaylistReads++;
    } else {
      await new Promise(resolve => this.#playlistReadWaiters.push(resolve));
    }
    try {
      return await read();
    } finally {
      const next = this.#playlistReadWaiters.shift();
      if (next) next(); // Transfer this slot directly to the oldest waiter.
      else this.#activePlaylistReads--;
    }
  }

  async #withPlaylistAccount(read, expectedCookie) {
    const cookie = expectedCookie ?? await this.getSafeCookieHeader();
    const result = await read(cookie);
    assertPlaylistAccount(cookie, await this.getSafeCookieHeader());
    return result;
  }

  #readPlaylistIndex(id, cookie) {
    return this.#withPlaylistReadSlot(() => this.requestJson('/api/v6/playlist/detail', { id, n: '0', s: '0' }, cookie));
  }

  async getPlaylistTracks(playlistId, options = {}, expectedCookie) {
    const id = String(playlistId || '').trim();
    if (!id) throw createPublicError('缺少网易云歌单 ID。', 501);
    return this.#withPlaylistAccount(cookie => this.#readPlaylistTracks(id, options, cookie), expectedCookie);
  }

  async #readPlaylistTracks(id, options, cookie) {
    const limit = clampInteger(options.limit, 1, 5000, 1000);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const data = options.session
      ? await (options.session.playlistDetails ||= this.#readPlaylistIndex(id, cookie))
      : await this.#readPlaylistIndex(id, cookie);
    const playlist = data?.playlist || {};
    if (!Array.isArray(playlist.trackIds)) {
      const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
      if (Number(playlist.trackCount) > tracks.length) throw createPublicError('网易云歌单未返回完整曲目索引，请重试。', 501);
      return this.mapTracksWithArtwork(tracks.slice(offset, offset + limit), cookie);
    }
    if (Number(playlist.trackCount) > playlist.trackIds.length) throw createPublicError('网易云歌单未返回完整曲目索引，请重试。', 501);
    const ids = playlist.trackIds.slice(offset, offset + limit).map((item) => String(item?.id ?? item));
    if (ids.some((trackId) => !/^\d+$/.test(trackId))) throw createPublicError('网易云歌单曲目 ID 无效。', 501);
    const uniqueIds = [...new Set(ids)];
    const songs = new Map();
    let index = 0;
    const readNextBatch = async () => {
      const batch = uniqueIds.slice(index, index + PLAYLIST_DETAIL_BATCH_SIZE);
      index += batch.length;
      const detail = await this.requestJson('/api/song/detail', { ids: JSON.stringify(batch) }, cookie);
      const byId = new Map((Array.isArray(detail?.songs) ? detail.songs : []).map(song => [String(song.id), song]));
      for (const trackId of batch) {
        if (!byId.has(trackId)) throw createPublicError('网易云歌单部分曲目未返回，加载未完成，请重试。', 501);
        songs.set(trackId, byId.get(trackId));
      }
    };
    while (index < uniqueIds.length) {
      const first = this.#withPlaylistReadSlot(readNextBatch);
      if (options.serialDetails || index === uniqueIds.length || this.#activePlaylistReads === MAX_PLAYLIST_READS) {
        await first;
        continue;
      }
      // Each batch releases its own slot. This open waits for both before starting another pair.
      const pair = await Promise.allSettled([first, this.#withPlaylistReadSlot(readNextBatch)]);
      const failed = pair.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    // These songs already came from /api/song/detail, including its best available artwork.
    return ids.map((trackId) => mapNeteaseSong(songs.get(trackId))).filter(Boolean);
  }

  async playlistContainsTrack(playlistId, track) {
    const id = String(playlistId || '').trim();
    if (!/^\d+$/.test(id)) throw createPublicError('缺少网易云歌单 ID。', 501);
    const trackId = extractSourceTrackId(track);
    return this.#withPlaylistAccount(cookie => this.#playlistContainsTrack(id, trackId, cookie));
  }

  async #playlistContainsTrack(id, trackId, cookie) {
    const data = await this.#readPlaylistIndex(id, cookie);
    const { trackIds, tracks, trackCount } = data?.playlist || {};
    if (Array.isArray(trackIds)) {
      return trackIds.some((item) => String(item && (item.id || item)) === trackId);
    }
    if (Array.isArray(tracks) && Number.isSafeInteger(trackCount) && trackCount >= 0 && tracks.length >= trackCount) {
      return tracks.slice(0, 5000).some((song) => song?.name && String(song.id || '').trim() === trackId);
    }
    const recoveredTracks = await this.#readPlaylistTracks(id, { limit: 5000, serialDetails: true }, cookie);
    return recoveredTracks.some((item) => extractSourceTrackId(item) === trackId);
  }

  async getUserPlaylists(userId, options = {}, expectedCookie) {
    const uid = String(userId || '').trim();
    if (!uid) throw createPublicError('缺少网易云用户 ID。', 501);
    const limit = clampInteger(options.limit, 1, 500, 200);
    const data = await this.requestJson('/api/user/playlist', {
      uid,
      limit: String(limit),
      offset: '0',
    }, expectedCookie);
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
    const requestedId = String((playlist && playlist.id) || '').trim();
    const playlistId = requestedId === 'liked' ? String(await this.getLikedPlaylistId()) : requestedId;
    if (!/^\d+$/.test(playlistId)) throw createPublicError('缺少网易云歌单 ID。', 501);
    const trackIds = normalizeNeteasePlaylistTrackIds(tracks);
    const data = await this.requestWeapiJson('/weapi/playlist/manipulate/tracks', {
      op: operation,
      pid: playlistId,
      trackIds: JSON.stringify(trackIds),
      imme: 'true',
      tracks: JSON.stringify(trackIds.map((id) => ({ type: 3, id }))),
    });
    const code = Number(data && data.code);
    if (operation === 'add' && code === 502) {
      return {
        playlistId,
        songlist: trackIds.map((songId) => ({ songId, existed: 1 })),
      };
    }
    if (code !== 200) {
      const message = data && (data.message || data.msg);
      throw Object.assign(new Error(
        `网易云音乐歌单写入失败（code=${Number.isFinite(code) ? code : 'unknown'}${message ? `，${message}` : ''}）。`,
      ), { statusCode: 501, publicMessage: '网易云音乐歌单写入失败，请稍后重试。' });
    }
    return {
      playlistId,
      songlist: trackIds.map((songId) => ({ songId, existed: 0 })),
    };
  }

  async getLyrics(track) {
    const sourceTrackId = extractSourceTrackId(track);
    const data = await this.requestJson('/api/song/lyric/v1', {
      id: sourceTrackId,
      cp: 'false',
      lv: '0',
      kv: '0',
      tv: '0',
      rv: '0',
      yv: '0',
      ytv: '0',
      yrv: '0',
    });
    // YRC and LRC can describe different line boundaries. Use YRC's own anchors
    // and alternates instead of attaching its words by exact LRC timestamps.
    const wordLines = parseLyricResult('', data?.ytlrc?.lyric || data?.tlyric?.lyric || '',
      data?.yrc?.lyric || '', data?.yromalrc?.lyric || data?.romalrc?.lyric || '');
    const lines = wordLines.length ? wordLines : parseLyricResult(
      data?.lrc?.lyric || '', data?.tlyric?.lyric || '', '', data?.romalrc?.lyric || '');
    return {
      source: this.source,
      sourceTrackId,
      lines: estimateWordTimings(lines, track.durationMs),
    };
  }

  async resolvePlayableUrl(track, options = {}) {
    const sourceTrackId = extractSourceTrackId(track);
    if (!/^\d+$/.test(sourceTrackId)) throw createPublicError('网易云歌曲 ID 必须是正整数。', 501);
    const supportedLevels = new Set(['standard', 'higher', 'exhigh', 'lossless', 'hires']);
    const requestedQuality = supportedLevels.has(options.quality) ? options.quality : 'standard';
    const encodeType = requestedQuality === 'lossless' || requestedQuality === 'hires' ? 'flac' : 'mp3';

    const payload = await this.requestJson('/api/song/enhance/player/url/v1', {
      ids: JSON.stringify([Number(sourceTrackId)]),
      level: requestedQuality,
      encodeType,
    });
    const stream = payload && Array.isArray(payload.data) ? payload.data[0] : null;
    const streamUrl = String((stream && stream.url) || '').trim();
    if (!streamUrl) {
      throw createPublicError('当前网易云音乐账号无法播放或试听该歌曲。', 501);
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(streamUrl);
    } catch (_) {
      throw createPublicError('网易云音乐返回的播放地址无效。', 501);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw createPublicError('网易云音乐返回的播放地址无效。', 501);
    }

    const expiresInSeconds = Number(stream.expi);
    const expiresAt =
      Date.now() +
      (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : STREAM_TTL_MS);
    const trialInfo = stream.freeTrialInfo && typeof stream.freeTrialInfo === 'object' ? stream.freeTrialInfo : null;
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

  async requestJson(pathname, params = {}, expectedCookie) {
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
    assertPlaylistAccount(expectedCookie, cookieHeader);
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await readResponseText(response, MAX_RESPONSE_BYTES, responseLimitError);
    if (typeof expectedCookie === 'object') assertPlaylistAccount(expectedCookie, await this.getSafeCookieHeader());
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
    const text = await readResponseText(response, MAX_RESPONSE_BYTES, responseLimitError);
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

  async requireLogin(message, expectedCookie) {
    const auth = await this.getSafeAuthState();
    if (expectedCookie !== undefined) assertPlaylistAccount(expectedCookie, await this.getSafeCookieHeader());
    if (!auth || !auth.loggedIn) {
      throw createPublicError(message || '需要先登录网易云音乐。', 501);
    }
    return auth;
  }

  async getUserProfile(expectedCookie) {
    const data = await this.requestJson('/api/nuser/account/get', {}, expectedCookie);
    const profile = data && data.profile ? data.profile : null;
    const userId = profile && profile.userId ? String(profile.userId) : '';
    if (!userId) throw createPublicError('未能读取网易云用户资料，请重新登录后再试。', 501);
    return {
      userId,
      nickname: profile.nickname || '',
    };
  }
}

module.exports = {
  NeteaseMusicProvider,
};
