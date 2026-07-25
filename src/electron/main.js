'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell
} = require('electron');
const { autoUpdater } = require('electron-updater');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const GITHUB_REPO_URL = 'https://github.com/AuroraWhisperer/Request-song-for-bilibili';

let mainWindow = null;
let shutdownApplication = null;
let gracefulQuitStarted = false;
let dataDir = '';
let logDir = '';
let logFile = '';
let updateState = {
  status: 'idle',
  message: '尚未检查更新',
  version: app.getVersion(),
  canDownload: false,
  canInstall: false,
  progress: null,
  updateVersion: ''
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(startDesktopApp).catch((error) => {
    dialog.showErrorBox('启动失败', error.message || String(error));
    app.quit();
  });
}

app.setName('点歌助手');

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (gracefulQuitStarted || !shutdownApplication) return;

  event.preventDefault();
  gracefulQuitStarted = true;
  shutdownApplication({ exitProcess: false })
    .catch((error) => console.warn(`Shutdown failed: ${error.message}`))
    .finally(() => app.quit());
});

async function startDesktopApp() {
  configureDesktopEnvironment();
  configureMenu();
  configureUpdateIpc();
  configureAutoUpdater();

  const serverModule = require('../server');
  shutdownApplication = serverModule.shutdownApplication;
  const serverInfo = await serverModule.startServer({
    host: process.env.HOST || '127.0.0.1',
    startPort: Number(process.env.PORT || 3000)
  });

  createMainWindow(serverInfo.baseUrl);

  if (app.isPackaged) {
    setTimeout(() => {
      checkForUpdates().catch((error) => setUpdateError(error));
    }, 3000);
  } else {
    setUpdateState({
      status: 'dev-disabled',
      message: '开发模式不检查 GitHub 更新；打包安装后自动启用。',
      canDownload: false,
      canInstall: false
    });
  }
}

function configureDesktopEnvironment() {
  dataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(ROOT_DIR, 'data');
  logDir = path.join(app.getPath('userData'), 'logs');
  logFile = path.join(logDir, 'desktop.log');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  process.env.SONG_PLUGIN_DATA_DIR = dataDir;
  process.env.ELECTRON_DESKTOP = '1';
  if (!process.env.HOST) process.env.HOST = '127.0.0.1';
}

function createMainWindow(baseUrl) {
  const windowOptions = {
    width: 1120,
    height: 720,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: '点歌助手',
    backgroundColor: '#f7f3ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };

  const iconPath = path.join(ROOT_DIR, 'build', 'icon.png');
  if (fs.existsSync(iconPath)) windowOptions.icon = iconPath;

  mainWindow = new BrowserWindow(windowOptions);
  mainWindow.loadURL(`${baseUrl}/admin?desktop=1`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendUpdateState();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(baseUrl)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function configureMenu() {
  Menu.setApplicationMenu(null);
}

function configureUpdateIpc() {
  ipcMain.handle('desktop:get-info', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    dataDir,
    logFile,
    githubRepoUrl: GITHUB_REPO_URL,
    updateState
  }));

  ipcMain.handle('desktop:check-for-updates', () => checkForUpdates());
  ipcMain.handle('desktop:download-update', () => downloadUpdate());
  ipcMain.handle('desktop:install-update', () => installUpdate());
  ipcMain.handle('desktop:open-data-dir', () => (dataDir ? shell.openPath(dataDir) : ''));
  ipcMain.handle('desktop:open-log-dir', () => (logDir ? shell.openPath(logDir) : ''));
  ipcMain.handle('desktop:open-github', () => shell.openExternal(GITHUB_REPO_URL));
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableDifferentialDownload = false;

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      status: 'checking',
      message: '正在连接 GitHub 检查新版本...',
      canDownload: false,
      canInstall: false,
      progress: null
    });
  });

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      message: `发现新版本 ${info.version}，可以下载更新。`,
      canDownload: true,
      canInstall: false,
      progress: null,
      updateVersion: info.version || ''
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateState({
      status: 'not-available',
      message: '当前已经是最新版本。',
      canDownload: false,
      canInstall: false,
      progress: null,
      updateVersion: ''
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
    setUpdateState({
      status: 'downloading',
      message: `正在下载更新：${percent.toFixed(1)}%`,
      canDownload: false,
      canInstall: false,
      progress: {
        percent,
        transferred: progress.transferred || 0,
        total: progress.total || 0
      }
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'downloaded',
      message: `更新 ${info.version || updateState.updateVersion} 已下载，重启后完成安装。`,
      canDownload: false,
      canInstall: true,
      progress: { percent: 100 },
      updateVersion: info.version || updateState.updateVersion || ''
    });
  });

  autoUpdater.on('error', setUpdateError);
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateState({
      status: 'dev-disabled',
      message: '开发模式不检查 GitHub 更新；打包安装后自动启用。',
      canDownload: false,
      canInstall: false
    });
    return updateState;
  }

  await autoUpdater.checkForUpdates();
  return updateState;
}

async function downloadUpdate() {
  if (!app.isPackaged) return checkForUpdates();
  setUpdateState({
    status: 'downloading',
    message: '正在准备下载 GitHub 最新安装包...',
    canDownload: false,
    canInstall: false
  });
  await autoUpdater.downloadUpdate();
  return updateState;
}

function installUpdate() {
  if (!updateState.canInstall) return updateState;
  setUpdateState({
    status: 'installing',
    message: '正在重启并安装更新...',
    canDownload: false,
    canInstall: false
  });
  autoUpdater.quitAndInstall(false, true);
  return updateState;
}

function setUpdateError(error) {
  writeLog('update-error', error);
  const friendly = friendlyUpdateError(error);
  setUpdateState({
    status: friendly.status,
    message: friendly.message,
    canDownload: false,
    canInstall: false
  });
}

function setUpdateState(nextState) {
  updateState = {
    ...updateState,
    ...nextState,
    version: app.getVersion()
  };
  sendUpdateState();
  return updateState;
}

function sendUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:update-state', updateState);
}

function friendlyUpdateError(error) {
  const text = `${error && error.message ? error.message : ''}\n${String(error || '')}`;
  if (/\b404\b/.test(text) && /releases\.atom|latest\.yml|github/i.test(text)) {
    return {
      status: 'not-available',
      message: '当前 GitHub Releases 里还没有可用更新包。'
    };
  }

  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout/i.test(text)) {
    return {
      status: 'error',
      message: '暂时无法连接 GitHub 更新服务，请稍后再试。'
    };
  }

  return {
    status: 'error',
    message: '暂时无法检查更新，详细原因已写入日志。'
  };
}

function writeLog(scope, value) {
  const message = value instanceof Error
    ? `${value.stack || value.message}`
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
  const line = `[${new Date().toISOString()}] [${scope}] ${message}\n`;

  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (_) {
    // Logging must never block app startup or update checks.
  }
}
