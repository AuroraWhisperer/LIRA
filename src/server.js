// 编写人：Aurora
'use strict';

const { createHttpServer } = require('./server/http-server');
const { createAuthorizedWorkController } = require('./server/authorized-work');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openAdminPageIfNeeded } = require('./server/admin-launcher');
const { createBilibiliClient: buildBilibiliClient } = require('./server/bilibili-client');
const { createBilibiliRuntime } = require('./server/bilibili-runtime');
const { buildMusicRuntime } = require('./server/music-runtime');
const { readNowPlayingConfig } = require('./server/now-playing-settings');
const { buildAiRuntime } = require('./server/ai-runtime');
const { createInflightTracker } = require('./server/inflight-tracker');
const { createServerCompatibility } = require('./server/compatibility-runtime');
const { createRuntimeApiContextFactory } = require('./server/runtime-api-context');
const { resolveServerRuntimeConfig, validateServerHost } = require('./server/runtime-config');
const { createRuntimeTransport } = require('./server/runtime-transport');
const { listGiftFrameTriggerStyleIds, migrateGiftFrameStyleTriggers } = require('./server/gift-frame-style-triggers');
const { createCloudSyncRuntime } = require('./server/cloud-sync-runtime');
const { createFontLibrary } = require('./fonts/font-library');
const { createResourceLibrary } = require('./resources/resource-library');
const { startRetentionMaintenance } = require('./server/startup-retention');
const { visitLocalAssetReferences } = require('./server/local-asset-references');
const lifecycle = require('./server/lifecycle');
const wsTransport = require('./server/ws');
const { createDomainServices } = require('./server/domain-services');
const { createSceneRuntime } = require('./server/scene-runtime');
const sharedUtils = require('./shared/utils');
const { resolveDataPaths } = require('./shared/data-paths');
const { normalizeRoomInput } = require('./bilibili/room-input');
const { publicBilibiliErrorMessage } = require('./bilibili/api-error');
const { createDatabases, optimizeDatabases, closeDatabases } = require('./storage/database');
const { createGiftSyncRuntime } = require('./server/gift-sync-runtime');
const { migrateCacheData } = require('./storage/data-directory-migration');
const { DEFAULT_SETTINGS } = require('./storage/settings-defaults');
const { bootstrapSettingsStore } = require('./storage/settings-store');
const giftEffectModule = require('./bilibili/gift/effect-config');
const { createGiftExportRuntime } = require('./server/gift-export-runtime');
const { createDanmakuFeedBuffer } = require('./bilibili/danmaku/feed-buffer');
const { createGameRuntime } = require('./server/game-runtime');
const { createWheelSessionService } = require('./games/wheel-session-service');
const { createDynamicLotteryRuntime } = require('./server/dynamic-lottery-runtime');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const START_PORT = 3000;
const PORT_CLEANUP_TIMEOUT_MS = 7500;
const PORT_CLEANUP_POLL_MS = 120;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const { createWorldClockTemperature } = require('./server/world-clock-temperature');

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
  let fontLibrary = null;
  let resourceLibrary = null;
  let worldClock = null;
  let sceneRuntime = null;
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
  let stopRetentionMaintenance = null;
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
  const inflightTracker = createInflightTracker();
  const licenseGate = runtimeOptions.licenseGate || {
    isAuthorized: () => true,
  };
  const isLicenseAuthorized = () =>
    typeof licenseGate.isAuthorized === 'function' ? licenseGate.isAuthorized() === true : true;
  const {
    getWebSocketContext,
    broadcastSnapshot,
    publishGiftFlushed,
    publishGiftCatalogUpdate,
    publishGiftEffect,
    publishDanmaku,
    publishSuperChatDelete,
    publishOvertimeUpdate: broadcastOvertimeUpdate,
    servePageOrAsset,
  } = createRuntimeTransport({
    publicDir: PUBLIC_DIR,
    getFontLibrary: () => fontLibrary,
    getResourceLibrary: () => resourceLibrary,
    defaultPort: START_PORT,
    getHost: () => HOST,
    getStartedPort: () => startedPort,
    getSessionToken: () => sessionToken,
    beginPlaybackSnapshotSession: () => domainServices.playback.beginQueueStateSession(),
    getClientTheme: runtimeOptions.getClientTheme,
    getWebSocketHub: () => webSocketHub,
    getState,
    getSettings: () => settingsStore.getSettings(),
    getDanmakuFeedBuffer: () => danmakuFeedBuffer,
    resolveGiftEffect: (giftId) => domainServices.gifts.resolveEffect(giftId),
    resolveGiftMotionArtwork: item => domainServices.overtimeGiftCatalog.getArtworkResolver()(item.gift_variant_id || String(item.gift_id)),
    getGiftFrameStyleIds: () => listGiftFrameTriggerStyleIds(DATA_DIR),
    publishSceneGift: (payload) => sceneRuntime?.receiveGift(payload),
    notifySceneOutput: (change) => sceneRuntime?.notify(change),
  });
  const { resumeAuthorizedWork, pauseAuthorizedWork } = createAuthorizedWorkController({
    isLicenseAuthorized,
    getBilibiliRuntime: () => bilibiliRuntime,
    getOvertimeGiftCatalog: () => domainServices?.overtimeGiftCatalog,
  });
  const cloudSync = createCloudSyncRuntime({
    getSettingsStore: () => settingsStore,
    getBilibiliRuntime: () => bilibiliRuntime,
    getAiConfig: () => aiRuntime?.configStore.getConfig(),
    getGameSession: () => gameSessionService?.getMenuState(),
    getInteractionSession: () => interactionSessionService?.getState().session,
    getSongs: () => domainServices?.songs,
    getCustomReplies: () => domainServices?.customReplies,
    isActive: () => applicationInitialized && !isShuttingDown,
    broadcastSnapshot,
  });
  const giftSyncRuntime = createGiftSyncRuntime();

  function startBackgroundMaintenance() {
    if (isShuttingDown || stopRetentionMaintenance || !domainServices) return;
    giftSyncRuntime.startMaintenance();
    stopRetentionMaintenance = startRetentionMaintenance(settingsStore, domainServices.data,
      () => giftSyncRuntime.requestMaintenance());
  }

  async function initializeApplication(options = {}) {
    if (applicationInitialized) return;
    try {
      giftRuntime.configureGiftSync(options.giftSync);
      const reportPhase = typeof runtimeOptions.onPhase === 'function' ? runtimeOptions.onPhase : () => {};
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
      resourceLibrary = createResourceLibrary({ dataDir: DATA_DIR, publicDir: PUBLIC_DIR,
        fetch: runtimeOptions.resourceFetch || runtimeOptions.fontFetch, cdnBaseUrl: runtimeOptions.resourceCdnBase });
      fontLibrary = createFontLibrary({ dataDir: DATA_DIR, publicDir: PUBLIC_DIR, resources: resourceLibrary });
      worldClock = createWorldClockTemperature({ fetch: runtimeOptions.worldClockFetch });
      reportPhase('database-init', Date.now() - phaseStartedAt);
      phaseStartedAt = Date.now();
      settingsStore = bootstrapSettingsStore(db.songDb);
      migrateGiftFrameStyleTriggers(settingsStore, DATA_DIR);
      webSocketHub = wsTransport.createWebSocketHub();
      danmakuFeedBuffer = createDanmakuFeedBuffer({
        resolveGiftImagePath: (...args) => domainServices?.overtimeGiftCatalog?.resolveGiftImagePath?.(...args),
      });
      ({ games: gameSessionService, interactions: interactionSessionService } = createGameRuntime({
        broadcast: (payload) => {
          webSocketHub.broadcast(payload);
          if (['game:update', 'game:draw', 'game:patch'].includes(payload.type)) sceneRuntime?.notify({ types: ['games'] });
          if (payload.type === 'interaction:update') sceneRuntime?.notify({ types: ['interactions'] });
          if (['game:update', 'game:patch', 'interaction:update'].includes(payload.type)) cloudSync.scheduleMenuSync();
        },
        getSourceState: () => bilibiliRuntime.getRealtimeState(),
        subscribe: (listener) => bilibiliRuntime.subscribeRealtime(listener),
      }));
      wheelSessionService = createWheelSessionService({
        broadcast: (payload) => {
          webSocketHub.broadcast(payload);
          sceneRuntime?.notify({ types: ['wheel'] });
        },
      });
      giftEffectResolver = giftEffectModule.createGiftEffectResolver();
      domainServices = createDomainServices({
        runGiftMaintenance: operation => giftSyncRuntime.runLocalMaintenance(operation),
        db,
        visitAssetReferences: visit => visitLocalAssetReferences({
          system: { dataDir: DATA_DIR }, scenes: sceneRuntime?.service,
          componentPreviews: server, settings: { get: settingsStore.getSettings },
        }, visit),
        getFanScope: runtimeOptions.getFanScope,
        getSceneOwner: runtimeOptions.getSceneOwner,
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
        onGiftFlushed: (item) => {
          publishGiftFlushed(item);
          options.onGiftFlushed?.(item);
        },
        onOvertimeUpdate: (update) => publishOvertimeUpdate(update),
      });
      const displayPorts = {
        giftImages: domainServices.overtimeGiftCatalog.imageResources,
        bilibili: { getRoomProfile: (options) => bilibiliRuntime.getRoomProfile(options) },
        settings: { get: settingsStore.getSettings, getRoomRevision: settingsStore.getRoomRevision },
        system: { dataDir: DATA_DIR, getState },
        songs: { list: domainServices.songs.list, getChangeToken: domainServices.songs.getChangeToken },
        gifts: {
          getViewRevision: () => domainServices.gifts.getViewRevision(),
          getHistory: (options) => domainServices.gifts.getHistory(options),
          getBlindBoxStats: domainServices.gifts.getBlindBoxStats,
          getBlindBoxChangeToken: domainServices.gifts.getBlindBoxChangeToken,
        },
        giftCards: { getProfiles: giftRuntime.giftCards.getProfiles },
        giftWishes: { getSnapshot: domainServices.giftWishes.getSnapshot },
        heartBoxCollection: { getSnapshot: domainServices.heartBoxCollection.getSnapshot },
        games: { getSession: gameSessionService.getSession, getDisplaySession: gameSessionService.getDisplaySession },
        wheel: { getState: wheelSessionService.getState },
        interactions: { getState: interactionSessionService.getState },
        overtime: {
          getGlobalGiftCatalog: typeof domainServices.overtimeGiftCatalog.getGlobalSnapshot === 'function'
            ? domainServices.overtimeGiftCatalog.getGlobalSnapshot
            : () => null,
        },
      };
      sceneRuntime = createSceneRuntime({ songDb: db.songDb, runtimeOptions, displayPorts });
      giftSyncRuntime.initialize({
        giftDb: db.giftDb,
        getActiveSource: () => domainServices.gifts.getActiveSource(),
        automaticEnabled: () => !isShuttingDown && isLicenseAuthorized() && settingsStore.getSettings().autoRetentionOnStartup === 'true',
        importHistoryRecord: (record, sourceId) => domainServices.gifts.importProcessedHistoryRecord(record, sourceId),
        importLiveEvent: (event, sourceId, importOptions) =>
          domainServices.gifts.importProcessedEvent(event, sourceId, importOptions),
      });
      musicRuntime = buildMusicRuntime({
        dataDir: {
          logDir: resolveDataPaths(DATA_DIR).logDir,
          apiCacheDir: MUSIC_API_CACHE_DIR,
          lyricCacheDir: MUSIC_LYRIC_CACHE_DIR,
        },
        runtimeOptions,
        settingsStore,
        webSocketHub,
        onLyricsChanged: () => sceneRuntime?.notify({ types: ['lyrics'] }),
        onNowPlayingChanged: () => sceneRuntime?.notify({ types: ['now-playing'] }),
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
            publishSuperChatDelete,
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
        onConfigUpdated: cloudSync.scheduleMenuSync,
      });

      musicRuntime.setMusicRegistry(options.musicAuth || {});
      if (runtimeOptions.nativeMusicCapture === true) await musicRuntime.start();
      bilibiliRuntime.setAuthProvider(options.bilibiliAuth);
      domainServices.songs.ensureCategory('默认');
      domainServices.queue.ensureUnified();
      if (!options.deferMaintenance) startBackgroundMaintenance();
      domainServices.overtimeGiftCatalog.start?.();
      reportPhase('startup-repair', Date.now() - phaseStartedAt);
      applicationInitialized = true;
      cloudSync.initializeMenuSync();
    } catch (error) {
      await disposeApplication({ optimize: false });
      throw error;
    }
  }

  const giftRuntime = createGiftExportRuntime({
    getServices: () => domainServices,
    getSettingsStore: () => settingsStore,
    broadcastSnapshot,
    getUserAvatar: (uid) => bilibiliRuntime.getUserAvatar(uid),
  });
  const createApiContext = createRuntimeApiContextFactory({
    getWorldClock: () => worldClock,
    giftCards: giftRuntime.giftCards,
    getDynamicLottery: () => dynamicLottery,
    maxBodyBytes: MAX_BODY_BYTES,
    defaultSettings: DEFAULT_SETTINGS,
    systemPaths: {
      rootDir: ROOT_DIR,
      pickComponentWebFile: runtimeOptions.pickComponentWebFile,
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
    broadcastGiftEffectPreview: (payload) => { webSocketHub.broadcast(payload); sceneRuntime?.receiveGift(payload); },
    requestCloudSync: cloudSync.requestCloudSync,
    rebuildGiftProjection: giftRuntime.rebuildGiftProjection,
    clearRemoteGiftHistory: giftRuntime.clearRemoteGiftHistory,
    getDomainServices: () => domainServices,
    getScenes: () => sceneRuntime?.service,
    getLiveRankings: () => sceneRuntime?.liveRankings,
    getSceneEvents: () => sceneRuntime?.events,
    getDanmakuDisplay: () => sceneRuntime?.readDanmakuDisplay,
    getDanmakuAppearance: () => sceneRuntime?.appearance,
    getDanmakuEvents: () => sceneRuntime?.danmakuEvents,
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
    getRequestOwner: runtimeOptions.getSceneOwner,
    getPreviewOwner: runtimeOptions.getPreviewOwner || runtimeOptions.getSceneOwner,
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
    ensureGiftImage: imagePath => isLicenseAuthorized()
      ? domainServices?.overtimeGiftCatalog?.imageResources?.ensureImage(imagePath) : '',
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
    if (isShuttingDown) return Promise.reject(new Error('Server runtime is shutting down.'));

    const startPort = options.startPort === undefined ? START_PORT : Number(options.startPort);
    const host = validateServerHost(options.host || HOST);
    if (!Number.isInteger(startPort) || startPort < 0 || startPort > 65535) {
      return Promise.reject(new Error('startPort must be an integer between 0 and 65535.'));
    }
    startPromise = (async () => {
      try {
        const reportPhase = typeof runtimeOptions.onPhase === 'function' ? runtimeOptions.onPhase : () => {};
        const markPhase = (name, startedAt, extra = {}) => {
          reportPhase(name, Date.now() - startedAt, extra);
        };
        await lifecycle.cleanupOwnPortOccupant(getLifecycleOptions(startPort, host));
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
            console.warn(`[Bilibili] startup reconnect failed: ${error.message}`);
            bilibiliRuntime?.updateStatus({
              connected: false,
              enabled: true,
              roomId: normalizeRoomInput(settingsStore.getSettings().roomId),
              mode: 'bilibili',
              message: publicBilibiliErrorMessage(error, true),
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

  function getState(fields, { exclude = [] } = {}) {
    let songMetadata;
    const readSongMetadata = () => songMetadata ??= domainServices.songs.getMetadata();
    const readers = {
      queue: () => domainServices.queue.getSnapshot(),
      superChats: () => domainServices.superChats.getSnapshot(),
      gifts: () => domainServices.gifts.getSnapshot(),
      giftSprint: () => domainServices.gifts.getSprintSnapshot(),
      giftDetection: () => domainServices.gifts.getStatus(),
      blindBoxMapping: cloudSync.getBlindBoxMappingState,
      overtime: () => domainServices.overtime.getSnapshot(),
      settings: () => settingsStore.getSettings(),
      categories: () => readSongMetadata().categories,
      tags: () => readSongMetadata().tags,
      songCount: () => readSongMetadata().songCount,
      liveStatus: () => liveStatus,
      roomGuard: () => bilibiliRuntime.getRoomGuardState(),
      bilibiliDiagnostics: () => bilibiliDiagnostics,
      lyricState: () => musicRuntime.getLyricState(),
      lyricTimeline: () => musicRuntime.getLyricTimeline(),
      nowPlaying: () => musicRuntime.getNowPlayingState(),
      nowPlayingConfig: () => readNowPlayingConfig(settingsStore.getSettings()),
      lyricSource: () => musicRuntime.getLyricSource(),
      weSing: () => musicRuntime.weSingCapture.getStatus(),
      danmakuFeed: () => danmakuFeedBuffer ? danmakuFeedBuffer.getSnapshot() : [],
    };
    return Object.fromEntries((fields ?? Object.keys(readers)).filter(field => !exclude.includes(field))
      .map((field) => [field, readers[field]()]));
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
    stopRetentionMaintenance?.();
    stopRetentionMaintenance = null;
    void giftSyncRuntime.stopMaintenance();
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
      sceneRuntime?.dispose();

      // Flush renderer state before closing the server (e.g., save playback snapshot)
      if (preShutdownHook) {
        try {
          await preShutdownHook();
        } catch (error) {
          console.warn('Pre-shutdown hook failed:', error);
        }
      }

      musicRuntime?.weSingCapture.cancelDiagnostics();
      await resourceLibrary?.close();
      await fontLibrary?.close();
      await worldClock?.close();
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
      ['resources', () => resourceLibrary?.close()],
      ['fonts', () => fontLibrary?.close()],
      ['world clock', () => worldClock?.close()],
      ['retention', () => stopRetentionMaintenance?.()],
      ['gift retention', () => giftSyncRuntime.stopMaintenance()],
      ['Bilibili', () => bilibiliRuntime?.stop()],
      ['scene events', () => sceneRuntime?.dispose()],
      [
        'WebSocket',
        () =>
          webSocketHub?.stop({
            shutdownPayload: { type: 'shutdown', reason: 'manual' },
          }),
      ],
      ['game', () => gameSessionService?.dispose()],
      ['interactions', () => interactionSessionService?.dispose()],
      ['wheel', () => wheelSessionService?.dispose()],
      ['lottery', () => dynamicLottery?.dispose()],
      ['AI drain', () => aiRuntime?.shutdown()],
      ['pending gift flush', () => domainServices?.gifts.dispose()],
      ['SC undo', () => domainServices?.superChats.dispose()],
      ['gift catalog', () => {
        domainServices?.overtimeGiftCatalog.stop?.();
        return domainServices?.overtimeGiftCatalog.dispose?.();
      }],
      ['overtime', () => domainServices?.overtime.dispose()],
      ['Music capture', () => musicRuntime?.stop()],
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
    stopRetentionMaintenance = null;
    db = null;
    settingsStore = null;
    webSocketHub = null;
    giftEffectResolver = null;
    domainServices = null;
    fontLibrary = null;
    resourceLibrary = null;
    worldClock = null;
    sceneRuntime = null;
    giftSyncRuntime.dispose();
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
    if (!domainServices?.playback) return { ok: false, error: 'Playback store not ready' };
    try {
      return domainServices.playback.saveQueueState(payload, {
        clientId: clientId || 'default',
      });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function getSetting(key) {
    return settingsStore ? settingsStore.getSettings()[key] : DEFAULT_SETTINGS[key];
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
    return domainServices?.overtimeGiftCatalog?.isGlobalCatalogInitialized?.() === true;
  }

  function onGiftCatalogInitializationStateChanged(listener) {
    return domainServices?.overtimeGiftCatalog?.onInitializationStateChanged?.(listener) || (() => {});
  }

  return {
    start: startServer,
    stop: shutdownApplication,
    initializeFontLibrary: options => fontLibrary?.initialize(options),
    getFontLibraryState: () => fontLibrary?.getState() || { status: 'idle' },
    onFontLibraryStateChanged: listener => fontLibrary?.onStateChanged(listener) || (() => {}),
    setPreShutdownHook,
    persistPlaybackSnapshot,
    resumeAuthorizedWork,
    startBackgroundMaintenance,
    pauseAuthorizedWork,
    ...giftSyncRuntime.operations,
    publishGiftEffect,
    getCloudSettingsSnapshot: cloudSync.getCloudSettingsSnapshot,
    acceptCloudSettingsAccount: cloudSync.acceptCloudSettingsAccount,
    getPendingCloudSettings: cloudSync.getPendingCloudSettings,
    acknowledgePendingCloudSettings: cloudSync.acknowledgePendingCloudSettings,
    capturePendingCloudBilibiliLogout: cloudSync.capturePendingCloudBilibiliLogout,
    getPendingCloudBilibiliLogout: cloudSync.getPendingCloudBilibiliLogout,
    acknowledgePendingCloudBilibiliLogout: cloudSync.acknowledgePendingCloudBilibiliLogout,
    prepareCloudRoomAccount: cloudSync.prepareCloudRoomAccount,
    applyCloudSettingsSnapshot: cloudSync.applyCloudSettingsSnapshot,
    applyCloudFixedReplySettingsSnapshot: cloudSync.applyCloudFixedReplySettingsSnapshot,
    setBlindBoxMappingState: cloudSync.setBlindBoxMappingState,
    getCloudSongsSnapshot: cloudSync.getCloudSongsSnapshot,
    acceptCloudSongsAccount: cloudSync.acceptCloudSongsAccount,
    hasPendingCloudSongs: cloudSync.hasPendingCloudSongs,
    getPendingCloudSongs: cloudSync.getPendingCloudSongs,
    acknowledgePendingCloudSongs: cloudSync.acknowledgePendingCloudSongs,
    replaceCloudSongsSnapshot: cloudSync.replaceCloudSongsSnapshot,
    onCloudSyncRequested: cloudSync.onCloudSyncRequested,
    getGiftCatalogInitializationState,
    initializeGiftCatalog,
    isGiftCatalogInitialized,
    onGiftCatalogInitializationStateChanged,
    getApiToken: () => sessionToken,
    getFanProfiles: () => domainServices?.fans,
    receiveSceneCloud: (update) => sceneRuntime?.receiveCloud(update),
    receiveSceneCloudSettings: (update) => sceneRuntime?.receiveCloudSettings(update),
    subscribeSceneCloudDemand: (listener) => sceneRuntime.subscribeCloudDemand(listener),
    getDailyBotLegacy: () => domainServices?.dailyBotLegacy,
    ...giftRuntime,
    getSetting,
  };
}

const { getApiToken, persistPlaybackSnapshot, setPreShutdownHook, shutdownApplication, startServer } =
  createServerCompatibility(createServerRuntime);

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
