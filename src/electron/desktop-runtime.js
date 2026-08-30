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
