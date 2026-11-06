'use strict';

const { normalizeCloudSettingsSnapshot, serializeCloudSettings } = require('./settings-contract');
const { buildDesktopMenuCommands } = require('./danmaku-menu');
const { isAiReady } = require('../ai/config');

function createCloudSyncRuntime({
  getSettingsStore,
  getBilibiliRuntime,
  getAiConfig,
  getGameSession,
  getInteractionSession,
  getSongs,
  getCustomReplies,
  isActive,
  broadcastSnapshot,
}) {
  let blindBoxMappingState = null;
  let menuCommandsSignature = '';
  let menuRefreshQueued = false;
  const cloudSyncListeners = new Set();

  function getCloudSettingsSnapshot() {
    const settingsStore = getSettingsStore();
    if (!settingsStore) throw new Error('Settings store not ready.');
    return { ...serializeCloudSettings(settingsStore.getSettings()), menuCommands: getDesktopMenuCommands() };
  }

  function getPendingCloudSettings(accountKey) {
    const pending = getSettingsStore().getPendingCloudSettings(accountKey);
    return pending ? {
      ...pending,
      values: { ...serializeCloudSettings(pending.values), menuCommands: getDesktopMenuCommands() },
    } : null;
  }

  function getDesktopMenuCommands() {
    const aiConfig = getAiConfig() || {};
    return buildDesktopMenuCommands({
      settings: getSettingsStore().getSettings(),
      ai: { ready: isAiReady(aiConfig), trigger: aiConfig.trigger },
      game: getGameSession(),
      interaction: getInteractionSession(),
    });
  }

  function initializeMenuSync() {
    menuCommandsSignature = JSON.stringify(getDesktopMenuCommands());
  }

  function scheduleMenuSync() {
    if (menuRefreshQueued || !isActive()) return;
    menuRefreshQueued = true;
    queueMicrotask(() => {
      menuRefreshQueued = false;
      if (!isActive()) return;
      const signature = JSON.stringify(getDesktopMenuCommands());
      if (signature !== menuCommandsSignature) requestCloudSync('settings');
    });
  }

  function prepareCloudRoomAccount(accountKey) {
    const settingsStore = getSettingsStore();
    const bilibiliRuntime = getBilibiliRuntime();
    if (!settingsStore || !bilibiliRuntime) {
      throw new Error('Application runtime not ready.');
    }
    const changed = settingsStore.prepareCloudRoomAccount(accountKey);
    if (changed) {
      bilibiliRuntime.configure();
      broadcastSnapshot('cloud:settings');
    }
    return changed;
  }

  function applyCloudSettingsSnapshot(input) {
    const settingsStore = getSettingsStore();
    const bilibiliRuntime = getBilibiliRuntime();
    if (!settingsStore || !bilibiliRuntime) {
      throw new Error('Application runtime not ready.');
    }
    settingsStore.setSettings(normalizeCloudSettingsSnapshot(input), { syncPending: false });
    bilibiliRuntime.configure();
    broadcastSnapshot('cloud:settings');
    return getCloudSettingsSnapshot();
  }

  function setBlindBoxMappingState(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      blindBoxMappingState = null;
      return;
    }
    blindBoxMappingState = Object.freeze({
      mode: input.mode === 'legacy' ? 'legacy' : 'v2',
      catalogVersion: String(input.catalogVersion || '') || null,
      settingsRevision: Math.max(0, Number(input.settingsRevision) || 0),
      customCount: Math.max(0, Number(input.customCount) || 0),
      takenOverCount: Math.max(0, Number(input.takenOverCount) || 0),
      migrationPendingCount: Math.max(0, Number(input.migrationPendingCount) || 0),
      applied: input.applied === true,
    });
  }

  function getCloudSongsSnapshot() {
    const songs = getSongs();
    if (!songs) throw new Error('Song library not ready.');
    return songs.list({});
  }

  function replaceCloudSongsSnapshot(input) {
    const songs = getSongs();
    if (!songs) throw new Error('Song library not ready.');
    const result = songs.replaceCloud(input);
    broadcastSnapshot('cloud:songs');
    return result;
  }

  function requestCloudSync(scope) {
    if (scope === 'settings' && getSettingsStore()) menuCommandsSignature = JSON.stringify(getDesktopMenuCommands());
    for (const listener of cloudSyncListeners) {
      try {
        listener(scope);
      } catch (error) {
        void error;
      }
    }
  }

  function onCloudSyncRequested(listener) {
    if (typeof listener !== 'function') return () => {};
    cloudSyncListeners.add(listener);
    return () => cloudSyncListeners.delete(listener);
  }

  return {
    initializeMenuSync,
    scheduleMenuSync,
    requestCloudSync,
    getCloudSettingsSnapshot,
    getPendingCloudSettings,
    acknowledgePendingCloudSettings: (key, mutationId) => getSettingsStore().acknowledgePendingCloudSettings(key, mutationId),
    prepareCloudRoomAccount,
    applyCloudSettingsSnapshot,
    applyCloudFixedReplySettingsSnapshot(input, revision) {
      getCustomReplies()?.setCloudExactReplySettings(input, revision);
    },
    getBlindBoxMappingState: () => blindBoxMappingState,
    setBlindBoxMappingState,
    getCloudSongsSnapshot,
    getPendingCloudSongs: (key) => getSongs().getPendingCloudSongs(key),
    acknowledgePendingCloudSongs: (key, mutationId) => getSongs().acknowledgePendingCloudSongs(key, mutationId),
    replaceCloudSongsSnapshot,
    onCloudSyncRequested,
  };
}

module.exports = { createCloudSyncRuntime };
