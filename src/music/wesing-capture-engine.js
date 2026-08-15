'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { findCurrentLyricLine } = require('./lyrics');
const { normalizeLyricState } = require('./lyric-state');
const {
  formatLyricSource,
  isDirectory,
  loadWeSingLyrics,
  normalizeWeSingCachePath,
  normalizeWeSingLyricOffsetMs,
  safeInitialCachePath,
  safeInitialLyricOffsetMs,
  stripWeSingWindowTitle
} = require('./wesing-cache');
const { createPowerShellWeSingMonitor } = require('./wesing-monitor');

const PAUSED_AFTER_MS = 1500;
const PROGRESS_COMPENSATION_MS = 130;
const QRC_REFRESH_DEBOUNCE_MS = 2000;
const PLAYBACK_REFRESH_DELAY_MS = 1000;

function createWeSingCapture(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => performance.now();
  const platform = options.platform || process.platform;
  const onState = typeof options.onState === 'function' ? options.onState : () => {};
  const onTimeline = typeof options.onTimeline === 'function' ? options.onTimeline : () => {};
  const monitorFactory = options.monitorFactory || ((callback) => createPowerShellWeSingMonitor(callback));
  const watchFactory = options.watchFactory || ((directoryPath, watchOptions, listener) => (
    fs.watch(directoryPath, watchOptions, listener)
  ));
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout;
  const resolveFallbackLyrics = typeof options.resolveFallbackLyrics === 'function'
    ? options.resolveFallbackLyrics
    : null;
  let cachePath = safeInitialCachePath(options.cachePath);
  let lyricOffsetMs = safeInitialLyricOffsetMs(options.lyricOffsetMs);
  let monitor = null;
  let cacheWatcher = null;
  let watchedCachePath = '';
  let qrcRefreshTimer = null;
  let playbackRefreshTimer = null;
  let playbackRefreshPending = false;
  let lyrics = [];
  let lyricArtists = [];
  let lyricDurationMs = 0;
  let refreshVersion = 0;
  let pendingRefresh = Promise.resolve();
  let lastProgressMs = -1;
  let lastProgressChangeAt = 0;
  let playbackClockBaseMs = 0;
  let playbackClockStartedAt = 0;
  let playbackClockRunning = false;
  let hasStartedCurrentTrack = false;
  let loadingTrackTitle = '';

  const state = {
    active: false,
    supported: platform === 'win32',
    cachePath,
    cacheReady: false,
    platformDetected: false,
    qrcReady: false,
    lyricSource: '',
    songMid: '',
    trackTitle: '',
    currentMs: 0,
    durationMs: 0,
    playing: false,
    waitingForPlayback: true,
    lyricOffsetMs,
    status: 'inactive',
    message: '全民 K 歌捕捉未启用。',
    lyricState: normalizeLyricState({ status: 'idle' })
  };

  async function setCachePath(input) {
    stopQrcWatcher();
    cachePath = normalizeWeSingCachePath(input);
    state.cachePath = cachePath;
    if (typeof options.saveCachePath === 'function') await options.saveCachePath(cachePath);
    resetLyrics();
    await refresh();
    return getStatus();
  }

  async function setLyricOffsetMs(input) {
    const nextLyricOffsetMs = normalizeWeSingLyricOffsetMs(input);
    if (typeof options.saveLyricOffsetMs === 'function') {
      await options.saveLyricOffsetMs(nextLyricOffsetMs);
    }
    lyricOffsetMs = nextLyricOffsetMs;
    state.lyricOffsetMs = lyricOffsetMs;
    updateLyricState();
    emit();
    return getStatus();
  }

  async function setActive(active) {
    const nextActive = active === true;
    if (nextActive === state.active) {
      if (nextActive) await refresh();
      return getStatus();
    }
    state.active = nextActive;
    if (!nextActive) {
      stopMonitor();
      stopQrcWatcher();
      cancelPlaybackRefresh();
      loadingTrackTitle = '';
      pausePlaybackClock(now());
      state.playing = false;
      state.platformDetected = false;
      state.status = 'inactive';
      state.message = '全民 K 歌捕捉未启用。';
      updateLyricState();
      emit();
      return getStatus();
    }
    if (!state.supported) {
      state.status = 'unsupported';
      state.message = '全民 K 歌捕捉目前只支持 Windows。';
      updateLyricState();
      emit();
      return getStatus();
    }
    try {
      monitor = monitorFactory(handleMonitorSample);
      monitor.start();
      state.status = 'waiting';
      state.message = '正在检测全民 K 歌客户端…';
    } catch (error) {
      state.status = 'error';
      state.message = `无法启动全民 K 歌检测：${error.message || String(error)}`;
    }
    await refresh();
    return getStatus();
  }

  async function refresh() {
    state.cacheReady = await isDirectory(path.join(cachePath, 'WeSingDL', 'Res'));
    await syncQrcWatcher();
    if (!state.active) {
      emit();
      return getStatus();
    }
    if (state.trackTitle) {
      pendingRefresh = refreshLyrics(state.trackTitle);
      await pendingRefresh;
    } else {
      state.status = 'waiting';
      state.message = state.platformDetected
        ? '已检测到全民 K 歌，等待开始播放。'
        : state.cacheReady
          ? '缓存目录可用，等待启动全民 K 歌。'
          : '等待启动全民 K 歌；本地缓存未生成时将自动匹配在线歌词。';
      emit();
    }
    return getStatus();
  }

  function handleMonitorSample(sample = {}) {
    if (!state.active) return;
    if (sample.error) {
      const timestamp = now();
      pausePlaybackClock(timestamp);
      state.currentMs = readPlaybackClock(timestamp);
      state.playing = false;
      state.status = 'error';
      state.message = `全民 K 歌检测异常：${String(sample.error).slice(0, 160)}`;
      updateLyricState();
      emit();
      return;
    }

    const timestamp = now();
    const wasPlatformDetected = state.platformDetected;
    state.platformDetected = sample.detected === true;
    const title = stripWeSingWindowTitle(sample.title);
    const sampledCurrentSec = Number(sample.currentSec);
    const hasSampledProgress = Number.isFinite(sampledCurrentSec) && sampledCurrentSec >= 0;
    const sampledCurrentMs = hasSampledProgress ? sampledCurrentSec * 1000 : null;
    const sampledDurationSec = Number(sample.totalSec);
    const sampledDurationMs = Number.isFinite(sampledDurationSec) && sampledDurationSec > 0
      ? sampledDurationSec * 1000
      : 0;
    const audioActive = sample.audioActive === true
      ? true
      : sample.audioActive === false
        ? false
        : null;

    if (!state.platformDetected) {
      cancelPlaybackRefresh();
      loadingTrackTitle = '';
      pausePlaybackClock(timestamp);
      state.currentMs = readPlaybackClock(timestamp);
      state.playing = false;
      state.status = 'waiting';
      state.message = '等待启动全民 K 歌客户端。';
      updateLyricState();
      emit();
      return;
    }

    const titleChanged = title !== state.trackTitle;
    const platformResumed = !wasPlatformDetected && !titleChanged;
    if (platformResumed) {
      state.currentMs = 0;
      state.playing = false;
      resetPlaybackClock(timestamp);
    }
    if (titleChanged) {
      cancelPlaybackRefresh();
      playbackRefreshPending = Boolean(title);
      loadingTrackTitle = '';
      state.trackTitle = title;
      state.currentMs = 0;
      state.playing = false;
      state.durationMs = sampledDurationMs;
      resetPlaybackClock(timestamp);
      resetLyrics();
      if (title) {
        state.status = 'loading';
        state.message = `正在匹配《${title}》的歌词…`;
        pendingRefresh = refreshLyrics(title);
      }
    }

    if (!title) {
      loadingTrackTitle = '';
      pausePlaybackClock(timestamp);
      state.currentMs = readPlaybackClock(timestamp);
      state.playing = false;
      state.status = 'waiting';
      state.message = '已检测到全民 K 歌，等待开始播放。';
      updateLyricState();
      emit();
      return;
    }

    if (sampledDurationMs > 0) state.durationMs = sampledDurationMs;

    if (sample.loading === true) {
      loadingTrackTitle = title;
      resetPlaybackClock(timestamp);
      state.currentMs = 0;
      state.playing = false;
      state.message = `全民 K 歌正在加载《${title}》，歌词将在播放后开始。`;
      updateLyricState();
      emit();
      return;
    }

    if (loadingTrackTitle === title) {
      loadingTrackTitle = '';
    }

    if (audioActive === false) {
      pausePlaybackClock(timestamp);
      if (hasSampledProgress) {
        lastProgressMs = sampledCurrentMs;
        lastProgressChangeAt = timestamp;
        setPlaybackClock(sampledCurrentMs + PROGRESS_COMPENSATION_MS, timestamp);
      }
      state.currentMs = readPlaybackClock(timestamp);
      state.playing = false;
      state.waitingForPlayback = !hasStartedCurrentTrack;
      updateLyricState();
      emit();
      return;
    }

    if (hasSampledProgress) {
      const progressChanged = lastProgressMs >= 0 && sampledCurrentMs !== lastProgressMs;
      const isFirstProgress = lastProgressMs < 0;
      const replayedFromStart = lastProgressMs > 3000
        && sampledCurrentMs <= 2000
        && sampledCurrentMs < lastProgressMs - 2000;

      if (replayedFromStart) {
        pausePlaybackClock(timestamp);
        lastProgressMs = sampledCurrentMs;
        lastProgressChangeAt = timestamp;
        setPlaybackClock(sampledCurrentMs + PROGRESS_COMPENSATION_MS, timestamp);
        hasStartedCurrentTrack = sampledCurrentMs > 0;
        state.playing = sampledCurrentMs > 0;
        state.waitingForPlayback = sampledCurrentMs === 0;
        if (state.playing) startPlaybackClock(timestamp);
        state.message = `检测到《${title}》重新开始，歌词已回到开头。`;
      } else if (progressChanged) {
        lastProgressMs = sampledCurrentMs;
        lastProgressChangeAt = timestamp;
        setPlaybackClock(sampledCurrentMs + PROGRESS_COMPENSATION_MS, timestamp);
        startPlaybackClock(timestamp);
        state.playing = true;
        hasStartedCurrentTrack = true;
        state.waitingForPlayback = false;
        if (state.qrcReady) state.message = `正在同步《${title}》的逐字歌词。`;
      } else if (isFirstProgress) {
        lastProgressMs = sampledCurrentMs;
        lastProgressChangeAt = timestamp;
        setPlaybackClock(sampledCurrentMs + PROGRESS_COMPENSATION_MS, timestamp);
        if (sampledCurrentMs > 0) {
          startPlaybackClock(timestamp);
          state.playing = true;
          hasStartedCurrentTrack = true;
          state.waitingForPlayback = false;
        } else {
          pausePlaybackClock(timestamp);
          state.playing = false;
          state.waitingForPlayback = true;
        }
      } else if (timestamp - lastProgressChangeAt > PAUSED_AFTER_MS) {
        pausePlaybackClock(timestamp);
        state.playing = false;
      }
    } else if (audioActive === true) {
      startPlaybackClock(timestamp);
      state.playing = true;
      hasStartedCurrentTrack = true;
      state.waitingForPlayback = false;
      if (state.qrcReady) state.message = `正在同步《${title}》的逐字歌词。`;
    } else {
      pausePlaybackClock(timestamp);
      state.playing = false;
      state.waitingForPlayback = !hasStartedCurrentTrack;
    }

    state.currentMs = readPlaybackClock(timestamp);
    if (playbackRefreshPending && state.playing) schedulePlaybackRefresh(title);
    updateLyricState();
    emit();
  }

  function readPlaybackClock(timestamp) {
    const elapsed = playbackClockRunning
      ? Math.max(0, timestamp - playbackClockStartedAt)
      : 0;
    const currentMs = Math.max(0, playbackClockBaseMs + elapsed);
    const durationMs = state.durationMs || lyricDurationMs;
    return durationMs > 0 ? Math.min(durationMs, currentMs) : currentMs;
  }

  function setPlaybackClock(currentMs, timestamp) {
    playbackClockBaseMs = Math.max(0, Number(currentMs) || 0);
    playbackClockStartedAt = timestamp;
  }

  function startPlaybackClock(timestamp) {
    if (playbackClockRunning) return;
    playbackClockStartedAt = timestamp;
    playbackClockRunning = true;
  }

  function pausePlaybackClock(timestamp) {
    if (!playbackClockRunning) return;
    playbackClockBaseMs = readPlaybackClock(timestamp);
    playbackClockStartedAt = timestamp;
    playbackClockRunning = false;
  }

  function resetPlaybackClock(timestamp) {
    playbackClockBaseMs = 0;
    playbackClockStartedAt = timestamp;
    playbackClockRunning = false;
    lastProgressMs = -1;
    lastProgressChangeAt = timestamp;
    hasStartedCurrentTrack = false;
    state.waitingForPlayback = true;
  }

  async function refreshLyrics(title) {
    const version = ++refreshVersion;
    state.status = 'loading';
    state.message = `正在匹配《${title}》的歌词…`;
    updateLyricState();
    emit();
    let result = null;
    let fallbackError = null;
    if (state.cacheReady) {
      try {
        result = await loadWeSingLyrics({ cachePath, title });
        if (result) result.source = 'wesing';
      } catch (_) {}
    }
    if (!result && resolveFallbackLyrics) {
      try {
        result = await resolveFallbackLyrics({ title, durationMs: state.durationMs });
      } catch (error) {
        fallbackError = error;
      }
    }
    if (version !== refreshVersion || title !== state.trackTitle) return;
    if (!result) {
      lyrics = [];
      lyricArtists = [];
      lyricDurationMs = 0;
      state.qrcReady = false;
      state.status = 'empty';
      state.message = fallbackError
        ? `在线歌词匹配失败：${String(fallbackError.message || fallbackError).slice(0, 120)}`
        : '本地缓存和在线平台都没有找到可靠的匹配歌词。';
      publishTimeline();
      updateLyricState();
      emit();
      return;
    }
    lyrics = result.lines;
    lyricArtists = result.artists;
    lyricDurationMs = result.durationMs;
    state.lyricSource = result.source || 'wesing';
    state.songMid = result.songMid;
    state.qrcReady = lyrics.length > 0;
    if (!state.durationMs && lyricDurationMs) state.durationMs = lyricDurationMs;
    state.status = state.qrcReady ? 'ready' : 'empty';
    state.message = state.qrcReady
      ? state.lyricSource === 'wesing'
        ? `已从本地 QRC 捕捉《${title}》的逐字歌词。`
        : `已从${formatLyricSource(state.lyricSource)}匹配《${title}》的歌词。`
      : '歌词已读取，但没有可显示的内容。';
    publishTimeline();
    updateLyricState();
    emit();
  }

  function updateLyricState() {
    const durationMs = state.durationMs || lyricDurationMs;
    const lyricCurrentMs = durationMs > 0
      ? Math.min(durationMs, Math.max(0, state.currentMs + lyricOffsetMs))
      : Math.max(0, state.currentMs + lyricOffsetMs);
    const currentLine = findCurrentLyricLine(lyrics, lyricCurrentMs);
    state.lyricState = normalizeLyricState({
      trackTitle: state.trackTitle,
      artists: lyricArtists,
      lineText: currentLine ? currentLine.text : '',
      translation: currentLine ? currentLine.translation : '',
      words: currentLine ? currentLine.words : [],
      currentMs: lyricCurrentMs,
      durationMs,
      progress: durationMs > 0 ? lyricCurrentMs / durationMs : 0,
      playing: state.playing,
      status: state.qrcReady ? 'ready' : state.status === 'loading' ? 'loading' : state.status === 'empty' ? 'empty' : 'idle'
    });
  }

  function resetLyrics() {
    refreshVersion += 1;
    lyrics = [];
    lyricArtists = [];
    lyricDurationMs = 0;
    state.qrcReady = false;
    state.lyricSource = '';
    state.songMid = '';
    publishTimeline();
    updateLyricState();
  }

  function publishTimeline() {
    onTimeline({
      active: state.active,
      trackTitle: state.trackTitle,
      artists: lyricArtists,
      status: state.qrcReady ? 'ready' : state.status === 'loading' ? 'loading' : state.status === 'empty' ? 'empty' : 'idle',
      lines: lyrics
    });
  }

  async function syncQrcWatcher() {
    if (!state.active || !cachePath || !await isDirectory(cachePath)) {
      stopQrcWatcher();
      return;
    }
    if (cacheWatcher && watchedCachePath === cachePath) return;
    stopQrcWatcher();
    try {
      cacheWatcher = watchFactory(cachePath, { recursive: true }, handleQrcWatchEvent);
      cacheWatcher.unref?.();
      watchedCachePath = cachePath;
    } catch (_) {
      cacheWatcher = null;
      watchedCachePath = '';
    }
  }

  function handleQrcWatchEvent(_eventType, filename) {
    if (!state.active || !/\.qrc$/i.test(String(filename || ''))) return;
    if (qrcRefreshTimer !== null) clearTimer(qrcRefreshTimer);
    qrcRefreshTimer = setTimer(() => {
      qrcRefreshTimer = null;
      if (!state.active || !state.trackTitle) return;
      pendingRefresh = refreshLyrics(state.trackTitle);
    }, QRC_REFRESH_DEBOUNCE_MS);
    qrcRefreshTimer?.unref?.();
  }

  function schedulePlaybackRefresh(title) {
    playbackRefreshPending = false;
    if (playbackRefreshTimer !== null) clearTimer(playbackRefreshTimer);
    playbackRefreshTimer = setTimer(() => {
      playbackRefreshTimer = null;
      if (!state.active || !state.platformDetected || state.trackTitle !== title) return;
      pendingRefresh = refreshLyrics(title);
    }, PLAYBACK_REFRESH_DELAY_MS);
    playbackRefreshTimer?.unref?.();
  }

  function cancelPlaybackRefresh() {
    if (playbackRefreshTimer !== null) {
      clearTimer(playbackRefreshTimer);
      playbackRefreshTimer = null;
    }
    playbackRefreshPending = false;
  }

  function stopQrcWatcher() {
    if (qrcRefreshTimer !== null) {
      clearTimer(qrcRefreshTimer);
      qrcRefreshTimer = null;
    }
    if (cacheWatcher) {
      try { cacheWatcher.close(); } catch (_) {}
    }
    cacheWatcher = null;
    watchedCachePath = '';
  }

  function stopMonitor() {
    if (!monitor) return;
    try { monitor.stop(); } catch (_) {}
    monitor = null;
  }

  function emit() {
    onState(getStatus());
  }

  function getStatus() {
    return JSON.parse(JSON.stringify(state));
  }

  async function waitForRefresh() {
    await pendingRefresh;
    return getStatus();
  }

  function stop() {
    state.active = false;
    loadingTrackTitle = '';
    pausePlaybackClock(now());
    state.playing = false;
    state.platformDetected = false;
    stopMonitor();
    stopQrcWatcher();
    cancelPlaybackRefresh();
  }

  return { getStatus, refresh, setActive, setCachePath, setLyricOffsetMs, stop, waitForRefresh };
}

module.exports = {
  createWeSingCapture
};
