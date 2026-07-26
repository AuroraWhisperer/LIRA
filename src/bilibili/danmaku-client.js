// 编写人：Aurora
// Bilibili 直播弹幕 WebSocket 客户端。
// 从 server.js 提取，保持原始实现。通过 handlers 回调与外部通信。
'use strict';

const packetParser = require('./packet-parser');
const bilibiliHelpers = require('./helpers');
const wbiSigner = require('./wbi-signer');
const { SUPER_CHAT_PIN_THRESHOLD } = require('./superchat-service');
const {
  cleanText,
  normalizeTimestampMs,
  normalizeGuardLevel,
  normalizePositiveInteger,
  publicBilibiliErrorMessage,
  now
} = require('../shared/utils');

const BILIBILI_ONLINE_RANK_POLL_MS = 60 * 1000;
const BILIBILI_ONLINE_RANK_PAGE_SIZE = 50;
const BILIBILI_ONLINE_RANK_MAX_PAGES = 3;
const BILIBILI_IDENTITY_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const BILIBILI_LIVE_STATUS_POLL_MS = 10 * 60 * 1000;

class BilibiliDanmakuClient {
  constructor(roomId, handlers, options = {}) {
    this.roomId = cleanText(roomId);
    this.handlers = handlers;
    this.diagnostics = options.diagnostics || createEmptyDiagnostics();
    this.runtimeGiftCommandPrefixes = options.runtimeGiftCommandPrefixes || new Set();
    this.stopped = true;
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.historyTimer = null;
    this.onlineRankTimer = null;
    this.liveStatusTimer = null;
    this.liveStatusCheckInFlight = false;
    this.liveReconnectInFlight = false;
    this.seenCommandKeys = new Map();
    this.identityByUid = new Map();
    this.identityByName = new Map();
    this.startedAtMs = Date.now();
  }

  start() {
    this.stopped = false;
    this.startedAtMs = Date.now();
    this.connect().catch((error) => {
      console.warn(`[Bilibili] connect failed: ${error.message}`);
      if (!this.historyTimer) {
        this.startHistoryPolling(this.roomId);
      }
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '直播弹幕长连失败，历史消息监听中'
      });
      this.scheduleReconnect();
    });
  }

  async restart() {
    this.stopped = false;
    this.startedAtMs = Date.now();
    try {
      await this.connect({ waitForOpen: true });
    } catch (error) {
      console.warn(`[Bilibili] reconnect failed: ${error.message}`);
      if (!this.historyTimer) {
        this.startHistoryPolling(this.roomId);
      }
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '直播弹幕长连失败，历史消息监听中'
      });
      this.scheduleReconnect();
      throw error;
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.historyTimer);
    clearInterval(this.onlineRankTimer);
    clearInterval(this.liveStatusTimer);
    this.liveStatusTimer = null;
    this.closeSocket();
  }

  closeSocket() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch (_) {
        // Ignore shutdown errors.
      }
    }
  }

  async connect(options = {}) {
    this.report({
      connected: false,
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      message: '正在连接 Bilibili 弹幕服务'
    });

    const roomInfo = await this.resolveRoomInfo();
    const isLive = Number(roomInfo.liveStatus) === 1;
    if (!isLive || options.alwaysHistory) {
      this.startHistoryPolling(roomInfo.roomId);
    }
    this.startOnlineRankPolling(roomInfo.roomId, roomInfo.uid);
    this.startLiveStatusPolling(roomInfo);
    const danmuInfo = await this.resolveDanmuInfo(roomInfo.roomId);
    const host = (danmuInfo.host_list || [])[0];
    if (!host) {
      throw new Error('没有可用的弹幕服务器。');
    }

    this.closeSocket();
    const wsUrl = `wss://${host.host}:${host.wss_port || 443}/sub`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.sendPacket(7, 1, {
        uid: 0,
        roomid: roomInfo.roomId,
        protover: 3,
        platform: 'web',
        type: 2,
        key: danmuInfo.token
      });
      this.heartbeatTimer = setInterval(() => this.sendPacket(2, 1, {}), 30000);
      if (isLive) {
        clearInterval(this.historyTimer);
        this.historyTimer = null;
      }
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: isLive
          ? `已连接直播间 ${roomInfo.roomId}`
          : `直播间 ${roomInfo.roomId} 未开播，历史消息监听中；每 10 分钟自动检测开播`
      });
      if (!isLive) {
        console.warn(`[Bilibili] room ${roomInfo.roomId} is not live. live_status=${roomInfo.liveStatus}. History polling fallback is enabled.`);
      }
    });

    ws.addEventListener('message', async (event) => {
      if (this.ws !== ws) return;
      const data = event.data instanceof ArrayBuffer
        ? Buffer.from(event.data)
        : Buffer.from(await event.data.arrayBuffer());
      this.diagnostics.lastPacketAt = now();
      for (const message of parseBilibiliPackets(data)) {
        bilibiliHelpers.recordBilibiliCommandDiagnostic(this.diagnostics, message && message.cmd);
        if (message.cmd && String(message.cmd).startsWith('DANMU_MSG')) {
          const info = message.info || [];
          const userInfo = info[2] || [];
          const userMeta = extractBilibiliDanmakuUserMeta(info);
          const text = String(info[1] || '');
          const messageTimestamp = extractBilibiliDanmakuTimestamp(info);
          if (isBilibiliCommandText(text) && !isCapturableBilibiliTimestamp(messageTimestamp, this.startedAtMs)) {
            continue;
          }
          if (isBilibiliCommandText(text) && !this.rememberCommandMessage({
            uid: userInfo[0],
            message: text,
            timestampMs: messageTimestamp
          })) {
            continue;
          }
          const requester = this.resolveRequesterIdentity({
            uid: userInfo[0],
            userName: String(userInfo[1] || '观众'),
            requesterGuardLevel: userMeta.guardLevel,
            requesterMedalName: userMeta.medalName,
            requesterMedalLevel: userMeta.medalLevel
          });
          this.handlers.onMessage({
            message: text,
            uid: requester.uid,
            userName: requester.userName,
            requesterGuardLevel: requester.guardLevel,
            requesterMedalName: requester.medalName,
            requesterMedalLevel: requester.medalLevel,
            source: 'danmaku',
            messageTimestamp
          });
        } else if (message.cmd && String(message.cmd).startsWith('SUPER_CHAT_MESSAGE')) {
          const superChat = extractBilibiliSuperChatMessage(message);
          const text = superChat.message;
          const requester = this.resolveRequesterIdentity({
            uid: superChat.uid,
            userName: superChat.userName,
            requesterGuardLevel: superChat.guardLevel,
            requesterMedalName: superChat.medalName,
            requesterMedalLevel: superChat.medalLevel
          });
          this.handlers.onSuperChat({
            id: superChat.id,
            message: text,
            price: superChat.price,
            uid: requester.uid,
            userName: requester.userName,
            requesterGuardLevel: requester.guardLevel,
            requesterMedalName: requester.medalName,
            requesterMedalLevel: requester.medalLevel,
            source: 'superchat',
            messageTimestamp: superChat.messageTimestamp
          });
          if (!isBilibiliCommandText(text)) {
            continue;
          }
          if (!isCapturableBilibiliTimestamp(superChat.messageTimestamp, this.startedAtMs)) {
            continue;
          }
          if (!this.rememberCommandMessage({
            uid: superChat.uid || superChat.id,
            message: text,
            timestampMs: superChat.messageTimestamp
          })) {
            continue;
          }
          this.handlers.onMessage({
            message: text,
            uid: requester.uid,
            userName: requester.userName,
            requesterGuardLevel: requester.guardLevel,
            requesterMedalName: requester.medalName,
            requesterMedalLevel: requester.medalLevel,
            source: 'superchat',
            messageTimestamp: superChat.messageTimestamp,
            isPinned: superChat.price >= SUPER_CHAT_PIN_THRESHOLD
          });
        } else if (packetParser.isBilibiliGiftCommand(message.cmd, this.runtimeGiftCommandPrefixes)) {
          const gift = packetParser.extractBilibiliGiftMessage(message);
          if (!gift) {
            bilibiliHelpers.logUnparsedGiftLikeCommand(message, 'known-gift-command');
            bilibiliHelpers.recordBilibiliGiftDiagnostic(this.diagnostics, message.cmd, 'known-gift-command');
            continue;
          }
          this.diagnostics.lastGiftAt = now();
          this.diagnostics.parsedGiftCount += 1;
          const requester = this.resolveRequesterIdentity({
            uid: gift.uid,
            userName: gift.userName
          });
          this.handlers.onGift({
            ...gift,
            uid: requester.uid,
            userName: requester.userName
          });
        } else if (packetParser.isBilibiliGiftLikeCommand(message.cmd, this.runtimeGiftCommandPrefixes)) {
          bilibiliHelpers.logUnparsedGiftLikeCommand(message, 'gift-like-command');
          bilibiliHelpers.recordBilibiliGiftDiagnostic(this.diagnostics, message.cmd, 'gift-like-command');
        }
      }
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      clearInterval(this.heartbeatTimer);
      if (!this.stopped) {
        if (!this.historyTimer) {
          this.startHistoryPolling(this.roomId);
        }
        this.report({
          connected: Boolean(this.historyTimer),
          enabled: true,
          roomId: this.roomId,
          mode: 'bilibili',
          message: this.historyTimer ? '弹幕长连已断开，历史消息监听中' : '弹幕连接已断开，等待重连'
        });
        this.scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      if (this.ws !== ws) return;
      this.report({
        connected: false,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '弹幕连接出现错误'
      });
    });

    if (options.waitForOpen) {
      await this.waitForSocketOpen(ws);
    }
  }

  waitForSocketOpen(ws) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('弹幕 WebSocket 连接超时，请稍后重试。'));
      }, 8000);

      const cleanup = () => {
        clearTimeout(timeout);
        ws.removeEventListener('open', handleOpen);
        ws.removeEventListener('error', handleError);
        ws.removeEventListener('close', handleClose);
      };
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('弹幕 WebSocket 连接失败。'));
      };
      const handleClose = () => {
        cleanup();
        reject(new Error('弹幕 WebSocket 连接已关闭。'));
      };

      ws.addEventListener('open', handleOpen);
      ws.addEventListener('error', handleError);
      ws.addEventListener('close', handleClose);
    });
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
    console.log(`[Bilibili] room resolved: input=${this.roomId} room_id=${payload.data.room_id} short_id=${payload.data.short_id || 0} uid=${payload.data.uid || ''} live_status=${payload.data.live_status}`);
    return {
      roomId: payload.data.room_id,
      shortId: payload.data.short_id || 0,
      uid: payload.data.uid || '',
      liveStatus: payload.data.live_status
    };
  }

  async resolveDanmuInfo(roomId) {
    const query = await signBilibiliWbiParams({ id: roomId, type: 0 }, this.requestHeaders());
    const { payload, response } = await this.fetchJson(
      'getDanmuInfo',
      `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${query}`
    );
    if (payload.code !== 0 || !payload.data) {
      throw new Error(formatBilibiliApiError('getDanmuInfo', response, payload, '这是获取弹幕服务器信息失败，不是点歌逻辑失败。常见原因是 B 站风控、WBI 签名变化、缺少登录 Cookie 或网络/IP 被风控。'));
    }
    return payload.data;
  }

  startHistoryPolling(roomId) {
    clearInterval(this.historyTimer);
    this.pollHistory(roomId).catch((error) => {
      console.warn(`[Bilibili] history polling failed: ${error.message}`);
    });
    this.historyTimer = setInterval(() => {
      this.pollHistory(roomId).catch((error) => {
        console.warn(`[Bilibili] history polling failed: ${error.message}`);
      });
    }, 2500);
  }

  startOnlineRankPolling(roomId, ruid) {
    clearInterval(this.onlineRankTimer);
    if (!roomId || !ruid) return;
    this.pollOnlineRank(roomId, ruid).catch((error) => {
      console.warn(`[Bilibili] online rank polling failed: ${error.message}`);
    });
    this.onlineRankTimer = setInterval(() => {
      this.pollOnlineRank(roomId, ruid).catch((error) => {
        console.warn(`[Bilibili] online rank polling failed: ${error.message}`);
      });
    }, BILIBILI_ONLINE_RANK_POLL_MS);
  }

  startLiveStatusPolling(roomInfo) {
    clearInterval(this.liveStatusTimer);
    this.liveStatusTimer = null;

    if (!roomInfo || Number(roomInfo.liveStatus) === 1) return;

    this.liveStatusTimer = setInterval(() => {
      this.checkLiveStatusForReconnect().catch((error) => {
        console.warn(`[Bilibili] live status polling failed: ${error.message}`);
      });
    }, BILIBILI_LIVE_STATUS_POLL_MS);
    if (typeof this.liveStatusTimer.unref === 'function') {
      this.liveStatusTimer.unref();
    }
  }

  async checkLiveStatusForReconnect() {
    if (this.stopped || this.liveStatusCheckInFlight || this.liveReconnectInFlight) return;

    this.liveStatusCheckInFlight = true;
    try {
      const roomInfo = await this.resolveRoomInfo();
      if (Number(roomInfo.liveStatus) === 1) {
        await this.reconnectAfterLiveStarted(roomInfo.roomId);
        return;
      }

      this.report({
        connected: Boolean(this.ws) || Boolean(this.historyTimer),
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: `直播间 ${roomInfo.roomId} 未开播，历史消息监听中；每 10 分钟自动检测开播`
      });
    } finally {
      this.liveStatusCheckInFlight = false;
    }
  }

  async reconnectAfterLiveStarted(roomId) {
    if (this.stopped || this.liveReconnectInFlight) return;

    this.liveReconnectInFlight = true;
    clearInterval(this.liveStatusTimer);
    this.liveStatusTimer = null;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    clearInterval(this.historyTimer);
    this.historyTimer = null;

    console.log(`[Bilibili] room ${roomId} is live; reconnecting danmaku listener.`);
    this.report({
      connected: false,
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      message: `检测到直播间 ${roomId} 已开播，正在重连礼物监听`
    });

    try {
      this.startedAtMs = Date.now();
      await this.connect();
    } catch (error) {
      console.warn(`[Bilibili] reconnect after live start failed: ${error.message}`);
      this.report({
        connected: Boolean(this.historyTimer),
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: this.historyTimer
          ? '检测到开播，但直播弹幕长连重连失败，历史消息监听中'
          : publicBilibiliErrorMessage(error, true)
      });
      this.scheduleReconnect();
    } finally {
      this.liveReconnectInFlight = false;
    }
  }

  async pollOnlineRank(roomId, ruid) {
    if (this.stopped) return;
    let cachedCount = 0;

    for (let page = 1; page <= BILIBILI_ONLINE_RANK_MAX_PAGES; page += 1) {
      const url = `https://api.live.bilibili.com/xlive/general-interface/v1/rank/getOnlineGoldRank?roomId=${encodeURIComponent(roomId)}&ruid=${encodeURIComponent(ruid)}&page=${page}&pageSize=${BILIBILI_ONLINE_RANK_PAGE_SIZE}`;
      const { payload, response } = await this.fetchJson('online_gold_rank', url);
      if (payload.code !== 0 || !payload.data) {
        console.warn(formatBilibiliApiError('online_gold_rank', response, payload, '在线榜身份缓存获取失败。'));
        return;
      }

      const items = readBilibiliOnlineRankItems(payload.data);
      if (items.length === 0) break;

      for (const item of items) {
        if (this.rememberRequesterIdentity(extractBilibiliOnlineRankUserMeta(item))) {
          cachedCount += 1;
        }
      }

      const onlineNum = normalizePositiveInteger(payload.data.onlineNum || payload.data.online_num);
      if (items.length < BILIBILI_ONLINE_RANK_PAGE_SIZE) break;
      if (onlineNum > 0 && page * BILIBILI_ONLINE_RANK_PAGE_SIZE >= onlineNum) break;
    }

    this.cleanupRequesterIdentityCache();
    if (cachedCount > 0) {
      console.log(`[Bilibili] online rank cached ${cachedCount} viewer identity record(s).`);
    }
  }

  async pollHistory(roomId) {
    if (this.stopped) return;
    const { payload, response } = await this.fetchJson(
      'gethistory',
      `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${encodeURIComponent(roomId)}`
    );
    if (payload.code !== 0 || !payload.data) {
      console.warn(formatBilibiliApiError('gethistory', response, payload, '历史消息补偿监听失败。'));
      return;
    }

    const messages = []
      .concat(Array.isArray(payload.data.admin) ? payload.data.admin : [])
      .concat(Array.isArray(payload.data.room) ? payload.data.room : []);
    messages.sort((a, b) => parseBilibiliTimeline(a.timeline) - parseBilibiliTimeline(b.timeline));

    let processed = 0;
    for (const item of messages) {
      const text = cleanText(item.text);
      if (!text) continue;
      const timelineMs = parseBilibiliTimeline(item.timeline);
      if (!isBilibiliCommandText(text)) continue;
      if (!isCapturableBilibiliTimestamp(timelineMs, this.startedAtMs)) continue;
      if (!this.rememberCommandMessage({
        uid: item.uid,
        message: text,
        timestampMs: timelineMs
      })) {
        continue;
      }
      processed += 1;
      const userMeta = extractBilibiliHistoryUserMeta(item);
      const requester = this.resolveRequesterIdentity({
        uid: item.uid,
        userName: String(item.nickname || item.uname || '观众'),
        requesterGuardLevel: userMeta.guardLevel,
        requesterMedalName: userMeta.medalName,
        requesterMedalLevel: userMeta.medalLevel
      });
      this.handlers.onMessage({
        message: text,
        uid: requester.uid,
        userName: requester.userName,
        requesterGuardLevel: requester.guardLevel,
        requesterMedalName: requester.medalName,
        requesterMedalLevel: requester.medalLevel,
        source: 'history',
        messageTimestamp: timelineMs
      });
    }

    if (processed > 0) {
      console.log(`[Bilibili] history polling processed ${processed} command message(s).`);
    }
  }

  rememberCommandMessage({ uid, message, timestampMs }) {
    const key = buildBilibiliCommandKey(uid, message, timestampMs);
    if (!key) return false;
    if (this.seenCommandKeys.has(key)) return false;

    const receivedAt = Date.now();
    this.seenCommandKeys.set(key, receivedAt);
    if (this.seenCommandKeys.size > 1000) {
      const cutoff = receivedAt - 30 * 60 * 1000;
      for (const [seenKey, seenAt] of this.seenCommandKeys) {
        if (seenAt < cutoff || this.seenCommandKeys.size > 500) {
          this.seenCommandKeys.delete(seenKey);
        }
      }
    }
    return true;
  }

  resolveRequesterIdentity(input) {
    const uid = cleanText(input && input.uid);
    const userName = cleanText(input && input.userName) || '观众';
    const cached = this.lookupRequesterIdentity(uid, userName);
    const merged = mergeRequesterIdentity({
      uid,
      userName,
      guardLevel: normalizeGuardLevel(input && input.requesterGuardLevel),
      medalName: cleanText(input && input.requesterMedalName),
      medalLevel: normalizePositiveInteger(input && input.requesterMedalLevel)
    }, cached);
    this.rememberRequesterIdentity(merged);
    return merged;
  }

  lookupRequesterIdentity(uid, userName) {
    const nowMs = Date.now();
    const uidKey = cleanText(uid);
    const uidIdentity = uidKey ? this.identityByUid.get(uidKey) : null;
    if (uidIdentity && nowMs - uidIdentity.seenAt <= BILIBILI_IDENTITY_CACHE_MAX_AGE_MS) {
      return uidIdentity;
    }

    const nameKey = requesterNameKey(userName);
    const nameIdentity = nameKey ? this.identityByName.get(nameKey) : null;
    if (nameIdentity && nowMs - nameIdentity.seenAt <= BILIBILI_IDENTITY_CACHE_MAX_AGE_MS) {
      return nameIdentity;
    }
    return null;
  }

  rememberRequesterIdentity(input) {
    const identity = normalizeRequesterIdentity(input);
    if (!identity.uid && !identity.userName) return false;
    if (!identity.guardLevel && !identity.medalLevel && !identity.medalName) return false;

    const previous = this.lookupRequesterIdentity(identity.uid, identity.userName);
    const merged = {
      ...mergeRequesterIdentity(identity, previous),
      seenAt: Date.now()
    };

    if (merged.uid) this.identityByUid.set(merged.uid, merged);
    const nameKey = requesterNameKey(merged.userName);
    if (nameKey) this.identityByName.set(nameKey, merged);
    return true;
  }

  cleanupRequesterIdentityCache() {
    const cutoff = Date.now() - BILIBILI_IDENTITY_CACHE_MAX_AGE_MS;
    for (const [uid, identity] of this.identityByUid) {
      if (!identity || identity.seenAt < cutoff) this.identityByUid.delete(uid);
    }
    for (const [name, identity] of this.identityByName) {
      if (!identity || identity.seenAt < cutoff) this.identityByName.delete(name);
    }
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
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Origin': 'https://live.bilibili.com',
      'Referer': `https://live.bilibili.com/${encodeURIComponent(this.roomId)}`
    };
  }

  sendPacket(operation, version, body) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const header = Buffer.alloc(16);
    header.writeUInt32BE(16 + payload.length, 0);
    header.writeUInt16BE(16, 4);
    header.writeUInt16BE(version, 6);
    header.writeUInt32BE(operation, 8);
    header.writeUInt32BE(1, 12);
    this.ws.send(Buffer.concat([header, payload]));
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.stopped) {
        this.connect().catch((error) => {
          console.warn(`[Bilibili] reconnect failed: ${error.message}`);
          const historyFallbackActive = Boolean(this.historyTimer);
          this.report({
            connected: historyFallbackActive,
            enabled: true,
            roomId: this.roomId,
            mode: 'bilibili',
            message: historyFallbackActive
              ? '直播弹幕长连重连失败，历史消息监听中'
              : publicBilibiliErrorMessage(error, true)
          });
          this.scheduleReconnect();
        });
      }
    }, 5000);
  }

  report(status) {
    this.handlers.onStatus(status);
  }
}

function createEmptyDiagnostics() {
  return {
    lastPacketAt: '',
    lastCommandAt: '',
    lastGiftAt: '',
    parsedGiftCount: 0,
    unparsedGiftCount: 0,
    commandCounts: {},
    recentCommands: [],
    recentGiftLikeCommands: []
  };
}

function parseBilibiliPackets(buffer) {
  return packetParser.parseBilibiliPackets(buffer);
}

function extractBilibiliDanmakuTimestamp(info) {
  return packetParser.extractBilibiliDanmakuTimestamp(info);
}

function extractBilibiliDanmakuUserMeta(info) {
  return packetParser.extractBilibiliDanmakuUserMeta(info);
}

function extractBilibiliHistoryUserMeta(item) {
  return packetParser.extractBilibiliHistoryUserMeta(item);
}

function extractBilibiliSuperChatMessage(packet) {
  return packetParser.extractBilibiliSuperChatMessage(packet);
}

function extractBilibiliOnlineRankUserMeta(item) {
  return packetParser.extractBilibiliOnlineRankUserMeta(item);
}

function isCapturableBilibiliTimestamp(timestampMs, startedAtMs) {
  return bilibiliHelpers.isCapturableBilibiliTimestamp(timestampMs, startedAtMs);
}

function buildBilibiliCommandKey(uid, message, timestampMs) {
  return bilibiliHelpers.buildBilibiliCommandKey(uid, message, timestampMs);
}

function readBilibiliOnlineRankItems(data) {
  return bilibiliHelpers.readBilibiliOnlineRankItems(data);
}

function isBilibiliCommandText(message) {
  const text = cleanText(message);
  return text.startsWith('点歌') || text.startsWith('随机');
}

function normalizeRequesterIdentity(input) {
  return {
    uid: cleanText(input && input.uid),
    userName: cleanText(input && input.userName),
    guardLevel: normalizeGuardLevel(input && input.guardLevel),
    medalName: cleanText(input && input.medalName),
    medalLevel: normalizePositiveInteger(input && input.medalLevel),
    seenAt: normalizePositiveInteger(input && input.seenAt)
  };
}

function mergeRequesterIdentity(primary, fallback) {
  const base = normalizeRequesterIdentity(primary);
  const extra = normalizeRequesterIdentity(fallback);
  return {
    uid: base.uid || extra.uid,
    userName: chooseRequesterUserName(base.userName, extra.userName),
    guardLevel: base.guardLevel || extra.guardLevel,
    medalName: base.medalName || extra.medalName,
    medalLevel: base.medalLevel || extra.medalLevel,
    seenAt: Math.max(base.seenAt, extra.seenAt)
  };
}

function chooseRequesterUserName(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  if (isMaskedDisplayName(primary) && !isMaskedDisplayName(fallback)) {
    return fallback;
  }
  return primary;
}

function isMaskedDisplayName(value) {
  return /\*{2,}/.test(cleanText(value));
}

function requesterNameKey(value) {
  return cleanText(value).toLowerCase();
}

function parseBilibiliTimeline(value) {
  return normalizeTimestampMs(value);
}

async function signBilibiliWbiParams(params, headers) {
  return wbiSigner.signBilibiliWbiParams(params, headers);
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

module.exports = { BilibiliDanmakuClient };
