'use strict';

const { parseLyricResult } = require('../lyrics');

const QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const QQ_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_PLAYLIST_DETAIL_URL = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
const QQ_PROFILE_URL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg';
const QQ_CREATED_PLAYLIST_URL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss';
const QQ_COLLECTED_ASSET_URL = 'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg';
const QQ_DAILY_PAGE_URL = 'https://c.y.qq.com/node/musicmac/v6/index.html';
const REQUEST_TIMEOUT_MS = 10000;
const STREAM_TTL_MS = 5 * 60 * 1000;

class QQMusicProvider {
  constructor(options = {}) {
    this.source = 'qq';
    this.name = 'QQ音乐';
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
    const data = await this.requestJson(QQ_LYRIC_URL, {
      songmid: sourceTrackId,
      pcachetime: String(Date.now()),
      g_tk: '5381',
      loginUin: extractUin(await this.getSafeCookieHeader()) || '0',
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
        decodeQQBase64(data && data.trans)
      )
    };
  }

  async resolvePlayableUrl(track) {
    const sourceTrackId = extractSourceTrackId(track);
    const guid = buildGuid();
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const data = await this.requestJson(QQ_MUSICU_URL, {
      data: JSON.stringify({
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
            songmid: [sourceTrackId],
            songtype: [0],
            uin,
            loginflag: cookieHeader ? 1 : 0,
            platform: '20'
          }
        },
        comm: {
          uin,
          format: 'json',
          ct: 24,
          cv: 0
        }
      })
    });
    const midUrlInfo = data && data.req_0 && data.req_0.data && Array.isArray(data.req_0.data.midurlinfo)
      ? data.req_0.data.midurlinfo[0]
      : null;
    const purl = midUrlInfo && midUrlInfo.purl ? String(midUrlInfo.purl) : '';
    if (!purl) throw new Error('当前 QQ 音乐账号无法播放该歌曲。');
    const sip = data && data.req_0 && data.req_0.data && Array.isArray(data.req_0.data.sip)
      ? data.req_0.data.sip
      : [];
    const baseUrl = sip.find(Boolean) || 'https://isure.stream.qqmusic.qq.com/';
    const expiresAt = Date.now() + STREAM_TTL_MS;
    return {
      source: this.source,
      sourceTrackId,
      url: `${baseUrl}${purl}`,
      expireAt: expiresAt,
      playUrlExpireAt: expiresAt
    };
  }

  async getPersonalizedPlaylists(options = {}) {
    const limit = clampInteger(options.limit, 1, 30, 12);
    const data = await this.requestMusicu({
      recomPlaylist: {
        module: 'playlist.HotRecommendServer',
        method: 'get_hot_recommend',
        param: { async: 1, cmd: 2 }
      }
    });
    const playlists = data && data.recomPlaylist && data.recomPlaylist.data
      && Array.isArray(data.recomPlaylist.data.v_hot)
      ? data.recomPlaylist.data.v_hot
      : [];
    return playlists.slice(0, limit).map(mapQQPlaylist).filter(Boolean);
  }

  async getDailyTracks(options = {}) {
    await this.requireLogin('QQ 音乐每日推荐需要先登录。');
    const limit = clampInteger(options.limit, 1, 100, 30);
    const page = await this.requestText(QQ_DAILY_PAGE_URL);
    const playlistIds = extractDailyPlaylistIds(page);
    for (const playlistId of playlistIds) {
      const tracks = await this.getPlaylistTracks(playlistId, { limit }).catch(() => []);
      if (tracks.length > 0) return tracks;
    }
    const fallback = await this.getRadioTracks({ limit });
    if (fallback.length > 0) return fallback;
    throw new Error('没有从 QQ 音乐读取到每日推荐歌曲，请确认账号已登录并稍后重试。');
  }

  async getRadioTracks(options = {}) {
    const limit = clampInteger(options.limit, 1, 50, 20);
    const data = await this.requestMusicu({
      songlist: {
        module: 'mb_track_radio_svr',
        method: 'get_radio_track',
        param: {
          id: clampInteger(options.radioId, 1, 9999, 101),
          firstplay: 1,
          num: Math.max(15, limit)
        }
      }
    });
    const radioData = data && data.songlist && data.songlist.data ? data.songlist.data : {};
    const songs = Array.isArray(radioData.tracks)
      ? radioData.tracks
      : (Array.isArray(radioData.track_list)
        ? radioData.track_list
        : (Array.isArray(radioData.songlist) ? radioData.songlist : []));
    return songs.slice(0, limit).map(mapQQSong).filter(Boolean);
  }

  async getLikedTracks(options = {}) {
    await this.requireLogin('QQ 音乐“我喜欢”需要先登录。');
    const limit = clampInteger(options.limit, 1, 100, 50);
    const playlists = await this.getCreatedPlaylists({ limit: 50, includeLiked: true });
    const liked = playlists.find((playlist) => playlist.dirId === '201' || /我喜欢|喜欢/.test(playlist.title))
      || playlists[0];
    if (!liked) return [];
    return this.getPlaylistTracks(liked.id, { limit });
  }

  async getCreatedPlaylists(options = {}) {
    await this.requireLogin('QQ 音乐“我的歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 100, 50);
    const uin = await this.requireUin();
    const data = await this.requestJson(QQ_CREATED_PLAYLIST_URL, {
      hostUin: '0',
      hostuin: uin,
      sin: '0',
      size: String(Math.max(limit, 50)),
      g_tk: '5381',
      loginUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0'
    });
    if (Number(data && data.code) === 4000) return [];
    const playlists = data && data.data && Array.isArray(data.data.disslist)
      ? data.data.disslist
      : [];
    const mapped = playlists.map(mapQQPlaylist).filter(Boolean);
    if (options.includeLiked === false) {
      return mapped.filter((playlist) => playlist.dirId !== '201').slice(0, limit);
    }

    if (!mapped.some((playlist) => playlist.dirId === '201')) {
      const liked = await this.getLikedPlaylistFromProfile(uin);
      if (liked) mapped.unshift(liked);
    }
    return mapped.slice(0, limit);
  }

  async getCollectedPlaylists(options = {}) {
    await this.requireLogin('QQ 音乐“收藏歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 100, 50);
    const uin = await this.requireUin();
    const data = await this.requestJson(QQ_COLLECTED_ASSET_URL, {
      ct: '20',
      cid: '205360956',
      userid: uin,
      reqtype: '3',
      sin: '0',
      ein: String(limit)
    });
    const playlists = data && data.data && Array.isArray(data.data.cdlist)
      ? data.data.cdlist
      : [];
    return playlists.map(mapQQPlaylist).filter(Boolean).slice(0, limit);
  }

  async getRecentTracks(options = {}) {
    await this.requireLogin('QQ 音乐“最近播放”需要先登录。');
    const limit = clampInteger(options.limit, 1, 100, 50);
    const uin = await this.requireUin();
    const data = await this.requestJson(QQ_PROFILE_URL, {
      cid: '205360838',
      userid: uin,
      reqfrom: '1',
      g_tk: '5381',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      platform: 'yqq.json'
    });
    const songs = collectQQSongsFromObject(data).slice(0, limit);
    if (songs.length > 0) return songs;
    return this.getLikedTracks({ limit });
  }

  async getPlaylistTracks(playlistId, options = {}) {
    const id = String(playlistId || '').trim();
    if (!id) throw new Error('缺少 QQ 音乐歌单 ID。');
    const limit = clampInteger(options.limit, 1, 200, 50);
    const data = await this.requestJson(QQ_PLAYLIST_DETAIL_URL, {
      type: '1',
      json: '1',
      utf8: '1',
      onlysong: '0',
      disstid: id,
      format: 'json',
      g_tk: '5381',
      loginUin: extractUin(await this.getSafeCookieHeader()) || '0',
      hostUin: '0',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0'
    });
    const cdlist = data && Array.isArray(data.cdlist) ? data.cdlist : [];
    const songlist = cdlist[0] && Array.isArray(cdlist[0].songlist) ? cdlist[0].songlist : [];
    return songlist.slice(0, limit).map(mapQQSong).filter(Boolean);
  }

  async requestMusicu(modules = {}) {
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    return this.requestJson(QQ_MUSICU_URL, {
      data: JSON.stringify({
        ...modules,
        comm: {
          uin,
          format: 'json',
          ct: 24,
          cv: 0
        }
      })
    });
  }

  async requestText(rawUrl, params = {}) {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: await this.buildHeaders(),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return text;
  }

  async requestJson(rawUrl, params = {}) {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: await this.buildHeaders(),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      return JSON.parse(stripJsonp(text));
    } catch (error) {
      throw new Error(`QQ 音乐返回了非 JSON 响应：${error.message}`);
    }
  }

  async buildHeaders() {
    const headers = {
      Accept: 'application/json,text/plain,*/*',
      Origin: 'https://y.qq.com',
      Referer: 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 SongAssistant/1.0'
    };
    const cookieHeader = await this.getSafeCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
    return headers;
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
    const cookieHeader = await this.getSafeCookieHeader();
    if ((!auth || !auth.loggedIn) && !cookieHeader) {
      throw new Error(message || '需要先登录 QQ 音乐。');
    }
    return auth;
  }

  async requireUin() {
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader);
    if (!uin) throw new Error('没有从 QQ 音乐 Cookie 中读取到 QQ 号，请重新登录。');
    return uin;
  }

  async getLikedPlaylistFromProfile(uin) {
    const data = await this.requestJson(QQ_PROFILE_URL, {
      cid: '205360838',
      userid: uin,
      reqfrom: '1',
      g_tk: '5381',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      platform: 'yqq.json'
    });
    const mymusic = data && data.data && Array.isArray(data.data.mymusic)
      ? data.data.mymusic
      : [];
    const fav = mymusic[0];
    if (!fav || !fav.id) return null;
    return {
      id: String(fav.id),
      source: this.source,
      title: '我喜欢',
      description: '',
      coverUrl: 'https://y.gtimg.cn/mediastyle/global/img/cover_like.png',
      trackCount: Math.max(0, Number(fav.num0 || fav.song_cnt || fav.songnum || 0)),
      playCount: 0,
      creatorUserId: uin,
      dirId: '201'
    };
  }
}

function mapQQSong(song) {
  if (!song || !(song.mid || song.songmid || song.song_mid) || !(song.title || song.name || song.songname)) return null;
  const sourceTrackId = String(song.mid || song.songmid || song.song_mid);
  const album = song.album || {};
  const singers = Array.isArray(song.singer)
    ? song.singer
    : (Array.isArray(song.singers) ? song.singers : []);
  const albumMid = album && (album.mid || album.pmid)
    ? String(album.mid || album.pmid)
    : String(song.albummid || '');
  return {
    id: `qq:${sourceTrackId}`,
    source: 'qq',
    sourceTrackId,
    sourceAlbumId: album && (album.mid || album.id) ? String(album.mid || album.id) : albumMid,
    title: String(song.title || song.name || song.songname || '').trim(),
    artists: singers.map((artist) => String(artist && artist.name || '').trim()).filter(Boolean),
    album: String(album && (album.title || album.name) || song.albumname || song.albumdesc || '').trim(),
    durationMs: Math.max(0, Number(song.interval || 0) * 1000),
    coverUrl: extractQQCoverUrl(song, albumMid),
    playable: true,
    vip: Number(song.pay && song.pay.pay_play || 0) > 0
  };
}

function mapQQPlaylist(playlist) {
  if (!playlist) return null;
  const id = playlist.content_id || playlist.dissid || playlist.tid || playlist.id;
  const title = playlist.title || playlist.dissname || playlist.diss_name || playlist.name;
  if (!id || !title) return null;
  return {
    id: String(id),
    source: 'qq',
    title: String(title || '').trim(),
    description: String(playlist.desc || playlist.subtitle || playlist.rcmdcontent || '').trim(),
    coverUrl: String(playlist.cover || playlist.picurl || playlist.imgurl || playlist.logo || playlist.diss_cover || ''),
    trackCount: Math.max(0, Number(playlist.song_cnt || playlist.songnum || playlist.total_song_num || playlist.count || 0)),
    playCount: Math.max(0, Number(playlist.listen_num || playlist.listennum || playlist.playcnt || playlist.access_num || 0)),
    creatorUserId: playlist.uin || playlist.hostuin ? String(playlist.uin || playlist.hostuin) : '',
    dirId: playlist.dirid ? String(playlist.dirid) : ''
  };
}

function extractSourceTrackId(track) {
  const sourceTrackId = String(track && (track.sourceTrackId || track.id) || '')
    .replace(/^qq:/, '')
    .trim();
  if (!sourceTrackId) throw new Error('缺少 QQ 音乐歌曲 ID。');
  return sourceTrackId;
}

function decodeQQBase64(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return Buffer.from(text, 'base64').toString('utf8');
  } catch (_) {
    return '';
  }
}

function stripJsonp(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^[^(]*\(([\s\S]*)\)\s*;?$/);
  return match ? match[1] : raw;
}

function extractDailyPlaylistIds(html) {
  const raw = String(html || '');
  const dailyBlock = raw.match(/playlist__name[^>]*>\s*今日私享[\s\S]{0,1500}?data-rid=["']?(\d+)/)
    || raw.match(/data-rid=["']?(\d+)[^>]{0,500}>[\s\S]{0,500}?今日私享/);
  const ids = [];
  if (dailyBlock) ids.push(dailyBlock[1]);
  for (const match of raw.matchAll(/data-rid=["']?(\d+)/g)) {
    if (!ids.includes(match[1])) ids.push(match[1]);
    if (ids.length >= 20) break;
  }
  return ids;
}

function buildQQCoverUrl(albumMid) {
  const mid = String(albumMid || '').trim();
  return mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : '';
}

function extractQQCoverUrl(song, albumMid) {
  const album = song && song.album ? song.album : {};
  const directUrl = song && (
    song.coverUrl
    || song.cover
    || song.picurl
    || song.imgurl
    || song.albumcover
    || song.strMediaMid
    || album.picUrl
    || album.picurl
    || album.imgurl
  );
  const text = String(directUrl || '').trim();
  if (/^https?:\/\//i.test(text)) return text;
  return buildQQCoverUrl(albumMid);
}

function collectQQSongsFromObject(value, output = [], seen = new Set()) {
  if (!value || output.length >= 100) return output;
  if (Array.isArray(value)) {
    const mapped = value.map(mapQQSong).filter(Boolean);
    if (mapped.length >= Math.min(value.length, 2)) {
      for (const song of mapped) {
        if (!seen.has(song.id)) {
          seen.add(song.id);
          output.push(song);
        }
      }
      return output;
    }
    for (const item of value) collectQQSongsFromObject(item, output, seen);
    return output;
  }
  if (typeof value !== 'object') return output;
  const song = mapQQSong(value);
  if (song && !seen.has(song.id)) {
    seen.add(song.id);
    output.push(song);
  }
  for (const child of Object.values(value)) collectQQSongsFromObject(child, output, seen);
  return output;
}

function extractUin(cookieHeader) {
  const text = String(cookieHeader || '');
  const match = text.match(/(?:^|;\s*)(?:uin|o_cookie)=o?(\d+)/);
  return match ? match[1] : '';
}

function buildGuid() {
  return String(Math.floor(1000000000 + Math.random() * 9000000000));
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
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
  QQMusicProvider
};
