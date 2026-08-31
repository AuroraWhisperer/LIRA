'use strict';

const { createRemoteGiftCatalogCache } = require('./remote-catalog-cache');
const {
  createRemoteGiftImageCache,
} = require('./remote-gift-image-cache');

const MAX_REMOTE_SEARCH_RESULTS = 100;

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

  const remoteImageCache =
    options.remoteImageCache ||
    (options.dataDir
      ? createRemoteGiftImageCache({
          dataDir: options.dataDir,
          imageBaseUrl: options.imageBaseUrl,
          fetch: options.fetchImage,
          logger: options.logger,
          concurrency: options.imageConcurrency,
        })
      : null);

  function getSnapshot() {
    return local.getSnapshot();
  }

  async function refresh(options = {}) {
    return local.refresh(options);
  }

  async function refreshRemote(options = {}) {
    return remoteCatalog.refresh(options);
  }

  async function searchRemote(value) {
    const query = validateRemoteGiftQuery(value);
    let snapshot;
    try {
      snapshot = await remoteCatalog.refresh({
        force: true,
        reason: 'search',
      });
    } catch (error) {
      snapshot = remoteCatalog.getSnapshot();
      if (!snapshot) throw error;
    }
    snapshot = snapshot || remoteCatalog.getSnapshot();
    if (!snapshot) throw new Error('服务器礼物目录尚未同步或当前不可用。');
    const normalizedQuery = query.toLocaleLowerCase();
    const matches = (Array.isArray(snapshot.gifts) ? snapshot.gifts : [])
      .filter((gift) => {
        const id = String(gift?.id || '').toLocaleLowerCase();
        const name = String(gift?.name || '').toLocaleLowerCase();
        return id.includes(normalizedQuery) || name.includes(normalizedQuery);
      })
      .slice(0, MAX_REMOTE_SEARCH_RESULTS);
    const gifts = remoteImageCache
      ? await remoteImageCache.cacheGifts(matches)
      : matches.map((gift) => ({ ...gift }));
    return { query, count: gifts.length, gifts };
  }

  return {
    getSnapshot,
    refresh,
    refreshRemote,
    searchRemote,
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

function validateRemoteGiftQuery(value) {
  if (typeof value !== 'string')
    throw new Error('服务器礼物搜索词必须是字符串。');
  const query = value.trim();
  const length = Array.from(query).length;
  if (length < 1 || length > 100)
    throw new Error('请输入 1–100 个字符的礼物名称或 ID。');
  return query;
}

module.exports = { createHybridGiftSaleCatalogService };
