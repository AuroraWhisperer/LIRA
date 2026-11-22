// 编写人：Aurora
// CDN 自动更新管理。
'use strict';

const { app, autoUpdater: nativeUpdater } = require('electron');
const fs = require('node:fs');
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
let _writeLog = () => {};
let lastUpdateError = null;
let pendingInstall = null;

function configureAutoUpdater({ onStateChange, writeLog, updater }) {
  _onStateChange = onStateChange || null;
  const configuredUpdater = updater || getAutoUpdater();
  const log = typeof writeLog === 'function' ? writeLog : () => {};
  _writeLog = log;

  // electron-builder writes the packaged feed to resources/app-update.yml.
  configuredUpdater.autoDownload = true;
  configuredUpdater.autoInstallOnAppQuit = true;
  configuredUpdater.allowPrerelease = false;
  configuredUpdater.disableDifferentialDownload = false;

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
    configuredUpdater.autoInstallOnAppQuit = true;
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

  configuredUpdater.on('error', handleUpdateError);
}

function handleUpdateError(error) {
  if (error !== lastUpdateError) {
    _writeLog('update-error', error);
    lastUpdateError = error;
  }
  setUpdateState({
    ...friendlyUpdateError(error),
    canDownload: false,
    canInstall: false,
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
  lastUpdateError = null;
  try {
    const result = await getAutoUpdater().checkForUpdates();
    // Automatic downloads outlive the metadata check and reject independently.
    void result?.downloadPromise?.catch(handleUpdateError);
  } catch (error) {
    handleUpdateError(error);
  }
  return updateState;
}

async function downloadUpdate() {
  if (!app.isPackaged) return checkForUpdates();
  lastUpdateError = null;
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
    handleUpdateError(error);
  }
  return updateState;
}

async function launchDownloadedNsis(updater) {
  const file = updater.installerPath;
  const helper = updater.downloadedUpdateHelper;
  if (!helper?.downloadedFileInfo || !file || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw Object.assign(new Error('Downloaded installer is missing.'), { code: 'ENOENT' });
  }
  const args = ['--updated', '/S', '--force-run'];
  if (updater.installDirectory) args.push(`/D=${updater.installDirectory}`);
  if (helper.packageFile) args.push(`--package-file=${helper.packageFile}`);
  // NsisUpdater.doInstall reports success before spawn settles. Await its OS launcher directly.
  if (!helper.downloadedFileInfo.isAdminRightsRequired) {
    try { return await updater.spawnLog(file, args); }
    catch (error) { if (error.code !== 'EACCES' && error.code !== 'UNKNOWN') throw error; }
  }
  return updater.spawnLog(path.join(process.resourcesPath, 'elevate.exe'), [file, ...args]);
}

async function installUpdate() {
  if (pendingInstall) return pendingInstall;
  if (!updateState.canInstall) return updateState;
  setUpdateState({
    status: 'installing',
    message: '正在重启并安装更新…',
    canDownload: false,
    canInstall: false,
  });
  const updater = getAutoUpdater();
  if (process.platform !== 'win32') {
    app.releaseSingleInstanceLock();
    updater.quitAndInstall(true, true);
    return updateState;
  }
  // The explicit handoff owns this package. A later download rearms ordinary quit installation.
  updater.autoInstallOnAppQuit = false;
  pendingInstall = launchDownloadedNsis(updater).then(() => {
    app.releaseSingleInstanceLock();
    nativeUpdater.emit('before-quit-for-update');
    app.quit();
    return updateState;
  }, error => {
    _writeLog('update-error', error);
    const missing = error.code === 'ENOENT' || error.code === 'ENOTDIR';
    setUpdateState({
      status: 'error',
      message: missing ? '已下载的更新包不可用，请重新下载。' : '无法启动更新安装程序，请重试安装或查看错误日志。',
      canDownload: missing,
      canInstall: !missing,
    });
    return updateState;
  }).finally(() => { pendingInstall = null; });
  return pendingInstall;
}

function friendlyUpdateError(error) {
  const text = `${error && error.message ? error.message : ''}\n${String(error || '')}`;
  if (/\b404\b/.test(text) && (error?.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || /latest\.yml|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(text))) {
    return {
      status: 'error',
      message: '找不到更新清单（HTTP 404），请稍后重新检查更新。',
    };
  }
  if (/\b404\b/.test(text)) {
    return {
      status: 'error',
      message: '找不到更新包，请稍后重试。如需联系管理员，请提供错误码 HTTP 404。',
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
  return { status: 'error', message: '更新失败，详细原因已写入错误日志。' };
}

module.exports = {
  configureAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateState: () => updateState,
  friendlyUpdateError,
};
