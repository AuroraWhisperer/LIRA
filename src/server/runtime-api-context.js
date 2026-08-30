'use strict';

const { createApiContext } = require('./api-context');

function createRuntimeApiContextFactory(options = {}) {
  return function buildCurrentApiContext() {
    const domainServices = options.getDomainServices();
    const musicRuntime = options.getMusicRuntime();
    const bilibiliRuntime = options.getBilibiliRuntime();
    const aiRuntime = options.getAiRuntime();
    const settingsStore = options.getSettingsStore();

    return createApiContext({
      maxBodyBytes: options.maxBodyBytes,
      sessionToken: options.getSessionToken(),
      broadcastSnapshot: options.broadcastSnapshot,
      broadcastGiftEffectPreview: options.broadcastGiftEffectPreview,
      requestCloudSync: options.requestCloudSync,
      domainServices,
      messageBuffer: options.getMessageBuffer(),
      publishLyricState: musicRuntime.publishLyricState,
      publishLyricTimeline: musicRuntime.publishLyricTimeline,
      weSingCapture: musicRuntime.weSingCapture,
      bilibili: {
        liveStatus: options.getLiveStatus(),
        configure: bilibiliRuntime.configure,
        reconnect: bilibiliRuntime.reconnect,
        updateStatus: bilibiliRuntime.updateStatus,
        auth: bilibiliRuntime.getAuthProvider(),
        danmakuSender: options.getDanmakuSender(),
        fetchAvatarImage: bilibiliRuntime.fetchAvatarImage,
      },
      ai: { configStore: aiRuntime.configStore, service: aiRuntime.service },
      games: {
        service: options.getGameSessionService(),
        listOnlineViewers: bilibiliRuntime.getViewerCandidates,
        refreshViewers: bilibiliRuntime.refreshViewerCandidates,
        getWinnerProfile: bilibiliRuntime.getGameWinnerProfile,
      },
      wheel: { service: options.getWheelSessionService() },
      settings: { defaults: options.defaultSettings, store: settingsStore },
      system: {
        ...options.systemPaths,
        liveStatus: options.getLiveStatus(),
        getState: options.getState,
        shutdown: options.shutdown,
      },
      music: {
        registry: musicRuntime.getMusicRegistry(),
        lyrics: musicRuntime.lyricsService,
        apiCacheDir: options.musicApiCacheDir,
        lyricCacheDir: options.musicLyricCacheDir,
      },
    });
  };
}

module.exports = { createRuntimeApiContextFactory };
