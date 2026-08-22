// 编写人：Aurora
// Bilibili 直播弹幕 WebSocket 客户端。
// 从 server.js 提取，保持原始实现。通过 handlers 回调与外部通信。
'use strict';

const { cleanText, publicBilibiliErrorMessage } = require('../shared/utils');
const { BilibiliApiClient } = require('./danmaku/api-client');
const { WebSocketConnection } = require('./danmaku/websocket-connection');
const { HistoryPoller } = require('./danmaku/history-poller');
const { OnlineRankPoller } = require('./danmaku/online-rank-poller');
const { FansMedalPoller } = require('./danmaku/fans-medal-poller');
const { LiveStatusMonitor } = require('./danmaku/live-status-monitor');
const { MessageDeduplicator } = require('./danmaku/message-deduplicator');
const { MessageHandlers } = require('./danmaku/message-handlers');
const { BilibiliUserProfileProvider } = require('./users/profile-provider');
const { UserInfoService } = require('./users/user-info-service');

class BilibiliDanmakuClient {
  constructor(roomId, handlers, options = {}) {
    this.roomId = cleanText(roomId);
    this.handlers = handlers;
    this.options = options;
    this.diagnostics = options.diagnostics || createEmptyDiagnostics();
    this.runtimeGiftCommandPrefixes = options.runtimeGiftCommandPrefixes || new Set();
    this.messageBuffer = options.messageBuffer || null;
    this.stopped = true;
    this.connectionGeneration = 0;
    this.connectionAttempt = 0;
    this.reconnectTimer = null;
    this.reconnecting = false;
    this.startedAtMs = Date.now();
    this.ownerName = '';
    this.ownerUid = '';
    this.roomRunContext = null;

    // 初始化子模块
    const bilibiliAuth = options.bilibiliAuth || {};
    this.apiClient = new BilibiliApiClient(this.roomId, {
      cookieHeader: bilibiliAuth.cookieHeader || '',
      uid: bilibiliAuth.uid || 0
    });
    this.wsConnection = new WebSocketConnection();
    this.ownsUserInfoService = !options.userInfoService;
    this.userInfoService = options.userInfoService || new UserInfoService({
      profileProvider: new BilibiliUserProfileProvider(this.apiClient),
      diagnostics: this.diagnostics
    });
    this.deduplicator = new MessageDeduplicator();
    this.messageHandlers = new MessageHandlers(
      {
        ...this.handlers,
        onMessage: (danmaku) => this.deliverDanmaku(danmaku)
      },
      this.userInfoService,
      this.deduplicator,
      this.diagnostics,
      {
        runtimeGiftCommandPrefixes: this.runtimeGiftCommandPrefixes,
        startedAtMs: this.startedAtMs,
        messageBuffer: this.messageBuffer,
        isCommandText: options.isCommandText
      }
    );
    this.historyPoller = new HistoryPoller(
      this.apiClient,
      (messageData) => this.handleHistoryMessage(messageData),
      {
        startedAtMs: this.startedAtMs,
        roomOwnerUid: '',
        isCommandText: options.isCommandText,
        deduplicator: this.deduplicator,
        onIdentityHint: (hint, context) => this.userInfoService.ingestHint(hint, context)
      }
    );
    const userInfoSink = {
      ingestHint: (hint, context) => this.userInfoService.ingestHint(hint, context),
      replaceOnlineSnapshot: (uids, context) => this.userInfoService.replaceOnlineSnapshot(uids, context)
    };
    this.onlineRankPoller = new OnlineRankPoller(this.apiClient, userInfoSink);
    this.fansMedalPoller = new FansMedalPoller(this.apiClient, userInfoSink);
    this.liveStatusMonitor = new LiveStatusMonitor(
      this.apiClient,
      (roomId) => this.reconnectAfterLiveStarted(roomId),
      (status) => this.handleLiveStatusChange(status)
    );
  }

  start() {
    this.stopped = false;
    this.reconnecting = false;
    const generation = ++this.connectionGeneration;
    this.startedAtMs = Date.now();
    this.messageHandlers.updateStartTime(this.startedAtMs);
    this.messageHandlers.updateConnectionGeneration(generation);
    this.historyPoller.updateStartTime(this.startedAtMs);

    this.connect({}, generation).catch((error) => {
      if (!this.isConnectionCurrent(generation)) return;
      console.warn(`[Bilibili] connect failed: ${error.message}`);
      this.reconnecting = true;
      if (this.roomRunContext) this.historyPoller.start(this.roomRunContext);
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '直播弹幕长连失败，历史消息监听中'
      });
      this.scheduleReconnect(generation);
    });
  }

  async restart() {
    this.stopped = false;
    this.reconnecting = false;
    const generation = ++this.connectionGeneration;
    this.startedAtMs = Date.now();
    this.messageHandlers.updateStartTime(this.startedAtMs);
    this.messageHandlers.updateConnectionGeneration(generation);
    this.historyPoller.updateStartTime(this.startedAtMs);

    try {
      await this.connect({ waitForOpen: true }, generation);
    } catch (error) {
      if (!this.isConnectionCurrent(generation)) return;
      console.warn(`[Bilibili] reconnect failed: ${error.message}`);
      this.reconnecting = true;
      if (this.roomRunContext) this.historyPoller.start(this.roomRunContext);
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '直播弹幕长连失败，历史消息监听中'
      });
      this.scheduleReconnect(generation);
      throw error;
    }
  }

  stop() {
    this.stopped = true;
    this.reconnecting = false;
    this.connectionGeneration += 1;
    clearTimeout(this.reconnectTimer);
    this.wsConnection.close();
    this.historyPoller.stop();
    this.onlineRankPoller.stop();
    this.fansMedalPoller.stop();
    if (this.roomRunContext) this.userInfoService.endRoomRun(this.roomRunContext);
    this.roomRunContext = null;
    if (this.ownsUserInfoService) this.userInfoService.dispose();
    this.liveStatusMonitor.stop();
    if (this.messageHandlers && typeof this.messageHandlers.destroy === 'function') {
      this.messageHandlers.destroy();
    }
  }

  // 向后兼容：暴露 ws 属性供测试使用
  get ws() {
    return this.wsConnection.ws;
  }

  // 向后兼容：暴露 rememberCommandMessage 方法供测试使用
  rememberCommandMessage({ uid, message, timestampMs }) {
    return this.deduplicator.remember(uid, message, timestampMs);
  }

  async sendDanmaku(message, reply = {}) {
    return this.apiClient.sendDanmaku(this.resolvedRoomId || this.roomId, message, reply);
  }

  getViewerCandidates() {
    return this.userInfoService.listOnline().map((snapshot) => {
      const medal = snapshot.fansMedal && snapshot.fansMedal.known
        ? snapshot.fansMedal.value
        : null;
      return {
        uid: snapshot.uid,
        userName: snapshot.name || '观众',
        avatarUrl: snapshot.avatarUrl,
        guardLevel: snapshot.guard && snapshot.guard.known ? snapshot.guard.level : 0,
        medalName: medal ? medal.name : '',
        medalLevel: medal ? medal.level : 0,
        seenAt: snapshot.updatedAt
      };
    });
  }

  async refreshViewerCandidates() {
    if (!this.roomRunContext) return;
    await this.onlineRankPoller.pollOnlineRank(this.roomRunContext);
  }

  deliverDanmaku(danmaku) {
    return this.handlers.onMessage(danmaku);
  }

  ensureUserInfo(uid, options = {}) {
    return this.userInfoService.ensure(uid, options);
  }

  async connect(options = {}, generation = this.connectionGeneration) {
    if (!this.isConnectionCurrent(generation)) return;
    const connectionAttempt = ++this.connectionAttempt;
    this.messageHandlers.updateConnectionAttempt(connectionAttempt);
    this.report({
      connected: false,
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      message: '正在连接 Bilibili 弹幕服务'
    });

    const roomInfo = await this.apiClient.resolveRoomInfo();
    if (!this.isConnectionCurrent(generation)) return;
    const isLive = Number(roomInfo.liveStatus) === 1;
    this.ownerName = roomInfo.ownerName || '';
    this.ownerUid = String(roomInfo.uid || '');
    const roomScope = this.userInfoService.setRoom({
      roomId: roomInfo.roomId,
      ownerUid: roomInfo.uid
    });
    if (!this.roomRunContext
      || this.roomRunContext.roomId !== roomScope.roomId
      || this.roomRunContext.ownerUid !== roomScope.ownerUid
      || this.roomRunContext.generation !== roomScope.generation) {
      if (this.roomRunContext) this.userInfoService.endRoomRun(this.roomRunContext);
      this.roomRunContext = this.userInfoService.beginRoomRun();
    }
    this.messageHandlers.updateRoomOwnerUid(roomInfo.uid);
    this.messageHandlers.updateRoomRunContext(this.roomRunContext);
    this.historyPoller.updateRoomOwnerUid(roomInfo.uid);

    if (!isLive || options.alwaysHistory) {
      this.historyPoller.start(this.roomRunContext);
    }
    this.onlineRankPoller.start(this.roomRunContext);
    this.fansMedalPoller.start(this.roomRunContext);
    this.liveStatusMonitor.start(roomInfo);

    const danmuInfo = await this.apiClient.resolveDanmuInfo(roomInfo.roomId);
    if (!this.isConnectionCurrent(generation)) return;
    const host = (danmuInfo.host_list || [])[0];
    if (!host) {
      throw new Error('没有可用的弹幕服务器。');
    }

    const wsUrl = `wss://${host.host}:${host.wss_port || 443}/sub`;
    const authPayload = {
      uid: this.apiClient.uid || 0,
      roomid: roomInfo.roomId,
      protover: 3,
      platform: 'web',
      type: 2,
      key: danmuInfo.token
    };

    // 存储解析后的房间号供后续使用
    this.resolvedRoomId = roomInfo.roomId;
    console.log(`[Bilibili][Connection] action=connecting trace=${JSON.stringify({
      connectionGeneration: generation,
      connectionAttempt,
      roomInput: this.roomId,
      roomId: roomInfo.roomId,
      endpoint: `${host.host}:${host.wss_port || 443}`
    })}`);

    // 清理旧的事件处理器，防止重连后消息重复处理
    this.wsConnection.clearHandlers();

    // 设置 WebSocket 事件处理
    this.wsConnection.on('open', () => {
      if (!this.isConnectionCurrent(generation)) return;
      console.log(`[Bilibili][Connection] action=open trace=${JSON.stringify({
        connectionGeneration: generation,
        connectionAttempt,
        roomId: roomInfo.roomId
      })}`);
      this.reconnecting = false;
      if (isLive && !this.options.alwaysHistory) {
        this.historyPoller.stop();
      }
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        ownerName: this.ownerName,
        message: isLive
          ? `已开播`
          : `未开播，历史消息监听中`
      });
      if (!isLive) {
        console.warn(`[Bilibili] room ${roomInfo.roomId} is not live. live_status=${roomInfo.liveStatus}. History polling fallback is enabled.`);
      }
    });

    this.wsConnection.on('message', async (data) => {
      if (!this.isConnectionCurrent(generation)) return;
      try {
        await this.messageHandlers.handlePackets(data);
      } catch (error) {
        console.warn('[Bilibili] message handler error:', error.message);
      }
    });

    this.wsConnection.on('close', (event) => {
      if (this.isConnectionCurrent(generation)) {
        console.log(`[Bilibili][Connection] action=close trace=${JSON.stringify({
          connectionGeneration: generation,
          connectionAttempt,
          roomId: this.resolvedRoomId || this.roomId,
          code: Number(event && event.code) || 0,
          reason: cleanText(event && event.reason),
          wasClean: Boolean(event && event.wasClean)
        })}`);
        const reconnectDelayMs = this.reconnecting ? 5000 : 0;
        this.reconnecting = true;
        this.historyPoller.start(this.roomRunContext);
        this.report({
          connected: Boolean(this.historyPoller.timer),
          enabled: true,
          roomId: this.roomId,
          mode: 'bilibili',
          ownerName: this.ownerName,
          message: this.historyPoller.timer ? '弹幕长连已断开，历史消息监听中' : '弹幕连接已断开，等待重连'
        });
        this.scheduleReconnect(generation, reconnectDelayMs);
      }
    });

    this.wsConnection.on('error', (event) => {
      if (!this.isConnectionCurrent(generation)) return;
      console.warn(`[Bilibili][Connection] action=error trace=${JSON.stringify({
        connectionGeneration: generation,
        connectionAttempt,
        roomId: this.resolvedRoomId || this.roomId,
        endpoint: `${host.host}:${host.wss_port || 443}`,
        readyState: this.wsConnection.ws ? this.wsConnection.ws.readyState : null,
        message: cleanText(event && (event.message || (event.error && event.error.message)))
      })}`);
      this.report({
        connected: false,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '弹幕连接出现错误'
      });
    });

    await this.wsConnection.connect(wsUrl, authPayload, options);
  }

  handleHistoryMessage(messageData) {
    if (this.stopped) return;
    const requester = compatibilityRequester(messageData.identitySnapshot, messageData);
    this.deliverDanmaku({
      message: messageData.message,
      uid: requester.uid,
      userName: requester.userName,
      avatarUrl: requester.avatarUrl,
      requesterGuardLevel: requester.guardLevel,
      requesterMedalName: requester.medalName,
      requesterMedalLevel: requester.medalLevel,
      source: messageData.source,
      messageTimestamp: messageData.messageTimestamp,
      connectionGeneration: this.connectionGeneration,
      connectionAttempt: this.connectionAttempt,
      cmd: 'HISTORY'
    });
  }

  handleLiveStatusChange(status) {
    if (this.stopped) return;
    if (status.ownerName) {
      this.ownerName = status.ownerName;
    }
    this.report({
      connected: Boolean(this.wsConnection.ws) || Boolean(this.historyPoller.timer),
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      ownerName: this.ownerName,
      message: status.message
    });
  }

  async reconnectAfterLiveStarted(roomId) {
    if (this.stopped) return;
    const generation = this.connectionGeneration;

    this.liveStatusMonitor.setReconnectInFlight(true);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.historyPoller.stop();

    this.report({
      connected: false,
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      ownerName: this.ownerName,
      message: `已开播，正在重连礼物监听`
    });

    try {
      this.startedAtMs = Date.now();
      this.messageHandlers.updateStartTime(this.startedAtMs);
      this.historyPoller.updateStartTime(this.startedAtMs);
      await this.connect({}, generation);
    } catch (error) {
      if (!this.isConnectionCurrent(generation)) return;
      console.warn(`[Bilibili] reconnect after live start failed: ${error.message}`);
      this.reconnecting = true;
      this.report({
        connected: Boolean(this.historyPoller.timer),
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        ownerName: this.ownerName,
        message: this.historyPoller.timer
          ? '已开播，但弹幕长连重连失败，历史消息监听中'
          : publicBilibiliErrorMessage(error, true)
      });
      this.scheduleReconnect(generation);
    } finally {
      this.liveStatusMonitor.setReconnectInFlight(false);
    }
  }

  scheduleReconnect(generation = this.connectionGeneration, delayMs = 5000) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.isConnectionCurrent(generation)) {
        this.connect({}, generation).catch((error) => {
          if (!this.isConnectionCurrent(generation)) return;
          console.warn(`[Bilibili] reconnect failed: ${error.message}`);
          this.reconnecting = true;
          const historyFallbackActive = Boolean(this.historyPoller.timer);
          this.report({
            connected: historyFallbackActive,
            enabled: true,
            roomId: this.roomId,
            mode: 'bilibili',
            ownerName: this.ownerName,
            message: historyFallbackActive
              ? '直播弹幕长连重连失败，历史消息监听中'
              : publicBilibiliErrorMessage(error, true)
          });
          this.scheduleReconnect(generation);
        });
      }
    }, delayMs);
  }

  isConnectionCurrent(generation) {
    return !this.stopped && generation === this.connectionGeneration;
  }

  report(status) {
    this.handlers.onStatus(status);
  }
}

function compatibilityRequester(snapshot, fallback = {}) {
  const medal = snapshot && snapshot.fansMedal && snapshot.fansMedal.known
    ? snapshot.fansMedal.value
    : null;
  return {
    uid: cleanText(snapshot && snapshot.uid) || cleanText(fallback.uid),
    userName: cleanText(snapshot && snapshot.name) || cleanText(fallback.userName) || '观众',
    avatarUrl: cleanText(snapshot && snapshot.avatarUrl) || cleanText(fallback.avatarUrl),
    guardLevel: snapshot && snapshot.guard && snapshot.guard.known
      ? snapshot.guard.level
      : Number(fallback.requesterGuardLevel) || 0,
    medalName: medal ? medal.name : cleanText(fallback.requesterMedalName),
    medalLevel: medal ? medal.level : Number(fallback.requesterMedalLevel) || 0
  };
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

module.exports = { BilibiliDanmakuClient };
