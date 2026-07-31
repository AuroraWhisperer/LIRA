// 编写人：Aurora
// 点歌队列导入服务 - 负责从点歌队列导入歌曲到播放队列
'use strict';

/**
 * 点歌队列导入服务类
 */
export class ImportService {
  constructor(options = {}) {
    this.matchService = options.matchService || null;
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.toast = options.toast || (() => {});
  }

  /**
   * 从点歌队列导入歌曲
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 导入结果 {imported, pending, skipped, tracks}
   */
  async importFromSongQueue(options = {}) {
    const maxItems = options.maxItems || 30;
    const platforms = options.platforms || [];

    // 获取点歌队列
    const queueData = await this.fetchSongQueue();
    if (!queueData || !queueData.items || queueData.items.length === 0) {
      this.toast('点歌队列为空');
      return {
        imported: 0,
        pending: 0,
        skipped: 0,
        tracks: []
      };
    }

    // 处理每个点歌项
    let imported = 0;
    let pending = 0;
    let skipped = 0;
    const importedTracks = [];
    const items = queueData.items.slice(0, maxItems);

    for (const item of items) {
      try {
        const result = await this.processQueueItem(item, platforms);

        if (result.type === 'imported') {
          importedTracks.push(result.track);
          imported++;
        } else if (result.type === 'pending') {
          pending++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.warn('[ImportService] process item failed:', error.message || error);
        skipped++;
      }
    }

    return {
      imported,
      pending,
      skipped,
      tracks: importedTracks
    };
  }

  /**
   * 获取点歌队列数据
   * @private
   * @returns {Promise<Object>} {items: Array}
   */
  async fetchSongQueue() {
    const response = await fetch('/api/state');
    const payload = await this.readJsonResponse(response, '读取点歌队列失败');

    if (!payload.ok) {
      throw new Error(payload.error || '读取点歌队列失败');
    }

    const queue = payload.data && payload.data.queue ? payload.data.queue : {};
    const items = [queue.current]
      .concat(Array.isArray(queue.waiting) ? queue.waiting : [])
      .filter(Boolean);

    return { items };
  }

  /**
   * 处理单个点歌项
   * @private
   * @param {Object} item - 点歌项
   * @param {Array} platforms - 平台列表
   * @returns {Promise<Object>} {type: 'imported'|'pending'|'skipped', track?: Object}
   */
  async processQueueItem(item, platforms) {
    if (!this.matchService) {
      throw new Error('MatchService not initialized');
    }

    const matched = await this.matchService.matchQueueItem(item, platforms);

    if (!matched) {
      return { type: 'skipped' };
    }

    if (matched.autoAccept) {
      // 自动接受：直接导入
      return {
        type: 'imported',
        track: {
          ...matched.track,
          requestedBy: item.requester_name || item.requesterName || '观众'
        }
      };
    } else {
      // 需要确认：添加到待确认列表
      this.matchService.addPendingRequest(item, matched);
      return { type: 'pending' };
    }
  }

  /**
   * 批量导入指定的点歌项
   * @param {Array} items - 点歌项列表
   * @param {Array} platforms - 平台列表
   * @returns {Promise<Object>} 导入结果
   */
  async importItems(items, platforms = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        imported: 0,
        pending: 0,
        skipped: 0,
        tracks: []
      };
    }

    let imported = 0;
    let pending = 0;
    let skipped = 0;
    const importedTracks = [];

    for (const item of items) {
      try {
        const result = await this.processQueueItem(item, platforms);

        if (result.type === 'imported') {
          importedTracks.push(result.track);
          imported++;
        } else if (result.type === 'pending') {
          pending++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.warn('[ImportService] import item failed:', error.message || error);
        skipped++;
      }
    }

    return {
      imported,
      pending,
      skipped,
      tracks: importedTracks
    };
  }
}
