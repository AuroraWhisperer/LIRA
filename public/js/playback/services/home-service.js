// 编写人：Aurora
// 首页服务 - 负责首页内容加载（推荐、每日、电台、歌单等）
'use strict';

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

    // 保存当前状态到历史记录
    this.pushHistory({
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      page: this.homePage
    });

    try {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: this.state.selectedSource,
          action: 'playlist-tracks',
          playlistId: playlist.id,
          limit: 1000
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
        title: playlist.title || playlist.id
      };
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  /**
   * 刷新当前内容（换一批）
   * @returns {Promise<Object>}
   */
  async refreshContent() {
    const action = this.homeAction;

    // 只有部分类型支持刷新
    if (!action || !['personalized', 'daily', 'radio'].includes(action)) {
      throw new Error('Current content cannot be refreshed');
    }

    if (!this.state) {
      throw new Error('State not initialized');
    }

    this.homePage += 1;

    try {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: this.state.selectedSource,
          action,
          limit: action === 'personalized' ? 12 : 30,
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
        // 没有更多内容，恢复页码
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
   * 获取动作名称
   * @param {string} action - 动作类型
   * @returns {string}
   */
  static getActionName(action) {
    const names = {
      personalized: '为你推荐',
      daily: '每日推荐',
      radio: '心动 / 电台',
      liked: '我喜欢',
      'created-playlists': '我的歌单',
      'collected-playlists': '收藏歌单',
      recent: '最近播放',
      'playlist-tracks': '歌单详情'
    };
    return names[action] || '浏览内容';
  }
}
