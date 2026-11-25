'use strict';

const { ADMIN_PAGE_PATHS } = require('../../shared/admin-page-paths');

const { hasExactOrigin } = require('../local-media-access');
const ADMIN_PATHS = new Set(ADMIN_PAGE_PATHS);

function createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl, allowLicense = false, allowedPaths = ADMIN_PATHS,
  onInvalidSource = () => ({ ok: false, error: 'IPC_SOURCE_INVALID' }) }) {
  return (channel, handler, { argumentCount } = {}) => {
    ipcMain.handle(channel, (event, ...args) => {
      const window = getMainWindow();
      const frame = event?.senderFrame;
      if (
        !window ||
        window.isDestroyed() ||
        event?.sender !== window.webContents ||
        frame !== window.webContents.mainFrame ||
        !hasExactOrigin(frame?.url, getDesktopBaseUrl())
      )
        return onInvalidSource();
      const pathname = new URL(frame.url).pathname;
      if (!allowedPaths.has(pathname) && !(allowLicense && pathname === '/license')) {
        return onInvalidSource();
      }
      if (argumentCount !== undefined && args.length !== argumentCount) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
      return handler(event, ...args);
    });
  };
}

module.exports = { createMainWindowIpcRegistrar };
