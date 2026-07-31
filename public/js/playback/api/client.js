// 编写人：Aurora
// API 客户端 - 统一的网络请求处理
'use strict';

/**
 * API 客户端
 */
export class APIClient {
  constructor(options = {}) {
    this.onError = options.onError || (() => {});
    this.baseUrl = options.baseUrl || '';
  }

  /**
   * 读取 JSON 响应
   * @param {Response} response - Fetch 响应
   * @param {string} errorMessage - 错误提示
   * @returns {Promise<Object>}
   */
  async readJsonResponse(response, errorMessage = '请求失败') {
    if (!response.ok) {
      let detail = errorMessage;
      try {
        const payload = await response.json();
        if (payload.error) {
          detail = payload.error;
        }
      } catch {
        // JSON 解析失败，使用默认错误消息
      }
      throw new Error(detail);
    }

    try {
      const payload = await response.json();
      return payload;
    } catch (error) {
      throw new Error('响应格式错误');
    }
  }

  /**
   * GET 请求
   * @param {string} url - 请求 URL
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async get(url, options = {}) {
    try {
      const response = await fetch(this.baseUrl + url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      return this.readJsonResponse(response, options.errorMessage);
    } catch (error) {
      console.error(`[APIClient] GET ${url} failed:`, error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * POST 请求
   * @param {string} url - 请求 URL
   * @param {Object} data - 请求数据
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async post(url, data = {}, options = {}) {
    try {
      const response = await fetch(this.baseUrl + url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        body: JSON.stringify(data)
      });

      return this.readJsonResponse(response, options.errorMessage);
    } catch (error) {
      console.error(`[APIClient] POST ${url} failed:`, error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * PUT 请求
   * @param {string} url - 请求 URL
   * @param {Object} data - 请求数据
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async put(url, data = {}, options = {}) {
    try {
      const response = await fetch(this.baseUrl + url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        body: JSON.stringify(data)
      });

      return this.readJsonResponse(response, options.errorMessage);
    } catch (error) {
      console.error(`[APIClient] PUT ${url} failed:`, error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * DELETE 请求
   * @param {string} url - 请求 URL
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async delete(url, options = {}) {
    try {
      const response = await fetch(this.baseUrl + url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      return this.readJsonResponse(response, options.errorMessage);
    } catch (error) {
      console.error(`[APIClient] DELETE ${url} failed:`, error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * 音乐缓存统计
   * @returns {Promise<Object>}
   */
  async getMusicCacheStats() {
    return this.get('/api/music/cache-stats', {
      errorMessage: '获取缓存统计失败'
    });
  }

  /**
   * 清空音乐缓存
   * @returns {Promise<Object>}
   */
  async clearMusicCache() {
    return this.post('/api/music/cache-clear', {}, {
      errorMessage: '清空缓存失败'
    });
  }

  /**
   * 获取播放状态
   * @param {string} clientId - 客户端 ID
   * @returns {Promise<Object>}
   */
  async getPlaybackState(clientId) {
    return this.get(`/api/playback/queue-state?clientId=${encodeURIComponent(clientId)}`, {
      errorMessage: '读取播放状态失败'
    });
  }

  /**
   * 保存播放状态
   * @param {string} clientId - 客户端 ID
   * @param {Object} payload - 状态数据
   * @returns {Promise<Object>}
   */
  async savePlaybackState(clientId, payload) {
    return this.post('/api/playback/queue-state', {
      clientId,
      payload
    }, {
      errorMessage: '保存播放状态失败'
    });
  }

  /**
   * 使用 sendBeacon 保存状态（用于页面关闭时）
   * @param {string} clientId - 客户端 ID
   * @param {Object} payload - 状态数据
   * @returns {boolean}
   */
  sendBeaconPlaybackState(clientId, payload) {
    if (!navigator.sendBeacon) return false;

    try {
      const blob = new Blob([JSON.stringify({ clientId, payload })], {
        type: 'application/json'
      });
      return navigator.sendBeacon('/api/playback/queue-state', blob);
    } catch (error) {
      console.error('[APIClient] sendBeacon failed:', error);
      return false;
    }
  }

  /**
   * 搜索歌曲
   * @param {string} platform - 平台
   * @param {string} keyword - 关键词
   * @returns {Promise<Object>}
   */
  async searchSongs(platform, keyword) {
    return this.post('/api/music/search', {
      platform,
      keyword
    }, {
      errorMessage: '搜索失败'
    });
  }

  /**
   * 获取歌曲详情
   * @param {string} platform - 平台
   * @param {string} trackId - 曲目 ID
   * @returns {Promise<Object>}
   */
  async getTrackDetail(platform, trackId) {
    return this.post('/api/music/track-detail', {
      platform,
      trackId
    }, {
      errorMessage: '获取歌曲详情失败'
    });
  }

  /**
   * 获取播放 URL
   * @param {string} platform - 平台
   * @param {string} trackId - 曲目 ID
   * @returns {Promise<Object>}
   */
  async getPlayUrl(platform, trackId) {
    return this.post('/api/music/play-url', {
      platform,
      trackId
    }, {
      errorMessage: '获取播放链接失败'
    });
  }

  /**
   * 获取歌词
   * @param {string} platform - 平台
   * @param {string} trackId - 曲目 ID
   * @returns {Promise<Object>}
   */
  async getLyrics(platform, trackId) {
    return this.post('/api/music/lyrics', {
      platform,
      trackId
    }, {
      errorMessage: '获取歌词失败'
    });
  }
}
