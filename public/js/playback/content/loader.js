// 编写人：Aurora
// 内容加载器 - 负责加载主页内容、歌单等
'use strict';

/**
 * 内容加载器
 */
export class ContentLoader {
  constructor(options = {}) {
    this.state = options.state || null;
    this.providerManager = options.providerManager || null;
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());

    // 主页内容缓存
    this.homeItems = [];
    this.homeItemType = '';
    this.homeAction = '';
    this.homePage = 1;
  }

  /**
   * 加载主页内容（推荐、每日、电台等）
   * @param {string} action - 动作类型
   * @returns {Promise<Object>} 加载结果
   */
  async loadHomeContent(action) {
    if (!this.state) throw new Error('State not initialized');

    const actionMap = {
      personalized: '推荐歌单',
      daily: '每日推荐',
      radio: '私人电台'
    };

    const title = actionMap[action] || '浏览内容';

    try {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: this.state.selectedSource,
          action: action
        })
      });

      const payload = await this.readJsonResponse(response, '加载内容失败');

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '加载内容失败');
      }

      const data = payload.data || {};

      // 根据动作类型处理数据
      if (action === 'personalized') {
        this.homeItems = Array.isArray(data.playlists) ? data.playlists : [];
        this.homeItemType = 'playlist';
      } else if (action === 'daily' || action === 'radio') {
        this.homeItems = Array.isArray(data.tracks) ? data.tracks : [];
        this.homeItemType = 'track';
      }

      this.homeAction = action;
      this.homePage = 1;

      return {
        items: this.homeItems,
        itemType: this.homeItemType,
        action: this.homeAction,
        title: title
      };
    } catch (error) {
      console.error('[ContentLoader] loadHomeContent failed:', error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * 加载歌单曲目
   * @param {number} playlistIndex - 歌单索引
   * @returns {Promise<Object>} 加载结果
   */
  async loadPlaylistTracks(playlistIndex) {
    if (!this.state) throw new Error('State not initialized');
    if (this.homeItemType !== 'playlist') {
      throw new Error('Current content is not playlists');
    }

    const playlist = this.homeItems[playlistIndex];
    if (!playlist) throw new Error('Playlist not found');

    try {
      const response = await fetch('/api/music/playlist-tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: this.state.selectedSource,
          playlistId: playlist.id
        })
      });

      const payload = await this.readJsonResponse(response, '加载歌单失败');

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '加载歌单失败');
      }

      const tracks = Array.isArray(payload.data && payload.data.tracks)
        ? payload.data.tracks
        : [];

      return {
        playlist: playlist,
        tracks: tracks,
        title: playlist.title || '歌单'
      };
    } catch (error) {
      console.error('[ContentLoader] loadPlaylistTracks failed:', error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * 刷新主页内容（换一批）
   * @returns {Promise<Object>} 加载结果
   */
  async refreshHomeContent() {
    if (!this.homeAction) {
      throw new Error('No active home content to refresh');
    }

    // 网易云音乐支持分页
    if (this.state.selectedSource === 'netease' && this.homeItemType === 'playlist') {
      this.homePage++;
      return this.loadHomeContentWithPage(this.homeAction, this.homePage);
    }

    // 其他情况重新加载
    return this.loadHomeContent(this.homeAction);
  }

  /**
   * 加载主页内容（带分页）
   * @param {string} action - 动作类型
   * @param {number} page - 页码
   * @returns {Promise<Object>} 加载结果
   */
  async loadHomeContentWithPage(action, page = 1) {
    if (!this.state) throw new Error('State not initialized');

    try {
      const response = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: this.state.selectedSource,
          action: action,
          page: page
        })
      });

      const payload = await this.readJsonResponse(response, '加载内容失败');

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '加载内容失败');
      }

      const data = payload.data || {};

      // 根据动作类型处理数据
      if (action === 'personalized') {
        this.homeItems = Array.isArray(data.playlists) ? data.playlists : [];
        this.homeItemType = 'playlist';
      } else if (action === 'daily' || action === 'radio') {
        this.homeItems = Array.isArray(data.tracks) ? data.tracks : [];
        this.homeItemType = 'track';
      }

      this.homeAction = action;
      this.homePage = page;

      const actionMap = {
        personalized: '推荐歌单',
        daily: '每日推荐',
        radio: '私人电台'
      };

      return {
        items: this.homeItems,
        itemType: this.homeItemType,
        action: this.homeAction,
        title: actionMap[action] || '浏览内容'
      };
    } catch (error) {
      console.error('[ContentLoader] loadHomeContentWithPage failed:', error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * 获取主页内容标题
   * @param {string} action - 动作类型
   * @returns {string}
   */
  getHomeActionTitle(action) {
    const map = {
      personalized: '推荐歌单',
      daily: '每日推荐',
      radio: '私人电台'
    };
    return map[action] || '浏览内容';
  }

  /**
   * 获取当前主页内容
   * @returns {Object}
   */
  getCurrentHomeContent() {
    return {
      items: this.homeItems,
      itemType: this.homeItemType,
      action: this.homeAction,
      page: this.homePage
    };
  }

  /**
   * 清空主页内容
   */
  clearHomeContent() {
    this.homeItems = [];
    this.homeItemType = '';
    this.homeAction = '';
    this.homePage = 1;
  }
}
