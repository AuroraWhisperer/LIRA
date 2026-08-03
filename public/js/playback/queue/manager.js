// 编写人：Aurora
// 队列管理器 - 负责队列操作、播放模式、随机播放
'use strict';

/**
 * 队列管理器类
 */
export class QueueManager {
  constructor(options = {}) {
    this.state = options.state || null;
    this.radioRefillThreshold = options.radioRefillThreshold || 3;
    this.radioRefillBatchSize = options.radioRefillBatchSize || 10;
    this.radioRefillRunning = false;
  }

  /**
   * 获取活动队列
   * @returns {Array}
   */
  getActiveQueue() {
    if (!this.state) return [];
    if (this.state.queueType === 'radio') {
      return this.state.radioQueue;
    }
    return this.state.normalQueue;
  }

  /**
   * 获取活动队列来源
   * @returns {string}
   */
  getActiveOrigin() {
    if (!this.state) return '';
    return this.state.queueType === 'radio' ? 'radio' : 'normal';
  }

  /**
   * 计算队列总数
   * @returns {number}
   */
  getTotalCount() {
    if (!this.state) return 0;
    if (this.state.queueType === 'playlist') {
      return this.state.normalQueueTracks.length;
    }
    return this.getActiveQueue().length;
  }

  /**
   * 插入曲目到队列开头（下一首）
   * @param {Array} tracks - 曲目列表
   */
  insertTracksNext(tracks) {
    if (!this.state) return;
    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return;

    this.state.requestedQueue = [];

    if (this.state.queueType === 'radio') {
      this.state.radioQueue.unshift(...items);
    } else {
      this.state.radioQueue = [];
      this.state.normalQueue.unshift(...items);

      if (this.state.queueType === 'playlist') {
        const insertAt = Math.max(0, Math.min(
          this.state.normalQueueTracks.length,
          this.state.playlistIndex + 1
        ));
        this.state.normalQueueTracks.splice(insertAt, 0, ...items.map((track) => ({ ...track })));
      } else {
        this.state.queueType = 'queue';
        this.state.queueTitle = '播放队列';
        this.state.queueSourceKey = '';
      }
    }
  }

  /**
   * 清空队列
   */
  clearQueue() {
    if (!this.state) return;
    this.state.requestedQueue = [];
    this.state.normalQueue = [];
    this.state.normalQueueTracks = [];
    this.state.radioQueue = [];
    this.state.queueType = 'queue';
    this.state.queueTitle = '播放队列';
    this.state.queueSourceKey = '';
    this.state.playlistIndex = -1;
    this.state.shuffleOrder = [];
    this.state.shuffleCursor = 0;
  }

  /**
   * 从队列中移除曲目
   * @param {string} origin - 队列来源
   * @param {number} index - 索引
   * @returns {Object|null} 移除的曲目
   */
  removeTrack(origin, index) {
    if (!this.state) return null;
    const queueName = String(origin || '');
    const activeOrigin = this.getActiveOrigin();
    const queue = queueName === activeOrigin ? this.getActiveQueue() : null;

    if (!queue || !Number.isInteger(index) || index < 0 || index >= queue.length) {
      return null;
    }

    const track = queue.splice(index, 1)[0];

    // 如果是播放列表模式，同时从完整列表中移除
    if (this.state.queueType === 'playlist') {
      const sourceIndex = this.state.normalQueueTracks.findIndex(
        (item, itemIndex) => itemIndex > this.state.playlistIndex && item.id === track.id
      );
      if (sourceIndex >= 0) {
        this.state.normalQueueTracks.splice(sourceIndex, 1);
      }
    }

    return track;
  }

  /**
   * 取出下一首曲目
   * @returns {Object|null} {origin, track}
   */
  takeNext() {
    if (!this.state) return null;

    // 优先处理普通队列
    if (this.state.queueType !== 'radio' && this.state.normalQueue.length > 0) {
      let track;

      if (this.state.mode === 'shuffle') {
        track = this._takeNextShuffleTrack();
      } else {
        track = this.state.normalQueue.shift();
      }

      if (track && this.state.queueType === 'playlist') {
        if (this.state.mode === 'sequence') {
          this.state.playlistIndex = Math.min(
            this.state.normalQueueTracks.length - 1,
            this.state.playlistIndex + 1
          );
        } else {
          this.state.playlistIndex = this.state.normalQueueTracks.findIndex(
            (item) => item.id === track.id
          );
        }
      }

      if (track) return { origin: 'normal', track };
    }

    // 处理电台队列
    if (this.state.queueType === 'radio' && this.state.radioQueue.length > 0) {
      const track = this.state.radioQueue.shift();
      return { origin: 'radio', track };
    }

    return null;
  }

  /**
   * 随机模式下取出下一首
   * @private
   * @returns {Object|null}
   */
  _takeNextShuffleTrack() {
    if (!this.state) return null;

    const order = this.state.shuffleOrder || [];
    if (order.length === 0 || this.state.shuffleCursor >= order.length) {
      return this.state.normalQueue.shift();
    }

    const nextIndex = order[this.state.shuffleCursor];
    this.state.shuffleCursor++;

    if (nextIndex >= 0 && nextIndex < this.state.normalQueue.length) {
      return this.state.normalQueue.splice(nextIndex, 1)[0];
    }

    return this.state.normalQueue.shift();
  }

  /**
   * 重建随机播放顺序
   */
  rebuildShuffleOrder() {
    if (!this.state) return;

    const queue = this.state.normalQueue;
    if (!Array.isArray(queue) || queue.length === 0) {
      this.state.shuffleOrder = [];
      this.state.shuffleCursor = 0;
      return;
    }

    // 生成索引数组并打乱
    const indices = queue.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    this.state.shuffleOrder = indices;
    this.state.shuffleCursor = 0;
  }

  /**
   * 跳转到播放列表指定位置
   * @param {number} index - 目标索引
   * @returns {Object|null} 目标曲目
   */
  jumpToPlaylistTrack(index) {
    if (!this.state) return null;
    if (this.state.queueType !== 'playlist') return null;
    if (!Number.isInteger(index) || index < 0 || index >= this.state.normalQueueTracks.length) {
      return null;
    }

    const track = this.state.normalQueueTracks[index];
    if (!track) return null;

    this.state.playlistIndex = index;
    this.state.normalQueue = this.state.normalQueueTracks.slice(index + 1);
    this.rebuildShuffleOrder();

    return track;
  }

  /**
   * 检查并补充电台队列
   * @param {Object} options - 配置选项
   * @returns {Promise<void>}
   */
  async ensureRadioQueueFilled(options = {}) {
    if (!this.state) return;
    if (this.state.queueType !== 'radio') return;
    if (this.radioRefillRunning) return;
    if (this.state.radioQueue.length >= this.radioRefillThreshold) return;

    this.radioRefillRunning = true;

    try {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: this.state.selectedSource,
          action: 'radio',
          limit: this.radioRefillBatchSize
        })
      });

      const readJson = options.readJsonResponse || ((r) => r.json());
      const payload = await readJson(response, '补充电台队列失败');

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '补充电台队列失败');
      }

      if (this.state.queueType !== 'radio') return;

      const normalizeTrack = options.normalizeTrack || ((t) => t);
      const tracks = Array.isArray(payload.data && payload.data.tracks)
        ? payload.data.tracks.map(normalizeTrack)
        : [];

      // 去重：避免添加最近播放过的曲目
      const recentIds = new Set(this.state.history.slice(-30).map((track) => track.id));

      for (const track of tracks) {
        if (recentIds.has(track.id)) continue;
        if (this.state.radioQueue.some((item) => item.id === track.id)) continue;
        this.state.radioQueue.push(track);
      }
    } catch (error) {
      console.warn('[QueueManager] radio refill failed:', error.message || error);
    } finally {
      this.radioRefillRunning = false;
    }
  }

  /**
   * 开始播放合集
   * @param {Array} tracks - 曲目列表
   * @param {number} startIndex - 起始索引
   * @param {string} queueType - 队列类型
   * @param {string} title - 队列标题
   * @param {string} sourceKey - 队列来源标识
   * @returns {Object|null} 第一首曲目
   */
  startCollection(tracks, startIndex = 0, queueType = 'queue', title = '播放队列', sourceKey = '') {
    if (!this.state) return null;

    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return null;

    const index = Math.max(0, Math.min(startIndex, items.length - 1));
    const first = items[index];

    this.state.requestedQueue = [];
    this.state.radioQueue = [];
    this.state.normalQueueTracks = queueType === 'playlist' ? [...items] : [];
    this.state.normalQueue = items.slice(index + 1);
    this.state.queueType = queueType;
    this.state.queueTitle = title || '播放队列';
    this.state.queueSourceKey = String(sourceKey || '');
    this.state.playlistIndex = queueType === 'playlist' ? index : -1;

    this.rebuildShuffleOrder();

    return first;
  }
}
