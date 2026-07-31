'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell
} = require('electron');
const authMgr = require('./auth-manager');
const bilibiliAuth = require('./bilibili-auth');
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
let playbackFlushResolve = null;
let musicMediaHeadersConfigured = false;
let dataDir = '';
let logDir = '';
let logFile = '';
let updateState = {
  status: 'idle', message: '尚未检查更新', version: app.getVersion(),
  canDownload: false, canInstall: false, progress: null, updateVersion: ''
};

// ---- app lifecycle ----

// Register local-media:// protocol for local audio file playback
protocol.registerSchemesAsPrivileged([{
  scheme: 'local-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
}]);

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
  configureLocalMediaProtocol();
  configureUpdateIpc();
  configureMusicIpc();
  configureBilibiliIpc();
  configureMusicMediaRequestHeaders();
  configureBilibiliMediaRequestHeaders();
  updateMgr.configureAutoUpdater({ onStateChange: onUpdateStateChange, writeLog: writeLog });
  await restoreMusicCookieSnapshots();
  await restoreBilibiliCookieSnapshot();

  var serverModule = require('../server');
  shutdownApplication = serverModule.shutdownApplication;

  // Register pre-shutdown hook: flush renderer playback state via IPC before closing server/DB
  serverModule.setPreShutdownHook(requestPlaybackFlush);

  var serverInfo = await serverModule.startServer({
    host: process.env.HOST || '127.0.0.1',
    startPort: Number(process.env.PORT || 3000),
    musicAuth: {
      getAuthState: getMusicAuthState,
      getCookieHeader: getMusicCookieHeader
    },
    bilibiliAuth: {
      getAuthState: getBilibiliAuthState,
      getCookieHeader: getBilibiliCookieHeader,
      getUid: getBilibiliUid
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
    width: 1280, height: 800, minWidth: 1024, minHeight: 680,
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
  mainWindow.loadURL(baseUrl + '/admin?desktop=1');

  mainWindow.once('ready-to-show', function () {
    mainWindow.maximize();
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
    var pathModule = require('node:path');
    var files = (result.filePaths || []).map(function (p) { return { path: p, name: pathModule.basename(p), ext: pathModule.extname(p) }; });
    return { ok: true, canceled: false, files: files };
  });
  ipcMain.handle('music:resolve-local-media-urls', async function (_e, paths) {
    var results = {};
    var list = Array.isArray(paths) ? paths : [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      try {
        if (fs.existsSync(p)) {
          var encoded = Buffer.from(p, 'utf8').toString('base64url');
          results[p] = { ok: true, url: 'local-media://media/' + encoded };
        } else {
          results[p] = { ok: false, reason: 'missing' };
        }
      } catch (_err) {
        results[p] = { ok: false, reason: 'error' };
      }
    }
    return { results: results };
  });
  ipcMain.handle('playback:save-state', function (_e, data) {
    var serverModule = require('../server');
    if (typeof serverModule.persistPlaybackSnapshot !== 'function') {
      return { ok: false, error: 'Playback store not available' };
    }
    return serverModule.persistPlaybackSnapshot(
      (data && data.payload) || {},
      (data && data.clientId) || 'default'
    );
  });
  ipcMain.handle('playback:flush-ack', function () {
    if (playbackFlushResolve) {
      var resolve = playbackFlushResolve;
      playbackFlushResolve = null;
      resolve();
    }
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
  // Bilibili login window — same pattern as music login
  const config = bilibiliAuth.BILIBILI_LOGIN_CONFIG;
  const { BrowserWindow } = require('electron');
  const loginWindow = new BrowserWindow({
    width: 1000, height: 720,
    title: `登录${config.name}`,
    parent: mainWindow || undefined,
    modal: false, show: true,
    webPreferences: {
      partition: config.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  const loginSession = loginWindow.webContents.session;
  loginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (bilibiliAuth.isAllowedBilibiliLoginUrl(url)) {
      loginWindow.loadURL(url).catch((error) => writeLog('bilibili-login-navigation', error));
    } else {
      require('electron').shell.openExternal(url).catch((error) => writeLog('bilibili-login-external', error));
    }
    return { action: 'deny' };
  });

  loginWindow.webContents.on('will-navigate', (event, url) => {
    if (bilibiliAuth.isAllowedBilibiliLoginUrl(url)) return;
    event.preventDefault();
    require('electron').shell.openExternal(url);
  });

  let cookieSaveTimer = null;
  const scheduleCookieSave = () => {
    clearTimeout(cookieSaveTimer);
    cookieSaveTimer = setTimeout(() => {
      bilibiliAuth.persistBilibiliCookieSnapshot(dataDir).catch((error) => writeLog('bilibili-cookie-save', error));
    }, 800);
  };
  loginSession.cookies.on('changed', scheduleCookieSave);

  await loginWindow.loadURL(config.loginUrl);

  return new Promise((resolve) => {
    loginWindow.on('closed', async () => {
      clearTimeout(cookieSaveTimer);
      loginSession.cookies.removeListener('changed', scheduleCookieSave);
      let snapshot = null;
      try { snapshot = await bilibiliAuth.persistBilibiliCookieSnapshot(dataDir); }
      catch (error) { writeLog('bilibili-cookie-save', error); }
      resolve({
        snapshot,
        state: await bilibiliAuth.getBilibiliAuthState(dataDir)
      });
    });
  });
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

async function requestPlaybackFlush() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await new Promise(function (resolve) {
      playbackFlushResolve = resolve;
      mainWindow.webContents.send('app:prepare-shutdown');
      // Guard: resolve after 2s even if renderer doesn't ack
      setTimeout(function () {
        if (playbackFlushResolve) {
          playbackFlushResolve = null;
          resolve();
        }
      }, 2000);
    });
  } catch (_) {
    // Renderer may already be gone; proceed with shutdown
  }
}

function writeLog(scope, value) {
  var msg = value instanceof Error
    ? (value.stack || value.message)
    : (typeof value === 'string' ? value : JSON.stringify(value));
  var line = '[' + new Date().toISOString() + '] [' + scope + '] ' + msg + '\n';
  try { fs.appendFileSync(logFile, line, 'utf8'); } catch (_) {}
}
