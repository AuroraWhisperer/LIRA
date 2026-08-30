'use strict';

const { createMusicProviderRegistry } = require('../music/provider-registry');
const { createLyricsService } = require('../music/lyrics-service');
const { normalizeLyricTimeline } = require('../music/lyric-timeline');
const { normalizeLyricState } = require('../music/lyric-state');
const { createWeSingCapture } = require('../music/wesing-capture');
const {
  createWeSingOnlineLyricResolver,
} = require('../music/wesing-online-lyrics');

function buildMusicRuntime({
  dataDir,
  runtimeOptions = {},
  settingsStore,
  webSocketHub,
}) {
  const lyricsService = createLyricsService({
    apiCacheDir: dataDir.apiCacheDir,
    lyricCacheDir: dataDir.lyricCacheDir,
  });
  let musicRegistry = createMusicProviderRegistry();
  let lyricState = {
    trackTitle: '',
    artists: [],
    lineText: '',
    translation: '',
    words: [],
    currentMs: 0,
    progress: 0,
    playing: false,
    locked: false,
    generation: 0,
    sequence: 0,
    status: 'idle',
  };
  let lyricTimeline = {
    trackTitle: '',
    artists: [],
    status: 'idle',
    lines: [],
  };
  let lyricGeneration = 0;
  let lyricSequence = 0;
  let lyricTimelineKey = JSON.stringify(lyricTimeline);

  function versionLyricState(input) {
    const state = normalizeLyricState(input);
    const incomingGeneration = state.generation;
    const incomingSequence = state.sequence;
    const hasClientVersion = incomingGeneration > 0 || incomingSequence > 0;
    if (hasClientVersion) {
      if (
        incomingGeneration < lyricGeneration ||
        (incomingGeneration === lyricGeneration &&
          incomingSequence <= lyricSequence)
      ) {
        return null;
      }
      lyricGeneration = incomingGeneration;
      lyricSequence = incomingSequence;
    } else {
      lyricSequence += 1;
    }
    return { ...state, generation: lyricGeneration, sequence: lyricSequence };
  }
  const resolveWeSingOnlineLyrics = createWeSingOnlineLyricResolver({
    getRegistry: () => musicRegistry,
    lyricsService,
    getPreferences() {
      const settings = settingsStore.getSettings();
      return {
        preferredPlatform: settings.weSingLyricSource,
        smartMatch: settings.weSingSmartLyricMatch,
      };
    },
  });
  const publishLyricTimeline = (input) => {
    const nextTimeline = normalizeLyricTimeline(input);
    const nextKey = JSON.stringify(nextTimeline);
    if (nextKey !== lyricTimelineKey) {
      lyricGeneration += 1;
      lyricSequence = 0;
      lyricTimelineKey = nextKey;
    }
    lyricTimeline = nextTimeline;
    webSocketHub.broadcast({ type: 'lyric-timeline', timeline: lyricTimeline });
    return lyricTimeline;
  };
  const weSingCapture = createWeSingCapture({
    cachePath: settingsStore.getSettings().weSingCachePath,
    lyricOffsetMs: settingsStore.getSettings().weSingLyricOffsetMs,
    platform: runtimeOptions.weSingPlatform || process.platform,
    monitorFactory: runtimeOptions.weSingMonitorFactory,
    resolveFallbackLyrics:
      runtimeOptions.weSingLyricResolver || resolveWeSingOnlineLyrics,
    saveCachePath(cachePath) {
      settingsStore.setSetting('weSingCachePath', cachePath);
    },
    saveLyricOffsetMs(offsetMs) {
      settingsStore.setSetting('weSingLyricOffsetMs', String(offsetMs));
    },
    onState(state) {
      webSocketHub.broadcast({ type: 'wesing-state', state });
      if (!state.active || !state.lyricState) return;
      const nextState = versionLyricState(state.lyricState);
      if (!nextState) return;
      lyricState = nextState;
      webSocketHub.broadcast({ type: 'lyric-state', state: lyricState });
    },
    onTimeline(timeline) {
      if (timeline.active) publishLyricTimeline(timeline);
    },
  });

  return {
    lyricsService,
    weSingCapture,
    getMusicRegistry: () => musicRegistry,
    setMusicRegistry(options = {}) {
      musicRegistry = createMusicProviderRegistry(options);
    },
    getLyricState: () => lyricState,
    getLyricTimeline: () => lyricTimeline,
    publishLyricState(nextState) {
      const versionedState = versionLyricState(nextState);
      if (!versionedState) return lyricState;
      lyricState = versionedState;
      webSocketHub.broadcast({ type: 'lyric-state', state: versionedState });
      return lyricState;
    },
    publishLyricTimeline,
  };
}

module.exports = { buildMusicRuntime };
