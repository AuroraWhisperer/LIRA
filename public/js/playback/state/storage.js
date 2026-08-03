// 编写人：Aurora
// 播放状态持久化存储管理器
'use strict';

import { normalizeState, validateState } from './manager.js';

const STORAGE_KEY_V1 = 'songAssistantPlaybackState:v1';
const STORAGE_KEY_V2 = 'playbackState:v2';
const CLIENT_ID = 'default';
const SAVE_DEBOUNCE_MS = 1500;

/**
 * 存储管理器类
 */
export class StorageManager {
  constructor() {
    this.saveTimer = null;
    this.savePending = null;
  }

  /**
   * 保存状态到 localStorage（带防抖）
   * @param {Object} state - 要保存的状态
   * @param {boolean} immediate - 是否立即保存
   * @returns {Promise<void>}
   */
  async saveState(state, immediate = false) {
    if (immediate) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      return this._doSave(state);
    }

    // 防抖保存
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    return new Promise((resolve, reject) => {
      this.savePending = { resolve, reject };
      this.saveTimer = setTimeout(async () => {
        this.saveTimer = null;
        const pending = this.savePending;
        this.savePending = null;
        try {
          await this._doSave(state);
          if (pending) pending.resolve();
        } catch (error) {
          if (pending) pending.reject(error);
        }
      }, SAVE_DEBOUNCE_MS);
    });
  }

  /**
   * 执行实际的保存操作
   * @param {Object} state - 要保存的状态
   * @returns {Promise<void>}
   */
  async _doSave(state) {
    try {
      // 准备要保存的数据（排除临时字段）
      const toSave = {
        current: state.current,
        currentOrigin: state.currentOrigin,
        requestedQueue: state.requestedQueue,
        normalQueue: state.normalQueue,
        normalQueueTracks: state.normalQueueTracks,
        radioQueue: state.radioQueue,
        queueType: state.queueType,
        queueTitle: state.queueTitle,
        queueSourceKey: state.queueSourceKey,
        playlistIndex: state.playlistIndex,
        history: state.history.slice(-50), // 只保留最近 50 条
        displayHistory: state.displayHistory.slice(-20), // 只保留最近 20 条
        mode: state.mode,
        volume: state.volume,
        selectedSource: state.selectedSource,
        shuffleOrder: state.shuffleOrder,
        shuffleCursor: state.shuffleCursor,
        restoredTime: 0, // 不保存播放位置
        clientId: CLIENT_ID,
        timestamp: Date.now()
      };

      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(toSave));
    } catch (error) {
      console.error('[StorageManager] Save failed:', error);
      throw error;
    }
  }

  /**
   * 从 localStorage 恢复状态
   * @returns {Promise<Object|null>} 恢复的状态，失败返回 null
   */
  async restoreState() {
    try {
      // 尝试加载 v2 数据
      const v2Data = localStorage.getItem(STORAGE_KEY_V2);
      if (v2Data) {
        const parsed = JSON.parse(v2Data);
        if (validateState(parsed)) {
          return normalizeState(parsed);
        }
      }

      // 尝试迁移 v1 数据
      const migrated = await this._migrateFromV1();
      if (migrated) {
        return migrated;
      }

      return null;
    } catch (error) {
      console.error('[StorageManager] Restore failed:', error);
      return null;
    }
  }

  /**
   * 从 v1 格式迁移数据
   * @returns {Promise<Object|null>}
   */
  async _migrateFromV1() {
    try {
      const v1Data = localStorage.getItem(STORAGE_KEY_V1);
      if (!v1Data) return null;

      const parsed = JSON.parse(v1Data);
      const migrated = normalizeState(parsed);

      // 保存到 v2 格式
      await this._doSave(migrated);

      // 删除 v1 数据
      localStorage.removeItem(STORAGE_KEY_V1);

      console.log('[StorageManager] Migrated from v1 to v2');
      return migrated;
    } catch (error) {
      console.error('[StorageManager] Migration failed:', error);
      return null;
    }
  }

  /**
   * 清空存储的状态
   */
  clearState() {
    localStorage.removeItem(STORAGE_KEY_V2);
    localStorage.removeItem(STORAGE_KEY_V1);
  }

  /**
   * 检查是否有保存的状态
   * @returns {boolean}
   */
  hasStoredState() {
    return Boolean(localStorage.getItem(STORAGE_KEY_V2) || localStorage.getItem(STORAGE_KEY_V1));
  }

  /**
   * 获取存储的时间戳
   * @returns {number|null}
   */
  getStoredTimestamp() {
    try {
      const v2Data = localStorage.getItem(STORAGE_KEY_V2);
      if (v2Data) {
        const parsed = JSON.parse(v2Data);
        return parsed.timestamp || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 取消待处理的保存操作
   */
  cancelPendingSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.savePending) {
      this.savePending.reject(new Error('Save cancelled'));
      this.savePending = null;
    }
  }
}
