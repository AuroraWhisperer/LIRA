// 编写人：Aurora
// 播放控制器主模块 - 编排层
'use strict';

// ── 基础设施导入 ──
import * as PlaybackUtils from './utils.js';
import { UIRenderer } from './ui/index.js';
import { StateManager } from './state/manager.js';
import { StorageManager } from './state/storage.js';
import { QueueManager } from './queue/manager.js';
import { PlayerController } from './player/controller.js';
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

// ── 核心模块导入 ──
import { createInitializer } from './core/initializer.js';
import { createEventHandlers } from './core/event-handlers.js';
import { createRenderer } from './core/renderer.js';

// ── 功能模块导入 ──
import { createPlaybackControls } from './features/playback-controls.js';
import { createStreamHandler } from './features/stream-handler.js';
import { createRadioMode } from './features/radio-mode.js';
import { createQueueOperations } from './features/queue-operations.js';
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
  const escapeAttr = U.escapeAttr;
  const value = U.value;
  const formatBytes = U.formatBytes;
  const formatCompactNumber = U.formatCompactNumber;

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
  // SECTION 3 — 前向声明（解决循环依赖）
  // ══════════════════════════════════════════════════════════════
  let renderPlayback;
  let playPlaybackTrack;
  let ensurePlaybackRadioQueueFilled;

  // ══════════════════════════════════════════════════════════════
  // SECTION 4 — 管理器和服务的创建
  // ══════════════════════════════════════════════════════════════
  const stateManager = new StateManager();
  const storageManager = new StorageManager();
  const playbackState = stateManager.getState();

  const statePersistence = createStatePersistence({
    playbackState,
    getPlaybackAudio: () => document.getElementById('music-player')
  });
  const savePlaybackState = statePersistence.savePlaybackState;
  const flushPlaybackStateOnUnload = statePersistence.flushPlaybackStateOnUnload;

  const providerManager = new ProviderManager({
    state: playbackState,
    onStateChange: () => { if (renderPlayback) renderPlayback(); },
    onError: (error) => showError(error)
  });
  providerManager.setJsonResponseReader((r, msg) => readJsonResponse(r, msg));

  const cacheManager = new CacheManager();

  // contentLoader 的 onBackgroundUpdate 通过闭包延迟访问 homeService
  let homeService; // 前向声明供 contentLoader 闭包使用
  const contentLoader = new ContentLoader({
    state: playbackState,
    providerManager,
    cacheManager,
    onError: (error) => showError(error),
    readJsonResponse: (r, msg) => readJsonResponse(r, msg),
    onBackgroundUpdate: (update) => {
      if (homeService && homeService.getHomeState().action === update.action) {
        homeService._applyBackgroundUpdate(update);
        renderPlaybackHomeResults(update.action, update.title);
        toast(HomeService.getActionName(update.action) + '已自动更新');
      }
    }
  });

  const localFileManager = new LocalFileManager({ onError: (error) => showError(error) });

  const queueManager = new QueueManager({
    state: playbackState,
    radioRefillThreshold: playbackRadioRefillThreshold,
    radioRefillBatchSize: playbackRadioRefillBatchSize
  });

  const playerController = new PlayerController({
    state: playbackState,
    queueManager,
    onTrackChange: (track, options) => {
      if (playPlaybackTrack) playPlaybackTrack(track, options);
    },
    onStateChange: () => {
      if (renderPlayback) renderPlayback();
      savePlaybackState();
    },
    onError: (error) => { showError(error); }
  });

  const searchService = new SearchService({
    state: playbackState, onError: (e) => showError(e),
    readJsonResponse: (r, m) => readJsonResponse(r, m), toast: (m) => toast(m)
  });

  const streamService = new StreamService({
    refreshMarginMs: playbackStreamRefreshMarginMs, maxRetries: playbackStreamMaxRetries,
    onError: (e) => showError(e), readJsonResponse: (r, m) => readJsonResponse(r, m), toast: (m) => toast(m)
  });

  const lyricService = new LyricService({
    state: playbackState, onError: (e) => showError(e),
    readJsonResponse: (r, m) => readJsonResponse(r, m)
  });

  const matchService = new MatchService({
    state: playbackState, onError: (e) => showError(e),
    readJsonResponse: (r, m) => readJsonResponse(r, m), toast: (m) => toast(m)
  });

  const importService = new ImportService({
    matchService, onError: (e) => showError(e),
    readJsonResponse: (r, m) => readJsonResponse(r, m), toast: (m) => toast(m)
  });

  homeService = new HomeService({
    state: playbackState, contentLoader,
    onError: (e) => showError(e), readJsonResponse: (r, m) => readJsonResponse(r, m), toast: (m) => toast(m)
  });

  const uiRenderer = new UIRenderer();

  function getPlaybackAudio() {
    return document.getElementById('music-player');
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 5 — 渲染模块（无循环依赖，最先创建）
  // ══════════════════════════════════════════════════════════════
  const rendererModule = createRenderer({
    uiRenderer, playbackState, getPlaybackAudio, lyricService, searchService, homeService, escapeHtml
  });

  // 直接从渲染模块导出渲染函数
  const renderPlaybackProgress = rendererModule.renderPlaybackProgress;
  const renderFullscreenPlayer = rendererModule.renderFullscreenPlayer;
  const renderPendingConfirmPopup = rendererModule.renderPendingConfirmPopup;
  const renderPlaybackSearchResults = rendererModule.renderPlaybackSearchResults;
  const renderPlaybackHomeResults = rendererModule.renderPlaybackHomeResults;
  const renderPlaybackMatchResults = rendererModule.renderPlaybackMatchResults;

  // ══════════════════════════════════════════════════════════════
  // SECTION 6 — 无循环依赖的功能模块
  // ══════════════════════════════════════════════════════════════
  const cacheOperations = createCacheOperations({ readJsonResponse, formatBytes, toast, showError });

  const lyricControls = createLyricControls({
    playbackState, lyricService,
    renderPlayback: () => renderPlayback()
  });

  const matchHandler = createMatchHandler({
    matchService, showError, value,
    renderPlaybackMatchResults: (data) => renderPlaybackMatchResults(data)
  });

  const searchHandler = createSearchHandler({
    playbackState, searchService, value, toast,
    renderPlaybackSearchResults: () => renderPlaybackSearchResults()
  });

  const homeHandler = createHomeHandler({
    playbackState, homeService, uiRenderer, escapeHtml, toast, showError, readJsonResponse,
    savePlaybackState,
    renderPlayback: () => renderPlayback(),
    renderPlaybackHomeResults: (...args) => renderPlaybackHomeResults(...args)
  });

  const importHandler = createImportHandler({ playbackState, importService, showError, toast });

  const pendingHandler = createPendingHandler({
    playbackState, savePlaybackState,
    renderPlayback: () => renderPlayback()
  });

  // ══════════════════════════════════════════════════════════════
  // SECTION 7 — 带循环依赖的模块（使用闭包延迟访问 renderPlayback）
  // ══════════════════════════════════════════════════════════════
  const providerOperations = createProviderOperations({
    playbackState, providerManager,
    savePlaybackState,
    renderPlayback: () => renderPlayback(),
    getPlaybackAudio, toast, showError, U
  });

  const playlistOperations = createPlaylistOperations({
    playbackState, homeService, toast, showError, readJsonResponse,
    renderPlayback: () => renderPlayback(),
    escapeHtml,
    renderPlaybackHomeResults: (...args) => renderPlaybackHomeResults(...args)
  });

  // ══════════════════════════════════════════════════════════════
  // SECTION 8 — 渲染包装函数
  // ══════════════════════════════════════════════════════════════
  renderPlayback = function () {
    rendererModule.renderPlayback(
      providerOperations.getAuthState(),
      providerOperations.getProviderHealth()
    );
  };

  function syncPlaybackLyricWindow(force = false) {
    return lyricControls.syncPlaybackLyricWindow(force, getPlaybackAudio);
  }

  // updatePlaybackMediaSession 稍后赋值（需要 togglePlayback/playbackPrevious/playbackNext）
  let updatePlaybackMediaSession;

  // ══════════════════════════════════════════════════════════════
  // SECTION 9 — 队列操作模块 + 包装器
  // ══════════════════════════════════════════════════════════════
  const queueOps = createQueueOperations({
    playbackState, queueManager, savePlaybackState,
    renderPlayback: () => renderPlayback(),
    getPlaybackAudio,
    syncPlaybackLyricWindow: () => syncPlaybackLyricWindow()
  });

  function rebuildPlaybackShuffleOrder() {
    return queueOps.rebuildPlaybackShuffleOrder();
  }

  function takeNextShuffleNormalTrack() {
    return queueOps.takeNextShuffleNormalTrack();
  }

  // ── 队列操作包装器（注入 playPlaybackTrack / ensurePlaybackRadioQueueFilled）──
  async function startPlaybackCollection(tracks, selectedIndex, queueType, queueTitle = '') {
    const result = queueOps.startPlaybackCollection(tracks, selectedIndex, queueType, queueTitle);
    if (!result) return;
    rebuildPlaybackShuffleOrder();
    savePlaybackState();
    if (playPlaybackTrack) {
      await playPlaybackTrack(result.track, { origin: result.origin });
    }
    if (queueType === 'radio' && ensurePlaybackRadioQueueFilled) {
      ensurePlaybackRadioQueueFilled();
    }
  }

  function appendPlaybackTracks(tracks) {
    queueOps.appendPlaybackTracks(tracks);
  }

  function insertPlaybackTracksNext(tracks) {
    queueOps.insertPlaybackTracksNext(tracks, rebuildPlaybackShuffleOrder);
  }

  async function insertAndPlayPlaybackTrack(track) {
    console.log('[Controller] insertAndPlayPlaybackTrack called with:', track?.id);
    const result = queueOps.insertAndPlayPlaybackTrack(track, rebuildPlaybackShuffleOrder);
    console.log('[Controller] queueOps.insertAndPlayPlaybackTrack returned:', result);
    if (!result) return;
    if (result.shouldStartCollection) {
      await startPlaybackCollection(result.tracks, 0, result.queueType, result.title);
      return;
    }
    savePlaybackState();
    console.log('[Controller] About to call playPlaybackTrack:', typeof playPlaybackTrack, playPlaybackTrack);
    if (playPlaybackTrack) {
      console.log('[Controller] Calling playPlaybackTrack with:', result.track?.id, result.origin);
      await playPlaybackTrack(result.track, { origin: result.origin });
      console.log('[Controller] playPlaybackTrack completed');
    }
  }

  function takeNextPlaybackTrack() {
    const result = queueOps.takeNextPlaybackTrack(takeNextShuffleNormalTrack);
    if (result && playbackState.queueType === 'radio' && ensurePlaybackRadioQueueFilled) {
      ensurePlaybackRadioQueueFilled();
    }
    return result;
  }

  function takePlaybackQueueTrack(origin, index) {
    return queueOps.takePlaybackQueueTrack(origin, index);
  }

  function clearPlaybackQueue() {
    queueOps.clearPlaybackQueue();
  }

  function jumpToPlaylistTrack(index) {
    queueOps.jumpToPlaylistTrack(index, rebuildPlaybackShuffleOrder, playPlaybackTrack);
  }

  // ── queuePlaybackTrack（组合多个队列操作）──
  function queuePlaybackTrack(track, action, options = {}) {
    if (!track) return;
    if (action === 'play') {
      insertAndPlayPlaybackTrack(track);
      return;
    }
    if (action === 'requested') {
      insertPlaybackTracksNext([{ ...track, requestedBy: options.requestedBy || '手动添加' }]);
      toast('已插入当前歌曲之后');
    } else if (action === 'radio') {
      startPlaybackCollection([track], 0, 'radio');
      toast('已切换到电台队列');
      return;
    } else {
      appendPlaybackTracks([track]);
      rebuildPlaybackShuffleOrder();
      toast('已加入当前队列');
    }
    savePlaybackState();
    renderPlayback();
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 10 — 适配器函数（模块 → sharedDeps 的固定签名接口）
  // ══════════════════════════════════════════════════════════════
  const queueCallbacks = {
    startPlaybackCollection, appendPlaybackTracks, insertAndPlayPlaybackTrack,
    insertPlaybackTracksNext, queuePlaybackTrack, rebuildPlaybackShuffleOrder,
    savePlaybackState, renderPlayback: () => renderPlayback()
  };

  const searchCallbacks = {
    addTrackToPlaylist: (t) => playlistOperations.addTrackToPlaylist(t),
    insertAndPlayPlaybackTrack, insertPlaybackTracksNext, appendPlaybackTracks,
    startPlaybackCollection: (...args) => startPlaybackCollection(...args),
    playPlaybackTrack: (...args) => playPlaybackTrack(...args),
    rebuildPlaybackShuffleOrder, savePlaybackState, renderPlayback: () => renderPlayback()
  };

  const homeTrackCallbacks = {
    ...queueCallbacks,
    removeTrackFromPlaylist: (t, a) => playlistOperations.removeTrackFromPlaylist(t, a),
    addTrackToPlaylist: (t) => playlistOperations.addTrackToPlaylist(t)
  };

  function loadPlaybackHomeContent(action) {
    return homeHandler.loadPlaybackHomeContent(action, () => providerOperations.getAuthState());
  }

  function loadPlaybackPlaylistTracks(index) {
    return homeHandler.loadPlaybackPlaylistTracks(index);
  }

  function refreshPlaybackHomeContent() {
    return homeHandler.refreshPlaybackHomeContent();
  }

  function handlePlaybackHomeBulkAction(action) {
    return homeHandler.handlePlaybackHomeBulkAction(action, queueCallbacks);
  }

  function handlePlaybackDrawerHeaderPlayAll() {
    return homeHandler.handlePlaybackDrawerHeaderPlayAll(queueCallbacks);
  }

  function handlePlaybackHomeTrackAction(action, index) {
    return homeHandler.handlePlaybackHomeTrackAction(action, index, homeTrackCallbacks);
  }

  function handlePlaybackSearchAction(action, index) {
    return searchHandler.handlePlaybackSearchAction(action, index, searchCallbacks);
  }

  function handlePlaybackPendingAction(action, index) {
    return pendingHandler.handlePlaybackPendingAction(action, index, playPlaybackTrack);
  }

  function importSongQueueToPlayback() {
    return importHandler.importSongQueueToPlayback({
      insertPlaybackTracksNext, savePlaybackState, renderPlayback: () => renderPlayback()
    });
  }

  function togglePlaybackLyricWindow() {
    return lyricControls.togglePlaybackLyricWindow();
  }

  function togglePlaybackLyricLock() {
    return lyricControls.togglePlaybackLyricLock();
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 11 — 构建 sharedDeps
  // ══════════════════════════════════════════════════════════════
  const sharedDeps = {
    // 核心对象
    playbackState, getPlaybackAudio, uiRenderer, playerController,
    storageManager, cacheManager, localFileManager, queueManager, providerManager,
    homeService, searchService, matchService, importService, lyricService, streamService,

    // Provider 状态（getter 延迟访问）
    get playbackAuthState() { return providerOperations.getAuthState(); },
    get playbackProviderHealth() { return providerOperations.getProviderHealth(); },

    // 渲染函数
    renderPlayback: () => renderPlayback(),
    renderPlaybackProgress: () => renderPlaybackProgress(),
    renderFullscreenPlayer: () => renderFullscreenPlayer(),
    renderPendingConfirmPopup: () => renderPendingConfirmPopup(),
    renderPlaybackSearchResults: () => renderPlaybackSearchResults(),
    renderPlaybackHomeResults: (...args) => renderPlaybackHomeResults(...args),
    savePlaybackState,
    syncPlaybackLyricWindow: () => syncPlaybackLyricWindow(),
    updatePlaybackMediaSession: () => updatePlaybackMediaSession(),

    // Provider 操作
    refreshSelectedMusicProviderState: () => providerOperations.refreshSelectedMusicProviderState(),
    refreshPlaybackMusicCacheStats: () => cacheOperations.refreshPlaybackMusicCacheStats(),
    loginSelectedMusicProvider: () => providerOperations.loginSelectedMusicProvider(),
    logoutSelectedMusicProvider: () => providerOperations.logoutSelectedMusicProvider(),
    checkSelectedMusicProviderHealth: (o) => providerOperations.checkSelectedMusicProviderHealth(o),
    clearPlaybackMusicCache: () => cacheOperations.clearPlaybackMusicCache(),

    // 首页 & Drawer 操作
    loadPlaybackHomeContent,
    loadPlaybackPlaylistTracks,
    refreshPlaybackHomeContent,
    handlePlaybackHomeBulkAction,
    handlePlaybackDrawerHeaderPlayAll,
    handlePlaybackHomeTrackAction,
    handlePlaybackSearchAction,
    toggleTrackMenu: (i) => homeHandler.toggleTrackMenu(i),
    openPlaybackDrawer: (...a) => homeHandler.openPlaybackDrawer(...a),
    closePlaybackDrawer: () => homeHandler.closePlaybackDrawer(),
    playbackDrawerGoBack: () => homeHandler.playbackDrawerGoBack(),
    toggleQueuePopup: () => homeHandler.toggleQueuePopup(),
    closeQueuePopup: () => homeHandler.closeQueuePopup(),

    // 队列操作
    clearPlaybackQueue, importSongQueueToPlayback,
    takePlaybackQueueTrack, jumpToPlaylistTrack,
    rebuildPlaybackShuffleOrder, startPlaybackCollection,
    appendPlaybackTracks, insertPlaybackTracksNext,
    addCurrentTrackToPlaylist: () => playlistOperations.addCurrentTrackToPlaylist(),

    // 匹配 & 搜索
    runPlaybackMatchTest: () => matchHandler.runPlaybackMatchTest(),
    runPlaybackSearch: () => searchHandler.runPlaybackSearch(),
    clearPlaybackSearch: () => searchHandler.clearPlaybackSearch(),

    // 工具函数
    escapeHtml, escapeAttr, value, formatBytes, formatCompactNumber, toast, showError, readJsonResponse, U
  };

  // ══════════════════════════════════════════════════════════════
  // SECTION 12 — 播放控制模块（产生 playPlaybackTrack）
  // ══════════════════════════════════════════════════════════════
  const playbackControls = createPlaybackControls(sharedDeps);
  playPlaybackTrack = playbackControls.playPlaybackTrack;
  const togglePlaybackRaw = playbackControls.togglePlayback;
  const playbackPrevious = playbackControls.playbackPrevious;
  const playbackNextRaw = playbackControls.playbackNext;
  const loadPlaybackLyrics = playbackControls.loadPlaybackLyrics;
  const ensureLocalTrackPlayable = playbackControls.ensureLocalTrackPlayable;

  // ══════════════════════════════════════════════════════════════
  // SECTION 13 — 流处理 & 电台模块
  // ══════════════════════════════════════════════════════════════
  const streamHandler = createStreamHandler(sharedDeps);

  const radioMode = createRadioMode(sharedDeps);
  ensurePlaybackRadioQueueFilled = radioMode.ensurePlaybackRadioQueueFilled;

  // ══════════════════════════════════════════════════════════════
  // SECTION 14 — 回调注入（包装需要注入回调的函数）
  // ══════════════════════════════════════════════════════════════
  const togglePlayback = function () {
    return togglePlaybackRaw(takeNextPlaybackTrack, () => providerOperations.showPlaybackLoginPrompt());
  };

  const playbackNext = function (fromEnded) {
    return playbackNextRaw(fromEnded, takeNextPlaybackTrack, ensurePlaybackRadioQueueFilled);
  };

  // updatePlaybackMediaSession 现在可以正确赋值
  updatePlaybackMediaSession = function () {
    rendererModule.updatePlaybackMediaSession(togglePlayback, playbackPrevious, () => playbackNext(false));
  };

  // ══════════════════════════════════════════════════════════════
  // SECTION 15 — 初始化器 & 事件处理器
  // ══════════════════════════════════════════════════════════════
  const eventHandlersModule = createEventHandlers({
    ...sharedDeps,
    playbackPrevious, playbackNext,
    togglePlayback, playPlaybackTrack,
    togglePlaybackLyricWindow, togglePlaybackLyricLock,
    handlePlaybackPendingAction,
    renderPlaybackMatchResults: (d) => renderPlaybackMatchResults(d)
  });

  const playbackInitializer = createInitializer({
    ...sharedDeps,
    playbackNext,
    handlePlaybackError: streamHandler.handlePlaybackError,
    flushPlaybackStateOnUnload: statePersistence.flushPlaybackStateOnUnload,
    refreshSelectedMusicProviderState: () => providerOperations.refreshSelectedMusicProviderState()
  });

  async function restorePlaybackState() {
    const restored = await storageManager.restoreState();
    if (restored) {
      Object.assign(playbackState, restored);
      await playbackInitializer.restoreLocalFileUrls();
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 16 — 公共 API
  // ══════════════════════════════════════════════════════════════
  return {
    init: async (options) => {
      if (options) {
        if (options.getSongs) getSongs = options.getSongs;
        if (options.reloadSongs) reloadSongs = options.reloadSongs;
        if (options.toast) toast = options.toast;
        if (options.showError) showError = options.showError;
        if (options.api) api = options.api;
        if (options.readJsonResponse) readJsonResponse = options.readJsonResponse;
      }

      await playbackInitializer.init(
        eventHandlersModule.setupEventHandlers,
        restorePlaybackState,
        cacheOperations.refreshPlaybackMusicCacheStats
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
    }
  };
}
