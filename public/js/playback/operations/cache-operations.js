// 编写人：Aurora
// 缓存管理操作模块
'use strict';

import { assertApiResponse } from '../../shared/json-response.js';
/**
 * 创建缓存管理操作模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 缓存操作函数集合
 */
export function createCacheOperations(deps) {
  const { readJsonResponse, formatBytes, toast, showError } = deps;

  /**
   * 清理音乐缓存
   */
  async function clearPlaybackMusicCache() {
    const button = document.getElementById('playbackClearCacheBtn');
    if (button) button.disabled = true;
    try {
      const response = await fetch('/api/music/cache/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const payload = await readJsonResponse(response, '清理音乐缓存失败');
      assertApiResponse(response, payload, '清理音乐缓存失败');
      toast(`已清理 ${formatBytes(payload.data.clearedBytes || 0)} 音乐缓存`);
    } catch (error) {
      showError(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  return {
    clearPlaybackMusicCache,
  };
}
