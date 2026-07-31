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

}
