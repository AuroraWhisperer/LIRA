'use strict';

const fs = require('node:fs');
const { isDirectory } = require('./wesing-cache');

const QRC_REFRESH_DEBOUNCE_MS = 2000;

function createWeSingQrcWatcher(options) {
  const watchFactory =
    options.watchFactory ||
    ((directoryPath, watchOptions, listener) =>
      fs.watch(directoryPath, watchOptions, listener));
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  let watcher = null;
  let watchedCachePath = '';
  let refreshTimer = null;

  async function sync() {
    const cachePath = options.getCachePath();
    if (!options.isActive() || !cachePath || !(await isDirectory(cachePath))) {
      stop();
      return;
    }
    if (watcher && watchedCachePath === cachePath) return;

    stop();
    try {
      watcher = watchFactory(cachePath, { recursive: true }, handleWatchEvent);
      watcher.unref?.();
      watchedCachePath = cachePath;
    } catch (_) {
      watcher = null;
      watchedCachePath = '';
    }
  }

  function handleWatchEvent(_eventType, filename) {
    if (!options.isActive() || !/\.qrc$/i.test(String(filename || ''))) return;
    if (refreshTimer !== null) clearTimer(refreshTimer);
    refreshTimer = setTimer(() => {
      refreshTimer = null;
      if (options.isActive()) options.onRefresh();
    }, QRC_REFRESH_DEBOUNCE_MS);
    refreshTimer?.unref?.();
  }

  function stop() {
    if (refreshTimer !== null) {
      clearTimer(refreshTimer);
      refreshTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch (_) {
        watcher = null;
      }
    }
    watcher = null;
    watchedCachePath = '';
  }

  return { sync, stop };
}

module.exports = { createWeSingQrcWatcher, QRC_REFRESH_DEBOUNCE_MS };
