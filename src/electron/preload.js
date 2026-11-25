'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, withPayload = true) {
  return (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = withPayload ? (_event, value) => callback(value) : () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}


contextBridge.exposeInMainWorld('playbackOutput', {
  invoke: (request) => ipcRenderer.invoke('playback-output:invoke', request),
  onFault: subscribe('playback-output:fault'),
});

contextBridge.exposeInMainWorld('audioAssistant', {
  invoke: (request) => ipcRenderer.invoke('audio-assistant:invoke', request),
  getComponentState: () => ipcRenderer.invoke('audio-component:get-state'),
  retryComponent: () => ipcRenderer.invoke('audio-component:retry'),
  onComponentState: subscribe('audio-component:state'),
  onState: subscribe('audio-assistant:state'),
});

contextBridge.exposeInMainWorld('plannerReminders', {
  getState: () => ipcRenderer.invoke('planner-reminders:get-state'),
  sync: (reminders) => ipcRenderer.invoke('planner-reminders:sync', reminders),
});

contextBridge.exposeInMainWorld('desktopNotifications', {
  getState: () => ipcRenderer.invoke('desktop-notifications:get-state'),
  update: (patch) => ipcRenderer.invoke('desktop-notifications:update', patch),
});

contextBridge.exposeInMainWorld('dailyBots', {
  invoke: (request) => ipcRenderer.invoke('daily-bots:invoke', request),
});

contextBridge.exposeInMainWorld('fanProfiles', {
  invoke: (request) => ipcRenderer.invoke('fan-profiles:invoke', request),
});

contextBridge.exposeInMainWorld('giftExport', {
  settings: (options) => ipcRenderer.invoke('gift-export:settings', options),
  prepare: (selection) => ipcRenderer.invoke('gift-export:prepare', selection),
  configure: (options) => ipcRenderer.invoke('gift-export:configure', options),
  save: (id, roomGuard) => ipcRenderer.invoke('gift-export:save', roomGuard ? { id, roomGuard } : { id }),
  cancel: (id) => ipcRenderer.invoke('gift-export:cancel', id),
  openFolder: (id) => ipcRenderer.invoke('gift-export:open-folder', { id }),
  onProgress: subscribe('gift-export:progress'),
});

contextBridge.exposeInMainWorld('weeklySchedule', {
  exportPng: (template) => ipcRenderer.invoke('weekly-schedule:export-png', template),
});

contextBridge.exposeInMainWorld('songAssistantDesktop', {
  pickScreenColor: () => ipcRenderer.invoke('desktop:pick-screen-color'),
  cancelScreenColor: () => ipcRenderer.invoke('desktop:cancel-screen-color'),
  setClientTheme: (themeId) => ipcRenderer.invoke('desktop:set-client-theme', themeId),
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  getResourceIntegrityState: () => ipcRenderer.invoke('desktop:get-resource-integrity-state'),
  checkResourceIntegrity: () => ipcRenderer.invoke('desktop:check-resource-integrity'),
  onResourceIntegrityState: subscribe('desktop:resource-integrity-state'),
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
  setAutoUpdate: (enabled) => ipcRenderer.invoke('desktop:set-auto-update', enabled),
  reportGiftDisplay: (gift) => ipcRenderer.invoke('desktop:gift-display', gift),
  onShowUpdatePage: subscribe('desktop:show-update-page', false),
  onUpdateState: subscribe('desktop:update-state'),
  onWindowMaximized: subscribe('desktop:window-maximized'),
});

contextBridge.exposeInMainWorld('musicAPI', {
  getAuthState: (platform) => ipcRenderer.invoke('music:get-auth-state', platform),
  login: (platform) => ipcRenderer.invoke('music:login', platform),
  logout: (platform) => ipcRenderer.invoke('music:logout', platform),
  clearCache: () => ipcRenderer.invoke('music:clear-cache'),
  providerHealth: (platform) => ipcRenderer.invoke('music:provider-health', platform),
  selectLocalFiles: () => ipcRenderer.invoke('music:select-local-files'),
  getRecentLocalFiles: () => ipcRenderer.invoke('music:get-recent-local-files'),
  selectWeSingCacheDirectory: () => ipcRenderer.invoke('music:select-wesing-cache'),
  resolveLocalMediaUrls: (paths) => ipcRenderer.invoke('music:resolve-local-media-urls', paths),
  savePlaybackState: (clientId, payload) => ipcRenderer.invoke('playback:save-state', { clientId, payload }),
  confirmShutdownFlush: () => ipcRenderer.invoke('playback:flush-ack'),
  onPrepareShutdown: subscribe('app:prepare-shutdown', false),
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

contextBridge.exposeInMainWorld('guardExpiryAuth', {
  getState: () => ipcRenderer.invoke('guard-expiry:get-state'),
  setSource: (source) => ipcRenderer.invoke('guard-expiry:set-source', source),
  login: () => ipcRenderer.invoke('guard-expiry:login'),
  logout: () => ipcRenderer.invoke('guard-expiry:logout'),
});

contextBridge.exposeInMainWorld('liraLicense', {
  getGiftInteractionState: () => ipcRenderer.invoke('license:get-gift-interaction-state'),
  setGiftInteraction: (key, enabled) => ipcRenderer.invoke('license:set-gift-interaction', { key, enabled }),
  setGiftThanksTemplates: (templates) => ipcRenderer.invoke('license:set-gift-thanks-templates', templates),
  setGiftThanksReplies: (replies) => ipcRenderer.invoke('license:set-gift-thanks-replies', replies),
  onGiftInteractionStateChanged: subscribe('license:gift-interaction-state-changed'),
  getState: () => ipcRenderer.invoke('license:get-state'),
  activate: (payload) => ipcRenderer.invoke('license:activate', payload),
  retry: () => ipcRenderer.invoke('license:retry'),
  getGiftCatalogState: () => ipcRenderer.invoke('license:get-gift-catalog-state'),
  getFontLibraryState: () => ipcRenderer.invoke('license:get-font-library-state'),
  retryFontLibrary: () => ipcRenderer.invoke('license:retry-font-library'),
  onFontLibraryStateChanged: subscribe('license:font-library-state-changed'),
  retryGiftCatalog: () => ipcRenderer.invoke('license:retry-gift-catalog'),
  getProfile: () => ipcRenderer.invoke('license:get-profile'),
  getOverlaySettings: () => ipcRenderer.invoke('license:get-overlay-settings'),
  getOverlayFilters: () => ipcRenderer.invoke('license:get-overlay-filters'),
  updateOverlayFilters: (settings) => ipcRenderer.invoke('license:update-overlay-filters', settings),
  getOverlayViewers: () => ipcRenderer.invoke('license:get-overlay-viewers'),
  getWelcomeSettings: () => ipcRenderer.invoke('license:get-welcome-settings'),
  getWelcomeSettingsV2: () => ipcRenderer.invoke('license:get-welcome-settings-v2'),
  updateWelcomeSettingsV2: (settings) => ipcRenderer.invoke('license:update-welcome-settings-v2', settings),
  getPkReportSettings: () => ipcRenderer.invoke('license:get-pk-report-settings'),
  getFixedReplySettings: () => ipcRenderer.invoke('license:get-fixed-reply-settings'),
  getViewerNameSettings: () => ipcRenderer.invoke('license:get-viewer-name-settings'),
  updateViewerNameSettings: (settings) => ipcRenderer.invoke('license:update-viewer-name-settings', settings),
  listViewerNames: (query) => ipcRenderer.invoke('license:list-viewer-names', query),
  updateViewerName: (value) => ipcRenderer.invoke('license:update-viewer-name', value),
  deleteViewerName: (uid) => ipcRenderer.invoke('license:delete-viewer-name', uid),
  updateFixedReplySettings: (settings) => ipcRenderer.invoke('license:update-fixed-reply-settings', settings),
  updatePkReportSettings: (settings) => ipcRenderer.invoke('license:update-pk-report-settings', settings),
  updateWelcomeSettings: (settings) => ipcRenderer.invoke('license:update-welcome-settings', settings),
  updateOverlaySettings: (settings) => ipcRenderer.invoke('license:update-overlay-settings', settings),
  syncSongs: (songs) => ipcRenderer.invoke('license:sync-songs', songs),
  getLocalSongCount: () => ipcRenderer.invoke('license:get-local-song-count'),
  syncCurrentSongs: (generation) => ipcRenderer.invoke('license:sync-current-songs', generation),
  getCloudSongs: () => ipcRenderer.invoke('license:get-cloud-songs'),
  getCloudSongCount: () => ipcRenderer.invoke('license:get-cloud-song-count'),
  getSongPageAccess: () => ipcRenderer.invoke('license:get-song-page-access'),
  setSongPageAccess: (enabled) => ipcRenderer.invoke('license:set-song-page-access', enabled),
  getSongPageBackground: () => ipcRenderer.invoke('license:get-song-page-background'),
  uploadSongPageBackground: (bytes, fileName) =>
    ipcRenderer.invoke('license:upload-song-page-background', {
      bytes,
      fileName,
    }),
  deleteSongPageBackground: () => ipcRenderer.invoke('license:delete-song-page-background'),
  onStateChanged: subscribe('license:state-changed'),
  onGiftCatalogStateChanged: subscribe('license:gift-catalog-state-changed'),
});
