// 编写人：Aurora
'use strict';

const { createHttpServer } = require('./server/http-server');
const { createAuthorizedWorkController } = require('./server/authorized-work');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openAdminPageIfNeeded } = require('./server/admin-launcher');
const {
  createBilibiliClient: buildBilibiliClient,
} = require('./server/bilibili-client');
const { createBilibiliRuntime } = require('./server/bilibili-runtime');
const { buildMusicRuntime } = require('./server/music-runtime');
const { buildAiRuntime } = require('./server/ai-runtime');
const { createInflightTracker } = require('./server/inflight-tracker');
const { createServerCompatibility } = require('./server/compatibility-runtime');
const {
  createRuntimeApiContextFactory,
} = require('./server/runtime-api-context');
const {
  resolveServerRuntimeConfig,
  validateServerHost,
} = require('./server/runtime-config');
const { createRuntimeTransport } = require('./server/runtime-transport');
const { runStartupRetention } = require('./server/startup-retention');
const lifecycle = require('./server/lifecycle');
const wsTransport = require('./server/ws');
const { createDomainServices } = require('./server/domain-services');
const sharedUtils = require('./shared/utils');
const {
  createDatabases,
  optimizeDatabases,
  closeDatabases,
} = require('./storage/database');
const { createGiftSyncStore } = require('./storage/gift-sync-store');
const { migrateCacheData } = require('./storage/data-directory-migration');
const { DEFAULT_SETTINGS } = require('./storage/settings-defaults');
const { prepareSettingsBootstrap } = require('./server/settings-bootstrap');
const giftEffectModule = require('./bilibili/gift/effect-config');
const { createGiftExportRuntime } = require('./server/gift-export-runtime');
const { createDanmakuFeedBuffer } = require('./bilibili/danmaku/feed-buffer');
const { createGameRuntime } = require('./server/game-runtime');
const { createWheelSessionService } = require('./games/wheel-session-service');
const {
  createDynamicLotteryRuntime,
} = require('./server/dynamic-lottery-runtime');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const START_PORT = 3000;
const PORT_CLEANUP_TIMEOUT_MS = 7500;
const PORT_CLEANUP_POLL_MS = 120;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const {
  normalizeCloudSettingsSnapshot,
  serializeCloudSettings,
} = require('./server/settings-contract');

function createServerRuntime(runtimeOptions = {}) {
  const {
    HOST,
    DATA_DIR,
    SONG_DB_PATH,
    SUPER_CHAT_DB_PATH,
    GIFT_DB_PATH,
    MUSIC_DB_PATH,
    CHECKIN_DB_PATH,
    MUSIC_API_CACHE_DIR,
    MUSIC_LYRIC_CACHE_DIR,
    OPENING_MUSIC_DIR,
    AI_LOG_PATH,
  } = resolveServerRuntimeConfig(ROOT_DIR, runtimeOptions);

  let db = null;
  let settingsStore = null;
  let webSocketHub = null;
  let giftEffectResolver = null;
  let domainServices = null;
  let giftSyncStore = null;
  let musicRuntime = null;
  let bilibiliRuntime = null;
  let liveStatus = null;
  let bilibiliDiagnostics = null;
  let danmakuSender = null;
  let danmakuFeedBuffer = null;
  let aiRuntime = null;
  let gameSessionService = null;
  let wheelSessionService = null;
  let interactionSessionService = null;
  let dynamicLottery = null;
  let applicationInitialized = false;
  let publishOvertimeUpdate = () => {};
  let isShuttingDown = false;
  let phase = 'stopped';
  let startedPort = null;
  let startPromise = null;
  let shutdownPromise = null;
  let exitRequested = false;
  let exitIssued = false;
  let sessionToken = '';
  let blindBoxMappingState = null;
  const cloudSyncListeners = new Set();
  const inflightTracker = createInflightTracker();
  const licenseGate = runtimeOptions.licenseGate || {
    isAuthorized: () => true,
  };
  const isLicenseAuthorized = () =>
    typeof licenseGate.isAuthorized === 'function'
      ? licenseGate.isAuthorized() === true
      : true;
  const {
    getWebSocketContext,
    broadcastSnapshot,
    publishGiftFlushed,
    publishGiftCatalogUpdate,
    publishGiftEffect,
    publishDanmaku,
    publishOvertimeUpdate: broadcastOvertimeUpdate,
    servePageOrAsset,
  } = createRuntimeTransport({
    publicDir: PUBLIC_DIR,
    defaultPort: START_PORT,
    getHost: () => HOST,
    getStartedPort: () => startedPort,
    getSessionToken: () => sessionToken,
    beginPlaybackSnapshotSession: () => domainServices.playback.beginQueueStateSession(),
    getWebSocketHub: () => webSocketHub,
    getState,
    getSettings: () => settingsStore.getSettings(),
    getDanmakuFeedBuffer: () => danmakuFeedBuffer,
    resolveGiftEffect: (giftId) => domainServices.gifts.resolveEffect(giftId),
  });
  const { resumeAuthorizedWork, pauseAuthorizedWork } =
    createAuthorizedWorkController({
      isLicenseAuthorized,
      getBilibiliRuntime: () => bilibiliRuntime,
      getOvertimeGiftCatalog: () => domainServices?.overtimeGiftCatalog,
    });

  async function initializeApplication(options = {}) {
    if (applicationInitialized) return;
    try {
      giftRuntime.configureGiftSync(options.giftSync);
      const reportPhase =
        typeof runtimeOptions.onPhase === 'function'
          ? runtimeOptions.onPhase
          : () => {};
      let phaseStartedAt = Date.now();
      migrateCacheData({ dataDir: DATA_DIR });
      db = createDatabases({
        dataDir: DATA_DIR,
        defaultSettings: DEFAULT_SETTINGS,
      });
      dynamicLottery = createDynamicLotteryRuntime({
        db: db.lotteryDb,
        auth: runtimeOptions.dynamicLotteryAuth,
      });
      fs.mkdirSync(OPENING_MUSIC_DIR, { recursive: true });
      reportPhase('database-init', Date.now() - phaseStartedAt);
      phaseStartedAt = Date.now();
      const settingsBootstrap = prepareSettingsBootstrap(db.songDb);
      settingsStore = settingsBootstrap.settingsStore;
      webSocketHub = wsTransport.createWebSocketHub();
      danmakuFeedBuffer = createDanmakuFeedBuffer();
      ({ games: gameSessionService, interactions: interactionSessionService } = createGameRuntime({
        broadcast: (payload) => webSocketHub.broadcast(payload),
        getSourceState: () => bilibiliRuntime.getRealtimeState(),
        subscribe: (listener) => bilibiliRuntime.subscribeRealtime(listener),
      }));
      wheelSessionService = createWheelSessionService({
        broadcast: (payload) => webSocketHub.broadcast(payload),
      });
      giftEffectResolver = giftEffectModule.createGiftEffectResolver();
      domainServices = createDomainServices({
        db,
        getFanScope: runtimeOptions.getFanScope,
        settingsStore,
        dataDir: DATA_DIR,
        giftSaleGetRoomId: runtimeOptions.giftSaleGetRoomId,
        giftSaleGetBlindBoxConfig: runtimeOptions.giftSaleGetBlindBoxConfig,
        giftSaleFetchJson: runtimeOptions.giftSaleFetchJson,
        remoteGiftCatalog:
          typeof options.remoteGiftCatalog?.fetch === 'function'
            ? {
                ...options.remoteGiftCatalog,
                onUpdated: (snapshot) => {
                  publishGiftCatalogUpdate(snapshot);
                  options.remoteGiftCatalog.onUpdated?.(snapshot);
                },
              }
            : null,
        giftEffectResolver,
        onGiftFlushed: publishGiftFlushed,
        onOvertimeUpdate: (update) => publishOvertimeUpdate(update),
      });
      giftSyncStore = createGiftSyncStore({
        giftDb: db.giftDb,
        importHistoryRecord: (record, sourceId) =>
          domainServices.gifts.importProcessedHistoryRecord(record, sourceId),
        importLiveEvent: (event, sourceId, importOptions) =>
          domainServices.gifts.importProcessedEvent(
            event,
            sourceId,
            importOptions,
          ),
      });
      musicRuntime = buildMusicRuntime({
        dataDir: {
          apiCacheDir: MUSIC_API_CACHE_DIR,
          lyricCacheDir: MUSIC_LYRIC_CACHE_DIR,
        },
        runtimeOptions,
        settingsStore,
        webSocketHub,
      });
      publishOvertimeUpdate = broadcastOvertimeUpdate;
      bilibiliRuntime = createBilibiliRuntime({
        onRealtimeStatus: () => interactionSessionService?.sourceChanged(),
        getFanScope: runtimeOptions.getFanScope,
        settingsStore,
        domainServices,
        broadcastSnapshot,
        setActiveDanmakuRoom: (roomId) => danmakuFeedBuffer.setRoom(roomId),
        buildClient(roomId, context) {
          return buildBilibiliClient(roomId, {
            getFanScope: runtimeOptions.getFanScope,
            ...context,
            aiDanmakuDeliveryVerifier: aiRuntime.deliveryVerifier,
            domainServices,
            aiAssistant: aiRuntime.service,
            broadcastSnapshot,
            publishDanmaku,
            games: gameSessionService,
          });
        },
      });
      liveStatus = bilibiliRuntime.getLiveStatus();
      bilibiliDiagnostics = bilibiliRuntime.getDiagnostics();
      danmakuSender = bilibiliRuntime.getDanmakuSender();
      aiRuntime = buildAiRuntime({
        songDb: db.songDb,
        runtimeOptions,
        aiLogPath: AI_LOG_PATH,
        danmakuSender,
      });

      musicRuntime.setMusicRegistry(options.musicAuth || {});
      bilibiliRuntime.setAuthProvider(options.bilibiliAuth);
      domainServices.songs.ensureCategory('默认');
      domainServices.queue.clearOnStartup();
      runStartupRetention(settingsStore, domainServices.data);
      domainServices.overtimeGiftCatalog.start?.();
      reportPhase('startup-repair', Date.now() - phaseStartedAt);
      applicationInitialized = true;
    } catch (error) {
      await disposeApplication({ optimize: false });
      throw error;
    }
  }

  const giftRuntime = createGiftExportRuntime({ getServices: () => domainServices,
    getSettingsStore: () => settingsStore, broadcastSnapshot,
    getUserAvatar: (uid) => bilibiliRuntime.getUserAvatar(uid) });
  const createApiContext = createRuntimeApiContextFactory({
    giftCards: giftRuntime.giftCards,
    getDynamicLottery: () => dynamicLottery,
    maxBodyBytes: MAX_BODY_BYTES,
    defaultSettings: DEFAULT_SETTINGS,
    systemPaths: {
      rootDir: ROOT_DIR,
      dataDir: DATA_DIR,
      songDbPath: SONG_DB_PATH,
      superChatDbPath: SUPER_CHAT_DB_PATH,
      giftDbPath: GIFT_DB_PATH,
      musicDbPath: MUSIC_DB_PATH,
      checkinDbPath: CHECKIN_DB_PATH,
    },
    musicApiCacheDir: MUSIC_API_CACHE_DIR,
    musicLyricCacheDir: MUSIC_LYRIC_CACHE_DIR,
    getSessionToken: () => sessionToken,
    broadcastSnapshot,
    broadcastGiftEffectPreview: (payload) => webSocketHub.broadcast(payload),
    requestCloudSync,
    rebuildGiftProjection: giftRuntime.rebuildGiftProjection,
    clearRemoteGiftHistory: giftRuntime.clearRemoteGiftHistory,
    getDomainServices: () => domainServices,
    getMusicRuntime: () => musicRuntime,
    getBilibiliRuntime: () => bilibiliRuntime,
    getLiveStatus: () => liveStatus,
    getDanmakuSender: () => danmakuSender,
    getAiRuntime: () => aiRuntime,
    getGameSessionService: () => gameSessionService,
    getWheelSessionService: () => wheelSessionService,
    getInteractionSessionService: () => interactionSessionService,
    getSettingsStore: () => settingsStore,
    getState,
    shutdown: () => shutdownApplication({ exitProcess: true }),
  });

  const server = createHttpServer({
    host: HOST,
    startPort: START_PORT,
    rootDir: ROOT_DIR,
    dataDir: DATA_DIR,
    getPhase: () => phase,
    getStartedPort: () => startedPort,
    isLicenseAuthorized,
    inflightTracker,
    createApiContext,
    getSettings: () => settingsStore?.getSettings(),
    servePageOrAsset,
    getWebSocketContext,
    getWebSocketHub: () => webSocketHub,
  });

  function getLifecycleOptions(port, host) {
    return {
      port,
      host,
      rootDir: ROOT_DIR,
      dataDir: DATA_DIR,
      cleanupTimeoutMs: PORT_CLEANUP_TIMEOUT_MS,
      cleanupPollMs: PORT_CLEANUP_POLL_MS,
      sleep: sharedUtils.sleep,
      onPhase: runtimeOptions.onPhase,
    };
  }

  function startServer(options = {}) {
    if (startPromise) return startPromise;
    if (isShuttingDown)
      return Promise.reject(new Error('Server runtime is shutting down.'));

    const startPort =
      options.startPort === undefined ? START_PORT : Number(options.startPort);
    const host = validateServerHost(options.host || HOST);
    if (!Number.isInteger(startPort) || startPort < 0 || startPort > 65535) {
      return Promise.reject(
        new Error('startPort must be an integer between 0 and 65535.'),
      );
    }
    startPromise = (async () => {
      try {
        const reportPhase =
          typeof runtimeOptions.onPhase === 'function'
            ? runtimeOptions.onPhase
            : () => {};
        const markPhase = (name, startedAt, extra = {}) => {
          reportPhase(name, Date.now() - startedAt, extra);
        };
        await lifecycle.cleanupOwnPortOccupant(
          getLifecycleOptions(startPort, host),
        );
        if (isShuttingDown) throw new Error('Server runtime is shutting down.');
        let phaseStartedAt = Date.now();
        const port = await lifecycle.listenExactly(server, {
          port: startPort,
          host,
        });
        markPhase('listen', phaseStartedAt, { port });
        startedPort = port;
        phase = 'starting';
        if (isShuttingDown) throw new Error('Server runtime is shutting down.');
        phaseStartedAt = Date.now();
        await initializeApplication(options);
        markPhase('application-init', phaseStartedAt);
        if (isShuttingDown) throw new Error('Server runtime is shutting down.');
        sessionToken = crypto.randomUUID();
        lifecycle.writeSessionToken(DATA_DIR, sessionToken);
        lifecycle.writeRuntimeInfo(DATA_DIR, { pid: process.pid, port, host });
        const baseUrl = `http://${host}:${port}`;
        phase = 'ready';
        console.log(`Bilibili live song plugin is running at ${baseUrl}`);
        console.log(`Admin: ${baseUrl}/admin`);
        console.log(`Queue overlay: ${baseUrl}/queue`);
        console.log(`Songs overlay: ${baseUrl}/songlist`);
        console.log(`Blindbox overlay: ${baseUrl}/blindbox`);
        console.log(`Overtime overlay: ${baseUrl}/overtime`);
        console.log(`Danmaku overlay: ${baseUrl}/danmaku`);
        openAdminPageIfNeeded(baseUrl);
        if (isLicenseAuthorized()) {
          bilibiliRuntime.reconnect().catch((error) => {
            console.warn(
              `[Bilibili] startup reconnect failed: ${error.message}`,
            );
            bilibiliRuntime?.updateStatus({
              connected: false,
              enabled: true,
              roomId: sharedUtils.normalizeRoomInput(
                settingsStore.getSettings().roomId,
              ),
              mode: 'bilibili',
              message: sharedUtils.publicBilibiliErrorMessage(error, true),
            });
          });
        }
        return { server, port, host, baseUrl };
      } catch (error) {
        phase = 'quiescing';
        lifecycle.removeSessionToken(DATA_DIR, sessionToken);
        lifecycle.removeRuntimeInfo(DATA_DIR, {
          pid: process.pid,
          port: startedPort,
        });
        sessionToken = '';
        await disposeApplication({ optimize: false });
        await closeHttpServer();
        startedPort = null;
        phase = 'stopped';
        startPromise = null;
        throw error;
      }
    })();

    return startPromise;
  }

  function getState() {
    const songMetadata = domainServices.songs.getMetadata();
    return {
      queue: domainServices.queue.getSnapshot(),
      superChats: domainServices.superChats.getSnapshot(),
      gifts: domainServices.gifts.getSnapshot(),
      giftSprint: domainServices.gifts.getSprintSnapshot(),
      giftDetection: domainServices.gifts.getStatus(),
      blindBoxMapping: blindBoxMappingState,
      overtime: domainServices.overtime.getSnapshot(),
      settings: settingsStore.getSettings(),
      categories: songMetadata.categories,
      tags: songMetadata.tags,
      songCount: songMetadata.songCount,
      liveStatus,
      bilibiliDiagnostics,
      lyricState: musicRuntime.getLyricState(),
      lyricTimeline: musicRuntime.getLyricTimeline(),
      weSing: musicRuntime.weSingCapture.getStatus(),
      danmakuFeed: danmakuFeedBuffer ? danmakuFeedBuffer.getSnapshot() : [],
    };
  }

  function shutdownApplication(options = {}) {
    if (options.exitProcess === true) exitRequested = true;
    if (shutdownPromise) {
      if (phase === 'stopped') exitIfRequested();
      return shutdownPromise;
    }
    if (isShuttingDown) return Promise.resolve();
    isShuttingDown = true;
    phase = 'quiescing';
    inflightTracker.quiesce();
    console.log('Shutting down local song request service...');

    shutdownPromise = (async () => {
      if (startPromise) {
        try {
          await startPromise;
        } catch (_) {}
      }

      bilibiliRuntime?.stop();
      webSocketHub?.stop({
        shutdownPayload: { type: 'shutdown', reason: 'manual' },
      });

      // Flush renderer state before closing the server (e.g., save playback snapshot)
      if (preShutdownHook) {
        try {
          await preShutdownHook();
        } catch (error) {
          console.warn('Pre-shutdown hook failed:', error);
        }
      }

      await inflightTracker.drain();
      await disposeApplication({ optimize: true });
      await closeHttpServer();
      lifecycle.removeSessionToken(DATA_DIR, sessionToken);
      lifecycle.removeRuntimeInfo(DATA_DIR, {
        pid: process.pid,
        port: startedPort,
      });
      sessionToken = '';
      startedPort = null;
      phase = 'stopped';
      exitIfRequested();
    })();

    return shutdownPromise;
  }

  function exitIfRequested() {
    if (!exitRequested || exitIssued) return;
    exitIssued = true;
    process.exit(0);
  }

  async function disposeApplication(options = {}) {
    const steps = [
      ['Bilibili', () => bilibiliRuntime?.stop()],
      ['WebSocket', () => webSocketHub?.stop({
        shutdownPayload: { type: 'shutdown', reason: 'manual' },
      })],
      ['game', () => gameSessionService?.dispose()],
      ['interactions', () => interactionSessionService?.dispose()],
      ['wheel', () => wheelSessionService?.dispose()],
      ['lottery', () => dynamicLottery?.dispose()],
      ['AI drain', () => aiRuntime?.shutdown()],
      ['pending gift flush', () => domainServices?.gifts.dispose()],
      ['gift catalog', () => domainServices?.overtimeGiftCatalog.stop?.()],
      ['overtime', () => domainServices?.overtime.dispose()],
      ['WeSing', () => musicRuntime?.weSingCapture.stop()],
      ['database optimize', () => options.optimize === true && db && optimizeDatabases(db)],
      ['database close', () => db && closeDatabases(db)],
    ];
    for (const [name, dispose] of steps) {
      try {
        await dispose();
      } catch (error) {
        console.warn(`[Shutdown] ${name} failed:`, error.message);
      }
    }
    dynamicLottery = null;
    db = null;
    settingsStore = null;
    webSocketHub = null;
    giftEffectResolver = null;
    domainServices = null;
    giftSyncStore = null;
    musicRuntime = null;
    bilibiliRuntime = null;
    liveStatus = null;
    bilibiliDiagnostics = null;
    danmakuSender = null;
    danmakuFeedBuffer = null;
    aiRuntime = null;
    gameSessionService = null;
    interactionSessionService = null;
    wheelSessionService = null;
    applicationInitialized = false;
    publishOvertimeUpdate = () => {};
    giftRuntime.configureGiftSync(null);
  }

  function closeHttpServer() {
    if (!server.listening) return Promise.resolve();
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      server.close(finish);
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    });
  }

  /** Pre-shutdown hook called before server/db close. Allows Electron main to flush renderer state. */
  let preShutdownHook = null;
  function setPreShutdownHook(fn) {
    preShutdownHook = typeof fn === 'function' ? fn : null;
  }

  /** Persist playback snapshot directly (used by Electron main process via IPC). */
  function persistPlaybackSnapshot(payload, clientId) {
    if (!domainServices?.playback)
      return { ok: false, error: 'Playback store not ready' };
    try {
      return domainServices.playback.saveQueueState(payload, {
        clientId: clientId || 'default',
      });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function getSetting(key) {
    return settingsStore
      ? settingsStore.getSettings()[key]
      : DEFAULT_SETTINGS[key];
  }

  function requireGiftSyncStore() {
    if (!giftSyncStore) throw new Error('Gift sync store not ready.');
    return giftSyncStore;
  }

  function resolveGiftSource(sourceKey) {
    return requireGiftSyncStore().resolveSource(sourceKey);
  }

  function getGiftSyncState(sourceId) {
    return requireGiftSyncStore().getState(sourceId);
  }

  function commitGiftHistoryPage(page) {
    return requireGiftSyncStore().commitHistoryPage(page);
  }

  function restartGiftHistoryBootstrap(sourceId, projectionGeneration) {
    return requireGiftSyncStore().restartHistoryBootstrap(
      sourceId,
      projectionGeneration,
    );
  }

  function commitGiftCatchUpPage(page) {
    return requireGiftSyncStore().commitCatchUpPage(page);
  }

  function commitLegacyGiftPage(page) {
    return requireGiftSyncStore().commitLegacyPage(page);
  }

  function resetGiftProjectionForRebuild(sourceId) {
    return requireGiftSyncStore().resetProjectionForRebuild(sourceId);
  }

  function importProcessedGiftEvent(event, sourceId) {
    if (!domainServices?.gifts?.importProcessedEvent) {
      throw new Error('Gift service not ready.');
    }
    return domainServices.gifts.importProcessedEvent(event, sourceId);
  }

  function getCloudSettingsSnapshot() {
    if (!settingsStore) throw new Error('Settings store not ready.');
    return serializeCloudSettings(settingsStore.getSettings());
  }

  function prepareCloudRoomAccount(accountKey) {
    if (!settingsStore || !bilibiliRuntime) {
      throw new Error('Application runtime not ready.');
    }
    const changed = settingsStore.prepareCloudRoomAccount(accountKey);
    if (changed) {
      bilibiliRuntime.configure();
      broadcastSnapshot('cloud:settings');
    }
    return changed;
  }

  function applyCloudSettingsSnapshot(input) {
    if (!settingsStore || !bilibiliRuntime) {
      throw new Error('Application runtime not ready.');
    }
    settingsStore.setSettings(normalizeCloudSettingsSnapshot(input));
    bilibiliRuntime.configure();
    broadcastSnapshot('cloud:settings');
    return getCloudSettingsSnapshot();
  }

  function setBlindBoxMappingState(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      blindBoxMappingState = null;
      return;
    }
    blindBoxMappingState = Object.freeze({
      mode: input.mode === 'legacy' ? 'legacy' : 'v2',
      catalogVersion: String(input.catalogVersion || '') || null,
      settingsRevision: Math.max(0, Number(input.settingsRevision) || 0),
      customCount: Math.max(0, Number(input.customCount) || 0),
      takenOverCount: Math.max(0, Number(input.takenOverCount) || 0),
      migrationPendingCount: Math.max(
        0,
        Number(input.migrationPendingCount) || 0,
      ),
      applied: input.applied === true,
    });
  }

  function getCloudSongsSnapshot() {
    if (!domainServices) throw new Error('Song library not ready.');
    return domainServices.songs.list({});
  }

  function replaceCloudSongsSnapshot(songs) {
    if (!domainServices) throw new Error('Song library not ready.');
    const result = domainServices.songs.replaceCloud(songs);
    broadcastSnapshot('cloud:songs');
    return result;
  }

  function requestCloudSync(scope) {
    for (const listener of cloudSyncListeners) {
      try {
        listener(scope);
      } catch (error) {
        void error;
      }
    }
  }

  function onCloudSyncRequested(listener) {
    if (typeof listener !== 'function') return () => {};
    cloudSyncListeners.add(listener);
    return () => cloudSyncListeners.delete(listener);
  }

  function getGiftCatalogInitializationState() {
    return (
      domainServices?.overtimeGiftCatalog?.getInitializationState?.() || {
        status: 'required',
        phase: 'idle',
        percent: 0,
      }
    );
  }

  function initializeGiftCatalog(options = {}) {
    if (!domainServices?.overtimeGiftCatalog?.initializeGlobalCatalog)
      return Promise.reject(new Error('Gift catalog is not ready.'));
    return domainServices.overtimeGiftCatalog.initializeGlobalCatalog(options);
  }

  function isGiftCatalogInitialized() {
    return (
      domainServices?.overtimeGiftCatalog?.isGlobalCatalogInitialized?.() ===
      true
    );
  }

  function onGiftCatalogInitializationStateChanged(listener) {
    return (
      domainServices?.overtimeGiftCatalog?.onInitializationStateChanged?.(
        listener,
      ) || (() => {})
    );
  }

  return {
    start: startServer,
    stop: shutdownApplication,
    setPreShutdownHook,
    persistPlaybackSnapshot,
    resumeAuthorizedWork,
    pauseAuthorizedWork,
    resolveGiftSource,
    getGiftSyncState,
    commitGiftHistoryPage,
    restartGiftHistoryBootstrap,
    commitGiftCatchUpPage,
    commitLegacyGiftPage,
    resetGiftProjectionForRebuild,
    importProcessedGiftEvent,
    publishGiftEffect,
    getCloudSettingsSnapshot,
    prepareCloudRoomAccount,
    applyCloudSettingsSnapshot,
    setBlindBoxMappingState,
    getCloudSongsSnapshot,
    getPendingCloudSongs: (key) => domainServices.songs.getPendingCloudSongs(key),
    acknowledgePendingCloudSongs: (key, mutationId) =>
      domainServices.songs.acknowledgePendingCloudSongs(key, mutationId),
    replaceCloudSongsSnapshot,
    onCloudSyncRequested,
    getGiftCatalogInitializationState,
    initializeGiftCatalog,
    isGiftCatalogInitialized,
    onGiftCatalogInitializationStateChanged,
    getApiToken: () => sessionToken,
    getFanProfiles: () => domainServices?.fans,
    getDailyBotLegacy: () => domainServices?.dailyBotLegacy,
    ...giftRuntime,
    getSetting,
  };
}

const {
  getApiToken,
  persistPlaybackSnapshot,
  setPreShutdownHook,
  shutdownApplication,
  startServer,
} = createServerCompatibility(createServerRuntime);

if (require.main === module) {
  process.once('SIGINT', () => shutdownApplication());
  process.once('SIGTERM', () => shutdownApplication());
  process.once('SIGHUP', () => shutdownApplication());
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  createServerRuntime,
  startServer,
  shutdownApplication,
  setPreShutdownHook,
  persistPlaybackSnapshot,
  getApiToken,
};
