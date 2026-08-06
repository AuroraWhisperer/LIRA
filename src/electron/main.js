'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage, session, shell
} = require('electron');
const authMgr = require('./auth-manager');
const bilibiliAuth = require('./bilibili-auth');
const { openBilibiliLoginWindow } = require('./bilibili-login-window');
const loginWin = require('./login-window');
const lyricWin = require('./lyric-window');
const { createLocalMediaAccess, hasExactOrigin } = require('./local-media-access');
const updateMgr = require('./update-manager');
const playbackFlush = require('./playback-flush');
const { installTerminalLog, formatLogLine } = require('./terminal-log');
const serverRuntimeModule = require('../server');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const GITHUB_REPO_URL = 'https://github.com/AuroraWhisperer/Request-song';
const MUSIC_LOGIN_CONFIG = authMgr.MUSIC_LOGIN_CONFIG;

let mainWindow = null;
let desktopBaseUrl = '';
let desktopRuntime = null;
let shutdownApplication = null;
let gracefulQuitStarted = false;
let forceQuitTimer = null;
let musicMediaHeadersConfigured = false;
let localMediaAccess = null;
let dataDir = '';
let logDir = '';
let logFile = '';
let terminalLogFile = '';
let logRunId = '';
let logSequence = 0;
let updateState = {
  status: 'idle', message: '尚未检查更新', version: '',
  canDownload: false, canInstall: false, progress: null, updateVersion: ''
};

// ---- app lifecycle ----

// Register local-media:// protocol for local audio file playback
protocol.registerSchemesAsPrivileged([{
  scheme: 'local-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
}]);

// 将 Electron userData 目录重定向到应用安装目录下的 data/，
// 确保卸载时所有登录态（包括 Chromium 持久化分区）一并清理，
// 不会残留在 %APPDATA% 中。
const appDir = app.isPackaged
  ? path.dirname(app.getPath('exe'))
  : ROOT_DIR;
app.setPath('userData', path.join(appDir, 'data'));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(startDesktopApp).catch(function (error) {
    dialog.showErrorBox('启动失败', error.message || String(error));
    app.quit();
  });
}

app.setName('点歌助手');

app.on('second-instance', function () {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', function (event) {
  if (gracefulQuitStarted || !shutdownApplication) return;
  event.preventDefault();
  gracefulQuitStarted = true;
  writeLog('lifecycle', { event: 'QUIT_BEGIN' });
  forceQuitTimer = setTimeout(function () {
    writeLog('lifecycle', { event: 'QUIT_TIMEOUT' });
    app.releaseSingleInstanceLock();
    app.exit(0);
  }, 5000);
  shutdownApplication({ exitProcess: false })
    .catch(function (error) {
      writeLog('shutdown-error', error);
      console.warn('Shutdown failed:', error.message);
    })
    .finally(function () {
      if (forceQuitTimer) { clearTimeout(forceQuitTimer); forceQuitTimer = null; }
      writeLog('lifecycle', { event: 'QUIT_DONE' });
      app.releaseSingleInstanceLock();
      app.exit(0);
    });
});

// ---- startup ----

async function startDesktopApp() {
  configureDesktopEnvironment();
  migrateUserDataFromAppData();
  configureMenu();
  configureLocalMediaProtocol();
  configureUpdateIpc();
  configureMusicIpc();
  configureBilibiliIpc();
  configureMusicMediaRequestHeaders();
  configureBilibiliMediaRequestHeaders();
  updateMgr.configureAutoUpdater({ onStateChange: onUpdateStateChange, writeLog: writeLog });
  await restoreMusicCookieSnapshots();
  await restoreBilibiliCookieSnapshot();

  var serverOptions = {
    host: process.env.HOST || '127.0.0.1',
    startPort: 3000,
    musicAuth: {
      getAuthState: getMusicAuthState,
      getCookieHeader: getMusicCookieHeader
    },
    bilibiliAuth: {
      getAuthState: getBilibiliAuthState,
      getCookieHeader: getBilibiliCookieHeader,
      getUid: getBilibiliUid
    }
  };
  desktopRuntime = createDesktopRuntime(serverRuntimeModule, { dataDir, safeStorage });
  shutdownApplication = desktopRuntime.stop.bind(desktopRuntime);

  // Register pre-shutdown hook: flush renderer playback state via IPC before closing server/DB
  desktopRuntime.setPreShutdownHook(requestPlaybackFlush);

  var serverInfo = await desktopRuntime.start(serverOptions);

  createMainWindow(serverInfo.baseUrl);
  writeLog('lifecycle', { event: 'READY', baseUrl: serverInfo.baseUrl });

  if (!app.isPackaged) {
    updateState = {
      ...updateState,
      status: 'dev-disabled',
      message: '开发模式不检查 GitHub 更新；打包安装后自动启用。',
      canDownload: false,
      canInstall: false
    };
    sendUpdateState();
  }
}

function createDesktopRuntime(serverModule, options = {}) {
  if (isServerRuntime(serverModule)) return serverModule;
  if (serverModule && typeof serverModule.createServerRuntime === 'function') {
    return serverModule.createServerRuntime(options);
  }

  if (!serverModule || typeof serverModule.startServer !== 'function' ||
      typeof serverModule.shutdownApplication !== 'function') {
    throw new Error('Server runtime is not available.');
  }

  return {
    start: (startOptions) => serverModule.startServer(startOptions),
    stop: (stopOptions) => serverModule.shutdownApplication(stopOptions),
    setPreShutdownHook: typeof serverModule.setPreShutdownHook === 'function'
      ? (hook) => serverModule.setPreShutdownHook(hook)
      : () => {},
    persistPlaybackSnapshot: typeof serverModule.persistPlaybackSnapshot === 'function'
      ? (payload, clientId) => serverModule.persistPlaybackSnapshot(payload, clientId)
      : null,
    getSetting: typeof serverModule.getSetting === 'function'
      ? (key) => serverModule.getSetting(key)
      : () => undefined
  };
}

function isServerRuntime(value) {
  return Boolean(value &&
    typeof value.start === 'function' &&
    typeof value.stop === 'function' &&
    typeof value.setPreShutdownHook === 'function');
}

function configureDesktopEnvironment() {
  dataDir = app.getPath('userData');
  logDir = path.join(path.dirname(dataDir), 'logs');
  logFile = path.join(logDir, 'desktop.log');
  terminalLogFile = path.join(logDir, 'terminal.log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  logRunId = crypto.randomUUID();
  logSequence = 0;
  installTerminalLog(terminalLogFile, {
    runId: logRunId,
    pid: process.pid,
    processType: process.type || 'browser',
    nextSequence: nextLogSequence
  });
  writeLog('lifecycle', {
    event: 'START',
    dataDir,
    logDir,
    isPackaged: app.isPackaged
  });
  localMediaAccess = createLocalMediaAccess(dataDir);
  process.env.SONG_PLUGIN_DATA_DIR = dataDir;
  process.env.ELECTRON_DESKTOP = '1';
  if (!process.env.HOST) process.env.HOST = '127.0.0.1';
}

// 将旧版本残留在 %APPDATA% 下的 Chromium 分区数据迁移到新的 userData 目录，
// 确保已安装用户在升级后不会丢失登录状态。
function migrateUserDataFromAppData() {
  const oldUserData = path.join(app.getPath('appData'), app.getName());
  const newUserData = app.getPath('userData');
  if (oldUserData === newUserData) return;

  const oldPartitions = path.join(oldUserData, 'Partitions');
  const newPartitions = path.join(newUserData, 'Partitions');

  if (fs.existsSync(oldPartitions) && !fs.existsSync(newPartitions)) {
    try {
      fs.cpSync(oldPartitions, newPartitions, { recursive: true });
      writeLog('migration', '已将旧 Chromium 分区数据从 ' + oldPartitions + ' 迁移至 ' + newPartitions);
    } catch (e) {
      writeLog('migration-error', e);
    }
  }
}

function configureMenu() {
  Menu.setApplicationMenu(null);
}

function isPathAllowedForLocalMedia(filePath) {
  return Boolean(localMediaAccess && localMediaAccess.isAllowed(filePath));
}

function configureLocalMediaProtocol() {
  protocol.handle('local-media', function (request) {
    // Parse URL: local-media://media/<base64url-encoded-path>
    var urlPath = '';
    try { urlPath = new URL(request.url).pathname; } catch (_) { return new Response('Bad URL', { status: 400 }); }
    var encoded = urlPath.replace(/^\/+/, '');
    var filePath = '';
    try { filePath = Buffer.from(encoded, 'base64url').toString('utf8'); } catch (_) {
      return new Response('Invalid path encoding', { status: 400 });
    }

    // Validate path exists within allowed directories
    if (!filePath || !fs.existsSync(filePath)) {
      return new Response('File not found', { status: 404 });
    }

    // Validate path is within the app data directory or an allowed media source
    if (!isPathAllowedForLocalMedia(filePath)) {
      return new Response('Forbidden', { status: 403 });
    }

    var stat = fs.statSync(filePath);
    var fileSize = stat.size;
    var ext = path.extname(filePath).toLowerCase();
    var mimeTypes = {
      '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav',
      '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
      '.wma': 'audio/x-ms-wma'
    };
    var contentType = mimeTypes[ext] || 'application/octet-stream';

    // Handle Range requests for seeking
    var rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      var match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        var start = parseInt(match[1], 10);
        var end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        if (start >= fileSize) {
          return new Response('', { status: 416, headers: { 'Content-Range': 'bytes */' + fileSize } });
        }
        end = Math.min(end, fileSize - 1);
        var chunkSize = end - start + 1;
        var buffer = Buffer.alloc(chunkSize);
        var fd = fs.openSync(filePath, 'r');
        try { fs.readSync(fd, buffer, 0, chunkSize, start); } finally { fs.closeSync(fd); }
        return new Response(buffer, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
            'Content-Length': String(chunkSize),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
          }
        });
      }
    }

    // Full file response
    var fullBuffer = fs.readFileSync(filePath);
    return new Response(fullBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }
    });
  });
}

function createMainWindow(baseUrl) {
  desktopBaseUrl = baseUrl;
  var opts = {
    width: 1280, height: 720, minWidth: 1024, minHeight: 680,
    show: false, title: '点歌助手', backgroundColor: '#f7f3ef',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  };
  var iconPath = path.join(ROOT_DIR, 'build', 'icon.png');
  if (fs.existsSync(iconPath)) opts.icon = iconPath;

  mainWindow = new BrowserWindow(opts);
  writeLog('window', { event: 'create', window: 'main' });
  mainWindow.loadURL(baseUrl + '/admin?desktop=1');

  mainWindow.once('ready-to-show', function () {
    writeLog('window', { event: 'ready', window: 'main' });
    mainWindow.show();
    sendUpdateState();
    if (app.isPackaged && readAutoUpdateSetting()) {
      setTimeout(function () {
        checkForUpdates().catch(function (e) { setUpdateError(e); });
      }, 1000);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(function (detail) {
    shell.openExternal(detail.url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', function (event, url) {
    var parsed; try { parsed = new URL(url); } catch (_) { parsed = null; }
    var base = new URL(baseUrl);
    if (parsed && parsed.protocol === base.protocol && parsed.hostname === base.hostname && parsed.port === base.port) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on('closed', function () {
    writeLog('window', { event: 'closed', window: 'main' });
    mainWindow = null;
  });

  mainWindow.on('maximize', function () {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:window-maximized', true);
    }
  });

  mainWindow.on('unmaximize', function () {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:window-maximized', false);
    }
  });
}

// ---- IPC handlers ----

function configureUpdateIpc() {
  ipcMain.handle('desktop:get-info', function () {
    return {
      version: app.getVersion(), isPackaged: app.isPackaged,
      platform: process.platform, dataDir: dataDir, logFile: logFile,
      terminalLogFile: terminalLogFile,
      githubRepoUrl: GITHUB_REPO_URL, updateState: updateState
    };
  });
  ipcMain.handle('desktop:check-for-updates', function () {
    writeLog('ipc', { action: 'check-for-updates' });
    return checkForUpdates();
  });
  ipcMain.handle('desktop:download-update', function () {
    writeLog('ipc', { action: 'download-update' });
    return downloadUpdate();
  });
  ipcMain.handle('desktop:install-update', function () {
    writeLog('ipc', { action: 'install-update' });
    return installUpdate();
  });
  ipcMain.handle('desktop:open-data-dir', function () { return dataDir ? shell.openPath(dataDir) : ''; });
  ipcMain.handle('desktop:open-log-dir', function () { return logDir ? shell.openPath(logDir) : ''; });
  ipcMain.handle('desktop:open-github', function () { return shell.openExternal(GITHUB_REPO_URL); });
  ipcMain.handle('desktop:set-auto-update', function (_event, enabled) {
    // 持久化由渲染进程通过 /api/settings 完成，此处仅记录日志
    writeLog('settings', 'enableAutoUpdate set to: ' + String(Boolean(enabled)));
  });
  ipcMain.handle('desktop:gift-display', function (_event, gift) {
    var trace = normalizeGiftDisplayTrace(gift);
    var line = `[Bilibili][GiftDisplay] action=toast-requested trace=${JSON.stringify(trace)}`;
    console.log(line);
    writeLog('gift-display', trace);
    return { ok: true };
  });
  ipcMain.handle('desktop:restart', async function () {
    writeLog('ipc', { action: 'restart' });
    try {
      if (shutdownApplication) {
        await shutdownApplication({ exitProcess: false });
      }
    } catch (_) {
      // Server may already be stopped.
    }
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle('desktop:close-window', function () {
    writeLog('ipc', { action: 'close-window' });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  ipcMain.handle('desktop:minimize-window', function () {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  ipcMain.handle('desktop:maximize-window', function () {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });
}

function configureMusicIpc() {
  ipcMain.handle('music:get-auth-state', function (_e, p) { return getMusicAuthState(p); });
  ipcMain.handle('music:login', function (_e, p) { return loginMusicAccount(p); });
  ipcMain.handle('music:logout', function (_e, p) { return logoutMusicAccount(p); });
  ipcMain.handle('music:open-lyric-window', function () { return openLyricWindow(); });
  ipcMain.handle('music:close-lyric-window', function () { return closeLyricWindow(); });
  ipcMain.handle('music:update-lyric-window', function (_e, s) { return updateLyricWindow(s); });
  ipcMain.handle('music:set-lyric-window-locked', function (_e, l) { return setLyricWindowLocked(l); });
  ipcMain.handle('music:provider-health', async function (_e, platform) {
    var createMusicProviderRegistry = require('../music/provider-registry').createMusicProviderRegistry;
    return createMusicProviderRegistry({
      getAuthState: getMusicAuthState,
      getCookieHeader: getMusicCookieHeader
    }).healthCheck(platform);
  });
  ipcMain.handle('music:select-local-files', async function () {
    var result = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地音频文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma'] }]
    });
    if (result.canceled) return { ok: true, canceled: true, files: [] };
    var selectedPaths = result.filePaths || [];
    localMediaAccess.allowPaths(selectedPaths);
    var files = selectedPaths.map(function (p) {
      return { path: p, name: path.basename(p), ext: path.extname(p) };
    });
    return { ok: true, canceled: false, files: files };
  });
  ipcMain.handle('music:resolve-local-media-urls', async function (_e, paths) {
    // 校验请求来源
    var senderUrl = (_e && _e.senderFrame) ? _e.senderFrame.url : '';
    if (!hasExactOrigin(senderUrl, desktopBaseUrl)) {
      return { results: {} };
    }
    var results = {};
    var list = Array.isArray(paths) ? paths : [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      try {
        var resolved = path.resolve(p);
        if (fs.existsSync(resolved) && isPathAllowedForLocalMedia(resolved)) {
          var encoded = Buffer.from(p, 'utf8').toString('base64url');
          results[p] = { ok: true, url: 'local-media://media/' + encoded };
        } else {
          results[p] = { ok: false, reason: fs.existsSync(resolved) ? 'not-allowed' : 'missing' };
        }
      } catch (_err) {
        results[p] = { ok: false, reason: 'error' };
      }
    }
    return { results: results };
  });
  ipcMain.handle('playback:save-state', function (_e, data) {
    if (!desktopRuntime || typeof desktopRuntime.persistPlaybackSnapshot !== 'function') {
      return { ok: false, error: 'Playback store not available' };
    }
    return desktopRuntime.persistPlaybackSnapshot(
      (data && data.payload) || {},
      (data && data.clientId) || 'default'
    );
  });
  ipcMain.handle('playback:flush-ack', function () {
    playbackFlush.acknowledgePlaybackFlush();
    return { ok: true };
  });
}

function configureMusicMediaRequestHeaders() {
  if (musicMediaHeadersConfigured) return;
  musicMediaHeadersConfigured = true;
  session.defaultSession.webRequest.onBeforeSendHeaders({
    urls: [
      '*://*.music.163.com/*', '*://*.music.126.net/*',
      '*://*.qqmusic.qq.com/*', '*://*.gtimg.cn/*', '*://*.y.qq.com/*'
    ]
  }, function (details, callback) {
    var headers = { ...details.requestHeaders };
    var host = '';
    try { host = new URL(details.url).hostname.toLowerCase(); } catch (_) {}
    if (host.endsWith('music.163.com') || host.endsWith('music.126.net')) {
      if (!headers.Referer && !headers.referer) headers.Referer = 'https://music.163.com/';
    } else if (host.endsWith('qqmusic.qq.com') || host.endsWith('gtimg.cn') || host.endsWith('y.qq.com')) {
      if (!headers.Referer && !headers.referer) headers.Referer = 'https://y.qq.com/';
      if (!headers.Origin && !headers.origin) headers.Origin = 'https://y.qq.com';
    }
    callback({ requestHeaders: headers });
  });
}

function configureBilibiliIpc() {
  ipcMain.handle('bilibili:get-auth-state', function () { return getBilibiliAuthState(); });
  ipcMain.handle('bilibili:login', function () { return loginBilibiliAccount(); });
  ipcMain.handle('bilibili:logout', function () { return logoutBilibiliAccount(); });
}

function configureBilibiliMediaRequestHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders({
    urls: ['*://*.bilibili.com/*', '*://*.hdslb.com/*']
  }, function (details, callback) {
    var headers = { ...details.requestHeaders };
    var host = '';
    try { host = new URL(details.url).hostname.toLowerCase(); } catch (_) {}
    if (host.endsWith('bilibili.com') || host.endsWith('hdslb.com')) {
      if (!headers.Referer && !headers.referer) headers.Referer = 'https://www.bilibili.com/';
      if (!headers.Origin && !headers.origin) headers.Origin = 'https://www.bilibili.com';
    }
    callback({ requestHeaders: headers });
  });
}

// ---- thin wrappers (delegate to extracted modules) ----


function getMusicAuthState(platform) {
  return authMgr.getMusicAuthState(platform, dataDir);
}

function getMusicCookieHeader(platform) {
  return authMgr.getMusicCookieHeader(platform);
}

function logoutMusicAccount(platform) {
  return authMgr.logoutMusicAccount(platform, dataDir);
}

function persistMusicCookieSnapshot(platform) {
  return authMgr.persistMusicCookieSnapshot(platform, dataDir);
}

function restoreMusicCookieSnapshot(platform) {
  return authMgr.restoreMusicCookieSnapshot(platform, dataDir);
}

function normalizeMusicPlatform(value) {
  return authMgr.normalizeMusicPlatform(value);
}

function isAllowedMusicLoginUrl(platform, url) {
  return authMgr.isAllowedMusicLoginUrl(platform, url);
}

// ── Bilibili auth wrappers ──

function getBilibiliAuthState() {
  return bilibiliAuth.getBilibiliAuthState(dataDir);
}

function getBilibiliCookieHeader() {
  return bilibiliAuth.getBilibiliCookieHeader();
}

function getBilibiliUid() {
  return bilibiliAuth.getBilibiliUid();
}

function restoreBilibiliCookieSnapshot() {
  return bilibiliAuth.restoreBilibiliCookieSnapshot(dataDir);
}

async function loginBilibiliAccount() {
  writeLog('window', { event: 'create', window: 'bilibili-login' });
  try {
    return await openBilibiliLoginWindow({
      BrowserWindow,
      shell,
      auth: bilibiliAuth,
      mainWindow,
      dataDir,
      writeLog
    });
  } finally {
    writeLog('window', { event: 'closed', window: 'bilibili-login' });
  }
}

async function logoutBilibiliAccount() {
  return bilibiliAuth.logoutBilibiliAccount(dataDir);
}

async function restoreMusicCookieSnapshots() {
  var platforms = Object.keys(MUSIC_LOGIN_CONFIG);
  for (var i = 0; i < platforms.length; i++) {
    await restoreMusicCookieSnapshot(platforms[i]);
  }
}

async function loginMusicAccount(platform) {
  writeLog('window', { event: 'create', window: 'music-login', platform });
  try {
    return await loginWin.loginMusicAccount(mainWindow, platform, dataDir);
  } finally {
    writeLog('window', { event: 'closed', window: 'music-login', platform });
  }
}

function openLyricWindow() {
  var result = lyricWin.openLyricWindow(desktopBaseUrl, path.join(__dirname, 'preload.js'));
  writeLog('window', { event: 'open', window: 'lyrics' });
  return result;
}

function closeLyricWindow() {
  var result = lyricWin.closeLyricWindow();
  writeLog('window', { event: 'close', window: 'lyrics' });
  return result;
}

function updateLyricWindow(state) {
  return lyricWin.updateLyricWindow(state);
}

function setLyricWindowLocked(locked) {
  return lyricWin.setLyricWindowLocked(locked);
}

async function checkForUpdates() {
  return updateMgr.checkForUpdates();
}

function readAutoUpdateSetting() {
  try {
    return Boolean(desktopRuntime &&
      typeof desktopRuntime.getSetting === 'function' &&
      desktopRuntime.getSetting('enableAutoUpdate') === 'true');
  } catch (_) {
    return false;
  }
}

async function downloadUpdate() {
  return updateMgr.downloadUpdate();
}

function installUpdate() {
  return updateMgr.installUpdate();
}

function onUpdateStateChange(state) {
  updateState = state;
  sendUpdateState();
}

function setUpdateState(nextState) {
  updateState = { ...updateState, ...nextState, version: app.getVersion() };
  sendUpdateState();
  return updateState;
}

function sendUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:update-state', updateState);
  }
}

function setUpdateError(error) {
  writeLog('update-error', error);
  var friendly = updateMgr.friendlyUpdateError(error);
  setUpdateState({
    status: friendly.status,
    message: friendly.message,
    canDownload: false,
    canInstall: false
  });
}

async function requestPlaybackFlush() {
  var result = await playbackFlush.requestPlaybackFlush(mainWindow);
  writeLog('playback-flush', result);
  return result;
}

function writeLog(scope, value) {
  var msg = value instanceof Error
    ? (value.stack || value.message)
    : (typeof value === 'string' ? value : JSON.stringify(value));
  var line = formatLogLine({
    timestamp: new Date().toISOString(),
    runId: logRunId,
    sequence: nextLogSequence(),
    pid: process.pid,
    processType: process.type || 'browser',
    source: 'desktop:' + scope,
    message: msg
  });
  try { fs.appendFileSync(logFile, line, 'utf8'); } catch (_) {}
}

function normalizeGiftDisplayTrace(gift) {
  var value = gift && typeof gift === 'object' ? gift : {};
  return {
    eventId: Number(value.eventId) || 0,
    giftId: String(value.giftId || ''),
    giftName: String(value.giftName || '').slice(0, 200),
    uid: String(value.uid || ''),
    userName: String(value.userName || '').slice(0, 200),
    num: Math.max(1, Number(value.num) || 1),
    totalPrice: Number(value.totalPrice) || 0,
    toastKey: String(value.toastKey || '').slice(0, 200)
  };
}

function nextLogSequence() {
  logSequence += 1;
  return logSequence;
}
