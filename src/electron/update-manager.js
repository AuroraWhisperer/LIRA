// 编写人：Aurora
// CDN 自动更新管理。
'use strict';

const { app } = require('electron');
const path = require('node:path');
const { resolveDesktopUserDataPaths } = require('./desktop-user-data');

// 延迟加载 autoUpdater 避免在 app ready 之前初始化
let autoUpdater = null;

function getAutoUpdater() {
  if (!autoUpdater) {
    autoUpdater = require('electron-updater').autoUpdater;
    if (process.platform === 'win32') {
      // Retain the default Electron HTTP executor; only relocate its disk cache.
      Object.defineProperty(autoUpdater.app, 'baseCachePath', {
        value: resolveDesktopUserDataPaths({
          isPackaged: app.isPackaged,
          exePath: app.getPath('exe'),
          appDataPath: app.getPath('appData'),
          rootDir: path.resolve(__dirname, '../..'),
        }).updatesDir,
      });
    }
  }
  return autoUpdater;
}

let updateState = {
  status: 'idle',
  message: '尚未检查更新',
  version: '',
  canDownload: false,
  canInstall: false,
  progress: null,
  updateVersion: '',
};

let lastProgressTime = 0;
let lastTransferred = 0;
let _onStateChange = null;

function configureAutoUpdater({ onStateChange, writeLog, updater }) {
  _onStateChange = onStateChange || null;
  const configuredUpdater = updater || getAutoUpdater();
  const log = typeof writeLog === 'function' ? writeLog : () => {};

  // electron-builder writes the packaged feed to resources/app-update.yml.
  configuredUpdater.autoDownload = true;
  configuredUpdater.autoInstallOnAppQuit = true;
  configuredUpdater.allowPrerelease = false;
  configuredUpdater.disableDifferentialDownload = true;

  configuredUpdater.on('checking-for-update', () => {
    log('update', { event: 'checking' });
    setUpdateState(
      {
        status: 'checking',
        message: '正在连接更新服务检查新版本...',
        canDownload: false,
        canInstall: false,
        progress: null,
      },
      onStateChange,
    );
  });

  configuredUpdater.on('update-available', (info) => {
    log('update', { event: 'available', version: info.version || '' });
    setUpdateState(
      {
        status: 'available',
        message: `发现新版本 ${info.version}，将自动下载。`,
        canDownload: true,
        canInstall: false,
        progress: null,
        updateVersion: info.version || '',
      },
      onStateChange,
    );
  });

  configuredUpdater.on('update-not-available', () => {
    log('update', { event: 'not-available' });
    setUpdateState(
      {
        status: 'not-available',
        message: '当前已经是最新版本。',
        canDownload: false,
        canInstall: false,
        progress: null,
        updateVersion: '',
      },
      onStateChange,
    );
  });

  configuredUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
    const transferred = progress.transferred || 0;
    const total = progress.total || 0;

    const now = Date.now();
    let speed = 0;
    if (lastProgressTime > 0 && now > lastProgressTime) {
      const elapsedSeconds = (now - lastProgressTime) / 1000;
      const downloadedBytes = transferred - lastTransferred;
      speed = downloadedBytes / elapsedSeconds;
    }
    lastProgressTime = now;
    lastTransferred = transferred;

    setUpdateState(
      {
        status: 'downloading',
        message: `正在下载更新：${percent.toFixed(1)}%`,
        canDownload: false,
        canInstall: false,
        progress: { percent, transferred, total, speed },
      },
      onStateChange,
    );
  });

  configuredUpdater.on('update-downloaded', (info) => {
    log('update', {
      event: 'downloaded',
      version: info.version || updateState.updateVersion || '',
    });
    setUpdateState(
      {
        status: 'downloaded',
        message: `更新 ${info.version || updateState.updateVersion} 已下载，重启后完成安装。`,
        canDownload: false,
        canInstall: true,
        progress: { percent: 100 },
        updateVersion: info.version || updateState.updateVersion || '',
      },
      onStateChange,
    );
  });

  configuredUpdater.on('error', (error) => {
    log('update-error', error);
    const friendly = friendlyUpdateError(error);
    setUpdateState(
      {
        status: friendly.status,
        message: friendly.message,
        canDownload: false,
        canInstall: false,
      },
      onStateChange,
    );
  });
}

function setUpdateState(nextState, onStateChange) {
  updateState = { ...updateState, ...nextState, version: app.getVersion() };
  if (updateState.status !== 'downloading' && updateState.status !== 'downloaded') {
    updateState.progress = null;
  }
  const notify = onStateChange || _onStateChange;
  if (notify) notify(updateState);
  return updateState;
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateState({
      status: 'dev-disabled',
      message: '开发模式不检查更新；打包安装后自动启用。',
      canDownload: false,
      canInstall: false,
    });
    return updateState;
  }
  try {
    await getAutoUpdater().checkForUpdates();
  } catch (error) {
    setUpdateState({
      ...friendlyUpdateError(error),
      canDownload: false,
      canInstall: false,
    });
  }
  return updateState;
}

async function downloadUpdate() {
  if (!app.isPackaged) return checkForUpdates();
  // 重置下载速度计算
  lastProgressTime = 0;
  lastTransferred = 0;
  setUpdateState({
    status: 'downloading',
    message: '正在准备下载最新安装包...',
    canDownload: false,
    canInstall: false,
    progress: null,
  });
  try {
    await getAutoUpdater().downloadUpdate();
  } catch (error) {
    setUpdateState({
      ...friendlyUpdateError(error),
      canDownload: false,
      canInstall: false,
    });
  }
  return updateState;
}

function installUpdate() {
  if (!updateState.canInstall) return updateState;
  setUpdateState({
    status: 'installing',
    message: '正在重启并安装更新…',
    canDownload: false,
    canInstall: false,
  });
  app.releaseSingleInstanceLock();
  getAutoUpdater().quitAndInstall(true, true);
  return updateState;
}

function friendlyUpdateError(error) {
  const text = `${error && error.message ? error.message : ''}\n${String(error || '')}`;
  if (/\b404\b/.test(text) && /latest\.yml|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(text)) {
    return {
      status: 'error',
      message: '更新清单暂不可用，请稍后再试。',
    };
  }
  if (/checksum mismatch|sha512|sha256|hash mismatch/i.test(text)) {
    return {
      status: 'error',
      message: '更新包校验失败，请重新检查并下载更新。',
    };
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_CONNECTION|ERR_NETWORK|ERR_INTERNET|network|timeout/i.test(text)) {
    return {
      status: 'error',
      message: '暂时无法连接更新服务，请稍后再试。',
    };
  }
  return { status: 'error', message: '暂时无法检查更新，详细原因已写入日志。' };
}

module.exports = {
  configureAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateState: () => updateState,
  friendlyUpdateError,
};
