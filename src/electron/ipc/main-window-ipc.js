'use strict';

const { hasExactOrigin } = require('../local-media-access');
const ADMIN_PATHS = new Set(['/', '/admin', '/settings', '/songs']);

function createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl, allowLicense = false }) {
  return (channel, handler) => {
    ipcMain.handle(channel, (event, ...args) => {
      const window = getMainWindow();
      const frame = event?.senderFrame;
      if (
        !window || window.isDestroyed() ||
        event?.sender !== window.webContents || frame !== window.webContents.mainFrame ||
        !hasExactOrigin(frame?.url, getDesktopBaseUrl())
      ) return { ok: false, error: 'IPC_SOURCE_INVALID' };
      const pathname = new URL(frame.url).pathname;
      if (!ADMIN_PATHS.has(pathname) && !(allowLicense && pathname === '/license')) {
        return { ok: false, error: 'IPC_SOURCE_INVALID' };
      }
      return handler(event, ...args);
    });
  };
}

module.exports = { createMainWindowIpcRegistrar };
