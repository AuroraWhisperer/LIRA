'use strict';

function createDesktopUpdateController({
  app,
  updateManager,
  updateRuntime,
  getRuntime,
  getMainWindow,
  writeLog,
}) {
  function sendUpdateState() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send('desktop:update-state', updateRuntime.value);
    if (updateRuntime.value.status === updateRuntime.lastStatus) return;

    updateRuntime.lastStatus = updateRuntime.value.status;
    if (
      updateRuntime.value.status === 'available' ||
      updateRuntime.value.status === 'downloaded'
    ) {
      mainWindow.webContents.send('desktop:show-update-page');
    }
  }

  function configureAutoUpdater() {
    updateManager.configureAutoUpdater({
      onStateChange(state) {
        updateRuntime.value = state;
        sendUpdateState();
      },
      writeLog,
    });
  }

  function checkForUpdates() {
    return updateManager.checkForUpdates();
  }

  function readAutoUpdateSetting() {
    try {
      const runtime = getRuntime();
      return Boolean(
        runtime &&
        typeof runtime.getSetting === 'function' &&
        runtime.getSetting('enableAutoUpdate') === 'true',
      );
    } catch (_) {
      return false;
    }
  }

  function downloadUpdate() {
    return updateManager.downloadUpdate();
  }

  function installUpdate() {
    return updateManager.installUpdate();
  }

  function setUpdateState(nextState) {
    updateRuntime.value = {
      ...updateRuntime.value,
      ...nextState,
      version: app.getVersion(),
    };
    sendUpdateState();
    return updateRuntime.value;
  }

  function setUpdateError(error) {
    writeLog('update-error', error);
    const friendly = updateManager.friendlyUpdateError(error);
    setUpdateState({
      status: friendly.status,
      message: friendly.message,
      canDownload: false,
      canInstall: false,
    });
  }

  return {
    configureAutoUpdater,
    checkForUpdates,
    readAutoUpdateSetting,
    downloadUpdate,
    installUpdate,
    setUpdateError,
    sendUpdateState,
  };
}

module.exports = { createDesktopUpdateController };
