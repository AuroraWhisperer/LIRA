// 编写人：Aurora
// 组件基类 - 自动管理事件监听器生命周期
'use strict';

/**
 * 组件基类 - 提供自动清理的事件管理
 */
export class Component {
  constructor() {
    this.listeners = [];
    this.isDestroyed = false;
  }

  /**
   * 添加事件监听（自动跟踪，destroy时清理）
   * @param {EventTarget} target - 监听目标
   * @param {string} event - 事件名
   * @param {Function} handler - 处理函数
   * @param {object} options - addEventListener选项
   */
  addListener(target, event, handler, options) {
    if (this.isDestroyed) {
      console.warn('[Component] 尝试在已销毁的组件上添加监听器');
      return;
    }

    target.addEventListener(event, handler, options);
    this.listeners.push({ target, event, handler, options });
  }

  /**
   * 移除特定监听器
   * @param {EventTarget} target
   * @param {string} event
   * @param {Function} handler
   */
  removeListener(target, event, handler) {
    const index = this.listeners.findIndex(
      l => l.target === target && l.event === event && l.handler === handler
    );
    if (index >= 0) {
      const listener = this.listeners[index];
      listener.target.removeEventListener(listener.event, listener.handler, listener.options);
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 销毁组件，清理所有监听器
   */
  destroy() {
    if (this.isDestroyed) return;

    this.listeners.forEach(({ target, event, handler, options }) => {
      target.removeEventListener(event, handler, options);
    });

    this.listeners = [];
    this.isDestroyed = true;
  }
}
