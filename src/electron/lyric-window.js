'use strict';

const { BrowserWindow } = require('electron');
const { normalizeLyricState } = require('../music/lyric-state');

let lyricWindow = null;

function openLyricWindow(baseUrl, preloadPath) {
  if (lyricWindow && !lyricWindow.isDestroyed()) {
    lyricWindow.showInactive();
    return { open: true };
  }

  lyricWindow = new BrowserWindow({
    width: 840,
    height: 128,
    minWidth: 280,
    minHeight: 64,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    show: false,
    title: '桌面歌词',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  lyricWindow.loadURL(`${baseUrl}/lyrics?desktop=1`)
    .catch((error) => console.warn('[lyric-window] load failed:', error.message));
  lyricWindow.once('ready-to-show', () => lyricWindow?.showInactive());
  lyricWindow.on('closed', () => { lyricWindow = null; });
  return { open: true };
}

function closeLyricWindow() {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.close();
  lyricWindow = null;
  return { open: false };
}

function updateLyricWindow(state) {
  if (!lyricWindow || lyricWindow.isDestroyed()) return { open: false };
  lyricWindow.webContents.send('music:lyric-state', normalizeLyricState(state));
  return { open: true };
}

function setLyricWindowLocked(locked) {
  if (!lyricWindow || lyricWindow.isDestroyed()) return { open: false, locked: false };
  const nextLocked = locked === true;
  lyricWindow.setIgnoreMouseEvents(nextLocked, { forward: true });
  lyricWindow.webContents.send('music:lyric-state', { locked: nextLocked });
  return { open: true, locked: nextLocked };
}

module.exports = { openLyricWindow, closeLyricWindow, updateLyricWindow, setLyricWindowLocked };
