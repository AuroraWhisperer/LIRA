// 编写人：Aurora
// 音乐提供商管理器 - 管理 QQ 音乐、网易云音乐等平台
'use strict';

/**
 * 音乐提供商管理器
 */
export class ProviderManager {
  constructor(options = {}) {
    this.state = options.state || null;
    this.onStateChange = options.onStateChange || (() => {});
    this.onError = options.onError || (() => {});

    // 提供商健康状态
    this.providerHealthBySource = new Map();
    // 认证状态
    this.authStateBySource = new Map();
    // 标记认证状态 API 是否不可用（避免重复请求404接口）
    this._authStateApiUnavailable = new Set();
  }

  /**
   * 刷新认证状态
   * @param {Object} options - 平台、强制刷新和渲染选项
   * @returns {Promise<Object|null>}
   */
  async refreshAuthState(options = {}) {
    const source = options.platform ?? this.state?.selectedSource;
    if (options.force) this._authStateApiUnavailable.delete(source);

    try {
      // 桌面版优先使用 Electron IPC
      if (window.musicAPI && typeof window.musicAPI.getAuthState === 'function') {
        const authState = await window.musicAPI.getAuthState(source);
        this.setAuthState(source, authState, options);
        return authState;
      }

      // Web 版：如果之前已知接口不可用，直接跳过
      if (this._authStateApiUnavailable.has(source)) {
        this.setAuthState(source, null, options);
        return null;
      }

      // Web 版回退到 HTTP API（如果后端实现了该接口）
      const response = await fetch('/api/music/auth-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: source }),
      });

      // Web 版可能没有实现此接口，404/501 时使用空状态并标记接口不可用
      if (response.status === 404 || response.status === 501) {
        this._authStateApiUnavailable.add(source);
        this.setAuthState(source, null, options);
        return null;
      }

      const readJson = this.readJsonResponse || ((r) => r.json());
      const data = await readJson(response, '获取认证状态失败');

      if (data.ok) {
        const authState = data.data || null;
        this.setAuthState(source, authState, options);
        return authState;
      }
      return null;
    } catch (error) {
      console.warn('[ProviderManager] Auth state unavailable:', error.message);
      return null;
    }
  }

  /**
   * 检查提供商健康状态
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async checkProviderHealth(options = {}) {
    const source = options.platform ?? this.state?.selectedSource;
    try {
      if (window.musicAPI && typeof window.musicAPI.providerHealth === 'function') {
        const healthState = await window.musicAPI.providerHealth(source);
        this.setProviderHealth(source, healthState, options);
        return healthState;
      }

      const platform = encodeURIComponent(source);
      const response = await fetch(`/api/music/health?platform=${platform}`);

      const readJson = this.readJsonResponse || ((r) => r.json());
      const data = await readJson(response, '健康检查失败');

      if (data.ok && data.data) {
        this.setProviderHealth(source, data.data, options);
        return data.data;
      } else {
        throw new Error(data.error || '健康检查失败');
      }
    } catch (error) {
      console.error('[ProviderManager] checkProviderHealth failed:', error);
      const healthState = {
        source,
        ok: false,
        status: 'error',
        message: error.message || String(error),
      };
      this.setProviderHealth(source, healthState, options);
      if (!options.silent) this.onError(error);
      throw error;
    }
  }

  /**
   * 获取提供商健康状态
   * @returns {Object|null}
   */
  getProviderHealth(platform = this.state?.selectedSource) {
    return this.providerHealthBySource.get(platform) ?? null;
  }

  /**
   * 获取认证状态
   * @returns {Object|null}
   */
  getAuthState(platform = this.state?.selectedSource) {
    return this.authStateBySource.get(platform) ?? null;
  }

  /** 保存指定平台的健康状态，并只通知当前平台。 */
  setProviderHealth(platform, healthState, options = {}) {
    this.providerHealthBySource.set(platform, healthState);
    if (this.state?.selectedSource !== platform) return;
    if (options.notify !== false) this.onStateChange();
  }

  /** 保存指定平台的认证状态，并只通知当前平台。 */
  setAuthState(platform, authState, options = {}) {
    this.authStateBySource.set(platform, authState);
    if (this.state?.selectedSource !== platform) return;
    if (options.notify !== false) this.onStateChange();
  }

  /**
   * 设置 JSON 响应读取函数
   * @param {Function} fn
   */
  setJsonResponseReader(fn) {
    this.readJsonResponse = fn;
  }
}
