'use strict';

const { createResourceIntegrityManager } = require('./resource-integrity-manager');
const { hasExactOrigin } = require('./local-media-access');

function createDesktopResourceIntegrity({ app, getMainWindow, getDesktopBaseUrl, writeLog }) {
  return createResourceIntegrityManager({
    fs: require('original-fs'),
    resourcesDir: process.resourcesPath,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    writeLog,
    onStateChange(state) {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      const url = mainWindow.webContents.mainFrame?.url;
      if (
        !hasExactOrigin(url, getDesktopBaseUrl()) ||
        !['/', '/admin', '/settings', '/songs'].includes(new URL(url).pathname)
      )
        return;
      mainWindow.webContents.send('desktop:resource-integrity-state', state);
    },
  });
}

module.exports = { createDesktopResourceIntegrity };
