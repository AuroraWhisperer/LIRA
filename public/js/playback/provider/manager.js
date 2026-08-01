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
    this.providerHealth = null;
    this.providerHealthBySource = new Map();
    // 认证状态
    this.authState = null;
    this.authStateBySource = new Map();
    // 标记认证状态 API 是否不可用（避免重复请求404接口）
    this._authStateApiUnavailable = new Set();
  }

  /**
   * 获取选中的音乐源名称
   * @returns {string}
   */
  getSelectedSourceName() {
    if (!this.state) return '';
    const map = { qq: 'QQ音乐', netease: '网易云音乐' };
    return map[this.state.selectedSource] || '';
  }

  /**
   * 刷新提供商状态
   * @param {Object} options - 平台、静默和渲染选项
   * @returns {Promise<Object|null>}
   */
  async refreshProviderState(options = {}) {
    const source = options.platform ?? this.state?.selectedSource;
    try {
      // 桌面版优先使用 Electron IPC
      if (window.musicAPI && typeof window.musicAPI.providerHealth === 'function') {
        const healthState = await window.musicAPI.providerHealth(source);
        this.setProviderHealth(source, healthState, options);
        return healthState;
      }

      // Web 版回退到 HTTP API（/api/music/health）
      const platform = encodeURIComponent(source);
      const response = await fetch(`/api/music/health?platform=${platform}`);

      const readJson = this.readJsonResponse || ((r) => r.json());
      const data = await readJson(response, '获取提供商状态失败');

      if (data.ok && data.data) {
        this.setProviderHealth(source, data.data, options);
        return data.data;
      }
      return null;
    } catch (error) {
      console.error('[ProviderManager] refreshProviderState failed:', error);
      if (!options.silent) this.onError(error);
      return null;
    }
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
        body: JSON.stringify({ platform: source })
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
      // 网络错误或其他错误，标记接口不可用（避免后续重复请求）
      if (error.message && error.message.includes('Failed to fetch')) {
        this._authStateApiUnavailable.add(source);
      }
      console.warn('[ProviderManager] refreshAuthState failed (this is normal for web version):', error.message);
      this.setAuthState(source, null, options);
      // Web 版没有认证接口是正常的，不需要显示错误
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
        message: error.message || String(error)
      };
      this.setProviderHealth(source, healthState, options);
      if (!options.silent) this.onError(error);
      throw error;
    }
  }

  /**
   * 登录提供商
   * @returns {Promise<void>}
   */
  async login() {
    try {
      const response = await fetch('/api/music/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: this.state.selectedSource })
      });

      const readJson = this.readJsonResponse || ((r) => r.json());
      const data = await readJson(response, '登录失败');

      if (data.ok) {
        await this.refreshAuthState({ force: true });
        this.onStateChange();
      } else {
        throw new Error(data.error || '登录失败');
      }
    } catch (error) {
      console.error('[ProviderManager] login failed:', error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * 登出提供商
   * @returns {Promise<void>}
   */
  async logout() {
    const platform = this.state.selectedSource;

    try {
      const response = await fetch('/api/music/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform })
      });

      const readJson = this.readJsonResponse || ((r) => r.json());
      const data = await readJson(response, '登出失败');

      if (data.ok) {
        this.authState = null;
        this.authStateBySource.set(platform, null);
        this.onStateChange();
      } else {
        throw new Error(data.error || '登出失败');
      }
    } catch (error) {
      console.error('[ProviderManager] logout failed:', error);
      this.onError(error);
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
    this.providerHealth = healthState;
    if (options.notify !== false) this.onStateChange();
  }

  /** 保存指定平台的认证状态，并只通知当前平台。 */
  setAuthState(platform, authState, options = {}) {
    this.authStateBySource.set(platform, authState);
    if (this.state?.selectedSource !== platform) return;
    this.authState = authState;
    if (options.notify !== false) this.onStateChange();
  }

  /**
   * 设置 JSON 响应读取函数
   * @param {Function} fn
   */
  setJsonResponseReader(fn) {
    this.readJsonResponse = fn;
  }

  /**
   * 清除平台数据（登出后）
   * @param {string} platform - 平台名称
   * @param {Object} state - 播放状态
   */
  clearPlatformData(platform, state) {
    if (!state) return;

    // 清除队列中的该平台曲目
    const clearQueue = (queue) => {
      if (!Array.isArray(queue)) return [];
      return queue.filter((track) => track.source !== platform);
    };

    state.requestedQueue = clearQueue(state.requestedQueue);
    state.normalQueue = clearQueue(state.normalQueue);
    state.normalQueueTracks = clearQueue(state.normalQueueTracks);
    state.radioQueue = clearQueue(state.radioQueue);
    state.history = clearQueue(state.history);
    state.displayHistory = clearQueue(state.displayHistory);

    // 如果当前播放的是该平台曲目，清除
    if (state.current && state.current.source === platform) {
      state.current = null;
      state.currentOrigin = '';
    }

    // 清除待确认请求
    if (Array.isArray(state.pendingRequests)) {
      state.pendingRequests = state.pendingRequests.filter(
        (item) => !item.track || item.track.source !== platform
      );
    }
  }

  /**
   * 规范化在线曲目
   * @param {Object} track - 原始曲目数据
   * @returns {Object} 规范化后的曲目
   */
  normalizeOnlineTrack(track) {
    if (!track) return null;

    return {
      id: track.id || '',
      source: track.source || '',
      title: track.title || track.name || '未知歌曲',
      artists: Array.isArray(track.artists) ? track.artists : [],
      album: track.album || '',
      coverUrl: track.coverUrl || track.cover || '',
      durationMs: track.durationMs || track.duration || 0,
      sourceTrackId: track.sourceTrackId || track.id || '',
      sourceAlbumId: track.sourceAlbumId || track.albumId || '',
      playable: track.playable !== false,
      vip: track.vip === true,
      lyrics: track.lyrics || null
    };
  }

  /**
   * 获取首选搜索平台列表
   * @returns {Array<string>}
   */
  getPreferredSearchPlatforms() {
    if (!this.state) return ['qq', 'netease'];

    const selected = this.state.selectedSource;
    const all = ['qq', 'netease'];

    // 将选中的平台放在首位
    return [selected, ...all.filter((p) => p !== selected)];
  }
}
