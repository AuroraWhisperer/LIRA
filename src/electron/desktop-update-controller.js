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
  let state = {
    status: 'idle', message: '尚未检查更新', version: '', canDownload: false,
    canInstall: false, progress: null, updateVersion: '',
  };
  let startupTimer = null;
  let disposed = false;

  function sendUpdateState() {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send('desktop:update-state', state);
  }

  function configureAutoUpdater() {
    updateManager.configureAutoUpdater({
      onStateChange(nextState) {
        state = nextState;
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
      return getAutoUpdateSetting() === 'true';
    } catch (_) {
      return false;
    }
  }

  function downloadUpdate() {
    return updateManager.downloadUpdate();
  }

  async function installUpdate() {
    if (state.canInstall) await beforeInstall();
    return updateManager.installUpdate();
  }

  function setUpdateState(nextState) {
    state = {
      ...state,
      ...nextState,
      version: app.getVersion(),
    };
    sendUpdateState();
    return state;
  }

  function setUpdateError(error) {
    writeLog('update-error', error);
    const friendly = updateManager.friendlyUpdateError(error);
    setUpdateState({
      status: friendly.status,
      message: friendly.message,
      canDownload: false,
      canInstall: false,
      progress: null,
    });
  }

  function setDevelopmentMode() {
    state = {
      ...state,
      status: 'dev-disabled',
      message: '开发模式不检查 GitHub 更新；打包安装后自动启用。',
      canDownload: false,
      canInstall: false,
    };
    sendUpdateState();
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
    setDevelopmentMode,
    scheduleStartupCheck,
    dispose,
    getState: () => state,
  };
}

module.exports = { createDesktopUpdateController };
