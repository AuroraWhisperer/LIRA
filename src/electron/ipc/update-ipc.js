'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

function registerUpdateIpc({
  ipcMain,
  app,
  shell,
  getDataDir,
  getLogFile,
  getLogDir,
  getTerminalLogFile,
  getUpdateState,
  githubRepoUrl,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  requestRestart,
  getMainWindow,
  getDesktopBaseUrl,
  writeLog,
}) {
  const handle = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl, allowLicense: true });
  handle('desktop:get-info', function () {
    return {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      dataDir: getDataDir(),
      logFile: getLogFile(),
      terminalLogFile: getTerminalLogFile(),
      githubRepoUrl,
      updateState: getUpdateState(),
    };
  });
  handle('desktop:check-for-updates', function () {
    writeLog('ipc', { action: 'check-for-updates' });
    return checkForUpdates();
  });
  handle('desktop:download-update', function () {
    writeLog('ipc', { action: 'download-update' });
    return downloadUpdate();
  });
  handle('desktop:install-update', function () {
    writeLog('ipc', { action: 'install-update' });
    return installUpdate();
  });
  handle('desktop:open-data-dir', function () {
    return getDataDir() ? shell.openPath(getDataDir()) : '';
  });
  handle('desktop:open-log-dir', function () {
    return getLogDir() ? shell.openPath(getLogDir()) : '';
  });
  handle('desktop:open-github', function () {
    return shell.openExternal(githubRepoUrl);
  });
  handle('desktop:set-auto-update', function (_event, enabled) {
    writeLog('settings', 'enableAutoUpdate set to: ' + String(Boolean(enabled)));
  });
  handle('desktop:gift-display', function () {
    return { ok: true };
  });
  handle('desktop:restart', async function () {
    writeLog('ipc', { action: 'restart' });
    await requestRestart();
  });
  handle('desktop:close-window', function () {
    writeLog('ipc', { action: 'close-window' });
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  handle('desktop:minimize-window', function () {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  handle('desktop:maximize-window', function () {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
}

module.exports = { registerUpdateIpc };
