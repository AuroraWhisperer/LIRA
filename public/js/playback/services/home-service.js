// 编写人：Aurora
// 首页服务 - 负责首页内容加载（推荐、每日、电台、歌单等）
'use strict';

import { assertApiResponse } from '../../shared/json-response.js';
import { getHomeActionTitle } from '../utils.js';
import { CACHEABLE_ACTIONS, PERSONALIZED_PAGE_SIZE } from '../content/loader.js';

/**
 * 首页服务类
 */
export class HomeService {
  constructor(options = {}) {
    this.state = options.state || null;
    this.contentLoader = options.contentLoader || null;
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());

    // 首页状态
    this.homeItems = [];
    this.homeItemType = '';
    this.homeAction = '';
    this.homePage = 1;
    this.drawerHistory = [];
    this._currentPlaylistId = '';
    this._requestGeneration = 0;
  }

  _beginRequest() {
    this._openingContent = null;
    this._requestGeneration += 1;
    return this._requestGeneration;
  }

  _isCurrentRequest(generation) {
    return generation === this._requestGeneration;
  }

  _staleResult() {
    return { stale: true };
  }

  _setContent({ items, itemType, action, nextPage }) {
    this.homeItems = items;
    this.homeItemType = itemType;
    this.homeAction = action;
    this.homePage = 1;
    this.nextDailyPage = nextPage;
  }

  async _trackOpening(action, playlistId, ready) {
    const opening = { platform: this.state?.selectedSource, action, playlistId, ready };
    this._openingContent = opening;
    try {
      return await ready;
    } finally {
      if (this._openingContent === opening) this._openingContent = null;
    }
  }

  /**
   * 加载首页内容
   * @param {string} action - 动作类型
   * @returns {Promise<Object>} {items, itemType, action}
   */
  loadContent(action) {
    return this._trackOpening(action, undefined, this._loadContent(action));
  }

  async _loadContent(action) {
    const generation = this._beginRequest();

    // 本地历史记录特殊处理
    if (action === 'recent') {
      return this.loadLocalRecentHistory(generation);
    }

    // 使用 contentLoader 加载在线内容
    if (!this.contentLoader) {
      throw new Error('ContentLoader not initialized');
    }

    try {
      const result = await this.contentLoader.loadHomeContent(action, {
        requestGeneration: generation,
      });
      if (!this._isCurrentRequest(generation) || result?.stale) {
        return this._staleResult();
      }

      this._setContent(result);

      return this.getHomeState();
    } catch (error) {
      if (!this._isCurrentRequest(generation)) return this._staleResult();
      this.clearHomeState();
      throw error;
    }
  }

  /**
   * 加载本地最近播放历史
   * @returns {Object}
   */
  loadLocalRecentHistory(generation = this._beginRequest()) {
    if (!this.state) {
      throw new Error('State not initialized');
    }

    if (!this._isCurrentRequest(generation)) return this._staleResult();

    const tracks = this.state.displayHistory || [];

    this.homeItems = tracks.slice();
    this.homeItemType = 'track';
    this.homeAction = 'recent';
    this.homePage = 1;

    return this.getHomeState();
  }

  /**
   * 加载歌单详情（曲目列表）
   * 委托给 ContentLoader，由其统一处理缓存逻辑
   * @param {number} playlistIndex - 歌单索引
   * @returns {Promise<Object>}
   */
  loadPlaylistTracks(playlistIndex) {
    const playlist = this.homeItems[playlistIndex];
    return this._trackOpening('playlist-tracks', playlist?.id, this._loadPlaylistTracks(playlist));
  }

  async _loadPlaylistTracks(playlist) {
    const generation = this._beginRequest();
    if (!playlist) {
      throw new Error('Playlist not found');
    }

    if (!this.state) {
      throw new Error('State not initialized');
    }

    if (!this.contentLoader) {
      throw new Error('ContentLoader not initialized');
    }

    const previousState = this.getHomeState();

    try {
      const result = await this.contentLoader.loadHomeContent('playlist-tracks', {
        playlistId: playlist.id,
        requestGeneration: generation,
      });

      if (!this._isCurrentRequest(generation) || result?.stale) {
        return this._staleResult();
      }

      this._enterPlaylist(playlist.id, previousState);
      this._setContent(result);

      return {
        items: this.homeItems,
        itemType: this.homeItemType,
        action: this.homeAction,
        title: playlist.title || playlist.id,
      };
    } catch (error) {
      if (!this._isCurrentRequest(generation)) return this._staleResult();
      this.onError(error);
      throw error;
    }
  }

  _enterPlaylist(playlistId, previousState) {
    this._currentPlaylistId = playlistId;
    this.pushHistory(previousState);
  }

  getPlaylistRemovalTarget(action) {
    if (action !== 'liked' && action !== 'playlist-tracks') return null;
    const platform = this.state.selectedSource;
    const playlist = action === 'liked' ? { id: 'liked' } : this.getCurrentPlaylist();
    if (!playlist) return null;
    if (platform === 'qq' && action === 'playlist-tracks' &&
        (!Number.isSafeInteger(Number(playlist.dirId)) || Number(playlist.dirId) <= 0)) return null;
    return { platform, playlist, items: this.homeItems, generation: this.contentLoader.getPlatformGeneration(platform) };
  }

  async refreshAfterPlaylistRemoval(target, removedTrack, receipt) {
    const { platform, playlist, items, generation } = target;
    if (generation !== this.contentLoader.getPlatformGeneration(platform)) return this._staleResult();
    const liked = playlist.id === 'liked' || (platform === 'netease' && receipt?.isLikedPlaylist === true);
    const playlistId = playlist.id === 'liked' ? (platform === 'netease' && receipt?.playlistId) : playlist.id;
    if (liked) this.contentLoader.invalidateCachedContent(platform, 'liked');
    if (playlistId) this.contentLoader.invalidateCachedContent(platform, 'playlist-tracks', playlistId);

    const opening = this._openingContent;
    const action = opening?.action ?? this.homeAction;
    const visibleId = opening ? opening.playlistId : this._currentPlaylistId;
    const matches = action === 'liked' ? liked :
      action === 'playlist-tracks' && playlistId && String(visibleId) === String(playlistId);
    if (!matches || this.state.selectedSource !== platform || (opening && opening.platform !== platform)) {
      return this._staleResult();
    }
    if (opening) {
      const openingGeneration = this._requestGeneration;
      const result = await opening.ready;
      if (!this._isCurrentRequest(openingGeneration)) return this._staleResult();
      if (result.stale) {
        // Discard the interrupted read. Use the last displayed list for this playlist until the re-read succeeds.
        if (action === 'playlist-tracks') this._enterPlaylist(visibleId, this.getHomeState());
        this._setContent({ items, itemType: 'track', action });
      }
    }
    this.homeItems = this.homeItems.filter((item) => item.id !== removedTrack.id);
    // refreshContent reports read failures separately. The confirmed removal still belongs in the drawer.
    return this.refreshContent().catch(() => this.getHomeState());
  }

  /**
   * 刷新当前内容
   * - 推荐/每日/电台：翻页换一批
   * - 我喜欢/歌单/歌单详情：强制重新拉取并更新缓存
   * @returns {Promise<Object>}
   */
  async refreshContent() {
    const action = this.homeAction;
    const generation = this._beginRequest();

    if (!action) {
      throw new Error('没有可刷新的内容');
    }

    if (!this.state) {
      throw new Error('State not initialized');
    }

    // —— 可缓存类型：走 ContentLoader 强制刷新 ——
    if (CACHEABLE_ACTIONS.has(action) && this.contentLoader) {
      try {
        const result = await this.contentLoader.loadHomeContent(action, {
          forceRefresh: true,
          playlistId: this._currentPlaylistId,
          requestGeneration: generation,
        });

        if (!this._isCurrentRequest(generation) || result?.stale) {
          return this._staleResult();
        }

        this._setContent(result);

        return this.getHomeState();
      } catch (error) {
        if (!this._isCurrentRequest(generation)) return this._staleResult();
        this.onError(error);
        throw error;
      }
    }

    // —— 推荐/每日/电台：翻页换一批 ——
    if (!['personalized', 'daily', 'radio'].includes(action)) {
      throw new Error('当前内容不支持刷新');
    }

    const platform = this.state.selectedSource;
    let nextPage = this.homePage + 1;
    if (action === 'daily' && platform === 'qq' && this.nextDailyPage !== undefined) {
      nextPage = this.nextDailyPage;
    } else if (action === 'personalized' && platform === 'netease' &&
      (this.homeItems.length < PERSONALIZED_PAGE_SIZE || this.homePage >= 50)) {
      nextPage = 1;
    }

    try {
      if (nextPage === null) throw new Error('没有更多内容了');
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          action,
          limit: action === 'personalized' ? PERSONALIZED_PAGE_SIZE : 100,
          page: nextPage,
          refresh: true,
        }),
      });

      const payload = await this.readJsonResponse(response, '刷新内容失败');
      assertApiResponse(response, payload, '刷新内容失败');

      if (!this._isCurrentRequest(generation) || this.state.selectedSource !== platform || this.homeAction !== action) {
        return this._staleResult();
      }

      const data = payload.data || {};
      const items = Array.isArray(data.playlists) ? data.playlists : Array.isArray(data.tracks) ? data.tracks : [];
      this.nextDailyPage = data.nextPage;

      if (items.length === 0) {
        throw new Error('没有更多内容了');
      }

      this.homeItems = items;
      this.homeItemType = Array.isArray(data.playlists) ? 'playlist' : 'track';
      this.homePage = nextPage;

      return this.getHomeState();
    } catch (error) {
      if (!this._isCurrentRequest(generation)) return this._staleResult();
      this.onError(error);
      throw error;
    }
  }

  /**
   * 获取当前首页状态
   * @returns {Object}
   */
  getHomeState() {
    return {
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      page: this.homePage,
    };
  }

  /**
   * 应用后台刷新结果（由 ContentLoader.onBackgroundUpdate 触发）
   * @param {{items, itemType, action}} update
   */
  applyBackgroundUpdate(update) {
    if (
      (update.requestGeneration !== undefined && update.requestGeneration !== this._requestGeneration) ||
      (update.platform && update.platform !== this.state?.selectedSource)
    ) {
      return false;
    }
    this.homeItems = Array.isArray(update.items) ? update.items : [];
    this.homeItemType = update.itemType || this.homeItemType;
    this.homeAction = update.action || this.homeAction;
    this.homePage = 1;
    return true;
  }

  /**
   * 获取指定索引的项
   * @param {number} index - 索引
   * @returns {Object|null}
   */
  getItemByIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.homeItems.length) {
      return null;
    }
    return this.homeItems[index];
  }

  /**
   * 获取当前歌单（playlist-tracks 时使用）
   * @returns {Object|null}
   */
  getCurrentPlaylist() {
    if (this.homeAction !== 'playlist-tracks') {
      return null;
    }
    // 从历史记录中获取歌单信息
    if (this.drawerHistory.length > 0) {
      const lastHistory = this.drawerHistory[this.drawerHistory.length - 1];
      if (lastHistory && lastHistory.items && lastHistory.items.length > 0) {
        // 查找被点击的歌单（通过 _currentPlaylistId 匹配）
        return lastHistory.items.find((item) => item.id === this._currentPlaylistId) || null;
      }
    }
    return null;
  }

  /**
   * 清空首页状态
   */
  clearHomeState() {
    this._beginRequest();
    this.homeItems = [];
    this.homeItemType = '';
    this.homeAction = '';
    this.homePage = 1;
  }

  /**
   * 推入历史记录
   * @param {Object} state - 状态对象
   */
  pushHistory(state) {
    this.drawerHistory.push({ ...state });
  }

  /**
   * 返回上一级
   * @returns {Object|null}
   */
  goBack() {
    this._beginRequest();
    if (this.drawerHistory.length === 0) {
      return null;
    }

    const previous = this.drawerHistory.pop();

    this.homeItems = previous.items;
    this.homeItemType = previous.itemType;
    this.homeAction = previous.action;
    this.homePage = previous.page;

    return {
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      page: this.homePage,
      title: previous.title,
    };
  }

  /**
   * 清空历史记录
   */
  clearHistory() {
    this.drawerHistory = [];
  }

  /**
   * 是否可以返回
   * @returns {boolean}
   */
  canGoBack() {
    return this.drawerHistory.length > 0;
  }

  /**
   * 获取动作名称（委托给 utils.js 统一维护）
   * @param {string} action - 动作类型
   * @returns {string}
   */
  static getActionName(action) {
    return getHomeActionTitle(action);
  }
}
