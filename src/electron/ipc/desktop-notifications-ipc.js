'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

function registerDesktopNotificationsIpc({ ipcMain, notifications, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl, allowedPaths: new Set(['/admin']) });
  const channels = ['desktop-notifications:get-state', 'desktop-notifications:update'];
  register(channels[0], () => notifications.getState(), { argumentCount: 0 });
  register(channels[1], (_event, patch) => notifications.update(patch), { argumentCount: 1 });
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel));
}

module.exports = { registerDesktopNotificationsIpc };
