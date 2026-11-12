'use strict';

function createDesktopRuntime(serverModule, options = {}) {
  if (isServerRuntime(serverModule)) return serverModule;
  if (serverModule && typeof serverModule.createServerRuntime === 'function') {
    return serverModule.createServerRuntime(options);
  }

  throw new Error('Server runtime is not available.');
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
