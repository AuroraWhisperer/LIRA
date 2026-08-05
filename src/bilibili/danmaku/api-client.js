// 编写人：Aurora
// Bilibili API 客户端 — 统一的 API 调用封装。
'use strict';

const wbiSigner = require('../wbi-signer');
const { cleanText } = require('../../shared/utils');
const { buildMentionedMessage } = require('./mention-policy');

class BilibiliApiClient {
  constructor(roomId, options = {}) {
    this.roomId = roomId;
    this.cookieHeader = options.cookieHeader || '';
    this.uid = options.uid || 0;
  }

  // 允许外部更新 cookie（运行时登录后）
  updateAuth(cookieHeader, uid) {
    this.cookieHeader = cookieHeader || '';
    this.uid = Number(uid) || 0;
  }

  async resolveRoomInfo() {
    if (!this.roomId) {
      throw new Error('请填写 Bilibili 直播间号，或直接粘贴 https://live.bilibili.com/房间号。');
    }
    const { payload, response } = await this.fetchJson(
      'room_init',
      `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(this.roomId)}`
    );
    if (payload.code !== 0 || !payload.data || !payload.data.room_id) {
      throw new Error(formatBilibiliApiError('room_init', response, payload, '请确认填写的是直播间地址里的房间号，不是主播 UID、昵称或个人主页 ID。也可以直接粘贴 https://live.bilibili.com/房间号。'));
    }
    const uid = payload.data.uid || '';
    let ownerName = '';
    if (uid) {
      try {
        ownerName = await this.fetchOwnerName(uid);
      } catch (e) {
        console.warn(`[Bilibili] failed to fetch owner name for uid=${uid}: ${e.message}`);
      }
    }
    console.log(`[Bilibili] room resolved: input=${this.roomId} room_id=${payload.data.room_id} short_id=${payload.data.short_id || 0} uid=${uid} owner=${ownerName || '(unknown)'} live_status=${payload.data.live_status}`);
    return {
      roomId: payload.data.room_id,
      shortId: payload.data.short_id || 0,
      uid,
      ownerName,
      liveStatus: payload.data.live_status
    };
  }

  async fetchOwnerName(uid) {
    const { payload } = await this.fetchJson(
      'master_info',
      `https://api.live.bilibili.com/live_user/v1/Master/info?uid=${encodeURIComponent(uid)}`
    );
    if (payload.code === 0 && payload.data && payload.data.info && payload.data.info.uname) {
      return payload.data.info.uname;
    }
    return '';
  }

  async fetchCurrentUserName() {
    if (!this.cookieHeader) return '';
    const { payload } = await this.fetchJson(
      'nav',
      'https://api.bilibili.com/x/web-interface/nav'
    );
    return cleanText(payload && payload.data && (payload.data.uname || payload.data.name));
  }

  async resolveDanmuInfo(roomId) {
    const query = await wbiSigner.signBilibiliWbiParams({ id: roomId, type: 0 }, this.requestHeaders());
    const { payload, response } = await this.fetchJson(
      'getDanmuInfo',
      `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${query}`
    );
    if (payload.code !== 0 || !payload.data) {
      throw new Error(formatBilibiliApiError('getDanmuInfo', response, payload, '这是获取弹幕服务器信息失败，不是点歌逻辑失败。常见原因是 B 站风控、WBI 签名变化、缺少登录 Cookie 或网络/IP 被风控。'));
    }
    return payload.data;
  }

  async fetchOnlineRank(roomId, ruid, page, pageSize) {
    const url = `https://api.live.bilibili.com/xlive/general-interface/v1/rank/getOnlineGoldRank?roomId=${encodeURIComponent(roomId)}&ruid=${encodeURIComponent(ruid)}&page=${page}&pageSize=${pageSize}`;
    const { payload, response } = await this.fetchJson('online_gold_rank', url);
    if (payload.code !== 0 || !payload.data) {
      throw new Error(formatBilibiliApiError('online_gold_rank', response, payload, '在线榜身份缓存获取失败。'));
    }
    return payload.data;
  }

  async fetchHistory(roomId) {
    const { payload, response } = await this.fetchJson(
      'gethistory',
      `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${encodeURIComponent(roomId)}`
    );
    if (payload.code !== 0 || !payload.data) {
      throw new Error(formatBilibiliApiError('gethistory', response, payload, '历史消息补偿监听失败。'));
    }
    return payload.data;
  }

  async sendDanmaku(roomId, message, reply = {}) {
    const rawText = String(message || '').trim();
    if (!this.cookieHeader) throw new Error('请先登录 Bilibili 账号。');
    const csrf = extractCookie(this.cookieHeader, 'bili_jct');
    if (!csrf) throw new Error('登录态缺少 bili_jct，无法发送弹幕。');
    if (!rawText || rawText.length > 1000) throw new Error('弹幕内容不能为空且不能超过 1000 个字符。');

    const mentioned = buildMentionedMessage(rawText, reply);
    const replyMid = mentioned.target.uid;
    const replyName = mentioned.target.name;
    const text = mentioned.message;
    if (text.length > 1000) throw new Error('包含 @ 点歌人后的弹幕不能超过 1000 个字符。');

    const form = new URLSearchParams({
      bubble: '0',
      csrf,
      csrf_token: csrf,
      fontsize: '25',
      mode: '1',
      msg: text,
      color: '16777215',
      rnd: String(Math.floor(Date.now() / 1000)),
      roomid: String(Number(roomId) || Number(this.roomId) || 0),
      room_type: '0'
    });
    if (replyMid) {
      form.set('reply_mid', replyMid);
      form.set('reply_attr', '0');
      if (replyName) form.set('reply_uname', replyName);
    }

    const response = await fetch('https://api.live.bilibili.com/msg/send', {
      method: 'POST',
      headers: {
        ...this.requestHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: form.toString()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(formatBilibiliApiError('send_danmaku', response, payload, '请确认账号已登录且具备在该直播间发言权限。'));
    }
    return { message: text, replyMid: replyMid || '', replyUname: replyName || '' };
  }

  async fetchJson(endpointName, url) {
    const quiet = endpointName === 'gethistory' || endpointName === 'online_gold_rank';
    if (!quiet) {
      console.log(`[Bilibili] request ${endpointName}: ${redactUrl(url)}`);
    }
    const response = await fetch(url, {
      headers: this.requestHeaders()
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new Error(`Bilibili API ${endpointName} returned non-JSON response. HTTP ${response.status}. Body: ${text.slice(0, 160)}`);
    }
    if (!quiet) {
      console.log(`[Bilibili] response ${endpointName}: http=${response.status} code=${payload.code} message=${payload.message || payload.msg || ''}`);
    }
    if (!response.ok) {
      throw new Error(formatBilibiliApiError(endpointName, response, payload, 'HTTP 请求失败。'));
    }
    return { payload, response };
  }

  requestHeaders() {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Origin': 'https://live.bilibili.com',
      'Referer': `https://live.bilibili.com/${encodeURIComponent(this.roomId)}`
    };
    if (this.cookieHeader) {
      headers['Cookie'] = this.cookieHeader;
    }
    return headers;
  }
}

function extractCookie(cookieHeader, name) {
  const match = String(cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function formatBilibiliApiError(endpointName, response, payload, extraHint) {
  const code = payload && payload.code;
  const message = (payload && (payload.message || payload.msg)) || '未知错误';
  const hint = bilibiliErrorHint(code);
  const data = payload && payload.data ? ` data=${JSON.stringify(payload.data).slice(0, 220)}` : '';
  return `Bilibili API ${endpointName} failed: http=${response.status} code=${code} message=${message}. ${hint}${extraHint ? ` ${extraHint}` : ''}${data}`;
}

function bilibiliErrorHint(code) {
  if (Number(code) === -352) {
    return '原因：B 站风控/校验失败，通常与 WBI 签名、正常浏览器请求头、Cookie/设备标识或当前网络/IP 风控有关。';
  }
  if (Number(code) === 60004) {
    return '原因：直播间不存在或填写的不是直播间号。';
  }
  if (Number(code) === -400) {
    return '原因：请求参数错误。';
  }
  if (Number(code) === -412) {
    return '原因：请求被风控拦截。';
  }
  return '原因：B 站接口返回了非成功业务码。';
}

function redactUrl(url) {
  return String(url).replace(/(w_rid=)[^&]+/g, '$1<redacted>');
}

module.exports = { BilibiliApiClient };
