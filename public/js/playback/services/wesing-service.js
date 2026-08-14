// 全民 K 歌前端适配器：只负责 API/实时状态与专属界面，不参与在线音乐播放逻辑。
'use strict';

import { LyricWordRenderer } from '../../shared/lyric-word-renderer.js';
import { refreshParameterRange } from '../../shared/parameter-range.js';

const EMPTY_STATUS = {
  active: false,
  supported: true,
  cachePath: '',
  cacheReady: false,
  platformDetected: false,
  qrcReady: false,
  lyricSource: '',
  trackTitle: '',
  currentMs: 0,
  durationMs: 0,
  playing: false,
  waitingForPlayback: true,
  lyricOffsetMs: 0,
  status: 'inactive',
  message: '请选择 WeSingCache 目录后开始检测。',
  lyricState: {
    lineText: '', words: [], currentMs: 0, durationMs: 0,
    progress: 0, playing: false, status: 'idle'
  }
};

/**
 * 在播放器编排层与全民 K 歌 HTTP/WebSocket 协议之间建立一个窄适配层。
 * 控制器只调用 init/setSelected/refresh/getProviderHealth；DOM 和动画细节留在本模块。
 */
export class WeSingService {
  constructor(options = {}) {
    this.playbackState = options.playbackState;
    this.onStateChange = options.onStateChange || (() => {});
    this.showError = options.showError || (() => {});
    this.toast = options.toast || (() => {});
    this.readJsonResponse = options.readJsonResponse;
    this.status = { ...EMPTY_STATUS, lyricState: { ...EMPTY_STATUS.lyricState } };
    this.selected = null;
    this.initialized = false;
    this.activationQueue = Promise.resolve();
    this.lyricRenderer = null;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    document.getElementById('weSingSaveCacheBtn')?.addEventListener('click', () => {
      void this.saveCachePath();
    });
    document.getElementById('weSingSelectCacheBtn')?.addEventListener('click', () => {
      void this.selectCachePath();
    });
    document.getElementById('weSingRefreshBtn')?.addEventListener('click', () => {
      void this.refresh({ notify: true });
    });
    const offsetRange = document.getElementById('weSingLyricOffsetMs');
    const offsetNumber = document.getElementById('weSingLyricOffsetMsNumber');
    offsetRange?.addEventListener('input', () => {
      if (offsetNumber) offsetNumber.value = offsetRange.value;
    });
    offsetRange?.addEventListener('change', () => {
      void this.saveLyricOffset(offsetRange.value);
    });
    offsetNumber?.addEventListener('input', () => {
      const offsetMs = parseLyricOffset(offsetNumber.value);
      if (offsetRange && offsetMs !== null) {
        offsetRange.value = String(offsetMs);
        refreshParameterRange(offsetRange);
      }
    });
    offsetNumber?.addEventListener('change', () => {
      void this.saveLyricOffset(offsetNumber.value);
    });
    document.getElementById('weSingResetLyricOffsetBtn')?.addEventListener('click', () => {
      void this.saveLyricOffset(0);
    });
    document.getElementById('weSingCachePath')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.saveCachePath();
      }
    });
    window.addEventListener('app:wesing-state', (event) => this.applyStatus(event.detail));
    window.addEventListener('app:lyric-state', (event) => {
      if (this.playbackState?.selectedSource === 'wesing') this.applyLyricState(event.detail);
    });
    this.lyricRenderer = new LyricWordRenderer({
      lineElement: document.getElementById('weSingLyricLine'),
      progressElement: document.getElementById('weSingProgressBar'),
      wordClass: 'wesing-lyric-word',
      progressProperty: '--wesing-word-progress',
      fallbackText: lyricFallback,
      onFrame: (position) => setText('weSingCurrentTime', formatTime(position.currentMs))
    });
    this.render();
  }

  /** Serialize source switches so a rapid tab change cannot leave the backend in the older state. */
  setSelected(selected) {
    const nextSelected = selected === true;
    if (this.selected === nextSelected) return this.activationQueue;
    this.selected = nextSelected;
    this.activationQueue = this.activationQueue
      .catch(() => {})
      .then(async () => {
        const data = await this.request('/api/music/wesing/active', {
          method: 'POST',
          body: { active: nextSelected }
        });
        if (this.selected === nextSelected) this.applyStatus(data);
        return data;
      })
      .catch((error) => {
        this.applyLocalError(error);
        return this.status;
      });
    return this.activationQueue;
  }

  async refresh(options = {}) {
    try {
      const data = await this.request('/api/music/wesing/refresh', { method: 'POST', body: {} });
      this.applyStatus(data);
      if (options.notify) this.toast(data.message || '全民 K 歌检测已刷新');
      return data;
    } catch (error) {
      this.applyLocalError(error);
      if (options.notify) this.showError(error);
      return this.status;
    }
  }

  async saveCachePath() {
    const input = document.getElementById('weSingCachePath');
    const cachePath = input ? input.value.trim() : '';
    try {
      const data = await this.request('/api/music/wesing/configure', {
        method: 'POST',
        body: { cachePath }
      });
      this.applyStatus(data);
      this.toast('全民 K 歌缓存目录已保存');
    } catch (error) {
      this.showError(error);
    }
  }

  async saveLyricOffset(rawValue) {
    const offsetMs = parseLyricOffset(rawValue);
    if (offsetMs === null) {
      this.renderOffsetInputs(true);
      this.showError(new Error('歌词时间偏移必须在 -3000 到 3000 毫秒之间'));
      return;
    }
    try {
      const data = await this.request('/api/music/wesing/offset', {
        method: 'POST',
        body: { offsetMs }
      });
      this.applyStatus(data);
      this.renderOffsetInputs(true);
      this.toast(`全民歌词偏移已设为 ${formatSignedMilliseconds(offsetMs)}`);
    } catch (error) {
      this.renderOffsetInputs(true);
      this.showError(error);
    }
  }

  async selectCachePath() {
    if (!window.musicAPI || typeof window.musicAPI.selectWeSingCacheDirectory !== 'function') {
      this.toast('目录选择器需要在桌面版里使用，也可以直接粘贴路径');
      return;
    }
    try {
      const result = await window.musicAPI.selectWeSingCacheDirectory();
      if (!result || result.canceled || !result.path) return;
      const input = document.getElementById('weSingCachePath');
      if (input) input.value = result.path;
      await this.saveCachePath();
    } catch (error) {
      this.showError(error);
    }
  }

  getAuthState() {
    return { loggedIn: this.status.platformDetected === true };
  }

  getProviderHealth() {
    const ok = this.status.supported && this.status.cacheReady;
    return {
      source: 'wesing',
      ok,
      status: this.status.status,
      message: this.status.message,
      platformDetected: this.status.platformDetected,
      cacheReady: this.status.cacheReady
    };
  }

  applyStatus(nextState) {
    if (!nextState || typeof nextState !== 'object') return;
    this.status = {
      ...this.status,
      ...nextState,
      lyricState: { ...this.status.lyricState, ...(nextState.lyricState || {}) }
    };
    this.applyLyricState(this.status.lyricState, { notify: false });
    this.render();
    this.onStateChange(this.status);
  }

  applyLyricState(nextState, options = {}) {
    if (!nextState || typeof nextState !== 'object') return;
    this.status.lyricState = { ...this.status.lyricState, ...nextState };
    this.lyricRenderer?.setState(this.status.lyricState);
    this.renderLyricContent();
    if (options.notify !== false) this.render();
  }

  render() {
    const status = this.status;
    setText('weSingTrackTitle', status.trackTitle || '尚未检测到歌曲');
    setText('weSingTrackMeta', status.trackTitle
      ? (status.lyricState.artists || []).join(' / ') || formatLyricSource(status.lyricSource)
      : '启动全民 K 歌并开始播放后，这里会自动跟随。');
    setText('weSingPlaybackState', status.playing
      ? '正在播放'
      : !status.platformDetected ? '等待全民 K 歌播放' : status.waitingForPlayback ? '等待全民开始播放' : '已暂停');
    setText('weSingStatusMessage', status.message || EMPTY_STATUS.message);
    setText('weSingClientStatus', status.platformDetected ? '已检测' : '未检测');
    setText('weSingCacheStatus', status.cacheReady ? '本地 QRC 可用' : '本地未生成 / 在线回退');
    setText('weSingLyricStatus', status.qrcReady
      ? `${formatLyricSource(status.lyricSource)}同步中`
      : status.status === 'loading' ? '匹配中' : '等待歌曲');
    setText('weSingCurrentTime', formatTime(numberValue(status.lyricState.currentMs, status.currentMs)));
    setText('weSingDuration', formatTime(status.lyricState.durationMs || status.durationMs));

    const pathInput = document.getElementById('weSingCachePath');
    if (pathInput && pathInput !== document.activeElement && status.cachePath) {
      pathInput.value = status.cachePath;
    }
    this.renderOffsetInputs();
    setSignal('weSingClientSignal', status.platformDetected);
    setSignal('weSingCacheSignal', status.cacheReady);
    setSignal('weSingLyricSignal', status.qrcReady);

    const badge = document.getElementById('weSingCaptureStatus');
    if (badge) {
      badge.textContent = status.qrcReady ? '歌词捕捉中' : status.platformDetected ? '已检测客户端' : '等待检测';
      badge.className = `pill ${status.qrcReady ? 'good' : 'warn'}`;
    }
    this.renderLyricContent();
  }

  renderLyricContent() {
    const lyricState = this.status.lyricState || EMPTY_STATUS.lyricState;
    setText('weSingLyricHint', this.status.qrcReady
      ? '逐字进度正在同步到桌面歌词'
      : this.status.message || '逐字进度会同步发送到桌面歌词');
    this.lyricRenderer?.setState(lyricState);
  }

  renderOffsetInputs(force = false) {
    const value = String(numberValue(this.status.lyricOffsetMs, 0));
    const range = document.getElementById('weSingLyricOffsetMs');
    const number = document.getElementById('weSingLyricOffsetMsNumber');
    if (range && (force || range !== document.activeElement)) {
      range.value = value;
      refreshParameterRange(range);
    }
    if (number && (force || number !== document.activeElement)) number.value = value;
  }

  async request(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (window.__API_TOKEN__) headers.Authorization = `Bearer ${window.__API_TOKEN__}`;
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
    const payload = this.readJsonResponse
      ? await this.readJsonResponse(response, '全民 K 歌请求失败')
      : await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || '全民 K 歌请求失败');
    return payload.data || {};
  }

  applyLocalError(error) {
    this.status = {
      ...this.status,
      status: 'error',
      message: error.message || String(error)
    };
    this.render();
    this.onStateChange(this.status);
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value || '');
}

function setSignal(id, active) {
  document.getElementById(id)?.classList.toggle('is-active', active === true);
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(numberValue(milliseconds, 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatLyricSource(source) {
  if (source === 'qq') return 'QQ 音乐歌词';
  if (source === 'netease') return '网易云歌词';
  if (source === 'wesing') return '全民本地 QRC';
  return '全民 K歌客户端';
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseLyricOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < -3000 || number > 3000) return null;
  return Math.round(number);
}

function formatSignedMilliseconds(value) {
  const number = numberValue(value, 0);
  return `${number > 0 ? '+' : ''}${number} ms`;
}

function lyricFallback(state) {
  if (state.status === 'loading') return '正在读取歌词…';
  if (state.status === 'empty') return '这首歌尚未找到本地歌词';
  return '等待歌词';
}
