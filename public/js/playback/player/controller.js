// 编写人：Aurora
// 播放器控制器 - 负责播放/暂停、音量、跳转、模式切换
'use strict';

/**
 * 播放器控制器类
 */
export class PlayerController {
  constructor(options = {}) {
    this.audio = options.audio || null;
    this.state = options.state || null;
    this.queueManager = options.queueManager || null;
    this.onTrackChange = options.onTrackChange || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.onError = options.onError || (() => {});
  }

  /**
   * 设置音频元素
   * @param {HTMLAudioElement} audio
   */
  setAudio(audio) {
    this.audio = audio;
  }

  /**
   * 播放/暂停切换
   * @returns {Promise<void>}
   */
  async togglePlayback() {
    if (!this.audio || !this.state) return;

    // 如果没有当前曲目，尝试从队列取一首
    if (!this.state.current && this.queueManager) {
      const next = this.queueManager.takeNext();
      if (next) {
        this.state.current = next.track;
        this.state.currentOrigin = next.origin;
      }
    }

    const track = this.state.current;
    if (!track) {
      this.onError('请先添加本地音频');
      return;
    }

    // 如果音频源不匹配，重新播放
    if (!this.audio.src || this.audio.dataset.trackId !== track.id) {
      await this.playTrack(track, {
        origin: this.state.currentOrigin,
        startAt: this.state.restoredTime
      });
      return;
    }

    // 切换播放/暂停
    if (this.audio.paused) {
      try {
        await this.audio.play();
      } catch (error) {
        this.onError(error);
      }
    } else {
      this.audio.pause();
    }

    this.onStateChange();
  }

  /**
   * 播放指定曲目
   * @param {Object} track - 曲目信息
   * @param {Object} options - 选项
   * @returns {Promise<void>}
   */
  async playTrack(track, options = {}) {
    if (!this.audio || !this.state || !track) return;

    const origin = options.origin || '';
    const startAt = options.startAt || 0;
    const fromHistory = options.fromHistory || false;

    // 保存历史记录
    if (!fromHistory && this.state.current && this.state.current.id !== track.id) {
      this.state.history.push(this.state.current);
      if (this.state.history.length > 50) {
        this.state.history.shift();
      }
    }

    // 更新状态
    this.state.current = track;
    this.state.currentOrigin = origin;

    // 添加到显示历史（去重）
    const existingIndex = this.state.displayHistory.findIndex((item) => item.id === track.id);
    if (existingIndex >= 0) {
      this.state.displayHistory.splice(existingIndex, 1);
    }
    this.state.displayHistory.unshift({
      ...track,
      playedAt: Date.now()
    });
    if (this.state.displayHistory.length > 20) {
      this.state.displayHistory.pop();
    }

    // 设置音频源（由调用者实现具体逻辑）
    this.onTrackChange(track, { startAt });
  }

  /**
   * 跳转到指定时间
   * @param {number} seconds - 目标时间（秒）
   */
  seek(seconds) {
    if (!this.audio) return;
    if (!Number.isFinite(seconds)) return;

    const duration = this.audio.duration || 0;
    this.audio.currentTime = Math.max(0, Math.min(seconds, duration));
    this.onStateChange();
  }

  /**
   * 设置音量
   * @param {number} volume - 音量值 (0-1)
   */
  setVolume(volume) {
    if (!this.audio || !this.state) return;

    const vol = Math.max(0, Math.min(1, Number(volume) || 0));
    this.audio.volume = vol;
    this.state.volume = vol;
    this.onStateChange();
  }

  /**
   * 切换播放模式
   */
  cycleMode() {
    if (!this.state) return;

    const modes = ['sequence', 'loop', 'single', 'shuffle'];
    const currentIndex = modes.indexOf(this.state.mode);
    const nextIndex = (currentIndex + 1) % modes.length;
    this.state.mode = modes[nextIndex];

    // 如果切换到随机模式，重建随机顺序
    if (this.state.mode === 'shuffle' && this.queueManager) {
      this.queueManager.rebuildShuffleOrder();
    }

    this.onStateChange();
  }

  /**
   * 上一首
   */
  previous() {
    if (!this.audio || !this.state) return;

    // 如果当前播放时间超过5秒，则重新开始
    if (this.audio.currentTime > 5) {
      this.audio.currentTime = 0;
      return;
    }

    // 从历史记录中取出上一首
    const previousTrack = this.state.history.pop();
    if (previousTrack) {
      this.playTrack(previousTrack, {
        fromHistory: true,
        origin: 'history'
      });
    }
  }

  /**
   * 下一首
   * @param {boolean} fromEnded - 是否因为播放结束而自动切换
   */
  next(fromEnded = false) {
    if (!this.audio || !this.state) return;

    // 单曲循环
    if (this.state.mode === 'single' && this.state.current) {
      this.playTrack(this.state.current, {
        origin: this.state.currentOrigin
      });
      return;
    }

    // 从队列取出下一首
    const next = this.queueManager ? this.queueManager.takeNext() : null;
    if (next) {
      this.playTrack(next.track, { origin: next.origin });
      return;
    }

    // 列表循环
    if (this.state.mode === 'loop' && this.state.normalQueueTracks.length > 0) {
      const tracks = this.state.normalQueueTracks;
      const first = tracks[0];
      this.state.normalQueue = tracks.slice(1);
      this.state.playlistIndex = 0;

      if (this.queueManager) {
        this.queueManager.rebuildShuffleOrder();
      }

      this.playTrack(first, { origin: 'normal' });
      return;
    }

    // 队列播放完毕
    if (fromEnded) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }

    this.onStateChange();
  }

  /**
   * 获取当前播放状态
   * @returns {Object}
   */
  getPlayState() {
    if (!this.audio) {
      return {
        playing: false,
        currentTime: 0,
        duration: 0,
        volume: 0.75
      };
    }

    return {
      playing: !this.audio.paused,
      currentTime: this.audio.currentTime || 0,
      duration: this.audio.duration || 0,
      volume: this.audio.volume || 0.75
    };
  }

  /**
   * 停止播放
   */
  stop() {
    if (!this.audio) return;

    this.audio.pause();
    this.audio.currentTime = 0;
    this.onStateChange();
  }

  /**
   * 绑定音频事件
   * @param {Object} handlers - 事件处理器
   */
  bindAudioEvents(handlers = {}) {
    if (!this.audio) return;

    const {
      onPlay,
      onPause,
      onEnded,
      onTimeUpdate,
      onVolumeChange,
      onError,
      onLoadedMetadata
    } = handlers;

    if (onPlay) this.audio.addEventListener('play', onPlay);
    if (onPause) this.audio.addEventListener('pause', onPause);
    if (onEnded) this.audio.addEventListener('ended', onEnded);
    if (onTimeUpdate) this.audio.addEventListener('timeupdate', onTimeUpdate);
    if (onVolumeChange) this.audio.addEventListener('volumechange', onVolumeChange);
    if (onError) this.audio.addEventListener('error', onError);
    if (onLoadedMetadata) this.audio.addEventListener('loadedmetadata', onLoadedMetadata);
  }

  /**
   * 解绑音频事件
   * @param {Object} handlers - 事件处理器
   */
  unbindAudioEvents(handlers = {}) {
    if (!this.audio) return;

    const {
      onPlay,
      onPause,
      onEnded,
      onTimeUpdate,
      onVolumeChange,
      onError,
      onLoadedMetadata
    } = handlers;

    if (onPlay) this.audio.removeEventListener('play', onPlay);
    if (onPause) this.audio.removeEventListener('pause', onPause);
    if (onEnded) this.audio.removeEventListener('ended', onEnded);
    if (onTimeUpdate) this.audio.removeEventListener('timeupdate', onTimeUpdate);
    if (onVolumeChange) this.audio.removeEventListener('volumechange', onVolumeChange);
    if (onError) this.audio.removeEventListener('error', onError);
    if (onLoadedMetadata) this.audio.removeEventListener('loadedmetadata', onLoadedMetadata);
  }
}
