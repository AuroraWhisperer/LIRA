// 编写人：Aurora
// GitHub 自动更新管理。
'use strict';

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let updateState = {
  status: 'idle',
  message: '尚未检查更新',
  version: app.getVersion(),
  canDownload: false,
  canInstall: false,
  progress: null,
  updateVersion: ''
};

function configureAutoUpdater({ onStateChange, writeLog }) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      status: 'checking', message: '正在连接 GitHub 检查新版本...',
      canDownload: false, canInstall: false, progress: null
    }, onStateChange);
  });

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available', message: `发现新版本 ${info.version}，可以下载更新。`,
      canDownload: true, canInstall: false, progress: null, updateVersion: info.version || ''
    }, onStateChange);
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateState({
      status: 'not-available', message: '当前已经是最新版本。',
      canDownload: false, canInstall: false, progress: null, updateVersion: ''
    }, onStateChange);
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
    setUpdateState({
      status: 'downloading', message: `正在下载更新：${percent.toFixed(1)}%`,
      canDownload: false, canInstall: false,
      progress: { percent, transferred: progress.transferred || 0, total: progress.total || 0 }
    }, onStateChange);
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'downloaded',
      message: `更新 ${info.version || updateState.updateVersion} 已下载，重启后完成安装。`,
      canDownload: false, canInstall: true,
      progress: { percent: 100 }, updateVersion: info.version || updateState.updateVersion || ''
    }, onStateChange);
  });

  autoUpdater.on('error', (error) => {
    writeLog('update-error', error);
    const friendly = friendlyUpdateError(error);
    setUpdateState({
      status: friendly.status, message: friendly.message,
      canDownload: false, canInstall: false
    }, onStateChange);
  });
}

function setUpdateState(nextState, onStateChange) {
  updateState = { ...updateState, ...nextState, version: app.getVersion() };
  if (onStateChange) onStateChange(updateState);
  return updateState;
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateState({
      status: 'dev-disabled', message: '开发模式不检查 GitHub 更新；打包安装后自动启用。',
      canDownload: false, canInstall: false
    });
    return updateState;
  }
  try { await autoUpdater.checkForUpdates(); } catch (error) {
    setUpdateState({
      status: 'error', message: friendlyUpdateError(error).message,
      canDownload: false, canInstall: false
    });
  }
  return updateState;
}

async function downloadUpdate() {
  if (!app.isPackaged) return checkForUpdates();
  setUpdateState({
    status: 'downloading', message: '正在准备下载 GitHub 最新安装包...',
    canDownload: false, canInstall: false
  });
  try { await autoUpdater.downloadUpdate(); } catch (error) {
    setUpdateState({
      status: 'error', message: friendlyUpdateError(error).message,
      canDownload: false, canInstall: false
    });
  }
  return updateState;
}

function installUpdate() {
  if (!updateState.canInstall) return updateState;
  setUpdateState({
    status: 'installing', message: '正在重启并静默更新...',
    canDownload: false, canInstall: false
  });
  app.releaseSingleInstanceLock();
  autoUpdater.quitAndInstall(true, true);
  return updateState;
}

function friendlyUpdateError(error) {
  const text = `${error && error.message ? error.message : ''}\n${String(error || '')}`;
  if (/\b404\b/.test(text) && /releases\.atom|latest\.yml|github/i.test(text)) {
    return { status: 'not-available', message: '当前 GitHub Releases 里还没有可用更新包。' };
  }
  if (/checksum mismatch|sha512|sha256|hash mismatch/i.test(text)) {
    return { status: 'error', message: '更新包校验失败，请前往 GitHub Releases 手动下载最新安装包。' };
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_CONNECTION|ERR_NETWORK|ERR_INTERNET|network|timeout/i.test(text)) {
    return { status: 'error', message: '暂时无法连接 GitHub 更新服务，请稍后再试。' };
  }
  return { status: 'error', message: '暂时无法检查更新，详细原因已写入日志。' };
}

module.exports = { configureAutoUpdater, checkForUpdates, downloadUpdate, installUpdate, getUpdateState: () => updateState, friendlyUpdateError };
