// 编写人：Aurora
// 内容加载器 - 负责加载主页内容、歌单等
'use strict';

import { assertApiResponse } from '../../shared/json-response.js';
import { getHomeActionTitle } from '../utils.js';

/** 可缓存的 action 列表 */
export const CACHEABLE_ACTIONS = new Set(['liked', 'created-playlists', 'collected-playlists', 'playlist-tracks']);

/**
 * 内容加载器
 */
export class ContentLoader {
  constructor(options = {}) {
    this.state = options.state || null;
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.cacheManager = options.cacheManager || null;
    /** 后台刷新完成回调： ({action, items, itemType, changed}) => void */
    this.onBackgroundUpdate = options.onBackgroundUpdate || null;

    // 同键读取共用网络任务，抽屉代次只决定哪个调用方接收结果。
    this._pendingRequests = new Map();
    this._platformGenerations = new Map();
    this._requestGeneration = 0;
    this._activeRequest = null;
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
    const playlistId = action === 'playlist-tracks' ? String(options.playlistId || '') : '';
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
      request.generation === this._requestGeneration && String(this.state?.selectedSource || '') === request.platform
    );
  }

  _fetchRequest(request, forceRefresh = false) {
    if (!CACHEABLE_ACTIONS.has(request.action)) return this._fetchByAction(request);
    const pending = this._pendingRequests.get(request.cacheKey);
    if (pending && !forceRefresh) return pending.promise;

    const task = { request };
    this._pendingRequests.set(request.cacheKey, task);
    task.promise = this._fetchAndCache(request);
    return task.promise;
  }

  async _fetchAndCache(request) {
    const key = request.cacheKey;
    try {
      const result = await this._fetchByAction(request);
      if (this._pendingRequests.get(key)?.request === request && this.cacheManager) {
        this.cacheManager.set(key, { items: result.items, itemType: result.itemType, action: result.action });
        this._publishCachedUpdate(request, result);
      }
      return result;
    } finally {
      if (this._pendingRequests.get(key)?.request === request) this._pendingRequests.delete(key);
    }
  }

  _publishCachedUpdate(request, result) {
    const current = this._activeRequest;
    if (!current?.cachedResult || current.cacheKey !== request.cacheKey || !this._isCurrentRequest(current)) return;
    const changed = this._hasChanged(current.cachedResult.items, result.items);
    if (!changed) return;
    current.cachedResult = result;
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

        // 后台静默刷新：返回缓存数据的同时，异步请求最新数据
        if (!this._pendingRequests.has(request.cacheKey)) {
          void this._fetchRequest(request).catch(() => { /* 刷新失败仍显示缓存，下次打开重试。 */ });
        }

        return { ...cachedResult, fromCache: true };
      }
    }

    // —— 缓存未命中 或 强制刷新，走 API ——
    try {
      const result = await this._fetchRequest(request, forceRefresh);
      return this._isCurrentRequest(request) ? result : { stale: true };
    } catch (error) {
      if (this._isCurrentRequest(request)) throw error;
      return { stale: true };
    }
  }

  /**
   * 根据 action 分发到对应的 API 请求方法
   * @param {Object} request - 固定的平台、缓存键和请求代际
   * @returns {Promise<Object>}
   */
  async _fetchByAction(request) {
    if (request.action === 'liked') {
      return this._fetchLikedTracksAll(request);
    }
    if (request.action === 'playlist-tracks') {
      return this._fetchPlaylistTracks(request.title, request.playlistId, request.platform);
    }
    return this._fetchGeneric(request.action, request.title, request.platform);
  }

  /**
   * 简单对比新旧数据是否变化
   * @param {Array} oldItems
   * @param {Array} newItems
   * @returns {boolean}
   */
  _hasChanged(oldItems, newItems) {
    if (!Array.isArray(oldItems) || !Array.isArray(newItems)) return true;
    if (oldItems.length !== newItems.length) return true;
    return oldItems.some((item, index) => JSON.stringify(item) !== JSON.stringify(newItems[index]));
  }

  // ── API 请求方法 ──

  /**
   * 分页循环加载"我喜欢"的全部歌曲（API 请求）
   * 每次请求 100 首，直到 API 返回不足 100 首为止
   * @param {Object} request - 当前分页任务的平台、标题和缓存键
   * @returns {Promise<Object>} 加载结果
   */
  async _fetchLikedTracksAll(request) {
    const { title, platform, cacheKey } = request;
    const BATCH_SIZE = 100;
    let offset = 0;
    const allTracks = [];
    const seenPages = new Set();
    const loadingSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    while (true) {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          action: 'liked',
          loadingSession,
          limit: BATCH_SIZE,
          offset: offset,
        }),
      });

      const payload = await this.readJsonResponse(response, '加载我喜欢失败');
      if (this._pendingRequests.get(cacheKey)?.request !== request) break;

      assertApiResponse(response, payload, '加载我喜欢失败');

      const tracks = Array.isArray(payload.data && payload.data.tracks) ? payload.data.tracks : [];

      const pageSignature = JSON.stringify(
        tracks.map((track) => [track?.source ?? '', track?.id ?? track?.sourceTrackId ?? '', track?.title ?? '']),
      );
      if (tracks.length > 0 && seenPages.has(pageSignature)) break;
      if (tracks.length > 0) seenPages.add(pageSignature);

      for (const track of tracks) allTracks.push(track);
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
  async _fetchPlaylistTracks(title, playlistId, platform = this.state?.selectedSource || '') {
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
    assertApiResponse(response, payload, '打开歌单失败');

    const items = Array.isArray(payload.data && payload.data.tracks) ? payload.data.tracks : [];

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
  async _fetchGeneric(action, title, platform = this.state?.selectedSource || '') {
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

    assertApiResponse(response, payload, '加载内容失败');

    const data = payload.data || {};

    let items = [];
    let itemType = '';
    if (action === 'personalized') {
      items = Array.isArray(data.playlists) ? data.playlists : [];
      itemType = 'playlist';
    } else if (action === 'daily' || action === 'radio') {
      items = Array.isArray(data.tracks) ? data.tracks : [];
      itemType = 'track';
    } else if (action === 'created-playlists' || action === 'collected-playlists') {
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

  clearHomeContent() {
    this._requestGeneration += 1;
    this._activeRequest = null;
  }

  invalidateCachedContent(platform, action, playlistId) {
    const key = this._cacheKey(action, playlistId, platform);
    this._pendingRequests.delete(key);
    if (this._activeRequest?.cacheKey === key) this.clearHomeContent();
    this.cacheManager?.remove(key);
  }

  getPlatformGeneration(platform) {
    return this._platformGenerations.get(platform) || 0;
  }

  invalidatePlatform(platform) {
    this._platformGenerations.set(platform, this.getPlatformGeneration(platform) + 1);
    const prefix = `${platform}:`;
    for (const key of this._pendingRequests.keys()) {
      if (key.startsWith(prefix)) this._pendingRequests.delete(key);
    }
    if (this._activeRequest?.platform === platform) this.clearHomeContent();
  }
}
