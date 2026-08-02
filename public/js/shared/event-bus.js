// 编写人：Aurora
// 统一事件管理系统 - EventBus
'use strict';

/**
 * 事件总线 - 用于应用内跨模块通信
 *
 * 使用示例：
 * ```js
 * import { eventBus } from './shared/event-bus.js';
 *
 * // 订阅事件
 * eventBus.on('song:added', (data) => {
 *   console.log('新歌曲:', data.song);
 * });
 *
 * // 发布事件
 * eventBus.emit('song:added', { song: { id: 1, title: 'Test' } });
 *
 * // 取消订阅
 * eventBus.off('song:added', handler);
 *
 * // 一次性订阅
 * eventBus.once('playback:ready', () => {
 *   console.log('播放器已就绪');
 * });
 * ```
 */
export class EventBus {
  constructor() {
    /**
     * 事件监听器映射
     * @type {Map<string, Set<Function>>}
     */
    this.listeners = new Map();

    /**
     * 调试模式 - 打印所有事件
     * @type {boolean}
     */
    this.debug = false;
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名称
   * @param {Function} handler - 事件处理函数
   * @returns {Function} 取消订阅的函数
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event).add(handler);

    // 返回取消订阅的函数
    return () => this.off(event, handler);
  }

  /**
   * 取消订阅事件
   * @param {string} event - 事件名称
   * @param {Function} handler - 事件处理函数
   */
  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);

      // 如果没有监听器了，清理 Map
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * 发布事件
   * @param {string} event - 事件名称
   * @param {*} data - 事件数据
   */
  emit(event, data) {
    if (this.debug) {
      console.log(`[EventBus] ${event}`, data);
    }

    const handlers = this.listeners.get(event);
    if (handlers) {
      // 复制一份以避免在执行过程中修改集合
      const handlersCopy = Array.from(handlers);
      handlersCopy.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[EventBus] Error in handler for "${event}":`, error);
        }
      });
    }
  }

  /**
   * 一次性订阅事件（触发后自动取消订阅）
   * @param {string} event - 事件名称
   * @param {Function} handler - 事件处理函数
   */
  once(event, handler) {
    const wrapper = (data) => {
      handler(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  /**
   * 清除某个事件的所有监听器
   * @param {string} event - 事件名称
   */
  clear(event) {
    this.listeners.delete(event);
  }

  /**
   * 清除所有事件监听器
   */
  clearAll() {
    this.listeners.clear();
  }

  /**
   * 获取事件的监听器数量
   * @param {string} event - 事件名称
   * @returns {number}
   */
  listenerCount(event) {
    const handlers = this.listeners.get(event);
    return handlers ? handlers.size : 0;
  }

  /**
   * 获取所有事件名称
   * @returns {string[]}
   */
  eventNames() {
    return Array.from(this.listeners.keys());
  }

  /**
   * 启用调试模式
   */
  enableDebug() {
    this.debug = true;
  }

  /**
   * 禁用调试模式
   */
  disableDebug() {
    this.debug = false;
  }
}

// 导出单例
export const eventBus = new EventBus();

// 挂载到全局（向后兼容）
if (typeof window !== 'undefined') {
  if (!window.AdminApp) {
    window.AdminApp = {};
  }
  window.AdminApp.eventBus = eventBus;
}

/**
 * 常用事件名称常量
 */
export const Events = {
  // 歌曲相关
  SONG_ADDED: 'song:added',
  SONG_REMOVED: 'song:removed',
  SONG_UPDATED: 'song:updated',

  // 队列相关
  QUEUE_UPDATED: 'queue:updated',
  QUEUE_CLEARED: 'queue:cleared',

  // 播放相关
  PLAYBACK_STARTED: 'playback:started',
  PLAYBACK_PAUSED: 'playback:paused',
  PLAYBACK_RESUMED: 'playback:resumed',
  PLAYBACK_STOPPED: 'playback:stopped',
  PLAYBACK_TRACK_CHANGED: 'playback:track_changed',
  PLAYBACK_PROGRESS: 'playback:progress',

  // 礼物相关
  GIFT_RECEIVED: 'gift:received',
  GIFT_SPRINT_UPDATED: 'gift:sprint_updated',

  // 主题相关
  THEME_CHANGED: 'theme:changed',

  // 系统相关
  STATE_SAVED: 'state:saved',
  STATE_LOADED: 'state:loaded',
  ERROR_OCCURRED: 'error:occurred'
};
