'use strict';

const { createMusicProviderRegistry } = require('../music/provider-registry');
const { createLyricsService } = require('../music/lyrics-service');
const { normalizeLyricTimeline } = require('../music/lyric-timeline');
const { createWeSingCapture } = require('../music/wesing-capture');
const { createWeSingOnlineLyricResolver } = require('../music/wesing-online-lyrics');

function buildMusicRuntime({ dataDir, runtimeOptions = {}, settingsStore, webSocketHub }) {
  const lyricsService = createLyricsService({
    apiCacheDir: dataDir.apiCacheDir,
    lyricCacheDir: dataDir.lyricCacheDir
  });
  let musicRegistry = createMusicProviderRegistry();
  let lyricState = {
    trackTitle: '', artists: [], lineText: '', translation: '', words: [],
    currentMs: 0, progress: 0, playing: false, locked: false, status: 'idle'
  };
  let lyricTimeline = {
    trackTitle: '', artists: [], status: 'idle', lines: []
  };
  const resolveWeSingOnlineLyrics = createWeSingOnlineLyricResolver({
    getRegistry: () => musicRegistry,
    lyricsService
  });
  const publishLyricTimeline = (input) => {
    lyricTimeline = normalizeLyricTimeline(input);
    webSocketHub.broadcast({ type: 'lyric-timeline', timeline: lyricTimeline });
    return lyricTimeline;
  };
  const weSingCapture = createWeSingCapture({
    cachePath: settingsStore.getSettings().weSingCachePath,
    lyricOffsetMs: settingsStore.getSettings().weSingLyricOffsetMs,
    platform: runtimeOptions.weSingPlatform || process.platform,
    monitorFactory: runtimeOptions.weSingMonitorFactory,
    resolveFallbackLyrics: runtimeOptions.weSingLyricResolver || resolveWeSingOnlineLyrics,
    saveCachePath(cachePath) {
      settingsStore.setSetting('weSingCachePath', cachePath);
    },
    saveLyricOffsetMs(offsetMs) {
      settingsStore.setSetting('weSingLyricOffsetMs', String(offsetMs));
    },
    onState(state) {
      webSocketHub.broadcast({ type: 'wesing-state', state });
      if (!state.active || !state.lyricState) return;
      lyricState = state.lyricState;
      webSocketHub.broadcast({ type: 'lyric-state', state: lyricState });
    },
    onTimeline(timeline) {
      if (timeline.active) publishLyricTimeline(timeline);
    }
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
      lyricState = nextState;
      webSocketHub.broadcast({ type: 'lyric-state', state: nextState });
    },
    publishLyricTimeline
  };
}

module.exports = { buildMusicRuntime };
