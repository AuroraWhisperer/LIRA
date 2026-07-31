// 编写人：Aurora
// 首页服务 - 负责首页内容加载（推荐、每日、电台、歌单等）
'use strict';

import { getHomeActionTitle } from '../utils.js';

/**
 * 首页服务类
 */
export class HomeService {
  constructor(options = {}) {
    this.state = options.state || null;
    this.contentLoader = options.contentLoader || null;
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.toast = options.toast || (() => {});

    // 首页状态
    this.homeItems = [];
    this.homeItemType = '';
    this.homeAction = '';
    this.homePage = 1;
    this.drawerHistory = [];
    this._currentPlaylistId = '';
  }

  /**
   * 加载首页内容
   * @param {string} action - 动作类型
   * @returns {Promise<Object>} {items, itemType, action}
   */
  async loadContent(action) {
    // 本地历史记录特殊处理
    if (action === 'recent') {
      return this.loadLocalRecentHistory();
    }

    // 使用 contentLoader 加载在线内容
    if (!this.contentLoader) {
      throw new Error('ContentLoader not initialized');
    }

    try {
      const result = await this.contentLoader.loadHomeContent(action);

      this.homeItems = result.items;
      this.homeItemType = result.itemType;
      this.homeAction = result.action;
      this.homePage = 1;

      return {
        items: this.homeItems,
        itemType: this.homeItemType,
        action: this.homeAction,
        page: this.homePage
      };
    } catch (error) {
      this.clearHomeState();
      throw error;
    }
  }

  /**
   * 加载本地最近播放历史
   * @returns {Object}
   */
  loadLocalRecentHistory() {
    if (!this.state) {
      throw new Error('State not initialized');
    }

    const tracks = this.state.displayHistory || [];

    this.homeItems = tracks.slice();
    this.homeItemType = 'track';
    this.homeAction = 'recent';
    this.homePage = 1;

    return {
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      page: this.homePage
    };
  }

  /**
   * 加载歌单详情（曲目列表）
   * 委托给 ContentLoader，由其统一处理缓存逻辑
   * @param {number} playlistIndex - 歌单索引
   * @returns {Promise<Object>}
   */
  async loadPlaylistTracks(playlistIndex) {
    const playlist = this.homeItems[playlistIndex];
    if (!playlist) {
      throw new Error('Playlist not found');
    }

    if (!this.state) {
      throw new Error('State not initialized');
    }

    if (!this.contentLoader) {
      throw new Error('ContentLoader not initialized');
    }

    // 保存当前状态到历史记录
    this.pushHistory({
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      page: this.homePage
    });

    try {
      const result = await this.contentLoader.loadHomeContent('playlist-tracks', {
        playlistId: playlist.id
      });

      // 记录当前歌单 ID，供刷新时使用
      this._currentPlaylistId = playlist.id;

      // ContentLoader 已经设置了 homeItems 等状态，同步到 HomeService
      this.homeItems = result.items;
      this.homeItemType = result.itemType;
      this.homeAction = result.action;
      this.homePage = 1;

      return {
        items: this.homeItems,
        itemType: this.homeItemType,
        action: this.homeAction,
        title: playlist.title || playlist.id
      };
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  /**
   * 刷新当前内容
   * - 推荐/每日/电台：翻页换一批
   * - 我喜欢/歌单/歌单详情：强制重新拉取并更新缓存
   * @returns {Promise<Object>}
   */
  async refreshContent() {
    const action = this.homeAction;

    if (!action) {
      throw new Error('没有可刷新的内容');
    }

    if (!this.state) {
      throw new Error('State not initialized');
    }

    // —— 可缓存类型：走 ContentLoader 强制刷新 ——
    const CACHED_ACTIONS = ['liked', 'created-playlists', 'collected-playlists', 'playlist-tracks'];
    if (CACHED_ACTIONS.includes(action) && this.contentLoader) {
      try {
        const result = await this.contentLoader.loadHomeContent(action, {
          forceRefresh: true,
          playlistId: this._currentPlaylistId
        });

        this.homeItems = result.items;
        this.homeItemType = result.itemType;
        this.homeAction = result.action;
        this.homePage = 1;

        return {
          items: this.homeItems,
          itemType: this.homeItemType,
          action: this.homeAction,
          page: this.homePage
        };
      } catch (error) {
        this.onError(error);
        throw error;
      }
    }

    // —— 推荐/每日/电台：翻页换一批 ——
    if (!['personalized', 'daily', 'radio'].includes(action)) {
      throw new Error('当前内容不支持刷新');
    }

    this.homePage += 1;

    try {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: this.state.selectedSource,
          action,
          limit: action === 'personalized' ? 12 : 100,
          page: this.homePage,
          refresh: true
        })
      });

      const payload = await this.readJsonResponse(response, '刷新内容失败');
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '刷新内容失败');
      }

      const data = payload.data || {};
      const items = Array.isArray(data.playlists)
        ? data.playlists
        : (Array.isArray(data.tracks) ? data.tracks : []);

      if (items.length === 0) {
        this.homePage = Math.max(1, this.homePage - 1);
        throw new Error('没有更多内容了');
      }

      this.homeItems = items;
      this.homeItemType = Array.isArray(data.playlists) ? 'playlist' : 'track';

      return {
        items: this.homeItems,
        itemType: this.homeItemType,
        action: this.homeAction,
        page: this.homePage
      };
    } catch (error) {
      this.homePage = Math.max(1, this.homePage - 1);
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
      page: this.homePage
    };
  }

  /**
   * 应用后台刷新结果（由 ContentLoader.onBackgroundUpdate 触发）
   * @param {{items, itemType, action}} update
   */
  _applyBackgroundUpdate(update) {
    this.homeItems = Array.isArray(update.items) ? update.items : [];
    this.homeItemType = update.itemType || this.homeItemType;
    this.homeAction = update.action || this.homeAction;
    this.homePage = 1;
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
   * 清空首页状态
   */
  clearHomeState() {
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
      title: previous.title
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
