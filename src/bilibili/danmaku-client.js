// 编写人：Aurora
// Bilibili 直播弹幕 WebSocket 客户端。
// 从 server.js 提取，保持原始实现。通过 handlers 回调与外部通信。
'use strict';

const { cleanText, publicBilibiliErrorMessage } = require('../shared/utils');
const { BilibiliApiClient } = require('./danmaku/api-client');
const { WebSocketConnection } = require('./danmaku/websocket-connection');
const { HistoryPoller } = require('./danmaku/history-poller');
const { OnlineRankPoller } = require('./danmaku/online-rank-poller');
const { LiveStatusMonitor } = require('./danmaku/live-status-monitor');
const { IdentityCache } = require('./danmaku/identity-cache');
const { MessageDeduplicator } = require('./danmaku/message-deduplicator');
const { MessageHandlers } = require('./danmaku/message-handlers');

class BilibiliDanmakuClient {
  constructor(roomId, handlers, options = {}) {
    this.roomId = cleanText(roomId);
    this.handlers = handlers;
    this.diagnostics = options.diagnostics || createEmptyDiagnostics();
    this.runtimeGiftCommandPrefixes = options.runtimeGiftCommandPrefixes || new Set();
    this.messageBuffer = options.messageBuffer || null;
    this.stopped = true;
    this.reconnectTimer = null;
    this.startedAtMs = Date.now();

    // 初始化子模块
    const bilibiliAuth = options.bilibiliAuth || {};
    this.apiClient = new BilibiliApiClient(this.roomId, {
      cookieHeader: bilibiliAuth.cookieHeader || '',
      uid: bilibiliAuth.uid || 0
    });
    this.wsConnection = new WebSocketConnection();
    this.identityCache = new IdentityCache();
    this.deduplicator = new MessageDeduplicator();
    this.messageHandlers = new MessageHandlers(
      this.handlers,
      this.identityCache,
      this.deduplicator,
      this.diagnostics,
      {
        runtimeGiftCommandPrefixes: this.runtimeGiftCommandPrefixes,
        startedAtMs: this.startedAtMs,
        messageBuffer: this.messageBuffer
      }
    );
    this.historyPoller = new HistoryPoller(
      this.apiClient,
      (messageData) => this.handleHistoryMessage(messageData),
      { startedAtMs: this.startedAtMs }
    );
    this.onlineRankPoller = new OnlineRankPoller(this.apiClient, this.identityCache);
    this.liveStatusMonitor = new LiveStatusMonitor(
      this.apiClient,
      (roomId) => this.reconnectAfterLiveStarted(roomId),
      (status) => this.handleLiveStatusChange(status)
    );
  }

  start() {
    this.stopped = false;
    this.startedAtMs = Date.now();
    this.messageHandlers.updateStartTime(this.startedAtMs);
    this.historyPoller.updateStartTime(this.startedAtMs);

    this.connect().catch((error) => {
      console.warn(`[Bilibili] connect failed: ${error.message}`);
      this.historyPoller.start(this.roomId);
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
    this.messageHandlers.updateStartTime(this.startedAtMs);
    this.historyPoller.updateStartTime(this.startedAtMs);

    try {
      await this.connect({ waitForOpen: true });
    } catch (error) {
      console.warn(`[Bilibili] reconnect failed: ${error.message}`);
      this.historyPoller.start(this.roomId);
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
    clearTimeout(this.reconnectTimer);
    this.wsConnection.close();
    this.historyPoller.stop();
    this.onlineRankPoller.stop();
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

  async connect(options = {}) {
    this.report({
      connected: false,
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      message: '正在连接 Bilibili 弹幕服务'
    });

    const roomInfo = await this.apiClient.resolveRoomInfo();
    const isLive = Number(roomInfo.liveStatus) === 1;

    if (!isLive || options.alwaysHistory) {
      this.historyPoller.start(roomInfo.roomId);
    }
    this.onlineRankPoller.start(roomInfo.roomId, roomInfo.uid);
    this.liveStatusMonitor.start(roomInfo);

    const danmuInfo = await this.apiClient.resolveDanmuInfo(roomInfo.roomId);
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

    // 设置 WebSocket 事件处理
    this.wsConnection.on('open', () => {
      if (isLive) {
        this.historyPoller.stop();
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

    this.wsConnection.on('message', async (data) => {
      await this.messageHandlers.handlePackets(data);
    });

    this.wsConnection.on('close', () => {
      if (!this.stopped) {
        this.historyPoller.start(this.roomId);
        this.report({
          connected: Boolean(this.historyPoller.timer),
          enabled: true,
          roomId: this.roomId,
          mode: 'bilibili',
          message: this.historyPoller.timer ? '弹幕长连已断开，历史消息监听中' : '弹幕连接已断开，等待重连'
        });
        this.scheduleReconnect();
      }
    });

    this.wsConnection.on('error', () => {
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
    if (this.deduplicator.remember(messageData.uid, messageData.message, messageData.messageTimestamp)) {
      const requester = this.identityCache.resolve({
        uid: messageData.uid,
        userName: messageData.userName,
        requesterGuardLevel: messageData.requesterGuardLevel,
        requesterMedalName: messageData.requesterMedalName,
        requesterMedalLevel: messageData.requesterMedalLevel
      });
      this.handlers.onMessage({
        message: messageData.message,
        uid: requester.uid,
        userName: requester.userName,
        requesterGuardLevel: requester.guardLevel,
        requesterMedalName: requester.medalName,
        requesterMedalLevel: requester.medalLevel,
        source: messageData.source,
        messageTimestamp: messageData.messageTimestamp
      });
    }
  }

  handleLiveStatusChange(status) {
    this.report({
      connected: Boolean(this.wsConnection.ws) || Boolean(this.historyPoller.timer),
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      message: status.message
    });
  }

  async reconnectAfterLiveStarted(roomId) {
    if (this.stopped) return;

    this.liveStatusMonitor.setReconnectInFlight(true);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.historyPoller.stop();

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
      this.messageHandlers.updateStartTime(this.startedAtMs);
      this.historyPoller.updateStartTime(this.startedAtMs);
      await this.connect();
    } catch (error) {
      console.warn(`[Bilibili] reconnect after live start failed: ${error.message}`);
      this.report({
        connected: Boolean(this.historyPoller.timer),
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: this.historyPoller.timer
          ? '检测到开播，但直播弹幕长连重连失败，历史消息监听中'
          : publicBilibiliErrorMessage(error, true)
      });
      this.scheduleReconnect();
    } finally {
      this.liveStatusMonitor.setReconnectInFlight(false);
    }
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.stopped) {
        this.connect().catch((error) => {
          console.warn(`[Bilibili] reconnect failed: ${error.message}`);
          const historyFallbackActive = Boolean(this.historyPoller.timer);
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

module.exports = { BilibiliDanmakuClient };
