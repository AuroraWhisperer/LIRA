'use strict';

const { createApiContext } = require('./api-context');
const { createHardwareSummaryService } = require('./hardware-summary');
const { createGameAudience } = require('./game-runtime');

function createRuntimeApiContextFactory(options = {}) {
  const hardware = createHardwareSummaryService();
  return function buildCurrentApiContext() {
    const domainServices = options.getDomainServices();
    const musicRuntime = options.getMusicRuntime();
    const bilibiliRuntime = options.getBilibiliRuntime();
    const aiRuntime = options.getAiRuntime();
    const settingsStore = options.getSettingsStore();
    const gameService = options.getGameSessionService();

    return createApiContext({
      worldClock: options.getWorldClock?.(),
      giftCards: options.giftCards,
      scenes: options.getScenes?.(),
      liveRankings: options.getLiveRankings?.(),
      sceneEvents: options.getSceneEvents?.(),
      readDanmakuDisplay: options.getDanmakuDisplay?.(),
      danmakuAppearance: options.getDanmakuAppearance?.(),
      danmakuEvents: options.getDanmakuEvents?.(),
      maxBodyBytes: options.maxBodyBytes,
      sessionToken: options.getSessionToken(),
      broadcastSnapshot: options.broadcastSnapshot,
      broadcastGiftEffectPreview: options.broadcastGiftEffectPreview,
      requestCloudSync: options.requestCloudSync,
      giftSync: {
        rebuild: options.rebuildGiftProjection,
        clearRemote: options.clearRemoteGiftHistory,
      },
      domainServices,
      dynamicLottery: options.getDynamicLottery?.(),
      publishLyricState: musicRuntime.publishLyricState,
      publishLyricTimeline: musicRuntime.publishLyricTimeline,
      getLyricSource: musicRuntime.getLyricSource,
      selectLyricSource: musicRuntime.selectLyricSource,
      refreshLyricSource: musicRuntime.refreshLyricSource,
      weSingCapture: musicRuntime.weSingCapture,
      bilibili: {
        liveStatus: options.getLiveStatus(),
        configure: bilibiliRuntime.configure,
        reconnect: bilibiliRuntime.reconnect,
        updateStatus: bilibiliRuntime.updateStatus,
        auth: bilibiliRuntime.getAuthProvider(),
        danmakuSender: options.getDanmakuSender(),
        fetchAvatarImage: bilibiliRuntime.fetchAvatarImage,
        getRoomProfile: bilibiliRuntime.getRoomProfile,
        getLikeState: bilibiliRuntime.getLikeState,
        requestRandomSong: bilibiliRuntime.requestRandomSong,
      },
      ai: { configStore: aiRuntime.configStore, service: aiRuntime.service, updateConfig: aiRuntime.updateConfig, doubao: aiRuntime.doubao,
        chatgptSession: aiRuntime.chatgptSession },
      games: {
        service: gameService,
        ...createGameAudience({
          service: gameService,
          listOnlineViewers: bilibiliRuntime.getViewerCandidates,
          refreshViewers: bilibiliRuntime.refreshViewerCandidates,
          getWinnerProfile: bilibiliRuntime.getGameWinnerProfile,
        }),
      },
      wheel: { service: options.getWheelSessionService() },
      interactions: options.getInteractionSessionService?.(),
      settings: { defaults: options.defaultSettings, store: settingsStore },
      system: {
        ...options.systemPaths,
        getHardware: hardware.getHardwareSummary,
        liveStatus: options.getLiveStatus(),
        getState: options.getState,
        shutdown: options.shutdown,
      },
      music: {
        registry: musicRuntime.getMusicRegistry(),
        catalog: musicRuntime.catalogService,
        lyrics: musicRuntime.lyricsService,
        apiCacheDir: options.musicApiCacheDir,
        lyricCacheDir: options.musicLyricCacheDir,
      },
    });
  };
}

module.exports = { createRuntimeApiContextFactory };
