// 编写人：Aurora
// 依赖注入容器 - 管理服务生命周期和依赖关系
'use strict';

/**
 * 轻量级依赖注入容器
 *
 * 使用示例：
 * ```js
 * import { container } from './shared/container.js';
 *
 * // 注册服务
 * container.register('logger', () => new Logger());
 * container.register('api', (c) => new API(c.resolve('logger')));
 *
 * // 解析服务
 * const api = container.resolve('api');
 * ```
 */
export class Container {
  constructor() {
    /**
     * 服务注册表
     * @type {Map<string, {factory: Function, singleton: boolean}>}
     */
    this.services = new Map();

    /**
     * 单例缓存
     * @type {Map<string, any>}
     */
    this.singletons = new Map();

    /**
     * 正在解析的服务栈（用于检测循环依赖）
     * @type {Set<string>}
     */
    this.resolving = new Set();
  }

  /**
   * 注册服务
   * @param {string} name - 服务名称
   * @param {Function} factory - 工厂函数，接收容器作为参数
   * @param {Object} options - 配置选项
   * @param {boolean} [options.singleton=true] - 是否单例
   * @returns {Container} 返回自身，支持链式调用
   */
  register(name, factory, options = {}) {
    if (typeof factory !== 'function') {
      throw new TypeError(`Factory for "${name}" must be a function`);
    }

    this.services.set(name, {
      factory,
      singleton: options.singleton ?? true
    });

    return this;
  }

  /**
   * 解析服务
   * @param {string} name - 服务名称
   * @returns {any} 服务实例
   * @throws {Error} 服务未注册或存在循环依赖
   */
  resolve(name) {
    // 检查单例缓存
    if (this.singletons.has(name)) {
      return this.singletons.get(name);
    }

    // 检查服务是否注册
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service "${name}" is not registered`);
    }

    // 检测循环依赖
    if (this.resolving.has(name)) {
      const chain = Array.from(this.resolving).join(' -> ');
      throw new Error(`Circular dependency detected: ${chain} -> ${name}`);
    }

    try {
      // 标记正在解析
      this.resolving.add(name);

      // 调用工厂函数创建实例
      const instance = service.factory(this);

      // 单例模式：缓存实例
      if (service.singleton) {
        this.singletons.set(name, instance);
      }

      return instance;
    } finally {
      // 解析完成，移除标记
      this.resolving.delete(name);
    }
  }

  /**
   * 检查服务是否已注册
   * @param {string} name - 服务名称
   * @returns {boolean}
   */
  has(name) {
    return this.services.has(name);
  }

  /**
   * 注销服务（同时清除单例缓存）
   * @param {string} name - 服务名称
   */
  unregister(name) {
    this.services.delete(name);
    this.singletons.delete(name);
  }

  /**
   * 清空所有服务和缓存
   */
  clear() {
    this.services.clear();
    this.singletons.clear();
    this.resolving.clear();
  }

  /**
   * 获取所有已注册的服务名称
   * @returns {string[]}
   */
  getServiceNames() {
    return Array.from(this.services.keys());
  }

  /**
   * 预加载服务（立即创建单例实例）
   * @param {string} name - 服务名称
   */
  preload(name) {
    this.resolve(name);
  }

  /**
   * 批量预加载服务
   * @param {string[]} names - 服务名称数组
   */
  preloadAll(names) {
    names.forEach(name => this.preload(name));
  }
}

// 导出单例容器
export const container = new Container();

// 挂载到全局（方便调试）
if (typeof window !== 'undefined') {
  window.__DI_CONTAINER__ = container;
}
