'use strict';

const { createRemoteGiftCatalogCache } = require('./remote-catalog-cache');

function createHybridGiftSaleCatalogService(options = {}) {
  const local = options.local;
  if (
    !local ||
    typeof local.getSnapshot !== 'function' ||
    typeof local.refresh !== 'function'
  ) {
    throw new Error('A local gift catalog service is required.');
  }

  const remoteCatalog =
    options.remoteCatalog ||
    createRemoteGiftCatalogCache({
      dataDir: options.dataDir,
      cachePath: options.cachePath,
      fetchRemote: options.fetchRemote,
      onUpdated: options.onUpdated,
      now: options.now,
      logger: options.logger,
      minRefreshMs: options.minRefreshMs,
      pollIntervalMs: options.pollIntervalMs,
      imageBaseUrl: options.imageBaseUrl,
    });
  if (
    !remoteCatalog ||
    typeof remoteCatalog.getSnapshot !== 'function' ||
    typeof remoteCatalog.refresh !== 'function'
  ) {
    throw new Error('A remote gift catalog service is required.');
  }

  function getSnapshot() {
    return remoteCatalog.getSnapshot() || local.getSnapshot();
  }

  async function refresh(options = {}) {
    try {
      const snapshot = await remoteCatalog.refresh(options);
      if (snapshot) return snapshot;
    } catch (error) {
      // A usable remote cache should remain authoritative on an explicit
      // refresh failure; callers can show the error while GET still serves it.
      if (remoteCatalog.getSnapshot()) throw error;
      try {
        return await local.refresh(options);
      } catch (_) {
        throw error;
      }
    }
    return local.refresh(options);
  }

  async function refreshRemote(options = {}) {
    return remoteCatalog.refresh(options);
  }

  return {
    getSnapshot,
    refresh,
    refreshRemote,
    searchLocal:
      typeof local.searchLocal === 'function'
        ? local.searchLocal.bind(local)
        : () => {
            throw new Error('本地礼物搜索服务未配置。');
          },
    start:
      typeof remoteCatalog.start === 'function'
        ? () => remoteCatalog.start()
        : () => {},
    stop() {
      remoteCatalog.stop?.();
      local.stop?.();
    },
  };
}

module.exports = { createHybridGiftSaleCatalogService };
