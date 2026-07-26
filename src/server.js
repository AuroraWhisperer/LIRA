// 编写人：Aurora
// 当前项目版本：1.2.4
'use strict';

const http = require('node:http');
const path = require('node:path');
const childProcess = require('node:child_process');
const { URL } = require('node:url');
const apiRoutes = require('./server/api-routes');
const httpUtils = require('./server/http-utils');
const lifecycle = require('./server/lifecycle');
const systemMetrics = require('./server/system-metrics');
const wsTransport = require('./server/ws');
const { createDomainServices } = require('./server/domain-services');
const sharedUtils = require('./shared/utils');
const { createDatabases } = require('./storage/database');
const settingsStoreModule = require('./storage/settings-store');
const { createMusicProviderRegistry } = require('./music/provider-registry');
const { clearMusicCache, getMusicCacheStats } = require('./music/music-cache');
const { initLyricsService } = require('./music/lyrics-service');
const { createBlivedmRuntime } = require('./bilibili/blivedm-runtime');
const { BilibiliDanmakuClient } = require('./bilibili/danmaku-client');
const giftService = require('./bilibili/gift-service');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.SONG_PLUGIN_DATA_DIR
  ? path.resolve(process.env.SONG_PLUGIN_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
const SONG_DB_PATH = path.join(DATA_DIR, 'song-request-data.db');
const SUPER_CHAT_DB_PATH = path.join(DATA_DIR, 'super-chat-data.db');
const GIFT_DB_PATH = path.join(DATA_DIR, 'gift-data.db');
const MUSIC_API_CACHE_DIR = path.join(DATA_DIR, 'music-api-cache');
const MUSIC_LYRIC_CACHE_DIR = path.join(DATA_DIR, 'music-lyrics-cache');
const HOST = process.env.HOST || 'localhost';
const START_PORT = Number(process.env.PORT || 3000);
const PORT_CLEANUP_TIMEOUT_MS = 1200;
const PORT_CLEANUP_POLL_MS = 120;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_SETTINGS = settingsStoreModule.DEFAULT_SETTINGS;

const db = createDatabases({ dataDir: DATA_DIR });
const songDb = db.songDb;
const superChatDb = db.superChatDb;
const giftDb = db.giftDb;

const queueScrollSpeedRangeVersion = songDb.prepare(`
  SELECT value
  FROM settings
  WHERE key = 'queueScrollSpeedRangeVersion'
`).get();
const settingsStore = settingsStoreModule.createSettingsStore(songDb);
const domainServices = createDomainServices({ db, settingsStore });

initLyricsService(MUSIC_API_CACHE_DIR, MUSIC_LYRIC_CACHE_DIR);
giftService.repairGiftV2Events({ db });
settingsStoreModule.migrateQueueScrollSpeedSetting(
  songDb,
  queueScrollSpeedRangeVersion && queueScrollSpeedRangeVersion.value
);
settingsStoreModule.clearLegacyIdentityRuleDefaults(songDb);
domainServices.songs.ensureCategory('默认');
domainServices.queue.clearOnStartup();

const liveStatus = {
  connected: false,
  enabled: false,
  roomId: '',
  mode: 'disabled',
  message: '未启用 Bilibili 监听',
  updatedAt: sharedUtils.now()
};

const sockets = new Set();
let bilibiliClient = null;
let isShuttingDown = false;
let startedPort = null;
let startPromise = null;
let shutdownPromise = null;
let musicRegistry = createMusicProviderRegistry();
const runtimeGiftCommandPrefixes = new Set();
const blivedmRuntime = createBlivedmRuntime({
  songDb,
  runtimeGiftCommandPrefixes,
  broadcastSnapshot
});
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
  handleWebSocketUpgrade(req, socket);
});

function registerShutdownSignals() {
  process.once('SIGINT', () => shutdownApplication());
  process.once('SIGTERM', () => shutdownApplication());
  process.once('SIGHUP', () => shutdownApplication());
}

function createApiContext() {
  return {
    defaultSettings: DEFAULT_SETTINGS,
    maxBodyBytes: MAX_BODY_BYTES,
    liveStatus,
    musicRegistry,
    getHealth: () => ({
      rootDir: ROOT_DIR,
      dataDir: DATA_DIR,
      songDb: SONG_DB_PATH,
      superChatDb: SUPER_CHAT_DB_PATH,
      giftDb: GIFT_DB_PATH,
      desktop: process.env.ELECTRON_DESKTOP === '1',
      pid: process.pid,
      liveStatus
    }),
    getState,
    getSystemMetrics: systemMetrics.getSystemMetrics,
    runManualBlivedmCompatibilityCheck: blivedmRuntime.runManualCheck,
    listCategories: domainServices.songs.listCategories,
    listSongs: domainServices.songs.list,
    normalizeRoomInput: sharedUtils.normalizeRoomInput,
    setSetting: settingsStore.setSetting,
    getSettings: settingsStore.getSettings,
    configureBilibiliListener,
    broadcastSnapshot,
    addQueueItem: domainServices.queue.add,
    handleQueueAction: domainServices.queue.handleAction,
    handleSuperChatAction: domainServices.superChats.handleAction,
    resetGiftSprintProgress: domainServices.gifts.resetSprint,
    saveSong: domainServices.songs.save,
    deleteSong: domainServices.songs.delete,
    toggleSong: domainServices.songs.toggle,
    importSongs: domainServices.songs.import,
    getMusicCacheStats: () => getMusicCacheStats(MUSIC_API_CACHE_DIR, MUSIC_LYRIC_CACHE_DIR),
    clearMusicCache: () => clearMusicCache(MUSIC_API_CACHE_DIR, MUSIC_LYRIC_CACHE_DIR),
    clearSongLibraryData: domainServices.data.clearSongLibrary,
    clearSuperChatData: domainServices.data.clearSuperChats,
    clearAllData: domainServices.data.clearAll,
    reconnectBilibiliListener,
    publicBilibiliErrorMessage: sharedUtils.publicBilibiliErrorMessage,
    updateLiveStatus,
    shutdownApplication
  };
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

  musicRegistry = createMusicProviderRegistry(options.musicAuth || {});
  const startPort = Number(options.startPort || START_PORT);
  const host = options.host || HOST;
  startPromise = lifecycle.cleanupOwnPortOccupant(getLifecycleOptions(startPort, host))
    .then(() => lifecycle.listenWithFallback(server, { startPort, host }))
    .then((port) => {
    startedPort = port;
    const baseUrl = `http://${host}:${port}`;
    console.log(`Bilibili live song plugin is running at ${baseUrl}`);
    console.log(`Admin: ${baseUrl}/admin`);
    console.log(`Queue overlay: ${baseUrl}/queue`);
    console.log(`Songs overlay: ${baseUrl}/songlist`);
    openAdminPageIfNeeded(baseUrl);
    configureBilibiliListener();
    blivedmRuntime.checkOnStartup();
      return { server, port, host, baseUrl };
    });

  return startPromise;
}

if (require.main === module) {
  registerShutdownSignals();
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

function getState() {
  return {
    queue: domainServices.queue.getSnapshot(),
    superChats: domainServices.superChats.getSnapshot(),
    gifts: domainServices.gifts.getSnapshot(),
    giftSprint: domainServices.gifts.getSprintSnapshot(),
    settings: settingsStore.getSettings(),
    categories: domainServices.songs.listCategories(),
    songCount: domainServices.songs.count(),
    liveStatus,
    blivedmCompatibility: blivedmRuntime.getCompatibility(),
    bilibiliDiagnostics
  };
}

function configureBilibiliListener(force = false) {
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

  if (!force && bilibiliClient && bilibiliClient.roomId === roomId) {
    return;
  }

  if (bilibiliClient) {
    bilibiliClient.stop();
  }

  bilibiliClient = createBilibiliClient(roomId);
  bilibiliClient.start();
}

async function reconnectBilibiliListener() {
  const settings = settingsStore.getSettings();
  const roomId = sharedUtils.normalizeRoomInput(settings.roomId);
  const enabled = settings.enableBilibili === 'true' && roomId;

  if (!enabled) {
    configureBilibiliListener(true);
    return { liveStatus };
  }

  if (bilibiliClient) {
    bilibiliClient.stop();
  }

  bilibiliClient = createBilibiliClient(roomId);
  await bilibiliClient.restart();
  return { liveStatus };
}

function createBilibiliClient(roomId) {
  return new BilibiliDanmakuClient(roomId, {
    onMessage: (danmaku) => {
      try {
        const giftBotResult = domainServices.gifts.handleBotDanmaku(danmaku);
        if (giftBotResult && giftBotResult.item) {
          console.log(`[Bilibili] gift bot recorded: bot=${danmaku.userName || ''} user=${giftBotResult.item.user_name || ''} gift=${giftBotResult.item.gift_name || ''} x${giftBotResult.item.num || 1} totalRmb=${giftBotResult.item.total_price || 0}`);
          broadcastSnapshot('bilibili:gift-bot');
        }

        const result = domainServices.messages.handleDanmaku({
          message: danmaku.message,
          userName: danmaku.userName,
          uid: String(danmaku.uid || ''),
          source: danmaku.source || 'danmaku',
          messageTimestamp: danmaku.messageTimestamp,
          requesterGuardLevel: danmaku.requesterGuardLevel,
          requesterMedalName: danmaku.requesterMedalName,
          requesterMedalLevel: danmaku.requesterMedalLevel,
          isPinned: danmaku.isPinned
        });
        domainServices.messages.logDanmaku(danmaku, result);
        if (result.accepted) {
          broadcastSnapshot(danmaku.source === 'superchat' ? 'bilibili:superchat' : 'bilibili:danmaku');
        }
      } catch (error) {
        console.warn(`[Bilibili] danmaku command failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} message=${JSON.stringify(danmaku.message)} error=${error.message}`);
      }
    },
    onSuperChat: (superChat) => {
      try {
        const item = domainServices.superChats.add({
          platformId: superChat.id,
          message: superChat.message,
          price: superChat.price,
          uid: String(superChat.uid || ''),
          userName: superChat.userName,
          requesterGuardLevel: superChat.requesterGuardLevel,
          requesterMedalName: superChat.requesterMedalName,
          requesterMedalLevel: superChat.requesterMedalLevel,
          messageTimestamp: superChat.messageTimestamp
        });
        if (item) {
          broadcastSnapshot('bilibili:superchat');
        }
      } catch (error) {
        console.warn(`[Bilibili] superchat record failed: user=${superChat.userName || ''} uid=${superChat.uid || ''} price=${superChat.price || 0} message=${JSON.stringify(superChat.message)} error=${error.message}`);
      }
    },
    onGift: (gift) => {
      try {
        const item = domainServices.gifts.add(gift);
        if (item) {
          console.log(`[Bilibili] gift recorded: cmd=${item.cmd || ''} blind=${item.is_blind_box ? 'yes' : 'no'} coin=${item.coin_type || ''} user=${item.user_name || ''} uid=${item.uid || ''} gift=${item.gift_name || ''} x${item.num || 1} totalRmb=${item.total_price || 0}`);
          broadcastSnapshot('bilibili:gift');
        }
      } catch (error) {
        console.warn(`[Bilibili] gift record failed: user=${gift.userName || ''} uid=${gift.uid || ''} gift=${gift.giftName || ''} error=${error.message}`);
      }
    },
    onStatus: updateLiveStatus
  }, {
    diagnostics: bilibiliDiagnostics,
    runtimeGiftCommandPrefixes
  });
}

function updateLiveStatus(nextStatus) {
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
  const exitProcess = options.exitProcess !== false;
  if (shutdownPromise) return shutdownPromise;
  if (isShuttingDown) return Promise.resolve();
  isShuttingDown = true;
  console.log('Shutting down local song request service...');
  if (bilibiliClient) {
    bilibiliClient.stop();
    bilibiliClient = null;
  }

  for (const socket of Array.from(sockets)) {
    try {
      sendWebSocket(socket, { type: 'shutdown', reason: 'manual' });
      socket.end();
    } catch (_) {
      socket.destroy();
    }
  }
  sockets.clear();

  shutdownPromise = new Promise((resolve) => {
    let finished = false;

    const exit = () => {
      if (finished) return;
      finished = true;
      try {
        songDb.close();
      } catch (_) {
        // Ignore close errors during shutdown.
      }
      try {
        superChatDb.close();
      } catch (_) {
        // Ignore close errors during shutdown.
      }
      try {
        giftDb.close();
      } catch (_) {
        // Ignore close errors during shutdown.
      }
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

  return shutdownPromise;
}

function getWebSocketContext() {
  return {
    state: { sockets },
    getState
  };
}

function handleWebSocketUpgrade(req, socket) {
  wsTransport.handleWebSocketUpgrade(getWebSocketContext(), req, socket);
}

function broadcastSnapshot(reason) {
  wsTransport.broadcastSnapshot(getWebSocketContext(), reason);
}

function sendWebSocket(socket, payload) {
  wsTransport.sendWebSocket(socket, payload);
}

function servePageOrAsset(req, res, requestUrl) {
  httpUtils.servePageOrAsset(PUBLIC_DIR, req, res, requestUrl);
}

module.exports = {
  startServer,
  shutdownApplication
};
