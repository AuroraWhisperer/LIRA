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
  onShowUpdatePage: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = () => callback();
    ipcRenderer.on('desktop:show-update-page', listener);
    return () => ipcRenderer.removeListener('desktop:show-update-page', listener);
  },
  onUpdateState: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:update-state', listener);
    return () => ipcRenderer.removeListener('desktop:update-state', listener);
  }
});

contextBridge.exposeInMainWorld('musicAPI', {
  getAuthState: (platform) => ipcRenderer.invoke('music:get-auth-state', platform),
  login: (platform) => ipcRenderer.invoke('music:login', platform),
  logout: (platform) => ipcRenderer.invoke('music:logout', platform),
  providerHealth: (platform) => ipcRenderer.invoke('music:provider-health', platform),
  openLyricWindow: () => ipcRenderer.invoke('music:open-lyric-window'),
  closeLyricWindow: () => ipcRenderer.invoke('music:close-lyric-window'),
  updateLyricWindow: (state) => ipcRenderer.invoke('music:update-lyric-window', state),
  setLyricWindowLocked: (locked) => ipcRenderer.invoke('music:set-lyric-window-locked', locked),
  onLyricState: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_event, state) => callback(state);
    ipcRenderer.on('music:lyric-state', listener);
    return () => ipcRenderer.removeListener('music:lyric-state', listener);
  }
});
