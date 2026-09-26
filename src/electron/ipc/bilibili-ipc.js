'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

function registerBilibiliIpc({ ipcMain, getMainWindow, getDesktopBaseUrl, getAuthState, getProfile, login, logout }) {
  const handle = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  handle('bilibili:get-auth-state', function () {
    return getAuthState();
  });
  handle('bilibili:get-profile', function () {
    return getProfile();
  });
  handle('bilibili:login', function () {
    return login();
  });
  handle('bilibili:logout', function () {
    return logout();
  });
}

module.exports = { registerBilibiliIpc };
