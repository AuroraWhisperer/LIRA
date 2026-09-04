'use strict';

function createDesktopRuntime(serverModule, options = {}) {
  if (isServerRuntime(serverModule)) return serverModule;
  if (serverModule && typeof serverModule.createServerRuntime === 'function') {
    return serverModule.createServerRuntime(options);
  }

  if (
    !serverModule ||
    typeof serverModule.startServer !== 'function' ||
    typeof serverModule.shutdownApplication !== 'function'
  ) {
    throw new Error('Server runtime is not available.');
  }

  return {
    start: (startOptions) => serverModule.startServer(startOptions),
    stop: (stopOptions) => serverModule.shutdownApplication(stopOptions),
    setPreShutdownHook:
      typeof serverModule.setPreShutdownHook === 'function'
        ? (hook) => serverModule.setPreShutdownHook(hook)
        : () => {},
    persistPlaybackSnapshot:
      typeof serverModule.persistPlaybackSnapshot === 'function'
        ? (payload, clientId) =>
            serverModule.persistPlaybackSnapshot(payload, clientId)
        : null,
    resumeAuthorizedWork:
      typeof serverModule.resumeAuthorizedWork === 'function'
        ? () => serverModule.resumeAuthorizedWork()
        : null,
    pauseAuthorizedWork:
      typeof serverModule.pauseAuthorizedWork === 'function'
        ? () => serverModule.pauseAuthorizedWork()
        : null,
    resolveGiftSource:
      typeof serverModule.resolveGiftSource === 'function'
        ? (sourceKey) => serverModule.resolveGiftSource(sourceKey)
        : null,
    getGiftSyncState:
      typeof serverModule.getGiftSyncState === 'function'
        ? (sourceId) => serverModule.getGiftSyncState(sourceId)
        : null,
    commitGiftHistoryPage:
      typeof serverModule.commitGiftHistoryPage === 'function'
        ? (page) => serverModule.commitGiftHistoryPage(page)
        : null,
    restartGiftHistoryBootstrap:
      typeof serverModule.restartGiftHistoryBootstrap === 'function'
        ? (sourceId, projectionGeneration) =>
            serverModule.restartGiftHistoryBootstrap(
              sourceId,
              projectionGeneration,
            )
        : null,
    commitGiftCatchUpPage:
      typeof serverModule.commitGiftCatchUpPage === 'function'
        ? (page) => serverModule.commitGiftCatchUpPage(page)
        : null,
    commitLegacyGiftPage:
      typeof serverModule.commitLegacyGiftPage === 'function'
        ? (page) => serverModule.commitLegacyGiftPage(page)
        : null,
    resetGiftProjectionForRebuild:
      typeof serverModule.resetGiftProjectionForRebuild === 'function'
        ? (sourceId) => serverModule.resetGiftProjectionForRebuild(sourceId)
        : null,
    setActiveGiftSource:
      typeof serverModule.setActiveGiftSource === 'function'
        ? (source) => serverModule.setActiveGiftSource(source)
        : null,
    importProcessedGiftEvent:
      typeof serverModule.importProcessedGiftEvent === 'function'
        ? (event, sourceId) =>
            serverModule.importProcessedGiftEvent(event, sourceId)
        : null,
    getSetting:
      typeof serverModule.getSetting === 'function'
        ? (key) => serverModule.getSetting(key)
        : () => undefined,
    getCloudSettingsSnapshot:
      typeof serverModule.getCloudSettingsSnapshot === 'function'
        ? () => serverModule.getCloudSettingsSnapshot()
        : null,
    applyCloudSettingsSnapshot:
      typeof serverModule.applyCloudSettingsSnapshot === 'function'
        ? (settings) => serverModule.applyCloudSettingsSnapshot(settings)
        : null,
    getCloudSongsSnapshot:
      typeof serverModule.getCloudSongsSnapshot === 'function'
        ? () => serverModule.getCloudSongsSnapshot()
        : null,
    replaceCloudSongsSnapshot:
      typeof serverModule.replaceCloudSongsSnapshot === 'function'
        ? (songs) => serverModule.replaceCloudSongsSnapshot(songs)
        : null,
    onCloudSyncRequested:
      typeof serverModule.onCloudSyncRequested === 'function'
        ? (listener) => serverModule.onCloudSyncRequested(listener)
        : () => () => {},
  };
}

function isServerRuntime(value) {
  return Boolean(
    value &&
    typeof value.start === 'function' &&
    typeof value.stop === 'function' &&
    typeof value.setPreShutdownHook === 'function',
  );
}

module.exports = {
  createDesktopRuntime,
  isServerRuntime,
};
