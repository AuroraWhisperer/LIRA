'use strict';

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
  getShutdownApplication,
  getMainWindow,
  normalizeGiftDisplayTrace,
  writeLog
}) {
  ipcMain.handle('desktop:get-info', function () {
    return {
      version: app.getVersion(), isPackaged: app.isPackaged,
      platform: process.platform, dataDir: getDataDir(), logFile: getLogFile(),
      terminalLogFile: getTerminalLogFile(),
      githubRepoUrl, updateState: getUpdateState()
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
  ipcMain.handle('desktop:open-data-dir', function () { return getDataDir() ? shell.openPath(getDataDir()) : ''; });
  ipcMain.handle('desktop:open-log-dir', function () {
    return getLogDir() ? shell.openPath(getLogDir()) : '';
  });
  ipcMain.handle('desktop:open-github', function () { return shell.openExternal(githubRepoUrl); });
  ipcMain.handle('desktop:set-auto-update', function (_event, enabled) {
    writeLog('settings', 'enableAutoUpdate set to: ' + String(Boolean(enabled)));
  });
  ipcMain.handle('desktop:gift-display', function (_event, gift) {
    const trace = normalizeGiftDisplayTrace(gift);
    console.log(`[Bilibili][GiftDisplay] action=toast-requested trace=${JSON.stringify(trace)}`);
    writeLog('gift-display', trace);
    return { ok: true };
  });
  ipcMain.handle('desktop:restart', async function () {
    writeLog('ipc', { action: 'restart' });
    try {
      const shutdownApplication = getShutdownApplication();
      if (shutdownApplication) await shutdownApplication({ exitProcess: false });
    } catch (_) {
      // Server may already be stopped.
    }
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle('desktop:close-window', function () {
    writeLog('ipc', { action: 'close-window' });
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  ipcMain.handle('desktop:minimize-window', function () {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  ipcMain.handle('desktop:maximize-window', function () {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
}

module.exports = { registerUpdateIpc };
