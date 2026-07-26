'use strict';

const { parseLyricResult } = require('../lyrics');

const QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const QQ_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
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
          ? 'QQ音乐公开接口可用，已检测到登录 Cookie。'
          : 'QQ音乐公开搜索接口可用，播放和账号歌单需登录后验证。',
        auth: sanitizeAuthState(auth)
      };
    } catch (error) {
      return {
        source: this.source,
        name: this.name,
        ok: false,
        status: 'api-error',
        message: `QQ音乐接口检查失败：${error.message || String(error)}`,
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
    if (!purl) throw new Error('当前 QQ音乐账号无法播放该歌曲。');
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

  async getPersonalizedPlaylists() {
    throw new Error('QQ音乐推荐歌单需要登录后实测接口。');
  }

  async getDailyTracks() {
    throw new Error('QQ音乐每日推荐需要登录后实测接口。');
  }

  async getRadioTracks() {
    throw new Error('QQ音乐个性电台需要登录后实测接口。');
  }

  async getLikedTracks() {
    throw new Error('QQ音乐我喜欢需要登录后实测接口。');
  }

  async getCreatedPlaylists() {
    throw new Error('QQ音乐我的歌单需要登录后实测接口。');
  }

  async getCollectedPlaylists() {
    throw new Error('QQ音乐收藏歌单需要登录后实测接口。');
  }

  async getRecentTracks() {
    throw new Error('QQ音乐最近播放需要登录后实测接口。');
  }

  async getPlaylistTracks() {
    throw new Error('QQ音乐歌单详情需要登录后实测接口。');
  }

  async requestJson(rawUrl, params = {}) {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const headers = {
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://y.qq.com/',
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      return JSON.parse(stripJsonp(text));
    } catch (error) {
      throw new Error(`QQ音乐返回了非 JSON 响应：${error.message}`);
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
}

function mapQQSong(song) {
  if (!song || !(song.mid || song.songmid) || !(song.title || song.name)) return null;
  const sourceTrackId = String(song.mid || song.songmid);
  const album = song.album || {};
  const singers = Array.isArray(song.singer) ? song.singer : [];
  return {
    id: `qq:${sourceTrackId}`,
    source: 'qq',
    sourceTrackId,
    sourceAlbumId: album && (album.mid || album.id) ? String(album.mid || album.id) : '',
    title: String(song.title || song.name || '').trim(),
    artists: singers.map((artist) => String(artist && artist.name || '').trim()).filter(Boolean),
    album: String(album && album.title || album.name || '').trim(),
    durationMs: Math.max(0, Number(song.interval || 0) * 1000),
    coverUrl: album && album.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${album.mid}.jpg` : '',
    playable: true,
    vip: Number(song.pay && song.pay.pay_play || 0) > 0
  };
}

function extractSourceTrackId(track) {
  const sourceTrackId = String(track && (track.sourceTrackId || track.id) || '')
    .replace(/^qq:/, '')
    .trim();
  if (!sourceTrackId) throw new Error('缺少 QQ音乐歌曲 ID。');
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
