'use strict';

const { zzcSign } = require('@jixun/qmweb-sign');
const {
  buildGuid,
  calcQQGtk,
  extractCookieValue,
  extractQQGtkSource,
  extractUin,
  hasQQMusicAuthCookie,
  stripJsonp,
} = require('./qq-provider-utils');

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_MUSICS_URL = 'https://u6.y.qq.com/cgi-bin/musics.fcg';
const REQUEST_TIMEOUT_MS = 10000;

class QQMusicClient {
  constructor(options = {}) {
    this.source = 'qq';
    this.getAuthState =
      typeof options.getAuthState === 'function'
        ? options.getAuthState
        : () => null;
    this.getCookieHeader =
      typeof options.getCookieHeader === 'function'
        ? options.getCookieHeader
        : () => '';
  }

  async requestPlaylistWrite(method, target, songInfo) {
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader);
    if (!uin) {
      const cookieNames = cookieHeader
        .split(';')
        .map((pair) => pair.trim().split('=')[0])
        .filter((name) => name)
        .join(', ');
      const debugInfo = cookieNames
        ? `找到的 Cookie: ${cookieNames}`
        : '未找到任何 Cookie';
      throw new Error(
        `没有从 QQ 音乐 Cookie 中读取到 QQ 号，请重新登录。\n调试信息：${debugInfo}`,
      );
    }
    const gtkSource = extractQQGtkSource(cookieHeader);
    if (!gtkSource) throw new Error('QQ 音乐登录 Cookie 不完整，请重新登录。');
    const gtk = calcQQGtk(gtkSource);

    const callKey = `music.musicasset.PlaylistDetailWrite.${method}`;
    const body = JSON.stringify({
      comm: {
        format: 'json',
        ct: 20,
        cv: 2241,
        platform: 'wk_v20',
        uid: uin,
        guid: extractCookieValue(cookieHeader, 'qqmusic_guid') || buildGuid(),
        uin,
        g_tk_new_20200303: gtk,
        g_tk: gtk,
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        needNewCode: 1,
      },
      [callKey]: {
        module: 'music.musicasset.PlaylistDetailWrite',
        method,
        param: {
          bFmtUtf8: true,
          dirId: target.dirId,
          dirName: target.dirName,
          tid: target.tid,
          v_songInfo: songInfo,
        },
      },
    });
    const url = new URL(QQ_MUSICS_URL);
    url.searchParams.set('_', String(Date.now()));
    url.searchParams.set('sign', zzcSign(body));
    const headers = await this.buildHeaders();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers.Origin = 'https://i2.y.qq.com';
    headers.Referer = 'https://i2.y.qq.com/';
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let data;
    try {
      data = JSON.parse(stripJsonp(text));
    } catch (error) {
      throw new Error(`QQ 音乐返回了非 JSON 响应：${error.message}`);
    }
    const inner = data && data[callKey];
    const retCode = inner && inner.data && inner.data.retCode;
    if (
      Number(data && data.code) !== 0 ||
      Number(inner && inner.code) !== 0 ||
      Number(retCode) !== 0
    ) {
      const code = inner && inner.code != null ? inner.code : data && data.code;
      const message =
        inner && inner.data && (inner.data.msg || inner.data.message);
      throw new Error(
        `QQ 音乐歌单写入失败（code=${code == null ? 'unknown' : code}${message ? `，${message}` : ''}）。`,
      );
    }
    return (
      inner.data.result || {
        dirId: target.dirId,
        tid: target.tid,
        songlist: [],
      }
    );
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
          cv: 0,
        },
      }),
    });
  }

  async requestMusicuPost(modules = {}, comm = {}) {
    const url = new URL(QQ_MUSICU_URL);
    const headers = await this.buildHeaders();
    headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...modules, comm }),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      return JSON.parse(stripJsonp(text));
    } catch (error) {
      throw new Error(`QQ 音乐返回了非 JSON 响应：${error.message}`);
    }
  }

  async requestMusicsClient(modules = {}) {
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader);
    const authst =
      extractCookieValue(cookieHeader, 'qm_keyst') ||
      extractCookieValue(cookieHeader, 'qqmusic_key');
    if (!uin || !authst)
      throw new Error('QQ 音乐登录 Cookie 不完整，请重新登录。');

    const comm = {
      _channelid: '20',
      _os_version: '6.2.9200-2',
      authst,
      ct: '19',
      cv: '2241',
      guid: extractCookieValue(cookieHeader, 'qqmusic_guid') || buildGuid(),
      patch: '118',
      tmeAppID: 'qqmusic',
      tmeLoginType:
        Number(extractCookieValue(cookieHeader, 'tmeLoginType')) || 2,
      uin,
    };
    for (const [field, cookieName] of [
      ['psrf_access_token_expiresAt', 'psrf_access_token_expiresAt'],
      ['psrf_qqaccess_token', 'psrf_qqaccess_token'],
      ['psrf_qqopenid', 'psrf_qqopenid'],
      ['psrf_qqunionid', 'psrf_qqunionid'],
    ]) {
      const value = extractCookieValue(cookieHeader, cookieName);
      if (value) comm[field] = value;
    }
    if (!comm.psrf_qqunionid) {
      const wxUnionId = extractCookieValue(cookieHeader, 'wxunionid');
      if (wxUnionId) comm.psrf_qqunionid = wxUnionId;
    }

    const url = new URL(QQ_MUSICS_URL);
    url.searchParams.set('pcachetime', String(Math.floor(Date.now() / 1000)));
    const headers = await this.buildHeaders();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ comm, ...modules }),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      return JSON.parse(stripJsonp(text));
    } catch (error) {
      throw new Error(`QQ 音乐返回了非 JSON 响应：${error.message}`);
    }
  }

  async requestQQEncryptedVkey(modules = {}, requestGuid = '') {
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const comm = {
      _channelid: '20',
      _os_version: '6.2.9200-2',
      ct: '19',
      cv: '2241',
      guid: String(
        requestGuid ||
          extractCookieValue(cookieHeader, 'qqmusic_guid') ||
          buildGuid(),
      ),
      patch: '118',
      tmeAppID: 'qqmusic',
      tmeLoginType:
        Number(extractCookieValue(cookieHeader, 'tmeLoginType')) || 2,
      uin,
    };
    for (const [field, cookieName] of [
      ['authst', 'qm_keyst'],
      ['psrf_access_token_expiresAt', 'psrf_access_token_expiresAt'],
      ['psrf_qqaccess_token', 'psrf_qqaccess_token'],
      ['psrf_qqopenid', 'psrf_qqopenid'],
      ['psrf_qqunionid', 'psrf_qqunionid'],
    ]) {
      const value = extractCookieValue(cookieHeader, cookieName);
      if (value) comm[field] = value;
    }
    if (!comm.authst)
      comm.authst = extractCookieValue(cookieHeader, 'qqmusic_key');
    const url = new URL(QQ_MUSICS_URL);
    url.searchParams.set('pcachetime', String(Math.floor(Date.now() / 1000)));
    const headers = await this.buildHeaders();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ comm, ...modules }),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      return JSON.parse(stripJsonp(text));
    } catch (error) {
      throw new Error(`QQ 音乐返回了非 JSON 响应：${error.message}`);
    }
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      'User-Agent': 'Mozilla/5.0 SongAssistant/1.0',
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
      return String((await this.getCookieHeader(this.source)) || '');
    } catch (_) {
      return '';
    }
  }

  async requireLogin(message) {
    const auth = await this.getSafeAuthState();
    const cookieHeader = await this.getSafeCookieHeader();
    if ((!auth || !auth.loggedIn) && !hasQQMusicAuthCookie(cookieHeader)) {
      throw new Error(message || '需要先登录 QQ 音乐。');
    }
    return auth;
  }

  async requireUin() {
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader);
    if (!uin) {
      // 诊断信息：显示找到的 Cookie 名称（不包含值）
      const cookieNames = cookieHeader
        .split(';')
        .map((pair) => pair.trim().split('=')[0])
        .filter((name) => name)
        .join(', ');
      const debugInfo = cookieNames
        ? `找到的 Cookie: ${cookieNames}`
        : '未找到任何 Cookie';
      throw new Error(
        `没有从 QQ 音乐 Cookie 中读取到 QQ 号，请重新登录。\n调试信息：${debugInfo}`,
      );
    }
    return uin;
  }
}

module.exports = {
  QQMusicClient,
};
