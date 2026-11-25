'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');
function registerDailyBotIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl, allowedPaths: new Set(['/', '/admin', '/settings']) });
  const channel = 'daily-bots:invoke';
  register(channel, async (event, request) => {
    try {
      return { ok: true, ...(await controller.invoke(request)) };
    } catch (error) {
      return {
        ok: false,
        error:
          error.status === 404 && !String(error.code || '').startsWith('DAILY_BOT_')
            ? 'DAILY_BOT_UNSUPPORTED'
            : /^(DAILY_BOT_[A-Z_]+|LICENSE_NOT_AUTHORIZED)$/.test(error.code || '')
              ? error.code
              : 'DAILY_BOT_UNAVAILABLE',
      };
    }
  });
  return () => {
    ipcMain.removeHandler(channel);
    controller.dispose();
  };
}
module.exports = { registerDailyBotIpc };
