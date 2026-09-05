// 编写人：Aurora
// 内容加载器 - 负责加载主页内容、歌单等
'use strict';

import { getHomeActionTitle } from '../utils.js';

/** 可缓存的 action 列表 */
export const CACHEABLE_ACTIONS = new Set([
  'liked',
  'created-playlists',
  'collected-playlists',
  'playlist-tracks',
]);

/**
 * 内容加载器
 */
export class ContentLoader {
  constructor(options = {}) {
    this.state = options.state || null;
    this.providerManager = options.providerManager || null;
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.cacheManager = options.cacheManager || null;
    /** 后台刷新完成回调： ({action, items, itemType, changed}) => void */
    this.onBackgroundUpdate = options.onBackgroundUpdate || null;

    // 主页内容缓存
    this.homeItems = [];
    this.homeItemType = '';
    this.homeAction = '';
    this.homePage = 1;

    // 防止同一 action 并发后台刷新
    this._bgRefreshing = new Set();
    this._requestGeneration = 0;
    this._activeRequest = null;
    this._cacheRequestGenerations = new Map();
  }

  /**
   * 构建缓存键
   * @param {string} action
   * @param {string} [extra] - 额外标识（如歌单 ID）
   * @param {string} [platform] - 请求所属的平台
   * @returns {string}
   */
  _cacheKey(action, extra = '', platform = this.state?.selectedSource || '') {
    const base = `${platform}:${action}`;
    return extra ? `${base}:${extra}` : base;
  }

  _createRequest(action, options = {}) {
    const playlistId = String(options.playlistId || '');
    const platform = String(this.state?.selectedSource || '');
    const cacheKey = this._cacheKey(action, playlistId, platform);
    const generation = ++this._requestGeneration;
    const request = {
      action,
      title: getHomeActionTitle(action),
      playlistId,
      platform,
      cacheKey,
      generation,
      homeGeneration: options.requestGeneration,
    };
    this._activeRequest = request;
    return request;
  }

  _isCurrentRequest(request) {
    return (
      request.generation === this._requestGeneration &&
      String(this.state?.selectedSource || '') === request.platform
    );
  }

  _applyResult(result) {
    this.homeItems = Array.isArray(result.items) ? result.items : [];
    this.homeItemType = result.itemType || '';
    this.homeAction = result.action || '';
    this.homePage = 1;
  }

  _writeCache(request, result) {
    if (!CACHEABLE_ACTIONS.has(request.action) || !this.cacheManager) return false;
    if (this._cacheRequestGenerations.get(request.cacheKey) !== request.generation)
      return false;
    this.cacheManager.set(request.cacheKey, {
      items: result.items,
      itemType: result.itemType,
      action: result.action,
    });
    return true;
  }

  async _fetchRequest(request) {
    if (CACHEABLE_ACTIONS.has(request.action)) {
      this._cacheRequestGenerations.set(request.cacheKey, request.generation);
    }
    try {
      const result = await this._fetchByAction(request);
      return { result, cacheWritten: this._writeCache(request, result) };
    } finally {
      if (this._cacheRequestGenerations.get(request.cacheKey) === request.generation) {
        this._cacheRequestGenerations.delete(request.cacheKey);
      }
    }
  }

  _publishCachedUpdate(request, result) {
    const current = this._activeRequest;
    if (!current?.cachedResult || current.cacheKey !== request.cacheKey ||
      !this._isCurrentRequest(current)) return;
    const changed = this._hasChanged(current.cachedResult.items, result.items, request.action);
    if (!changed) return;
    current.cachedResult = result;
    this._applyResult(result);
    this.onBackgroundUpdate?.({
      ...result,
      platform: current.platform,
      requestGeneration: current.homeGeneration,
      changed: true,
    });
  }

  /**
   * 加载主页内容（推荐、每日、电台等）
   * @param {string} action - 动作类型
   * @param {Object} [options]
   * @param {string} [options.playlistId] - 歌单 ID（playlist-tracks 时使用）
   * @param {boolean} [options.forceRefresh] - 强制跳过缓存
   * @returns {Promise<Object>} 加载结果
   */
  async loadHomeContent(action, options = {}) {
    if (!this.state) throw new Error('State not initialized');

    const request = this._createRequest(action, options);
    const forceRefresh = options.forceRefresh === true;

    // —— 缓存优先：可缓存的 action 先查缓存（forceRefresh 除外） ——
    if (!forceRefresh && CACHEABLE_ACTIONS.has(action) && this.cacheManager) {
      const cached = this.cacheManager.get(request.cacheKey);

      if (cached) {
        const cachedResult = {
          items: Array.isArray(cached.items) ? cached.items : [],
          itemType: cached.itemType || (action === 'liked' ? 'track' : 'playlist'),
          action: cached.action || action,
          title: request.title,
        };
        request.cachedResult = cachedResult;
        this._applyResult(cachedResult);

        // 后台静默刷新：返回缓存数据的同时，异步请求最新数据
        void this._backgroundRefresh(request);

        return {
          items: this.homeItems,
          itemType: this.homeItemType,
          action: this.homeAction,
          title: request.title,
          fromCache: true,
        };
      }
    }

    // —— 缓存未命中 或 强制刷新，走 API ——
    const { result, cacheWritten } = await this._fetchRequest(request);
    if (!this._isCurrentRequest(request)) {
      if (cacheWritten) this._publishCachedUpdate(request, result);
      return { stale: true };
    }

    this._applyResult(result);

    return {
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      title: request.title,
    };
  }

  /**
   * 根据 action 分发到对应的 API 请求方法
   * @param {Object} request - 固定的平台、缓存键和请求代际
   * @returns {Promise<Object>}
   */
  async _fetchByAction(request) {
    if (request.action === 'liked') {
      return this._fetchLikedTracksAll(request.title, request.platform);
    }
    if (request.action === 'playlist-tracks') {
      return this._fetchPlaylistTracks(
        request.title,
        request.playlistId,
        request.platform,
      );
    }
    return this._fetchGeneric(request.action, request.title, request.platform);
  }

  /**
   * 后台静默刷新（stale-while-revalidate）
   * 不阻塞 UI，静默更新缓存；数据有变化时触发 onBackgroundUpdate 回调
   * @param {Object} request - 固定的平台、缓存键和请求代际
   */
  async _backgroundRefresh(request) {
    const bgKey = request.cacheKey;

    // 防止同一 action 并发刷新
    if (this._bgRefreshing.has(bgKey)) return;
    this._bgRefreshing.add(bgKey);

    try {
      const { result, cacheWritten } = await this._fetchRequest(request);
      if (cacheWritten) this._publishCachedUpdate(request, result);
    } catch (_) {
      // 后台刷新失败静默处理，不影响已有缓存
    } finally {
      this._bgRefreshing.delete(bgKey);
    }
  }

  /**
   * 简单对比新旧数据是否变化
   * @param {Array} oldItems
   * @param {Array} newItems
   * @param {string} action
   * @returns {boolean}
   */
  _hasChanged(oldItems, newItems, action) {
    if (!Array.isArray(oldItems) || !Array.isArray(newItems)) return true;
    if (oldItems.length !== newItems.length) return true;

    // 歌单列表：对比 id 列表
    if (action === 'created-playlists' || action === 'collected-playlists') {
      const oldIds = oldItems
        .map((item) => item.id)
        .sort()
        .join(',');
      const newIds = newItems
        .map((item) => item.id)
        .sort()
        .join(',');
      return oldIds !== newIds;
    }

    // 曲目列表：对比前 3 首和最后 1 首的 id
    const sampleIndices = [0, 1, 2, oldItems.length - 1].filter(
      (i) => i >= 0 && i < oldItems.length,
    );
    for (const i of sampleIndices) {
      const oldId = oldItems[i] && oldItems[i].id;
      const newId = newItems[i] && newItems[i].id;
      if (oldId !== newId) return true;
    }

    return false;
  }

  // ── API 请求方法 ──

  /**
   * 分页循环加载"我喜欢"的全部歌曲（API 请求）
   * 每次请求 100 首，直到 API 返回不足 100 首为止
   * @param {string} title - 显示标题
   * @param {string} [platform] - 请求所属的平台
   * @returns {Promise<Object>} 加载结果
   */
  async _fetchLikedTracksAll(title, platform = this.state?.selectedSource || '') {
    const BATCH_SIZE = 100;
    let offset = 0;
    let allTracks = [];
    const seenPages = new Set();

    while (true) {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          action: 'liked',
          limit: BATCH_SIZE,
          offset: offset,
        }),
      });

      const payload = await this.readJsonResponse(response, '加载我喜欢失败');

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '加载我喜欢失败');
      }

      const tracks = Array.isArray(payload.data && payload.data.tracks)
        ? payload.data.tracks
        : [];

      const pageSignature = JSON.stringify(
        tracks.map((track) => [
          track?.source ?? '',
          track?.id ?? track?.sourceTrackId ?? '',
          track?.title ?? '',
        ]),
      );
      if (tracks.length > 0 && seenPages.has(pageSignature)) break;
      if (tracks.length > 0) seenPages.add(pageSignature);

      allTracks = allTracks.concat(tracks);
      const nextOffset = offset + tracks.length;
      if (nextOffset === offset) break;
      offset = nextOffset;

      if (tracks.length < BATCH_SIZE) break;
    }

    return {
      items: allTracks,
      itemType: 'track',
      action: 'liked',
      title: title,
    };
  }

  /**
   * 加载歌单详情曲目（API 请求）
   * @param {string} title
   * @param {string} playlistId
   * @param {string} [platform] - 请求所属的平台
   * @returns {Promise<Object>}
   */
  async _fetchPlaylistTracks(
    title,
    playlistId,
    platform = this.state?.selectedSource || '',
  ) {
    const response = await fetch('/api/music/home', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        action: 'playlist-tracks',
        playlistId: playlistId,
        limit: 5000,
      }),
    });

    const payload = await this.readJsonResponse(response, '打开歌单失败');
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '打开歌单失败');
    }

    const items = Array.isArray(payload.data && payload.data.tracks)
      ? payload.data.tracks
      : [];

    return {
      items,
      itemType: 'track',
      action: 'playlist-tracks',
      title: title,
    };
  }

  /**
   * 通用主页内容请求（推荐/每日/电台/歌单列表）
   * @param {string} action
   * @param {string} title
   * @param {string} [platform] - 请求所属的平台
   * @returns {Promise<Object>}
   */
  async _fetchGeneric(
    action,
    title,
    platform = this.state?.selectedSource || '',
  ) {
    const response = await fetch('/api/music/home', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        action: action,
        limit: 5000,
      }),
    });

    const payload = await this.readJsonResponse(response, '加载内容失败');

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '加载内容失败');
    }

    const data = payload.data || {};

    let items = [];
    let itemType = '';
    if (action === 'personalized') {
      items = Array.isArray(data.playlists) ? data.playlists : [];
      itemType = 'playlist';
    } else if (action === 'daily' || action === 'radio') {
      items = Array.isArray(data.tracks) ? data.tracks : [];
      itemType = 'track';
    } else if (
      action === 'created-playlists' ||
      action === 'collected-playlists'
    ) {
      items = Array.isArray(data.playlists) ? data.playlists : [];
      itemType = 'playlist';
    }

    return {
      items,
      itemType,
      action,
      title: title,
    };
  }

  // ── 公开辅助方法 ──

  /** @deprecated 使用 loadHomeContent('liked') 替代 */
  async loadLikedTracksAll(title) {
    return this.loadHomeContent('liked');
  }

  getHomeActionTitle(action) {
    return getHomeActionTitle(action);
  }

  getCurrentHomeContent() {
    return {
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      page: this.homePage,
    };
  }

  clearHomeContent() {
    this._requestGeneration += 1;
    this._activeRequest = null;
    this.homeItems = [];
    this.homeItemType = '';
    this.homeAction = '';
    this.homePage = 1;
  }
}
