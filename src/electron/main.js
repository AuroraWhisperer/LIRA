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
const { createDesktopRuntime } = require('./desktop-runtime');
const { createLocalMediaAccess, hasExactOrigin } = require('./local-media-access');
const { registerLocalMediaProtocol } = require('./local-media-protocol');
const updateMgr = require('./update-manager');
const playbackFlush = require('./playback-flush');
const { installTerminalLog, formatLogLine } = require('./terminal-log');
const { registerUpdateIpc } = require('./ipc/update-ipc');
const { registerMusicIpc } = require('./ipc/music-ipc');
const { registerBilibiliIpc } = require('./ipc/bilibili-ipc');
const serverRuntimeModule = require('../server');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const GITHUB_REPO_URL = 'https://github.com/AuroraWhisperer/LIRA';
const MUSIC_LOGIN_CONFIG = authMgr.MUSIC_LOGIN_CONFIG;

let mainWindow = null;
let desktopBaseUrl = '';
let desktopRuntime = null;
let shutdownApplication = null;
let gracefulQuitStarted = false;
let forceQuitTimer = null;
let musicMediaHeadersConfigured = false;
let localMediaAccess = null;
let musicProviderRegistry = null;
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
let lastUpdateStatus = '';

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

app.setName('LIRA');

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
  registerUpdateIpc({
    ipcMain, app, shell,
    getDataDir: () => dataDir,
    getLogFile: () => logFile,
    getLogDir: () => logDir,
    getTerminalLogFile: () => terminalLogFile,
    getUpdateState: () => updateState,
    githubRepoUrl: GITHUB_REPO_URL,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    getShutdownApplication: () => shutdownApplication,
    getMainWindow: () => mainWindow,
    normalizeGiftDisplayTrace,
    writeLog
  });
  registerMusicIpc({
    ipcMain, dialog,
    getMainWindow: () => mainWindow,
    getDesktopBaseUrl: () => desktopBaseUrl,
    getDesktopRuntime: () => desktopRuntime,
    getAppDataPath: () => app.getPath('appData'),
    getLocalMediaAccess: () => localMediaAccess,
    getMusicAuthState,
    loginMusicAccount,
    logoutMusicAccount,
    openLyricWindow,
    closeLyricWindow,
    updateLyricWindow,
    setLyricWindowLocked,
    getMusicProviderRegistry,
    hasExactOrigin,
    isPathAllowedForLocalMedia,
    acknowledgePlaybackFlush: playbackFlush.acknowledgePlaybackFlush,
    writePlaybackSnapshot: (payload, clientId) => {
      if (!desktopRuntime || typeof desktopRuntime.persistPlaybackSnapshot !== 'function') {
        return { ok: false, error: 'Playback store not available' };
      }
      return desktopRuntime.persistPlaybackSnapshot(payload, clientId);
    }
  });
  registerBilibiliIpc({
    ipcMain,
    getAuthState: getBilibiliAuthState,
    login: loginBilibiliAccount,
    logout: logoutBilibiliAccount
  });
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
  registerLocalMediaProtocol(protocol, isPathAllowedForLocalMedia);
}

function createMainWindow(baseUrl) {
  desktopBaseUrl = baseUrl;
  var opts = {
    width: 1280, height: 720, minWidth: 1024, minHeight: 680,
    show: false, title: 'LIRA', backgroundColor: '#f7f3ef',
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

// 复用同一个 provider registry，避免每次 health 检查都重新实例化（状态不一致 + 无谓开销）。
function getMusicProviderRegistry() {
  if (!musicProviderRegistry) {
    musicProviderRegistry = require('../music/provider-registry').createMusicProviderRegistry({
      getAuthState: getMusicAuthState,
      getCookieHeader: getMusicCookieHeader
    });
  }
  return musicProviderRegistry;
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
    // 让预留的 desktop:show-update-page 通道生效：更新可用/已下载时主动切到更新页。
    if (updateState.status !== lastUpdateStatus) {
      lastUpdateStatus = updateState.status;
      if (updateState.status === 'available' || updateState.status === 'downloaded') {
        mainWindow.webContents.send('desktop:show-update-page');
      }
    }
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
