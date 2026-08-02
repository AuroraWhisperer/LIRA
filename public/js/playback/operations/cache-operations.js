// 编写人：Aurora
// 缓存管理操作模块
'use strict';

/**
 * 创建缓存管理操作模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 缓存操作函数集合
 */
export function createCacheOperations(deps) {
  const {
    readJsonResponse,
    formatBytes,
    toast,
    showError
  } = deps;

  /**
   * 刷新音乐缓存统计信息
   */
  async function refreshPlaybackMusicCacheStats() {
    const status = document.getElementById('playbackCacheStatus');
    if (!status) return;
    try {
      const response = await fetch('/api/music/cache');
      const payload = await readJsonResponse(response, '读取音乐缓存失败');
      if (!payload.ok) throw new Error(payload.error || '读取音乐缓存失败');
      status.textContent = `缓存大小：${formatBytes(payload.data.totalBytes || 0)} · ${payload.data.totalFiles || 0} 个文件`;
    } catch (error) {
      status.textContent = error.message || String(error);
    }
  }

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
        body: JSON.stringify({ confirm: true })
      });
      const payload = await readJsonResponse(response, '清理音乐缓存失败');
      if (!payload.ok) throw new Error(payload.error || '清理音乐缓存失败');
      toast(`已清理 ${formatBytes(payload.data.clearedBytes || 0)} 音乐缓存`);
      await refreshPlaybackMusicCacheStats();
    } catch (error) {
      showError(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  return {
    refreshPlaybackMusicCacheStats,
    clearPlaybackMusicCache
  };
}
