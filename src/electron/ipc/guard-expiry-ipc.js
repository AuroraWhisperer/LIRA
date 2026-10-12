'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');
const { publicAccount } = require('../guard-expiry-auth');

const ERRORS = new Set([
  'LICENSE_NOT_AUTHORIZED', 'INVALID_RESPONSE', 'INVALID_GUARD_EXPIRY_ACCOUNT',
  'GUARD_EXPIRY_OWNER_MISMATCH', 'GUARD_EXPIRY_ROOM_REQUIRED', 'GUARD_EXPIRY_SOURCE_CHANGED',
  'GUARD_EXPIRY_UNAVAILABLE', 'BILIBILI_CREDENTIALS_INVALID', 'BILIBILI_ACCOUNT_CHECK_FAILED',
  'TOO_MANY_GUARD_EXPIRY_REQUESTS', 'GUARD_EXPIRY_UNSUPPORTED',
]);

function registerGuardExpiryIpc({ ipcMain, auth, getMainWindow, getDesktopBaseUrl }) {
  const handle = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const channels = [];
  for (const [action, method] of [['get-state', 'getState'], ['set-source', 'setSource'], ['login', 'login'], ['logout', 'logout']]) {
    const channel = `guard-expiry:${action}`;
    channels.push(channel);
    handle(channel, async (_event, source) => {
      try {
        const state = await auth[method](...(action === 'set-source' ? [source] : []));
        return state ? { ok: true, account: publicAccount(state) } : { ok: true, cancelled: true };
      } catch (error) {
        return { ok: false, error: ERRORS.has(error?.code) ? error.code : 'GUARD_EXPIRY_UNAVAILABLE' };
      }
    });
  }
  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}

module.exports = { registerGuardExpiryIpc };
