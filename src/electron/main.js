'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app, BrowserWindow, dialog, ipcMain, Menu, session, shell
} = require('electron');
const authMgr = require('./auth-manager');
const loginWin = require('./login-window');
const lyricWin = require('./lyric-window');
const updateMgr = require('./update-manager');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const GITHUB_REPO_URL = 'https://github.com/AuroraWhisperer/Request-song';
const MUSIC_LOGIN_CONFIG = authMgr.MUSIC_LOGIN_CONFIG;

let mainWindow = null;
let desktopBaseUrl = '';
let shutdownApplication = null;
let gracefulQuitStarted = false;
let forceQuitTimer = null;
let musicMediaHeadersConfigured = false;
let dataDir = '';
let logDir = '';
let logFile = '';
let updateState = {
  status: 'idle', message: '尚未检查更新', version: app.getVersion(),
  canDownload: false, canInstall: false, progress: null, updateVersion: ''
};

// ---- app lifecycle ----

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
  forceQuitTimer = setTimeout(function () {
    app.releaseSingleInstanceLock();
    app.exit(0);
  }, 5000);
  shutdownApplication({ exitProcess: false })
    .catch(function (error) { console.warn('Shutdown failed:', error.message); })
    .finally(function () {
      if (forceQuitTimer) { clearTimeout(forceQuitTimer); forceQuitTimer = null; }
      app.releaseSingleInstanceLock();
      app.exit(0);
    });
});

// ---- startup ----

async function startDesktopApp() {
  configureDesktopEnvironment();
  configureMenu();
  configureUpdateIpc();
  configureMusicIpc();
  configureMusicMediaRequestHeaders();
  updateMgr.configureAutoUpdater({ onStateChange: onUpdateStateChange, writeLog: writeLog });
  await restoreMusicCookieSnapshots();

  var serverModule = require('../server');
  shutdownApplication = serverModule.shutdownApplication;
  var serverInfo = await serverModule.startServer({
    host: process.env.HOST || '127.0.0.1',
    startPort: Number(process.env.PORT || 3000),
    musicAuth: {
      getAuthState: getMusicAuthState,
      getCookieHeader: getMusicCookieHeader
    }
  });

  createMainWindow(serverInfo.baseUrl);

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
  var appDir = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : ROOT_DIR;
  dataDir = path.join(appDir, 'data');
  logDir = path.join(appDir, 'logs');
  logFile = path.join(logDir, 'desktop.log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  process.env.SONG_PLUGIN_DATA_DIR = dataDir;
  process.env.ELECTRON_DESKTOP = '1';
  if (!process.env.HOST) process.env.HOST = '127.0.0.1';
}

function configureMenu() {
  Menu.setApplicationMenu(null);
}

function createMainWindow(baseUrl) {
  desktopBaseUrl = baseUrl;
  var opts = {
    width: 1120, height: 720, minWidth: 960, minHeight: 620,
    show: false, title: '点歌助手', backgroundColor: '#f7f3ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  };
  var iconPath = path.join(ROOT_DIR, 'build', 'icon.png');
  if (fs.existsSync(iconPath)) opts.icon = iconPath;

  mainWindow = new BrowserWindow(opts);
  mainWindow.loadURL(baseUrl + '/admin?desktop=1');

  mainWindow.once('ready-to-show', function () {
    mainWindow.show();
    sendUpdateState();
    if (app.isPackaged) {
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
    if (url.startsWith(baseUrl)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// ---- IPC handlers ----

function configureUpdateIpc() {
  ipcMain.handle('desktop:get-info', function () {
    return {
      version: app.getVersion(), isPackaged: app.isPackaged,
      platform: process.platform, dataDir: dataDir, logFile: logFile,
      githubRepoUrl: GITHUB_REPO_URL, updateState: updateState
    };
  });
  ipcMain.handle('desktop:check-for-updates', function () { return checkForUpdates(); });
  ipcMain.handle('desktop:download-update', function () { return downloadUpdate(); });
  ipcMain.handle('desktop:install-update', function () { return installUpdate(); });
  ipcMain.handle('desktop:open-data-dir', function () { return dataDir ? shell.openPath(dataDir) : ''; });
  ipcMain.handle('desktop:open-log-dir', function () { return logDir ? shell.openPath(logDir) : ''; });
  ipcMain.handle('desktop:open-github', function () { return shell.openExternal(GITHUB_REPO_URL); });
  ipcMain.handle('desktop:restart', async function () {
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
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
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

async function restoreMusicCookieSnapshots() {
  var platforms = Object.keys(MUSIC_LOGIN_CONFIG);
  for (var i = 0; i < platforms.length; i++) {
    await restoreMusicCookieSnapshot(platforms[i]);
  }
}

async function loginMusicAccount(platform) {
  return loginWin.loginMusicAccount(mainWindow, platform, dataDir);
}

function openLyricWindow() {
  return lyricWin.openLyricWindow(desktopBaseUrl, path.join(__dirname, 'preload.js'));
}

function closeLyricWindow() {
  return lyricWin.closeLyricWindow();
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

function writeLog(scope, value) {
  var msg = value instanceof Error
    ? (value.stack || value.message)
    : (typeof value === 'string' ? value : JSON.stringify(value));
  var line = '[' + new Date().toISOString() + '] [' + scope + '] ' + msg + '\n';
  try { fs.appendFileSync(logFile, line, 'utf8'); } catch (_) {}
}
