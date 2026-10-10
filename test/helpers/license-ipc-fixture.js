'use strict';

const { registerLicenseIpc } = require('../../src/electron/ipc/license-ipc');

const DESKTOP_BASE_URL = 'http://127.0.0.1:3210';

// Registers the real license IPC handlers against a stub ipcMain and window.
// `licenseManager` overrides are merged onto authorized defaults; tests may
// replace methods on the returned `licenseManager` between invocations.
function createLicenseIpcFixture({ licenseManager = {}, giftCatalog, cloudSyncController, framePath = '/admin?desktop=1' } = {}) {
  const handlers = new Map();
  const sent = [];
  const webContents = { send: (...args) => sent.push(args) };
  const mainWindow = { webContents, isDestroyed: () => false };
  const manager = Object.assign(
    {
      LicenseState: { AUTHORIZED: 'authorized' },
      getState: () => 'authorized',
      getSnapshot: () => ({}),
      onStateChanged: () => () => {},
    },
    licenseManager,
  );
  registerLicenseIpc({
    ipcMain: {
      removeHandler() {},
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    licenseManager: manager,
    getCloudSyncController: () => cloudSyncController || { syncSongs: (songs) => manager.syncSongs(songs) },
    giftCatalog,
    getMainWindow: () => mainWindow,
    getDesktopBaseUrl: () => DESKTOP_BASE_URL,
    hasExactOrigin: (candidate, expected) => new URL(candidate).origin === new URL(expected).origin,
  });
  const eventFrom = (url) => ({ sender: webContents, senderFrame: { url } });
  const trustedEvent = eventFrom(`${DESKTOP_BASE_URL}${framePath}`);
  return {
    handlers,
    sent,
    licenseManager: manager,
    trustedEvent,
    eventFrom,
    invoke: (channel, ...args) => handlers.get(channel)(trustedEvent, ...args),
  };
}

module.exports = { createLicenseIpcFixture, DESKTOP_BASE_URL };
