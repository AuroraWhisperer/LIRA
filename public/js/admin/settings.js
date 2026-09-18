// 编写人：Aurora
// 设置页组合根：连接 DOM 适配器、设置操作和兼容层。
'use strict';

import {
  api,
  dangerConfirm,
  localOverlayOrigin,
  logoutConfirm,
  readJsonResponse,
  showConfirmationDialog,
  showStackedToast,
  toast,
  value,
} from '../shared/utils.js';
import { initBilibiliAuth as initBilibiliAuthImpl } from './settings-auth.js';
import { createBlindboxSettings } from './settings-blindbox.js';
import { createSettingsForm } from './settings-form.js';
import { initLicenseAccountDevice as initLicenseAccountDeviceImpl } from './settings-license.js';
import { createSettingsOperations } from './settings-operations.js';
import { createBilibiliRoomProfile } from './settings-room-profile.js';
import { eventBus, Events } from '../shared/event-bus.js';

const documentRef = document;
const windowRef = window;
const locationRef =
  typeof location === 'undefined' ? windowRef.location : location;
const navigatorRef = typeof navigator === 'undefined' ? null : navigator;
const localStorageRef =
  typeof localStorage === 'undefined' ? null : localStorage;
const promptRef =
  typeof prompt === 'undefined' ? () => {} : (...args) => prompt(...args);
const alertRef =
  typeof alert === 'undefined' ? () => {} : (...args) => alert(...args);
const fetchRef = typeof fetch === 'undefined' ? null : fetch;

const getState = () => windowRef.AdminApp?.state;
const getQueue = () => windowRef.AdminApp?.queue;
const getForms = () => windowRef.AdminApp?.forms;
const getGifts = () => windowRef.AdminApp?.gifts;
const getImports = () => windowRef.AdminApp?.imports;
const saveSettings = (updates) => api('/api/settings', updates);

const operations = createSettingsOperations({
  documentRef,
  windowRef,
  locationRef,
  localStorageRef,
  fetchRef: fetchRef || (() => Promise.reject(new Error('fetch unavailable'))),
  alertRef,
  api,
  readJsonResponse,
  toast,
  showStackedToast,
  dangerConfirm,
  showConfirmationDialog,
  getState,
  getQueue,
  getForms,
});
const blindboxSettings = createBlindboxSettings({
  documentRef,
  navigatorRef,
  promptRef,
  locationRef,
  value,
  toast,
  saveSettings,
  getGifts,
  getState,
  getImports,
  localOverlayOrigin,
});
const settingsForm = createSettingsForm({
  documentRef,
  value,
  api,
  toast,
  showConfirmationDialog,
  getState,
  initLicenseAccountDevice: () =>
    initLicenseAccountDeviceImpl({
      documentRef,
      licenseBridge: windowRef.liraLicense,
    }),
  blindboxSettings,
  ...operations,
  desktopRef: windowRef.songAssistantDesktop,
});

export function initBilibiliAuth() {
  const roomProfile = createBilibiliRoomProfile({
    documentRef,
    fetchRef,
    apiToken: windowRef.__API_TOKEN__,
  });
  void roomProfile.refresh(getState()?.getAppState?.()?.settings?.roomId);
  eventBus.on(Events.STATE_LOADED, ({ state }) => {
    void roomProfile.refresh(state.settings?.roomId);
  });
  eventBus.on(Events.STATE_SAVED, ({ settings }) => {
    void roomProfile.refresh(settings.roomId, true);
  });
  documentRef.addEventListener('app:bilibili-auth-changed', () => {
    void roomProfile.refresh(getState()?.getAppState?.()?.settings?.roomId, true);
  });
  return initBilibiliAuthImpl({
    documentRef,
    windowRef,
    toast,
    logoutConfirm,
  });
}

export const initSettingsForm = settingsForm.init;
export const collectSettings = settingsForm.collectSettings;
export const initLicenseAccountDevice = () =>
  initLicenseAccountDeviceImpl({
    documentRef,
    licenseBridge: windowRef.liraLicense,
  });
export const {
  clearDatabase,
  clearSuperChats,
  clearAll,
  renderShutdownScreen,
  shutdownServer,
  reconnectBilibili,
} = operations;
export const updateBlindboxOverlayUrl = blindboxSettings.updateOverlayUrl;

windowRef.AdminApp = windowRef.AdminApp || {};
windowRef.AdminApp.settings = {
  initBilibiliAuth,
  initSettingsForm,
  initLicenseAccountDevice,
  collectSettings,
  clearDatabase,
  clearSuperChats,
  clearAll,
  shutdownServer,
  reconnectBilibili,
  renderShutdownScreen,
  updateBlindboxOverlayUrl,
};
