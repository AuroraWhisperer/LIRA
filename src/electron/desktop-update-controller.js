'use strict';

function createDesktopUpdateController({
  app,
  updateManager,
  getAutoUpdateSetting,
  getMainWindow,
  writeLog,
  beforeInstall = async () => {},
  timers = { setTimeout, clearTimeout },
}) {
  let startupTimer = null;
  let disposed = false;

  function sendUpdateState() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send('desktop:update-state', updateManager.getUpdateState());
  }

  function configureAutoUpdater() {
    updateManager.configureAutoUpdater({
      onStateChange: sendUpdateState,
      writeLog,
    });
  }

  function checkForUpdates() {
    return updateManager.checkForUpdates();
  }

  function readAutoUpdateSetting() {
    try {
      return getAutoUpdateSetting() === 'true';
    } catch (_) {
      return false;
    }
  }

  function downloadUpdate() {
    return updateManager.downloadUpdate();
  }

  async function installUpdate() {
    if (updateManager.getUpdateState().canInstall) await beforeInstall();
    return updateManager.installUpdate();
  }

  function setUpdateError(error) {
    updateManager.reportUpdateError(error);
  }

  function scheduleStartupCheck() {
    if (disposed || startupTimer !== null || !app.isPackaged || !readAutoUpdateSetting()) return;
    startupTimer = timers.setTimeout(() => {
      startupTimer = null;
      checkForUpdates().catch(error => { if (!disposed) setUpdateError(error); });
    }, 1000);
  }

  function dispose() {
    disposed = true;
    if (startupTimer !== null) timers.clearTimeout(startupTimer);
    startupTimer = null;
  }

  return {
    configureAutoUpdater,
    checkForUpdates,
    readAutoUpdateSetting,
    downloadUpdate,
    installUpdate,
    setUpdateError,
    sendUpdateState,
    scheduleStartupCheck,
    dispose,
    getState: () => updateManager.getUpdateState(),
  };
}

module.exports = { createDesktopUpdateController };
