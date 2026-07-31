// 编写人：Aurora
// 搜索服务 - 负责在线搜索和搜索结果管理
'use strict';

/**
 * 搜索服务类
 */
export class SearchService {
  constructor(options = {}) {
    this.state = options.state || null;
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.toast = options.toast || (() => {});
    this.searchResults = [];
  }

  /**
   * 执行在线搜索
   * @param {string} keyword - 搜索关键词
   * @param {number} limit - 结果数量限制
   * @returns {Promise<Array>} 搜索结果
   */
  async search(keyword, limit = 12) {
    if (!keyword || !keyword.trim()) {
      this.toast('请输入要搜索的歌名或歌手');
      return [];
    }

    if (!this.state) {
      throw new Error('State not initialized');
    }

    try {
      const response = await fetch('/api/music/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: this.state.selectedSource,
          keyword: keyword.trim(),
          limit: Number(limit) || 12
        })
      });

      const payload = await this.readJsonResponse(response, '在线搜索失败');

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '在线搜索失败');
      }

      this.searchResults = Array.isArray(payload.data && payload.data.tracks)
        ? payload.data.tracks
        : [];

      return this.searchResults;
    } catch (error) {
      this.searchResults = [];
      this.onError(error);
      throw error;
    }
  }

  /**
   * 获取当前搜索结果
   * @returns {Array}
   */
  getResults() {
    return this.searchResults;
  }

  /**
   * 获取指定索引的搜索结果
   * @param {number} index - 索引
   * @returns {Object|null}
   */
  getResultByIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.searchResults.length) {
      return null;
    }
    return this.searchResults[index];
  }

  /**
   * 清空搜索结果
   */
  clearResults() {
    this.searchResults = [];
  }

  /**
   * 检查是否有搜索结果
   * @returns {boolean}
   */
  hasResults() {
    return this.searchResults.length > 0;
  }
}
