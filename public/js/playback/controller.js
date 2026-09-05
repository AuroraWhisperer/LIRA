// 编写人：Aurora
// 播放控制器主模块 - 编排层
'use strict';

// ── 基础设施导入 ──
import * as PlaybackUtils from './utils.js';
import { UIRenderer } from './ui/index.js';
import { StateManager } from './state/manager.js';
import { StorageManager } from './state/storage.js';
import { QueueManager } from './queue/manager.js';
import { ProviderManager } from './provider/manager.js';
import { ContentLoader } from './content/loader.js';
import { LocalFileManager } from './local/manager.js';
import { CacheManager } from './cache/manager.js';
import { PlaybackConfig } from './config.js';

// ── 服务导入 ──
import { SearchService } from './services/search-service.js';
import { StreamService } from './services/stream-service.js';
import { LyricService } from './services/lyric-service.js';
import { MatchService } from './services/match-service.js';
import { ImportService } from './services/import-service.js';
import { HomeService } from './services/home-service.js';
import { WeSingService } from './services/wesing-service.js';

// ── 核心模块导入 ──
import { createInitializer } from './core/initializer.js';
import { createEventHandlers } from './core/event-handlers.js';
import { createRenderer } from './core/renderer.js';
import { createPlaybackQueueCoordinator } from './core/queue-coordinator.js';
import { createPlaybackActionAdapters } from './core/action-adapters.js';

// ── 功能模块导入 ──
import { createPlaybackControls } from './features/playback-controls.js';
import { createStreamHandler } from './features/stream-handler.js';
import { createRadioMode } from './features/radio-mode.js';
import { createSearchHandler } from './features/search-handler.js';
import { createHomeHandler } from './features/home-handler.js';
import { createPendingHandler } from './features/pending-handler.js';
import { createLyricControls } from './features/lyric-controls.js';
import { createImportHandler } from './features/import-handler.js';
import { createMatchHandler } from './features/match-handler.js';

// ── 操作模块导入 ──
import { createProviderOperations } from './operations/provider-operations.js';
import { createStatePersistence } from './operations/state-persistence.js';
import { createPlaylistOperations } from './operations/playlist-operations.js';
import { createCacheOperations } from './operations/cache-operations.js';

// ── 共享工具导入 ──
import * as Utils from '../shared/utils.js';

export function createPlaybackController(initialOptions = {}) {
  // ══════════════════════════════════════════════════════════════
  // SECTION 1 — 工具函数提取
  // ══════════════════════════════════════════════════════════════
  const U = Utils;
  const escapeHtml = U.escapeHtml;
  const value = U.value;
  const formatBytes = U.formatBytes;

  let getSongs = () => [];
  let reloadSongs = async () => {};
  let toast = U.toast;
  let showError = U.showError;
  let api = U.api;
  let readJsonResponse = U.readJsonResponse;

  // ══════════════════════════════════════════════════════════════
  // SECTION 2 — 配置常量
  // ══════════════════════════════════════════════════════════════
  const playbackRadioRefillThreshold = PlaybackConfig.RADIO_REFILL_THRESHOLD;
  const playbackRadioRefillBatchSize = PlaybackConfig.RADIO_REFILL_BATCH_SIZE;
  const playbackStreamRefreshMarginMs = PlaybackConfig.STREAM_REFRESH_MARGIN_MS;
  const playbackStreamMaxRetries = PlaybackConfig.STREAM_MAX_RETRIES;

  // ══════════════════════════════════════════════════════════════
  // SECTION 3 — 管理器和服务的创建
  // ══════════════════════════════════════════════════════════════
  const stateManager = new StateManager();
  const storageManager = new StorageManager();
  const playbackState = stateManager.getState();

  const statePersistence = createStatePersistence({
    playbackState,
    getPlaybackAudio: () => document.getElementById('music-player'),
  });
  const savePlaybackState = statePersistence.savePlaybackState;
  const flushPlaybackStateOnUnload =
    statePersistence.flushPlaybackStateOnUnload;

  const providerManager = new ProviderManager({
    state: playbackState,
    onStateChange: renderPlayback,
    onError: (error) => showError(error),
  });
  providerManager.setJsonResponseReader((r, msg) => readJsonResponse(r, msg));

  const cacheManager = new CacheManager();

  function applyBackgroundHomeUpdate(update) {
    if (homeService.getHomeState().action !== update.action) return;
    if (playbackState.selectedSource !== update.platform) return;
    if (!homeService._applyBackgroundUpdate(update)) return;
    renderPlaybackHomeResults(update.action, update.title);
    toast(HomeService.getActionName(update.action) + '已自动更新');
  }

  const contentLoader = new ContentLoader({
    state: playbackState,
    providerManager,
    cacheManager,
    onError: (error) => showError(error),
    readJsonResponse: (r, msg) => readJsonResponse(r, msg),
    onBackgroundUpdate: applyBackgroundHomeUpdate,
  });

  const localFileManager = new LocalFileManager({
    onError: (error) => showError(error),
  });

  const queueManager = new QueueManager({
    state: playbackState,
    radioRefillThreshold: playbackRadioRefillThreshold,
    radioRefillBatchSize: playbackRadioRefillBatchSize,
  });

  const searchService = new SearchService({
    state: playbackState,
    onError: (e) => showError(e),
    readJsonResponse: (r, m) => readJsonResponse(r, m),
    toast: (m) => toast(m),
  });

  const streamService = new StreamService({
    refreshMarginMs: playbackStreamRefreshMarginMs,
    maxRetries: playbackStreamMaxRetries,
    onError: (e) => showError(e),
    readJsonResponse: (r, m) => readJsonResponse(r, m),
    toast: (m) => toast(m),
  });

  const lyricService = new LyricService({
    state: playbackState,
    readJsonResponse: (r, m) => readJsonResponse(r, m),
  });

  const matchService = new MatchService({
    state: playbackState,
    onError: (e) => showError(e),
    readJsonResponse: (r, m) => readJsonResponse(r, m),
    toast: (m) => toast(m),
  });

  const importService = new ImportService({
    matchService,
    onError: (e) => showError(e),
    readJsonResponse: (r, m) => readJsonResponse(r, m),
    toast: (m) => toast(m),
  });

  const homeService = new HomeService({
    state: playbackState,
    contentLoader,
    onError: (e) => showError(e),
    readJsonResponse: (r, m) => readJsonResponse(r, m),
    toast: (m) => toast(m),
  });

  const uiRenderer = new UIRenderer();
  const weSingService = new WeSingService({
    playbackState,
    onStateChange: renderPlayback,
    showError: (error) => showError(error),
    toast: (message) => toast(message),
    readJsonResponse: (response, message) =>
      readJsonResponse(response, message),
  });

  function getPlaybackAudio() {
    return document.getElementById('music-player');
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 4 — 渲染模块
  // ══════════════════════════════════════════════════════════════
  const rendererModule = createRenderer({
    uiRenderer,
    playbackState,
    getPlaybackAudio,
    lyricService,
    searchService,
    homeService,
    weSingService,
    escapeHtml,
  });

  // 直接从渲染模块导出渲染函数
  const renderPlaybackProgress = rendererModule.renderPlaybackProgress;
  const renderFullscreenPlayer = rendererModule.renderFullscreenPlayer;
  const renderPlaybackSearchResults =
    rendererModule.renderPlaybackSearchResults;
  const renderPlaybackHomeResults = rendererModule.renderPlaybackHomeResults;
  const renderPlaybackMatchResults = rendererModule.renderPlaybackMatchResults;

  // ══════════════════════════════════════════════════════════════
  // SECTION 5 — 独立功能模块
  // ══════════════════════════════════════════════════════════════
  const cacheOperations = createCacheOperations({
    readJsonResponse,
    formatBytes,
    toast,
    showError,
  });

  const lyricControls = createLyricControls({
    playbackState,
    lyricService,
    renderPlayback: () => renderPlayback(),
  });

  const matchHandler = createMatchHandler({
    matchService,
    showError,
    value,
    renderPlaybackMatchResults: (data) => renderPlaybackMatchResults(data),
  });

  const searchHandler = createSearchHandler({
    playbackState,
    searchService,
    value,
    toast,
    renderPlaybackSearchResults: () => renderPlaybackSearchResults(),
  });

  const homeHandler = createHomeHandler({
    playbackState,
    homeService,
    uiRenderer,
    escapeHtml,
    toast,
    showError,
    readJsonResponse,
    savePlaybackState,
    renderPlayback: () => renderPlayback(),
    renderPlaybackHomeResults: (...args) => renderPlaybackHomeResults(...args),
  });

  const importHandler = createImportHandler({
    playbackState,
    importService,
    showError,
    toast,
  });

  const pendingHandler = createPendingHandler({
    playbackState,
    savePlaybackState,
    renderPlayback: () => renderPlayback(),
  });

  // ══════════════════════════════════════════════════════════════
  // SECTION 6 — Provider 与歌单操作
  // ══════════════════════════════════════════════════════════════
  const providerOperations = createProviderOperations({
    playbackState,
    providerManager,
    cacheManager,
    weSingService,
    savePlaybackState,
    renderPlayback: () => renderPlayback(),
    getPlaybackAudio,
    toast,
    showError,
    U,
  });

  const playlistOperations = createPlaylistOperations({
    playbackState,
    homeService,
    toast,
    showError,
    readJsonResponse,
    renderPlayback: () => renderPlayback(),
    escapeHtml,
    renderPlaybackHomeResults: (...args) => renderPlaybackHomeResults(...args),
  });

  // ══════════════════════════════════════════════════════════════
  // SECTION 7 — 渲染与延迟绑定包装函数
  // ══════════════════════════════════════════════════════════════
  function renderPlayback() {
    rendererModule.renderPlayback(
      providerOperations.getAuthState(),
      providerOperations.getProviderHealth(),
    );
  }

  function syncPlaybackLyricWindow(force = false) {
    return lyricControls.syncPlaybackLyricWindow(force, getPlaybackAudio);
  }

  function playPlaybackTrack(...args) {
    return playbackControls.playPlaybackTrack(...args);
  }

  function ensurePlaybackRadioQueueFilled(...args) {
    return radioMode.ensurePlaybackRadioQueueFilled(...args);
  }

  function updatePlaybackMediaSession() {
    rendererModule.updatePlaybackMediaSession(
      togglePlayback,
      playbackPrevious,
      () => playbackNext(false),
    );
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 8 — 队列操作模块 + 包装器
  // ══════════════════════════════════════════════════════════════
  const queueCoordinator = createPlaybackQueueCoordinator({
    playbackState,
    queueManager,
    savePlaybackState,
    renderPlayback: () => renderPlayback(),
    getPlaybackAudio,
    syncPlaybackLyricWindow: () => syncPlaybackLyricWindow(),
    playPlaybackTrack: (...args) => playPlaybackTrack(...args),
    ensurePlaybackRadioQueueFilled: (...args) =>
      ensurePlaybackRadioQueueFilled(...args),
    toast,
  });
  const {
    startPlaybackCollection,
    appendPlaybackTracks,
    insertPlaybackTracksNext,
    insertAndPlayPlaybackTrack,
    takeNextPlaybackTrack,
    takePlaybackQueueTrack,
    clearPlaybackQueue,
    jumpToPlaylistTrack,
    queuePlaybackTrack,
    rebuildPlaybackShuffleOrder,
  } = queueCoordinator;

  // ══════════════════════════════════════════════════════════════
  // SECTION 9 — 功能适配器
  // ══════════════════════════════════════════════════════════════
  const actionAdapters = createPlaybackActionAdapters({
    homeHandler,
    searchHandler,
    pendingHandler,
    importHandler,
    queueCoordinator,
    playlistOperations,
    providerOperations,
    savePlaybackState,
    renderPlayback: () => renderPlayback(),
    playPlaybackTrack: (...args) => playPlaybackTrack(...args),
  });
  const {
    loadPlaybackHomeContent,
    loadPlaybackPlaylistTracks,
    refreshPlaybackHomeContent,
    handlePlaybackHomeBulkAction,
    handlePlaybackDrawerHeaderPlayAll,
    handlePlaybackHomeTrackAction,
    handlePlaybackSearchAction,
    handlePlaybackPendingAction,
    importSongQueueToPlayback,
  } = actionAdapters;

  // ══════════════════════════════════════════════════════════════
  // SECTION 10 — 播放控制模块
  // ══════════════════════════════════════════════════════════════
  const playbackControls = createPlaybackControls({
    playbackState,
    getPlaybackAudio,
    showError,
    toast,
    lyricService,
    localFileManager,
    streamService,
    savePlaybackState,
    renderPlayback,
    updatePlaybackMediaSession,
    syncPlaybackLyricWindow,
    getPlaybackAuthState: () => providerOperations.getAuthState(),
    rebuildPlaybackShuffleOrder,
    U,
  });
  const togglePlaybackRaw = playbackControls.togglePlayback;
  const playbackPrevious = playbackControls.playbackPrevious;
  const playbackNextRaw = playbackControls.playbackNext;
  const changePlaybackQuality = playbackControls.changePlaybackQuality;

  // ══════════════════════════════════════════════════════════════
  // SECTION 11 — 流处理 & 电台模块
  // ══════════════════════════════════════════════════════════════
  const streamHandler = createStreamHandler({
    streamService,
    playbackState,
    getPlaybackAudio,
    playPlaybackTrack,
    playbackNext,
  });

  const radioMode = createRadioMode({
    playbackState,
    readJsonResponse,
    playbackRadioRefillThreshold,
    playbackRadioRefillBatchSize,
    savePlaybackState,
    renderPlayback,
  });

  // ══════════════════════════════════════════════════════════════
  // SECTION 12 — 回调注入（包装需要注入回调的函数）
  // ══════════════════════════════════════════════════════════════
  function togglePlayback() {
    return togglePlaybackRaw(takeNextPlaybackTrack, () =>
      providerOperations.showPlaybackLoginPrompt(),
    );
  }

  function playbackNext(fromEnded) {
    return playbackNextRaw(
      fromEnded,
      takeNextPlaybackTrack,
      ensurePlaybackRadioQueueFilled,
    );
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 13 — 初始化器 & 事件处理器
  // ══════════════════════════════════════════════════════════════
  const eventHandlersModule = createEventHandlers({
    playbackState,
    getPlaybackAudio,
    uiRenderer,
    homeService,
    searchService,
    matchService,
    providerManager,
    savePlaybackState,
    renderPlayback,
    renderPlaybackSearchResults,
    renderPlaybackHomeResults,
    handlePlaybackPendingAction,
    renderPlaybackMatchResults,
    renderFullscreenPlayer,
    syncPlaybackLyricWindow,
    clearPlaybackQueue,
    importSongQueueToPlayback,
    playbackPrevious,
    playbackNext,
    togglePlayback,
    changePlaybackQuality,
    addCurrentTrackToPlaylist: () =>
      playlistOperations.addCurrentTrackToPlaylist(),
    loginSelectedMusicProvider: () =>
      providerOperations.loginSelectedMusicProvider(),
    logoutSelectedMusicProvider: () =>
      providerOperations.logoutSelectedMusicProvider(),
    checkSelectedMusicProviderHealth: (options) =>
      providerOperations.checkSelectedMusicProviderHealth(options),
    clearPlaybackMusicCache: () => cacheOperations.clearPlaybackMusicCache(),
    runPlaybackMatchTest: () => matchHandler.runPlaybackMatchTest(),
    runPlaybackSearch: () => searchHandler.runPlaybackSearch(),
    clearPlaybackSearch: () => searchHandler.clearPlaybackSearch(),
    loadPlaybackHomeContent,
    toggleQueuePopup: () => homeHandler.toggleQueuePopup(),
    closeQueuePopup: () => homeHandler.closeQueuePopup(),
    closePlaybackDrawer: () => homeHandler.closePlaybackDrawer(),
    playbackDrawerGoBack: () => homeHandler.playbackDrawerGoBack(),
    refreshPlaybackHomeContent,
    handlePlaybackDrawerHeaderPlayAll,
    handlePlaybackHomeBulkAction,
    loadPlaybackPlaylistTracks,
    toggleTrackMenu: (index) => homeHandler.toggleTrackMenu(index),
    handlePlaybackHomeTrackAction,
    handlePlaybackSearchAction,
    takePlaybackQueueTrack,
    jumpToPlaylistTrack,
    playPlaybackTrack,
    rebuildPlaybackShuffleOrder,
    refreshSelectedMusicProviderState: () =>
      providerOperations.refreshSelectedMusicProviderState(),
    escapeHtml,
    value,
  });

  const playbackInitializer = createInitializer({
    playbackState,
    getPlaybackAudio,
    uiRenderer,
    storageManager,
    localFileManager,
    renderPlayback,
    renderPlaybackProgress,
    renderFullscreenPlayer,
    savePlaybackState,
    syncPlaybackLyricWindow,
    updatePlaybackMediaSession,
    playbackNext,
    handlePlaybackError: streamHandler.handlePlaybackError,
    flushPlaybackStateOnUnload: statePersistence.flushPlaybackStateOnUnload,
    flushPlaybackStateForShutdown:
      statePersistence.flushPlaybackStateForShutdown,
    refreshSelectedMusicProviderState: () =>
      providerOperations.refreshSelectedMusicProviderState(),
  });

  async function restorePlaybackState() {
    const restored = await storageManager.restoreState();
    if (restored) {
      Object.assign(playbackState, restored);
      await playbackInitializer.restoreLocalFileUrls();
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 14 — 公共 API
  // ══════════════════════════════════════════════════════════════
  return {
    init: async (options) => {
      if (options) {
        if (options.getSongs) getSongs = options.getSongs;
        if (options.reloadSongs) reloadSongs = options.reloadSongs;
        if (options.toast) toast = options.toast;
        if (options.showError) showError = options.showError;
        if (options.api) api = options.api;
        if (options.readJsonResponse)
          readJsonResponse = options.readJsonResponse;
      }

      weSingService.init();

      await playbackInitializer.init(
        eventHandlersModule.setupEventHandlers,
        restorePlaybackState,
        cacheOperations.refreshPlaybackMusicCacheStats,
      );
    },

    updateContext: (options) => {
      if (!options) return;
      if (options.getSongs) getSongs = options.getSongs;
      if (options.reloadSongs) reloadSongs = options.reloadSongs;
      if (options.toast) toast = options.toast;
      if (options.showError) showError = options.showError;
      if (options.api) api = options.api;
      if (options.readJsonResponse) readJsonResponse = options.readJsonResponse;
    },
  };
}
