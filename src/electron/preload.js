'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dailyBots', {
  invoke: (request) => ipcRenderer.invoke('daily-bots:invoke', request),
});

contextBridge.exposeInMainWorld('fanProfiles', {
  invoke: (request) => ipcRenderer.invoke('fan-profiles:invoke', request),
});

contextBridge.exposeInMainWorld('giftExport', {
  prepare: (selection) => ipcRenderer.invoke('gift-export:prepare', selection),
  configure: (options) => ipcRenderer.invoke('gift-export:configure', options),
  save: (id) => ipcRenderer.invoke('gift-export:save', { id }),
  cancel: (id) => ipcRenderer.invoke('gift-export:cancel', id),
  openFolder: (id) => ipcRenderer.invoke('gift-export:open-folder', { id }),
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('gift-export:progress', listener);
    return () => ipcRenderer.removeListener('gift-export:progress', listener);
  },
});

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

contextBridge.exposeInMainWorld('dynamicLotteryAuth', {
  getState: () => ipcRenderer.invoke('dynamic-lottery-auth:get-state'),
  login: () => ipcRenderer.invoke('dynamic-lottery-auth:login'),
  logout: () => ipcRenderer.invoke('dynamic-lottery-auth:logout'),
});

contextBridge.exposeInMainWorld('liraLicense', {
  getGiftInteractionState: () =>
    ipcRenderer.invoke('license:get-gift-interaction-state'),
  setGiftInteraction: (key, enabled) =>
    ipcRenderer.invoke('license:set-gift-interaction', { key, enabled }),
  onGiftInteractionStateChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('license:gift-interaction-state-changed', listener);
    return () => ipcRenderer.removeListener(
      'license:gift-interaction-state-changed', listener,
    );
  },
  getState: () => ipcRenderer.invoke('license:get-state'),
  activate: (payload) => ipcRenderer.invoke('license:activate', payload),
  retry: () => ipcRenderer.invoke('license:retry'),
  getGiftCatalogState: () =>
    ipcRenderer.invoke('license:get-gift-catalog-state'),
  retryGiftCatalog: () => ipcRenderer.invoke('license:retry-gift-catalog'),
  getProfile: () => ipcRenderer.invoke('license:get-profile'),
  getOverlaySettings: () => ipcRenderer.invoke('license:get-overlay-settings'),
  getWelcomeSettings: () => ipcRenderer.invoke('license:get-welcome-settings'),
  getWelcomeSettingsV2: () => ipcRenderer.invoke('license:get-welcome-settings-v2'),
  updateWelcomeSettingsV2: (settings) => ipcRenderer.invoke('license:update-welcome-settings-v2', settings),
  getPkReportSettings: () => ipcRenderer.invoke('license:get-pk-report-settings'),
  updatePkReportSettings: (settings) =>
    ipcRenderer.invoke('license:update-pk-report-settings', settings),
  updateWelcomeSettings: (settings) =>
    ipcRenderer.invoke('license:update-welcome-settings', settings),
  updateOverlaySettings: (settings) =>
    ipcRenderer.invoke('license:update-overlay-settings', settings),
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
  onGiftCatalogStateChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('license:gift-catalog-state-changed', listener);
    return () =>
      ipcRenderer.removeListener(
        'license:gift-catalog-state-changed',
        listener,
      );
  },
});
