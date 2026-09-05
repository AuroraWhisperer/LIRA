'use strict';

const { createRemoteGiftCatalogCache } = require('./remote-catalog-cache');
const {
  createRemoteGiftImageCache,
} = require('./remote-gift-image-cache');
const {
  createGiftCatalogInitializer,
} = require('./gift-catalog-initializer');

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
  const logger = options.logger || console;
  let giftCatalogInitializer = options.giftCatalogInitializer || null;
  let stopped = false;
  let lastUpdateSignature = '';
  let assetsUpdatedAt = '';
  const getCustomBlindBoxes =
    typeof options.getBlindBoxCustomConfigV2 === 'function'
      ? options.getBlindBoxCustomConfigV2
      : () => [];
  const remoteCatalog =
    options.remoteCatalog ||
    createRemoteGiftCatalogCache({
      dataDir: options.dataDir,
      cachePath: options.cachePath,
      fetchRemote: options.fetchRemote,
      onUpdated: (snapshot) => {
        roomSnapshot = decorateWithCachedImages(
          mergeRoomCatalog(local.getSnapshot(), snapshot, getCustomBlindBoxes()),
          remoteImageCache,
        );
        if (!giftCatalogInitializer) {
          options.onUpdated?.(snapshot);
          return;
        }
        queueMicrotask(() => {
          if (stopped) return;
          giftCatalogInitializer
            ?.initialize({ refresh: false, reason: 'catalog-update' })
            .catch((error) =>
              logger.warn?.(
                '[GiftCatalog] background asset refresh failed:',
                error?.message || error,
              ),
            );
        });
      },
      now: options.now,
      logger,
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
  if (!giftCatalogInitializer && options.dataDir && remoteImageCache) {
    giftCatalogInitializer = createGiftCatalogInitializer({
      dataDir: options.dataDir,
      catalog: remoteCatalog,
      imageCache: remoteImageCache,
      logger,
      now: options.now,
    });
  }
  let roomSnapshot = decorateWithCachedImages(
    mergeRoomCatalog(
      local.getSnapshot(),
      remoteCatalog.getSnapshot(),
      getCustomBlindBoxes(),
    ),
    remoteImageCache,
  );
  let roomRefreshPending = null;
  giftCatalogInitializer?.onStateChanged?.((state) => {
    if (stopped || state.status !== 'ready') return;
    if (state.total > 0 && !state.error)
      assetsUpdatedAt = state.completedAt || assetsUpdatedAt;
    const snapshot = getGlobalSnapshot();
    if (!snapshot) return;
    const signature = JSON.stringify({
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      stale: snapshot.stale,
      sources: snapshot.sources,
      assetsUpdatedAt: snapshot.assetsUpdatedAt,
      gifts: snapshot.gifts,
      blindBoxes: snapshot.blindBoxes,
    });
    if (signature === lastUpdateSignature) return;
    lastUpdateSignature = signature;
    options.onUpdated?.(snapshot);
  });

  function getSnapshot() {
    return cloneRoomSnapshot(
      decorateWithCachedImages(
        mergeRoomCatalog(
          roomSnapshot,
          remoteCatalog.getSnapshot(),
          getCustomBlindBoxes(),
        ),
        remoteImageCache,
      ),
      true,
    );
  }

  async function refresh(options = {}) {
    if (roomRefreshPending) return roomRefreshPending;
    roomRefreshPending = (async () => {
      const localSnapshot = await local.refresh(options);
      let serverSnapshot;
      try {
        serverSnapshot = await remoteCatalog.refresh({ reason: 'room' });
      } catch (error) {
        serverSnapshot = remoteCatalog.getSnapshot();
        logger.warn?.(
          '[GiftCatalog] room artwork refresh failed:',
          error?.message || error,
        );
      }
      roomSnapshot = await decorateRoomSnapshot(
        localSnapshot,
        serverSnapshot,
        remoteImageCache,
        getCustomBlindBoxes(),
      );
      return cloneRoomSnapshot(roomSnapshot, localSnapshot.cached === true);
    })().finally(() => {
      roomRefreshPending = null;
    });
    return roomRefreshPending;
  }

  async function refreshRemote(options = {}) {
    const serverSnapshot = await remoteCatalog.refresh(options);
    roomSnapshot = await decorateRoomSnapshot(
      local.getSnapshot(),
      serverSnapshot,
      remoteImageCache,
      getCustomBlindBoxes(),
    );
    return serverSnapshot;
  }

  function getGlobalSnapshot() {
    const snapshot = remoteCatalog.getSnapshot();
    if (!snapshot) return null;
    const gifts = (Array.isArray(snapshot.gifts) ? snapshot.gifts : []).map(
      (gift) => ({
        ...gift,
        imagePath: remoteImageCache
          ? remoteImageCache.getCachedGiftImagePath(gift)
          : '',
      }),
    );
    return { ...snapshot, assetsUpdatedAt, count: gifts.length, gifts };
  }

  function searchLocal(value) {
    const query = validateRemoteGiftQuery(value);
    const snapshot = remoteCatalog.getSnapshot();
    if (!snapshot) throw new Error('服务器礼物目录本地缓存尚不可用。');
    const matches = searchSnapshot(snapshot, query);
    const gifts = remoteImageCache
      ? matches.map((gift) => ({
          ...gift,
          imagePath: remoteImageCache.getCachedGiftImagePath(gift),
        }))
      : matches.map((gift) => ({ ...gift }));
    return { query, count: gifts.length, gifts };
  }

  async function searchRemote(value) {
    return searchLocal(value);
  }

  function resolveGiftImagePath(giftId) {
    const id = String(giftId || '').trim();
    const gift = typeof remoteCatalog.getGift === 'function'
      ? remoteCatalog.getGift(id)
      : remoteCatalog.getSnapshot()?.gifts?.find((item) => String(item.id) === id);
    const candidate = gift || roomSnapshot.gifts.find((item) => String(item.id) === id);
    if (!candidate) return '';
    return remoteImageCache
      ? remoteImageCache.getCachedGiftImagePath(candidate)
      : candidate.imagePath || '';
  }

  function initializeGlobalCatalog(request = {}) {
    if (!giftCatalogInitializer)
      return Promise.reject(new Error('全局礼物目录初始化服务未配置。'));
    return giftCatalogInitializer.initialize(request);
  }

  return {
    getSnapshot,
    getGlobalSnapshot,
    getInitializationState: () =>
      giftCatalogInitializer?.getState?.() || {
        status: 'ready',
        phase: 'complete',
        percent: 100,
      },
    initializeGlobalCatalog,
    isGlobalCatalogInitialized: () =>
      giftCatalogInitializer?.isInitialized?.() !== false,
    onInitializationStateChanged: (listener) =>
      giftCatalogInitializer?.onStateChanged?.(listener) || (() => {}),
    refresh,
    refreshRemote,
    searchRemote,
    searchLocal,
    resolveGiftImagePath,
    start() {
      stopped = false;
      remoteCatalog.start?.(
        giftCatalogInitializer
          ? (request) => initializeGlobalCatalog({ ...request, force: true })
          : undefined,
      );
    },
    stop() {
      stopped = true;
      remoteCatalog.stop?.();
      local.stop?.();
    },
  };
}

function mergeRoomCatalog(roomSnapshot, serverSnapshot, customBlindBoxes = []) {
  const room = roomSnapshot && typeof roomSnapshot === 'object' ? roomSnapshot : {};
  const serverById = new Map(
    (Array.isArray(serverSnapshot?.gifts) ? serverSnapshot.gifts : []).map(
      (gift) => [String(gift?.id || '').trim(), gift],
    ),
  );
  const roomGifts = Array.isArray(room.gifts) ? room.gifts : [];
  const panelGiftIds = new Set(
    roomGifts.map((gift) => String(gift?.id || '').trim()).filter(Boolean),
  );
  const gifts = roomGifts.map((gift) => ({
    ...gift,
    sourceUrl:
      String(serverById.get(String(gift?.id || '').trim())?.sourceUrl || '') ||
      '',
    imagePath:
      String(serverById.get(String(gift?.id || '').trim())?.imagePath || '') ||
      '',
  }));
  const addGiftById = (giftId, fallback = null) => {
    const id = String(giftId || '').trim();
    if (!id || panelGiftIds.has(id)) return;
    const serverGift = serverById.get(id);
    if (serverGift?.active === false) return;
    const source = serverGift || fallback;
    if (!source) return;
    panelGiftIds.add(id);
    gifts.push({
      id,
      name: String(source.name || `礼物 ${id}`),
      battery: Number(source.battery) || 0,
      rmb: Number(source.rmb ?? source.price) || 0,
      sourceUrl: String(serverGift?.sourceUrl || ''),
      imagePath: String(serverGift?.imagePath || ''),
    });
  };
  for (const relation of Array.isArray(serverSnapshot?.blindBoxes)
    ? serverSnapshot.blindBoxes
    : []) {
    if (!panelGiftIds.has(String(relation?.giftId || '').trim())) continue;
    for (const outputGiftId of relation.outputGiftIds || []) {
      addGiftById(outputGiftId);
    }
  }
  for (const box of Array.isArray(customBlindBoxes) ? customBlindBoxes : []) {
    if (!box?.giftId || !panelGiftIds.has(String(box.giftId).trim())) continue;
    for (const output of Array.isArray(box.outputs) ? box.outputs : []) {
      addGiftById(output?.giftId, output);
    }
  }
  return { ...room, count: gifts.length, gifts };
}

async function decorateRoomSnapshot(
  roomSnapshot,
  serverSnapshot,
  remoteImageCache,
  customBlindBoxes = [],
) {
  const merged = mergeRoomCatalog(
    roomSnapshot,
    serverSnapshot,
    customBlindBoxes,
  );
  const gifts = remoteImageCache
    ? await remoteImageCache.cacheGifts(merged.gifts)
    : merged.gifts.map((gift) => ({ ...gift }));
  return { ...merged, count: gifts.length, gifts };
}

function decorateWithCachedImages(snapshot, remoteImageCache) {
  if (!remoteImageCache) return snapshot;
  const gifts = snapshot.gifts.map((gift) => ({
    ...gift,
    imagePath: remoteImageCache.getCachedGiftImagePath(gift),
  }));
  return { ...snapshot, count: gifts.length, gifts };
}

function cloneRoomSnapshot(snapshot, cached) {
  return {
    ...snapshot,
    gifts: (Array.isArray(snapshot?.gifts) ? snapshot.gifts : []).map((gift) => {
      const { sourceUrl: _sourceUrl, ...publicGift } = gift;
      return publicGift;
    }),
    cached,
  };
}

function searchSnapshot(snapshot, query) {
  const normalizedQuery = query.toLocaleLowerCase();
  return (Array.isArray(snapshot?.gifts) ? snapshot.gifts : [])
    .filter((gift) => {
      const id = String(gift?.id || '').toLocaleLowerCase();
      const name = String(gift?.name || '').toLocaleLowerCase();
      return id.includes(normalizedQuery) || name.includes(normalizedQuery);
    })
    .slice(0, MAX_REMOTE_SEARCH_RESULTS);
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

module.exports = { createHybridGiftSaleCatalogService, mergeRoomCatalog };
