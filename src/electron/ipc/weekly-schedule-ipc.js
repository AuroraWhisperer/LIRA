'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

function registerWeeklyScheduleIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  let owner = null;
  const cancel = () => controller.cancel();
  const navigation = (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) cancel();
  };
  function unbind() {
    owner?.removeListener('did-start-navigation', navigation);
    owner?.removeListener('destroyed', cancel);
    owner = null;
  }
  register('weekly-schedule:export-png', (_event, ...args) => {
    if (args.length !== 1) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
    const contents = getMainWindow().webContents;
    if (owner !== contents) {
      unbind();
      owner = contents;
      owner.on('did-start-navigation', navigation);
      owner.on('destroyed', cancel);
    }
    return controller.exportPng(args[0]);
  });
  return () => {
    unbind();
    controller.dispose();
    ipcMain.removeHandler('weekly-schedule:export-png');
  };
}

module.exports = { registerWeeklyScheduleIpc };
