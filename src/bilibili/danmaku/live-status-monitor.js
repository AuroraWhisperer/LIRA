// 编写人：Aurora
// 直播状态监控器 — 汇合实时通知与轮询，离线转开播时恢复监听。
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
    this.ownerName = '';
    this.localGeneration = 0;
    this.isLive = null;
  }

  start(roomInfo) {
    this.stop();
    this.stopped = false;

    if (roomInfo && roomInfo.ownerName) {
      this.ownerName = roomInfo.ownerName;
    }

    this.isLive = roomInfo ? Number(roomInfo.liveStatus) === 1 : null;
    if (!roomInfo) return;

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
    this.localGeneration += 1;
  }

  setReconnectInFlight(value) {
    this.reconnectInFlight = value;
  }

  observe(isLive, roomId) {
    if (this.stopped) return;
    // A newer socket event wins over a REST request already in flight.
    this.localGeneration += 1;
    this.isLive = isLive === true;
    this.onStatusChange({
      roomId,
      isLive: this.isLive,
      ownerName: this.ownerName,
      message: this.isLive ? '已开播' : '未开播，历史消息监听中',
    });
  }

  async checkLiveStatus() {
    if (this.stopped || this.checkInFlight || this.reconnectInFlight) return;

    this.checkInFlight = true;
    const localGeneration = this.localGeneration;
    try {
      const roomInfo = await this.apiClient.resolveRoomInfo();
      if (this.stopped || localGeneration !== this.localGeneration) return;
      if (roomInfo.ownerName) {
        this.ownerName = roomInfo.ownerName;
      }
      if (Number(roomInfo.liveStatus) === 1 && this.isLive !== true) {
        await this.triggerLiveStarted(roomInfo.roomId);
        return;
      }
      this.observe(Number(roomInfo.liveStatus) === 1, roomInfo.roomId);
    } finally {
      this.checkInFlight = false;
    }
  }

  async triggerLiveStarted(roomId) {
    if (this.stopped || this.reconnectInFlight) return;

    this.reconnectInFlight = true;
    this.stop();

    console.log(`[Bilibili][Live] action=started roomId=${roomId}`);
    this.onStatusChange({
      roomId,
      isLive: true,
      ownerName: this.ownerName,
      message: `已开播，正在重连礼物监听`,
    });

    try {
      await this.onLiveStarted(roomId);
    } finally {
      this.reconnectInFlight = false;
    }
  }
}

module.exports = { LiveStatusMonitor };
