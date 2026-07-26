// 编写人：Aurora
// 当前项目版本：1.1.0
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const zlib = require('node:zlib');
const childProcess = require('node:child_process');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.SONG_PLUGIN_DATA_DIR
  ? path.resolve(process.env.SONG_PLUGIN_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
const SONG_DB_PATH = path.join(DATA_DIR, 'song-request-data.db');
const SUPER_CHAT_DB_PATH = path.join(DATA_DIR, 'super-chat-data.db');
const GIFT_DB_PATH = path.join(DATA_DIR, 'gift-data.db');
const HOST = process.env.HOST || 'localhost';
const START_PORT = Number(process.env.PORT || 3000);
const PORT_CLEANUP_TIMEOUT_MS = 1200;
const PORT_CLEANUP_POLL_MS = 120;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const HISTORY_MESSAGE_MAX_AGE_MS = 30 * 60 * 1000;
const BILIBILI_ONLINE_RANK_POLL_MS = 60 * 1000;
const BILIBILI_ONLINE_RANK_PAGE_SIZE = 50;
const BILIBILI_ONLINE_RANK_MAX_PAGES = 3;
const BILIBILI_IDENTITY_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const GIFT_BOT_PENDING_MAX_AGE_MS = 15 * 1000;
const GIFT_BOT_MATCH_WINDOW_MS = 20 * 1000;
const SUPER_CHAT_PIN_THRESHOLD = 2;
const SUPER_CHAT_DISPLAY_THRESHOLD = 2;
const CRYSTAL_BALL_VALUE_RMB = 100;

const DEFAULT_SETTINGS = {
  roomId: '',
  enableBilibili: 'true',
  enableGiftSprint: 'false',
  giftSprintTargetRmb: '0',
  enableGiftBotFallback: 'true',
  giftBotNames: '_薯条bb,薯条bb',
  giftBotAliasMap: '',
  paused: 'false',
  allowCompactRequest: 'true',
  onlyFromLibrary: 'false',
  allowDuplicate: 'true',
  queueLimit: '50',
  overlayDisplayCount: '6',
  userCooldownSeconds: '0',
  scrollSeconds: '100',
  queueScrollMode: 'bounce',
  queueScrollSpeed: '62',
  queueScrollSpeedRangeVersion: '3',
  themePrimary: '#ff6f91',
  themeAccent: '#21b6a8',
  themeText: '#fff7fb',
  themeBackground: '#181823',
  themeOpacity: '0.35',
  themeRadius: '8',
  themeFontScale: '1',
  queueSongFontSize: '20',
  queueTitleFontSize: '15',
  overlayQueueStyle: 'classic',
  overlayLowPowerMode: 'false',
  backdropBlur: '0',
  glowIntensity: '0',
  enableGradient: 'false',
  gradientEnd: '#181823',
  overlayFontFamily: 'Microsoft YaHei',
  overlayFontWeight: '800',
  overlaySongColor: '',
  overlayRequesterColor: '',
  overlayTitle: '',
  overlayShowIndex: 'true',
  overlayIndexThreshold: '0',
  overlayIndexColor: '#fbbf24',
  overlayPin1: '',
  overlayPin2: '',
  overlayPin3: '',
  overlayRule1: '弹幕输入 点歌 歌名',
  overlayRule2: '支持随机点歌',
  overlayRule3: '',
  overlayRule4: '',
  overlayRule5: '',
  overlayRule6: '',
  overlayRuleColor1: '#f5b72f',
  overlayRuleColor2: '#65aef7',
  overlayRuleColor3: '#8d67e8',
  overlayRuleColor4: '#f25f72',
  overlayRuleColor5: '#21b6a8',
  overlayRuleColor6: '#f97316',
  overlayRuleFontSize: '10',
  songBoardSyncTheme: 'true',
  songBoardThemePrimary: '#ff6f91',
  songBoardThemeAccent: '#21b6a8',
  songBoardThemeText: '#fff7fb',
  songBoardThemeBackground: '#181823',
  songBoardThemeOpacity: '0.35',
  songBoardThemeRadius: '8',
  songBoardThemeFontScale: '1',
  songBoardBackdropBlur: '0',
  songBoardGlowIntensity: '0',
  songBoardEnableGradient: 'false',
  songBoardGradientEnd: '#181823',
  songBoardFontFamily: 'Microsoft YaHei',
  songBoardFontWeight: '800',
  songBoardSongColor: '',
  songBoardTitle: '',
  songBoardSongFontSize: '16',
  songBoardTitleFontSize: '15',
  songBoardSortMode: 'initial'
};

const SONG_EXPORT_HEADERS = [
  '歌曲名字',
  '歌手',
  '歌曲分类',
  '备注',
  '标签',
  '是否可点',
  '语言',
  '来源平台',
  '原始分组'
];

const SONG_IMPORT_ALIASES = {
  name: ['name', 'songName', '歌曲名字', '歌曲名称', '歌名', '曲名'],
  artist: ['artist', 'singer', '歌手', '演唱者', '原唱'],
  categoryName: ['categoryName', 'category', '歌曲分类', '类别', '分类', '分组'],
  note: ['note', '备注', '说明'],
  tags: ['tags', 'tag', '标签', '歌曲标签'],
  isEnabled: ['isEnabled', 'enabled', '是否可点', '可点', '是否启用', '启用'],
  language: ['language', '语言', '语种'],
  sourcePlatform: ['sourcePlatform', 'source', '来源平台', '平台', '来源'],
  originalGroup: ['originalGroup', '原始分组', '原分组', '原分类']
};

const WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32,
  15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19,
  29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52
];

fs.mkdirSync(DATA_DIR, { recursive: true });

const songDb = openSqliteDatabase(SONG_DB_PATH, { foreignKeys: true });
songDb.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS song_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_pinyin TEXT NOT NULL DEFAULT '',
    name_initial TEXT NOT NULL DEFAULT '#',
    artist TEXT NOT NULL DEFAULT '',
    category_id INTEGER,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    source_platform TEXT NOT NULL DEFAULT '',
    original_group TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES song_categories(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_name_artist
    ON songs(name, artist);
  CREATE INDEX IF NOT EXISTS idx_songs_initial
    ON songs(name_initial);
  CREATE INDEX IF NOT EXISTS idx_songs_category
    ON songs(category_id);

  CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER,
    song_name TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    category_name TEXT NOT NULL DEFAULT '',
    requester_uid TEXT NOT NULL DEFAULT '',
    requester_name TEXT NOT NULL DEFAULT '',
    requester_guard_level INTEGER NOT NULL DEFAULT 0,
    requester_medal_name TEXT NOT NULL DEFAULT '',
    requester_medal_level INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'admin',
    status TEXT NOT NULL DEFAULT 'waiting',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    pinned_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (song_id) REFERENCES songs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_queue_status
    ON queue(status, is_pinned, pinned_at, created_at);

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id INTEGER,
    song_id INTEGER,
    song_name TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    category_name TEXT NOT NULL DEFAULT '',
    requester_uid TEXT NOT NULL DEFAULT '',
    requester_name TEXT NOT NULL DEFAULT '',
    requester_guard_level INTEGER NOT NULL DEFAULT 0,
    requester_medal_name TEXT NOT NULL DEFAULT '',
    requester_medal_level INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL,
    FOREIGN KEY (queue_id) REFERENCES queue(id),
    FOREIGN KEY (song_id) REFERENCES songs(id)
  );

  CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_count INTEGER NOT NULL,
    inserted_count INTEGER NOT NULL,
    duplicate_count INTEGER NOT NULL,
    failed_count INTEGER NOT NULL,
    created_category_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const superChatDb = openSqliteDatabase(SUPER_CHAT_DB_PATH);
superChatDb.exec(`
  CREATE TABLE IF NOT EXISTS super_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT NOT NULL DEFAULT '',
    uid TEXT NOT NULL DEFAULT '',
    user_name TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    requester_guard_level INTEGER NOT NULL DEFAULT 0,
    requester_medal_name TEXT NOT NULL DEFAULT '',
    requester_medal_level INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    source TEXT NOT NULL DEFAULT 'superchat',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_super_chats_status
    ON super_chats(status, created_at);
`);

const giftDb = openSqliteDatabase(GIFT_DB_PATH);
giftDb.exec(`
  CREATE TABLE IF NOT EXISTS gift_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT NOT NULL DEFAULT '',
    cmd TEXT NOT NULL DEFAULT '',
    gift_id TEXT NOT NULL DEFAULT '',
    gift_name TEXT NOT NULL DEFAULT '',
    uid TEXT NOT NULL DEFAULT '',
    user_name TEXT NOT NULL DEFAULT '',
    num INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    total_price REAL NOT NULL DEFAULT 0,
    coin_type TEXT NOT NULL DEFAULT '',
    is_blind_box INTEGER NOT NULL DEFAULT 0,
    blind_box_name TEXT NOT NULL DEFAULT '',
    blind_box_price REAL,
    blind_profit REAL,
    counted_in_sprint INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    raw_json TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_gift_events_status
    ON gift_events(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_gift_events_sprint
    ON gift_events(counted_in_sprint, status, created_at);
`);

ensureSongColumns();
ensureQueueColumns();
ensureRequesterMetaColumns('queue');
ensureRequesterMetaColumns('requests');
ensureGiftColumns();
repairGiftV2Events();
migrateLegacySuperChatsToDedicatedDatabase();

const queueScrollSpeedRangeVersion = songDb.prepare(`
  SELECT value
  FROM settings
  WHERE key = 'queueScrollSpeedRangeVersion'
`).get();
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  songDb.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(key, value, now());
}
migrateQueueScrollSpeedSetting(queueScrollSpeedRangeVersion && queueScrollSpeedRangeVersion.value);
clearLegacyIdentityRuleDefaults();
ensureCategory('默认');
clearActiveQueueOnStartup();

const liveStatus = {
  connected: false,
  enabled: false,
  roomId: '',
  mode: 'disabled',
  message: '未启用 Bilibili 监听',
  updatedAt: now()
};

const cooldownByUser = new Map();
const sockets = new Set();
let bilibiliClient = null;
let isShuttingDown = false;
let startedPort = null;
let startPromise = null;
let shutdownPromise = null;
let wbiKeyCache = null;
const giftBotPendingByName = new Map();
const giftBotLastReportByName = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${START_PORT}`}`);

    if (requestUrl.pathname === '/ws') {
      sendJson(res, 400, { ok: false, error: 'Use a WebSocket client for /ws.' });
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApi(req, res, requestUrl);
      return;
    }

    servePageOrAsset(req, res, requestUrl);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: error.message || 'Internal server error' });
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

function startServer(options = {}) {
  if (startPromise) return startPromise;

  const startPort = Number(options.startPort || START_PORT);
  const host = options.host || HOST;
  startPromise = cleanupOwnPortOccupant(startPort, host)
    .then(() => listenWithFallback(startPort, host))
    .then((port) => {
    startedPort = port;
    const baseUrl = `http://${host}:${port}`;
    console.log(`Bilibili live song plugin is running at ${baseUrl}`);
    console.log(`Admin: ${baseUrl}/admin`);
    console.log(`Queue overlay: ${baseUrl}/queue`);
    console.log(`Songs overlay: ${baseUrl}/songlist`);
    openAdminPageIfNeeded(baseUrl);
    configureBilibiliListener();
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

async function handleApi(req, res, requestUrl) {
  const method = req.method || 'GET';
  const pathName = requestUrl.pathname;

  if (method === 'GET' && pathName === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      data: {
        rootDir: ROOT_DIR,
        dataDir: DATA_DIR,
        songDb: SONG_DB_PATH,
        superChatDb: SUPER_CHAT_DB_PATH,
        giftDb: GIFT_DB_PATH,
        desktop: process.env.ELECTRON_DESKTOP === '1',
        pid: process.pid,
        liveStatus
      }
    });
    return;
  }

  if (method === 'GET' && pathName === '/api/state') {
    sendJson(res, 200, { ok: true, data: getState() });
    return;
  }

  if (method === 'GET' && pathName === '/api/system/metrics') {
    const windowMs = Number(requestUrl.searchParams.get('windowMs') || 5000);
    sendJson(res, 200, { ok: true, data: await getSystemMetrics(windowMs) });
    return;
  }

  if (method === 'GET' && pathName === '/api/categories') {
    sendJson(res, 200, { ok: true, data: listCategories() });
    return;
  }

  if (method === 'GET' && pathName === '/api/songs') {
    sendJson(res, 200, {
      ok: true,
      data: listSongs({
        query: requestUrl.searchParams.get('query') || '',
        category: requestUrl.searchParams.get('category') || '',
        language: requestUrl.searchParams.get('language') || '',
        artist: requestUrl.searchParams.get('artist') || '',
        enabledOnly: requestUrl.searchParams.get('enabledOnly') === 'true'
      })
    });
    return;
  }

  if (method === 'GET' && pathName === '/api/songs/template.csv') {
    const csv = buildSongsCsv(templateSongs());
    sendCsv(res, 'song-import-template.csv', `\uFEFF${csv}\n`);
    return;
  }

  if (method === 'GET' && pathName === '/api/songs/template.xlsx') {
    sendBuffer(
      res,
      200,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'song-import-template.xlsx',
      buildSongsWorkbook(templateSongs())
    );
    return;
  }

  if (method === 'GET' && pathName === '/api/songs/export.csv') {
    sendCsv(res, 'songs-export.csv', `\uFEFF${buildSongsCsv(listSongs({}))}\n`);
    return;
  }

  if (method === 'GET' && pathName === '/api/songs/export.xlsx') {
    sendBuffer(
      res,
      200,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'songs-export.xlsx',
      buildSongsWorkbook(listSongs({}))
    );
    return;
  }

  if (method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  const body = await readJsonBody(req);

  if (pathName === '/api/settings') {
    const allowedKeys = new Set(Object.keys(DEFAULT_SETTINGS));
    for (const [key, rawValue] of Object.entries(body || {})) {
      if (allowedKeys.has(key)) {
        const value = key === 'roomId' ? normalizeRoomInput(rawValue) : String(rawValue);
        setSetting(key, value);
      }
    }
    configureBilibiliListener();
    broadcastSnapshot('settings');
    sendJson(res, 200, { ok: true, data: getState() });
    return;
  }

  if (pathName === '/api/queue/add') {
    const item = addQueueItem({
      songName: body.songName,
      artist: body.artist,
      categoryName: body.categoryName,
      requesterName: body.requesterName || '主播',
      requesterUid: body.requesterUid || 'admin',
      requesterGuardLevel: body.requesterGuardLevel,
      requesterMedalName: body.requesterMedalName,
      requesterMedalLevel: body.requesterMedalLevel,
      source: body.source || 'admin',
      message: body.message || ''
    });
    broadcastSnapshot('queue:add');
    sendJson(res, 200, { ok: true, data: item });
    return;
  }

  if (pathName === '/api/queue/action') {
    const result = handleQueueAction(body.action, body.id);
    broadcastSnapshot(`queue:${body.action}`);
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/superchats/action') {
    const result = handleSuperChatAction(body.action, body.id);
    broadcastSnapshot(`superchat:${body.action}`);
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/gifts/sprint/reset') {
    const result = resetGiftSprintProgress();
    broadcastSnapshot('gift:sprint:reset');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/danmaku/simulate') {
    const result = handleDanmakuMessage({
      message: body.message || '',
      userName: body.userName || '模拟观众',
      uid: body.uid || `mock-${Date.now()}`,
      source: 'danmaku'
    });
    if (result.accepted) {
      broadcastSnapshot('danmaku');
    }
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/songs/save') {
    const result = saveSong(body);
    broadcastSnapshot('songs:save');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/songs/delete') {
    const id = Number(body.id);
    songDb.prepare('DELETE FROM songs WHERE id = ?').run(id);
    broadcastSnapshot('songs:delete');
    sendJson(res, 200, { ok: true, data: { id } });
    return;
  }

  if (pathName === '/api/songs/toggle') {
    const id = Number(body.id);
    const song = songDb.prepare('SELECT is_enabled FROM songs WHERE id = ?').get(id);
    if (!song) {
      sendJson(res, 404, { ok: false, error: 'Song not found.' });
      return;
    }
    songDb.prepare('UPDATE songs SET is_enabled = ?, updated_at = ? WHERE id = ?')
      .run(song.is_enabled ? 0 : 1, now(), id);
    broadcastSnapshot('songs:toggle');
    sendJson(res, 200, { ok: true, data: { id } });
    return;
  }

  if (pathName === '/api/songs/import') {
    const result = importSongs(Array.isArray(body.rows) ? body.rows : []);
    broadcastSnapshot('songs:import');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/songs/import-xlsx') {
    const buffer = Buffer.from(String(body.base64 || ''), 'base64');
    const result = importSongs(parseSongsFromXlsx(buffer));
    broadcastSnapshot('songs:import-xlsx');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/database/clear') {
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }
    const result = clearSongLibraryData();
    broadcastSnapshot('database:clear');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/database/clear-superchats') {
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }
    const result = clearSuperChatData();
    broadcastSnapshot('database:clear-superchats');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/database/clear-all') {
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }
    const result = clearAllData();
    broadcastSnapshot('database:clear-all');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/system/shutdown') {
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少退出确认。' });
      return;
    }
    sendJson(res, 200, { ok: true, data: { shuttingDown: true } });
    setTimeout(() => shutdownApplication(), 250);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'API route not found.' });
}

function getState() {
  return {
    queue: getQueueSnapshot(),
    superChats: getSuperChatSnapshot(),
    gifts: getGiftSnapshot(),
    giftSprint: getGiftSprintSnapshot(),
    settings: getSettings(),
    categories: listCategories(),
    songCount: songDb.prepare('SELECT COUNT(*) AS count FROM songs').get().count,
    liveStatus
  };
}

async function getSystemMetrics(rawWindowMs = 5000) {
  const windowMs = Math.min(Math.max(Number(rawWindowMs) || 5000, 1000), 10000);
  const startedAt = Date.now();
  const cpuStart = readSystemCpuSnapshot();
  const processCpuStart = process.cpuUsage();
  const processTimeStart = process.hrtime.bigint();
  const gpuPromise = sampleWindowsGpuMetrics(windowMs);

  await sleep(windowMs);

  const cpuEnd = readSystemCpuSnapshot();
  const processCpuDelta = process.cpuUsage(processCpuStart);
  const processElapsedMicros = Number(process.hrtime.bigint() - processTimeStart) / 1000;
  const cpuCount = Math.max(os.cpus().length, 1);
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const processMemory = process.memoryUsage();
  const gpu = await gpuPromise;

  return {
    sampledAt: now(),
    windowMs: Date.now() - startedAt,
    system: {
      cpuPercent: calculateSystemCpuPercent(cpuStart, cpuEnd),
      memoryPercent: totalMemory > 0 ? clampPercent(((totalMemory - freeMemory) / totalMemory) * 100) : null,
      memoryUsedBytes: totalMemory - freeMemory,
      memoryTotalBytes: totalMemory,
      gpuPercent: gpu.totalPercent,
      gpuAvailable: gpu.available,
      gpuMessage: gpu.message
    },
    process: {
      pid: process.pid,
      cpuPercent: processElapsedMicros > 0
        ? clampPercent(((processCpuDelta.user + processCpuDelta.system) / (processElapsedMicros * cpuCount)) * 100)
        : null,
      memoryPercent: totalMemory > 0 ? clampPercent((processMemory.rss / totalMemory) * 100) : null,
      memoryRssBytes: processMemory.rss,
      memoryHeapUsedBytes: processMemory.heapUsed,
      uptimeSeconds: Math.floor(process.uptime()),
      gpuPercent: gpu.processPercent,
      gpuAvailable: gpu.available,
      gpuMessage: gpu.message
    }
  };
}

function readSystemCpuSnapshot() {
  return os.cpus().reduce((snapshot, cpu) => {
    const times = cpu.times || {};
    const total = Object.values(times).reduce((sum, value) => sum + value, 0);
    return {
      idle: snapshot.idle + (times.idle || 0),
      total: snapshot.total + total
    };
  }, { idle: 0, total: 0 });
}

function calculateSystemCpuPercent(start, end) {
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;
  if (totalDelta <= 0) return null;
  return clampPercent((1 - idleDelta / totalDelta) * 100);
}

function sampleWindowsGpuMetrics(windowMs) {
  if (process.platform !== 'win32') {
    return Promise.resolve({
      available: false,
      totalPercent: null,
      processPercent: null,
      message: '当前系统不支持 GPU 计数器'
    });
  }

  const sampleCount = Math.min(Math.max(Math.round(windowMs / 1000), 1), 10);
  const targetPid = Number(process.pid);
  const command = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$target = 'pid_${targetPid}_'
$sets = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples ${sampleCount} -ErrorAction Stop
$total = 0.0
$process = 0.0
$count = 0
foreach ($set in @($sets)) {
  $setTotal = 0.0
  $setProcess = 0.0
  foreach ($sample in $set.CounterSamples) {
    $value = [double]$sample.CookedValue
    if ($value -gt 0) {
      $setTotal += $value
      $name = ([string]$sample.InstanceName).ToLowerInvariant()
      if ($name.Contains($target)) {
        $setProcess += $value
      }
    }
  }
  $total += [Math]::Min($setTotal, 100)
  $process += [Math]::Min($setProcess, 100)
  $count += 1
}
if ($count -lt 1) { $count = 1 }
[pscustomobject]@{
  available = $true
  totalPercent = [Math]::Round($total / $count, 1)
  processPercent = [Math]::Round($process / $count, 1)
  message = ''
} | ConvertTo-Json -Compress
`;

  return new Promise((resolve) => {
    childProcess.execFile('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command
    ], {
      windowsHide: true,
      timeout: (sampleCount + 3) * 1000,
      maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        resolve({
          available: false,
          totalPercent: null,
          processPercent: null,
          message: 'GPU 计数器不可用'
        });
        return;
      }

      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
        const payload = JSON.parse(line || '{}');
        resolve({
          available: payload.available === true,
          totalPercent: Number.isFinite(Number(payload.totalPercent)) ? clampPercent(Number(payload.totalPercent)) : null,
          processPercent: Number.isFinite(Number(payload.processPercent)) ? clampPercent(Number(payload.processPercent)) : null,
          message: cleanText(payload.message) || ''
        });
      } catch (_) {
        resolve({
          available: false,
          totalPercent: null,
          processPercent: null,
          message: 'GPU 数据解析失败'
        });
      }
    });
  });
}

function getQueueSnapshot() {
  const waiting = songDb.prepare(`
    SELECT queue.*, requests.message AS request_message
    FROM queue
    LEFT JOIN requests ON requests.queue_id = queue.id
    WHERE status IN ('current', 'waiting')
    ORDER BY queue.is_pinned DESC, datetime(NULLIF(queue.pinned_at, '')) ASC, datetime(queue.created_at) ASC, queue.id ASC
  `).all();

  return {
    current: null,
    waiting: waiting.map(normalizeQueueRow)
  };
}

function getSuperChatSnapshot() {
  return superChatDb.prepare(`
    SELECT *
    FROM super_chats
    WHERE status IN ('active', 'assisted')
    ORDER BY price DESC, datetime(created_at) ASC, id ASC
  `).all().map(normalizeSuperChatRow);
}

function getGiftSnapshot() {
  const recent = giftDb.prepare(`
    SELECT *
    FROM gift_events
    WHERE status = 'active' AND counted_in_sprint = 1
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 30
  `).all().map(normalizeGiftRow);
  return {
    recent
  };
}

function getGiftSprintSnapshot() {
  const settings = getSettings();
  const targetRmb = normalizeMoney(settings.giftSprintTargetRmb);
  const row = giftDb.prepare(`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN is_blind_box = 1 AND blind_box_price IS NOT NULL AND blind_box_price > 0
            THEN blind_box_price
          ELSE total_price
        END
      ), 0) AS receivedRmb,
      COUNT(*) AS countedGiftCount
    FROM gift_events
    WHERE status = 'active' AND counted_in_sprint = 1
  `).get() || {};
  const receivedRmb = normalizeMoney(row.receivedRmb);
  const remainingRmb = Math.max(0, normalizeMoney(targetRmb - receivedRmb));
  return {
    enabled: settings.enableGiftSprint === 'true',
    targetRmb,
    receivedRmb,
    remainingRmb,
    crystalBallValueRmb: CRYSTAL_BALL_VALUE_RMB,
    remainingCrystalBalls: Math.ceil(remainingRmb / CRYSTAL_BALL_VALUE_RMB),
    countedGiftCount: Number(row.countedGiftCount || 0)
  };
}

function normalizeSuperChatRow(row) {
  if (!row) return null;
  return {
    ...row,
    price: normalizeSuperChatPrice(row.price),
    requester_guard_level: normalizeGuardLevel(row.requester_guard_level),
    requester_medal_name: cleanText(row.requester_medal_name),
    requester_medal_level: normalizePositiveInteger(row.requester_medal_level)
  };
}

function normalizeGiftRow(row) {
  if (!row) return null;
  const blindBoxPrice = row.blind_box_price === null || row.blind_box_price === undefined ? null : normalizeMoney(row.blind_box_price);
  const totalPrice = normalizeMoney(row.total_price);
  return {
    ...row,
    num: normalizePositiveInteger(row.num) || 1,
    unit_price: normalizeMoney(row.unit_price),
    total_price: totalPrice,
    is_blind_box: Boolean(row.is_blind_box),
    blind_box_name: cleanText(row.blind_box_name),
    blind_box_price: blindBoxPrice,
    blind_profit: row.blind_profit === null || row.blind_profit === undefined ? null : normalizeSignedMoney(row.blind_profit),
    counted_in_sprint: Boolean(row.counted_in_sprint),
    sprint_count_price: Boolean(row.is_blind_box) && blindBoxPrice !== null ? blindBoxPrice : totalPrice
  };
}

function normalizeQueueRow(row) {
  if (!row) return null;
  return {
    ...row,
    is_pinned: Boolean(row.is_pinned),
    requester_guard_level: normalizeGuardLevel(row.requester_guard_level),
    requester_medal_name: cleanText(row.requester_medal_name),
    requester_medal_level: normalizePositiveInteger(row.requester_medal_level)
  };
}

function addQueueItem(input) {
  const songName = cleanText(input.songName);
  if (!songName) {
    throw new Error('歌曲名不能为空。');
  }

  const settings = getSettings();
  const activeCount = songDb.prepare(`
    SELECT COUNT(*) AS count FROM queue
    WHERE status IN ('current', 'waiting')
  `).get().count;
  if (activeCount >= Number(settings.queueLimit || DEFAULT_SETTINGS.queueLimit)) {
    throw new Error('点歌队列已达到上限。');
  }

  if (settings.allowDuplicate !== 'true') {
    const duplicate = songDb.prepare(`
      SELECT id FROM queue
      WHERE status IN ('current', 'waiting') AND song_name = ?
      LIMIT 1
    `).get(songName);
    if (duplicate) {
      throw new Error('队列里已经有这首歌。');
    }
  }

  const matchedSong = findSong(songName, input.artist);
  if (settings.onlyFromLibrary === 'true' && !matchedSong) {
    throw new Error('歌库里没有这首歌。');
  }

  const status = 'waiting';
  const createdAt = timestampToIso(input.messageTimestamp || input.createdAt) || now();
  const requesterGuardLevel = normalizeGuardLevel(input.requesterGuardLevel);
  const requesterMedalName = cleanText(input.requesterMedalName);
  const requesterMedalLevel = normalizePositiveInteger(input.requesterMedalLevel);
  const isPinned = input.isPinned === true || input.isPinned === 1 || input.isPinned === 'true' ? 1 : 0;
  const pinnedAt = isPinned ? createdAt : '';
  const result = songDb.prepare(`
    INSERT INTO queue (
      song_id, song_name, artist, category_name,
      requester_uid, requester_name,
      requester_guard_level, requester_medal_name, requester_medal_level,
      source, status, is_pinned, pinned_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    matchedSong ? matchedSong.id : null,
    matchedSong ? matchedSong.name : songName,
    cleanText(input.artist) || (matchedSong ? matchedSong.artist : ''),
    cleanText(input.categoryName) || (matchedSong ? matchedSong.category_name : ''),
    cleanText(input.requesterUid),
    cleanText(input.requesterName) || '观众',
    requesterGuardLevel,
    requesterMedalName,
    requesterMedalLevel,
    cleanText(input.source) || 'admin',
    status,
    isPinned,
    pinnedAt,
    createdAt,
    createdAt
  );

  const queueId = Number(result.lastInsertRowid);
  songDb.prepare(`
    INSERT INTO requests (
      queue_id, song_id, song_name, artist, category_name,
      requester_uid, requester_name,
      requester_guard_level, requester_medal_name, requester_medal_level,
      message, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    queueId,
    matchedSong ? matchedSong.id : null,
    matchedSong ? matchedSong.name : songName,
    cleanText(input.artist) || (matchedSong ? matchedSong.artist : ''),
    cleanText(input.categoryName) || (matchedSong ? matchedSong.category_name : ''),
    cleanText(input.requesterUid),
    cleanText(input.requesterName) || '观众',
    requesterGuardLevel,
    requesterMedalName,
    requesterMedalLevel,
    cleanText(input.message),
    cleanText(input.source) || 'admin',
    createdAt
  );

  return normalizeQueueRow(songDb.prepare('SELECT * FROM queue WHERE id = ?').get(queueId));
}

function addSuperChatItem(input) {
  const price = normalizeSuperChatPrice(input && input.price);
  if (price < SUPER_CHAT_DISPLAY_THRESHOLD) {
    return null;
  }

  const platformId = cleanText(input && input.platformId);
  if (platformId) {
    const existing = superChatDb.prepare(`
      SELECT *
      FROM super_chats
      WHERE platform_id = ?
      LIMIT 1
    `).get(platformId);
    if (existing) {
      return existing.status === 'deleted' ? null : normalizeSuperChatRow(existing);
    }
  }

  const createdAt = timestampToIso(input && input.messageTimestamp) || now();
  const result = superChatDb.prepare(`
    INSERT INTO super_chats (
      platform_id, uid, user_name, price, message,
      requester_guard_level, requester_medal_name, requester_medal_level,
      status, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'superchat', ?, ?)
  `).run(
    platformId,
    cleanText(input && input.uid),
    cleanText(input && input.userName) || '观众',
    price,
    cleanText(input && input.message),
    normalizeGuardLevel(input && input.requesterGuardLevel),
    cleanText(input && input.requesterMedalName),
    normalizePositiveInteger(input && input.requesterMedalLevel),
    createdAt,
    createdAt
  );

  return normalizeSuperChatRow(superChatDb.prepare('SELECT * FROM super_chats WHERE id = ?').get(Number(result.lastInsertRowid)));
}

function addGiftEvent(input) {
  const settings = getSettings();
  if (settings.enableGiftSprint !== 'true') {
    return null;
  }

  const gift = normalizeGiftInput(input);
  if (!gift.giftName && !gift.giftId) {
    return null;
  }

  if (gift.platformId) {
    const existing = giftDb.prepare(`
      SELECT *
      FROM gift_events
      WHERE platform_id = ?
      LIMIT 1
    `).get(gift.platformId);
    if (existing) {
      return existing.status === 'deleted' ? null : normalizeGiftRow(existing);
    }
  }
  const recentDuplicate = findRecentGiftCommandDuplicate(gift);
  if (recentDuplicate) {
    return recentDuplicate;
  }

  const countedInSprint = gift.totalPrice > 0 ? 1 : 0;
  const result = giftDb.prepare(`
    INSERT INTO gift_events (
      platform_id, cmd, gift_id, gift_name,
      uid, user_name, num, unit_price, total_price, coin_type,
      is_blind_box, blind_box_name, blind_box_price, blind_profit,
      counted_in_sprint, status, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    gift.platformId,
    gift.cmd,
    gift.giftId,
    gift.giftName,
    gift.uid,
    gift.userName,
    gift.num,
    gift.unitPrice,
    gift.totalPrice,
    gift.coinType,
    gift.isBlindBox ? 1 : 0,
    gift.blindBoxName,
    gift.blindBoxPrice,
    gift.blindProfit,
    countedInSprint,
    gift.rawJson,
    gift.createdAt,
    gift.createdAt
  );

  return normalizeGiftRow(giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(result.lastInsertRowid)));
}

function findRecentGiftCommandDuplicate(gift) {
  const cmd = cleanText(gift && gift.cmd);
  const isCombo = cmd.startsWith('COMBO_SEND');
  const isSingleGift = cmd.startsWith('SEND_GIFT') || cmd.startsWith('BLIND_GIFT');
  if (!isCombo && !isSingleGift) return null;

  const createdAtMs = Date.parse(gift.createdAt) || Date.now();
  const startIso = new Date(createdAtMs - 5000).toISOString();
  const endIso = new Date(createdAtMs + 5000).toISOString();
  const row = giftDb.prepare(`
    SELECT *
    FROM gift_events
    WHERE status = 'active'
      AND created_at BETWEEN ? AND ?
      AND cmd != ?
      AND (cmd LIKE 'COMBO_SEND%' OR ? LIKE 'COMBO_SEND%')
      AND uid = ?
      AND gift_id = ?
      AND gift_name = ?
      AND num = ?
      AND ABS(total_price - ?) < 0.0001
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `).get(
    startIso,
    endIso,
    cmd,
    cmd,
    gift.uid,
    gift.giftId,
    gift.giftName,
    gift.num,
    gift.totalPrice
  );
  return row ? normalizeGiftRow(row) : null;
}

function normalizeGiftInput(input) {
  const num = normalizePositiveInteger(input && input.num) || 1;
  const unitPrice = normalizeMoney(input && input.unitPrice);
  const totalPrice = normalizeMoney((input && input.totalPrice) || (unitPrice * num));
  const blindBoxPrice = input && input.blindBoxPrice === null ? null : normalizeNullableMoney(input && input.blindBoxPrice);
  const blindProfit = blindBoxPrice === null ? null : normalizeSignedMoney(totalPrice - blindBoxPrice);
  return {
    platformId: cleanText(input && input.platformId),
    cmd: cleanText(input && input.cmd),
    giftId: cleanText(input && input.giftId),
    giftName: cleanText(input && input.giftName),
    uid: cleanText(input && input.uid),
    userName: cleanText(input && input.userName) || '观众',
    num,
    unitPrice,
    totalPrice,
    coinType: cleanText(input && input.coinType),
    isBlindBox: Boolean(input && input.isBlindBox),
    blindBoxName: cleanText(input && input.blindBoxName),
    blindBoxPrice,
    blindProfit,
    rawJson: cleanText(input && input.rawJson),
    createdAt: timestampToIso(input && input.messageTimestamp) || now()
  };
}

function handleGiftBotDanmaku(danmaku) {
  const settings = getSettings();
  if (settings.enableGiftSprint !== 'true' || settings.enableGiftBotFallback !== 'true') {
    return null;
  }

  const botName = cleanText(danmaku && danmaku.userName);
  if (!isConfiguredGiftBotName(botName, settings)) {
    return null;
  }

  const text = cleanText(danmaku && danmaku.message);
  if (!text) return null;

  cleanupGiftBotPending();
  const messageTimestamp = normalizeTimestampMs(danmaku && danmaku.messageTimestamp) || Date.now();
  const pendingKey = normalizeGiftBotName(botName);
  const parsed = parseGiftBotDanmakuMessage(text, giftBotPendingByName.get(pendingKey));
  if (!parsed) return null;

  if (parsed.type === 'pending-user') {
    const resolvedAlias = resolveGiftBotAlias(parsed.userAlias, settings);
    giftBotPendingByName.set(pendingKey, {
      userAlias: resolvedAlias.userName,
      uid: resolvedAlias.uid,
      messageTimestamp,
      createdAtMs: Date.now()
    });
    return { parsed, item: null };
  }

  if (parsed.type === 'profit-report') {
    const item = updateLastGiftBotReportProfit(pendingKey, {
      ...parsed,
      botName,
      message: text,
      messageTimestamp
    });
    return { parsed, item };
  }

  const pending = giftBotPendingByName.get(pendingKey);
  if (pending && Date.now() - pending.createdAtMs <= GIFT_BOT_PENDING_MAX_AGE_MS) {
    parsed.userAlias = parsed.userAlias || pending.userAlias;
    parsed.uid = parsed.uid || pending.uid;
  }
  giftBotPendingByName.delete(pendingKey);

  const item = addOrMergeGiftBotEvent({
    ...parsed,
    userName: parsed.userAlias || '机器人识别观众',
    uid: parsed.uid || '',
    botName,
    message: text,
    messageTimestamp
  });
  if (item) {
    giftBotLastReportByName.set(pendingKey, {
      giftEventId: item.id,
      createdAtMs: Date.now()
    });
  }
  return { parsed, item };
}

function updateLastGiftBotReportProfit(pendingKey, report) {
  const recent = giftBotLastReportByName.get(pendingKey);
  if (!recent || Date.now() - recent.createdAtMs > GIFT_BOT_PENDING_MAX_AGE_MS) {
    return null;
  }

  const row = giftDb.prepare(`
    SELECT *
    FROM gift_events
    WHERE id = ? AND status = 'active'
    LIMIT 1
  `).get(Number(recent.giftEventId));
  if (!row) return null;

  return updateGiftEventFromBotReport(row, {
    ...report,
    userName: row.user_name,
    uid: row.uid,
    giftName: row.gift_name,
    num: row.num,
    totalPrice: row.total_price,
    unitPrice: row.unit_price,
    isBlindBox: true,
    blindBoxName: report.blindBoxName || row.blind_box_name || '机器人识别盲盒',
    blindBoxPrice: normalizeMoney(Number(row.total_price || 0) - Number(report.blindProfit || 0))
  });
}

function addOrMergeGiftBotEvent(report) {
  if (!report || !report.giftName) return null;

  const matched = findRecentGiftEventForBotReport(report);
  if (matched) {
    return updateGiftEventFromBotReport(matched, report);
  }

  return addGiftEvent({
    platformId: buildGiftBotPlatformId(report),
    cmd: 'GIFT_BOT_REPORT',
    giftId: '',
    giftName: report.giftName,
    uid: report.uid,
    userName: report.userName,
    num: report.num,
    unitPrice: report.unitPrice,
    totalPrice: report.totalPrice,
    coinType: report.coinType,
    isBlindBox: report.isBlindBox,
    blindBoxName: report.blindBoxName,
    blindBoxPrice: report.blindBoxPrice,
    messageTimestamp: report.messageTimestamp,
    rawJson: safeJsonStringify({
      source: 'gift-bot',
      botName: report.botName,
      message: report.message
    })
  });
}

function findRecentGiftEventForBotReport(report) {
  const timestamp = normalizeTimestampMs(report.messageTimestamp) || Date.now();
  const startIso = new Date(timestamp - GIFT_BOT_MATCH_WINDOW_MS).toISOString();
  const endIso = new Date(timestamp + 5 * 1000).toISOString();
  const rows = giftDb.prepare(`
    SELECT *
    FROM gift_events
    WHERE status = 'active'
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(startIso, endIso);

  const reportGiftName = normalizeGiftBotName(report.giftName);
  return rows.find((row) => {
    const sameGift = normalizeGiftBotName(row.gift_name) === reportGiftName;
    const sameNum = Number(row.num || 1) === Number(report.num || 1);
    const samePrice = Math.abs(Number(row.total_price || 0) - Number(report.totalPrice || 0)) <= 0.01;
    return sameGift && sameNum && samePrice;
  }) || null;
}

function updateGiftEventFromBotReport(row, report) {
  const totalPrice = normalizeMoney(report.totalPrice || row.total_price);
  const blindBoxPrice = report.blindBoxPrice !== null && report.blindBoxPrice !== undefined
    ? normalizeMoney(report.blindBoxPrice)
    : row.blind_box_price;
  const blindProfit = report.blindProfit !== null && report.blindProfit !== undefined
    ? normalizeSignedMoney(report.blindProfit)
    : blindBoxPrice === null || blindBoxPrice === undefined
      ? row.blind_profit
      : normalizeSignedMoney(totalPrice - Number(blindBoxPrice || 0));
  const rawJson = safeJsonStringify({
    source: 'gift-bot-merge',
    previous: safeParseJson(row.raw_json),
    botName: report.botName,
    message: report.message
  });

  giftDb.prepare(`
    UPDATE gift_events
    SET
      user_name = CASE WHEN uid = '' AND user_name IN ('', '观众') THEN ? ELSE user_name END,
      uid = CASE WHEN uid = '' THEN ? ELSE uid END,
      is_blind_box = CASE WHEN ? = 1 THEN 1 ELSE is_blind_box END,
      blind_box_name = CASE WHEN ? != '' THEN ? ELSE blind_box_name END,
      blind_box_price = CASE WHEN ? IS NOT NULL THEN ? ELSE blind_box_price END,
      blind_profit = CASE WHEN ? IS NOT NULL THEN ? ELSE blind_profit END,
      raw_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    cleanText(report.userName),
    cleanText(report.uid),
    report.isBlindBox ? 1 : 0,
    cleanText(report.blindBoxName),
    cleanText(report.blindBoxName),
    blindBoxPrice,
    blindBoxPrice,
    blindProfit,
    blindProfit,
    rawJson,
    now(),
    row.id
  );

  return normalizeGiftRow(giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(row.id)));
}

function parseGiftBotDanmakuMessage(text, pending) {
  const thankMatch = text.match(/^感谢\s*(.+?)\s*的礼物[~～!！。]*$/);
  if (thankMatch) {
    return {
      type: 'pending-user',
      userAlias: cleanText(thankMatch[1])
    };
  }

  const blindProfit = parseGiftBotProfit(text);
  const giftMatch = text.match(/(?:开出|抽中|获得)?\s*([^，,。]+?)\s*[x×＊*]\s*(\d+)/);
  const totalMatch = text.match(/共\s*([0-9]+(?:\.[0-9]+)?)\s*(电池|元|rmb|RMB)/);
  if ((!giftMatch || !totalMatch) && blindProfit !== null) {
    return {
      type: 'profit-report',
      isBlindBox: true,
      blindBoxName: parseGiftBotBlindBoxName(text) || '机器人识别盲盒',
      blindProfit
    };
  }
  if (!giftMatch || !totalMatch) {
    return null;
  }

  const unit = totalMatch[2].toLowerCase();
  const totalPrice = unit === '电池'
    ? normalizeMoney(Number(totalMatch[1]) / 10)
    : normalizeMoney(Number(totalMatch[1]));
  const num = normalizePositiveInteger(giftMatch[2]) || 1;
  const unitPrice = num > 0 ? normalizeMoney(totalPrice / num) : totalPrice;
  const isBlindBox = blindProfit !== null || text.includes('盲盒') || text.includes('盒子') || text.includes('盒');
  const blindBoxPrice = blindProfit === null ? null : normalizeMoney(totalPrice - blindProfit);
  const blindBoxName = parseGiftBotBlindBoxName(text) || (isBlindBox ? '机器人识别盲盒' : '');

  return {
    type: 'gift-report',
    userAlias: pending && pending.userAlias,
    uid: pending && pending.uid,
    giftName: cleanGiftBotGiftName(giftMatch[1]),
    num,
    unitPrice,
    totalPrice,
    coinType: unit === '电池' ? 'battery' : 'rmb',
    isBlindBox,
    blindBoxName,
    blindBoxPrice,
    blindProfit
  };
}

function parseGiftBotProfit(text) {
  const positive = text.match(/(?:赚(?:了)?|盈利)\s*([0-9]+(?:\.[0-9]+)?)\s*元/);
  if (positive) return normalizeSignedMoney(Number(positive[1]));

  const negative = text.match(/(?:亏(?:了)?|赔(?:了)?)\s*([0-9]+(?:\.[0-9]+)?)\s*元/);
  if (negative) return normalizeSignedMoney(-Number(negative[1]));

  return null;
}

function parseGiftBotBlindBoxName(text) {
  const match = text.match(/(?:通过|使用|开启|打开)\s*([^，,。]*?盒[^，,。]*?)\s*(?:开出|抽中|获得)/);
  return match ? cleanText(match[1]) : '';
}

function cleanGiftBotGiftName(value) {
  return cleanText(value)
    .replace(/^.*(?:开出|抽中|获得)\s*/, '')
    .replace(/^礼物\s*/, '')
    .replace(/[：:，,。]+$/g, '');
}

function buildGiftBotPlatformId(report) {
  const hash = crypto.createHash('sha1')
    .update([
      'gift-bot',
      report.botName,
      report.userName,
      report.giftName,
      report.num,
      report.totalPrice,
      Math.floor((normalizeTimestampMs(report.messageTimestamp) || Date.now()) / 1000)
    ].join('|'))
    .digest('hex')
    .slice(0, 16);
  return `gift-bot:${hash}`;
}

function cleanupGiftBotPending() {
  const cutoff = Date.now() - GIFT_BOT_PENDING_MAX_AGE_MS;
  for (const [key, pending] of giftBotPendingByName.entries()) {
    if (!pending || pending.createdAtMs < cutoff) {
      giftBotPendingByName.delete(key);
    }
  }
  for (const [key, report] of giftBotLastReportByName.entries()) {
    if (!report || report.createdAtMs < cutoff) {
      giftBotLastReportByName.delete(key);
    }
  }
}

function isConfiguredGiftBotName(userName, settings) {
  const normalized = normalizeGiftBotName(userName);
  if (!normalized) return false;
  return splitSettingList(settings.giftBotNames)
    .map(normalizeGiftBotName)
    .includes(normalized);
}

function resolveGiftBotAlias(alias, settings) {
  const normalizedAlias = normalizeGiftBotName(alias);
  const aliasMap = parseGiftBotAliasMap(settings.giftBotAliasMap);
  const mapped = aliasMap[normalizedAlias];
  if (!mapped) {
    return { uid: '', userName: cleanText(alias) };
  }
  if (typeof mapped === 'object') {
    return {
      uid: cleanText(mapped.uid),
      userName: cleanText(mapped.userName || mapped.name) || cleanText(alias)
    };
  }
  return { uid: '', userName: cleanText(mapped) || cleanText(alias) };
}

function parseGiftBotAliasMap(value) {
  const text = cleanText(value);
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const normalized = {};
      for (const [key, mapped] of Object.entries(parsed)) {
        normalized[normalizeGiftBotName(key)] = mapped;
      }
      return normalized;
    }
  } catch (_) {
    // Fall through to line-based alias parsing.
  }

  const normalized = {};
  for (const part of String(value).split(/[\n;,]+/)) {
    const [left, right] = part.split('=');
    if (left && right) {
      normalized[normalizeGiftBotName(left)] = cleanText(right);
    }
  }
  return normalized;
}

function splitSettingList(value) {
  return String(value || '')
    .split(/[\n,，;；]+/)
    .map(cleanText)
    .filter(Boolean);
}

function normalizeGiftBotName(value) {
  return cleanText(value).replace(/\s+/g, '').toLowerCase();
}

function resetGiftSprintProgress() {
  const result = giftDb.prepare(`
    UPDATE gift_events
    SET counted_in_sprint = 0, updated_at = ?
    WHERE counted_in_sprint = 1
  `).run(now());
  return {
    reset: true,
    changedCount: Number(result.changes || 0),
    giftSprint: getGiftSprintSnapshot()
  };
}

function handleSuperChatAction(action, rawId) {
  const id = Number(rawId);
  if (!Number.isFinite(id)) {
    throw new Error('缺少 SC ID。');
  }

  const updatedAt = now();
  if (action === 'delete') {
    superChatDb.prepare('UPDATE super_chats SET status = ?, updated_at = ? WHERE id = ?')
      .run('deleted', updatedAt, id);
    return getSuperChatSnapshot();
  }

  if (action === 'assist' || action === 'unassist') {
    superChatDb.prepare('UPDATE super_chats SET status = ?, updated_at = ? WHERE id = ?')
      .run(action === 'assist' ? 'assisted' : 'active', updatedAt, id);
    return getSuperChatSnapshot();
  }

  throw new Error('未知 SC 操作。');
}

function handleQueueAction(action, rawId) {
  const id = Number(rawId);
  const updatedAt = now();

  if (action === 'next') {
    const first = songDb.prepare(`
      SELECT id FROM queue
      WHERE status IN ('current', 'waiting')
      ORDER BY is_pinned DESC, datetime(NULLIF(pinned_at, '')) ASC, datetime(created_at) ASC, id ASC
      LIMIT 1
    `).get();
    if (first) {
      songDb.prepare('UPDATE queue SET status = ?, updated_at = ? WHERE id = ?')
        .run('done', updatedAt, first.id);
    }
    return getQueueSnapshot();
  }

  if (action === 'clear') {
    songDb.prepare(`
      UPDATE queue SET status = 'deleted', updated_at = ?
      WHERE status IN ('current', 'waiting')
    `).run(updatedAt);
    return getQueueSnapshot();
  }

  if (!Number.isFinite(id)) {
    throw new Error('缺少队列 ID。');
  }

  if (action === 'pin' || action === 'unpin') {
    console.log(`[queue] ${action} id=${id}`);
    songDb.prepare('UPDATE queue SET is_pinned = ?, pinned_at = ?, updated_at = ? WHERE id = ?')
      .run(action === 'pin' ? 1 : 0, action === 'pin' ? updatedAt : '', updatedAt, id);
    const snapshot = getQueueSnapshot();
    console.log('[queue] waiting order:', snapshot.waiting.map(item => `${item.id}:${item.song_name}(pinned=${item.is_pinned})`).join(', '));
    return snapshot;
  }

  if (action === 'delete' || action === 'done' || action === 'skip') {
    const status = action === 'delete' ? 'deleted' : (action === 'skip' ? 'skipped' : 'done');
    songDb.prepare('UPDATE queue SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updatedAt, id);
    return getQueueSnapshot();
  }

  throw new Error('未知队列操作。');
}

function ensureUnifiedQueue() {
  songDb.prepare(`
    UPDATE queue SET status = 'waiting', updated_at = ?
    WHERE status = 'current'
  `).run(now());
}

function clearActiveQueueOnStartup() {
  const updatedAt = now();
  const result = songDb.prepare(`
    UPDATE queue SET status = 'deleted', updated_at = ?
    WHERE status IN ('current', 'waiting')
  `).run(updatedAt);
  if (result.changes > 0) {
    console.log(`[Startup] cleared ${result.changes} old queue item(s).`);
  }
}

function handleDanmakuMessage({
  message,
  userName,
  uid,
  source,
  messageTimestamp,
  requesterGuardLevel,
  requesterMedalName,
  requesterMedalLevel,
  isPinned
}) {
  const text = cleanText(message);
  const settings = getSettings();
  const command = parseDanmakuCommand(text, settings);
  if (!command) {
    return { accepted: false, reason: '不是点歌指令。' };
  }

  if (settings.paused === 'true') {
    return { accepted: false, reason: '当前已暂停接收点歌。', command };
  }

  const cooldownSeconds = Number(settings.userCooldownSeconds || DEFAULT_SETTINGS.userCooldownSeconds);
  const cooldownKey = cleanText(uid) || cleanText(userName) || 'anonymous';
  const lastAt = cooldownByUser.get(cooldownKey) || 0;
  const elapsedSeconds = (Date.now() - lastAt) / 1000;
  if (cooldownSeconds > 0 && elapsedSeconds < cooldownSeconds) {
    return {
      accepted: false,
      reason: `用户冷却中，还需 ${Math.ceil(cooldownSeconds - elapsedSeconds)} 秒。`,
      command
    };
  }

  let queueItem;
  if (command.type === 'random') {
    const song = pickRandomSong(command.scopeText);
    if (!song) {
      return {
        accepted: false,
        reason: command.scopeText ? `没有找到歌手、风格或语言「${command.scopeText}」里的可随机歌曲。` : '歌库里还没有可随机歌曲。',
        command
      };
    }
    queueItem = addQueueItem({
      songName: song.name,
      artist: song.artist,
      categoryName: song.category_name,
      requesterName: userName,
      requesterUid: uid,
      requesterGuardLevel,
      requesterMedalName,
      requesterMedalLevel,
      source: randomSourceValue(command.scopeText),
      message: text,
      messageTimestamp,
      isPinned
    });
  } else {
    queueItem = addQueueItem({
      songName: command.songName,
      requesterName: userName,
      requesterUid: uid,
      requesterGuardLevel,
      requesterMedalName,
      requesterMedalLevel,
      source: source || 'danmaku',
      message: text,
      messageTimestamp,
      isPinned
    });
  }

  cooldownByUser.set(cooldownKey, Date.now());
  return { accepted: true, command, queueItem };
}

function parseDanmakuCommand(message, settings = getSettings()) {
  const text = cleanText(message);
  if (!text) return null;

  if (text.startsWith('随机点歌')) {
    return { type: 'random', scopeText: normalizeRandomScopeText(text.slice('随机点歌'.length)) };
  }

  if (text.startsWith('随机 ')) {
    return { type: 'random', scopeText: normalizeRandomScopeText(text.slice('随机 '.length)) };
  }

  if (text.startsWith('随机') && text !== '随机') {
    const scopeText = normalizeRandomScopeText(text.slice('随机'.length));
    if (scopeText && scopeText !== '点歌') {
      return { type: 'random', scopeText };
    }
  }

  if (!text.startsWith('点歌')) {
    return null;
  }

  const songName = cleanText(text.slice(2));
  if (!songName) return null;
  return { type: 'request', songName };
}

function findSong(songName, artist) {
  const cleanName = cleanText(songName);
  const cleanArtist = cleanText(artist);
  if (!cleanName) return null;

  if (cleanArtist) {
    const exact = songDb.prepare(`
      SELECT songs.*, song_categories.name AS category_name
      FROM songs
      LEFT JOIN song_categories ON song_categories.id = songs.category_id
      WHERE songs.name = ? AND songs.artist = ? AND songs.is_enabled = 1
      LIMIT 1
    `).get(cleanName, cleanArtist);
    if (exact) return exact;
  }

  return songDb.prepare(`
    SELECT songs.*, song_categories.name AS category_name
    FROM songs
    LEFT JOIN song_categories ON song_categories.id = songs.category_id
    WHERE songs.name = ? AND songs.is_enabled = 1
    ORDER BY songs.updated_at DESC
    LIMIT 1
  `).get(cleanName) || null;
}

function pickRandomSong(scopeText) {
  const rows = listRandomSongCandidates(scopeText);

  if (rows.length === 0) return null;

  const recentNames = new Set(songDb.prepare(`
    SELECT song_name FROM requests
    WHERE source = 'random' OR source LIKE 'random:%'
    ORDER BY datetime(created_at) DESC
    LIMIT 10
  `).all().map((row) => row.song_name));
  const candidates = rows.filter((row) => !recentNames.has(row.name));
  const pool = candidates.length > 0 ? candidates : rows;
  return pool[Math.floor(Math.random() * pool.length)];
}

function normalizeRandomScopeText(value) {
  let text = cleanText(value);
  while (text && '+＋:：-—'.includes(text[0])) {
    text = cleanText(text.slice(1));
  }
  return text;
}

function randomSourceValue(scopeText) {
  const scope = normalizeRandomScopeText(scopeText);
  return scope ? `random:${scope}` : 'random';
}

function randomLanguageAliases(scopeText) {
  const scope = cleanText(scopeText);
  const normalizedScope = scope.toLowerCase();
  const aliasGroups = [
    ['日语', '日文', '日本语', '日语歌', '日文歌', 'ja', 'jp', 'japanese'],
    ['韩语', '韩文', '韩国语', '韩语歌', '韩文歌', 'ko', 'kr', 'korean'],
    ['英语', '英文', '英语歌', '英文歌', 'en', 'english'],
    ['粤语', '粤文', '粤语歌', '粤文歌', 'cantonese'],
    ['国语', '中文', '汉语', '普通话', '华语', '国语歌', '中文歌', 'mandarin', 'chinese']
  ];

  const matchedGroup = aliasGroups.find((group) =>
    group.some((alias) => alias.toLowerCase() === normalizedScope)
  );
  return (matchedGroup || [scope]).map((item) => item.toLowerCase());
}

function listRandomSongCandidates(scopeText) {
  const scope = normalizeRandomScopeText(scopeText);
  if (!scope) {
    return songDb.prepare(`
      SELECT songs.*, song_categories.name AS category_name
      FROM songs
      LEFT JOIN song_categories ON song_categories.id = songs.category_id
      WHERE songs.is_enabled = 1
    `).all();
  }

  const artistRows = songDb.prepare(`
    SELECT songs.*, song_categories.name AS category_name
    FROM songs
    LEFT JOIN song_categories ON song_categories.id = songs.category_id
    WHERE songs.is_enabled = 1 AND songs.artist = ?
  `).all(scope);
  if (artistRows.length > 0) return artistRows;

  const categoryRows = songDb.prepare(`
    SELECT songs.*, song_categories.name AS category_name
    FROM songs
    JOIN song_categories ON song_categories.id = songs.category_id
    WHERE songs.is_enabled = 1 AND song_categories.is_enabled = 1 AND song_categories.name = ?
  `).all(scope);
  if (categoryRows.length > 0) return categoryRows;

  const languageAliases = randomLanguageAliases(scope);
  const placeholders = languageAliases.map(() => '?').join(', ');
  return songDb.prepare(`
    SELECT songs.*, song_categories.name AS category_name
    FROM songs
    LEFT JOIN song_categories ON song_categories.id = songs.category_id
    WHERE songs.is_enabled = 1 AND LOWER(TRIM(songs.language)) IN (${placeholders})
  `).all(...languageAliases);
}

function saveSong(input) {
  const name = cleanText(input.name || input.songName);
  if (!name) {
    throw new Error('歌曲名不能为空。');
  }
  const artist = cleanText(input.artist);
  const categoryName = cleanText(input.categoryName || input.category || '默认') || '默认';
  const categoryId = ensureCategory(categoryName).id;
  const initial = getInitial(name);
  const updatedAt = now();
  const enabled = input.isEnabled === undefined ? 1 : (input.isEnabled ? 1 : 0);
  const note = cleanText(input.note);
  const tags = cleanText(input.tags);
  const language = cleanText(input.language);
  const sourcePlatform = cleanText(input.sourcePlatform || input.source_platform);
  const originalGroup = cleanText(input.originalGroup || input.original_group);

  if (input.id) {
    songDb.prepare(`
      UPDATE songs
      SET name = ?, name_pinyin = ?, name_initial = ?, artist = ?, category_id = ?,
          is_enabled = ?, note = ?, tags = ?, language = ?, source_platform = ?,
          original_group = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      initial,
      initial,
      artist,
      categoryId,
      enabled,
      note,
      tags,
      language,
      sourcePlatform,
      originalGroup,
      updatedAt,
      Number(input.id)
    );
    return songDb.prepare('SELECT * FROM songs WHERE id = ?').get(Number(input.id));
  }

  const existing = songDb.prepare(`
    SELECT id FROM songs WHERE name = ? AND artist = ? LIMIT 1
  `).get(name, artist);
  if (existing) {
    songDb.prepare(`
      UPDATE songs
      SET category_id = ?, is_enabled = ?, note = ?, tags = ?, language = ?,
          source_platform = ?, original_group = ?, updated_at = ?
      WHERE id = ?
    `).run(categoryId, enabled, note, tags, language, sourcePlatform, originalGroup, updatedAt, existing.id);
    return songDb.prepare('SELECT * FROM songs WHERE id = ?').get(existing.id);
  }

  const result = songDb.prepare(`
    INSERT INTO songs (
      name, name_pinyin, name_initial, artist, category_id,
      is_enabled, note, tags, language, source_platform, original_group,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    initial,
    initial,
    artist,
    categoryId,
    enabled,
    note,
    tags,
    language,
    sourcePlatform,
    originalGroup,
    updatedAt,
    updatedAt
  );

  return songDb.prepare('SELECT * FROM songs WHERE id = ?').get(Number(result.lastInsertRowid));
}

function importSongs(rows) {
  const normalizedRows = rows.map(normalizeImportedSongRow);

  let inserted = 0;
  let duplicate = 0;
  let failed = 0;
  let createdCategories = 0;
  const failures = [];
  const knownCategories = new Set(listCategories().map((category) => category.name));

  songDb.exec('BEGIN');
  try {
    for (let index = 0; index < normalizedRows.length; index += 1) {
      const row = normalizedRows[index];
      if (!row.name) {
        failed += 1;
        failures.push({ row: index + 1, reason: '歌曲名字为空' });
        continue;
      }

      const existing = songDb.prepare(`
        SELECT id FROM songs WHERE name = ? AND artist = ? LIMIT 1
      `).get(row.name, row.artist);
      if (existing) {
        duplicate += 1;
        continue;
      }

      if (!knownCategories.has(row.categoryName)) {
        createdCategories += 1;
        knownCategories.add(row.categoryName);
      }
      const categoryId = ensureCategory(row.categoryName).id;
      const createdAt = now();
      const initial = getInitial(row.name);
      songDb.prepare(`
        INSERT INTO songs (
          name, name_pinyin, name_initial, artist, category_id,
          is_enabled, note, tags, language, source_platform, original_group,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.name,
        initial,
        initial,
        row.artist,
        categoryId,
        row.isEnabled ? 1 : 0,
        row.note,
        row.tags,
        row.language,
        row.sourcePlatform,
        row.originalGroup,
        createdAt,
        createdAt
      );
      inserted += 1;
    }

    songDb.prepare(`
      INSERT INTO import_batches (
        total_count, inserted_count, duplicate_count, failed_count,
        created_category_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(normalizedRows.length, inserted, duplicate, failed, createdCategories, now());
    songDb.exec('COMMIT');
  } catch (error) {
    songDb.exec('ROLLBACK');
    throw error;
  }

  return {
    total: normalizedRows.length,
    inserted,
    duplicate,
    failed,
    createdCategories,
    failures
  };
}

function listSongs({ query = '', category = '', language = '', artist = '', enabledOnly = false } = {}) {
  const conditions = [];
  const args = [];
  const cleanQuery = cleanText(query);
  const cleanCategory = cleanText(category);
  const cleanLanguage = cleanText(language);
  const cleanArtist = cleanText(artist);

  if (cleanQuery) {
    conditions.push('(songs.name LIKE ? OR songs.artist LIKE ?)');
    args.push(`%${cleanQuery}%`, `%${cleanQuery}%`);
  }
  if (cleanCategory) {
    conditions.push('song_categories.name = ?');
    args.push(cleanCategory);
  }
  if (cleanLanguage) {
    conditions.push('songs.language = ?');
    args.push(cleanLanguage);
  }
  if (cleanArtist) {
    conditions.push('songs.artist = ?');
    args.push(cleanArtist);
  }
  if (enabledOnly) {
    conditions.push('songs.is_enabled = 1');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = songDb.prepare(`
    SELECT songs.*, COALESCE(song_categories.name, '默认') AS category_name
    FROM songs
    LEFT JOIN song_categories ON song_categories.id = songs.category_id
    ${where}
    ORDER BY songs.name_initial ASC, songs.name COLLATE NOCASE ASC, songs.artist COLLATE NOCASE ASC
  `).all(...args);

  return rows.sort((a, b) => {
    const initialCompare = String(a.name_initial).localeCompare(String(b.name_initial), 'zh-Hans-CN');
    if (initialCompare !== 0) return initialCompare;
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN-u-co-pinyin');
  }).map((row) => ({
    ...row,
    is_enabled: Boolean(row.is_enabled)
  }));
}

function listCategories() {
  return songDb.prepare(`
    SELECT id, name, sort_order, is_enabled, created_at, updated_at
    FROM song_categories
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `).all().map((row) => ({
    ...row,
    is_enabled: Boolean(row.is_enabled)
  }));
}

function normalizeImportedSongRow(row) {
  return {
    name: cleanText(firstValue(row, SONG_IMPORT_ALIASES.name)),
    artist: cleanText(firstValue(row, SONG_IMPORT_ALIASES.artist)),
    categoryName: cleanText(firstValue(row, SONG_IMPORT_ALIASES.categoryName) || '默认') || '默认',
    note: cleanText(firstValue(row, SONG_IMPORT_ALIASES.note)),
    tags: cleanText(firstValue(row, SONG_IMPORT_ALIASES.tags)),
    isEnabled: parseEnabled(firstValue(row, SONG_IMPORT_ALIASES.isEnabled), true),
    language: cleanText(firstValue(row, SONG_IMPORT_ALIASES.language)),
    sourcePlatform: cleanText(firstValue(row, SONG_IMPORT_ALIASES.sourcePlatform)),
    originalGroup: cleanText(firstValue(row, SONG_IMPORT_ALIASES.originalGroup))
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && cleanText(row[key])) {
      return row[key];
    }
  }
  return '';
}

function parseEnabled(value, defaultValue) {
  const text = cleanText(value).toLowerCase();
  if (!text) return defaultValue;
  if (['是', '可点', '启用', 'true', 'yes', 'y', '1'].includes(text)) return true;
  if (['否', '不可点', '停用', 'false', 'no', 'n', '0'].includes(text)) return false;
  return defaultValue;
}

function ensureCategory(name) {
  const categoryName = cleanText(name) || '默认';
  const existing = songDb.prepare('SELECT * FROM song_categories WHERE name = ?').get(categoryName);
  if (existing) return existing;

  const createdAt = now();
  const result = songDb.prepare(`
    INSERT INTO song_categories (name, sort_order, is_enabled, created_at, updated_at)
    VALUES (?, 0, 1, ?, ?)
  `).run(categoryName, createdAt, createdAt);
  return songDb.prepare('SELECT * FROM song_categories WHERE id = ?').get(Number(result.lastInsertRowid));
}

function ensureSongColumns() {
  const columns = new Set(songDb.prepare('PRAGMA table_info(songs)').all().map((column) => column.name));
  const wanted = [
    ['tags', "TEXT NOT NULL DEFAULT ''"],
    ['language', "TEXT NOT NULL DEFAULT ''"],
    ['source_platform', "TEXT NOT NULL DEFAULT ''"],
    ['original_group', "TEXT NOT NULL DEFAULT ''"]
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) {
      songDb.exec(`ALTER TABLE songs ADD COLUMN ${name} ${definition}`);
    }
  }
}

function ensureQueueColumns() {
  const columns = new Set(songDb.prepare('PRAGMA table_info(queue)').all().map((column) => column.name));
  if (!columns.has('pinned_at')) {
    songDb.exec("ALTER TABLE queue ADD COLUMN pinned_at TEXT NOT NULL DEFAULT ''");
    songDb.prepare(`
      UPDATE queue SET pinned_at = updated_at
      WHERE is_pinned = 1 AND pinned_at = ''
    `).run();
  }
}

function ensureRequesterMetaColumns(tableName) {
  const columns = new Set(songDb.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
  const wanted = [
    ['requester_guard_level', 'INTEGER NOT NULL DEFAULT 0'],
    ['requester_medal_name', "TEXT NOT NULL DEFAULT ''"],
    ['requester_medal_level', 'INTEGER NOT NULL DEFAULT 0']
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) {
      songDb.exec(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
    }
  }
}

function ensureGiftColumns() {
  const columns = new Set(giftDb.prepare('PRAGMA table_info(gift_events)').all().map((column) => column.name));
  const wanted = [
    ['cmd', "TEXT NOT NULL DEFAULT ''"],
    ['is_blind_box', 'INTEGER NOT NULL DEFAULT 0'],
    ['blind_box_name', "TEXT NOT NULL DEFAULT ''"],
    ['blind_box_price', 'REAL'],
    ['blind_profit', 'REAL'],
    ['counted_in_sprint', 'INTEGER NOT NULL DEFAULT 0'],
    ['raw_json', "TEXT NOT NULL DEFAULT ''"]
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) {
      giftDb.exec(`ALTER TABLE gift_events ADD COLUMN ${name} ${definition}`);
    }
  }
}

function repairGiftV2Events() {
  const rows = giftDb.prepare(`
    SELECT *
    FROM gift_events
    WHERE status = 'active'
      AND cmd LIKE 'SEND_GIFT_V2%'
      AND total_price <= 0
      AND raw_json != ''
    ORDER BY id ASC
    LIMIT 200
  `).all();
  if (rows.length === 0) return;

  const statement = giftDb.prepare(`
    UPDATE gift_events
    SET platform_id = ?,
        gift_id = ?,
        gift_name = ?,
        uid = ?,
        user_name = ?,
        num = ?,
        unit_price = ?,
        total_price = ?,
        coin_type = ?,
        counted_in_sprint = ?,
        created_at = ?,
        updated_at = ?
    WHERE id = ?
  `);

  let repaired = 0;
  giftDb.exec('BEGIN');
  try {
    for (const row of rows) {
      const packet = safeParseJson(row.raw_json);
      const parsed = extractBilibiliGiftMessage(packet);
      const gift = parsed ? normalizeGiftInput(parsed) : null;
      if (!gift || gift.totalPrice <= 0) continue;

      statement.run(
        gift.platformId || cleanText(row.platform_id),
        gift.giftId || cleanText(row.gift_id),
        gift.giftName || cleanText(row.gift_name),
        gift.uid || cleanText(row.uid),
        gift.userName || cleanText(row.user_name),
        gift.num,
        gift.unitPrice,
        gift.totalPrice,
        gift.coinType || cleanText(row.coin_type),
        1,
        gift.createdAt || cleanText(row.created_at),
        now(),
        row.id
      );
      repaired += 1;
    }
    giftDb.exec('COMMIT');
  } catch (error) {
    giftDb.exec('ROLLBACK');
    throw error;
  }

  if (repaired > 0) {
    console.log(`[Startup] repaired ${repaired} SEND_GIFT_V2 gift record(s).`);
  }
}

function openSqliteDatabase(filePath, options = {}) {
  const database = new DatabaseSync(filePath);
  const pragmas = ['PRAGMA journal_mode = WAL'];
  if (options.foreignKeys === true) {
    pragmas.push('PRAGMA foreign_keys = ON');
  }
  database.exec(`${pragmas.join(';\n')};`);
  return database;
}

function migrateLegacySuperChatsToDedicatedDatabase() {
  const legacyTable = songDb.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'super_chats'
  `).get();
  if (!legacyTable) return;

  const rows = songDb.prepare('SELECT * FROM super_chats ORDER BY id ASC').all();
  if (rows.length === 0) return;

  let migrated = 0;
  superChatDb.exec('BEGIN');
  try {
    for (const row of rows) {
      const fingerprint = legacySuperChatFingerprint(row);
      const existing = superChatDb.prepare(`
        SELECT id
        FROM super_chats
        WHERE (platform_id != '' AND platform_id = ?)
           OR (platform_id = '' AND ? != '' AND uid = ? AND message = ? AND created_at = ?)
        LIMIT 1
      `).get(
        cleanText(row.platform_id),
        fingerprint,
        cleanText(row.uid),
        cleanText(row.message),
        cleanText(row.created_at)
      );
      if (existing) continue;

      superChatDb.prepare(`
        INSERT INTO super_chats (
          platform_id, uid, user_name, price, message,
          requester_guard_level, requester_medal_name, requester_medal_level,
          status, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cleanText(row.platform_id),
        cleanText(row.uid),
        cleanText(row.user_name) || '观众',
        normalizeSuperChatPrice(row.price),
        cleanText(row.message),
        normalizeGuardLevel(row.requester_guard_level),
        cleanText(row.requester_medal_name),
        normalizePositiveInteger(row.requester_medal_level),
        cleanText(row.status) || 'active',
        cleanText(row.source) || 'superchat',
        cleanText(row.created_at) || now(),
        cleanText(row.updated_at) || cleanText(row.created_at) || now()
      );
      migrated += 1;
    }
    superChatDb.exec('COMMIT');
  } catch (error) {
    superChatDb.exec('ROLLBACK');
    throw error;
  }

  if (migrated > 0) {
    console.log(`[Startup] migrated ${migrated} legacy super chat record(s) to ${SUPER_CHAT_DB_PATH}.`);
  }
}

function legacySuperChatFingerprint(row) {
  if (!row) return '';
  return [
    cleanText(row.uid),
    cleanText(row.message),
    cleanText(row.created_at)
  ].join('|');
}

function clearSongLibraryData() {
  songDb.exec('BEGIN');
  try {
    songDb.prepare('DELETE FROM songs').run();
    songDb.prepare('DELETE FROM song_categories').run();
    songDb.prepare('DELETE FROM import_batches').run();
    songDb.prepare(`
      DELETE FROM sqlite_sequence
      WHERE name IN ('songs', 'song_categories', 'import_batches')
    `).run();
    songDb.exec('COMMIT');
  } catch (error) {
    songDb.exec('ROLLBACK');
    throw error;
  }

  ensureCategory('默认');
  ensureUnifiedQueue();
  return {
    cleared: true,
    scope: 'song-library',
    preserved: ['settings', 'theme', 'roomId', 'queue', 'requestHistory']
  };
}

function clearSuperChatData() {
  superChatDb.exec('BEGIN');
  try {
    const result = superChatDb.prepare('SELECT COUNT(*) AS count FROM super_chats').get();
    const cleared = result ? result.count : 0;
    superChatDb.prepare('DELETE FROM super_chats').run();
    superChatDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'super_chats'").run();
    superChatDb.exec('COMMIT');
    return {
      cleared: true,
      scope: 'super-chats',
      deletedCount: cleared
    };
  } catch (error) {
    superChatDb.exec('ROLLBACK');
    throw error;
  }
}

function clearAllData() {
  const counts = { songs: 0, categories: 0, queue: 0, requests: 0, sc: 0, gifts: 0 };

  // Clear song DB tables except settings
  songDb.exec('BEGIN');
  try {
    counts.songs = (songDb.prepare('SELECT COUNT(*) AS count FROM songs').get() || {}).count || 0;
    counts.categories = (songDb.prepare('SELECT COUNT(*) AS count FROM song_categories').get() || {}).count || 0;
    counts.queue = (songDb.prepare("SELECT COUNT(*) AS count FROM queue WHERE status != 'deleted'").get() || {}).count || 0;
    counts.requests = (songDb.prepare('SELECT COUNT(*) AS count FROM requests').get() || {}).count || 0;

    songDb.prepare('DELETE FROM songs').run();
    songDb.prepare('DELETE FROM song_categories').run();
    songDb.prepare('DELETE FROM import_batches').run();
    songDb.prepare('DELETE FROM queue').run();
    songDb.prepare('DELETE FROM requests').run();
    songDb.prepare(`
      DELETE FROM sqlite_sequence
      WHERE name IN ('songs', 'song_categories', 'import_batches', 'queue', 'requests')
    `).run();
    songDb.exec('COMMIT');
  } catch (error) {
    songDb.exec('ROLLBACK');
    throw error;
  }

  ensureCategory('默认');

  // Clear SC database
  superChatDb.exec('BEGIN');
  try {
    counts.sc = (superChatDb.prepare('SELECT COUNT(*) AS count FROM super_chats').get() || {}).count || 0;
    superChatDb.prepare('DELETE FROM super_chats').run();
    superChatDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'super_chats'").run();
    superChatDb.exec('COMMIT');
  } catch (error) {
    superChatDb.exec('ROLLBACK');
    throw error;
  }

  // Clear gift database
  giftDb.exec('BEGIN');
  try {
    counts.gifts = (giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get() || {}).count || 0;
    giftDb.prepare('DELETE FROM gift_events').run();
    giftDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'gift_events'").run();
    giftDb.exec('COMMIT');
  } catch (error) {
    giftDb.exec('ROLLBACK');
    throw error;
  }

  return {
    cleared: true,
    scope: 'all',
    preserved: ['settings'],
    deletedCounts: counts,
    totalDeleted: Object.values(counts).reduce((a, b) => a + b, 0)
  };
}

function getSettings() {
  const rows = songDb.prepare('SELECT key, value FROM settings').all();
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function setSetting(key, value) {
  songDb.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now());
}

function clearLegacyIdentityRuleDefaults() {
  const legacyRules = {
    overlayRule3: '同一观众 10 秒冷却',
    overlayRule4: '按队列顺序演唱'
  };
  const updatedAt = now();
  for (const [key, oldValue] of Object.entries(legacyRules)) {
    songDb.prepare(`
      UPDATE settings
      SET value = '', updated_at = ?
      WHERE key = ? AND value = ?
    `).run(updatedAt, key, oldValue);
  }
}

function migrateQueueScrollSpeedSetting(version) {
  if (String(version || '') === '3') return;
  const row = songDb.prepare(`
    SELECT value
    FROM settings
    WHERE key = 'queueScrollSpeed'
  `).get();
  const savedSpeed = Number(row && row.value);
  const normalizedSpeed = Number.isFinite(savedSpeed) && savedSpeed > 100
    ? Math.round(1 + ((Math.max(50, Math.min(200, savedSpeed)) - 50) / 150) * 99)
    : Number.isFinite(savedSpeed)
      ? Math.max(1, Math.min(100, Math.round(savedSpeed)))
      : 62;
  const updatedAt = now();
  songDb.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('queueScrollSpeed', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(String(normalizedSpeed), updatedAt);
  songDb.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('queueScrollSpeedRangeVersion', '3', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(updatedAt);
}

function configureBilibiliListener() {
  const settings = getSettings();
  const roomId = normalizeRoomInput(settings.roomId);
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

  if (bilibiliClient && bilibiliClient.roomId === roomId) {
    return;
  }

  if (bilibiliClient) {
    bilibiliClient.stop();
  }

  bilibiliClient = new BilibiliDanmakuClient(roomId, {
    onMessage: (danmaku) => {
      try {
        const giftBotResult = handleGiftBotDanmaku(danmaku);
        if (giftBotResult && giftBotResult.item) {
          console.log(`[Bilibili] gift bot recorded: bot=${danmaku.userName || ''} user=${giftBotResult.item.user_name || ''} gift=${giftBotResult.item.gift_name || ''} x${giftBotResult.item.num || 1} totalRmb=${giftBotResult.item.total_price || 0}`);
          broadcastSnapshot('bilibili:gift-bot');
        }

        const result = handleDanmakuMessage({
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
        logDanmakuCommand(danmaku, result);
        if (result.accepted) {
          broadcastSnapshot(danmaku.source === 'superchat' ? 'bilibili:superchat' : 'bilibili:danmaku');
        }
      } catch (error) {
        console.warn(`[Bilibili] danmaku command failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} message=${JSON.stringify(danmaku.message)} error=${error.message}`);
      }
    },
    onSuperChat: (superChat) => {
      try {
        const item = addSuperChatItem({
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
        const item = addGiftEvent(gift);
        if (item) {
          console.log(`[Bilibili] gift recorded: cmd=${item.cmd || ''} blind=${item.is_blind_box ? 'yes' : 'no'} coin=${item.coin_type || ''} user=${item.user_name || ''} uid=${item.uid || ''} gift=${item.gift_name || ''} x${item.num || 1} totalRmb=${item.total_price || 0}`);
          broadcastSnapshot('bilibili:gift');
        }
      } catch (error) {
        console.warn(`[Bilibili] gift record failed: user=${gift.userName || ''} uid=${gift.uid || ''} gift=${gift.giftName || ''} error=${error.message}`);
      }
    },
    onStatus: updateLiveStatus
  });
  bilibiliClient.start();
}

function updateLiveStatus(nextStatus) {
  Object.assign(liveStatus, {
    ...nextStatus,
    updatedAt: now()
  });
  broadcastSnapshot('live:status');
}

function logDanmakuCommand(danmaku, result) {
  const message = cleanText(danmaku.message);
  if (!message.startsWith('点歌') && !message.startsWith('随机')) return;

  if (result.accepted) {
    console.log(`[Bilibili] command accepted: time=${formatLogTimestamp(danmaku.messageTimestamp)} source=${danmaku.source || 'danmaku'} user=${danmaku.userName || ''} uid=${danmaku.uid || ''} message=${JSON.stringify(message)} song=${result.queueItem ? result.queueItem.song_name : ''}`);
  } else {
    console.log(`[Bilibili] command ignored: time=${formatLogTimestamp(danmaku.messageTimestamp)} source=${danmaku.source || 'danmaku'} user=${danmaku.userName || ''} uid=${danmaku.uid || ''} message=${JSON.stringify(message)} reason=${result.reason || ''}`);
  }
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

class BilibiliDanmakuClient {
  constructor(roomId, handlers) {
    this.roomId = cleanText(roomId);
    this.handlers = handlers;
    this.stopped = true;
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.historyTimer = null;
    this.onlineRankTimer = null;
    this.seenCommandKeys = new Map();
    this.identityByUid = new Map();
    this.identityByName = new Map();
    this.startedAtMs = Date.now();
  }

  start() {
    this.stopped = false;
    this.startedAtMs = Date.now();
    this.connect().catch((error) => {
      console.warn(`[Bilibili] connect failed: ${error.message}`);
      const historyFallbackActive = Boolean(this.historyTimer);
      this.report({
        connected: historyFallbackActive,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: historyFallbackActive
          ? '直播弹幕长连失败，历史消息监听中'
          : publicBilibiliErrorMessage(error)
      });
      this.scheduleReconnect();
    });
  }

  stop() {
    this.stopped = true;
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.historyTimer);
    clearInterval(this.onlineRankTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {
        // Ignore shutdown errors.
      }
    }
  }

  async connect() {
    this.report({
      connected: false,
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      message: '正在连接 Bilibili 弹幕服务'
    });

    const roomInfo = await this.resolveRoomInfo();
    this.startHistoryPolling(roomInfo.roomId);
    this.startOnlineRankPolling(roomInfo.roomId, roomInfo.uid);
    const danmuInfo = await this.resolveDanmuInfo(roomInfo.roomId);
    const host = (danmuInfo.host_list || [])[0];
    if (!host) {
      throw new Error('没有可用的弹幕服务器。');
    }

    const wsUrl = `wss://${host.host}:${host.wss_port || 443}/sub`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.sendPacket(7, 1, {
        uid: 0,
        roomid: roomInfo.roomId,
        protover: 3,
        platform: 'web',
        type: 2,
        key: danmuInfo.token
      });
      this.heartbeatTimer = setInterval(() => this.sendPacket(2, 1, {}), 30000);
      const isLive = Number(roomInfo.liveStatus) === 1;
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: isLive
          ? `已连接直播间 ${roomInfo.roomId}`
          : `直播间 ${roomInfo.roomId} 未开播，历史消息监听中`
      });
      if (!isLive) {
        console.warn(`[Bilibili] room ${roomInfo.roomId} is not live. live_status=${roomInfo.liveStatus}. History polling fallback is enabled.`);
      }
    });

    ws.addEventListener('message', async (event) => {
      const data = event.data instanceof ArrayBuffer
        ? Buffer.from(event.data)
        : Buffer.from(await event.data.arrayBuffer());
      for (const message of parseBilibiliPackets(data)) {
        if (message.cmd && String(message.cmd).startsWith('DANMU_MSG')) {
          const info = message.info || [];
          const userInfo = info[2] || [];
          const userMeta = extractBilibiliDanmakuUserMeta(info);
          const text = String(info[1] || '');
          const messageTimestamp = extractBilibiliDanmakuTimestamp(info);
          if (isBilibiliCommandText(text) && !isCapturableBilibiliTimestamp(messageTimestamp, this.startedAtMs)) {
            continue;
          }
          if (isBilibiliCommandText(text) && !this.rememberCommandMessage({
            uid: userInfo[0],
            message: text,
            timestampMs: messageTimestamp
          })) {
            continue;
          }
          const requester = this.resolveRequesterIdentity({
            uid: userInfo[0],
            userName: String(userInfo[1] || '观众'),
            requesterGuardLevel: userMeta.guardLevel,
            requesterMedalName: userMeta.medalName,
            requesterMedalLevel: userMeta.medalLevel
          });
          this.handlers.onMessage({
            message: text,
            uid: requester.uid,
            userName: requester.userName,
            requesterGuardLevel: requester.guardLevel,
            requesterMedalName: requester.medalName,
            requesterMedalLevel: requester.medalLevel,
            source: 'danmaku',
            messageTimestamp
          });
        } else if (message.cmd && String(message.cmd).startsWith('SUPER_CHAT_MESSAGE')) {
          const superChat = extractBilibiliSuperChatMessage(message);
          const text = superChat.message;
          const requester = this.resolveRequesterIdentity({
            uid: superChat.uid,
            userName: superChat.userName,
            requesterGuardLevel: superChat.guardLevel,
            requesterMedalName: superChat.medalName,
            requesterMedalLevel: superChat.medalLevel
          });
          this.handlers.onSuperChat({
            id: superChat.id,
            message: text,
            price: superChat.price,
            uid: requester.uid,
            userName: requester.userName,
            requesterGuardLevel: requester.guardLevel,
            requesterMedalName: requester.medalName,
            requesterMedalLevel: requester.medalLevel,
            source: 'superchat',
            messageTimestamp: superChat.messageTimestamp
          });
          if (!isBilibiliCommandText(text)) {
            continue;
          }
          if (!isCapturableBilibiliTimestamp(superChat.messageTimestamp, this.startedAtMs)) {
            continue;
          }
          if (!this.rememberCommandMessage({
            uid: superChat.uid || superChat.id,
            message: text,
            timestampMs: superChat.messageTimestamp
          })) {
            continue;
          }
          this.handlers.onMessage({
            message: text,
            uid: requester.uid,
            userName: requester.userName,
            requesterGuardLevel: requester.guardLevel,
            requesterMedalName: requester.medalName,
            requesterMedalLevel: requester.medalLevel,
            source: 'superchat',
            messageTimestamp: superChat.messageTimestamp,
            isPinned: superChat.price >= SUPER_CHAT_PIN_THRESHOLD
          });
        } else if (isBilibiliGiftCommand(message.cmd)) {
          const gift = extractBilibiliGiftMessage(message);
          if (!gift) continue;
          const requester = this.resolveRequesterIdentity({
            uid: gift.uid,
            userName: gift.userName
          });
          this.handlers.onGift({
            ...gift,
            uid: requester.uid,
            userName: requester.userName
          });
        }
      }
    });

    ws.addEventListener('close', () => {
      clearInterval(this.heartbeatTimer);
      if (!this.stopped) {
        this.report({
          connected: Boolean(this.historyTimer),
          enabled: true,
          roomId: this.roomId,
          mode: 'bilibili',
          message: this.historyTimer ? '弹幕长连已断开，历史消息监听中' : '弹幕连接已断开，等待重连'
        });
        this.scheduleReconnect();
      }
    });

    ws.addEventListener('error', () => {
      this.report({
        connected: false,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '弹幕连接出现错误'
      });
    });
  }

  async resolveRoomInfo() {
    if (!this.roomId) {
      throw new Error('请填写 Bilibili 直播间号，或直接粘贴 https://live.bilibili.com/房间号。');
    }
    const { payload, response } = await this.fetchJson(
      'room_init',
      `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(this.roomId)}`
    );
    if (payload.code !== 0 || !payload.data || !payload.data.room_id) {
      throw new Error(formatBilibiliApiError('room_init', response, payload, '请确认填写的是直播间地址里的房间号，不是主播 UID、昵称或个人主页 ID。也可以直接粘贴 https://live.bilibili.com/房间号。'));
    }
    console.log(`[Bilibili] room resolved: input=${this.roomId} room_id=${payload.data.room_id} short_id=${payload.data.short_id || 0} uid=${payload.data.uid || ''} live_status=${payload.data.live_status}`);
    return {
      roomId: payload.data.room_id,
      shortId: payload.data.short_id || 0,
      uid: payload.data.uid || '',
      liveStatus: payload.data.live_status
    };
  }

  async resolveDanmuInfo(roomId) {
    const query = await signBilibiliWbiParams({ id: roomId, type: 0 }, this.requestHeaders());
    const { payload, response } = await this.fetchJson(
      'getDanmuInfo',
      `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${query}`
    );
    if (payload.code !== 0 || !payload.data) {
      throw new Error(formatBilibiliApiError('getDanmuInfo', response, payload, '这是获取弹幕服务器信息失败，不是点歌逻辑失败。常见原因是 B 站风控、WBI 签名变化、缺少登录 Cookie 或网络/IP 被风控。'));
    }
    return payload.data;
  }

  startHistoryPolling(roomId) {
    clearInterval(this.historyTimer);
    this.pollHistory(roomId).catch((error) => {
      console.warn(`[Bilibili] history polling failed: ${error.message}`);
    });
    this.historyTimer = setInterval(() => {
      this.pollHistory(roomId).catch((error) => {
        console.warn(`[Bilibili] history polling failed: ${error.message}`);
      });
    }, 2500);
  }

  startOnlineRankPolling(roomId, ruid) {
    clearInterval(this.onlineRankTimer);
    if (!roomId || !ruid) return;
    this.pollOnlineRank(roomId, ruid).catch((error) => {
      console.warn(`[Bilibili] online rank polling failed: ${error.message}`);
    });
    this.onlineRankTimer = setInterval(() => {
      this.pollOnlineRank(roomId, ruid).catch((error) => {
        console.warn(`[Bilibili] online rank polling failed: ${error.message}`);
      });
    }, BILIBILI_ONLINE_RANK_POLL_MS);
  }

  async pollOnlineRank(roomId, ruid) {
    if (this.stopped) return;
    let cachedCount = 0;

    for (let page = 1; page <= BILIBILI_ONLINE_RANK_MAX_PAGES; page += 1) {
      const url = `https://api.live.bilibili.com/xlive/general-interface/v1/rank/getOnlineGoldRank?roomId=${encodeURIComponent(roomId)}&ruid=${encodeURIComponent(ruid)}&page=${page}&pageSize=${BILIBILI_ONLINE_RANK_PAGE_SIZE}`;
      const { payload, response } = await this.fetchJson('online_gold_rank', url);
      if (payload.code !== 0 || !payload.data) {
        console.warn(formatBilibiliApiError('online_gold_rank', response, payload, '在线榜身份缓存获取失败。'));
        return;
      }

      const items = readBilibiliOnlineRankItems(payload.data);
      if (items.length === 0) break;

      for (const item of items) {
        if (this.rememberRequesterIdentity(extractBilibiliOnlineRankUserMeta(item))) {
          cachedCount += 1;
        }
      }

      const onlineNum = normalizePositiveInteger(payload.data.onlineNum || payload.data.online_num);
      if (items.length < BILIBILI_ONLINE_RANK_PAGE_SIZE) break;
      if (onlineNum > 0 && page * BILIBILI_ONLINE_RANK_PAGE_SIZE >= onlineNum) break;
    }

    this.cleanupRequesterIdentityCache();
    if (cachedCount > 0) {
      console.log(`[Bilibili] online rank cached ${cachedCount} viewer identity record(s).`);
    }
  }

  async pollHistory(roomId) {
    if (this.stopped) return;
    const { payload, response } = await this.fetchJson(
      'gethistory',
      `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${encodeURIComponent(roomId)}`
    );
    if (payload.code !== 0 || !payload.data) {
      console.warn(formatBilibiliApiError('gethistory', response, payload, '历史消息补偿监听失败。'));
      return;
    }

    const messages = []
      .concat(Array.isArray(payload.data.admin) ? payload.data.admin : [])
      .concat(Array.isArray(payload.data.room) ? payload.data.room : []);
    messages.sort((a, b) => parseBilibiliTimeline(a.timeline) - parseBilibiliTimeline(b.timeline));

    let processed = 0;
    for (const item of messages) {
      const text = cleanText(item.text);
      if (!text) continue;
      const timelineMs = parseBilibiliTimeline(item.timeline);
      if (!isBilibiliCommandText(text)) continue;
      if (!isCapturableBilibiliTimestamp(timelineMs, this.startedAtMs)) continue;
      if (!this.rememberCommandMessage({
        uid: item.uid,
        message: text,
        timestampMs: timelineMs
      })) {
        continue;
      }
      processed += 1;
      const userMeta = extractBilibiliHistoryUserMeta(item);
      const requester = this.resolveRequesterIdentity({
        uid: item.uid,
        userName: String(item.nickname || item.uname || '观众'),
        requesterGuardLevel: userMeta.guardLevel,
        requesterMedalName: userMeta.medalName,
        requesterMedalLevel: userMeta.medalLevel
      });
      this.handlers.onMessage({
        message: text,
        uid: requester.uid,
        userName: requester.userName,
        requesterGuardLevel: requester.guardLevel,
        requesterMedalName: requester.medalName,
        requesterMedalLevel: requester.medalLevel,
        source: 'history',
        messageTimestamp: timelineMs
      });
    }

    if (processed > 0) {
      console.log(`[Bilibili] history polling processed ${processed} command message(s).`);
    }
  }

  rememberCommandMessage({ uid, message, timestampMs }) {
    const key = buildBilibiliCommandKey(uid, message, timestampMs);
    if (!key) return false;
    if (this.seenCommandKeys.has(key)) return false;

    const receivedAt = Date.now();
    this.seenCommandKeys.set(key, receivedAt);
    if (this.seenCommandKeys.size > 1000) {
      const cutoff = receivedAt - 30 * 60 * 1000;
      for (const [seenKey, seenAt] of this.seenCommandKeys) {
        if (seenAt < cutoff || this.seenCommandKeys.size > 500) {
          this.seenCommandKeys.delete(seenKey);
        }
      }
    }
    return true;
  }

  resolveRequesterIdentity(input) {
    const uid = cleanText(input && input.uid);
    const userName = cleanText(input && input.userName) || '观众';
    const cached = this.lookupRequesterIdentity(uid, userName);
    const merged = mergeRequesterIdentity({
      uid,
      userName,
      guardLevel: normalizeGuardLevel(input && input.requesterGuardLevel),
      medalName: cleanText(input && input.requesterMedalName),
      medalLevel: normalizePositiveInteger(input && input.requesterMedalLevel)
    }, cached);
    this.rememberRequesterIdentity(merged);
    return merged;
  }

  lookupRequesterIdentity(uid, userName) {
    const nowMs = Date.now();
    const uidKey = cleanText(uid);
    const uidIdentity = uidKey ? this.identityByUid.get(uidKey) : null;
    if (uidIdentity && nowMs - uidIdentity.seenAt <= BILIBILI_IDENTITY_CACHE_MAX_AGE_MS) {
      return uidIdentity;
    }

    const nameKey = requesterNameKey(userName);
    const nameIdentity = nameKey ? this.identityByName.get(nameKey) : null;
    if (nameIdentity && nowMs - nameIdentity.seenAt <= BILIBILI_IDENTITY_CACHE_MAX_AGE_MS) {
      return nameIdentity;
    }
    return null;
  }

  rememberRequesterIdentity(input) {
    const identity = normalizeRequesterIdentity(input);
    if (!identity.uid && !identity.userName) return false;
    if (!identity.guardLevel && !identity.medalLevel && !identity.medalName) return false;

    const previous = this.lookupRequesterIdentity(identity.uid, identity.userName);
    const merged = {
      ...mergeRequesterIdentity(identity, previous),
      seenAt: Date.now()
    };

    if (merged.uid) this.identityByUid.set(merged.uid, merged);
    const nameKey = requesterNameKey(merged.userName);
    if (nameKey) this.identityByName.set(nameKey, merged);
    return true;
  }

  cleanupRequesterIdentityCache() {
    const cutoff = Date.now() - BILIBILI_IDENTITY_CACHE_MAX_AGE_MS;
    for (const [uid, identity] of this.identityByUid) {
      if (!identity || identity.seenAt < cutoff) this.identityByUid.delete(uid);
    }
    for (const [name, identity] of this.identityByName) {
      if (!identity || identity.seenAt < cutoff) this.identityByName.delete(name);
    }
  }

  async fetchJson(endpointName, url) {
    const quiet = endpointName === 'gethistory' || endpointName === 'online_gold_rank';
    if (!quiet) {
      console.log(`[Bilibili] request ${endpointName}: ${redactUrl(url)}`);
    }
    const response = await fetch(url, {
      headers: this.requestHeaders()
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new Error(`Bilibili API ${endpointName} returned non-JSON response. HTTP ${response.status}. Body: ${text.slice(0, 160)}`);
    }
    if (!quiet) {
      console.log(`[Bilibili] response ${endpointName}: http=${response.status} code=${payload.code} message=${payload.message || payload.msg || ''}`);
    }
    if (!response.ok) {
      throw new Error(formatBilibiliApiError(endpointName, response, payload, 'HTTP 请求失败。'));
    }
    return { payload, response };
  }

  requestHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Origin': 'https://live.bilibili.com',
      'Referer': `https://live.bilibili.com/${encodeURIComponent(this.roomId)}`
    };
  }

  sendPacket(operation, version, body) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const header = Buffer.alloc(16);
    header.writeUInt32BE(16 + payload.length, 0);
    header.writeUInt16BE(16, 4);
    header.writeUInt16BE(version, 6);
    header.writeUInt32BE(operation, 8);
    header.writeUInt32BE(1, 12);
    this.ws.send(Buffer.concat([header, payload]));
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.stopped) {
        this.connect().catch((error) => {
          console.warn(`[Bilibili] reconnect failed: ${error.message}`);
          const historyFallbackActive = Boolean(this.historyTimer);
          this.report({
            connected: historyFallbackActive,
            enabled: true,
            roomId: this.roomId,
            mode: 'bilibili',
            message: historyFallbackActive
              ? '直播弹幕长连重连失败，历史消息监听中'
              : publicBilibiliErrorMessage(error, true)
          });
          this.scheduleReconnect();
        });
      }
    }, 5000);
  }

  report(status) {
    this.handlers.onStatus(status);
  }
}

function parseBilibiliPackets(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 16 <= buffer.length) {
    const packetLength = buffer.readUInt32BE(offset);
    const headerLength = buffer.readUInt16BE(offset + 4);
    const protocolVersion = buffer.readUInt16BE(offset + 6);
    const operation = buffer.readUInt32BE(offset + 8);
    const bodyStart = offset + headerLength;
    const bodyEnd = offset + packetLength;
    const body = buffer.subarray(bodyStart, bodyEnd);

    if (operation === 5) {
      if (protocolVersion === 3) {
        try {
          messages.push(...parseBilibiliPackets(zlib.brotliDecompressSync(body)));
        } catch (error) {
          console.warn(`Bilibili brotli decode failed: ${error.message}`);
        }
      } else if (protocolVersion === 2) {
        try {
          messages.push(...parseBilibiliPackets(zlib.inflateSync(body)));
        } catch (error) {
          console.warn(`Bilibili zlib decode failed: ${error.message}`);
        }
      } else {
        const text = body.toString('utf8').trim();
        for (const chunk of splitJsonObjects(text)) {
          try {
            messages.push(JSON.parse(chunk));
          } catch (_) {
            // Ignore non-message packets.
          }
        }
      }
    }

    offset += packetLength > 0 ? packetLength : buffer.length;
  }
  return messages;
}

function splitJsonObjects(text) {
  if (!text) return [];
  const chunks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        chunks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return chunks;
}

function handleWebSocketUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    ''
  ].join('\r\n'));

  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => sockets.delete(socket));
  socket.on('data', (buffer) => handleWebSocketFrame(socket, buffer));
  sendWebSocket(socket, { type: 'snapshot', reason: 'connect', state: getState() });
}

function handleWebSocketFrame(socket, buffer) {
  if (!buffer.length) return;
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) {
    sendWebSocketFrame(socket, Buffer.alloc(0), 0x8);
    sockets.delete(socket);
    socket.end();
    return;
  }
  if (opcode === 0x9) {
    sendWebSocketFrame(socket, readWebSocketPayload(buffer), 0xA);
  }
}

function readWebSocketPayload(buffer) {
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  const masked = Boolean(buffer[1] & 0x80);
  let mask;
  if (masked) {
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked && mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return payload;
}

function broadcastSnapshot(reason) {
  const payload = { type: 'snapshot', reason, state: getState() };
  for (const socket of Array.from(sockets)) {
    sendWebSocket(socket, payload);
  }
}

function sendWebSocket(socket, payload) {
  sendWebSocketFrame(socket, Buffer.from(JSON.stringify(payload)), 0x1);
}

function sendWebSocketFrame(socket, payload, opcode) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function servePageOrAsset(req, res, requestUrl) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  const pageMap = new Map([
    ['/', 'admin.html'],
    ['/admin', 'admin.html'],
    ['/settings', 'admin.html'],
    ['/songs', 'admin.html'],
    ['/queue', 'overlay-queue.html'],
    ['/songlist', 'overlay-songs.html']
  ]);
  const assetPath = pageMap.get(requestUrl.pathname)
    || requestUrl.pathname.replace(/^\/+/, '');
  const resolvedPath = path.resolve(PUBLIC_DIR, assetPath);
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden.' });
    return;
  }

  fs.readFile(resolvedPath, (error, content) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType(resolvedPath),
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(content);
    }
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendCsv(res, filename, content) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store'
  });
  res.end(content);
}

function sendBuffer(res, status, contentTypeValue, filename, content) {
  res.writeHead(status, {
    'Content-Type': contentTypeValue,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': content.length,
    'Cache-Control': 'no-store'
  });
  res.end(content);
}

function buildSongsCsv(rows) {
  return [SONG_EXPORT_HEADERS.join(',')]
    .concat(rows.map((song) => songToExportRow(song).map(csvCell).join(',')))
    .join('\n');
}

function templateSongs() {
  return [
    {
      name: '晴天',
      artist: '周杰伦',
      category_name: '流行',
      note: '',
      tags: '周杰伦,原歌单',
      is_enabled: true,
      language: '国语',
      source_platform: '',
      original_group: '周杰伦'
    },
    {
      name: '小幸运',
      artist: '田馥甄',
      category_name: '甜歌',
      note: '',
      tags: '',
      is_enabled: true,
      language: '国语',
      source_platform: '',
      original_group: ''
    }
  ];
}

function songToExportRow(song) {
  return [
    song.name || '',
    song.artist || '',
    song.category_name || '默认',
    song.note || '',
    song.tags || '',
    song.is_enabled ? '是' : '否',
    song.language || '',
    song.source_platform || '',
    song.original_group || ''
  ];
}

function parseSongsFromXlsx(buffer) {
  if (!buffer.length) {
    throw new Error('Excel 文件为空。');
  }

  const files = readZipFiles(buffer);
  const worksheetEntry = Array.from(files.keys()).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!worksheetEntry) {
    throw new Error('Excel 文件里没有找到工作表。');
  }

  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml') || '');
  const table = parseWorksheetXml(files.get(worksheetEntry), sharedStrings);
  if (table.length === 0) return [];

  const header = table[0].map((cell) => cleanText(cell));
  const allAliases = Object.values(SONG_IMPORT_ALIASES).flat();
  const hasHeader = header.some((cell) => allAliases.includes(cell));
  const bodyRows = hasHeader ? table.slice(1) : table;
  const defaultHeader = SONG_EXPORT_HEADERS;

  return bodyRows.map((row) => {
    const output = {};
    const sourceHeader = hasHeader ? header : defaultHeader;
    for (let index = 0; index < sourceHeader.length; index += 1) {
      output[sourceHeader[index]] = row[index] || '';
    }
    return output;
  }).filter((row) => cleanText(firstValue(row, SONG_IMPORT_ALIASES.name)));
}

function parseWorksheetXml(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml))) {
    const row = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || cellMatch[3] || '';
      const body = cellMatch[2] || '';
      const ref = getXmlAttr(attrs, 'r');
      const columnIndex = ref ? columnNameToIndex(ref.replace(/\d+/g, '')) : row.length;
      row[columnIndex] = readWorksheetCell(attrs, body, sharedStrings);
    }
    if (row.some((cell) => cleanText(cell))) {
      rows.push(row.map((cell) => cell || ''));
    }
  }
  return rows;
}

function readWorksheetCell(attrs, body, sharedStrings) {
  const type = getXmlAttr(attrs, 't');
  if (type === 'inlineStr') {
    return extractXmlTexts(body).join('');
  }

  const valueMatch = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
  const value = valueMatch ? unescapeXml(valueMatch[1]) : '';
  if (type === 's') {
    return sharedStrings[Number(value)] || '';
  }
  if (type === 'b') {
    return value === '1' ? '是' : '否';
  }
  return value;
}

function parseSharedStrings(xml) {
  const values = [];
  const stringRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = stringRegex.exec(xml))) {
    values.push(extractXmlTexts(match[1]).join(''));
  }
  return values;
}

function extractXmlTexts(xml) {
  const values = [];
  const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match;
  while ((match = textRegex.exec(xml))) {
    values.push(unescapeXml(match[1]));
  }
  return values;
}

function readZipFiles(buffer) {
  const files = new Map();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error('Excel 文件不是有效的 .xlsx 格式。');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Excel 文件 ZIP 中央目录损坏。');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const filename = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Excel 文件 ZIP 本地头损坏：${filename}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      files.set(filename, compressedData.toString('utf8'));
    } else if (method === 8) {
      files.set(filename, zlib.inflateRawSync(compressedData).toString('utf8'));
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function buildSongsWorkbook(rows) {
  const tableRows = [SONG_EXPORT_HEADERS].concat(rows.map(songToExportRow));
  const sheetRows = tableRows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((cell, columnIndex) => {
      const cellName = `${columnName(columnIndex)}${rowNumber}`;
      return `<c r="${cellName}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
    }).join('');
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join('');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/>
    <col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="16" customWidth="1"/>
    <col min="4" max="9" width="20" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;

  return createZip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="歌库" sheetId="1" r:id="rId1"/></sheets>
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`],
    ['xl/worksheets/sheet1.xml', sheetXml]
  ]);
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const [filename, content] of files) {
    const name = Buffer.from(filename, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function listenWithFallback(startPort, host = HOST) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    const ok = await tryListen(port, host);
    if (ok) return port;
  }
  throw new Error(`No available local port from ${startPort} to ${startPort + 19}.`);
}

function tryListen(port, host = HOST) {
  return new Promise((resolve) => {
    const onError = () => {
      server.off('listening', onListening);
      resolve(false);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function cleanupOwnPortOccupant(port, host = HOST) {
  if (port !== 3000) return;

  const health = await readLocalHealth(port, host);
  if (!health || !health.ok || !isOwnServiceHealth(health.data)) return;

  console.log(`Found previous song helper service on ${host}:${port}; asking it to shut down...`);
  await requestLocalShutdown(port, host);
  if (await waitForPortRelease(port, host, PORT_CLEANUP_TIMEOUT_MS)) return;

  const pid = Number(health.data && health.data.pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;

  const processInfo = getProcessInfo(pid);
  if (!isOwnProcessInfo(processInfo)) return;

  console.log(`Previous service did not exit cleanly; stopping pid ${pid}.`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    console.warn(`Could not stop previous service pid ${pid}: ${error.message}`);
    return;
  }
  await waitForPortRelease(port, host, PORT_CLEANUP_TIMEOUT_MS);
}

async function readLocalHealth(port, host = HOST) {
  try {
    const response = await fetch(`http://${toLocalHost(host)}:${port}/api/health`, {
      signal: AbortSignal.timeout(500)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function requestLocalShutdown(port, host = HOST) {
  try {
    await fetch(`http://${toLocalHost(host)}:${port}/api/system/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
      signal: AbortSignal.timeout(500)
    });
  } catch (_) {
    // The previous process can close the connection while shutting down.
  }
}

async function waitForPortRelease(port, host = HOST, timeoutMs = PORT_CLEANUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await canConnectToPort(port, host))) return true;
    await sleep(PORT_CLEANUP_POLL_MS);
  }
  return false;
}

function canConnectToPort(port, host = HOST) {
  return new Promise((resolve) => {
    const req = http.request({
      host: toLocalHost(host),
      port,
      path: '/api/health',
      method: 'GET',
      timeout: 250
    }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function isOwnServiceHealth(data) {
  if (!data || typeof data !== 'object') return false;
  const healthRoot = normalizePathForCompare(data.rootDir);
  const healthData = normalizePathForCompare(data.dataDir);
  const ownRoot = normalizePathForCompare(ROOT_DIR);
  const ownData = normalizePathForCompare(DATA_DIR);

  return (healthRoot && healthRoot === ownRoot)
    || (healthData && healthData === ownData);
}

function getProcessInfo(pid) {
  if (process.platform !== 'win32') return null;
  try {
    const output = childProcess.execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -First 1 ExecutablePath,CommandLine | ConvertTo-Json -Compress`
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 1200
    });
    return output.trim() ? JSON.parse(output) : null;
  } catch (_) {
    return null;
  }
}

function isOwnProcessInfo(info) {
  if (!info || typeof info !== 'object') return false;
  const executablePath = normalizePathForCompare(info.ExecutablePath || '');
  const commandLine = String(info.CommandLine || '').toLowerCase();
  const ownRoot = normalizePathForCompare(ROOT_DIR);

  return (executablePath && executablePath.endsWith('\\点歌助手.exe'))
    || (ownRoot && commandLine.includes(ownRoot.toLowerCase()))
    || commandLine.includes('src\\server.js')
    || commandLine.includes('src/server.js');
}

function toLocalHost(host) {
  return host === 'localhost' ? '127.0.0.1' : host;
}

function normalizePathForCompare(value) {
  if (!value) return '';
  return path.resolve(String(value)).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function normalizeMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeSignedMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeNullableMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  return normalizeMoney(value);
}

function normalizeBilibiliGiftCoin(value) {
  if (typeof value === 'string') {
    const match = value.match(/[\d.]+/);
    return match ? Number(match[0]) : 0;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeGuardLevel(value) {
  const level = normalizePositiveInteger(value);
  return [1, 2, 3].includes(level) ? level : 0;
}

function normalizeRoomInput(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^\d+$/.test(text)) return text;

  const decoded = decodeURIComponent(text);
  const explicitPatterns = [
    /live\.bilibili\.com\/(?:blanc\/)?(\d+)/i,
    /[?&](?:room_id|id)=(\d+)/i
  ];
  for (const pattern of explicitPatterns) {
    const match = decoded.match(pattern);
    if (match) return match[1];
  }

  const looseDigits = decoded.match(/\d{3,}/);
  return looseDigits ? looseDigits[0] : '';
}

async function signBilibiliWbiParams(params, headers) {
  const mixinKey = await getBilibiliWbiMixinKey(headers);
  const signedParams = {
    ...params,
    wts: Math.floor(Date.now() / 1000)
  };
  const query = Object.keys(signedParams)
    .sort()
    .map((key) => {
      const value = String(signedParams[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

async function getBilibiliWbiMixinKey(headers) {
  const nowMs = Date.now();
  if (wbiKeyCache && wbiKeyCache.expiresAt > nowMs) {
    return wbiKeyCache.mixinKey;
  }

  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error(`Bilibili WBI key request returned non-JSON response. HTTP ${response.status}. Body: ${text.slice(0, 160)}`);
  }

  console.log(`[Bilibili] response wbi_nav: http=${response.status} code=${payload.code} message=${payload.message || ''}`);
  const imageInfo = payload.data && payload.data.wbi_img;
  if (!response.ok || !imageInfo || !imageInfo.img_url || !imageInfo.sub_url) {
    throw new Error(formatBilibiliApiError('wbi_nav', response, payload, '获取 WBI 签名参数失败，后续弹幕服务器请求可能会被 B 站风控拒绝。'));
  }
  if (payload.code !== 0) {
    console.log('[Bilibili] wbi_nav returned a non-zero code, but WBI image keys are present; continuing with signature generation.');
  }

  const imgKey = extractBilibiliWbiKey(imageInfo.img_url);
  const subKey = extractBilibiliWbiKey(imageInfo.sub_url);
  const rawKey = `${imgKey}${subKey}`;
  const mixinKey = WBI_MIXIN_KEY_ENC_TAB.map((index) => rawKey[index]).join('').slice(0, 32);
  wbiKeyCache = {
    mixinKey,
    expiresAt: nowMs + 10 * 60 * 1000
  };
  return mixinKey;
}

function extractBilibiliWbiKey(url) {
  const pathname = new URL(url).pathname;
  const filename = pathname.split('/').pop() || '';
  return filename.split('.')[0] || '';
}

function formatBilibiliApiError(endpointName, response, payload, extraHint) {
  const code = payload && payload.code;
  const message = (payload && (payload.message || payload.msg)) || '未知错误';
  const hint = bilibiliErrorHint(code);
  const data = payload && payload.data ? ` data=${JSON.stringify(payload.data).slice(0, 220)}` : '';
  return `Bilibili API ${endpointName} failed: http=${response.status} code=${code} message=${message}. ${hint}${extraHint ? ` ${extraHint}` : ''}${data}`;
}

function bilibiliErrorHint(code) {
  if (Number(code) === -352) {
    return '原因：B 站风控/校验失败，通常与 WBI 签名、正常浏览器请求头、Cookie/设备标识或当前网络/IP 风控有关。';
  }
  if (Number(code) === 60004) {
    return '原因：直播间不存在或填写的不是直播间号。';
  }
  if (Number(code) === -400) {
    return '原因：请求参数错误。';
  }
  if (Number(code) === -412) {
    return '原因：请求被风控拦截。';
  }
  return '原因：B 站接口返回了非成功业务码。';
}

function publicBilibiliErrorMessage(error, isReconnect = false) {
  const prefix = isReconnect ? '重连失败' : '连接失败';
  const message = error && error.message ? error.message : String(error);
  if (message.includes('code=-352')) {
    return `${prefix}：B站风控/校验失败（-352），请看启动窗口详情。`;
  }
  if (message.includes('code=-101')) {
    return `${prefix}：B站要求登录信息，请看启动窗口详情。`;
  }
  if (message.includes('code=60004')) {
    return `${prefix}：直播间不存在，请检查房间号。`;
  }
  if (message.includes('room_init')) {
    return `${prefix}：直播间信息获取失败，请检查房间号。`;
  }
  if (message.includes('getDanmuInfo')) {
    return `${prefix}：弹幕连接信息获取失败，请看启动窗口详情。`;
  }
  if (message.includes('wbi_nav')) {
    return `${prefix}：B站签名参数获取失败，请看启动窗口详情。`;
  }
  return `${prefix}：${message.slice(0, 80)}`;
}

function isBilibiliCommandText(message) {
  const text = cleanText(message);
  return text.startsWith('点歌') || text.startsWith('随机');
}

function isCapturableBilibiliTimestamp(timestampMs, startedAtMs) {
  const timestamp = normalizeTimestampMs(timestampMs);
  if (!timestamp) return false;
  const currentTime = Date.now();
  if (timestamp < startedAtMs - 5000) return false;
  if (timestamp < currentTime - HISTORY_MESSAGE_MAX_AGE_MS) return false;
  if (timestamp > currentTime + 5 * 60 * 1000) return false;
  return true;
}

function buildBilibiliCommandKey(uid, message, timestampMs) {
  const text = cleanText(message);
  if (!text) return '';
  const normalizedTimestamp = normalizeTimestampMs(timestampMs) || Date.now();
  const secondBucket = Math.floor(normalizedTimestamp / 1000);
  return `${cleanText(uid)}|${secondBucket}|${text}`;
}

function extractBilibiliDanmakuTimestamp(info) {
  const metadata = Array.isArray(info) && Array.isArray(info[0]) ? info[0] : [];
  const candidates = [metadata[4], metadata[5], metadata[6]];
  const nowMs = Date.now();
  for (const candidate of candidates) {
    const timestamp = normalizeTimestampMs(candidate);
    if (timestamp && Math.abs(timestamp - nowMs) < 30 * 24 * 60 * 60 * 1000) {
      return timestamp;
    }
  }
  return nowMs;
}

function extractBilibiliDanmakuUserMeta(info) {
  const medalInfo = Array.isArray(info) ? info[3] : null;
  const extraInfo = Array.isArray(info) ? info[9] : null;
  return {
    guardLevel: normalizeGuardLevel(
      readObjectValue(extraInfo, ['guard_level', 'guardLevel'])
      || (Array.isArray(info) ? info[7] : 0)
    ),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo)
  };
}

function extractBilibiliHistoryUserMeta(item) {
  const medalInfo = item && (item.medal || item.fans_medal || item.fansMedal || item.medal_info || item.medalInfo);
  return {
    guardLevel: normalizeGuardLevel(readObjectValue(item, ['guard_level', 'guardLevel', 'guard_level_v2'])),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo)
  };
}

function extractBilibiliSuperChatMessage(packet) {
  const data = packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  const userInfo = data.user_info || data.userInfo || {};
  const medalInfo = data.medal_info || data.medalInfo || userInfo.medal_info || userInfo.medalInfo;
  const messageTimestamp = normalizeTimestampMs(
    readObjectValue(data, ['start_time', 'startTime', 'ts', 'time', 'timestamp'])
  ) || Date.now();

  return {
    id: cleanText(readObjectValue(data, ['id', 'message_id', 'messageId', 'token'])),
    message: cleanText(readObjectValue(data, ['message', 'message_trans', 'messageTrans'])),
    price: normalizeSuperChatPrice(readObjectValue(data, ['price', 'rmb', 'price_text', 'priceText'])),
    uid: cleanText(readObjectValue(data, ['uid', 'mid']) || readObjectValue(userInfo, ['uid', 'mid'])),
    userName: cleanText(
      readObjectValue(userInfo, ['uname', 'name', 'user_name', 'userName'])
      || readObjectValue(data, ['uname', 'name', 'nickname'])
    ) || '观众',
    guardLevel: normalizeGuardLevel(
      readObjectValue(medalInfo, ['guard_level', 'guardLevel'])
      || readObjectValue(userInfo, ['guard_level', 'guardLevel'])
      || readObjectValue(data, ['guard_level', 'guardLevel'])
    ),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo),
    messageTimestamp
  };
}

function isBilibiliGiftCommand(cmd) {
  const text = String(cmd || '');
  return text.startsWith('SEND_GIFT')
    || text.startsWith('BLIND_GIFT')
    || text.startsWith('COMBO_SEND');
}

function extractBilibiliGiftMessage(packet) {
  const data = packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  if (!data || Object.keys(data).length === 0) return null;

  const cmd = cleanText(packet && packet.cmd);
  if (cmd.startsWith('SEND_GIFT_V2') && data.pb) {
    const parsedV2 = extractBilibiliGiftV2Message(packet, data);
    if (parsedV2) return parsedV2;
  }

  const blindInfo = readFirstObject(data, ['blind_gift', 'blindGift', 'blind_box', 'blindBox', 'origin_info', 'originInfo']);
  const num = normalizePositiveInteger(readObjectValue(data, ['num', 'gift_num', 'giftNum', 'combo_num', 'comboNum'])) || 1;
  const coinType = cleanText(readObjectValue(data, ['coin_type', 'coinType', 'coin']));
  const unitCoin = normalizeBilibiliGiftCoin(readObjectValue(data, [
    'price',
    'gift_price',
    'giftPrice',
    'discount_price',
    'discountPrice'
  ]));
  const totalCoin = normalizeBilibiliGiftCoin(readObjectValue(data, [
    'total_coin',
    'totalCoin',
    'total_price',
    'totalPrice',
    'combo_total_coin',
    'comboTotalCoin'
  ]));
  const unitPrice = coinType === 'silver' ? 0 : normalizeMoney(unitCoin / 1000);
  const totalPrice = coinType === 'silver'
    ? 0
    : normalizeMoney((totalCoin > 0 ? totalCoin : unitCoin * num) / 1000);
  const blindBoxCoin = normalizeBilibiliGiftCoin(
    readObjectValue(blindInfo, [
      'original_gift_price',
      'originalGiftPrice',
      'price',
      'gift_price',
      'giftPrice',
      'original_price',
      'originalPrice'
    ])
    || readObjectValue(data, [
      'blind_original_gift_price',
      'blindOriginalGiftPrice',
      'blind_price',
      'blindPrice',
      'blind_box_price',
      'blindBoxPrice',
      'original_gift_price',
      'originalGiftPrice',
      'original_price',
      'originalPrice'
    ])
  );
  const blindBoxPrice = blindBoxCoin > 0 ? normalizeMoney(blindBoxCoin * num / 1000) : null;
  const isBlindBox = cmd.startsWith('BLIND_GIFT')
    || Boolean(blindInfo && Object.keys(blindInfo).length > 0)
    || Boolean(readObjectValue(data, ['blind_gift_id', 'blindGiftId', 'blind_box_id', 'blindBoxId']));

  return {
    platformId: cleanText(readObjectValue(data, [
      'tid',
      'gift_tid',
      'giftTid',
      'batch_combo_id',
      'batchComboId',
      'combo_id',
      'comboId'
    ])),
    cmd,
    giftId: cleanText(readObjectValue(data, ['giftId', 'gift_id', 'giftid'])),
    giftName: cleanText(readObjectValue(data, ['giftName', 'gift_name'])) || '未知礼物',
    uid: cleanText(readObjectValue(data, ['uid', 'mid', 'sender_uid', 'senderUid'])),
    userName: cleanText(readObjectValue(data, ['uname', 'user_name', 'userName', 'nickname'])) || '观众',
    num,
    unitPrice,
    totalPrice,
    coinType,
    isBlindBox,
    blindBoxName: cleanText(
      readObjectValue(blindInfo, [
        'original_gift_name',
        'originalGiftName',
        'gift_name',
        'giftName',
        'name'
      ])
      || readObjectValue(data, [
        'blind_original_gift_name',
        'blindOriginalGiftName',
        'blind_gift_name',
        'blindGiftName',
        'blind_box_name',
        'blindBoxName'
      ])
    ),
    blindBoxPrice,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(readObjectValue(data, ['timestamp', 'ts', 'time'])) || Date.now()
  };
}

function extractBilibiliGiftV2Message(packet, data) {
  const root = decodeBilibiliGiftV2Proto(data.pb);
  if (!root) return null;

  const giftInfo = firstProtoObject(root[10]);
  if (!giftInfo) return null;

  const cmd = cleanText(packet && packet.cmd);
  const giftId = cleanText(firstProtoScalar(giftInfo[1]));
  const giftName = cleanText(firstProtoScalar(giftInfo[2])) || '未知礼物';
  const num = normalizePositiveInteger(firstProtoScalar(giftInfo[3]) || firstProtoScalar(giftInfo[4])) || 1;
  const coinType = cleanText(firstProtoScalar(giftInfo[8]));
  const unitCoin = normalizeBilibiliGiftCoin(
    firstProtoScalar(giftInfo[5])
    || firstProtoScalar(giftInfo[6])
  );
  const totalCoin = normalizeBilibiliGiftCoin(
    firstProtoScalar(giftInfo[7])
    || firstProtoScalar(giftInfo[14])
  );
  const unitPrice = coinType === 'silver' ? 0 : normalizeMoney(unitCoin / 1000);
  const totalPrice = coinType === 'silver'
    ? 0
    : normalizeMoney((totalCoin > 0 ? totalCoin : unitCoin * num) / 1000);
  const timestamp = firstProtoScalar(giftInfo[10]);
  const comboId = cleanText(firstProtoScalar(giftInfo[12]));
  const tid = cleanText(firstProtoScalar(giftInfo[9]));

  return {
    platformId: tid || comboId,
    cmd,
    giftId,
    giftName,
    uid: cleanText(firstProtoScalar(root[1])),
    userName: cleanText(firstProtoScalar(root[2])) || '观众',
    num,
    unitPrice,
    totalPrice,
    coinType,
    isBlindBox: false,
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(timestamp) || Date.now()
  };
}

function extractBilibiliOnlineRankUserMeta(item) {
  const medalInfo = item && (
    item.medalInfo
    || item.medal_info
    || item.medal
    || item.fans_medal
    || item.fansMedal
    || item.uinfo_medal
  );
  const guardInfo = item && (item.guard || item.guard_info || item.guardInfo);
  return {
    uid: cleanText(readObjectValue(item, ['uid', 'mid'])),
    userName: cleanText(readObjectValue(item, ['name', 'uname', 'nickname'])),
    guardLevel: normalizeGuardLevel(
      readObjectValue(medalInfo, ['guardLevel', 'guard_level'])
      || readObjectValue(item, ['guard_level', 'guardLevel'])
      || readObjectValue(guardInfo, ['level', 'guardLevel', 'guard_level'])
    ),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo)
  };
}

function normalizeSuperChatPrice(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const match = String(value || '').match(/[\d.]+/);
  return match ? Number(match[0]) || 0 : 0;
}

function readBilibiliOnlineRankItems(data) {
  if (!data || typeof data !== 'object') return [];
  const candidates = [
    data.OnlineRankItem,
    data.onlineRankItem,
    data.online_rank_item,
    data.list,
    data.items
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function normalizeRequesterIdentity(input) {
  return {
    uid: cleanText(input && input.uid),
    userName: cleanText(input && input.userName),
    guardLevel: normalizeGuardLevel(input && input.guardLevel),
    medalName: cleanText(input && input.medalName),
    medalLevel: normalizePositiveInteger(input && input.medalLevel),
    seenAt: normalizePositiveInteger(input && input.seenAt)
  };
}

function mergeRequesterIdentity(primary, fallback) {
  const base = normalizeRequesterIdentity(primary);
  const extra = normalizeRequesterIdentity(fallback);
  return {
    uid: base.uid || extra.uid,
    userName: base.userName || extra.userName,
    guardLevel: base.guardLevel || extra.guardLevel,
    medalName: base.medalName || extra.medalName,
    medalLevel: base.medalLevel || extra.medalLevel,
    seenAt: Math.max(base.seenAt, extra.seenAt)
  };
}

function requesterNameKey(value) {
  return cleanText(value).toLowerCase();
}

function readMedalName(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return cleanText(medalInfo[1]);
  }
  return cleanText(readObjectValue(medalInfo, ['medal_name', 'medalName', 'name']));
}

function readMedalLevel(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return normalizePositiveInteger(medalInfo[0]);
  }
  return normalizePositiveInteger(readObjectValue(medalInfo, ['medal_level', 'medalLevel', 'level']));
}

function decodeBilibiliGiftV2Proto(value) {
  try {
    const buffer = Buffer.from(cleanText(value), 'base64');
    if (buffer.length === 0) return null;
    return decodeBilibiliProtoFields(buffer, 0);
  } catch (_) {
    return null;
  }
}

function decodeBilibiliProtoFields(buffer, depth = 0) {
  let offset = 0;
  const fields = {};

  while (offset < buffer.length) {
    const keyResult = readBilibiliProtoVarint(buffer, offset);
    if (!keyResult) return null;
    offset = keyResult.offset;

    const key = Number(keyResult.value);
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (!field || ![0, 1, 2, 5].includes(wireType)) return null;

    let value;
    if (wireType === 0) {
      const result = readBilibiliProtoVarint(buffer, offset);
      if (!result) return null;
      value = result.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result.value) : result.value.toString();
      offset = result.offset;
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) return null;
      value = buffer.subarray(offset, offset + 8);
      offset += 8;
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) return null;
      value = buffer.subarray(offset, offset + 4);
      offset += 4;
    } else {
      const lengthResult = readBilibiliProtoVarint(buffer, offset);
      if (!lengthResult) return null;
      const length = Number(lengthResult.value);
      offset = lengthResult.offset;
      if (!Number.isFinite(length) || length < 0 || offset + length > buffer.length) return null;

      const chunk = buffer.subarray(offset, offset + length);
      offset += length;
      const nested = depth < 5 ? decodeBilibiliProtoFields(chunk, depth + 1) : null;
      value = nested && Object.keys(nested).length > 0 ? nested : chunk.toString('utf8');
    }

    if (!fields[field]) fields[field] = [];
    fields[field].push(value);
  }

  return fields;
}

function readBilibiliProtoVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  let index = offset;

  while (index < buffer.length && shift <= 63n) {
    const byte = BigInt(buffer[index]);
    index += 1;
    value |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) {
      return { value, offset: index };
    }
    shift += 7n;
  }

  return null;
}

function firstProtoScalar(values) {
  if (!Array.isArray(values)) return '';
  const value = values.find((item) => item !== null && item !== undefined && typeof item !== 'object');
  return value === undefined ? '' : value;
}

function firstProtoObject(values) {
  if (!Array.isArray(values)) return null;
  return values.find((item) => item && typeof item === 'object' && !Buffer.isBuffer(item)) || null;
}

function readObjectValue(value, keys) {
  if (!value || typeof value !== 'object') return '';
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) {
      return value[key];
    }
  }
  return '';
}

function readFirstObject(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] && typeof value[key] === 'object') {
      return value[key];
    }
  }
  return null;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value || {});
  } catch (_) {
    return '{}';
  }
}

function safeParseJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (_) {
    return {};
  }
}

function parseBilibiliTimeline(value) {
  return normalizeTimestampMs(value);
}

function normalizeTimestampMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > 1000000000000) return Math.floor(numeric);
    if (numeric > 1000000000) return Math.floor(numeric * 1000);
  }

  const text = cleanText(value);
  if (!text) return 0;
  const normalizedText = text.includes('T') ? text : `${text.replace(' ', 'T')}+08:00`;
  const timestamp = Date.parse(normalizedText);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function timestampToIso(value) {
  const timestamp = normalizeTimestampMs(value);
  return timestamp ? new Date(timestamp).toISOString() : '';
}

function formatLogTimestamp(value) {
  const timestamp = normalizeTimestampMs(value);
  return timestamp ? new Date(timestamp).toISOString() : '';
}

function redactUrl(url) {
  return String(url).replace(/(w_rid=)[^&]+/g, '$1<redacted>');
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function now() {
  return new Date().toISOString();
}

function csvCell(value) {
  const text = String(value || '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => decodeXmlCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeXmlCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function decodeXmlCodePoint(codePoint) {
  return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : '';
}

function getXmlAttr(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? unescapeXml(match[1]) : '';
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function columnNameToIndex(name) {
  let value = 0;
  for (const char of String(name || '').toUpperCase()) {
    value = value * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, value - 1);
}

function dosDateTime(dateValue) {
  const year = Math.max(1980, dateValue.getFullYear());
  return {
    time: (dateValue.getHours() << 11) | (dateValue.getMinutes() << 5) | Math.floor(dateValue.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((dateValue.getMonth() + 1) << 5) | dateValue.getDate()
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function getInitial(text) {
  const first = Array.from(cleanText(text))[0];
  if (!first) return '#';
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  if (/^\d$/.test(first)) return '#';

  const pinyinBounds = [
    ['A', '阿'], ['B', '八'], ['C', '嚓'], ['D', '咑'], ['E', '妸'],
    ['F', '发'], ['G', '旮'], ['H', '铪'], ['J', '丌'], ['K', '咔'],
    ['L', '垃'], ['M', '嘸'], ['N', '拏'], ['O', '噢'], ['P', '妑'],
    ['Q', '七'], ['R', '呥'], ['S', '仨'], ['T', '他'], ['W', '屲'],
    ['X', '夕'], ['Y', '丫'], ['Z', '帀']
  ];
  let result = '#';
  for (const [letter, boundary] of pinyinBounds) {
    if (first.localeCompare(boundary, 'zh-Hans-CN-u-co-pinyin') >= 0) {
      result = letter;
    }
  }
  return result;
}

module.exports = {
  startServer,
  shutdownApplication
};
