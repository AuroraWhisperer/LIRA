// 编写人：Aurora
// 点歌队列导入服务 - 负责从点歌队列导入歌曲到播放队列
'use strict';

import { assertApiResponse } from '../../shared/json-response.js';
import { getSongRequestKey } from '../utils.js';

/**
 * 点歌队列导入服务类
 */
export class ImportService {
  constructor(options = {}) {
    this.matchService = options.matchService || null;
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.retryKeys = new Set();
  }

  /**
   * 从点歌队列导入歌曲
   * @param {Object} options - 选项
   * @returns {Promise<Object|null>} 导入结果 {imported, pending, skipped, tracks}，过时导入返回 null
   */
  async importFromSongQueue(options = {}) {
    const maxItems = options.maxItems || 30;
    const platforms = options.platforms || [];
    const isCurrent = options.isCurrent || (() => true);

    // 获取点歌队列
    const queueData = await this.fetchSongQueue(options.signal);
    if (!isCurrent()) return null;
    if (!queueData || !queueData.items || queueData.items.length === 0) {
      this.retryKeys.clear();
      return {
        empty: true,
        imported: 0,
        pending: 0,
        skipped: 0,
        tracks: [],
        importedRequestKeys: [],
      };
    }

    // 处理每个点歌项
    let imported = 0;
    let pending = 0;
    let skipped = 0;
    const importedTracks = [];
    const activeKeys = new Set(queueData.items.map(getSongRequestKey).filter(Boolean));
    const knownKeys = [
      ...(options.importedRequestKeys || []),
      ...(this.matchService?.getPendingRequests?.() || []).map((request) => request.songRequestKey),
    ];
    const importedRequestKeys = new Set(knownKeys.filter((key) => activeKeys.has(key)));
    const seenKeys = new Set(importedRequestKeys);
    const items = [];
    const retries = new Map();
    for (const item of queueData.items) {
      const key = getSongRequestKey(item);
      if (key && seenKeys.has(key)) {
        skipped++;
        continue;
      }
      if (key) seenKeys.add(key);
      if (this.retryKeys.has(key)) retries.set(key, item);
      else if (items.length < maxItems) items.push(item);
    }
    // 未尝试的条目优先，空位留给等待最久的失败项。
    for (const key of this.retryKeys) {
      if (!retries.has(key)) this.retryKeys.delete(key);
      else if (items.length < maxItems) items.push(retries.get(key));
    }

    for (const item of items) {
      const key = getSongRequestKey(item);
      if (!isCurrent()) return null;
      let result;
      try {
        result = await this.processQueueItem(item, platforms, isCurrent, options.signal);
      } catch (error) {
        if (!isCurrent()) return null;
        console.warn('[ImportService] process item failed:', error.message || error);
      }
      if (!isCurrent()) return null;
      this.retryKeys.delete(key);
      if (result?.type === 'imported') {
        importedTracks.push(result.track);
        imported++;
      } else if (result?.type === 'pending') {
        pending++;
      } else {
        if (key) this.retryKeys.add(key);
        skipped++;
        continue;
      }
      if (key) importedRequestKeys.add(key);
    }

    return {
      imported,
      pending,
      skipped,
      tracks: importedTracks,
      importedRequestKeys: [...importedRequestKeys],
    };
  }

  /**
   * 获取点歌队列数据
   * @private
   * @returns {Promise<Object>} {items: Array}
   */
  async fetchSongQueue(cancelSignal) {
    const timeout = AbortSignal.timeout(10000);
    const signal = cancelSignal ? AbortSignal.any([cancelSignal, timeout]) : timeout;
    const response = await fetch('/api/state', { signal });
    const payload = await this.readJsonResponse(response, '读取点歌队列失败');

    assertApiResponse(response, payload, '读取点歌队列失败');

    const queue = payload.data && payload.data.queue ? payload.data.queue : {};
    const items = [queue.current].concat(Array.isArray(queue.waiting) ? queue.waiting : []).filter(Boolean);

    return { items };
  }

  /**
   * 处理单个点歌项
   * @private
   * @param {Object} item - 点歌项
   * @param {Array} platforms - 平台列表
   * @param {Function} isCurrent - 当前导入是否仍有效
   * @returns {Promise<Object>} {type: 'imported'|'pending'|'skipped', track?: Object}
   */
  async processQueueItem(item, platforms, isCurrent = () => true, signal) {
    if (!this.matchService) {
      throw new Error('MatchService not initialized');
    }

    const matched = await this.matchService.matchQueueItem(item, platforms, undefined, { isCurrent, signal });

    if (!isCurrent() || !matched) {
      return { type: 'skipped' };
    }

    if (matched.autoAccept) {
      // 自动接受：直接导入
      return {
        type: 'imported',
        track: {
          ...matched.track,
          songRequestKey: getSongRequestKey(item),
          requestedBy: item.requester_name || item.requesterName || '观众',
        },
      };
    } else {
      // 需要确认：添加到待确认列表
      this.matchService.addPendingRequest(item, matched);
      return { type: 'pending' };
    }
  }
}
