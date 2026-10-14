'use strict';

const { createQQClientMonitor } = require('./qq-client-monitor');
const { findCurrentLyricLine } = require('./lyric-parser');

function createQQClientCapture({
  platform = process.platform,
  monitorFactory = createQQClientMonitor,
  resolveLyrics,
  onState = () => {},
  onTimeline = () => {},
  now = Date.now,
} = {}) {
  const initial = {
    active: false, supported: platform === 'win32', detected: false, status: 'inactive',
    message: '未启用外部 QQ 音乐', trackTitle: '', artists: [], currentMs: 0, durationMs: 0,
    playing: false, lyricSource: '',
  };
  let state = { ...initial };
  let monitor = null;
  let lifecycle = 0;
  let trackVersion = 0;
  let trackKey = '';
  let lastTimelineStamp = 0;
  let lastTimeline = null;
  let previousTrackStamp = 0;
  let previousTrackTimeline = null;
  let stableTrack = false;
  let lyrics = null;
  let resolving = false;
  let resolved = false;
  let clockReady = false;
  let lyricError = false;
  let missingSince = null;
  let timeline = { trackTitle: '', artists: [], status: 'idle', lines: [] };

  function getStatus() {
    return { ...state, artists: [...state.artists] };
  }

  function getTimeline() {
    return structuredClone(timeline);
  }

  function getLyricState() {
    const line = state.status === 'ready' && lyrics ? findCurrentLyricLine(lyrics.lines, state.currentMs) : null;
    return {
      trackTitle: state.trackTitle, artists: [...state.artists], currentMs: state.currentMs,
      durationMs: state.durationMs, progress: state.durationMs > 0 ? state.currentMs / state.durationMs : 0,
      playing: state.playing && state.status === 'ready',
      status: state.status === 'ready' || state.status === 'empty' ? state.status
        : state.status === 'loading' ? 'loading' : 'idle',
      lineText: line?.text || '', translation: line?.translation || '', words: structuredClone(line?.words || []),
    };
  }

  function emit() {
    onState(getStatus(), getLyricState());
  }

  function publishTimeline(status, lines = []) {
    timeline = { trackTitle: state.trackTitle, artists: [...state.artists], status, lines };
    onTimeline(getTimeline());
  }

  function clearLyrics(status = 'idle') {
    lyrics = null;
    publishTimeline(status);
  }

  function resetTrack(preserveTimeline = false) {
    trackVersion += 1;
    trackKey = '';
    stableTrack = false;
    resolving = false;
    resolved = false;
    if (!preserveTimeline) {
      lastTimelineStamp = 0;
      lastTimeline = null;
    }
    previousTrackStamp = 0;
    previousTrackTimeline = null;
    lyrics = null;
    clockReady = false;
    lyricError = false;
    missingSince = null;
  }

  function applyResolvedLyrics() {
    if (!clockReady || !resolved) return;
    const status = lyricError ? 'error' : lyrics ? 'ready' : 'empty';
    const changed = state.status !== status;
    state.status = status;
    state.message = lyricError ? 'QQ 歌词获取失败，请重新检测' : lyrics
      ? (state.playing ? '正在跟随 QQ 音乐' : 'QQ 音乐已暂停') : '未匹配到当前曲目的歌词';
    if (changed) publishTimeline(lyricError ? 'idle' : status, lyrics?.lines || []);
  }

  async function loadLyrics() {
    if (resolving || resolved) return;
    resolving = true;
    const version = trackVersion;
    try {
      const result = await resolveLyrics({ title: state.trackTitle, artists: state.artists, durationMs: state.durationMs });
      if (!state.active || version !== trackVersion) return;
      resolved = true;
      lyrics = result?.lines?.length ? result : null;
      state.lyricSource = lyrics?.source || '';
      applyResolvedLyrics();
      emit();
    } catch (_) {
      if (!state.active || version !== trackVersion) return;
      resolved = true;
      lyricError = true;
      applyResolvedLyrics();
      emit();
    } finally {
      if (version === trackVersion) resolving = false;
    }
  }

  function acceptSample(sample) {
    if (!state.active) return;
    if (!sample.error && !sample.detected && clockReady) {
      missingSince ??= now();
      if (now() - missingSince < 1500) return;
    } else {
      missingSince = null;
    }
    if (sample.error || !sample.detected || ['Stopped', 'Closed'].includes(sample.playbackStatus)) {
      const hadTrack = Boolean(trackKey);
      resetTrack(sample.detected === true && !sample.error);
      state = { ...initial, active: true, detected: sample.detected === true,
        status: sample.error ? 'error' : 'waiting',
        message: sample.error ? '无法读取 QQ 音乐播放状态，请重新检测' : '请打开 QQ 音乐客户端并播放歌曲',
      };
      if (hadTrack || sample.error) clearLyrics();
      emit();
      return;
    }

    const title = String(sample.title || '').trim().slice(0, 120);
    const artist = String(sample.artist || '').trim().slice(0, 80);
    const key = JSON.stringify([sample.appId, title, artist]);
    const stamp = sample.timelineUpdatedAt;
    const changed = key !== trackKey;
    if (changed) {
      // QQ can publish a new title with one final clock update from the old song.
      previousTrackStamp = lastTimelineStamp > 0 && Number.isFinite(stamp)
        ? Math.max(lastTimelineStamp, stamp) : lastTimelineStamp;
      previousTrackTimeline = lastTimeline;
      trackVersion += 1;
      trackKey = key;
      stableTrack = false;
      resolving = false;
      resolved = false;
      lyricError = false;
      state.trackTitle = title;
      state.artists = artist ? [artist] : [];
      state.lyricSource = '';
      state.status = 'loading';
      clearLyrics('loading');
    } else {
      stableTrack = true;
    }
    state.detected = true;
    const position = sample.positionMs;
    const duration = sample.durationMs;
    const playing = sample.playbackStatus === 'Playing';
    state.playing = playing;
    // A fresh song may publish its only anchor together with the title. A changed
    // duration or reset position distinguishes that anchor from the old clock.
    const newTrackClock = previousTrackTimeline && stamp >= previousTrackTimeline.stamp &&
      (duration !== previousTrackTimeline.duration || position + 1000 < previousTrackTimeline.position);
    const usable = title && stableTrack && ['Playing', 'Paused'].includes(sample.playbackStatus) &&
      Number.isFinite(position) && position >= 0 && Number.isFinite(duration) && duration > 0 && position <= duration &&
      Number.isFinite(stamp) && stamp > 0 && stamp >= lastTimelineStamp &&
      (stamp > previousTrackStamp || newTrackClock);
    if (!usable) {
      clockReady = false;
      if (timeline.status !== 'loading') publishTimeline('loading');
      state.status = 'loading';
      state.message = '正在等待 QQ 当前曲目的有效进度';
      state.currentMs = 0;
      state.durationMs = 0;
      emit();
      return;
    }
    lastTimelineStamp = stamp;
    lastTimeline = { stamp, position, duration };
    previousTrackStamp = 0;
    previousTrackTimeline = null;
    clockReady = true;
    // SMTC Position is current as of LastUpdatedTime, not as of this poll.
    const rate = Number.isFinite(sample.playbackRate) && sample.playbackRate > 0 ? sample.playbackRate : 1;
    const elapsed = playing ? Math.max(0, now() - stamp) * rate : 0;
    state.currentMs = Math.round(Math.min(duration, position + elapsed));
    state.durationMs = Math.round(duration);
    if (resolved) {
      applyResolvedLyrics();
    } else {
      state.status = 'loading';
      state.message = '正在匹配 QQ 歌词';
      void loadLyrics();
    }
    emit();
  }

  function setActive(active) {
    if (active && !state.supported) throw new Error('外部 QQ 音乐采集仅支持 Windows');
    if (state.active === active) return getStatus();
    lifecycle += 1;
    monitor?.stop();
    monitor = null;
    resetTrack();
    state = { ...initial, active, status: active ? 'waiting' : 'inactive',
      message: active ? '请打开 QQ 音乐客户端并播放歌曲' : initial.message };
    clearLyrics();
    emit();
    if (active) {
      const version = lifecycle;
      monitor = monitorFactory((sample) => {
        if (version === lifecycle) acceptSample(sample);
      });
      monitor.start();
    }
    return getStatus();
  }

  function refresh() {
    if (state.active) {
      setActive(false);
      setActive(true);
    }
    return getStatus();
  }

  return { getStatus, getTimeline, getLyricState, setActive, refresh, stop: () => setActive(false) };
}

module.exports = { createQQClientCapture };
