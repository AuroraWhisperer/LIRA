'use strict';

const { hasExactOrigin } = require('../local-media-access');

const PUBLIC_ERRORS = new Set([
  'LOTTERY_IDENTITY_UNAVAILABLE',
  'LOTTERY_SESSION_CHANGED',
  'LOTTERY_SESSION_DISPOSED',
  'LOTTERY_AUTH_BUSY',
  'LOTTERY_AUTH_ENCRYPTION_UNAVAILABLE',
  'LOTTERY_AUTH_RESTORE_FAILED',
]);

function registerDynamicLotteryAuthIpc({ ipcMain, auth, getMainWindow, getDesktopBaseUrl }) {
  const channels = [];
  for (const [action, method] of [
    ['get-state', 'getAuthState'],
    ['login', 'login'],
    ['logout', 'logout'],
  ]) {
    const channel = `dynamic-lottery-auth:${action}`;
    channels.push(channel);
    ipcMain.handle(channel, async (event) => {
      const window = getMainWindow();
      if (
        !window ||
        window.isDestroyed() ||
        event?.sender !== window.webContents ||
        event?.senderFrame !== window.webContents.mainFrame ||
        !hasExactOrigin(event?.senderFrame?.url, getDesktopBaseUrl())
      ) {
        return { ok: false, error: 'IPC_SOURCE_INVALID' };
      }
      try {
        const state = await auth[method]();
        const loggedIn =
          state?.loggedIn === true && typeof state?.uid === 'string' && /^[1-9]\d{0,63}$/u.test(state.uid);
        return {
          ok: true,
          state: {
            loggedIn,
            uid: loggedIn ? state.uid : '',
            warning: PUBLIC_ERRORS.has(state?.warning) ? state.warning : '',
          },
        };
      } catch (error) {
        const code = error?.code || error?.message;
        return {
          ok: false,
          error: PUBLIC_ERRORS.has(code) ? code : 'LOTTERY_AUTH_FAILED',
        };
      }
    });
  }
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}

module.exports = { registerDynamicLotteryAuthIpc };
