// 编写人：Aurora
// 歌词服务 - 负责歌词加载和浏览器源同步
'use strict';

/**
 * 歌词服务类
 */
export class LyricService {
  constructor(options = {}) {
    this.state = options.state || null;
    this.readJsonResponse = options.readJsonResponse || ((r) => r.json());
    this.lastPublishedState = '';
    this.lastPublishedAt = 0;
    this.statePublishInFlight = null;
    this.pendingState = null;
    this.forcedStateQueue = [];
    this.stateGeneration = 0;
    this.stateSequence = 0;
    this.lastStateTrackKey = null;
    this.lastStateLyrics = null;
    this.lastTimelineTrackKey = null;
    this.lastTimelineLyrics = null;
    this.timelinePublishInFlight = null;
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
          track: this.serializeTrackForProvider(track),
        }),
      });

      const payload = await this.readJsonResponse(response, '获取歌词失败');

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '获取歌词失败');
      }

      return payload.data;
    } catch (error) {
      console.warn(
        '[LyricService] load lyrics failed:',
        error.message || error,
      );
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
    const lines =
      track && track.lyrics && Array.isArray(track.lyrics.lines)
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
   * 同步桌面歌词浏览器源
   * @param {Object} track - 当前曲目
   * @param {HTMLAudioElement} audio - 音频元素
   * @param {boolean} force - 是否强制同步
   * @returns {Promise<void>}
   */
  async syncWindow(track, audio, force = false) {
    const duration =
      audio && Number.isFinite(audio.duration) ? audio.duration : 0;
    const currentTime =
      audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const progress = duration > 0 ? currentTime / duration : 0;
    const lyricLine = this.findLyricLine(track, currentTime * 1000);
    const hasLyrics = Boolean(
      track?.lyrics && Array.isArray(track.lyrics.lines),
    );
    const trackKey = track
      ? `${track.source || ''}:${track.id || track.sourceTrackId || track.title || ''}`
      : '';
    const discontinuity =
      force ||
      trackKey !== this.lastStateTrackKey ||
      track?.lyrics !== this.lastStateLyrics;
    if (discontinuity) {
      this.stateGeneration += 1;
      this.stateSequence = 0;
    }
    this.lastStateTrackKey = trackKey;
    this.lastStateLyrics = track?.lyrics || null;
    this.stateSequence += 1;
    const state = {
      trackTitle: track?.title || '',
      artists: Array.isArray(track?.artists) ? track.artists : [],
      lineText: lyricLine?.text || '',
      translation: lyricLine?.translation || '',
      words: Array.isArray(lyricLine?.words) ? lyricLine.words : [],
      currentMs: Math.round(currentTime * 1000),
      durationMs: Math.round(duration * 1000),
      progress,
      playing: audio ? !audio.paused : false,
      locked: false,
      generation: this.stateGeneration,
      sequence: this.stateSequence,
      status: !track
        ? 'idle'
        : !hasLyrics
          ? 'loading'
          : track.lyrics.lines.length > 0
            ? 'ready'
            : 'empty',
    };

    const timelinePublish = this.publishBrowserTimeline(track);
    if (timelinePublish) await timelinePublish;
    await this.publishBrowserState(state, force);
    return false;
  }

  publishBrowserTimeline(track) {
    const trackKey = track
      ? `${track.source || ''}:${track.id || track.sourceTrackId || track.title || ''}`
      : '';
    const lyrics = track?.lyrics || null;
    if (
      trackKey === this.lastTimelineTrackKey &&
      lyrics === this.lastTimelineLyrics
    ) {
      return this.timelinePublishInFlight;
    }

    this.lastTimelineTrackKey = trackKey;
    this.lastTimelineLyrics = lyrics;
    const hasLyrics = Boolean(lyrics && Array.isArray(lyrics.lines));
    const timeline = {
      trackTitle: track?.title || '',
      artists: Array.isArray(track?.artists) ? track.artists : [],
      status: !track
        ? 'idle'
        : !hasLyrics
          ? 'loading'
          : lyrics.lines.length > 0
            ? 'ready'
            : 'empty',
      lines: hasLyrics ? lyrics.lines : [],
    };

    this.timelinePublishInFlight = (async () => {
      try {
        await fetch('/api/playback/lyric-timeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(timeline),
        });
      } catch (_) {}
      this.timelinePublishInFlight = null;
    })();
    return this.timelinePublishInFlight;
  }

  async publishBrowserState(state, force) {
    const now = Date.now();
    const roundedState = {
      ...state,
      currentMs: Math.round(Number(state.currentMs || 0) / 100) * 100,
      progress: Math.round(Number(state.progress || 0) * 1000) / 1000,
    };
    const serialized = JSON.stringify(roundedState);
    if (!force && serialized === this.lastPublishedState) return;
    if (!force && now - this.lastPublishedAt < 180) return;
    return new Promise((resolve) => {
      const request = { serialized, resolve };
      if (force) {
        this.forcedStateQueue.push(request);
      } else {
        if (this.pendingState) this.pendingState.resolve();
        this.pendingState = request;
      }
      this.flushStateQueue();
    });
  }

  flushStateQueue() {
    if (this.statePublishInFlight) return this.statePublishInFlight;
    const request = this.forcedStateQueue.shift() || this.pendingState;
    if (!request) return null;
    if (request === this.pendingState) this.pendingState = null;
    this.statePublishInFlight = (async () => {
      try {
        const response = await fetch('/api/playback/lyric-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: request.serialized,
        });
        this.lastPublishedAt = Date.now();
        this.lastPublishedState = request.serialized;
        if (!response.ok && this.lastPublishedState === request.serialized)
          this.lastPublishedState = '';
      } catch (_) {
        if (this.lastPublishedState === request.serialized)
          this.lastPublishedState = '';
      } finally {
        request.resolve();
        this.statePublishInFlight = null;
        this.flushStateQueue();
      }
    })();
    return this.statePublishInFlight;
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
      durationMs: track.durationMs,
    };
  }
}
