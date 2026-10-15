'use strict';

const { createMusicProviderRegistry } = require('../music/provider-registry');
const { createLyricsService } = require('../music/lyrics-service');
const { normalizeLyricTimeline } = require('../music/lyric-timeline');
const { normalizeLyricState } = require('../music/lyric-state');
const { createWeSingCapture } = require('../music/wesing-capture');
const { createWeSingOnlineLyricResolver } = require('../music/wesing-online-lyrics');
const { createExternalClientLyricResolver } = require('../music/external-client-lyrics');
const { createQQClientCapture } = require('../music/qq-client-capture');
const { createNeteaseClientCapture } = require('../music/netease-client-capture');
const { LYRIC_SOURCES, chooseLyricSource } = require('../music/lyric-source-selection');

function buildMusicRuntime({ dataDir, runtimeOptions = {}, settingsStore, webSocketHub, onLyricsChanged }) {
  const lyricsService = createLyricsService({
    apiCacheDir: dataDir.apiCacheDir, lyricCacheDir: dataDir.lyricCacheDir,
  });
  let musicRegistry = createMusicProviderRegistry();
  let lyricState = normalizeLyricState({});
  let lyricTimeline = normalizeLyricTimeline({});
  let lastCheckedTimeline = lyricTimeline;
  let lyricGeneration = 0;
  let lyricSequence = 0;
  let internalGeneration = 0;
  let internalSequence = 0;
  let lyricSource = 'internal';
  let selection = 'auto';
  let started = false;
  let stopped = false;
  let sourceSnapshot = '';
  const candidates = Object.fromEntries(LYRIC_SOURCES.map((source) => [source, {
    playing: false, available: false, state: normalizeLyricState({}), timeline: normalizeLyricTimeline({}),
  }]));

  function publishCurrentState() {
    if (lyricSource === 'internal' && internalGeneration > lyricGeneration) {
      lyricGeneration = internalGeneration;
      lyricSequence = 0;
    }
    lyricState = { ...candidates[lyricSource].state, generation: lyricGeneration, sequence: ++lyricSequence };
    webSocketHub.broadcast({ type: 'lyric-state', state: lyricState });
  }

  function publishCurrentTimeline(force = false) {
    const timeline = candidates[lyricSource].timeline;
    if (!force && timeline === lastCheckedTimeline) return false;
    lastCheckedTimeline = timeline;
    if (!force && JSON.stringify(timeline) === JSON.stringify(lyricTimeline)) return false;
    lyricGeneration++;
    lyricSequence = 0;
    lyricTimeline = timeline;
    webSocketHub.broadcast({ type: 'lyric-timeline', timeline });
    return true;
  }

  function updateSource(changedSource, stateChanged = false) {
    if (stopped) return;
    const next = chooseLyricSource(selection, lyricSource, candidates);
    const switched = next !== lyricSource;
    lyricSource = next;
    if (switched || changedSource === lyricSource) {
      const timelineChanged = publishCurrentTimeline(switched);
      if (switched || stateChanged) publishCurrentState();
      if (timelineChanged || switched || stateChanged) onLyricsChanged?.();
    }
    broadcastLyricSource();
  }

  function acceptExternalState(source, status, input) {
    if (stopped) return;
    const candidate = candidates[source];
    candidate.state = normalizeLyricState(input);
    candidate.playing = status.active && status.playing === true;
    candidate.available = status.active && (status.detected === true || status.platformDetected === true) && Boolean(status.trackTitle);
    updateSource(source, true);
  }

  function acceptExternalTimeline(source, timeline) {
    if (stopped) return;
    candidates[source].timeline = normalizeLyricTimeline(timeline);
    updateSource(source);
  }

  const weSingCapture = createWeSingCapture({
    cachePath: settingsStore.getSettings().weSingCachePath,
    lyricOffsetMs: settingsStore.getSettings().weSingLyricOffsetMs,
    platform: runtimeOptions.weSingPlatform || process.platform,
    monitorFactory: runtimeOptions.weSingMonitorFactory,
    resolveFallbackLyrics: runtimeOptions.weSingLyricResolver || createWeSingOnlineLyricResolver({
      getRegistry: () => musicRegistry, lyricsService,
      getPreferences() {
        const settings = settingsStore.getSettings();
        return { preferredPlatform: settings.weSingLyricSource, smartMatch: settings.weSingSmartLyricMatch };
      },
    }),
    saveCachePath: (cachePath) => settingsStore.setSetting('weSingCachePath', cachePath),
    saveLyricOffsetMs: (offsetMs) => settingsStore.setSetting('weSingLyricOffsetMs', String(offsetMs)),
    onState(state) {
      if (stopped) return;
      webSocketHub.broadcast({ type: 'wesing-state', state });
      acceptExternalState('wesing', state, state.lyricState);
    },
    onTimeline: (timeline) => acceptExternalTimeline('wesing', timeline),
  });
  const qqClientCapture = createQQClientCapture({
    platform: runtimeOptions.qqClientPlatform || process.platform,
    monitorFactory: runtimeOptions.qqClientMonitorFactory,
    resolveLyrics: runtimeOptions.qqClientLyricResolver || createExternalClientLyricResolver({
      platform: 'qq', getRegistry: () => musicRegistry, lyricsService,
    }),
    onState: (status, state) => acceptExternalState('qq-client', status, state),
    onTimeline: (timeline) => acceptExternalTimeline('qq-client', timeline),
  });
  const neteaseClientCapture = createNeteaseClientCapture({
    platform: runtimeOptions.neteaseClientPlatform || process.platform,
    monitorFactory: runtimeOptions.neteaseClientMonitorFactory,
    resolveLyrics: runtimeOptions.neteaseClientLyricResolver || createExternalClientLyricResolver({
      platform: 'netease', getRegistry: () => musicRegistry, lyricsService,
    }),
    onState: (status, state) => acceptExternalState('netease-client', status, state),
    onTimeline: (timeline) => acceptExternalTimeline('netease-client', timeline),
  });
  const captures = { 'qq-client': qqClientCapture, 'netease-client': neteaseClientCapture, wesing: weSingCapture };

  function getLyricSource() {
    return { source: lyricSource, selection,
      playingSources: LYRIC_SOURCES.filter((source) => candidates[source].playing),
      qqClient: qqClientCapture.getStatus(), neteaseClient: neteaseClientCapture.getStatus(), weSing: weSingCapture.getStatus() };
  }

  function broadcastLyricSource() {
    const state = getLyricSource();
    const key = JSON.stringify(state);
    if (key === sourceSnapshot) return;
    sourceSnapshot = key;
    webSocketHub.broadcast({ type: 'lyric-source', state });
  }

  async function start() {
    if (started) return;
    started = true;
    stopped = false;
    await Promise.all(Object.values(captures).filter((capture) => capture.getStatus().supported)
      .map((capture) => capture.setActive(true)));
  }

  async function selectLyricSource(source) {
    if (source !== 'auto' && !LYRIC_SOURCES.includes(source)) throw new Error('歌词来源无效。');
    if (captures[source]?.getStatus().supported === false) throw new Error('外部播放器采集仅支持 Windows。');
    selection = source;
    updateSource();
    return getLyricSource();
  }

  return {
    lyricsService,
    start,
    weSingCapture: {
      ...weSingCapture,
      async setActive(active) {
        if (active) {
          if (!weSingCapture.getStatus().active) await weSingCapture.setActive(true);
          await selectLyricSource('wesing');
        } else if (selection === 'wesing') {
          await selectLyricSource('auto');
        }
        return weSingCapture.getStatus();
      },
    },
    getLyricSource,
    selectLyricSource,
    async refreshLyricSource(source) {
      if (source !== undefined && !captures[source]) throw new Error('外部播放器来源无效。');
      const targets = source ? [captures[source]] : captures[lyricSource] ? [captures[lyricSource]] : Object.values(captures);
      await Promise.all(targets.filter((capture) => capture.getStatus().supported).map((capture) => capture.refresh()));
      return getLyricSource();
    },
    stop() {
      stopped = true;
      started = false;
      for (const capture of Object.values(captures)) capture.stop();
    },
    getMusicRegistry: () => musicRegistry,
    setMusicRegistry(options = {}) {
      musicRegistry = createMusicProviderRegistry(options);
    },
    getLyricState: () => lyricState,
    getLyricTimeline: () => lyricTimeline,
    publishLyricState(input) {
      const state = normalizeLyricState(input);
      if (state.generation > 0 || state.sequence > 0) {
        if (state.generation < internalGeneration ||
            (state.generation === internalGeneration && state.sequence <= internalSequence)) {
          return { ...candidates.internal.state, nextGeneration: Math.max(internalGeneration, lyricGeneration) + 1 };
        }
        internalGeneration = state.generation;
        internalSequence = state.sequence;
      } else {
        internalSequence++;
      }
      candidates.internal.state = { ...state, generation: internalGeneration, sequence: internalSequence };
      candidates.internal.playing = state.playing;
      candidates.internal.available = Boolean(state.trackTitle);
      updateSource('internal', true);
      return candidates.internal.state;
    },
    publishLyricTimeline(input) {
      const timeline = normalizeLyricTimeline(input);
      const changed = JSON.stringify(timeline) !== JSON.stringify(candidates.internal.timeline);
      if (changed) {
        internalGeneration = Math.max(internalGeneration, lyricGeneration) + 1;
        internalSequence = 0;
        // Keep the last measured playback intent, but never pair new lyrics with
        // the previous track's text or clock while the matching state is in flight.
        candidates.internal.state = normalizeLyricState({ trackTitle: timeline.trackTitle, artists: timeline.artists,
          status: timeline.trackTitle ? 'loading' : 'idle', generation: internalGeneration });
        candidates.internal.available = Boolean(timeline.trackTitle);
        if (!timeline.trackTitle) candidates.internal.playing = false;
      }
      candidates.internal.timeline = timeline;
      updateSource('internal', changed);
      return timeline;
    },
  };
}

module.exports = { buildMusicRuntime };
