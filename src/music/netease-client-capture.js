'use strict';

const { isDeepStrictEqual } = require('node:util');

const { createNeteaseClientMonitor } = require('./netease-client-monitor');
const { findCurrentLyricLine } = require('./lyric-parser');
const { recordingDurationChanged } = require('./external-client-lyrics');
const { hasTrackClockReset, readSmtcClock, smtcPositionAt } = require('./smtc-clock');

function createNeteaseClientCapture({
  platform = process.platform,
  monitorFactory = createNeteaseClientMonitor,
  resolveLyrics,
  onState = () => {},
  onTimeline = () => {},
  now = Date.now,
} = {}) {
  const initial = {
    active: false, supported: platform === 'win32', detected: false, status: 'inactive',
    message: '未启用外部网易云音乐', trackTitle: '', artists: [], currentMs: 0, durationMs: 0,
    playing: false, playbackRate: 1, lyricSource: '', coverUrl: '',
  };
  let state = { ...initial };
  let monitor = null;
  let lifecycle = 0;
  let trackVersion = 0;
  let trackKey = '';
  let sourceTrackId = '';
  let stableTrack = false;
  let trackChangedAt = 0;
  let previousStamp = 0;
  let lastStamp = 0;
  let lastTimeline = null;
  let previousTimeline = null;
  let observedPosition = null;
  let positionChangedAt = 0;
  let inferredPlayingAt = 0;
  let advancingSamples = 0;
  let lyrics = null;
  let lyricDurationMs = 0;
  let lastEmitted, lastLyrics;
  let resolved = false;
  let resolving = false;
  let lyricError = false;
  let clockReady = false;

  function getStatus() { return { ...state, artists: [...state.artists] }; }

  function getLyricState() {
    const line = state.status === 'ready' && lyrics ? findCurrentLyricLine(lyrics.lines, state.currentMs) : null;
    return structuredClone({
      trackTitle: state.trackTitle, artists: state.artists, currentMs: state.currentMs,
      durationMs: state.durationMs, progress: state.durationMs > 0 ? state.currentMs / state.durationMs : 0,
      playing: state.playing && state.status === 'ready', playbackRate: state.playbackRate, status: lyricStatus(),
      lineText: line?.text || '', translation: line?.translation || '', words: line?.words || [],
    });
  }

  function getTimeline() {
    return structuredClone({ trackTitle: state.trackTitle, artists: state.artists,
      status: lyricStatus(), lines: state.status === 'ready' ? lyrics?.lines || [] : [] });
  }

  function lyricStatus() { return ['ready', 'empty', 'loading'].includes(state.status) ? state.status : 'idle'; }
  function emit() {
    if (lastLyrics === lyrics && isDeepStrictEqual(lastEmitted, state)) return;
    lastEmitted = { ...state };
    lastLyrics = lyrics;
    onState(getStatus(), getLyricState());
  }

  function resetLyrics() {
    trackVersion += 1;
    lyrics = null;
    lyricDurationMs = 0;
    resolved = resolving = lyricError = false;
    state.lyricSource = '';
    state.coverUrl = '';
  }

  function resetTrack() {
    resetLyrics();
    trackKey = sourceTrackId = '';
    stableTrack = clockReady = false;
    observedPosition = null;
    advancingSamples = 0;
    lastTimeline = previousTimeline = null;
    trackChangedAt = lastStamp = previousStamp = positionChangedAt = inferredPlayingAt = 0;
  }

  function applyLyrics() {
    if (!clockReady || !resolved) return;
    const status = lyricError ? 'error' : lyrics ? 'ready' : 'empty';
    const changed = state.status !== status;
    state.status = status;
    state.message = lyricError ? '网易云歌词获取失败，请重新检测' : lyrics
      ? (state.playing ? '正在跟随网易云音乐' : '网易云音乐已暂停') : '网易云未提供当前曲目的歌词';
    if (changed) onTimeline(getTimeline());
  }

  async function loadLyrics() {
    if (resolving || resolved) return;
    resolving = true;
    lyricDurationMs = state.durationMs;
    const version = trackVersion;
    try {
      const result = await resolveLyrics({ title: state.trackTitle, artists: [...state.artists],
        durationMs: state.durationMs, sourceTrackId });
      if (!state.active || version !== trackVersion) return;
      resolved = true;
      lyrics = result?.lines?.length ? result : null;
      state.coverUrl = result?.coverUrl || '';
      state.lyricSource = lyrics?.source || '';
      applyLyrics();
      emit();
    } catch (_) {
      if (!state.active || version !== trackVersion) return;
      resolved = lyricError = true;
      applyLyrics();
      emit();
    } finally {
      if (version === trackVersion) resolving = false;
    }
  }

  function acceptSample(sample) {
    if (!state.active) return;
    if (!sample || sample.error || !sample.detected || ['Stopped', 'Closed'].includes(sample.playbackStatus)) {
      const clearTimeline = Boolean(trackKey) || (sample?.error && state.status !== 'error');
      const stoppedStamp = sample?.detected && !sample.error ? lastStamp : 0;
      const stoppedTimeline = stoppedStamp ? lastTimeline : null;
      resetTrack();
      lastStamp = stoppedStamp;
      lastTimeline = stoppedTimeline;
      state = { ...initial, active: true, detected: sample?.detected === true,
        status: sample?.error ? 'error' : 'waiting', message: sample?.error
          ? '无法读取网易云播放状态，正在重新检测' : '请打开网易云音乐客户端并播放歌曲' };
      if (clearTimeline) onTimeline(getTimeline());
      emit();
      return;
    }
    const time = now();
    const title = String(sample.title || '').trim().slice(0, 120);
    const artists = (Array.isArray(sample.artists) ? sample.artists : [sample.artist])
      .map((artist) => String(artist || '').trim().slice(0, 80)).filter(Boolean).slice(0, 8);
    const key = JSON.stringify([title, artists]);
    const id = /^\d{1,32}$/.test(String(sample.sourceTrackId || '')) ? String(sample.sourceTrackId) : '';
    const { positionMs: position, durationMs: duration, timelineUpdatedAt: stamp } = sample;
    const isUIA = sample.clockSource === 'uia';
    const isSampledClock = isUIA || sample.clockSource === 'native';
    const clockSource = isSampledClock ? sample.clockSource : 'smtc';
    const sameClock = lastTimeline?.clockSource === clockSource;
    const validClock = Number.isFinite(position) && position >= 0 && Number.isFinite(duration) && duration > 0 &&
      position <= duration && Number.isFinite(stamp) && stamp > 0 && stamp <= time + 2000;
    const orderedStamp = !sameClock || stamp >= lastStamp;
    const withinSampleWindow = !isSampledClock || time - stamp <= 2500;
    const changedRecording = !id && validClock && orderedStamp && withinSampleWindow &&
      recordingDurationChanged(lyricDurationMs, duration);
    const changedId = id && sourceTrackId && id !== sourceTrackId;
    if (key !== trackKey || changedId || changedRecording) {
      const hadTrack = Boolean(trackKey || lastStamp);
      previousStamp = hadTrack ? Math.max(lastStamp, Number(sample.timelineUpdatedAt) || 0) : 0;
      previousTimeline = lastTimeline;
      trackChangedAt = hadTrack ? time : 0;
      resetLyrics();
      if (changedRecording) lyricDurationMs = duration;
      trackKey = key;
      sourceTrackId = id;
      stableTrack = false;
      observedPosition = null;
      advancingSamples = 0;
      positionChangedAt = inferredPlayingAt = 0;
      state.trackTitle = title;
      state.artists = artists;
      state.status = 'loading';
      onTimeline(getTimeline());
    } else {
      stableTrack = true;
      if (id && !sourceTrackId) {
        sourceTrackId = id;
        resetLyrics();
        state.status = 'loading';
        onTimeline(getTimeline());
      }
    }
    state.detected = true;
    const previousPlaying = state.playing;
    const previousClockReady = clockReady;
    if (isSampledClock && validClock && (position !== observedPosition || (sample.playbackStatus === 'Playing' && !previousPlaying))) {
      const delta = position - observedPosition;
      const elapsed = time - positionChangedAt;
      advancingSamples = observedPosition !== null && delta > 0 && delta <= 2000 && elapsed >= 250 && elapsed <= 2500
        ? advancingSamples + 1 : 0;
      inferredPlayingAt = advancingSamples >= 2 ? time : 0;
      observedPosition = position;
      positionChangedAt = time;
    }
    if (sample.playbackStatus === 'Paused') { advancingSamples = 0; inferredPlayingAt = 0; }
    const inferredPlaying = isUIA && sample.playbackStatus === 'Unknown' && inferredPlayingAt > 0 && time - inferredPlayingAt <= 2000;
    const playing = sample.playbackStatus === 'Playing' || inferredPlaying;
    state.playing = playing;
    const knownPlayback = playing || sample.playbackStatus === 'Paused';
    // A new SMTC song can publish its only anchor together with the title.
    // Require a reset position or different duration before reusing that anchor.
    const newTrackClock = previousTimeline &&
      (previousTimeline.clockSource !== clockSource || stamp >= previousTimeline.stamp) &&
      hasTrackClockReset(previousTimeline, sample);
    const freshClock = isSampledClock
      ? withinSampleWindow && (!trackChangedAt || time - trackChangedAt >= 1500) && (!playing || time - positionChangedAt <= 2500)
      : orderedStamp && (stamp > previousStamp || newTrackClock);
    clockReady = Boolean(title && stableTrack && validClock && knownPlayback && freshClock);
    if (!clockReady) {
      const wasReady = state.status === 'ready';
      state.status = 'loading';
      state.message = '正在读取网易云当前曲目的播放进度，请稍候或重新检测';
      state.currentMs = state.durationMs = 0;
      if (wasReady) onTimeline(getTimeline());
      emit();
      return;
    }
    if (isSampledClock) {
      const elapsed = playing ? Math.max(0, time - (isUIA ? positionChangedAt : stamp)) : 0;
      const predicted = state.currentMs + Math.max(0, time - (lastTimeline?.receivedAt ?? time));
      // UIA exposes a whole-second interval; a later observation is not a backward seek.
      const continuousUIA = isUIA && playing && previousPlaying && previousClockReady && sameClock
        && position >= lastTimeline.position && predicted >= position && predicted < position + 1000;
      state.currentMs = Math.round(Math.min(duration, continuousUIA ? predicted : position + elapsed));
      state.playbackRate = 1;
      lastTimeline = { stamp, position, duration, clockSource, receivedAt: time };
    } else {
      lastTimeline = readSmtcClock(sample, time, previousTimeline ? null : lastTimeline);
      state.playbackRate = lastTimeline.rate;
      state.currentMs = Math.round(smtcPositionAt(lastTimeline, time));
    }
    lastStamp = stamp;
    previousStamp = 0;
    previousTimeline = null;
    state.durationMs = Math.round(duration);
    if (resolved) applyLyrics();
    else {
      state.status = 'loading';
      state.message = '正在获取网易云歌词';
      void loadLyrics();
    }
    emit();
  }

  function setActive(active) {
    if (active && !state.supported) throw new Error('外部网易云音乐采集仅支持 Windows');
    if (state.active === active) return getStatus();
    lifecycle += 1;
    monitor?.stop();
    monitor = null;
    resetTrack();
    state = { ...initial, active, status: active ? 'waiting' : 'inactive',
      message: active ? '请打开网易云音乐客户端并播放歌曲' : initial.message };
    onTimeline(getTimeline());
    emit();
    if (active) {
      const version = lifecycle;
      monitor = monitorFactory((sample) => { if (version === lifecycle) acceptSample(sample); });
      monitor.start();
    }
    return getStatus();
  }

  function refresh() {
    if (state.active) { setActive(false); setActive(true); }
    return getStatus();
  }

  return { getStatus, getLyricState, getTimeline, setActive, refresh, stop: () => setActive(false) };
}

module.exports = { createNeteaseClientCapture };
