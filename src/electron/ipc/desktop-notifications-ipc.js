'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

function registerDesktopNotificationsIpc({ ipcMain, notifications, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const channels = ['desktop-notifications:get-state', 'desktop-notifications:update'];
  function handle(channel, argumentCount, action) {
    register(channel, (event, ...args) => {
      if (new URL(event.senderFrame.url).pathname !== '/admin') return { ok: false, error: 'IPC_SOURCE_INVALID' };
      if (args.length !== argumentCount) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
      return action(...args);
    });
  }
  handle(channels[0], 0, () => notifications.getState());
  handle(channels[1], 1, (patch) => notifications.update(patch));
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel));
}

module.exports = { registerDesktopNotificationsIpc };
