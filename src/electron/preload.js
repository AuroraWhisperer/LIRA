'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('songAssistantDesktop', {
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  restart: () => ipcRenderer.invoke('desktop:restart'),
  closeWindow: () => ipcRenderer.invoke('desktop:close-window'),
  minimizeWindow: () => ipcRenderer.invoke('desktop:minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('desktop:maximize-window'),
  openDataDir: () => ipcRenderer.invoke('desktop:open-data-dir'),
  openLogDir: () => ipcRenderer.invoke('desktop:open-log-dir'),
  openGithub: () => ipcRenderer.invoke('desktop:open-github'),
  setAutoUpdate: (enabled) =>
    ipcRenderer.invoke('desktop:set-auto-update', enabled),
  reportGiftDisplay: (gift) => ipcRenderer.invoke('desktop:gift-display', gift),
  onShowUpdatePage: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = () => callback();
    ipcRenderer.on('desktop:show-update-page', listener);
    return () =>
      ipcRenderer.removeListener('desktop:show-update-page', listener);
  },
  onUpdateState: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:update-state', listener);
    return () => ipcRenderer.removeListener('desktop:update-state', listener);
  },
  onWindowMaximized: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on('desktop:window-maximized', listener);
    return () =>
      ipcRenderer.removeListener('desktop:window-maximized', listener);
  },
});

contextBridge.exposeInMainWorld('musicAPI', {
  getAuthState: (platform) =>
    ipcRenderer.invoke('music:get-auth-state', platform),
  login: (platform) => ipcRenderer.invoke('music:login', platform),
  logout: (platform) => ipcRenderer.invoke('music:logout', platform),
  clearCache: () => ipcRenderer.invoke('music:clear-cache'),
  providerHealth: (platform) =>
    ipcRenderer.invoke('music:provider-health', platform),
  selectLocalFiles: () => ipcRenderer.invoke('music:select-local-files'),
  getRecentLocalFiles: () => ipcRenderer.invoke('music:get-recent-local-files'),
  selectWeSingCacheDirectory: () =>
    ipcRenderer.invoke('music:select-wesing-cache'),
  resolveLocalMediaUrls: (paths) =>
    ipcRenderer.invoke('music:resolve-local-media-urls', paths),
  savePlaybackState: (clientId, payload) =>
    ipcRenderer.invoke('playback:save-state', { clientId, payload }),
  confirmShutdownFlush: () => ipcRenderer.invoke('playback:flush-ack'),
  onPrepareShutdown: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = () => callback();
    ipcRenderer.on('app:prepare-shutdown', listener);
    return () => ipcRenderer.removeListener('app:prepare-shutdown', listener);
  },
});

contextBridge.exposeInMainWorld('bilibiliAuth', {
  getAuthState: () => ipcRenderer.invoke('bilibili:get-auth-state'),
  getProfile: () => ipcRenderer.invoke('bilibili:get-profile'),
  login: () => ipcRenderer.invoke('bilibili:login'),
  logout: () => ipcRenderer.invoke('bilibili:logout'),
});

contextBridge.exposeInMainWorld('liraLicense', {
  getState: () => ipcRenderer.invoke('license:get-state'),
  activate: (payload) => ipcRenderer.invoke('license:activate', payload),
  retry: () => ipcRenderer.invoke('license:retry'),
  getProfile: () => ipcRenderer.invoke('license:get-profile'),
  syncSongs: (songs) => ipcRenderer.invoke('license:sync-songs', songs),
  getCloudSongs: () => ipcRenderer.invoke('license:get-cloud-songs'),
  getSongPageBackground: () =>
    ipcRenderer.invoke('license:get-song-page-background'),
  uploadSongPageBackground: (bytes, fileName) =>
    ipcRenderer.invoke('license:upload-song-page-background', {
      bytes,
      fileName,
    }),
  deleteSongPageBackground: () =>
    ipcRenderer.invoke('license:delete-song-page-background'),
  onStateChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('license:state-changed', listener);
    return () => ipcRenderer.removeListener('license:state-changed', listener);
  },
});
