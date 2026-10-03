'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');
const { getClientWindowBackground } = require('../client-appearance');

function registerClientAppearanceIpc({ ipcMain, appearance, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const channel = 'desktop:set-client-theme';
  register(channel, async (_event, ...args) => {
    if (args.length !== 1) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
    const result = await appearance.setThemeId(args[0]);
    const window = getMainWindow();
    if (result.ok && window && !window.isDestroyed()) {
      window.setBackgroundColor(getClientWindowBackground(window.webContents.getURL(), getDesktopBaseUrl(), appearance.getThemeId()));
    }
    return result;
  });
  return () => ipcMain.removeHandler(channel);
}

module.exports = { registerClientAppearanceIpc };
