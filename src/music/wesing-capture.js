'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { decryptQrc } = require('qrc-decoder');
const { findCurrentLyricLine, parseLyricResult } = require('./lyrics');
const { normalizeLyricState } = require('./lyric-state');
const { WESING_NATIVE_MONITOR_SOURCE } = require('./wesing-native-monitor-source');

const LOG_TAIL_BYTES = 100 * 1024;
const MAX_QRC_BYTES = 4 * 1024 * 1024;
const MAX_FALLBACK_FILES = 80;
const PAUSED_AFTER_MS = 1500;
const PROGRESS_COMPENSATION_MS = 130;
const QRC_REFRESH_DEBOUNCE_MS = 2000;
const MIN_LYRIC_OFFSET_MS = -1500;
const MAX_LYRIC_OFFSET_MS = 1500;
const SAFE_SONG_MID = /^[a-zA-Z0-9_-]{1,128}$/;

function normalizeWeSingCachePath(input) {
  const value = String(input || '').trim().replace(/^"|"$/g, '');
  if (!value) throw new Error('请选择全民 K 歌的 WeSingCache 目录。');
  if (value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('WeSingCache 路径无效。');
  }
  if (!path.isAbsolute(value) && !path.win32.isAbsolute(value)) {
    throw new Error('WeSingCache 必须使用绝对路径。');
  }
  const resolved = path.resolve(value);
  if (path.basename(resolved).toLowerCase() !== 'wesingcache') {
    throw new Error('请选择名称为 WeSingCache 的目录。');
  }
  return resolved;
}

function normalizeWeSingLyricOffsetMs(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) throw new Error('歌词时间偏移必须是数字。');
  const rounded = Math.round(value);
  if (rounded < MIN_LYRIC_OFFSET_MS || rounded > MAX_LYRIC_OFFSET_MS) {
    throw new Error(`歌词时间偏移必须在 ${MIN_LYRIC_OFFSET_MS} 到 ${MAX_LYRIC_OFFSET_MS} 毫秒之间。`);
  }
  return rounded;
}

async function findLatestSongEntry(cachePath, expectedTitle = '') {
  const basePath = normalizeWeSingCachePath(cachePath);
  const logDir = path.join(basePath, 'Log', 'WeSing');
  let entries;
  try {
    entries = await fs.promises.readdir(logDir, { withFileTypes: true });
  } catch (_) {
    return null;
  }

  const logFiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue;
    const filePath = path.join(logDir, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      logFiles.push({ filePath, modifiedMs: stat.mtimeMs, size: stat.size });
    } catch (_) {}
  }
  logFiles.sort((a, b) => b.modifiedMs - a.modifiedMs);
  if (!logFiles.length) return null;

  const latest = logFiles[0];
  const start = Math.max(0, latest.size - LOG_TAIL_BYTES) & ~1;
  const length = Math.max(0, latest.size - start);
  if (!length) return null;

  const handle = await fs.promises.open(latest.filePath, 'r');
  let buffer;
  try {
    buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, start);
    buffer = buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }

  const wantedTitle = normalizeTitle(expectedTitle);
  const rows = buffer.toString('utf16le').split(/\r?\n/).reverse();
  for (const row of rows) {
    if (!row.includes('"StartKSong"')) continue;
    const midMatch = row.match(/"mid"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    const songMatch = row.match(/"songname"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (!midMatch) continue;
    const mid = decodeJsonString(midMatch[1]);
    const songName = songMatch ? decodeJsonString(songMatch[1]).trim() : '';
    if (!SAFE_SONG_MID.test(mid)) return null;
    if (wantedTitle && normalizeTitle(songName) !== wantedTitle) continue;
    return { mid, songName };
  }
  return null;
}

async function loadWeSingLyrics(options = {}) {
  const cachePath = normalizeWeSingCachePath(options.cachePath);
  const title = stripWeSingWindowTitle(options.title);
  const resDir = path.join(cachePath, 'WeSingDL', 'Res');
  await assertDirectory(resDir, '全民 K 歌歌词缓存目录不存在。');

  const logEntry = await findLatestSongEntry(cachePath, title);
  if (logEntry) {
    const directPath = path.join(resDir, logEntry.mid, `${logEntry.mid}.qrc`);
    const direct = await tryReadQrc(directPath);
    if (direct) return toLyricResult(direct, logEntry.mid, title);
  }

  const candidates = await listRecentQrcFiles(
    resDir,
    Number(options.maxFallbackFiles) || MAX_FALLBACK_FILES
  );
  const wantedTitle = normalizeTitle(title);
  for (const candidate of candidates) {
    const parsed = await tryReadQrc(candidate.filePath);
    if (!parsed) continue;
    const result = toLyricResult(parsed, candidate.songMid, title);
    if (!wantedTitle || normalizeTitle(result.title) === wantedTitle) return result;
  }
  return null;
}

async function listRecentQrcFiles(resDir, maximum) {
  let entries;
  try {
    entries = await fs.promises.readdir(resDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const candidates = [];
  const directories = entries.filter((entry) => entry.isDirectory() && SAFE_SONG_MID.test(entry.name));
  for (let start = 0; start < directories.length; start += 100) {
    const batch = directories.slice(start, start + 100);
    const rows = await Promise.all(batch.map(async (entry) => {
      const filePath = path.join(resDir, entry.name, `${entry.name}.qrc`);
      try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_QRC_BYTES) return null;
        return { filePath, songMid: entry.name, modifiedMs: stat.mtimeMs };
      } catch (_) {
        return null;
      }
    }));
    candidates.push(...rows.filter(Boolean));
  }
  return candidates.sort((a, b) => b.modifiedMs - a.modifiedMs).slice(0, maximum);
}

async function tryReadQrc(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_QRC_BYTES) return null;
    let payload = await fs.promises.readFile(filePath);
    if (payload.subarray(0, 8).toString('ascii') === '[offset:') {
      const lineEnd = payload.subarray(0, 64).indexOf(0x0a);
      if (lineEnd >= 0) payload = payload.subarray(lineEnd + 1);
    }
    if (!payload.length || payload.length % 8 !== 0) return null;
    return parseQrcDocument(decryptQrc(payload.toString('hex')));
  } catch (_) {
    return null;
  }
}

function parseQrcDocument(qrcXml) {
  const xml = String(qrcXml || '');
  const content = extractQrcLyricContent(xml);
  const lines = parseLyricResult('', '', content, '');
  const title = extractMetadata(content, 'ti');
  const artist = extractMetadata(content, 'ar');
  const saveTime = Number((xml.match(/\bSaveTime="(\d+)"/i) || [])[1]);
  const lastLineEnd = lines.reduce((maximum, line) => Math.max(maximum, Number(line.endMs) || 0), 0);
  return {
    title,
    artists: artist ? [artist] : [],
    durationMs: saveTime > 0 ? saveTime * 1000 : lastLineEnd,
    lines
  };
}

function extractQrcLyricContent(value) {
  const text = String(value || '');
  const marker = 'LyricContent="';
  const start = text.indexOf(marker);
  if (start < 0) return decodeXmlEntities(text);
  const contentStart = start + marker.length;
  const end = text.indexOf('"', contentStart);
  return decodeXmlEntities(end >= 0 ? text.slice(contentStart, end) : text.slice(contentStart));
}

function extractMetadata(content, key) {
  const match = String(content || '').match(new RegExp(`\\[${key}:([^\\]]*)\\]`, 'i'));
  return match ? match[1].trim().slice(0, 120) : '';
}

function toLyricResult(parsed, songMid, fallbackTitle) {
  return {
    songMid,
    title: parsed.title || fallbackTitle,
    artists: parsed.artists,
    durationMs: parsed.durationMs,
    lines: parsed.lines
  };
}

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
      pendingRefresh = refresh();
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
  }

  return { getStatus, refresh, setActive, setCachePath, setLyricOffsetMs, stop, waitForRefresh };
}

function createPowerShellWeSingMonitor(onSample, options = {}) {
  const spawn = options.spawn || childProcess.spawn;
  let child = null;
  let stopping = false;
  let pending = '';
  let pendingError = '';

  function start() {
    if (child) return;
    stopping = false;
    const script = buildPowerShellMonitorScript(options);
    const encoded = Buffer.from(script, 'utf8').toString('base64');
    const command = `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | Invoke-Expression`;
    child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      const rows = pending.split(/\r?\n/);
      pending = rows.pop() || '';
      for (const row of rows) {
        if (!row.trim()) continue;
        try { onSample(JSON.parse(row)); } catch (_) {}
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      pendingError = `${pendingError}${chunk}`.slice(-2000);
    });
    child.on('error', (error) => {
      if (!stopping) onSample({ error: error.message || String(error) });
    });
    child.on('exit', (code) => {
      child = null;
      if (!stopping && code !== 0) {
        const detail = pendingError.trim();
        onSample({ error: detail || `监视进程已退出（${code}）` });
      }
      pendingError = '';
    });
  }

  function stop() {
    stopping = true;
    if (child) {
      try { child.kill(); } catch (_) {}
      child = null;
    }
  }

  return { start, stop };
}

function buildPowerShellMonitorScript(options = {}) {
  const includeDiagnostics = options.includeDiagnostics === true ? '$true' : '$false';
  const requestedIntervalMs = Math.round(Number(options.pollIntervalMs));
  const pollIntervalMs = Number.isFinite(requestedIntervalMs)
    ? Math.min(5000, Math.max(100, requestedIntervalMs))
    : 100;
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
Add-Type -AssemblyName Accessibility | Out-Null
$nativeSource = @'
${WESING_NATIVE_MONITOR_SOURCE}
'@
Add-Type -TypeDefinition $nativeSource -ReferencedAssemblies Accessibility | Out-Null
$descendants = [System.Windows.Automation.TreeScope]::Descendants
$diagnosticsEnabled = ${includeDiagnostics}
while ($true) {
  $sample = @{ detected = $false; title = ''; currentSec = -1; totalSec = -1; loading = $false; audioPeak = -1; windowHandle = 0 }
  $processes = @()
  try {
    $processes = @(Get-Process -Name WeSing -ErrorAction SilentlyContinue)
    if ($processes.Count -gt 0) { $sample.detected = $true }
    $processIds = [int[]]@($processes | ForEach-Object { [int]$_.Id })
    if ($diagnosticsEnabled) { $sample.processIds = @($processIds) }
    $audioSnapshot = [WeSingNativeMonitor]::GetAudioSessionSnapshot($processIds)
    if ($audioSnapshot.State -ge 0) {
      $sample.audioActive = $audioSnapshot.State -eq 1
      $sample.audioPeak = [Math]::Round([double]$audioSnapshot.Peak, 6)
    }
    $windowSnapshot = [WeSingNativeMonitor]::FindPlaybackWindow($processIds)
    if ($null -ne $windowSnapshot) {
      $sample.title = $windowSnapshot.Title
      $sample.windowHandle = $windowSnapshot.Handle.ToInt64()
      $accessibleSnapshot = [WeSingNativeMonitor]::GetAccessiblePlaybackSnapshot($windowSnapshot.Handle)
      if ($accessibleSnapshot.CurrentSec -ge 0) {
        $sample.currentSec = $accessibleSnapshot.CurrentSec
        $sample.totalSec = $accessibleSnapshot.TotalSec
        $sample.progressSource = 'msaa'
      }
      if ($accessibleSnapshot.Loading) { $sample.loading = $true }
      try {
        $playWindow = [System.Windows.Automation.AutomationElement]::FromHandle($windowSnapshot.Handle)
        if ($null -ne $playWindow) {
          $textCondition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Text
          )
          $texts = $playWindow.FindAll($descendants, $textCondition)
          foreach ($textElement in $texts) {
            $text = [string]$textElement.Current.Name
            if ($text -match '\u6b4c\u66f2\u52a0\u8f7d\u4e2d') { $sample.loading = $true }
            if ($sample.currentSec -lt 0 -and $text -match '^\s*(\d{1,3}):(\d{2})\s*\|\s*(\d{1,3}):(\d{2})\s*$') {
              $sample.currentSec = ([int]$matches[1] * 60) + [int]$matches[2]
              $sample.totalSec = ([int]$matches[3] * 60) + [int]$matches[4]
              $sample.progressSource = 'uia'
            }
          }
          if ($diagnosticsEnabled) {
            $controlRows = [System.Collections.Generic.List[object]]::new()
            $controls = $playWindow.FindAll(
              $descendants,
              [System.Windows.Automation.Condition]::TrueCondition
            )
            foreach ($control in $controls) {
              if ($controlRows.Count -ge 250) { break }
              try {
                $controlType = [string]$control.Current.ControlType.ProgrammaticName
                if ($controlType -notmatch '(Button|Text|Slider)') { continue }
                $controlName = [string]$control.Current.Name
                $automationId = [string]$control.Current.AutomationId
                if (-not $controlName -and -not $automationId) { continue }
                $controlRows.Add(@{
                  type = $controlType
                  name = $controlName
                  automationId = $automationId
                  enabled = [bool]$control.Current.IsEnabled
                })
              } catch {}
            }
            $sample.controls = @($controlRows)
          }
        }
      } catch {}
    }
  } catch {
    $sample.error = $_.Exception.Message
  } finally {
    foreach ($process in $processes) { $process.Dispose() }
  }
  Write-Output ($sample | ConvertTo-Json -Compress)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${pollIntervalMs}
}
`;
}

async function assertDirectory(directoryPath, message) {
  if (!await isDirectory(directoryPath)) throw new Error(message);
}

async function isDirectory(directoryPath) {
  if (!directoryPath) return false;
  try { return (await fs.promises.stat(directoryPath)).isDirectory(); } catch (_) { return false; }
}

function safeInitialCachePath(value) {
  try { return normalizeWeSingCachePath(value); } catch (_) { return ''; }
}

function safeInitialLyricOffsetMs(value) {
  try { return normalizeWeSingLyricOffsetMs(value); } catch (_) { return 0; }
}

function formatLyricSource(source) {
  if (source === 'qq') return 'QQ 音乐';
  if (source === 'netease') return '网易云音乐';
  return '在线平台';
}

function stripWeSingWindowTitle(value) {
  return String(value || '').replace(/^全民K歌\s*-\s*/, '').trim().slice(0, 120);
}

function normalizeTitle(value) {
  return stripWeSingWindowTitle(value).replace(/\s+/g, '').toLowerCase();
}

function decodeJsonString(value) {
  try { return JSON.parse(`"${value}"`); } catch (_) { return String(value || ''); }
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

module.exports = {
  buildPowerShellMonitorScript,
  createPowerShellWeSingMonitor,
  createWeSingCapture,
  extractQrcLyricContent,
  findLatestSongEntry,
  loadWeSingLyrics,
  normalizeWeSingCachePath,
  normalizeWeSingLyricOffsetMs,
  parseQrcDocument
};
