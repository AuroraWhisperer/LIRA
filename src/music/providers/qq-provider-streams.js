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
  extractSourceSongId,
  extractSourceTrackId,
  extractUin,
  hasQQMusicAuthCookie,
  mapQQSong,
  normalizeQQSongType,
  sanitizeAuthState,
} = require('./qq-provider-utils');

const QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const QQ_LYRIC_URL =
  'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const STREAM_TTL_MS = 5 * 60 * 1000;
const QQ_STREAM_QUALITIES = {
  standard: { prefix: 'M500', extension: 'mp3' },
  high: { prefix: 'M800', extension: 'mp3' },
  lossless: { prefix: 'F000', extension: 'flac' },
};
const QQ_STREAM_FALLBACKS = {
  standard: ['standard'],
  high: ['high', 'standard'],
  lossless: ['lossless', 'high', 'standard'],
};
const QQ_ENCRYPTED_QUALITIES = {
  premium: { family: 'Q0', extension: 'mflac', contentType: 'audio/flac' },
  immersive: { family: 'O8', extension: 'mgg', contentType: 'audio/ogg' },
};

function identifyQQStreamQuality(value, fallback) {
  const text = String(value || '');
  if (text.includes('F000')) return 'lossless';
  if (text.includes('M800')) return 'high';
  if (text.includes('M500')) return 'standard';
  return fallback;
}

class QQMusicStreamProvider extends QQMusicClient {
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
        auth: sanitizeAuthState(auth),
      };
    } catch (error) {
      return {
        source: this.source,
        name: this.name,
        ok: false,
        status: 'api-error',
        message: `QQ 音乐接口检查失败：${error.message || String(error)}`,
        auth: sanitizeAuthState(auth),
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
      needNewCode: '0',
    });
    const songs =
      data && data.data && data.data.song && Array.isArray(data.data.song.list)
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
              crypt: 1,
            },
          },
        });
        const inner = response && response.req_0;
        if (
          Number(response && response.code) !== 0 ||
          Number(inner && inner.code) !== 0 ||
          !inner ||
          !inner.data
        ) {
          throw new Error('QQ 音乐未返回完整歌词数据。');
        }

        const data = inner.data;
        const encrypted = Number(data.crypt) === 1;
        const lyric = decodeQQPlayableLyric(data.lyric, encrypted);
        const translation = decodeQQPlayableLyric(data.trans, encrypted);
        const roma = decodeQQPlayableLyric(data.roma, encrypted);
        // qrc 可能是独立歌词正文，也可能只是声明 lyric 含逐字歌词的数字标志。
        const qrcPayload = String(data.qrc ?? '').trim();
        const wordLyric =
          !qrcPayload || qrcPayload === '0' || qrcPayload === '1'
            ? lyric
            : decodeQQPlayableLyric(qrcPayload, encrypted);
        const lines = parseLyricResult(lyric, translation, wordLyric, roma);
        if (lines.length > 0)
          return { source: this.source, sourceTrackId, lines };
        throw new Error('QQ 音乐返回的歌词无法解析。');
      } catch (error) {
        richLyricError = error;
      }
    }

    try {
      return await this.getLegacyLyrics(sourceTrackId);
    } catch (error) {
      if (!richLyricError) throw error;
      throw new Error(
        `QQ 音乐歌词获取失败：${richLyricError.message || String(richLyricError)}`,
      );
    }
  }

  async resolveSourceSongId(track, sourceTrackId) {
    const existingId = extractSourceSongId(track);
    if (existingId > 0) return existingId;

    const artists = Array.isArray(track && track.artists) ? track.artists : [];
    const query = [track && track.title, artists[0]]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!query) return 0;

    try {
      const candidates = await this.searchTracks(query, { limit: 20 });
      const exactMatch = candidates.find(
        (candidate) => candidate.sourceTrackId === sourceTrackId,
      );
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
      needNewCode: '0',
    });
    return {
      source: this.source,
      sourceTrackId,
      lines: parseLyricResult(
        decodeQQBase64(data && data.lyric),
        decodeQQBase64(data && data.trans),
        '',
        decodeQQBase64(data && data.romalrc),
      ),
    };
  }

  async resolvePlayableUrl(track, options = {}) {
    const sourceTrackId = extractSourceTrackId(track);
    const sourceMediaId = String(
      (track && track.sourceMediaId) || sourceTrackId,
    ).trim();
    const requestedQuality = Object.hasOwn(
      QQ_ENCRYPTED_QUALITIES,
      options.quality,
    )
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
        param: { guid, calltype: 0, userip: '' },
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
          platform: '20',
        },
      },
    });
    const midUrlInfoList =
      data &&
      data.req_0 &&
      data.req_0.data &&
      Array.isArray(data.req_0.data.midurlinfo)
        ? data.req_0.data.midurlinfo
        : [];
    const streamIndex = midUrlInfoList.findIndex((item) => item && item.purl);
    const midUrlInfo = streamIndex >= 0 ? midUrlInfoList[streamIndex] : null;
    const purl = midUrlInfo && midUrlInfo.purl ? String(midUrlInfo.purl) : '';
    if (!purl) {
      if (!hasQQMusicAuthCookie(cookieHeader)) {
        throw new Error('请先登录 QQ 音乐后再播放该歌曲。');
      }
      throw new Error(
        '当前 QQ 音乐账号没有该歌曲的完整播放或试听权益，可能需要 VIP 或受版权、地区限制。',
      );
    }
    const sip =
      data &&
      data.req_0 &&
      data.req_0.data &&
      Array.isArray(data.req_0.data.sip)
        ? data.req_0.data.sip
        : [];
    const baseUrl = sip.find(Boolean) || 'https://isure.stream.qqmusic.qq.com/';
    const expiresAt = Date.now() + STREAM_TTL_MS;
    const actualQuality = identifyQQStreamQuality(
      midUrlInfo && (midUrlInfo.filename || midUrlInfo.purl),
      qualityCandidates[streamIndex] || requestedQuality,
    );
    return {
      source: this.source,
      sourceTrackId,
      url: `${baseUrl}${purl}`,
      expireAt: expiresAt,
      playUrlExpireAt: expiresAt,
      requestedQuality,
      quality: actualQuality,
    };
  }

  async resolveEncryptedPlayableUrl(track, requestedQuality) {
    await this.requireLogin('QQ 音乐臻品音质需要先登录 QQ 音乐。');
    const sourceTrackId = extractSourceTrackId(track);
    const sourceMediaId = String(
      (track && track.sourceMediaId) || sourceTrackId,
    ).trim();
    const sourceSongType = normalizeQQSongType(track && track.sourceSongType);
    const format = QQ_ENCRYPTED_QUALITIES[requestedQuality];
    const filename = `${format.family}${sourceMediaId}.${format.extension}`;
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const guid = buildGuid();
    const data = await this.requestQQEncryptedVkey(
      {
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
            guid,
          },
        },
      },
      guid,
    );
    const info =
      data &&
      data.queryvkey &&
      data.queryvkey.data &&
      Array.isArray(data.queryvkey.data.midurlinfo)
        ? data.queryvkey.data.midurlinfo.find(
            (item) => item && item.purl && item.ekey,
          )
        : null;
    const purl = info && String(info.purl || '');
    const ekey = info && String(info.ekey || '');
    if (!purl || !ekey) throw new Error('QQ 音乐未返回可解密的臻品媒体。');
    const sip =
      data.queryvkey.data && Array.isArray(data.queryvkey.data.sip)
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
      expiresAt,
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
      spatialAudio: format.family === 'Q0' ? 'metadata-only' : 'unsupported',
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
}

module.exports = { QQMusicStreamProvider };
