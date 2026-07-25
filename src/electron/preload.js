'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('songAssistantDesktop', {
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
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
