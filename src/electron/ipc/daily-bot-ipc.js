'use strict';

const { hasExactOrigin } = require('../local-media-access');
function registerDailyBotIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const channel = 'daily-bots:invoke';
  ipcMain.handle(channel, async (event, request) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      !hasExactOrigin(event.senderFrame.url, getDesktopBaseUrl()) ||
      !['/', '/admin', '/settings'].includes(new URL(event.senderFrame.url).pathname)) {
      return { ok: false, error: 'IPC_SOURCE_INVALID' };
    }
    try { return { ok: true, ...await controller.invoke(request) }; }
    catch (error) {
      return { ok: false, error: error.status === 404 && !String(error.code || '').startsWith('DAILY_BOT_')
        ? 'DAILY_BOT_UNSUPPORTED' : /^(DAILY_BOT_[A-Z_]+|LICENSE_NOT_AUTHORIZED)$/.test(error.code || '')
          ? error.code : 'DAILY_BOT_UNAVAILABLE' };
    }
  });
  return () => { ipcMain.removeHandler(channel); controller.dispose(); };
}
module.exports = { registerDailyBotIpc };
