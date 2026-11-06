// 编写人：Aurora
// 统一日志管理工具
'use strict';

/**
 * 日志工具 - 生产环境自动禁用调试日志
 */
export class Logger {
  constructor(namespace = 'App') {
    this.namespace = namespace;
    this.enabled = this._shouldEnable();
  }

  _shouldEnable() {
    // 开发环境检测
    const isDev =
      globalThis.location?.hostname === 'localhost' ||
      globalThis.location?.hostname === '127.0.0.1';
    return isDev;
  }

  debug(message, ...args) {
    if (this.enabled) {
      console.log(`[${this.namespace}]`, message, ...args);
    }
  }

  info(message, ...args) {
    console.info(`[${this.namespace}]`, message, ...args);
  }

  warn(message, ...args) {
    console.warn(`[${this.namespace}]`, message, ...args);
  }

  error(message, ...args) {
    console.error(`[${this.namespace}]`, message, ...args);
  }
}

// 导出默认实例
export const logger = new Logger('LIRA');
