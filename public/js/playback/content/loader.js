// 编写人：Aurora
// 内容加载器 - 负责加载主页内容、歌单等
'use strict';

import { getHomeActionTitle } from '../utils.js';

/** 可缓存的 action 列表 */
const CACHEABLE_ACTIONS = new Set([
  'liked',
  'created-playlists',
  'collected-playlists',
  'playlist-tracks'
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
  }

  /**
   * 构建缓存键
   * @param {string} action
   * @param {string} [extra] - 额外标识（如歌单 ID）
   * @returns {string}
   */
  _cacheKey(action, extra = '') {
    const platform = this.state ? this.state.selectedSource : '';
    const base = `${platform}:${action}`;
    return extra ? `${base}:${extra}` : base;
  }

  /**
   * 从缓存恢复主页内容
   * @param {{items, itemType, action}} cached
   * @param {string} action
   */
  _restoreFromCache(cached, action) {
    this.homeItems = Array.isArray(cached.items) ? cached.items : [];
    this.homeItemType = cached.itemType || (action === 'liked' ? 'track' : 'playlist');
    this.homeAction = cached.action || action;
    this.homePage = 1;
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

    const title = getHomeActionTitle(action);
    const forceRefresh = options.forceRefresh === true;

    // —— 缓存优先：可缓存的 action 先查缓存（forceRefresh 除外） ——
    if (!forceRefresh && CACHEABLE_ACTIONS.has(action) && this.cacheManager) {
      const extra = options.playlistId || '';
      const cacheKey = this._cacheKey(action, String(extra));
      const cached = this.cacheManager.get(cacheKey);

      if (cached) {
        this._restoreFromCache(cached, action);

        // 后台静默刷新：返回缓存数据的同时，异步请求最新数据
        this._backgroundRefresh(action, title, options);

        return {
          items: this.homeItems,
          itemType: this.homeItemType,
          action: this.homeAction,
          title: title,
          fromCache: true
        };
      }
    }

    // —— 缓存未命中 或 强制刷新，走 API ——
    const result = await this._fetchByAction(action, title, options);

    // 写入缓存
    if (CACHEABLE_ACTIONS.has(action) && this.cacheManager) {
      const extra = options.playlistId || '';
      const cacheKey = this._cacheKey(action, String(extra));
      this.cacheManager.set(cacheKey, {
        items: this.homeItems,
        itemType: this.homeItemType,
        action: this.homeAction
      });
    }

    return result;
  }

  /**
   * 根据 action 分发到对应的 API 请求方法
   * @param {string} action
   * @param {string} title
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async _fetchByAction(action, title, options) {
    if (action === 'liked') {
      return this._fetchLikedTracksAll(title);
    }
    if (action === 'playlist-tracks') {
      return this._fetchPlaylistTracks(title, options.playlistId);
    }
    return this._fetchGeneric(action, title);
  }

  /**
   * 后台静默刷新（stale-while-revalidate）
   * 不阻塞 UI，静默更新缓存；数据有变化时触发 onBackgroundUpdate 回调
   * @param {string} action
   * @param {string} title
   * @param {Object} options
   */
  async _backgroundRefresh(action, title, options) {
    const extra = options.playlistId || '';
    const bgKey = `${action}:${extra}`;

    // 防止同一 action 并发刷新
    if (this._bgRefreshing.has(bgKey)) return;
    this._bgRefreshing.add(bgKey);

    try {
      // 保存旧数据用于对比
      const oldItems = this.homeItems;
      const oldItemType = this.homeItemType;

      // 调用 API 获取最新数据（会临时覆盖 this.homeItems）
      const freshResult = await this._fetchByAction(action, title, options);

      // 更新缓存
      if (this.cacheManager) {
        const cacheKey = this._cacheKey(action, String(extra));
        this.cacheManager.set(cacheKey, {
          items: freshResult.items,
          itemType: freshResult.itemType,
          action: freshResult.action
        });
      }

      // 对比是否有变化
      const changed = this._hasChanged(oldItems, freshResult.items, action);

      // 恢复旧数据（当前页面继续显示缓存，下次打开看到新的）
      this.homeItems = oldItems;
      this.homeItemType = oldItemType;

      if (changed && this.onBackgroundUpdate) {
        this.onBackgroundUpdate({
          action: action,
          items: freshResult.items,
          itemType: freshResult.itemType,
          title: title,
          changed: true
        });
      }
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
      const oldIds = oldItems.map((item) => item.id).sort().join(',');
      const newIds = newItems.map((item) => item.id).sort().join(',');
      return oldIds !== newIds;
    }

    // 曲目列表：对比前 3 首和最后 1 首的 id
    const sampleIndices = [0, 1, 2, oldItems.length - 1].filter((i) => i >= 0 && i < oldItems.length);
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
   * @returns {Promise<Object>} 加载结果
   */
  async _fetchLikedTracksAll(title) {
    const BATCH_SIZE = 100;
    let offset = 0;
    let allTracks = [];
    const seenPages = new Set();

    while (true) {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: this.state.selectedSource,
          action: 'liked',
          limit: BATCH_SIZE,
          offset: offset
        })
      });

      const payload = await this.readJsonResponse(response, '加载我喜欢失败');

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '加载我喜欢失败');
      }

      const tracks = Array.isArray(payload.data && payload.data.tracks)
        ? payload.data.tracks
        : [];

      const pageSignature = JSON.stringify(tracks.map((track) => [
        track?.source ?? '',
        track?.id ?? track?.sourceTrackId ?? '',
        track?.title ?? ''
      ]));
      if (tracks.length > 0 && seenPages.has(pageSignature)) break;
      if (tracks.length > 0) seenPages.add(pageSignature);

      allTracks = allTracks.concat(tracks);
      const nextOffset = offset + tracks.length;
      if (nextOffset === offset) break;
      offset = nextOffset;

      if (tracks.length < BATCH_SIZE) break;
    }

    this.homeItems = allTracks;
    this.homeItemType = 'track';
    this.homeAction = 'liked';
    this.homePage = 1;

    return {
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      title: title
    };
  }

  /**
   * 加载歌单详情曲目（API 请求）
   * @param {string} title
   * @param {string} playlistId
   * @returns {Promise<Object>}
   */
  async _fetchPlaylistTracks(title, playlistId) {
    const response = await fetch('/api/music/home', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: this.state.selectedSource,
        action: 'playlist-tracks',
        playlistId: playlistId,
        limit: 5000
      })
    });

    const payload = await this.readJsonResponse(response, '打开歌单失败');
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '打开歌单失败');
    }

    this.homeItems = Array.isArray(payload.data && payload.data.tracks)
      ? payload.data.tracks
      : [];
    this.homeItemType = 'track';
    this.homeAction = 'playlist-tracks';

    return {
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      title: title
    };
  }

  /**
   * 通用主页内容请求（推荐/每日/电台/歌单列表）
   * @param {string} action
   * @param {string} title
   * @returns {Promise<Object>}
   */
  async _fetchGeneric(action, title) {
    const response = await fetch('/api/music/home', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: this.state.selectedSource,
        action: action,
        limit: 5000
      })
    });

    const payload = await this.readJsonResponse(response, '加载内容失败');

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '加载内容失败');
    }

    const data = payload.data || {};

    if (action === 'personalized') {
      this.homeItems = Array.isArray(data.playlists) ? data.playlists : [];
      this.homeItemType = 'playlist';
    } else if (action === 'daily' || action === 'radio') {
      this.homeItems = Array.isArray(data.tracks) ? data.tracks : [];
      this.homeItemType = 'track';
    } else if (action === 'created-playlists' || action === 'collected-playlists') {
      this.homeItems = Array.isArray(data.playlists) ? data.playlists : [];
      this.homeItemType = 'playlist';
    }

    this.homeAction = action;
    this.homePage = 1;

    return {
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      title: title
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
      page: this.homePage
    };
  }

  clearHomeContent() {
    this.homeItems = [];
    this.homeItemType = '';
    this.homeAction = '';
    this.homePage = 1;
  }
}
