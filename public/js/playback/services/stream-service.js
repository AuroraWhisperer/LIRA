// 编写人：Aurora
// 流媒体服务 - 负责播放 URL 解析、刷新和错误重试
'use strict';

/**
 * 流媒体服务类
 */
export class StreamService {
  constructor(options = {}) {
    this.refreshMarginMs = options.refreshMarginMs || 30 * 1000;
    this.maxRetries = options.maxRetries || 1;
    this.onError = options.onError || (() => {});
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.toast = options.toast || (() => {});
    this.retryCount = 0;
  }

  /**
   * 获取曲目的播放 URL
   * @param {Object} track - 曲目信息
   * @param {Object} options - 选项
   * @returns {Promise<string>} 播放 URL
   */
  async getTrackUrl(track, options = {}) {
    if (!track) return '';

    // 本地音频直接返回 objectUrl
    if (this.isLocalTrack(track)) {
      if (!track.objectUrl) {
        this.toast('本地音频需要重新选择文件后才能播放');
        return '';
      }
      return track.objectUrl;
    }

    // 如果不强制刷新且 URL 仍可用，直接返回
    if (!options.forceRefresh && this.hasUsableUrl(track)) {
      return track.playUrl;
    }

    // 解析新的播放地址
    const stream = await this.resolveStream(track, {
      forceRefresh: options.forceRefresh === true
    });

    if (!stream || !stream.url) {
      this.toast('当前账号无法播放该歌曲');
      return '';
    }

    // 更新曲目的播放信息
    track.playUrl = stream.url;
    track.playUrlExpireAt = Number(stream.expireAt || stream.playUrlExpireAt || 0);

    return track.playUrl;
  }

  /**
   * 解析播放流地址
   * @param {Object} track - 曲目信息
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 流信息
   */
  async resolveStream(track, options = {}) {
    const payloadTrack = this.serializeTrackForProvider(track);

    const response = await fetch('/api/music/resolve-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track: payloadTrack,
        forceRefresh: options.forceRefresh === true
      })
    });

    const payload = await this.readJsonResponse(response, '解析播放地址失败');

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `解析播放地址失败（HTTP ${response.status}）`);
    }

    return payload.data;
  }

  /**
   * 处理播放错误（带重试逻辑）
   * @param {Object} track - 当前曲目
   * @param {HTMLAudioElement} audio - 音频元素
   * @param {Function} onRetrySuccess - 重试成功回调
   * @param {Function} onRetryFailed - 重试失败回调
   * @returns {Promise<void>}
   */
  async handlePlaybackError(track, audio, onRetrySuccess, onRetryFailed) {
    if (!track) return;

    // 本地音频播放失败
    if (this.isLocalTrack(track)) {
      this.toast('当前音频播放失败，请重新选择文件或切换下一首');
      return;
    }

    // 超过最大重试次数
    if (this.retryCount >= this.maxRetries) {
      this.toast('播放地址刷新后仍失败，已跳过当前歌曲');
      this.resetRetryCount();
      if (onRetryFailed) onRetryFailed();
      return;
    }

    // 尝试刷新播放地址
    this.retryCount++;
    const resumeAt = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

    try {
      const newUrl = await this.getTrackUrl(track, { forceRefresh: true });

      if (newUrl) {
        this.toast('播放地址已刷新');
        if (onRetrySuccess) {
          onRetrySuccess(track, resumeAt);
        }
      } else {
        throw new Error('无法获取新的播放地址');
      }
    } catch (error) {
      this.onError(error);
      if (onRetryFailed) onRetryFailed();
    }
  }

  /**
   * 重置重试计数
   */
  resetRetryCount() {
    this.retryCount = 0;
  }

  /**
   * 检查曲目的播放 URL 是否可用
   * @param {Object} track - 曲目信息
   * @returns {boolean}
   */
  hasUsableUrl(track) {
    if (!track || !track.playUrl) return false;

    const expireAt = Number(track.playUrlExpireAt || 0);
    if (expireAt === 0) return true;

    const now = Date.now();
    const marginMs = this.refreshMarginMs;

    return now < expireAt - marginMs;
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
      sourceAlbumId: track.sourceAlbumId
    };
  }
}
