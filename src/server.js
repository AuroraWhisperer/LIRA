// 编写人：Aurora
// 当前项目版本：1.2.4
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
const apiRoutes = require('./server/api-routes');
const httpUtils = require('./server/http-utils');
const lifecycle = require('./server/lifecycle');
const wsTransport = require('./server/ws');
const sharedUtils = require('./shared/utils');
const { createDatabases } = require('./storage/database');
const settingsStoreModule = require('./storage/settings-store');
const { createMusicProviderRegistry, normalizeMusicPlatform } = require('./music/provider-registry');
const { clearMusicCache, getMusicCacheStats } = require('./music/music-cache');
const { initLyricsService } = require('./music/lyrics-service');
const scService = require('./bilibili/superchat-service');
const blivedmCompat = require('./bilibili/blivedm-compat');
const bilibiliMsg = require('./bilibili/bilibili-message-handler');
const songService = require('./music/song-service');
const giftService = require('./bilibili/gift-service');
const biliHelpers = require('./bilibili/helpers');

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
const HISTORY_MESSAGE_MAX_AGE_MS = 30 * 60 * 1000;
const BILIBILI_ONLINE_RANK_POLL_MS = 60 * 1000;
const BILIBILI_ONLINE_RANK_PAGE_SIZE = 50;
const BILIBILI_ONLINE_RANK_MAX_PAGES = 3;
const BILIBILI_IDENTITY_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const BILIBILI_LIVE_STATUS_POLL_MS = 10 * 60 * 1000;
const GIFT_BOT_PENDING_MAX_AGE_MS = 15 * 1000;
const GIFT_BOT_MATCH_WINDOW_MS = 20 * 1000;
const SUPER_CHAT_PIN_THRESHOLD = 2;
const SUPER_CHAT_DISPLAY_THRESHOLD = 2;
const CRYSTAL_BALL_VALUE_RMB = 100;
const BLIVEDM_RAW_BASE = 'https://raw.githubusercontent.com/xfgryujk/blivedm/master';
const BLIVEDM_COMPAT_CHECK_TIMEOUT_MS = 20000;
const BLIVEDM_COMPAT_CACHE_KEY = 'blivedmCompatibilityCache';

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
  userCooldownSeconds: '0',
  scrollSeconds: '100',
  queueScrollMode: 'bounce',
  queueScrollSpeed: '80',
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
  queueFixedSixRows: 'true',
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

const db = createDatabases({ dataDir: DATA_DIR });
	const songDb = db.songDb;
	const superChatDb = db.superChatDb;
	const giftDb = db.giftDb;
	initLyricsService(MUSIC_API_CACHE_DIR, MUSIC_LYRIC_CACHE_DIR);
	repairGiftV2Events();

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
let musicRegistry = createMusicProviderRegistry();
const giftBotPendingByName = new Map();
const giftBotLastReportByName = new Map();
const runtimeGiftCommandPrefixes = new Set();
let blivedmCompatibility = {
  status: 'idle',
  checkedAt: '',
  message: '尚未检查 blivedm 礼物协议。',
  remoteGiftCommands: [],
  supportedGiftCommands: [],
  missingGiftCommands: []
};
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
    getSystemMetrics,
    runManualBlivedmCompatibilityCheck,
    listCategories,
    listSongs,
    normalizeRoomInput,
    setSetting,
    getSettings,
    configureBilibiliListener,
    broadcastSnapshot,
    addQueueItem,
    handleQueueAction,
    handleSuperChatAction,
    resetGiftSprintProgress,
    saveSong,
    deleteSong: (id) => {
      songDb.prepare('DELETE FROM songs WHERE id = ?').run(id);
    },
    toggleSong: (id) => {
      const song = songDb.prepare('SELECT is_enabled FROM songs WHERE id = ?').get(id);
      if (!song) return { ok: false };
      songDb.prepare('UPDATE songs SET is_enabled = ?, updated_at = ? WHERE id = ?')
        .run(song.is_enabled ? 0 : 1, now(), id);
      return { ok: true };
    },
    importSongs,
    getMusicCacheStats: () => getMusicCacheStats(MUSIC_API_CACHE_DIR, MUSIC_LYRIC_CACHE_DIR),
    clearMusicCache: () => clearMusicCache(MUSIC_API_CACHE_DIR, MUSIC_LYRIC_CACHE_DIR),
    clearSongLibraryData,
    clearSuperChatData,
    clearAllData,
    reconnectBilibiliListener,
    publicBilibiliErrorMessage,
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
    sleep
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
    checkBlivedmCompatibilityOnStartup();
      return { server, port, host, baseUrl };
    });

  return startPromise;
}

function checkBlivedmCompatibilityOnStartup() {
  const cached = readBlivedmCompatibilityCache();
  blivedmCompatibility = cached
    ? {
        ...cached,
        status: cached.missingGiftCommands && cached.missingGiftCommands.length > 0 ? 'warn' : 'cached',
        message: `使用上次 blivedm 检查结果，正在后台刷新...`
      }
    : {
        ...blivedmCompatibility,
        status: 'checking',
        checkedAt: now(),
        message: '正在检查 blivedm 最新礼物协议...'
      };
  applyRuntimeGiftCommands(blivedmCompatibility.missingGiftCommands);
  broadcastSnapshot('blivedm:checking');

  checkBlivedmCompatibility()
    .then((result) => {
      blivedmCompatibility = result;
      writeBlivedmCompatibilityCache(result);
      applyRuntimeGiftCommands(result.missingGiftCommands);
      if (result.missingGiftCommands.length > 0) {
        console.warn(`[Bilibili] blivedm has newer gift CMD(s): ${result.missingGiftCommands.join(', ')}`);
      } else {
        console.log('[Bilibili] blivedm gift protocol compatibility check passed.');
      }
      broadcastSnapshot('blivedm:checked');
    })
    .catch((error) => {
      blivedmCompatibility = fallbackBlivedmCompatibility(error, cached);
      console.warn(`[Bilibili] blivedm compatibility check failed: ${error.message}`);
      broadcastSnapshot('blivedm:error');
    });
}

async function runManualBlivedmCompatibilityCheck() {
  blivedmCompatibility = {
    ...blivedmCompatibility,
    status: 'checking',
    checkedAt: now(),
    message: '正在手动检查 blivedm 最新礼物协议...'
  };
  broadcastSnapshot('blivedm:manual-checking');

  try {
    const result = await checkBlivedmCompatibility();
    blivedmCompatibility = result;
    writeBlivedmCompatibilityCache(result);
    applyRuntimeGiftCommands(result.missingGiftCommands);
    broadcastSnapshot('blivedm:manual-checked');
    return blivedmCompatibility;
  } catch (error) {
    const cached = readBlivedmCompatibilityCache();
    blivedmCompatibility = fallbackBlivedmCompatibility(error, cached);
    broadcastSnapshot('blivedm:manual-error');
    return blivedmCompatibility;
  }
}

function fallbackBlivedmCompatibility(error, cached) {
  if (cached) return { ...cached, status: 'cached', message: `blivedm 检查超时，已使用上次成功结果：${cached.checkedAt || '未知时间'}` };
  return { status: 'fallback', checkedAt: sharedUtils.now(), message: `blivedm 检查超时，已使用内置协议。${error && error.message ? '原因：' + error.message : ''}`, remoteGiftCommands: [], supportedGiftCommands: getSupportedBilibiliGiftCommands(), missingGiftCommands: [] };
}

function applyRuntimeGiftCommands(commands) {
  for (const cmd of Array.isArray(commands) ? commands : []) { if (cmd) runtimeGiftCommandPrefixes.add(cmd); }
}

function readBlivedmCompatibilityCache() {
  return blivedmCompat.readBlivedmCompatibilityCache(songDb);
}

function writeBlivedmCompatibilityCache(result) {
  blivedmCompat.writeBlivedmCompatibilityCache(songDb, result);
}

async function checkBlivedmCompatibility() {
  return blivedmCompat.checkBlivedmCompatibility();
}

async function fetchTextWithTimeout(url, timeoutMs) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'bilibili-live-song-plugin',
        'Accept': 'text/plain, */*'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      throw new Error(`GitHub HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    console.warn(`[Bilibili] GitHub fetch failed, trying PowerShell fallback: ${error.message}`);
    return fetchTextWithPowerShell(url, timeoutMs);
  }
}

function fetchTextWithPowerShell(url, timeoutMs) {
  const timeoutSec = Math.max(5, Math.ceil(timeoutMs / 1000));
  const command = [
    '$ProgressPreference = "SilentlyContinue";',
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;`,
    `$response = Invoke-WebRequest -Uri '${escapePowerShellSingleQuoted(url)}' -UseBasicParsing -TimeoutSec ${timeoutSec};`,
    '$response.Content'
  ].join(' ');

  return new Promise((resolve, reject) => {
    childProcess.execFile('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs + 3000,
      maxBuffer: 2 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`PowerShell fallback failed: ${error.message}${stderr ? ` ${stderr.trim()}` : ''}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function escapePowerShellSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function extractBlivedmGiftCommands(text) {
  return blivedmCompat.extractBlivedmGiftCommands(text);
}
function isBilibiliGiftRelevantCommandName(cmd) {
  return blivedmCompat.isBilibiliGiftRelevantCommandName(cmd);
}
function getSupportedBilibiliGiftCommands() {
  return blivedmCompat.getSupportedBilibiliGiftCommands();
}
function isSupportedBilibiliGiftCommand(cmd) {
  return blivedmCompat.isSupportedBilibiliGiftCommand(cmd, getSupportedBilibiliGiftCommands());
}

function recordBilibiliCommandDiagnostic(cmd) {
  biliHelpers.recordBilibiliCommandDiagnostic(bilibiliDiagnostics, cmd);
}
function recordBilibiliGiftDiagnostic(cmd, reason) {
  biliHelpers.recordBilibiliGiftDiagnostic(bilibiliDiagnostics, cmd, reason);
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
    queue: getQueueSnapshot(),
    superChats: getSuperChatSnapshot(),
    gifts: getGiftSnapshot(),
    giftSprint: getGiftSprintSnapshot(),
    settings: getSettings(),
    categories: listCategories(),
    songCount: songDb.prepare('SELECT COUNT(*) AS count FROM songs').get().count,
    liveStatus,
    blivedmCompatibility,
    bilibiliDiagnostics
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
  return scService.getSuperChatSnapshot({ db: { superChatDb } });
}

function getGiftSnapshot() {
  return giftService.getGiftSnapshot({ db: { giftDb } });
}

function getGiftSprintSnapshot() {
  return giftService.getGiftSprintSnapshot({ settings: getSettings, db: { giftDb } });
}

function normalizeSuperChatRow(row) {
  return scService.normalizeSuperChatRow(row);
}

function normalizeGiftRow(row) { return giftService.normalizeGiftRow(row); }

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
  return scService.addSuperChatItem({ db: { superChatDb } }, input);
}

function addGiftEvent(input) {
  return giftService.addGiftEvent({ settings: getSettings, db: { giftDb } }, input);
}

function updateGiftEventIfProgressed(row, gift) {
  const existingNum = normalizePositiveInteger(row.num) || 1;
  const nextNum = normalizePositiveInteger(gift.num) || 1;
  const existingTotal = normalizeMoney(row.total_price);
  const nextTotal = normalizeMoney(gift.totalPrice);

  if (nextNum <= existingNum && nextTotal <= existingTotal) {
    return normalizeGiftRow(row);
  }

  const mergedNum = Math.max(existingNum, nextNum);
  const mergedTotal = Math.max(existingTotal, nextTotal);
  const mergedUnit = mergedNum > 0 ? normalizeMoney(mergedTotal / mergedNum) : normalizeMoney(gift.unitPrice);
  const blindBoxPrice = gift.blindBoxPrice === null ? row.blind_box_price : gift.blindBoxPrice;
  const blindProfit = blindBoxPrice === null || blindBoxPrice === undefined
    ? null
    : normalizeSignedMoney(mergedTotal - Number(blindBoxPrice || 0));
  const updatedAt = gift.createdAt || now();

  giftDb.prepare(`
    UPDATE gift_events
    SET gift_id = ?,
        gift_name = ?,
        uid = ?,
        user_name = ?,
        num = ?,
        unit_price = ?,
        total_price = ?,
        coin_type = ?,
        is_blind_box = ?,
        blind_box_name = ?,
        blind_box_price = ?,
        blind_profit = ?,
        counted_in_sprint = ?,
        raw_json = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    gift.giftId || cleanText(row.gift_id),
    gift.giftName || cleanText(row.gift_name),
    gift.uid || cleanText(row.uid),
    gift.userName || cleanText(row.user_name),
    mergedNum,
    mergedUnit,
    mergedTotal,
    gift.coinType || cleanText(row.coin_type),
    gift.isBlindBox ? 1 : Number(row.is_blind_box || 0),
    gift.blindBoxName || cleanText(row.blind_box_name),
    blindBoxPrice,
    blindProfit,
    mergedTotal > 0 ? 1 : Number(row.counted_in_sprint || 0),
    gift.rawJson || cleanText(row.raw_json),
    updatedAt,
    Number(row.id)
  );

  return normalizeGiftRow(giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(row.id)));
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

function normalizeGiftInput(input) { return giftService.normalizeGiftInput(input); }

function handleGiftBotDanmaku(danmaku) {
  return giftService.handleGiftBotDanmaku({
    settings: getSettings,
    db: { giftDb },
    state: { giftBotPendingByName, giftBotLastReportByName }
  }, danmaku);
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
  return giftService.resetGiftSprintProgress({ settings: getSettings, db: { giftDb } });
}

function handleSuperChatAction(action, rawId) {
  return scService.handleSuperChatAction({ db: { superChatDb } }, action, rawId);
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

function handleDanmakuMessage(danmaku) {
  return bilibiliMsg.handleDanmakuMessage({
    settings: getSettings,
    settingsStore: { getDefaultSettings: () => DEFAULT_SETTINGS },
    state: { cooldownByUser },
    songService: { pickRandomSong: (db, scope) => pickRandomSong(scope) },
    addQueueItem: (input) => addQueueItem(input),
    db: { songDb }
  }, danmaku);
}

function parseDanmakuCommand(message, settings) {
  return bilibiliMsg.parseDanmakuCommand(message, settings || getSettings());
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
      : 80;
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

function configureBilibiliListener(force = false) {
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
  const settings = getSettings();
  const roomId = normalizeRoomInput(settings.roomId);
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
    this.liveStatusTimer = null;
    this.liveStatusCheckInFlight = false;
    this.liveReconnectInFlight = false;
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
      if (!this.historyTimer) {
        this.startHistoryPolling(this.roomId);
      }
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '直播弹幕长连失败，历史消息监听中'
      });
      this.scheduleReconnect();
    });
  }

  async restart() {
    this.stopped = false;
    this.startedAtMs = Date.now();
    try {
      await this.connect({ waitForOpen: true });
    } catch (error) {
      console.warn(`[Bilibili] reconnect failed: ${error.message}`);
      if (!this.historyTimer) {
        this.startHistoryPolling(this.roomId);
      }
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '直播弹幕长连失败，历史消息监听中'
      });
      this.scheduleReconnect();
      throw error;
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.historyTimer);
    clearInterval(this.onlineRankTimer);
    clearInterval(this.liveStatusTimer);
    this.liveStatusTimer = null;
    this.closeSocket();
  }

  closeSocket() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch (_) {
        // Ignore shutdown errors.
      }
    }
  }

  async connect(options = {}) {
    this.report({
      connected: false,
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      message: '正在连接 Bilibili 弹幕服务'
    });

    const roomInfo = await this.resolveRoomInfo();
    const isLive = Number(roomInfo.liveStatus) === 1;
    if (!isLive || options.alwaysHistory) {
      this.startHistoryPolling(roomInfo.roomId);
    }
    this.startOnlineRankPolling(roomInfo.roomId, roomInfo.uid);
    this.startLiveStatusPolling(roomInfo);
    const danmuInfo = await this.resolveDanmuInfo(roomInfo.roomId);
    const host = (danmuInfo.host_list || [])[0];
    if (!host) {
      throw new Error('没有可用的弹幕服务器。');
    }

    this.closeSocket();
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
      if (isLive) {
        clearInterval(this.historyTimer);
        this.historyTimer = null;
      }
      this.report({
        connected: true,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: isLive
          ? `已连接直播间 ${roomInfo.roomId}`
          : `直播间 ${roomInfo.roomId} 未开播，历史消息监听中；每 10 分钟自动检测开播`
      });
      if (!isLive) {
        console.warn(`[Bilibili] room ${roomInfo.roomId} is not live. live_status=${roomInfo.liveStatus}. History polling fallback is enabled.`);
      }
    });

    ws.addEventListener('message', async (event) => {
      if (this.ws !== ws) return;
      const data = event.data instanceof ArrayBuffer
        ? Buffer.from(event.data)
        : Buffer.from(await event.data.arrayBuffer());
      bilibiliDiagnostics.lastPacketAt = now();
      for (const message of parseBilibiliPackets(data)) {
        recordBilibiliCommandDiagnostic(message && message.cmd);
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
          if (!gift) {
            logUnparsedGiftLikeCommand(message, 'known-gift-command');
            recordBilibiliGiftDiagnostic(message.cmd, 'known-gift-command');
            continue;
          }
          bilibiliDiagnostics.lastGiftAt = now();
          bilibiliDiagnostics.parsedGiftCount += 1;
          const requester = this.resolveRequesterIdentity({
            uid: gift.uid,
            userName: gift.userName
          });
          this.handlers.onGift({
            ...gift,
            uid: requester.uid,
            userName: requester.userName
          });
        } else if (isBilibiliGiftLikeCommand(message.cmd)) {
          logUnparsedGiftLikeCommand(message, 'gift-like-command');
          recordBilibiliGiftDiagnostic(message.cmd, 'gift-like-command');
        }
      }
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      clearInterval(this.heartbeatTimer);
      if (!this.stopped) {
        if (!this.historyTimer) {
          this.startHistoryPolling(this.roomId);
        }
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
      if (this.ws !== ws) return;
      this.report({
        connected: false,
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: '弹幕连接出现错误'
      });
    });

    if (options.waitForOpen) {
      await this.waitForSocketOpen(ws);
    }
  }

  waitForSocketOpen(ws) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('弹幕 WebSocket 连接超时，请稍后重试。'));
      }, 8000);

      const cleanup = () => {
        clearTimeout(timeout);
        ws.removeEventListener('open', handleOpen);
        ws.removeEventListener('error', handleError);
        ws.removeEventListener('close', handleClose);
      };
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('弹幕 WebSocket 连接失败。'));
      };
      const handleClose = () => {
        cleanup();
        reject(new Error('弹幕 WebSocket 连接已关闭。'));
      };

      ws.addEventListener('open', handleOpen);
      ws.addEventListener('error', handleError);
      ws.addEventListener('close', handleClose);
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

  startLiveStatusPolling(roomInfo) {
    clearInterval(this.liveStatusTimer);
    this.liveStatusTimer = null;

    if (!roomInfo || Number(roomInfo.liveStatus) === 1) return;

    this.liveStatusTimer = setInterval(() => {
      this.checkLiveStatusForReconnect().catch((error) => {
        console.warn(`[Bilibili] live status polling failed: ${error.message}`);
      });
    }, BILIBILI_LIVE_STATUS_POLL_MS);
    if (typeof this.liveStatusTimer.unref === 'function') {
      this.liveStatusTimer.unref();
    }
  }

  async checkLiveStatusForReconnect() {
    if (this.stopped || this.liveStatusCheckInFlight || this.liveReconnectInFlight) return;

    this.liveStatusCheckInFlight = true;
    try {
      const roomInfo = await this.resolveRoomInfo();
      if (Number(roomInfo.liveStatus) === 1) {
        await this.reconnectAfterLiveStarted(roomInfo.roomId);
        return;
      }

      this.report({
        connected: Boolean(this.ws) || Boolean(this.historyTimer),
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: `直播间 ${roomInfo.roomId} 未开播，历史消息监听中；每 10 分钟自动检测开播`
      });
    } finally {
      this.liveStatusCheckInFlight = false;
    }
  }

  async reconnectAfterLiveStarted(roomId) {
    if (this.stopped || this.liveReconnectInFlight) return;

    this.liveReconnectInFlight = true;
    clearInterval(this.liveStatusTimer);
    this.liveStatusTimer = null;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    clearInterval(this.historyTimer);
    this.historyTimer = null;

    console.log(`[Bilibili] room ${roomId} is live; reconnecting danmaku listener.`);
    this.report({
      connected: false,
      enabled: true,
      roomId: this.roomId,
      mode: 'bilibili',
      message: `检测到直播间 ${roomId} 已开播，正在重连礼物监听`
    });

    try {
      this.startedAtMs = Date.now();
      await this.connect();
    } catch (error) {
      console.warn(`[Bilibili] reconnect after live start failed: ${error.message}`);
      this.report({
        connected: Boolean(this.historyTimer),
        enabled: true,
        roomId: this.roomId,
        mode: 'bilibili',
        message: this.historyTimer
          ? '检测到开播，但直播弹幕长连重连失败，历史消息监听中'
          : publicBilibiliErrorMessage(error, true)
      });
      this.scheduleReconnect();
    } finally {
      this.liveReconnectInFlight = false;
    }
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

function cleanText(value) {
	return sharedUtils.cleanText(value);
}function normalizePositiveInteger(value) {
	return sharedUtils.normalizePositiveInteger(value);
}function normalizeMoney(value) {
	return sharedUtils.normalizeMoney(value);
}function normalizeSignedMoney(value) {
	return sharedUtils.normalizeSignedMoney(value);
}function normalizeNullableMoney(value) {
	return sharedUtils.normalizeNullableMoney(value);
}function normalizeBilibiliGiftCoin(value) {
  if (typeof value === 'string') {
    const match = value.match(/[\d.]+/);
    return match ? Number(match[0]) : 0;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeBilibiliCoinRmb(value) {
  const amount = normalizeBilibiliGiftCoin(value);
  return amount > 0 ? normalizeMoney(amount / 1000) : 0;
}

function parseBooleanLike(value) {
	return sharedUtils.parseBooleanLike(value);
}function guardLevelName(level) {
  if (Number(level) === 3) return '舰长';
  if (Number(level) === 2) return '提督';
  if (Number(level) === 1) return '总督';
  return '';
}

function buildBilibiliFallbackGiftId(packet, data) {
  return crypto.createHash('sha1')
    .update([
      cleanText(packet && packet.cmd),
      cleanText(readObjectValue(data, ['uid', 'mid', 'username', 'uname'])),
      cleanText(readObjectValue(data, ['gift_name', 'giftName', 'role_name', 'roleName'])),
      cleanText(readObjectValue(data, ['price', 'gift_price', 'giftPrice', 'total_price', 'totalPrice'])),
      cleanText(readObjectValue(data, ['timestamp', 'ts', 'time', 'start_time', 'startTime'])) || Math.floor(Date.now() / 1000)
    ].join('|'))
    .digest('hex');
}

function logUnparsedGiftLikeCommand(message, reason) {
  const cmd = cleanText(message && message.cmd);
  const data = message && message.data && typeof message.data === 'object' ? message.data : {};
  const keys = Object.keys(data).slice(0, 30).join(',');
  const preview = safeJsonStringify(data).slice(0, 260);
  console.warn(`[Bilibili] unparsed gift-like command: reason=${reason} cmd=${cmd} dataKeys=${keys} data=${preview}`);
}

function normalizeGuardLevel(value) {
	return sharedUtils.normalizeGuardLevel(value);
}function normalizeRoomInput(value) {
	return sharedUtils.normalizeRoomInput(value);
}async function signBilibiliWbiParams(params, headers) {
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
	return sharedUtils.publicBilibiliErrorMessage(error, isReconnect);
}function isBilibiliCommandText(message) {
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
  if (runtimeGiftCommandPrefixes.has(text)) return true;
  for (const prefix of runtimeGiftCommandPrefixes) {
    if (text.startsWith(`${prefix}_`)) return true;
  }
  return text.startsWith('SEND_GIFT')
    || text.startsWith('BLIND_GIFT')
    || text.startsWith('COMBO_SEND')
    || text.startsWith('GUARD_BUY')
    || text.startsWith('USER_TOAST_MSG')
    || text.startsWith('LIVE_OPEN_PLATFORM_SEND_GIFT')
    || text.startsWith('LIVE_OPEN_PLATFORM_GUARD');
}

function isBilibiliGiftLikeCommand(cmd) {
  const text = String(cmd || '');
  return isBilibiliGiftCommand(text)
    || text.includes('GIFT')
    || text.includes('COMBO')
    || text.includes('GUARD');
}

function extractBilibiliGiftMessage(packet) {
  const data = packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  if (!data || Object.keys(data).length === 0) return null;

  const cmd = cleanText(packet && packet.cmd);
  if (cmd.startsWith('LIVE_OPEN_PLATFORM_SEND_GIFT')) {
    return extractBilibiliOpenLiveGiftMessage(packet, data);
  }

  if (cmd.startsWith('LIVE_OPEN_PLATFORM_GUARD')) {
    return extractBilibiliOpenLiveGuardGiftMessage(packet, data);
  }

  if (cmd.startsWith('GUARD_BUY') || cmd.startsWith('USER_TOAST_MSG')) {
    const guardGift = extractBilibiliWebGuardGiftMessage(packet, data);
    if (guardGift) return guardGift;
  }

  if (cmd.startsWith('SEND_GIFT_V2') && data.pb) {
    const parsedV2 = extractBilibiliGiftV2Message(packet, data);
    if (parsedV2) return parsedV2;
    logUnparsedGiftLikeCommand(packet, 'send-gift-v2-proto');
    return null;
  }

  return extractBilibiliWebGiftMessage(packet, data);
}

function extractBilibiliOpenLiveGiftMessage(packet, data) {
  const giftNum = normalizePositiveInteger(readObjectValue(data, ['gift_num', 'giftNum'])) || 1;
  const paid = parseBooleanLike(readObjectValue(data, ['paid', 'is_paid', 'isPaid']));
  const unitCoin = normalizeBilibiliGiftCoin(
    readObjectValue(data, ['r_price', 'rPrice'])
    || readObjectValue(data, ['price'])
  );
  const totalPrice = paid ? normalizeMoney(unitCoin * giftNum / 1000) : 0;

  return {
    platformId: cleanText(readObjectValue(data, ['msg_id', 'msgId'])) || buildBilibiliFallbackGiftId(packet, data),
    cmd: cleanText(packet && packet.cmd),
    giftId: cleanText(readObjectValue(data, ['gift_id', 'giftId'])),
    giftName: cleanText(readObjectValue(data, ['gift_name', 'giftName'])) || '未知礼物',
    uid: cleanText(readObjectValue(data, ['open_id', 'openId', 'uid', 'mid'])),
    userName: cleanText(readObjectValue(data, ['uname', 'user_name', 'userName', 'nickname'])) || '观众',
    num: giftNum,
    unitPrice: paid ? normalizeMoney(unitCoin / 1000) : 0,
    totalPrice,
    coinType: paid ? 'gold' : 'free',
    isBlindBox: Boolean(readObjectValue(data, ['blind_gift', 'blindGift', 'combo_gift', 'comboGift'])),
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(readObjectValue(data, ['timestamp', 'ts', 'time'])) || Date.now()
  };
}

function extractBilibiliOpenLiveGuardGiftMessage(packet, data) {
  const userInfo = readFirstObject(data, ['user_info', 'userInfo']) || {};
  const guardLevel = normalizeGuardLevel(readObjectValue(data, ['guard_level', 'guardLevel']));
  const num = normalizePositiveInteger(readObjectValue(data, ['guard_num', 'guardNum', 'num'])) || 1;
  const totalCoin = normalizeBilibiliGiftCoin(readObjectValue(data, ['price']));
  const totalPrice = normalizeBilibiliCoinRmb(totalCoin);

  return {
    platformId: cleanText(readObjectValue(data, ['msg_id', 'msgId'])) || buildBilibiliFallbackGiftId(packet, data),
    cmd: cleanText(packet && packet.cmd),
    giftId: `guard-${guardLevel || 'unknown'}`,
    giftName: guardLevelName(guardLevel) || '大航海',
    uid: cleanText(readObjectValue(userInfo, ['open_id', 'openId', 'uid', 'mid'])),
    userName: cleanText(readObjectValue(userInfo, ['uname', 'user_name', 'userName', 'nickname'])) || '观众',
    num,
    unitPrice: num > 0 ? normalizeMoney(totalPrice / num) : totalPrice,
    totalPrice,
    coinType: 'gold',
    isBlindBox: false,
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(readObjectValue(data, ['timestamp', 'ts', 'time'])) || Date.now()
  };
}

function extractBilibiliWebGiftMessage(packet, data) {
  const cmd = cleanText(packet && packet.cmd);
  const blindInfo = readFirstObject(data, ['blind_gift', 'blindGift', 'blind_box', 'blindBox', 'origin_info', 'originInfo']);
  const num = normalizePositiveInteger(readObjectValue(data, ['num', 'gift_num', 'giftNum', 'combo_num', 'comboNum'])) || 1;
  const coinType = cleanText(readObjectValue(data, ['coin_type', 'coinType', 'coin'])).toLowerCase();
  const paid = coinType === 'gold' || parseBooleanLike(readObjectValue(data, ['paid', 'is_paid', 'isPaid']));
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
  const unitPrice = paid ? normalizeMoney(unitCoin / 1000) : 0;
  const totalPrice = paid ? normalizeMoney((totalCoin > 0 ? totalCoin : unitCoin * num) / 1000) : 0;
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
      'msg_id',
      'msgId',
      'tid',
      'gift_tid',
      'giftTid',
      'rnd',
      'batch_combo_id',
      'batchComboId',
      'combo_id',
      'comboId'
    ])) || buildBilibiliFallbackGiftId(packet, data),
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

function extractBilibiliWebGuardGiftMessage(packet, data) {
  const cmd = cleanText(packet && packet.cmd);
  const senderInfo = readFirstObject(data, ['sender_uinfo', 'senderUinfo']) || {};
  const senderBase = readFirstObject(senderInfo, ['base']) || {};
  const guardInfo = readFirstObject(data, ['guard_info', 'guardInfo']) || data;
  const payInfo = readFirstObject(data, ['pay_info', 'payInfo']) || data;
  const giftInfo = readFirstObject(data, ['gift_info', 'giftInfo']) || data;
  const guardLevel = normalizeGuardLevel(readObjectValue(guardInfo, ['guard_level', 'guardLevel']) || readObjectValue(data, ['guard_level', 'guardLevel']));
  const giftName = cleanText(
    readObjectValue(giftInfo, ['gift_name', 'giftName', 'role_name', 'roleName', 'role'])
    || readObjectValue(data, ['gift_name', 'giftName', 'role_name', 'roleName', 'role'])
  ) || guardLevelName(guardLevel) || '大航海';
  const num = normalizePositiveInteger(readObjectValue(payInfo, ['num']) || readObjectValue(data, ['num', 'gift_num', 'giftNum'])) || 1;
  const explicitTotalCoin = normalizeBilibiliGiftCoin(readObjectValue(data, ['total_price', 'totalPrice', 'total_coin', 'totalCoin']));
  const unitCoin = normalizeBilibiliGiftCoin(readObjectValue(payInfo, ['price']) || readObjectValue(data, ['price', 'gift_price', 'giftPrice']));
  const totalPrice = normalizeBilibiliCoinRmb(explicitTotalCoin || unitCoin * num);
  const unitPrice = num > 0 ? normalizeMoney(totalPrice / num) : totalPrice;

  return {
    platformId: cleanText(readObjectValue(data, [
      'id',
      'tid',
      'gift_tid',
      'giftTid',
      'order_id',
      'orderId',
      'toast_msg_id',
      'toastMsgId',
      'msg_id',
      'msgId'
    ])) || buildBilibiliFallbackGiftId(packet, data),
    cmd,
    giftId: cleanText(readObjectValue(giftInfo, ['gift_id', 'giftId', 'giftid']) || readObjectValue(data, ['gift_id', 'giftId', 'giftid'])) || `guard-${guardLevel || 'unknown'}`,
    giftName,
    uid: cleanText(readObjectValue(senderInfo, ['uid', 'mid']) || readObjectValue(data, ['uid', 'mid'])),
    userName: cleanText(
      readObjectValue(senderBase, ['name', 'uname', 'user_name', 'userName'])
      || readObjectValue(senderInfo, ['username', 'user_name', 'userName', 'uname', 'nickname'])
      || readObjectValue(data, ['username', 'user_name', 'userName', 'uname', 'nickname'])
    ) || '观众',
    num,
    unitPrice,
    totalPrice,
    coinType: 'guard',
    isBlindBox: false,
    blindBoxName: '',
    blindBoxPrice: null,
    rawJson: safeJsonStringify(packet),
    messageTimestamp: normalizeTimestampMs(readObjectValue(data, ['timestamp', 'ts', 'time', 'start_time', 'startTime'])) || Date.now()
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
  const num = Math.max(
    normalizePositiveInteger(firstProtoScalar(giftInfo[3])),
    normalizePositiveInteger(firstProtoScalar(giftInfo[4])),
    1
  );
  const coinType = cleanText(firstProtoScalar(giftInfo[8])).toLowerCase();
  const paid = coinType === 'gold';
  const unitCoin = normalizeBilibiliGiftCoin(
    firstProtoScalar(giftInfo[5])
    || firstProtoScalar(giftInfo[6])
  );
  const totalCoin = normalizeBilibiliGiftCoin(
    firstProtoScalar(giftInfo[7])
    || firstProtoScalar(giftInfo[14])
  );
  const unitPrice = paid ? normalizeMoney(unitCoin / 1000) : 0;
  const totalPrice = paid ? normalizeMoney(Math.max(totalCoin, unitCoin * num) / 1000) : 0;
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
	return sharedUtils.normalizeSuperChatPrice(value);
}function readBilibiliOnlineRankItems(data) {
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
    userName: chooseRequesterUserName(base.userName, extra.userName),
    guardLevel: base.guardLevel || extra.guardLevel,
    medalName: base.medalName || extra.medalName,
    medalLevel: base.medalLevel || extra.medalLevel,
    seenAt: Math.max(base.seenAt, extra.seenAt)
  };
}

function chooseRequesterUserName(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  if (isMaskedDisplayName(primary) && !isMaskedDisplayName(fallback)) {
    return fallback;
  }
  return primary;
}

function isMaskedDisplayName(value) {
  const text = cleanText(value);
  return /\*{2,}/.test(text);
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
	return sharedUtils.readObjectValue(value, keys);
}function readFirstObject(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] && typeof value[key] === 'object') {
      return value[key];
    }
  }
  return null;
}

function safeJsonStringify(value) {
	return sharedUtils.safeJsonStringify(value);
}function safeParseJson(value) {
	return sharedUtils.safeParseJson(value);
}function parseBilibiliTimeline(value) {
  return normalizeTimestampMs(value);
}

function normalizeTimestampMs(value) {
	return sharedUtils.normalizeTimestampMs(value);
}function timestampToIso(value) {
	return sharedUtils.timestampToIso(value);
}function formatLogTimestamp(value) {
	return sharedUtils.formatLogTimestamp(value);
}function redactUrl(url) {
  return String(url).replace(/(w_rid=)[^&]+/g, '$1<redacted>');
}

function clampPercent(value) {
	return sharedUtils.clampPercent(value);
}function sleep(ms) {
	return sharedUtils.sleep(ms);
}function now() {
	return sharedUtils.now();
}function csvCell(value) {
	return sharedUtils.csvCell(value);
}function escapeXml(value) {
	return sharedUtils.escapeXml(value);
}function unescapeXml(value) {
	return sharedUtils.unescapeXml(value);
}function decodeXmlCodePoint(codePoint) {
	return sharedUtils.decodeXmlCodePoint(codePoint);
}function getXmlAttr(attrs, name) {
	return sharedUtils.getXmlAttr(attrs, name);
}function columnName(index) {
	return sharedUtils.columnName(index);
}function columnNameToIndex(name) {
	return sharedUtils.columnNameToIndex(name);
}function dosDateTime(dateValue) {
	return sharedUtils.dosDateTime(dateValue);
}function crc32(buffer) {
	return sharedUtils.crc32(buffer);
}const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function getInitial(text) {
	return sharedUtils.getInitial(text);
}module.exports = {
  startServer,
  shutdownApplication
};
