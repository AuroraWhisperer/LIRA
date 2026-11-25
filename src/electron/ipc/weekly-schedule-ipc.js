'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');
const { createNavigationCancellation } = require('./navigation-cancellation');

function registerWeeklyScheduleIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const cancellation = createNavigationCancellation(() => controller.cancel());
  register('weekly-schedule:export-png', (_event, input) => {
    const contents = getMainWindow().webContents;
    cancellation.bind(contents);
    return controller.exportPng(input);
  }, { argumentCount: 1 });
  return () => {
    cancellation.unbind();
    controller.dispose();
    ipcMain.removeHandler('weekly-schedule:export-png');
  };
}

module.exports = { registerWeeklyScheduleIpc };
