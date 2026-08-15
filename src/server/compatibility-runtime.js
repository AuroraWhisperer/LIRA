'use strict';

function createServerCompatibility(createServerRuntime) {
  let compatibilityRuntime = null;

  function getCompatibilityRuntime(options = {}) {
    if (!compatibilityRuntime) {
      compatibilityRuntime = createServerRuntime({ dataDir: options.dataDir });
    }
    return compatibilityRuntime;
  }

  function startServer(options = {}) {
    return getCompatibilityRuntime(options).start(options);
  }

  function shutdownApplication(options = {}) {
    const stopOptions = options.exitProcess === undefined
      ? { ...options, exitProcess: true }
      : options;
    return getCompatibilityRuntime().stop(stopOptions);
  }

  function setPreShutdownHook(fn) {
    getCompatibilityRuntime().setPreShutdownHook(fn);
  }

  function persistPlaybackSnapshot(payload, clientId) {
    return getCompatibilityRuntime().persistPlaybackSnapshot(payload, clientId);
  }

  function getApiToken() {
    return getCompatibilityRuntime().getApiToken();
  }

  return {
    getApiToken,
    persistPlaybackSnapshot,
    setPreShutdownHook,
    shutdownApplication,
    startServer
  };
}

module.exports = { createServerCompatibility };

