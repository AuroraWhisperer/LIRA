// 编写人：Aurora
'use strict';

const http = require('node:http');
const path = require('node:path');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const apiRoutes = require('./server/api-routes');
const { createApiContext: buildApiContext } = require('./server/api-context');
const { createBilibiliClient: buildBilibiliClient } = require('./server/bilibili-client');
const { createBilibiliRuntime } = require('./server/bilibili-runtime');
const { buildMusicRuntime } = require('./server/music-runtime');
const { buildAiRuntime } = require('./server/ai-runtime');
const { createInflightTracker } = require('./server/inflight-tracker');
const { createServerCompatibility } = require('./server/compatibility-runtime');
const httpUtils = require('./server/http-utils');
const lifecycle = require('./server/lifecycle');
const wsTransport = require('./server/ws');
const { createDomainServices } = require('./server/domain-services');
const sharedUtils = require('./shared/utils');
const { createDatabases, optimizeDatabases, closeDatabases } = require('./storage/database');
const settingsStoreModule = require('./storage/settings-store');
const { prepareSettingsBootstrap } = require('./server/settings-bootstrap');
const giftService = require('./bilibili/gift');
const giftEffectModule = require('./bilibili/gift/effect-config');
const { createGameSessionService } = require('./games/game-session-service');
const { createWheelSessionService } = require('./games/wheel-session-service');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const START_PORT = 3000;
const PORT_CLEANUP_TIMEOUT_MS = 7500;
const PORT_CLEANUP_POLL_MS = 120;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_SETTINGS = settingsStoreModule.DEFAULT_SETTINGS;

function normalizeServerHost(host) {
  const value = String(host || '').trim();
  return !value || value.toLowerCase() === 'localhost' ? '127.0.0.1' : value;
}

function validateServerHost(host) {
  const normalized = normalizeServerHost(host);
  if (normalized !== '127.0.0.1') {
    throw new Error(
      `Host must be '127.0.0.1' or 'localhost' (got '${host}'). ` +
      `Remote binding (0.0.0.0, LAN addresses) is not supported for security.`
    );
  }
  return normalized;
}

function createServerRuntime(runtimeOptions = {}) {
  // Validate host before any filesystem/database side effects
  const HOST = validateServerHost(runtimeOptions.host || process.env.HOST);

  const DATA_DIR = runtimeOptions.dataDir
    ? path.resolve(runtimeOptions.dataDir)
    : process.env.SONG_PLUGIN_DATA_DIR
      ? path.resolve(process.env.SONG_PLUGIN_DATA_DIR)
      : path.join(ROOT_DIR, 'data');
  const SONG_DB_PATH = path.join(DATA_DIR, 'song-request-data.db');
  const SUPER_CHAT_DB_PATH = path.join(DATA_DIR, 'super-chat-data.db');
  const GIFT_DB_PATH = path.join(DATA_DIR, 'gift-data.db');
  const MUSIC_DB_PATH = path.join(DATA_DIR, 'music-data.db');
  const CHECKIN_DB_PATH = path.join(DATA_DIR, 'checkin-data.db');
  const MUSIC_API_CACHE_DIR = path.join(DATA_DIR, 'music-api-cache');
  const MUSIC_LYRIC_CACHE_DIR = path.join(DATA_DIR, 'music-lyrics-cache');
  const AI_LOG_PATH = path.join(path.dirname(DATA_DIR), 'logs', 'ai.log');

  let db = null;
  let settingsStore = null;
  let webSocketHub = null;
  let giftEffectResolver = null;
  let domainServices = null;
  let musicRuntime = null;
  let bilibiliRuntime = null;
  let liveStatus = null;
  let bilibiliDiagnostics = null;
  let messageBuffer = null;
  let danmakuSender = null;
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
  const inflightTracker = createInflightTracker();

  async function initializeApplication(options = {}) {
    if (applicationInitialized) return;
    try {
      db = createDatabases({ dataDir: DATA_DIR, defaultSettings: DEFAULT_SETTINGS });
      const settingsBootstrap = prepareSettingsBootstrap(db.songDb, settingsStoreModule);
      settingsStore = settingsBootstrap.settingsStore;
      webSocketHub = wsTransport.createWebSocketHub();
      gameSessionService = createGameSessionService({
        broadcast: payload => webSocketHub.broadcast(payload)
      });
      wheelSessionService = createWheelSessionService({
        broadcast: payload => webSocketHub.broadcast(payload)
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
        giftEffectResolver,
        onGiftFlushed: (item) => {
          logGiftDelivery('final', item);
          broadcastSnapshot('bilibili:gift');
          giftEffectModule.buildGiftEffectEvent(item, giftEffectResolver).then((effectEvent) => {
            if (effectEvent && webSocketHub) webSocketHub.broadcast(effectEvent);
          }).catch((error) => {
            console.warn(`[Bilibili][GiftEffect] 礼物特效事件构造失败：${error.message || error}`);
          });
        },
        onOvertimeUpdate: update => publishOvertimeUpdate(update)
      });
      musicRuntime = buildMusicRuntime({
        dataDir: { apiCacheDir: MUSIC_API_CACHE_DIR, lyricCacheDir: MUSIC_LYRIC_CACHE_DIR },
        runtimeOptions,
        settingsStore,
        webSocketHub
      });
      publishOvertimeUpdate = update => webSocketHub.broadcast({
        type: 'overtime:update',
        reason: update.reason,
        state: update.state,
        ...(update.adjustment ? { adjustment: update.adjustment } : {})
      });
      bilibiliRuntime = createBilibiliRuntime({
        settingsStore,
        domainServices,
        broadcastSnapshot,
        buildClient(roomId, context) {
          return buildBilibiliClient(roomId, {
            ...context,
            aiDanmakuDeliveryVerifier: aiRuntime.deliveryVerifier,
            domainServices,
            aiAssistant: aiRuntime.service,
            broadcastSnapshot,
            logGiftDelivery,
            games: gameSessionService
          });
        }
      });
      liveStatus = bilibiliRuntime.getLiveStatus();
      bilibiliDiagnostics = bilibiliRuntime.getDiagnostics();
      messageBuffer = bilibiliRuntime.getMessageBuffer();
      danmakuSender = bilibiliRuntime.getDanmakuSender();
      aiRuntime = buildAiRuntime({
        songDb: db.songDb,
        runtimeOptions,
        aiLogPath: AI_LOG_PATH,
        danmakuSender
      });

      musicRuntime.setMusicRegistry(options.musicAuth || {});
      bilibiliRuntime.setAuthProvider(options.bilibiliAuth);
      void giftEffectResolver.getEffectMap();
      giftService.repairGiftV2Events({ db });
      domainServices.songs.ensureCategory('默认');
      domainServices.queue.clearOnStartup();
      runStartupRetention();
      applicationInitialized = true;
    } catch (error) {
      await disposeApplication({ optimize: false });
      throw error;
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${START_PORT}`}`);

      if (requestUrl.pathname === '/api/health' && phase !== 'ready') {
        httpUtils.sendJson(res, 200, {
          ok: true,
          data: {
            serviceId: lifecycle.SERVICE_ID,
            rootDir: ROOT_DIR,
            dataDir: DATA_DIR,
            pid: process.pid,
            phase
          }
        });
        return;
      }

      if (phase !== 'ready') {
        sendServiceUnavailable(res);
        return;
      }

      // Validate Host header
      const baseUrl = `http://${HOST}:${startedPort || START_PORT}`;
      if (!httpUtils.validateRequestHost(req, baseUrl)) {
        httpUtils.sendJson(res, 400, { ok: false, error: 'Invalid Host header.' });
        return;
      }

      // Validate Origin for state-changing requests
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        const allowedOrigins = [baseUrl];
        if (!httpUtils.validateOrigin(req, allowedOrigins)) {
          httpUtils.sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
          return;
        }
      }

      if (requestUrl.pathname === '/ws') {
        httpUtils.sendJson(res, 400, { ok: false, error: 'Use a WebSocket client for /ws.' });
        return;
      }

      if (requestUrl.pathname.startsWith('/api/')) {
        await inflightTracker.run(() => apiRoutes.handleApi(createApiContext(), req, res, requestUrl));
        return;
      }

      servePageOrAsset(req, res, requestUrl);
    } catch (error) {
      if (error?.code === 'SERVER_QUIESCING' || phase !== 'ready') {
        if (!res.headersSent) sendServiceUnavailable(res);
        return;
      }

      // Log redacted error details locally
      console.error('[Server] Request error:', {
        method: req.method,
        path: req.url,
        error: error.message,
        stack: error.stack
      });

      // Send stable error response without internal details
      if (!res.headersSent) {
        httpUtils.sendStableError(res, error);
      }
    }
  });

  server.on('upgrade', (req, socket) => {
    if (phase !== 'ready') {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${START_PORT}`}`);
    if (requestUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const baseUrl = `http://${HOST}:${startedPort || START_PORT}`;
    webSocketHub.handleUpgrade(getWebSocketContext(baseUrl), req, socket);
  });

  function sendServiceUnavailable(res) {
    httpUtils.sendJson(res, 503, {
      ok: false,
      error: 'Service is starting or shutting down.'
    });
  }

  // 按领域分组注入路由层，避免上下文退化成平铺的 Fat Context
  function createApiContext() {
    return buildApiContext({
      maxBodyBytes: MAX_BODY_BYTES,
      sessionToken,
      broadcastSnapshot,
      broadcastGiftEffectPreview: payload => webSocketHub.broadcast(payload),
      domainServices,
      messageBuffer,
      publishLyricState: musicRuntime.publishLyricState,
      publishLyricTimeline: musicRuntime.publishLyricTimeline,
      weSingCapture: musicRuntime.weSingCapture,
      bilibili: {
        liveStatus,
        configure: bilibiliRuntime.configure,
        reconnect: bilibiliRuntime.reconnect,
        updateStatus: bilibiliRuntime.updateStatus,
        auth: bilibiliRuntime.getAuthProvider(),
        danmakuSender,
        fetchAvatarImage: bilibiliRuntime.fetchAvatarImage
      },
      ai: { configStore: aiRuntime.configStore, service: aiRuntime.service },
      games: {
        service: gameSessionService,
        listOnlineViewers: bilibiliRuntime.getViewerCandidates,
        getWinnerProfile: bilibiliRuntime.getGameWinnerProfile
      },
      wheel: { service: wheelSessionService },
      settings: { defaults: DEFAULT_SETTINGS, store: settingsStore },
      system: {
        rootDir: ROOT_DIR,
        dataDir: DATA_DIR,
        songDbPath: SONG_DB_PATH,
        superChatDbPath: SUPER_CHAT_DB_PATH,
        giftDbPath: GIFT_DB_PATH,
        musicDbPath: MUSIC_DB_PATH,
        checkinDbPath: CHECKIN_DB_PATH,
        liveStatus,
        getState,
        shutdown: () => shutdownApplication({ exitProcess: true })
      },
      music: {
        registry: musicRuntime.getMusicRegistry(),
        lyrics: musicRuntime.lyricsService,
        apiCacheDir: MUSIC_API_CACHE_DIR,
        lyricCacheDir: MUSIC_LYRIC_CACHE_DIR
      }
    });
  }

  // 启动时按 settings 里的保留期清理过期数据；清理失败不能阻断启动
  function runStartupRetention() {
    if (settingsStore.getSettings().autoRetentionOnStartup !== 'true') return;
    try {
      const result = domainServices.data.runRetention();
      const total = result.giftRawJsonCleared + result.giftEventsDeleted
        + result.requestsDeleted + result.superChatsDeleted + result.cooldownsDeleted;
      if (total > 0) {
        console.log(`[Startup] retention: rawJson=${result.giftRawJsonCleared} gifts=${result.giftEventsDeleted} requests=${result.requestsDeleted} sc=${result.superChatsDeleted} cooldowns=${result.cooldownsDeleted}`);
      }
    } catch (error) {
      console.warn('[Startup] retention failed:', error.message);
    }
  }

  function getLifecycleOptions(port, host) {
    return {
      port,
      host,
      rootDir: ROOT_DIR,
      dataDir: DATA_DIR,
      cleanupTimeoutMs: PORT_CLEANUP_TIMEOUT_MS,
      cleanupPollMs: PORT_CLEANUP_POLL_MS,
      sleep: sharedUtils.sleep
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
        await lifecycle.cleanupOwnPortOccupant(getLifecycleOptions(startPort, host));
        if (isShuttingDown) throw new Error('Server runtime is shutting down.');
        const port = await lifecycle.listenExactly(server, { port: startPort, host });
        startedPort = port;
        phase = 'starting';
        if (isShuttingDown) throw new Error('Server runtime is shutting down.');
        await initializeApplication(options);
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
        openAdminPageIfNeeded(baseUrl);
        bilibiliRuntime.reconnect().catch((error) => {
          console.warn(`[Bilibili] startup reconnect failed: ${error.message}`);
          bilibiliRuntime?.updateStatus({
            connected: false,
            enabled: true,
            roomId: sharedUtils.normalizeRoomInput(settingsStore.getSettings().roomId),
            mode: 'bilibili',
            message: sharedUtils.publicBilibiliErrorMessage(error, true)
          });
        });
        return { server, port, host, baseUrl };
      } catch (error) {
        phase = 'quiescing';
        lifecycle.removeSessionToken(DATA_DIR, sessionToken);
        lifecycle.removeRuntimeInfo(DATA_DIR, { pid: process.pid, port: startedPort });
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
      weSing: musicRuntime.weSingCapture.getStatus()
    };
  }

  function openAdminPageIfNeeded(baseUrl) {
    if (process.env.AUTO_OPEN_ADMIN !== '1') return;
    const adminUrl = `${baseUrl}/admin`;
    try {
      if (process.platform === 'win32') {
        childProcess.spawn('cmd', ['/c', 'start', '', adminUrl], {
          detached: true,
          stdio: 'ignore'
        }).unref();
      } else {
        console.log(`Open admin page manually: ${adminUrl}`);
      }
    } catch (error) {
      console.log(`Open admin page manually: ${adminUrl}`);
      console.warn(`Could not open browser automatically: ${error.message}`);
    }
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
        try { await startPromise; } catch (_) {}
      }

      bilibiliRuntime?.stop();
      webSocketHub?.stop({ shutdownPayload: { type: 'shutdown', reason: 'manual' } });

      // Flush renderer state before closing the server (e.g., save playback snapshot)
      if (preShutdownHook) {
        try { await preShutdownHook(); } catch (error) { console.warn('Pre-shutdown hook failed:', error); }
      }

      await inflightTracker.drain();
      await disposeApplication({ optimize: true });
      await closeHttpServer();
      lifecycle.removeSessionToken(DATA_DIR, sessionToken);
      lifecycle.removeRuntimeInfo(DATA_DIR, { pid: process.pid, port: startedPort });
      sessionToken = '';
      startedPort = null;
      phase = 'stopped';
      if (exitProcess) process.exit(0);
    })();

    return shutdownPromise;
  }

  async function disposeApplication(options = {}) {
    bilibiliRuntime?.stop();
    webSocketHub?.stop({ shutdownPayload: { type: 'shutdown', reason: 'manual' } });
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
    musicRuntime = null;
    bilibiliRuntime = null;
    liveStatus = null;
    bilibiliDiagnostics = null;
    messageBuffer = null;
    danmakuSender = null;
    aiRuntime = null;
    gameSessionService = null;
    wheelSessionService = null;
    applicationInitialized = false;
    publishOvertimeUpdate = () => {};
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

  function getWebSocketContext(baseUrl) {
    return {
      getState,
      sessionToken,
      allowedOrigins: baseUrl ? [baseUrl] : []
    };
  }

  function broadcastSnapshot(reason) {
    const baseUrl = `http://${HOST}:${startedPort || START_PORT}`;
    if (webSocketHub) webSocketHub.broadcastSnapshot(getWebSocketContext(baseUrl), reason);
  }

  function logGiftDelivery(trigger, item) {
    console.log(`[Bilibili][GiftDelivery] action=broadcast trigger=${trigger} trace=${JSON.stringify({
      eventId: Number(item && item.id) || 0,
      platformId: sharedUtils.cleanText(item && item.platform_id),
      cmd: sharedUtils.cleanText(item && item.cmd),
      uid: sharedUtils.cleanText(item && item.uid),
      userName: sharedUtils.cleanText(item && item.user_name),
      giftId: sharedUtils.cleanText(item && item.gift_id),
      giftName: sharedUtils.cleanText(item && item.gift_name),
      num: Number(item && item.num) || 1,
      totalPrice: Number(item && item.total_price) || 0
    })}`);
  }

  function servePageOrAsset(req, res, requestUrl) {
    httpUtils.servePageOrAsset(PUBLIC_DIR, req, res, requestUrl, sessionToken);
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
      return domainServices.playback.saveQueueState(payload, { clientId: clientId || 'default' });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function getSetting(key) {
    return settingsStore ? settingsStore.getSettings()[key] : DEFAULT_SETTINGS[key];
  }

  return {
    start: startServer,
    stop: shutdownApplication,
    setPreShutdownHook,
    persistPlaybackSnapshot,
    getApiToken: () => sessionToken,
    getSetting
  };
}

const {
  getApiToken,
  persistPlaybackSnapshot,
  setPreShutdownHook,
  shutdownApplication,
  startServer
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
  getApiToken
};
