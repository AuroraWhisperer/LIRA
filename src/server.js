// 编写人：Aurora
// 当前项目版本：1.4.6
'use strict';

const http = require('node:http');
const path = require('node:path');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const apiRoutes = require('./server/api-routes');
const { createApiContext: buildApiContext } = require('./server/api-context');
const { createBilibiliClient: buildBilibiliClient } = require('./server/bilibili-client');
const { buildMusicRuntime } = require('./server/music-runtime');
const { buildAiRuntime } = require('./server/ai-runtime');
const { createServerCompatibility } = require('./server/compatibility-runtime');
const httpUtils = require('./server/http-utils');
const lifecycle = require('./server/lifecycle');
const wsTransport = require('./server/ws');
const { createDomainServices } = require('./server/domain-services');
const sharedUtils = require('./shared/utils');
const { createDatabases, optimizeDatabases, closeDatabases } = require('./storage/database');
const settingsStoreModule = require('./storage/settings-store');
const { prepareSettingsBootstrap } = require('./server/settings-bootstrap');
const { BilibiliApiClient } = require('./bilibili/danmaku/api-client');
const { createDanmakuSenderService } = require('./bilibili/danmaku/sender-service');
const giftService = require('./bilibili/gift');
const giftEffectModule = require('./bilibili/gift/effect-config');
const { createMessageBuffer } = require('./bilibili/diagnostics/message-buffer');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const START_PORT = 3000;
const PORT_CLEANUP_TIMEOUT_MS = 1200;
const PORT_CLEANUP_POLL_MS = 120;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_SETTINGS = settingsStoreModule.DEFAULT_SETTINGS;

function normalizeServerHost(host) {
  const value = String(host || '').trim();
  return !value || value.toLowerCase() === 'localhost' ? '127.0.0.1' : value;
}

function createServerRuntime(runtimeOptions = {}) {
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
  const HOST = normalizeServerHost(runtimeOptions.host || process.env.HOST);

  const db = createDatabases({ dataDir: DATA_DIR, defaultSettings: DEFAULT_SETTINGS });
  const songDb = db.songDb;
  const superChatDb = db.superChatDb;
  const giftDb = db.giftDb;

  const settingsBootstrap = prepareSettingsBootstrap(songDb, settingsStoreModule);
  const settingsStore = settingsBootstrap.settingsStore;
  const webSocketHub = wsTransport.createWebSocketHub();
  const giftEffectResolver = giftEffectModule.createGiftEffectResolver();
  let publishOvertimeUpdate = () => {};
  const domainServices = createDomainServices({
    db,
    settingsStore,
    giftEffectResolver,
    onGiftFlushed: (item) => {
      logGiftDelivery('final', item);
      broadcastSnapshot('bilibili:gift');
      giftEffectModule.buildGiftEffectEvent(item, giftEffectResolver).then((effectEvent) => {
        if (effectEvent) webSocketHub.broadcast(effectEvent);
      }).catch((error) => {
        console.warn(`[Bilibili][GiftEffect] 礼物特效事件构造失败：${error.message || error}`);
      });
    },
    onOvertimeUpdate: update => publishOvertimeUpdate(update)
  });

  const musicRuntime = buildMusicRuntime({
    dataDir: { apiCacheDir: MUSIC_API_CACHE_DIR, lyricCacheDir: MUSIC_LYRIC_CACHE_DIR },
    runtimeOptions,
    settingsStore,
    webSocketHub
  });
  void giftEffectResolver.getEffectMap();
  giftService.repairGiftV2Events({ db });
  settingsBootstrap.runMigrations();
  domainServices.songs.ensureCategory('默认');
  domainServices.queue.clearOnStartup();
  runStartupRetention();

  const liveStatus = {
    connected: false,
    enabled: false,
    roomId: '',
    mode: 'disabled',
    message: '未启用 Bilibili 监听',
    updatedAt: sharedUtils.now()
  };

  let bilibiliAuthProvider = null; // { getAuthState, getCookieHeader, getUid }
  let bilibiliAuthCache = { cookieHeader: '', uid: 0 }; // 同步缓存，createBilibiliClient 同频读取

  publishOvertimeUpdate = update => webSocketHub.broadcast({
    type: 'overtime:update',
    reason: update.reason,
    state: update.state,
    ...(update.adjustment ? { adjustment: update.adjustment } : {})
  });
  let bilibiliClient = null;
  let isShuttingDown = false;
  let startedPort = null;
  let startPromise = null;
  let shutdownPromise = null;
  let sessionToken = '';
  const runtimeGiftCommandPrefixes = new Set();
  const bilibiliDiagnostics = {
    lastPacketAt: '',
    lastCommandAt: '',
    lastGiftAt: '',
    parsedGiftCount: 0,
    unparsedGiftCount: 0,
    commandCounts: {},
    recentCommands: [],
    recentGiftLikeCommands: []
  };
  const messageBuffer = createMessageBuffer(500);
  const danmakuSender = createDanmakuSenderService({
    async getAuth() {
      await refreshBilibiliAuthCache();
      const state = bilibiliAuthProvider
        ? await bilibiliAuthProvider.getAuthState().catch(() => ({ loggedIn: false, uid: 0 }))
        : { loggedIn: false, uid: 0 };
      return {
        loggedIn: Boolean(state.loggedIn),
        uid: Number(state.uid || bilibiliAuthCache.uid) || 0,
        cookieHeader: bilibiliAuthCache.cookieHeader
      };
    },
    async getRoom() {
      return { roomId: sharedUtils.normalizeRoomInput(settingsStore.getSettings().roomId) };
    },
    getLiveStatus: () => liveStatus,
    getMentionTarget: () => domainServices.requesterTargets.getLatestRandomRequester(),
    getAutoReplyEnabled: () => settingsStore.getSettings().enableRandomTagReply === 'true',
    getCheckinBotEnabled: () => settingsStore.getSettings().enableCheckinBot === 'true',
    getFortuneBotEnabled: () => settingsStore.getSettings().enableFortuneBot === 'true',
    getCustomReplyBotEnabled: () => settingsStore.getSettings().enableCustomReplyBot === 'true',
    createClient(roomId, auth) {
      if (bilibiliClient && bilibiliClient.roomId === roomId) {
        bilibiliClient.apiClient.updateAuth(auth.cookieHeader, auth.uid);
        return bilibiliClient.apiClient;
      }
      return new BilibiliApiClient(roomId, auth);
    }
  });
  const aiRuntime = buildAiRuntime({
    songDb,
    runtimeOptions,
    aiLogPath: AI_LOG_PATH,
    danmakuSender
  });

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${START_PORT}`}`);

      if (requestUrl.pathname === '/ws') {
        httpUtils.sendJson(res, 400, { ok: false, error: 'Use a WebSocket client for /ws.' });
        return;
      }

      if (requestUrl.pathname.startsWith('/api/')) {
        await apiRoutes.handleApi(createApiContext(), req, res, requestUrl);
        return;
      }

      servePageOrAsset(req, res, requestUrl);
    } catch (error) {
      console.error(error);
      httpUtils.sendJson(res, 500, { ok: false, error: error.message || 'Internal server error' });
    }
  });

  server.on('upgrade', (req, socket) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${START_PORT}`}`);
    if (requestUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    webSocketHub.handleUpgrade(getWebSocketContext(), req, socket);
  });

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
        configure: configureBilibiliListener,
        reconnect: reconnectBilibiliListener,
        updateStatus: updateLiveStatus,
        auth: bilibiliAuthProvider,
        danmakuSender
      },
      ai: { configStore: aiRuntime.configStore, service: aiRuntime.service },
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

    musicRuntime.setMusicRegistry(options.musicAuth || {});
    bilibiliAuthProvider = options.bilibiliAuth || null;
    const startPort = options.startPort === undefined ? START_PORT : Number(options.startPort);
    const host = normalizeServerHost(options.host || HOST);
    startPromise = lifecycle.cleanupOwnPortOccupant(getLifecycleOptions(startPort, host))
      .then(() => {
        if (isShuttingDown) throw new Error('Server runtime is shutting down.');
        return lifecycle.listenExactly(server, { port: startPort, host });
      })
      .then((port) => {
        startedPort = port;
        if (isShuttingDown) throw new Error('Server runtime is shutting down.');
        sessionToken = crypto.randomUUID();
        lifecycle.writeSessionToken(DATA_DIR, sessionToken);
        lifecycle.writeRuntimeInfo(DATA_DIR, { pid: process.pid, port, host });
        const baseUrl = `http://${host}:${port}`;
        console.log(`Bilibili live song plugin is running at ${baseUrl}`);
        console.log(`Session token: ${sessionToken}`);
        console.log(`Admin: ${baseUrl}/admin`);
        console.log(`Queue overlay: ${baseUrl}/queue`);
        console.log(`Songs overlay: ${baseUrl}/songlist`);
        console.log(`Blindbox overlay: ${baseUrl}/blindbox`);
        console.log(`Overtime overlay: ${baseUrl}/overtime`);
        openAdminPageIfNeeded(baseUrl);
        reconnectBilibiliListener().catch((error) => {
          console.warn(`[Bilibili] startup reconnect failed: ${error.message}`);
          updateLiveStatus({
            connected: false,
            enabled: true,
            roomId: sharedUtils.normalizeRoomInput(settingsStore.getSettings().roomId),
            mode: 'bilibili',
            message: sharedUtils.publicBilibiliErrorMessage(error, true)
          });
        });
        return { server, port, host, baseUrl };
      })
      .catch(async (error) => {
        lifecycle.removeSessionToken(DATA_DIR, sessionToken);
        lifecycle.removeRuntimeInfo(DATA_DIR, { pid: process.pid, port: startedPort });
        sessionToken = '';
        if (bilibiliClient) {
          bilibiliClient.stop();
          bilibiliClient = null;
        }
        if (server.listening) {
          await new Promise((resolve) => {
            server.close(() => resolve());
            if (typeof server.closeAllConnections === 'function') {
              server.closeAllConnections();
            }
          });
        }
        startedPort = null;
        startPromise = null;
        throw error;
      });

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

  function configureBilibiliListener(force = false) {
    if (isShuttingDown) return;
    const settings = settingsStore.getSettings();
    const roomId = sharedUtils.normalizeRoomInput(settings.roomId);
    const enabled = settings.enableBilibili === 'true' && roomId;

    if (!enabled) {
      if (bilibiliClient) {
        bilibiliClient.stop();
        bilibiliClient = null;
      }
      updateLiveStatus({
        connected: false,
        enabled: false,
        roomId,
        mode: 'disabled',
        message: '未启用 Bilibili 监听'
      });
      return;
    }

    // 相同房间且非强制时跳过，避免无谓断线重连
    if (!force && bilibiliClient && bilibiliClient.roomId === roomId) {
      return;
    }

    // configure 是 fire-and-forget 入口，必须在这里消费 rejection，避免 unhandled rejection。
    replaceBilibiliClient(roomId).catch((error) => {
      if (isShuttingDown) return;
      console.warn(`[Bilibili] configure failed: ${error.message}`);
      updateLiveStatus({
        connected: false,
        enabled: true,
        roomId,
        mode: 'bilibili',
        message: sharedUtils.publicBilibiliErrorMessage(error, true)
      });
    });
  }

  async function reconnectBilibiliListener() {
    if (isShuttingDown) throw new Error('Server runtime is shutting down.');
    const settings = settingsStore.getSettings();
    const roomId = sharedUtils.normalizeRoomInput(settings.roomId);
    const enabled = settings.enableBilibili === 'true' && roomId;

    if (!enabled) {
      // 未启用时复用 configure 的禁用逻辑，不重复写状态更新
      configureBilibiliListener(true);
      return { liveStatus };
    }

    // 强制重连：等待握手完成再返回
    await replaceBilibiliClient(roomId, true);
    return { liveStatus };
  }

  // 共用：停止旧客户端、创建新客户端并启动
  // restart=true 时 await 握手完成（reconnect 场景），否则 start() 立即返回（configure 场景）
  let _replaceClientChain = Promise.resolve();
  async function replaceBilibiliClient(roomId, restart = false) {
    const run = async () => {
      if (isShuttingDown) return;
      if (bilibiliClient) bilibiliClient.stop();
      // 重建前先刷新 Bilibili 登录态缓存
      await refreshBilibiliAuthCache();
      if (isShuttingDown) return;
      const client = createBilibiliClient(roomId);
      bilibiliClient = client;
      if (restart) {
        try {
          await client.restart();
        } finally {
          if (isShuttingDown) client.stop();
        }
      } else {
        client.start();
      }
    };
    const result = _replaceClientChain.then(run, run);
    _replaceClientChain = result.catch(() => {});
    return result;
  }

  async function refreshBilibiliAuthCache() {
    if (!bilibiliAuthProvider) return;
    try {
      const [cookieHeader, uid] = await Promise.all([
        bilibiliAuthProvider.getCookieHeader().catch(() => ''),
        bilibiliAuthProvider.getUid().catch(() => 0)
      ]);
      bilibiliAuthCache = { cookieHeader: cookieHeader || '', uid: Number(uid) || 0 };
    } catch (_) {
      // 非 Electron 模式或 auth 不可用，保持默认值
    }
  }

  function createBilibiliClient(roomId) {
    return buildBilibiliClient(roomId, {
      isShuttingDown: () => isShuttingDown,
      aiDanmakuDeliveryVerifier: aiRuntime.deliveryVerifier,
      domainServices,
      xiaomiAi: aiRuntime.service,
      danmakuSender,
      broadcastSnapshot,
      updateLiveStatus,
      bilibiliDiagnostics,
      runtimeGiftCommandPrefixes,
      messageBuffer,
      bilibiliAuthCache,
      logGiftDelivery
    });
  }

  function updateLiveStatus(nextStatus) {
    if (isShuttingDown) return;
    Object.assign(liveStatus, {
      ...nextStatus,
      updatedAt: sharedUtils.now()
    });
    broadcastSnapshot('live:status');
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
    aiRuntime.service.shutdown();
    console.log('Shutting down local song request service...');

    shutdownPromise = (async () => {
      if (startPromise) {
        try { await startPromise; } catch (_) {}
      }

      // Flush renderer state before closing the server (e.g., save playback snapshot)
      if (preShutdownHook) {
        try { await preShutdownHook(); } catch (error) { console.warn('Pre-shutdown hook failed:', error); }
      }

      lifecycle.removeSessionToken(DATA_DIR, sessionToken);
      lifecycle.removeRuntimeInfo(DATA_DIR, { pid: process.pid, port: startedPort });

      if (bilibiliClient) {
        bilibiliClient.stop();
        bilibiliClient = null;
      }
      try {
        domainServices.gifts.dispose();
      } catch (error) {
        console.warn('[Shutdown] pending gift flush failed:', error.message);
      }
      domainServices.overtime.dispose();
      musicRuntime.weSingCapture.stop();
      webSocketHub.stop({ shutdownPayload: { type: 'shutdown', reason: 'manual' } });

      return new Promise((resolve) => {
        let finished = false;

        const exit = () => {
          if (finished) return;
          finished = true;
          optimizeDatabases(db);
          closeDatabases(db);
          resolve();
          if (exitProcess) process.exit(0);
        };

        if (startedPort === null) {
          exit();
          return;
        }

        server.close(exit);
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        setTimeout(exit, 1500).unref();
      });
    })();

    return shutdownPromise;
  }

  function getWebSocketContext() {
    return {
      getState,
      sessionToken
    };
  }

  function broadcastSnapshot(reason) {
    webSocketHub.broadcastSnapshot(getWebSocketContext(), reason);
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
    if (!domainServices.playback) return { ok: false, error: 'Playback store not ready' };
    try {
      return domainServices.playback.saveQueueState(payload, { clientId: clientId || 'default' });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function getSetting(key) {
    return settingsStore.getSettings()[key];
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
