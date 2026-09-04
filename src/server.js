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
const { DEFAULT_SETTINGS } = require('./storage/settings-defaults');
const { prepareSettingsBootstrap } = require('./server/settings-bootstrap');
const giftService = require('./bilibili/gift');
const {
  normalizeGiftBlindBoxConfig,
} = require('./bilibili/gift/blind-box-config');
const giftEffectModule = require('./bilibili/gift/effect-config');
const giftFrameModule = require('./bilibili/gift/frame-config');
const { createDanmakuFeedBuffer } = require('./bilibili/danmaku/feed-buffer');
const { createGameSessionService } = require('./games/game-session-service');
const { createWheelSessionService } = require('./games/wheel-session-service');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const START_PORT = 3000;
const PORT_CLEANUP_TIMEOUT_MS = 7500;
const PORT_CLEANUP_POLL_MS = 120;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const LOCAL_GIFT_DETECTION_ENABLED = false;
const CLOUD_SETTING_KEYS = [
  'roomId',
  'enableBilibili',
  'paused',
  'queueLimit',
  'userCooldownSeconds',
  'onlyFromLibrary',
  'allowDuplicate',
];

function normalizeCloudBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  throw new Error('云端同步设置包含无效布尔值。');
}

function normalizeCloudInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error('云端同步设置包含无效整数。');
  }
  return number;
}

function normalizeCloudSettingsSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('云端同步设置格式无效。');
  }
  for (const key of CLOUD_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error(`云端同步设置缺少 ${key}。`);
    }
  }
  const rawRoomId = String(input.roomId || '').trim();
  const roomId = sharedUtils.normalizeRoomInput(rawRoomId);
  if (rawRoomId && !roomId) throw new Error('云端直播间号无效。');
  const settings = {
    roomId,
    enableBilibili: normalizeCloudBoolean(input.enableBilibili),
    paused: normalizeCloudBoolean(input.paused),
    queueLimit: normalizeCloudInteger(input.queueLimit, 1, 300),
    userCooldownSeconds: normalizeCloudInteger(
      input.userCooldownSeconds,
      0,
      3600,
    ),
    onlyFromLibrary: normalizeCloudBoolean(input.onlyFromLibrary),
    allowDuplicate: normalizeCloudBoolean(input.allowDuplicate),
  };
  if (Object.prototype.hasOwnProperty.call(input, 'giftBlindBoxConfig')) {
    settings.giftBlindBoxConfig = normalizeGiftBlindBoxConfig(
      input.giftBlindBoxConfig,
    );
  }
  return settings;
}

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
  let applicationInitialized = false;
  let publishOvertimeUpdate = () => {};
  let isShuttingDown = false;
  let phase = 'stopped';
  let startedPort = null;
  let startPromise = null;
  let shutdownPromise = null;
  let sessionToken = '';
  let rebuildGiftProjection = () => false;
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
    logGiftDelivery,
    servePageOrAsset,
  } = createRuntimeTransport({
    publicDir: PUBLIC_DIR,
    defaultPort: START_PORT,
    getHost: () => HOST,
    getStartedPort: () => startedPort,
    getSessionToken: () => sessionToken,
    getWebSocketHub: () => webSocketHub,
    getState,
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
      rebuildGiftProjection =
        typeof options.giftSync?.rebuild === 'function'
          ? options.giftSync.rebuild
          : () => false;
      const reportPhase =
        typeof runtimeOptions.onPhase === 'function'
          ? runtimeOptions.onPhase
          : () => {};
      let phaseStartedAt = Date.now();
      db = createDatabases({
        dataDir: DATA_DIR,
        defaultSettings: DEFAULT_SETTINGS,
      });
      fs.mkdirSync(OPENING_MUSIC_DIR, { recursive: true });
      reportPhase('database-init', Date.now() - phaseStartedAt);
      phaseStartedAt = Date.now();
      const settingsBootstrap = prepareSettingsBootstrap(db.songDb);
      settingsStore = settingsBootstrap.settingsStore;
      webSocketHub = wsTransport.createWebSocketHub();
      danmakuFeedBuffer = createDanmakuFeedBuffer();
      gameSessionService = createGameSessionService({
        broadcast: (payload) => webSocketHub.broadcast(payload),
      });
      wheelSessionService = createWheelSessionService({
        broadcast: (payload) => webSocketHub.broadcast(payload),
      });
      giftEffectResolver = giftEffectModule.createGiftEffectResolver();
      domainServices = createDomainServices({
        db,
        settingsStore,
        dataDir: DATA_DIR,
        publicDir: runtimeOptions.giftSalePublicDir || PUBLIC_DIR,
        giftSaleGetRoomId: runtimeOptions.giftSaleGetRoomId,
        giftSaleGetBlindBoxConfig: runtimeOptions.giftSaleGetBlindBoxConfig,
        giftSaleFetchJson: runtimeOptions.giftSaleFetchJson,
        giftSaleGetCookieHeader:
          runtimeOptions.giftSaleGetCookieHeader ||
          options.bilibiliAuth?.getCookieHeader,
        remoteGiftCatalog:
          typeof options.remoteGiftCatalog?.fetch === 'function'
            ? {
                ...options.remoteGiftCatalog,
                onUpdated: (snapshot) => {
                  if (webSocketHub)
                    webSocketHub.broadcast({
                      type: 'gift-catalog:update',
                      snapshot,
                    });
                  options.remoteGiftCatalog.onUpdated?.(snapshot);
                },
              }
            : null,
        giftEffectResolver,
        onGiftFlushed: (item) => {
          logGiftDelivery('final', item);
          broadcastSnapshot('bilibili:gift');
          const frameEvent = giftFrameModule.buildGiftFrameEvent(
            item,
            settingsStore.getSettings(),
          );
          if (frameEvent && webSocketHub) webSocketHub.broadcast(frameEvent);
        },
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
      publishOvertimeUpdate = (update) =>
        webSocketHub.broadcast({
          type: 'overtime:update',
          reason: update.reason,
          state: update.state,
          ...(update.adjustment ? { adjustment: update.adjustment } : {}),
        });
      bilibiliRuntime = createBilibiliRuntime({
        settingsStore,
        domainServices,
        broadcastSnapshot,
        setActiveDanmakuRoom: (roomId) => danmakuFeedBuffer.setRoom(roomId),
        buildClient(roomId, context) {
          return buildBilibiliClient(roomId, {
            ...context,
            giftDetectionEnabled: LOCAL_GIFT_DETECTION_ENABLED,
            aiDanmakuDeliveryVerifier: aiRuntime.deliveryVerifier,
            domainServices,
            aiAssistant: aiRuntime.service,
            broadcastSnapshot,
            publishDanmaku(danmaku) {
              const item = danmakuFeedBuffer.push(danmaku);
              if (item && webSocketHub) {
                webSocketHub.broadcast(
                  { type: 'danmaku:message', item },
                  { topic: 'danmaku' },
                );
              }
            },
            logGiftDelivery,
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
      giftService.repairGiftV2Events({ db });
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

  const createApiContext = createRuntimeApiContextFactory({
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
    rebuildGiftProjection: () => rebuildGiftProjection(),
    getDomainServices: () => domainServices,
    getMusicRuntime: () => musicRuntime,
    getBilibiliRuntime: () => bilibiliRuntime,
    getLiveStatus: () => liveStatus,
    getDanmakuSender: () => danmakuSender,
    getAiRuntime: () => aiRuntime,
    getGameSessionService: () => gameSessionService,
    getWheelSessionService: () => wheelSessionService,
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
    return {
      queue: domainServices.queue.getSnapshot(),
      superChats: domainServices.superChats.getSnapshot(),
      gifts: domainServices.gifts.getSnapshot(),
      giftSprint: domainServices.gifts.getSprintSnapshot(),
      giftDetection: domainServices.gifts.getStatus(),
      overtime: domainServices.overtime.getSnapshot(),
      settings: settingsStore.getSettings(),
      categories: domainServices.songs.listCategories(),
      tags: domainServices.songs.listTags(),
      songCount: domainServices.songs.count(),
      liveStatus,
      bilibiliDiagnostics,
      lyricState: musicRuntime.getLyricState(),
      lyricTimeline: musicRuntime.getLyricTimeline(),
      weSing: musicRuntime.weSingCapture.getStatus(),
      danmakuFeed: danmakuFeedBuffer ? danmakuFeedBuffer.getSnapshot() : [],
    };
  }

  function shutdownApplication(options = {}) {
    const exitProcess = options.exitProcess === true;
    if (shutdownPromise) return shutdownPromise;
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
      if (exitProcess) process.exit(0);
    })();

    return shutdownPromise;
  }

  async function disposeApplication(options = {}) {
    bilibiliRuntime?.stop();
    webSocketHub?.stop({
      shutdownPayload: { type: 'shutdown', reason: 'manual' },
    });
    gameSessionService?.dispose();
    if (aiRuntime) {
      try {
        await aiRuntime.shutdown();
      } catch (error) {
        console.warn('[Shutdown] AI drain failed:', error.message);
      }
    }
    if (domainServices) {
      try {
        domainServices.gifts.dispose();
      } catch (error) {
        console.warn('[Shutdown] pending gift flush failed:', error.message);
      }
      domainServices.overtimeGiftCatalog.stop?.();
      domainServices.overtime.dispose();
    }
    musicRuntime?.weSingCapture.stop();
    if (db) {
      if (options.optimize === true) optimizeDatabases(db);
      closeDatabases(db);
    }

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
    wheelSessionService = null;
    applicationInitialized = false;
    publishOvertimeUpdate = () => {};
    rebuildGiftProjection = () => false;
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

  function setActiveGiftSource(source) {
    if (!domainServices?.gifts) throw new Error('Gift service not ready.');
    return domainServices.gifts.setActiveSource(source);
  }

  function importProcessedGiftEvent(event, sourceId) {
    if (!domainServices?.gifts?.importProcessedEvent) {
      throw new Error('Gift service not ready.');
    }
    return domainServices.gifts.importProcessedEvent(event, sourceId);
  }

  function getCloudSettingsSnapshot() {
    if (!settingsStore) throw new Error('Settings store not ready.');
    const settings = settingsStore.getSettings();
    return {
      roomId: sharedUtils.normalizeRoomInput(settings.roomId),
      enableBilibili: settings.enableBilibili === 'true',
      paused: settings.paused === 'true',
      queueLimit: Number(settings.queueLimit),
      userCooldownSeconds: Number(settings.userCooldownSeconds),
      onlyFromLibrary: settings.onlyFromLibrary === 'true',
      allowDuplicate: settings.allowDuplicate === 'true',
      giftBlindBoxConfig: normalizeGiftBlindBoxConfig(
        JSON.parse(settings.giftBlindBoxConfig),
      ),
    };
  }

  function applyCloudSettingsSnapshot(input) {
    if (!settingsStore || !bilibiliRuntime) {
      throw new Error('Application runtime not ready.');
    }
    const settings = normalizeCloudSettingsSnapshot(input);
    for (const [key, value] of Object.entries(settings)) {
      settingsStore.setSetting(
        key,
        key === 'giftBlindBoxConfig' ? JSON.stringify(value) : String(value),
      );
    }
    bilibiliRuntime.configure();
    broadcastSnapshot('cloud:settings');
    return getCloudSettingsSnapshot();
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
    setActiveGiftSource,
    importProcessedGiftEvent,
    getCloudSettingsSnapshot,
    applyCloudSettingsSnapshot,
    getCloudSongsSnapshot,
    replaceCloudSongsSnapshot,
    onCloudSyncRequested,
    getApiToken: () => sessionToken,
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
