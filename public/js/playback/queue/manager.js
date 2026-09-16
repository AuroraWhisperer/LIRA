// 编写人：Aurora
// 队列管理器 - 负责队列操作、播放模式、随机播放
'use strict';

/**
 * 队列管理器类
 */
export class QueueManager {
  constructor(options = {}) {
    this.state = options.state || null;
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
        const insertAt = Math.max(
          0,
          Math.min(
            this.state.normalQueueTracks.length,
            this.state.playlistIndex + 1,
          ),
        );
        this.state.normalQueueTracks.splice(
          insertAt,
          0,
          ...items.map((track) => ({ ...track })),
        );
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

    if (
      !queue ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= queue.length
    ) {
      return null;
    }

    const track = queue.splice(index, 1)[0];

    // 如果是播放列表模式，同时从完整列表中移除
    if (this.state.queueType === 'playlist') {
      const sourceIndex = this.state.normalQueueTracks.findIndex(
        (item, itemIndex) =>
          itemIndex > this.state.playlistIndex && item.id === track.id,
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
            this.state.playlistIndex + 1,
          );
        } else {
          this.state.playlistIndex = this.state.normalQueueTracks.findIndex(
            (item) => item.id === track.id,
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
    if (!this.state.shuffleOrder.length) {
      this.rebuildShuffleOrder();
    }
    while (this.state.shuffleCursor < this.state.shuffleOrder.length) {
      const nextId = this.state.shuffleOrder[this.state.shuffleCursor];
      this.state.shuffleCursor += 1;
      const index = this.state.normalQueue.findIndex(
        (track) => track.id === nextId,
      );
      if (index >= 0) {
        return this.state.normalQueue.splice(index, 1)[0];
      }
    }
    return this.state.normalQueue.shift() || null;
  }

  /**
   * 重建随机播放顺序
   */
  rebuildShuffleOrder() {
    const ids = this.state.normalQueue.map((track) => track.id);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    this.state.shuffleOrder = ids;
    this.state.shuffleCursor = 0;
  }

  /**
   * 跳转到播放列表指定位置
   * @param {number} index - 目标索引
   * @returns {Object|null} 目标曲目
   */
  jumpToPlaylistTrack(index) {
    const tracks = this.state.normalQueueTracks;
    if (!tracks || index < 0 || index >= tracks.length) return null;
    const track = tracks[index];
    this.state.playlistIndex = index;
    this.state.normalQueue = tracks
      .slice(index + 1)
      .map((item) => ({ ...item }));
    this.state.radioQueue = [];
    this.rebuildShuffleOrder();

    return track;
  }

  /**
   * 将请求返回的曲目去重后补充到电台队列
   * @param {Array} tracks - 曲目列表
   */
  refillRadioQueue(tracks) {
    const recentIds = new Set(
      this.state.history.slice(-30).map((track) => track.id),
    );
    for (const track of tracks) {
      if (
        !recentIds.has(track.id) &&
        !this.state.radioQueue.some((item) => item.id === track.id)
      ) {
        this.state.radioQueue.push(track);
      }
    }
  }

  /**
   * 开始播放合集
   * @param {Array} tracks - 曲目列表
   * @param {number} selectedIndex - 起始索引
   * @param {string} queueType - 队列类型
   * @param {string} queueTitle - 队列标题
   * @param {string} queueSourceKey - 队列来源标识
   * @returns {Object|null} 第一首曲目
   */
  startCollection(
    tracks,
    selectedIndex,
    queueType,
    queueTitle = '',
    queueSourceKey = '',
  ) {
    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return;

    const index = Math.max(
      0,
      Math.min(items.length - 1, Number(selectedIndex) || 0),
    );
    const type = queueType === 'radio' ? 'radio' : 'playlist';

    this.state.requestedQueue = [];
    this.state.normalQueue = [];
    this.state.normalQueueTracks = [];
    this.state.radioQueue = [];
    this.state.queueType = type;
    this.state.queueTitle =
      queueTitle || (type === 'radio' ? '电台队列' : '歌单队列');
    this.state.queueSourceKey = String(queueSourceKey || '');
    this.state.playlistIndex = type === 'playlist' ? index : -1;
    this.state.shuffleOrder = [];
    this.state.shuffleCursor = 0;

    if (type === 'playlist') {
      this.state.normalQueueTracks = items.map((track) => ({ ...track }));
      this.state.normalQueue = items
        .slice(index + 1)
        .map((track) => ({ ...track }));
    } else {
      this.state.radioQueue = items
        .slice(index + 1)
        .map((track) => ({ ...track }));
    }

    return items[index];
  }

  appendTracks(tracks) {
    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return;

    this.state.requestedQueue = [];
    if (this.state.queueType === 'radio') {
      this.state.radioQueue.push(...items);
      return;
    }

    if (this.state.queueType !== 'playlist') {
      this.state.queueType = 'queue';
      this.state.queueTitle = '播放队列';
      this.state.queueSourceKey = '';
      this.state.normalQueueTracks = [];
      this.state.playlistIndex = -1;
    } else {
      this.state.normalQueueTracks.push(
        ...items.map((track) => ({ ...track })),
      );
    }
    this.state.radioQueue = [];
    this.state.normalQueue.push(...items);
  }

  insertAndPlayTrack(track) {
    if (!track) return null;
    this.state.requestedQueue = [];
    const origin = 'normal';

    if (this.state.queueType === 'playlist' && this.state.current) {
      const insertAt = Math.max(
        0,
        Math.min(
          this.state.normalQueueTracks.length,
          this.state.playlistIndex + 1,
        ),
      );
      this.state.normalQueueTracks.splice(insertAt, 0, { ...track });
      this.state.playlistIndex = insertAt;
      this.state.radioQueue = [];
    } else if (this.state.queueType === 'radio') {
      const historyTracks = [
        track,
        ...this.state.displayHistory.filter((item) => item.id !== track.id),
      ];
      return {
        shouldStartCollection: true,
        tracks: historyTracks,
        queueType: 'playlist',
        title: '历史播放',
      };
    } else {
      this.state.queueType = 'queue';
      this.state.queueTitle = '播放队列';
      this.state.queueSourceKey = '';
      this.state.normalQueueTracks = [];
      this.state.radioQueue = [];
      this.state.playlistIndex = -1;
    }
    this.rebuildShuffleOrder();
    return { track, origin };
  }

  takeQueueTrack(origin, index) {
    const queueName = String(origin || '');
    const activeOrigin = this.getActiveOrigin();
    const queue = queueName === activeOrigin ? this.getActiveQueue() : null;
    if (
      !queue ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= queue.length
    )
      return null;

    const track = queue.splice(index, 1)[0];
    if (this.state.queueType === 'playlist') {
      const sourceIndex = this.state.normalQueueTracks.findIndex(
        (item, itemIndex) =>
          itemIndex > this.state.playlistIndex && item.id === track.id,
      );
      if (sourceIndex >= 0) this.state.normalQueueTracks.splice(sourceIndex, 1);
      const insertAt = this.state.playlistIndex + 1;
      this.state.normalQueueTracks.splice(insertAt, 0, { ...track });
      this.state.playlistIndex = insertAt;
    }
    return {
      origin: activeOrigin,
      track,
    };
  }

  restartPlaylist(tracks) {
    const first = tracks[0];
    this.state.normalQueue = tracks.slice(1);
    this.state.playlistIndex = this.state.normalQueueTracks.findIndex(
      (track) => track.id === first.id,
    );
    return first;
  }
}
