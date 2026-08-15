'use strict';

const fs = require('node:fs');
const path = require('node:path');

function registerMusicIpc({
  ipcMain,
  dialog,
  getMainWindow,
  getDesktopBaseUrl,
  getDesktopRuntime,
  getAppDataPath,
  getLocalMediaAccess,
  getMusicAuthState,
  loginMusicAccount,
  logoutMusicAccount,
  openLyricWindow,
  closeLyricWindow,
  updateLyricWindow,
  setLyricWindowLocked,
  getMusicProviderRegistry,
  hasExactOrigin,
  isPathAllowedForLocalMedia,
  acknowledgePlaybackFlush,
  writePlaybackSnapshot
}) {
  ipcMain.handle('music:get-auth-state', function (_event, platform) { return getMusicAuthState(platform); });
  ipcMain.handle('music:login', function (_event, platform) { return loginMusicAccount(platform); });
  ipcMain.handle('music:logout', function (_event, platform) { return logoutMusicAccount(platform); });
  ipcMain.handle('music:open-lyric-window', function () { return openLyricWindow(); });
  ipcMain.handle('music:close-lyric-window', function () { return closeLyricWindow(); });
  ipcMain.handle('music:update-lyric-window', function (_event, state) { return updateLyricWindow(state); });
  ipcMain.handle('music:set-lyric-window-locked', function (_event, locked) { return setLyricWindowLocked(locked); });
  ipcMain.handle('music:provider-health', async function (_event, platform) {
    return getMusicProviderRegistry().healthCheck(platform);
  });
  ipcMain.handle('music:select-local-files', async function () {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: '选择本地音频文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma'] }]
    });
    if (result.canceled) return { ok: true, canceled: true, files: [] };
    const localMediaAccess = getLocalMediaAccess();
    const selectedPaths = result.filePaths || [];
    localMediaAccess.allowPaths(selectedPaths);
    const files = selectedPaths.map((filePath) => ({
      path: filePath, name: path.basename(filePath), ext: path.extname(filePath)
    }));
    return { ok: true, canceled: false, files };
  });
  ipcMain.handle('music:get-recent-local-files', function () {
    const localMediaAccess = getLocalMediaAccess();
    if (!localMediaAccess || typeof localMediaAccess.getAllowedPaths !== 'function') return { files: [] };
    const files = localMediaAccess.getAllowedPaths()
      .filter((filePath) => { try { return fs.existsSync(filePath); } catch (_) { return false; } })
      .map((filePath) => ({ path: filePath, name: path.basename(filePath), ext: path.extname(filePath) }));
    return { files };
  });
  ipcMain.handle('music:select-wesing-cache', async function (event) {
    const senderUrl = event && event.senderFrame ? event.senderFrame.url : '';
    if (!hasExactOrigin(senderUrl, getDesktopBaseUrl())) {
      return { ok: false, canceled: true, path: '', error: 'Invalid request origin' };
    }
    const desktopRuntime = getDesktopRuntime();
    const savedPath = desktopRuntime && typeof desktopRuntime.getSetting === 'function'
      ? desktopRuntime.getSetting('weSingCachePath') : '';
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: '选择全民 K 歌 WeSingCache 目录',
      defaultPath: savedPath || getAppDataPath(),
      properties: ['openDirectory']
    });
    if (result.canceled) return { ok: true, canceled: true, path: '' };
    return { ok: true, canceled: false, path: (result.filePaths || [])[0] || '' };
  });
  ipcMain.handle('music:resolve-local-media-urls', async function (event, paths) {
    const senderUrl = event && event.senderFrame ? event.senderFrame.url : '';
    if (!hasExactOrigin(senderUrl, getDesktopBaseUrl())) return { results: {} };
    const results = {};
    const list = Array.isArray(paths) ? paths : [];
    for (const filePath of list) {
      try {
        const resolved = path.resolve(filePath);
        if (fs.existsSync(resolved) && isPathAllowedForLocalMedia(resolved)) {
          const encoded = Buffer.from(filePath, 'utf8').toString('base64url');
          results[filePath] = { ok: true, url: `local-media://media/${encoded}` };
        } else {
          results[filePath] = { ok: false, reason: fs.existsSync(resolved) ? 'not-allowed' : 'missing' };
        }
      } catch (_) {
        results[filePath] = { ok: false, reason: 'error' };
      }
    }
    return { results };
  });
  ipcMain.handle('playback:save-state', function (_event, data) {
    return writePlaybackSnapshot((data && data.payload) || {}, (data && data.clientId) || 'default');
  });
  ipcMain.handle('playback:flush-ack', function () {
    acknowledgePlaybackFlush();
    return { ok: true };
  });
}

module.exports = { registerMusicIpc };
