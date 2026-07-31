// 编写人：Aurora
// 开播状态监控器 — 定时检测直播间开播状态，开播后触发重连。
'use strict';

const BILIBILI_LIVE_STATUS_POLL_MS = 10 * 60 * 1000;

class LiveStatusMonitor {
  constructor(apiClient, onLiveStarted, onStatusChange) {
    this.apiClient = apiClient;
    this.onLiveStarted = onLiveStarted;
    this.onStatusChange = onStatusChange;
    this.timer = null;
    this.stopped = false;
    this.checkInFlight = false;
    this.reconnectInFlight = false;
  }

  start(roomInfo) {
    this.stop();
    this.stopped = false;

    if (!roomInfo || Number(roomInfo.liveStatus) === 1) return;

    this.timer = setInterval(() => {
      this.checkLiveStatus().catch((error) => {
        console.warn(`[Bilibili] live status polling failed: ${error.message}`);
      });
    }, BILIBILI_LIVE_STATUS_POLL_MS);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.stopped = true;
  }

  setReconnectInFlight(value) {
    this.reconnectInFlight = value;
  }

  async checkLiveStatus() {
    if (this.stopped || this.checkInFlight || this.reconnectInFlight) return;

    this.checkInFlight = true;
    try {
      const roomInfo = await this.apiClient.resolveRoomInfo();
      if (Number(roomInfo.liveStatus) === 1) {
        await this.triggerLiveStarted(roomInfo.roomId);
        return;
      }

      this.onStatusChange({
        roomId: roomInfo.roomId,
        isLive: false,
        message: `直播间 ${roomInfo.roomId} 未开播，历史消息监听中；每 10 分钟自动检测开播`
      });
    } finally {
      this.checkInFlight = false;
    }
  }

  async triggerLiveStarted(roomId) {
    if (this.stopped || this.reconnectInFlight) return;

    this.reconnectInFlight = true;
    this.stop();

    console.log(`[Bilibili] room ${roomId} is live; reconnecting danmaku listener.`);
    this.onStatusChange({
      roomId,
      isLive: true,
      message: `检测到直播间 ${roomId} 已开播，正在重连礼物监听`
    });

    try {
      await this.onLiveStarted(roomId);
    } finally {
      this.reconnectInFlight = false;
    }
  }
}

module.exports = { LiveStatusMonitor };
