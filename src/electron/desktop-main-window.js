'use strict';

const fs = require('node:fs');
const { getClientWindowBackground, bindClientAppearanceWindow } = require('./client-appearance');

function createDesktopMainWindow({
  BrowserWindow, preloadPath, iconPath, getThemeId, bindRequestAuth,
  onCloseRequest, onReady, writeLog, exists = fs.existsSync,
}) {
  let mainWindow = null;
  let baseUrl = '';

  function create(url, authorized = false) {
    baseUrl = url;
    const options = {
      width: 1260,
      height: 820,
      minWidth: 1024,
      minHeight: 680,
      show: false,
      title: 'LIRA',
      backgroundColor: getClientWindowBackground(url + (authorized ? '/admin' : '/license'), url, getThemeId()),
      frame: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    };
    if (exists(iconPath)) options.icon = iconPath;
    const window = new BrowserWindow(options);
    mainWindow = window;
    bindClientAppearanceWindow(window, url, getThemeId);
    bindRequestAuth(window);
    writeLog('window', { event: 'create', window: 'main' });
    window.loadURL(url + (authorized ? '/admin?desktop=1' : '/license'));

    function ready() {
      writeLog('window', { event: 'ready', window: 'main' });
      window.show();
      onReady();
    }
    function close(event) {
      event.preventDefault();
      onCloseRequest();
    }
    function maximized(value) {
      if (!window.isDestroyed()) window.webContents.send('desktop:window-maximized', value);
    }
    const maximize = () => maximized(true);
    const unmaximize = () => maximized(false);
    window.once('ready-to-show', ready);
    window.on('close', close);
    window.on('maximize', maximize);
    window.on('unmaximize', unmaximize);
    window.once('closed', () => {
      window.removeListener('ready-to-show', ready);
      window.removeListener('close', close);
      window.removeListener('maximize', maximize);
      window.removeListener('unmaximize', unmaximize);
      writeLog('window', { event: 'closed', window: 'main' });
      if (mainWindow === window) mainWindow = null;
    });
    return window;
  }

  function focus() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }

  return { create, focus, getWindow: () => mainWindow, getBaseUrl: () => baseUrl };
}

module.exports = { createDesktopMainWindow };
