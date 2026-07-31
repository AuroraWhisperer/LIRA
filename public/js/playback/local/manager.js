// 编写人：Aurora
// 本地文件管理器 - 负责本地音频文件的导入和管理
'use strict';

/**
 * 本地文件管理器
 */
export class LocalFileManager {
  constructor(options = {}) {
    this.onError = options.onError || (() => {});
  }

  /**
   * 加载本地最近历史
   * @returns {Promise<Array>} 本地文件列表
   */
  async loadRecentHistory() {
    if (!window.musicAPI || typeof window.musicAPI.getRecentLocalFiles !== 'function') {
      return [];
    }

    try {
      const result = await window.musicAPI.getRecentLocalFiles();
      const files = Array.isArray(result && result.files) ? result.files : [];

      // 转换为曲目格式
      return files.map((file) => ({
        id: `local:${file.path}`,
        source: 'local',
        title: file.title || file.name || '未知歌曲',
        artists: file.artist ? [file.artist] : [],
        album: file.album || '',
        coverUrl: '',
        durationMs: file.duration ? file.duration * 1000 : 0,
        fileName: file.name || '',
        filePath: file.path || '',
        objectUrl: null // 需要重新选择文件
      }));
    } catch (error) {
      console.error('[LocalFileManager] loadRecentHistory failed:', error);
      this.onError(error);
      return [];
    }
  }

  /**
   * 请求选择本地文件
   * @returns {Promise<Array>} 选中的文件列表
   */
  async selectLocalFiles() {
    if (!window.musicAPI || typeof window.musicAPI.selectLocalFiles !== 'function') {
      throw new Error('本地文件功能不可用');
    }

    try {
      const result = await window.musicAPI.selectLocalFiles();

      if (!result || !result.ok) {
        if (result && result.canceled) {
          return [];
        }
        throw new Error(result && result.error || '选择文件失败');
      }

      const files = Array.isArray(result.files) ? result.files : [];

      // 转换为曲目格式
      return files.map((file) => ({
        id: `local:${file.path}`,
        source: 'local',
        title: file.title || file.name || '未知歌曲',
        artists: file.artist ? [file.artist] : [],
        album: file.album || '',
        coverUrl: '',
        durationMs: file.duration ? file.duration * 1000 : 0,
        fileName: file.name || '',
        filePath: file.path || '',
        objectUrl: file.objectUrl || null
      }));
    } catch (error) {
      console.error('[LocalFileManager] selectLocalFiles failed:', error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * 重新选择本地文件（用于恢复 objectUrl）
   * @param {Object} track - 需要重新选择的曲目
   * @returns {Promise<Object|null>} 更新后的曲目
   */
  async reselectLocalFile(track) {
    if (!track || track.source !== 'local') {
      return null;
    }

    if (!window.musicAPI || typeof window.musicAPI.selectLocalFiles !== 'function') {
      throw new Error('本地文件功能不可用');
    }

    try {
      const result = await window.musicAPI.selectLocalFiles();

      if (!result || !result.ok || result.canceled) {
        return null;
      }

      const files = Array.isArray(result.files) ? result.files : [];
      if (!files.length) {
        return null;
      }

      // 使用第一个选中的文件
      const file = files[0];

      return {
        ...track,
        title: file.title || track.title,
        artists: file.artist ? [file.artist] : track.artists,
        album: file.album || track.album,
        durationMs: file.duration ? file.duration * 1000 : track.durationMs,
        fileName: file.name || track.fileName,
        filePath: file.path || track.filePath,
        objectUrl: file.objectUrl || null
      };
    } catch (error) {
      console.error('[LocalFileManager] reselectLocalFile failed:', error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * 检查本地文件是否需要重新选择
   * @param {Object} track - 曲目
   * @returns {boolean}
   */
  needsReselect(track) {
    return track && track.source === 'local' && !track.objectUrl;
  }

  /**
   * 规范化本地曲目
   * @param {Object} track - 原始曲目
   * @returns {Object} 规范化后的曲目
   */
  normalizeLocalTrack(track) {
    if (!track) return null;

    return {
      id: track.id || `local:${track.filePath || Date.now()}`,
      source: 'local',
      title: track.title || track.fileName || '未知歌曲',
      artists: Array.isArray(track.artists) ? track.artists : [],
      album: track.album || '',
      coverUrl: track.coverUrl || '',
      durationMs: track.durationMs || 0,
      fileName: track.fileName || '',
      filePath: track.filePath || '',
      objectUrl: track.objectUrl || null
    };
  }

  /**
   * 从队列中获取需要重新选择的本地文件
   * @param {Array} queue - 队列
   * @returns {Array} 需要重新选择的曲目列表
   */
  getTracksNeedingReselect(queue) {
    if (!Array.isArray(queue)) return [];
    return queue.filter((track) => this.needsReselect(track));
  }
}
