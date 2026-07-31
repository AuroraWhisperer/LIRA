// 编写人：Aurora
// 内容加载器 - 负责加载主页内容、歌单等
'use strict';

import { getHomeActionTitle } from '../utils.js';

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

    const title = getHomeActionTitle(action);

    // "我喜欢"使用分页循环加载，确保拿完所有歌曲
    if (action === 'liked') {
      return this.loadLikedTracksAll(title);
    }

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
    } catch (error) {
      console.error('[ContentLoader] loadHomeContent failed:', error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * 分页循环加载"我喜欢"的全部歌曲
   * 每次请求 100 首，直到 API 返回不足 100 首为止
   * @param {string} title - 显示标题
   * @returns {Promise<Object>} 加载结果
   */
  async loadLikedTracksAll(title) {
    const BATCH_SIZE = 100;
    let offset = 0;
    let allTracks = [];

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

      allTracks = allTracks.concat(tracks);
      offset += tracks.length;

      // 返回数量不足一批，说明已经拿完
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
   * 获取主页内容标题（委托给 utils.js 统一维护）
   * @param {string} action - 动作类型
   * @returns {string}
   */
  getHomeActionTitle(action) {
    return getHomeActionTitle(action);
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
