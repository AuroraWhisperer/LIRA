'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');
const { getClientWindowBackground } = require('../client-appearance');

function registerClientAppearanceIpc({ ipcMain, appearance, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const channel = 'desktop:set-client-theme';
  register(channel, async (_event, themeId) => {
    const result = await appearance.setThemeId(themeId);
    const window = getMainWindow();
    if (result.ok && window && !window.isDestroyed()) {
      window.setBackgroundColor(getClientWindowBackground(window.webContents.getURL(), getDesktopBaseUrl(), appearance.getThemeId()));
    }
    return result;
  }, { argumentCount: 1 });
  const fontChannel = 'desktop:set-client-font';
  register(fontChannel, (_event, fontId) => appearance.setFontId(fontId), { argumentCount: 1 });
  return () => {
    ipcMain.removeHandler(channel);
    ipcMain.removeHandler(fontChannel);
  };
}

module.exports = { registerClientAppearanceIpc };
