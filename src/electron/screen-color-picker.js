'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createMainWindowIpcRegistrar } = require('./ipc/main-window-ipc');

const PICK = 'desktop:pick-screen-color';
const CANCEL = 'desktop:cancel-screen-color';
const REPLY = 'screen-color-picker:reply';
const PAGE = path.join(__dirname, 'screen-color-picker.html');

function registerScreenColorPicker({ ipcMain, BrowserWindow, desktopCapturer, screen, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  let active;

  function finish(result, restoreFocus = true) {
    const operation = active;
    if (!operation) return;
    active = null;
    clearTimeout(operation.timeout);
    operation.sender.removeListener('destroyed', operation.cancel);
    operation.sender.removeListener('render-process-gone', operation.cancel);
    operation.sender.removeListener('did-start-navigation', operation.navigate);
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(event, operation.cancel);
    for (const { window } of operation.windows.values()) if (!window.isDestroyed()) window.destroy();
    operation.windows.clear();
    const owner = getMainWindow();
    if (restoreFocus && owner && !owner.isDestroyed() && owner.webContents === operation.sender) owner.focus();
    operation.resolve(result);
  }

  async function show(operation) {
    try {
      const displays = screen.getAllDisplays();
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
        width: Math.max(...displays.map(display => Math.ceil(display.size.width * display.scaleFactor))),
        height: Math.max(...displays.map(display => Math.ceil(display.size.height * display.scaleFactor))),
      } });
      if (active !== operation) return;
      const images = displays.map(display => {
        const image = sources.find(source => source.display_id === String(display.id))?.thumbnail;
        if (!image || image.isEmpty()) throw new Error('Screen capture unavailable');
        return { display, image };
      });
      for (const { display, image } of images) {
        const window = new BrowserWindow({
          ...display.bounds, show: false, frame: false, resizable: false, movable: false,
          skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, enableLargerThanScreen: true,
          webPreferences: { preload: path.join(__dirname, 'screen-color-picker-preload.js'),
            contextIsolation: true, sandbox: true, nodeIntegration: false,
            partition: 'lira-screen-color-picker', zoomFactor: 1 },
        });
        operation.windows.set(window.webContents, { window, image, ready: false });
        window.setAlwaysOnTop(true, 'screen-saver');
        window.setBounds(display.bounds);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', event => event.preventDefault());
        window.webContents.once('render-process-gone', operation.cancel);
        window.once('closed', operation.cancel);
        await window.loadFile(PAGE);
        if (active !== operation) return;
        window.webContents.send('screen-color-picker:image', image.toDataURL());
      }
    } catch {
      if (active === operation) finish({ ok: false, error: 'SCREEN_COLOR_PICK_FAILED' });
    }
  }

  function reply(event, value) {
    const operation = active;
    const entry = operation?.windows.get(event.sender);
    if (!entry || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== pathToFileURL(PAGE).href) return;
    if (value?.type === 'cancel') { finish({ ok: true, canceled: true }); return; }
    if (value?.type === 'ready') {
      entry.ready = true;
      if (operation.windows.size !== screen.getAllDisplays().length || ![...operation.windows.values()].every(item => item.ready)) return;
      clearTimeout(operation.timeout);
      for (const { window } of operation.windows.values()) window.showInactive();
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const target = [...operation.windows.values()].find(({ window }) => window.getBounds().x === display.bounds.x && window.getBounds().y === display.bounds.y);
      (target || entry).window.focus();
      return;
    }
    if (value?.type !== 'pick' || !entry.ready || !Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < 0 || value.x >= 1 || value.y < 0 || value.y >= 1) return;
    const { width, height } = entry.image.getSize();
    const pixel = entry.image.crop({ x: Math.floor(value.x * width), y: Math.floor(value.y * height), width: 1, height: 1 }).toBitmap();
    const sRGBHex = `#${[pixel[2], pixel[1], pixel[0]].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    finish({ ok: true, sRGBHex });
  }

  ipcMain.on(REPLY, reply);
  register(PICK, (event, ...args) => {
    if (args.length) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
    if (active) return { ok: false, error: 'SCREEN_COLOR_PICK_BUSY' };
    return new Promise(resolve => {
      const operation = { sender: event.sender, resolve, windows: new Map() };
      active = operation;
      operation.cancel = () => finish({ ok: true, canceled: true }, false);
      operation.navigate = (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) operation.cancel(); };
      operation.timeout = setTimeout(() => {
        if (active === operation) finish({ ok: false, error: 'SCREEN_COLOR_PICK_FAILED' });
      }, 15000);
      event.sender.once('destroyed', operation.cancel);
      event.sender.once('render-process-gone', operation.cancel);
      event.sender.on('did-start-navigation', operation.navigate);
      for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, operation.cancel);
      void show(operation);
    });
  });
  register(CANCEL, (_event, ...args) => {
    if (args.length) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
    finish({ ok: true, canceled: true });
    return { ok: true };
  });
  return () => {
    finish({ ok: true, canceled: true }, false);
    ipcMain.removeHandler(PICK);
    ipcMain.removeHandler(CANCEL);
    ipcMain.removeListener(REPLY, reply);
  };
}

module.exports = { registerScreenColorPicker };
