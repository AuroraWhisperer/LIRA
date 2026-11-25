// 编写人：Aurora
// 队列管理器 - 负责队列操作、播放模式、随机播放
'use strict';

import { getQueueTrackKey } from '../utils.js';
import { addedPlaylistTracks, samePlaylistEntry, sourcePlaylistTracks } from './playlist-entries.js';

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
   * 插入曲目到队列开头（下一首）
   * @param {Array} tracks - 曲目列表
   */
  insertTracksNext(tracks) {
    if (!this.state) return;
    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return;

    this.state.requestedQueue = [];
    const entries = this.state.queueType === 'playlist' ? addedPlaylistTracks(this.state, items) : items;
    const nextItems = entries.map((track) => ({ ...track, playNext: true }));

    if (this.state.queueType === 'radio') {
      this.state.radioQueue.unshift(...nextItems);
    } else {
      this.state.radioQueue = [];
      this.state.normalQueue.unshift(...nextItems);

      if (this.state.queueType === 'playlist') {
        const insertAt = Math.max(0, Math.min(this.state.normalQueueTracks.length, this.state.playlistIndex + 1));
        this.state.normalQueueTracks.splice(insertAt, 0, ...entries);
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
    this.state.radioOffset = 0;
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
      this._removePlaylistEntry(track);
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
        const nextIndex = this.state.playlistIndex + 1;
        const nextTrack = this.state.normalQueueTracks[nextIndex];
        this.state.playlistIndex = samePlaylistEntry(nextTrack, track)
          ? nextIndex
          : this.state.normalQueueTracks.findIndex((item) => samePlaylistEntry(item, track));
      }

      if (track) delete track.playNext;
      if (track) return { origin: 'normal', track };
    }

    // 处理电台队列
    if (this.state.queueType === 'radio' && this.state.radioQueue.length > 0) {
      const track = this.state.radioQueue.shift();
      delete track.playNext;
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
    if (this.state.normalQueue[0]?.playNext) return this.state.normalQueue.shift();
    if (!this.state.shuffleOrder.length) {
      this.rebuildShuffleOrder();
    }
    while (this.state.shuffleCursor < this.state.shuffleOrder.length) {
      const nextId = this.state.shuffleOrder[this.state.shuffleCursor];
      this.state.shuffleCursor += 1;
      const index = this.state.normalQueue.findIndex((track) => getQueueTrackKey(track) === nextId);
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
    const ids = this.state.normalQueue.map(getQueueTrackKey);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    this.state.shuffleOrder = ids;
    this.state.shuffleCursor = 0;
  }

  getPreviousPlaylistIndex(previousTrack) {
    const { normalQueueTracks: tracks, current, playlistIndex } = this.state;
    if (this.state.queueType !== 'playlist' || !tracks.length) return -1;
    if (previousTrack) {
      if (previousTrack.playlistOccurrence !== undefined) {
        return tracks.findIndex((track) => samePlaylistEntry(track, previousTrack));
      }
      // Old history has no occurrence. Walk back from the cursor when several rows share its key.
      const key = getQueueTrackKey(previousTrack);
      const matches = [];
      for (let step = 1; step <= tracks.length; step++) {
        const index = (Math.max(0, playlistIndex) + tracks.length - step) % tracks.length;
        if (getQueueTrackKey(tracks[index]) === key) matches.push(index);
      }
      if (matches.length === 1) return matches[0];
      const byRequester = matches.filter((index) => (tracks[index].requestedBy || '') === (previousTrack.requestedBy || ''));
      return byRequester.find((index) => tracks[index].title === previousTrack.title) ?? byRequester[0] ?? -1;
    }
    const index = samePlaylistEntry(tracks[playlistIndex], current)
      ? playlistIndex
      : tracks.findIndex((track) => samePlaylistEntry(track, current));
    return (Math.max(0, index) - 1 + tracks.length) % tracks.length;
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
    this.state.normalQueue = tracks.slice(index + 1).map((item) => ({ ...item }));
    this.state.radioQueue = [];
    this.rebuildShuffleOrder();

    return track;
  }

  /**
   * 将请求返回的曲目去重后补充到电台队列
   * @param {Array} tracks - 曲目列表
   */
  refillRadioQueue(tracks) {
    const before = this.state.radioQueue.length;
    const recentIds = new Set(this.state.history.slice(-30).map((track) => track.id));
    if (this.state.current) recentIds.add(this.state.current.id);
    for (const track of tracks) {
      if (!recentIds.has(track.id) && !this.state.radioQueue.some((item) => item.id === track.id)) {
        this.state.radioQueue.push(track);
      }
    }
    return this.state.radioQueue.length - before;
  }

  /**
   * 开始播放合集
   * @param {Array} tracks - 曲目列表
   * @param {number} selectedIndex - 起始索引
   * @param {string} queueType - 队列类型
   * @param {string} queueTitle - 队列标题
   * @param {string} queueSourceKey - 队列来源标识
   * @param {number} radioOffset - 电台已读取的上游位置
   * @returns {Object|null} 第一首曲目
   */
  startCollection(tracks, selectedIndex, queueType, queueTitle = '', queueSourceKey = '', radioOffset) {
    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return;

    const index = Math.max(0, Math.min(items.length - 1, Number(selectedIndex) || 0));
    const type = queueType === 'radio' ? 'radio' : 'playlist';

    this.state.requestedQueue = [];
    this.state.normalQueue = [];
    this.state.normalQueueTracks = [];
    this.state.radioQueue = [];
    this.state.queueType = type;
    this.state.radioOffset = type === 'radio'
      ? (Number.isSafeInteger(radioOffset) && radioOffset >= 0 ? radioOffset : items.length) : 0;
    this.state.queueTitle = queueTitle || (type === 'radio' ? '电台队列' : '歌单队列');
    this.state.queueSourceKey = String(queueSourceKey || '');
    if (type === 'radio' && !this.state.queueSourceKey) {
      this.state.queueSourceKey = `${items[index].source || this.state.selectedSource}:radio`;
    }
    this.state.playlistIndex = type === 'playlist' ? index : -1;
    this.state.shuffleOrder = [];
    this.state.shuffleCursor = 0;

    if (type === 'playlist') {
      this.state.normalQueueTracks = queueSourceKey && items.every((track) => Number.isSafeInteger(track.playlistOccurrence))
        ? items.map((track) => ({ ...track })) : sourcePlaylistTracks(items);
      this.state.normalQueue = this.state.normalQueueTracks.slice(index + 1).map((track) => ({ ...track }));
      return this.state.normalQueueTracks[index];
    } else {
      this.state.radioQueue = items.slice(index + 1).map((track) => ({ ...track }));
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
      this.state.normalQueue.push(...items);
    } else {
      const entries = addedPlaylistTracks(this.state, items);
      this.state.normalQueueTracks.push(...entries);
      this.state.normalQueue.push(...entries.map((track) => ({ ...track })));
    }
    this.state.radioQueue = [];
  }

  insertAndPlayTrack(track) {
    if (!track) return null;
    this.state.requestedQueue = [];
    const origin = 'normal';

    if (this.state.queueType === 'playlist' && this.state.current) {
      const insertAt = Math.max(0, Math.min(this.state.normalQueueTracks.length, this.state.playlistIndex + 1));
      [track] = addedPlaylistTracks(this.state, [track]);
      this.state.normalQueueTracks.splice(insertAt, 0, { ...track });
      this.state.playlistIndex = insertAt;
      this.state.radioQueue = [];
    } else if (this.state.queueType === 'radio') {
      const historyTracks = [track, ...this.state.displayHistory.filter((item) => item.id !== track.id)];
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
    if (!queue || !Number.isInteger(index) || index < 0 || index >= queue.length) return null;

    const track = queue.splice(index, 1)[0];
    delete track.playNext;
    if (this.state.queueType === 'playlist') {
      this._removePlaylistEntry(track);
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
      (track) => samePlaylistEntry(track, first),
    );
    return first;
  }

  _removePlaylistEntry(track) {
    const index = this.state.normalQueueTracks.findIndex((item, i) => samePlaylistEntry(item, track) &&
      (track.playlistOccurrence !== undefined || i > this.state.playlistIndex));
    if (index < 0) return;
    this.state.normalQueueTracks.splice(index, 1);
    if (index < this.state.playlistIndex) this.state.playlistIndex--;
  }
}
