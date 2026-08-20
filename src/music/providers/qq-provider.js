'use strict';

const crypto = require('node:crypto');
const { parseLyricResult } = require('../lyrics');
const { QQMusicClient } = require('./qq-provider-client');
const {
  buildGuid,
  calcQQGtk,
  clampInteger,
  decodeQQBase64,
  decodeQQPlayableLyric,
  extractQQGtkSource,
  extractRadioSongs,
  extractSourceSongId,
  extractSourceTrackId,
  extractUin,
  hasQQMusicAuthCookie,
  mapQQPlaylist,
  mapQQSong,
  mapRecommendCard,
  normalizeQQPlaylistSongInfo,
  normalizeQQPlaylistWriteTarget,
  normalizeQQSongType,
  readQQModuleData,
  sanitizeAuthState
} = require('./qq-provider-utils');

const QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const QQ_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const QQ_PLAYLIST_DETAIL_URL = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
const QQ_CREATED_PLAYLIST_URL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss';
const QQ_COLLECTED_ASSET_URL = 'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg';
const STREAM_TTL_MS = 5 * 60 * 1000;
const QQ_STREAM_QUALITIES = {
  standard: { prefix: 'M500', extension: 'mp3' },
  high: { prefix: 'M800', extension: 'mp3' },
  lossless: { prefix: 'F000', extension: 'flac' }
};
const QQ_STREAM_FALLBACKS = {
  standard: ['standard'],
  high: ['high', 'standard'],
  lossless: ['lossless', 'high', 'standard']
};
const QQ_ENCRYPTED_QUALITIES = {
  premium: { family: 'Q0', extension: 'mflac', contentType: 'audio/flac' },
  immersive: { family: 'O8', extension: 'mgg', contentType: 'audio/ogg' }
};

function identifyQQStreamQuality(value, fallback) {
  const text = String(value || '');
  if (text.includes('F000')) return 'lossless';
  if (text.includes('M800')) return 'high';
  if (text.includes('M500')) return 'standard';
  return fallback;
}

class QQMusicProvider extends QQMusicClient {
  constructor(options = {}) {
    super(options);
    this.name = 'QQ音乐';
    this.encryptedStreams = new Map();
  }

  async healthCheck() {
    const auth = await this.getSafeAuthState();
    try {
      await this.searchTracks('晴天', { limit: 1 });
      const loggedIn = Boolean(auth && auth.loggedIn);
      return {
        source: this.source,
        name: this.name,
        ok: true,
        status: loggedIn ? 'logged-in' : 'public-ok',
        message: loggedIn
          ? 'QQ 音乐公开接口可用，已检测到登录 Cookie。'
          : 'QQ 音乐公开搜索接口可用，播放和账号歌单需要登录后验证。',
        auth: sanitizeAuthState(auth)
      };
    } catch (error) {
      return {
        source: this.source,
        name: this.name,
        ok: false,
        status: 'api-error',
        message: `QQ 音乐接口检查失败：${error.message || String(error)}`,
        auth: sanitizeAuthState(auth)
      };
    }
  }

  async searchTracks(keyword, options = {}) {
    const query = String(keyword || '').trim();
    if (!query) throw new Error('缺少搜索关键词。');
    const limit = clampInteger(options.limit, 1, 30, 20);
    const data = await this.requestJson(QQ_SEARCH_URL, {
      new_json: '1',
      t: '0',
      aggr: '1',
      cr: '1',
      catZhida: '1',
      lossless: '0',
      p: String(clampInteger(options.page, 1, 50, 1)),
      n: String(limit),
      w: query,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      platform: 'yqq.json',
      needNewCode: '0'
    });
    const songs = data && data.data && data.data.song && Array.isArray(data.data.song.list)
      ? data.data.song.list
      : [];
    return songs.map(mapQQSong).filter(Boolean);
  }

  async getLyrics(track) {
    const sourceTrackId = extractSourceTrackId(track);
    const sourceSongId = await this.resolveSourceSongId(track, sourceTrackId);
    let richLyricError = null;

    if (sourceSongId > 0) {
      try {
        const response = await this.requestMusicu({
          req_0: {
            module: 'music.musichallSong.PlayLyricInfo',
            method: 'GetPlayLyricInfo',
            param: {
              songID: sourceSongId,
              songMID: sourceTrackId,
              songType: 0,
              qrc: 1,
              trans: 1,
              roma: 1,
              crypt: 1
            }
          }
        });
        const inner = response && response.req_0;
        if (Number(response && response.code) !== 0 || Number(inner && inner.code) !== 0 || !inner || !inner.data) {
          throw new Error('QQ 音乐未返回完整歌词数据。');
        }

        const data = inner.data;
        const encrypted = Number(data.crypt) === 1;
        const lyric = decodeQQPlayableLyric(data.lyric, encrypted);
        const translation = decodeQQPlayableLyric(data.trans, encrypted);
        const roma = decodeQQPlayableLyric(data.roma, encrypted);
        // qrc 可能是独立歌词正文，也可能只是声明 lyric 含逐字歌词的数字标志。
        const qrcPayload = String(data.qrc ?? '').trim();
        const wordLyric = !qrcPayload || qrcPayload === '0' || qrcPayload === '1'
          ? lyric
          : decodeQQPlayableLyric(qrcPayload, encrypted);
        const lines = parseLyricResult(lyric, translation, wordLyric, roma);
        if (lines.length > 0) return { source: this.source, sourceTrackId, lines };
        throw new Error('QQ 音乐返回的歌词无法解析。');
      } catch (error) {
        richLyricError = error;
      }
    }

    try {
      return await this.getLegacyLyrics(sourceTrackId);
    } catch (error) {
      if (!richLyricError) throw error;
      throw new Error(`QQ 音乐歌词获取失败：${richLyricError.message || String(richLyricError)}`);
    }
  }

  async resolveSourceSongId(track, sourceTrackId) {
    const existingId = extractSourceSongId(track);
    if (existingId > 0) return existingId;

    const artists = Array.isArray(track && track.artists) ? track.artists : [];
    const query = [track && track.title, artists[0]].filter(Boolean).join(' ').trim();
    if (!query) return 0;

    try {
      const candidates = await this.searchTracks(query, { limit: 20 });
      const exactMatch = candidates.find((candidate) => candidate.sourceTrackId === sourceTrackId);
      return extractSourceSongId(exactMatch);
    } catch (_) {
      return 0;
    }
  }

  async getLegacyLyrics(sourceTrackId) {
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const gtkSource = extractQQGtkSource(cookieHeader);
    const gtk = gtkSource ? calcQQGtk(gtkSource) : 5381;
    const data = await this.requestJson(QQ_LYRIC_URL, {
      songmid: sourceTrackId,
      pcachetime: String(Date.now()),
      g_tk: String(gtk),
      loginUin: uin,
      hostUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0'
    });
    return {
      source: this.source,
      sourceTrackId,
      lines: parseLyricResult(
        decodeQQBase64(data && data.lyric),
        decodeQQBase64(data && data.trans),
        '',
        decodeQQBase64(data && data.romalrc)
      )
    };
  }

  async resolvePlayableUrl(track, options = {}) {
    const sourceTrackId = extractSourceTrackId(track);
    const sourceMediaId = String(track && track.sourceMediaId || sourceTrackId).trim();
    const requestedQuality = Object.hasOwn(QQ_ENCRYPTED_QUALITIES, options.quality)
      ? options.quality
      : Object.hasOwn(QQ_STREAM_QUALITIES, options.quality)
      ? options.quality
      : 'standard';
    if (Object.hasOwn(QQ_ENCRYPTED_QUALITIES, requestedQuality)) {
      return this.resolveEncryptedPlayableUrl(track, requestedQuality);
    }
    const sourceSongType = normalizeQQSongType(track && track.sourceSongType);
    const qualityCandidates = QQ_STREAM_FALLBACKS[requestedQuality];
    const filenames = qualityCandidates.map((quality) => {
      const format = QQ_STREAM_QUALITIES[quality];
      return `${format.prefix}${sourceMediaId}.${format.extension}`;
    });
    const guid = buildGuid();
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const data = await this.requestMusicu({
      req: {
        module: 'CDN.SrfCdnDispatchServer',
        method: 'GetCdnDispatch',
        param: { guid, calltype: 0, userip: '' }
      },
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid,
          songmid: qualityCandidates.map(() => sourceTrackId),
          songtype: qualityCandidates.map(() => sourceSongType),
          filename: filenames,
          uin,
          loginflag: cookieHeader ? 1 : 0,
          platform: '20'
        }
      }
    });
    const midUrlInfoList = data && data.req_0 && data.req_0.data && Array.isArray(data.req_0.data.midurlinfo)
      ? data.req_0.data.midurlinfo
      : [];
    const streamIndex = midUrlInfoList.findIndex((item) => item && item.purl);
    const midUrlInfo = streamIndex >= 0 ? midUrlInfoList[streamIndex] : null;
    const purl = midUrlInfo && midUrlInfo.purl ? String(midUrlInfo.purl) : '';
    if (!purl) {
      if (!hasQQMusicAuthCookie(cookieHeader)) {
        throw new Error('请先登录 QQ 音乐后再播放该歌曲。');
      }
      throw new Error('当前 QQ 音乐账号没有该歌曲的完整播放或试听权益，可能需要 VIP 或受版权、地区限制。');
    }
    const sip = data && data.req_0 && data.req_0.data && Array.isArray(data.req_0.data.sip)
      ? data.req_0.data.sip
      : [];
    const baseUrl = sip.find(Boolean) || 'https://isure.stream.qqmusic.qq.com/';
    const expiresAt = Date.now() + STREAM_TTL_MS;
    const actualQuality = identifyQQStreamQuality(
      midUrlInfo && (midUrlInfo.filename || midUrlInfo.purl),
      qualityCandidates[streamIndex] || requestedQuality
    );
    return {
      source: this.source,
      sourceTrackId,
      url: `${baseUrl}${purl}`,
      expireAt: expiresAt,
      playUrlExpireAt: expiresAt,
      requestedQuality,
      quality: actualQuality
    };
  }

  async resolveEncryptedPlayableUrl(track, requestedQuality) {
    await this.requireLogin('QQ 音乐臻品音质需要先登录 QQ 音乐。');
    const sourceTrackId = extractSourceTrackId(track);
    const sourceMediaId = String(track && track.sourceMediaId || sourceTrackId).trim();
    const sourceSongType = normalizeQQSongType(track && track.sourceSongType);
    const format = QQ_ENCRYPTED_QUALITIES[requestedQuality];
    const filename = `${format.family}${sourceMediaId}.${format.extension}`;
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const guid = buildGuid();
    const data = await this.requestQQEncryptedVkey({
      queryvkey: {
        module: 'music.vkey.GetEVkey',
        method: 'CgiGetEVkey',
        param: {
          checklimit: 0,
          ctx: 1,
          downloadfrom: 0,
          filename: [filename],
          musicfile: [filename],
          nettype: '',
          referer: 'y.qq.com',
          scene: 0,
          songmid: [sourceTrackId],
          songtype: [sourceSongType],
          uin: String(uin),
          guid
        }
      }
    }, guid);
    const info = data && data.queryvkey && data.queryvkey.data
      && Array.isArray(data.queryvkey.data.midurlinfo)
      ? data.queryvkey.data.midurlinfo.find((item) => item && item.purl && item.ekey)
      : null;
    const purl = info && String(info.purl || '');
    const ekey = info && String(info.ekey || '');
    if (!purl || !ekey) throw new Error('QQ 音乐未返回可解密的臻品媒体。');
    const sip = data.queryvkey.data && Array.isArray(data.queryvkey.data.sip)
      ? data.queryvkey.data.sip
      : [];
    const baseUrl = sip.find(Boolean) || 'https://isure.stream.qqmusic.qq.com/';
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + STREAM_TTL_MS;
    this.encryptedStreams.set(id, {
      url: new URL(purl, baseUrl).toString(),
      ekey,
      family: format.family,
      contentType: format.contentType,
      expiresAt
    });
    this.pruneEncryptedStreams();
    return {
      source: this.source,
      sourceTrackId,
      url: `/api/music/qq-encrypted-stream?id=${encodeURIComponent(id)}`,
      expireAt: expiresAt,
      playUrlExpireAt: expiresAt,
      requestedQuality,
      quality: requestedQuality,
      encrypted: true,
      spatialAudio: format.family === 'Q0' ? 'metadata-only' : 'unsupported'
    };
  }

  async serveEncryptedStream(id, request, response) {
    const record = this.encryptedStreams.get(String(id || ''));
    const { serveQQEncryptedStream } = require('../qq-encrypted-stream');
    return serveQQEncryptedStream(record, request, response);
  }

  pruneEncryptedStreams() {
    const now = Date.now();
    for (const [id, record] of this.encryptedStreams) {
      if (record.expiresAt <= now) this.encryptedStreams.delete(id);
    }
  }

  async getPersonalizedPlaylists(options = {}) {
    const limit = clampInteger(options.limit, 1, 30, 9);
    const page = clampInteger(options.page, 1, 50, 1);
    const vUniq = Array.isArray(options.vUniq) ? options.vUniq.slice(0, 200) : [];
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const guid = buildGuid();

    const data = await this.requestMusicuPost(
      {
        req_1: {
          module: 'music.recommend.RecommendFeed',
          method: 'get_recommend_feed',
          param: {
            direction: 1,
            page,
            v_cache: [],
            v_uniq: vUniq,
            s_num: 4
          }
        }
      },
      {
        format: 'json',
        ct: 20,
        cv: 2241,
        platform: 'wk_v17',
        guid,
        uin,
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        needNewCode: 1
      }
    );

    const shelves = data && data.req_1 && data.req_1.data && Array.isArray(data.req_1.data.v_shelf)
      ? data.req_1.data.v_shelf
      : [];
    const playlists = [];
    shelves.forEach((shelf) => {
      const niches = Array.isArray(shelf.v_niche) ? shelf.v_niche : [];
      niches.forEach((niche) => {
        const cards = Array.isArray(niche.v_card) ? niche.v_card : [];
        cards.forEach((card) => {
          if (card.type === 500) {
            const mapped = mapRecommendCard(card);
            if (mapped) playlists.push(mapped);
          }
        });
      });
    });
    return playlists.slice(0, limit);
  }

  async getDailyTracks(options = {}) {
    const limit = clampInteger(options.limit, 1, 100, 30);
    const page = clampInteger(options.page, 1, 50, 1);
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const guid = buildGuid();

    // 「每日推荐」= 推荐 Feed 里的 type 200（单曲卡片），和「为你推荐」同一个接口。
    // 客户端的真实流程（已从 HAR 抓包确认）：
    //   1. get_recommend_feed → 取 type 200 卡片（shelf 207）
    //   2. CgiGetTrackInfo(ids, types:[200...], source:"AiNoFree") → 拿完整歌曲信息
    const tracks = [];
    const seen = new Set();
    const maxPages = Math.min(5, Math.max(1, Math.ceil(limit / 9)));
    for (let p = page; p < page + maxPages && tracks.length < limit; p++) {
      const data = await this.requestMusicuPost(
        {
          req_1: {
            module: 'music.recommend.RecommendFeed',
            method: 'get_recommend_feed',
            param: { direction: 1, page: p, v_cache: [], v_uniq: [], s_num: 4 }
          }
        },
        {
          format: 'json', ct: 20, cv: 2241, platform: 'wk_v17',
          guid, uin, inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1
        }
      ).catch(() => null);

      const shelves = data && data.req_1 && data.req_1.data
        && Array.isArray(data.req_1.data.v_shelf) ? data.req_1.data.v_shelf : [];

      // 从所有 shelf 收集 type 200 的歌曲 id
      const songIds = [];
      shelves.forEach((shelf) => {
        (shelf.v_niche || []).forEach((niche) => {
          (niche.v_card || []).forEach((card) => {
            if (card.type === 200 && card.id && !seen.has(String(card.id))) {
              songIds.push(card.id);
            }
          });
        });
      });
      if (songIds.length === 0) break;

      // 第二步：批量拉完整歌曲信息（含 mid / singer / album / interval）
      const resolved = await this.resolveTrackInfoByIds(songIds, uin, guid);
      for (const song of resolved) {
        const mapped = mapQQSong(song);
        if (!mapped || seen.has(mapped.sourceTrackId)) continue;
        seen.add(mapped.sourceTrackId);
        tracks.push(mapped);
        if (tracks.length >= limit) break;
      }
      // 对已见 id 做保护，避免下一页重复
      songIds.forEach((id) => seen.add(String(id)));
    }

    if (tracks.length > 0) return tracks;
    // Feed 没有单曲卡片（极少情况）时退回电台
    return this.getRadioTracks({ limit, page });
  }

  // 把 type 200 的 songId 列表批量转成完整歌曲对象（含 mid）
  async resolveTrackInfoByIds(ids, uin, guid) {
    if (!ids || ids.length === 0) return [];
    const data = await this.requestMusicuPost(
      {
        req_1: {
          module: 'music.trackInfo.UniformRuleCtrl',
          method: 'CgiGetTrackInfo',
          param: {
            ids: ids.map(Number),
            types: ids.map(() => 200),
            source: 'AiNoFree'
          }
        }
      },
      {
        format: 'json', ct: 20, cv: 2241, platform: 'wk_v17',
        guid: guid || buildGuid(),
        uin: uin || '0',
        inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1
      }
    ).catch(() => null);
    return data && data.req_1 && data.req_1.data
      && Array.isArray(data.req_1.data.tracks) ? data.req_1.data.tracks : [];
  }

  async getRadioTracks(options = {}) {
    const limit = clampInteger(options.limit, 1, 50, 20);
    const page = clampInteger(options.page, 1, 50, 1);
    const radioId = clampInteger(options.radioId, 1, 9999, 101);
    // 电台一次只回 5 首左右，所以要连抓几轮凑够 limit。
    // firstplay=1 表示「开始新一轮」，之后用 0 才会继续往下发新歌；
    // 每次调用换新 guid 也能让服务端换一批，两个手段一起用。
    const tracks = [];
    const seen = new Set();
    const maxRounds = Math.min(12, Math.max(3, Math.ceil(limit / 4)));
    for (let round = 0; round < maxRounds && tracks.length < limit; round++) {
      const data = await this.requestMusicu({
        songlist: {
          module: 'mb_track_radio_svr',
          method: 'get_radio_track',
          param: {
            id: radioId,
            firstplay: round === 0 && page === 1 ? 1 : 0,
            num: Math.max(15, limit)
          }
        }
      }).catch(() => null);
      const batch = extractRadioSongs(data);
      if (batch.length === 0) break;
      let fresh = 0;
      for (const song of batch) {
        const mapped = mapQQSong(song);
        if (!mapped || seen.has(mapped.sourceTrackId)) continue;
        seen.add(mapped.sourceTrackId);
        tracks.push(mapped);
        fresh++;
        if (tracks.length >= limit) break;
      }
      // 服务端开始重复发同一批就停，避免空转。
      if (fresh === 0) break;
    }
    return tracks.slice(0, limit);
  }

  async getLikedTracks(options = {}) {
    await this.requireLogin('QQ 音乐”我喜欢”需要先登录。');
    const limit = clampInteger(options.limit, 1, 5000, 200);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const playlists = await this.getCreatedPlaylists({ limit: 50, includeLiked: true });
    const liked = playlists.find((playlist) => playlist.dirId === '201' || /我喜欢|喜欢/.test(playlist.title));
    if (!liked) {
      throw new Error('没有从 QQ 音乐读取到“我喜欢”，当前登录凭证不完整或已失效，请重新登录 QQ 音乐。');
    }
    return this.getPlaylistTracks(liked.id, { limit, offset });
  }

  async getCreatedPlaylists(options = {}) {
    await this.requireLogin('QQ 音乐”我的歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const uin = await this.requireUin();
    let playlists;
    try {
      const callKey = 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin';
      const data = await this.requestMusicsClient({
        [callKey]: {
          module: 'music.musicasset.PlaylistBaseRead',
          method: 'GetPlaylistByUin',
          param: { uin }
        }
      });
      const moduleData = readQQModuleData(data, callKey, '读取我的歌单');
      playlists = Array.isArray(moduleData.v_playlist) ? moduleData.v_playlist : [];
    } catch (_) {
      const cookieHeader = await this.getSafeCookieHeader();
      const gtkSource = extractQQGtkSource(cookieHeader);
      const gtk = gtkSource ? calcQQGtk(gtkSource) : 5381;
      const data = await this.requestJson(QQ_CREATED_PLAYLIST_URL, {
        hostUin: '0', hostuin: uin, sin: '0', size: String(Math.max(limit, 50)),
        g_tk: String(gtk), loginUin: uin, format: 'json', inCharset: 'utf8',
        outCharset: 'utf-8', notice: '0', platform: 'yqq.json', needNewCode: '0'
      });
      playlists = data && data.data && Array.isArray(data.data.disslist) ? data.data.disslist : [];
    }
    const mapped = playlists.map(mapQQPlaylist).filter(Boolean);
    if (options.includeLiked === false) {
      return mapped.filter((playlist) => playlist.dirId !== '201').slice(0, limit);
    }
    return mapped.slice(0, limit);
  }

  async getCollectedPlaylists(options = {}) {
    await this.requireLogin('QQ 音乐”收藏歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const uin = await this.requireUin();
    let playlists;
    try {
      const callKey = 'music.musicasset.PlaylistFavRead';
      const data = await this.requestMusicsClient({
        [callKey]: {
          module: 'music.musicasset.PlaylistFavRead',
          method: 'GetPlaylistFavInfo',
          param: { uin }
        }
      });
      const moduleData = readQQModuleData(data, callKey, '读取收藏歌单');
      playlists = Array.isArray(moduleData.v_list) ? moduleData.v_list : [];
    } catch (_) {
      const cookieHeader = await this.getSafeCookieHeader();
      const gtkSource = extractQQGtkSource(cookieHeader);
      const gtk = gtkSource ? calcQQGtk(gtkSource) : 5381;
      const data = await this.requestJson(QQ_COLLECTED_ASSET_URL, {
        ct: '20', cid: '205360956', userid: uin, reqtype: '3', sin: '0', ein: String(limit),
        g_tk: String(gtk), loginUin: uin, format: 'json', inCharset: 'utf8',
        outCharset: 'utf-8', platform: 'yqq.json', needNewCode: '0'
      });
      playlists = data && data.data && Array.isArray(data.data.cdlist) ? data.data.cdlist : [];
    }
    return playlists.map(mapQQPlaylist).filter(Boolean).slice(0, limit);
  }

  async addTracksToPlaylist(playlist, tracks) {
    return this.writePlaylistTracks('AddSonglist', playlist, tracks);
  }

  async removeTracksFromPlaylist(playlist, tracks) {
    return this.writePlaylistTracks('DelSonglist', playlist, tracks);
  }

  async writePlaylistTracks(method, playlist, tracks) {
    await this.requireLogin('修改 QQ 音乐歌单需要先登录。');
    const target = normalizeQQPlaylistWriteTarget(playlist);
    const songInfo = normalizeQQPlaylistSongInfo(tracks);
    return this.requestPlaylistWrite(method, target, songInfo);
  }

  async getRecentTracks(options = {}) {
    await this.requireLogin('QQ 音乐”最近播放”需要先登录。');
    const limit = clampInteger(options.limit, 1, 100, 50);
    const uin = await this.requireUin();

    // Try newer musicu API first
    let muDebug = null;
    try {
      const muData = await this.requestMusicu({
        req_0: {
          module: 'music.globalchannel.GlobalChannelSvr',
          method: 'GetPlayHistory',
          param: { uin, start: 0, num: limit }
        }
      });
      muDebug = muData && muData.req_0;
      const list = muData && muData.req_0 && muData.req_0.data
        && Array.isArray(muData.req_0.data.result_song_list)
        ? muData.req_0.data.result_song_list
        : null;
      if (list && list.length > 0) {
        const songs = list
          .map((item) => mapQQSong(item && (item.songInfo || item)))
          .filter(Boolean)
          .slice(0, limit);
        if (songs.length > 0) return songs;
      }
    } catch (e) { muDebug = { error: e && e.message }; }

    // Legacy API fallback
    const cookieHeader = await this.getSafeCookieHeader();
    const gtkSource = extractQQGtkSource(cookieHeader);
    const gtk = gtkSource ? calcQQGtk(gtkSource) : 5381;
    const data = await this.requestJson(QQ_COLLECTED_ASSET_URL, {
      ct: '20',
      cid: '205360956',
      userid: uin,
      reqtype: '4',
      sin: '0',
      ein: String(limit),
      g_tk: String(gtk),
      loginUin: uin,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      platform: 'yqq.json',
      needNewCode: '0'
    });
    const rawData = data && data.data;
    const songlist = rawData && (
      Array.isArray(rawData.songlist) ? rawData.songlist :
      Array.isArray(rawData.song_list) ? rawData.song_list :
      []
    );
    const songs = songlist.map(mapQQSong).filter(Boolean).slice(0, limit);
    if (songs.length > 0) return songs;
    const legacyKeys = rawData ? Object.keys(rawData) : 'null';
    throw new Error(
      `QQ 音乐没有返回最近播放歌曲。` +
      `[musicu:${JSON.stringify(muDebug && { code: muDebug.code, dataKeys: muDebug.data ? Object.keys(muDebug.data) : null })}]` +
      `[legacy keys:${JSON.stringify(legacyKeys)}]`
    );
  }

  async getPlaylistTracks(playlistId, options = {}) {
    const id = String(playlistId || '').trim();
    if (!id) throw new Error('缺少 QQ 音乐歌单 ID。');
    const limit = clampInteger(options.limit, 1, 5000, 1000);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    if (hasQQMusicAuthCookie(cookieHeader)) {
      try {
        const callKey = 'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo';
        const data = await this.requestMusicsClient({
          [callKey]: {
            module: 'music.srfDissInfo.DissInfoForPc',
            method: 'uniform_get_Dissinfo',
            param: {
              disstid: Number(id),
              host_uin: Number(uin),
              login_uin: Number(uin)
            }
          }
        });
        const moduleData = readQQModuleData(data, callKey, '读取歌单详情');
        const songlist = Array.isArray(moduleData.songlist) ? moduleData.songlist : [];
        return songlist.slice(offset, offset + limit).map(mapQQSong).filter(Boolean);
      } catch (_) {
        // 网页登录态不一定具备桌面客户端权限，继续使用公开歌单详情接口。
      }
    }

    const gtkSource = extractQQGtkSource(cookieHeader);
    const gtk = gtkSource ? calcQQGtk(gtkSource) : 5381;
    const params = {
      type: '1',
      json: '1',
      utf8: '1',
      onlysong: '0',
      disstid: id,
      format: 'json',
      g_tk: String(gtk),
      loginUin: uin,
      hostUin: '0',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0'
    };
    if (limit <= 100 || offset > 0) {
      params.song_begin = String(offset);
      params.song_num = String(limit);
    }
    const data = await this.requestJson(QQ_PLAYLIST_DETAIL_URL, params);
    const cdlist = data && Array.isArray(data.cdlist) ? data.cdlist : [];
    const songlist = cdlist[0] && Array.isArray(cdlist[0].songlist) ? cdlist[0].songlist : [];
    return songlist.slice(0, limit).map(mapQQSong).filter(Boolean);
  }



}

module.exports = {
  QQMusicProvider
};
