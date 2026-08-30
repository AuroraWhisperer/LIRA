'use strict';

function registerBilibiliIpc({ ipcMain, getAuthState, login, logout }) {
  ipcMain.handle('bilibili:get-auth-state', function () {
    return getAuthState();
  });
  ipcMain.handle('bilibili:login', function () {
    return login();
  });
  ipcMain.handle('bilibili:logout', function () {
    return logout();
  });
}

module.exports = { registerBilibiliIpc };
