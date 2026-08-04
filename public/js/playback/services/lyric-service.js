// 编写人：Aurora
// 歌词服务 - 负责歌词加载、桌面歌词窗口管理、歌词同步
'use strict';

/**
 * 歌词服务类
 */
export class LyricService {
  constructor(options = {}) {
    this.state = options.state || null;
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.windowOpen = false;
    this.windowLocked = false;
    this.lastPublishedState = '';
    this.lastPublishedAt = 0;
  }

  /**
   * 加载歌曲歌词
   * @param {Object} track - 曲目信息
   * @returns {Promise<Object>} 歌词数据
   */
  async loadLyrics(track) {
    if (!track) return null;

    // 跳过本地音频或已有歌词的曲目
    if (this.isLocalTrack(track)) return null;
    if (track.lyrics && Array.isArray(track.lyrics.lines)) return track.lyrics;

    try {
      const response = await fetch('/api/music/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track: this.serializeTrackForProvider(track)
        })
      });

      const payload = await this.readJsonResponse(response, '获取歌词失败');

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '获取歌词失败');
      }

      return payload.data;
    } catch (error) {
      console.warn('[LyricService] load lyrics failed:', error.message || error);
      return null;
    }
  }

  /**
   * 查找当前时间对应的歌词行
   * @param {Object} track - 曲目信息
   * @param {number} currentMs - 当前时间（毫秒）
   * @returns {Object|null} 歌词行对象
   */
  findLyricLine(track, currentMs) {
    const lines = track && track.lyrics && Array.isArray(track.lyrics.lines)
      ? track.lyrics.lines
      : [];

    if (!lines.length) return null;

    // 二分查找当前时间对应的歌词行
    let low = 0;
    let high = lines.length - 1;
    let result = null;
    const target = Math.max(0, Number(currentMs) || 0);

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const line = lines[mid];

      if (Number(line.startMs) <= target) {
        result = line;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  }

  /**
   * 打开桌面歌词窗口
   * @returns {Promise<boolean>} 是否成功打开
   */
  async openWindow() {
    if (!window.musicAPI || typeof window.musicAPI.openLyricWindow !== 'function') {
      throw new Error('桌面歌词需要在桌面版里使用');
    }

    try {
      await window.musicAPI.openLyricWindow();
      this.windowOpen = true;
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  /**
   * 关闭桌面歌词窗口
   * @returns {Promise<boolean>} 是否成功关闭
   */
  async closeWindow() {
    if (!window.musicAPI || typeof window.musicAPI.closeLyricWindow !== 'function') {
      return false;
    }

    try {
      await window.musicAPI.closeLyricWindow();
      this.windowOpen = false;
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  /**
   * 切换桌面歌词窗口开关状态
   * @returns {Promise<boolean>} 切换后的状态
   */
  async toggleWindow() {
    if (!window.musicAPI || typeof window.musicAPI.openLyricWindow !== 'function') {
      throw new Error('桌面歌词需要在桌面版里使用');
    }

    if (this.windowOpen) {
      await this.closeWindow();
    } else {
      await this.openWindow();
    }

    return this.windowOpen;
  }

  /**
   * 设置桌面歌词窗口锁定状态
   * @param {boolean} locked - 是否锁定
   * @returns {Promise<boolean>} 设置后的锁定状态
   */
  async setWindowLocked(locked) {
    if (!window.musicAPI || typeof window.musicAPI.setLyricWindowLocked !== 'function') {
      return this.windowLocked;
    }

    try {
      const result = await window.musicAPI.setLyricWindowLocked(locked);
      this.windowLocked = Boolean(result && result.locked);
      return this.windowLocked;
    } catch (error) {
      this.onError(error);
      return this.windowLocked;
    }
  }

  /**
   * 切换桌面歌词窗口锁定状态
   * @returns {Promise<boolean>} 切换后的锁定状态
   */
  async toggleWindowLock() {
    return this.setWindowLocked(!this.windowLocked);
  }

  /**
   * 同步桌面歌词窗口
   * @param {Object} track - 当前曲目
   * @param {HTMLAudioElement} audio - 音频元素
   * @param {boolean} force - 是否强制同步
   * @returns {Promise<void>}
   */
  async syncWindow(track, audio, force = false) {
    const wasOpen = this.windowOpen;
    const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
    const currentTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const progress = duration > 0 ? currentTime / duration : 0;
    const lyricLine = this.findLyricLine(track, currentTime * 1000);
    const hasLyrics = Boolean(track?.lyrics && Array.isArray(track.lyrics.lines));
    const state = {
      trackTitle: track?.title || '',
      artists: Array.isArray(track?.artists) ? track.artists : [],
      lineText: lyricLine?.text || '',
      translation: lyricLine?.translation || '',
      words: Array.isArray(lyricLine?.words) ? lyricLine.words : [],
      currentMs: Math.round(currentTime * 1000),
      progress,
      playing: audio ? !audio.paused : false,
      locked: this.windowLocked,
      status: !track ? 'idle' : !hasLyrics ? 'loading' : track.lyrics.lines.length > 0 ? 'ready' : 'empty'
    };

    await this.publishBrowserState(state, force);

    if (!this.windowOpen && !force) return false;
    if (!window.musicAPI || typeof window.musicAPI.updateLyricWindow !== 'function') return false;

    try {
      const result = await window.musicAPI.updateLyricWindow(state);

      this.windowOpen = Boolean(result && result.open);
    } catch (_) {
      this.windowOpen = false;
    }

    return wasOpen !== this.windowOpen;
  }

  async publishBrowserState(state, force) {
    const now = Date.now();
    const roundedState = {
      ...state,
      currentMs: Math.round(Number(state.currentMs || 0) / 100) * 100,
      progress: Math.round(Number(state.progress || 0) * 1000) / 1000
    };
    const serialized = JSON.stringify(roundedState);
    if (!force && serialized === this.lastPublishedState) return;
    if (!force && now - this.lastPublishedAt < 180) return;
    this.lastPublishedState = serialized;
    this.lastPublishedAt = now;

    try {
      const response = await fetch('/api/playback/lyric-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized
      });
      if (!response.ok) this.lastPublishedState = '';
    } catch (_) {
      this.lastPublishedState = '';
    }
  }

  /**
   * 获取桌面歌词窗口状态
   * @returns {Object}
   */
  getWindowState() {
    return {
      open: this.windowOpen,
      locked: this.windowLocked
    };
  }

  /**
   * 检查是否为本地音频
   * @private
   * @param {Object} track - 曲目信息
   * @returns {boolean}
   */
  isLocalTrack(track) {
    return track && track.source === 'local';
  }

  /**
   * 序列化曲目信息用于 API 调用
   * @private
   * @param {Object} track - 曲目信息
   * @returns {Object}
   */
  serializeTrackForProvider(track) {
    if (!track) return null;

    return {
      id: track.id,
      source: track.source,
      title: track.title,
      artists: track.artists,
      album: track.album,
      sourceTrackId: track.sourceTrackId,
      sourceSongId: track.sourceSongId,
      sourceAlbumId: track.sourceAlbumId,
      durationMs: track.durationMs
    };
  }
}
