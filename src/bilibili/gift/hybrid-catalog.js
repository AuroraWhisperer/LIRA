'use strict';

const { createPublicError } = require('../../shared/public-error');

const { createRemoteGiftCatalogCache } = require('./remote-catalog-cache');
const { mergeVariantRoomCatalog } = require('./variant-room-catalog');
const { createRemoteGiftImageCache } = require('./remote-gift-image-cache');
const { createGiftCatalogInitializer } = require('./gift-catalog-initializer');
const { createGiftImageResources } = require('./gift-image-resources');
const { createHash } = require('node:crypto');

const MAX_REMOTE_SEARCH_RESULTS = 100;

function createHybridGiftSaleCatalogService(options = {}) {
  const local = options.local;
  if (!local || typeof local.getSnapshot !== 'function' || typeof local.refresh !== 'function') {
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
          visitAssetReferences: options.visitAssetReferences,
        })
      : null);
  const logger = options.logger || console;
  let giftCatalogInitializer = options.giftCatalogInitializer || null;
  let stopped = false;
  let disposed = false;
  let lastUpdateSignature = '';
  let assetsUpdatedAt = '';
  let roomCache = null;
  let globalCache = null;
  let artworkCatalog = null;
  let artworkCache = null;
  let globalContent = null;
  const getCustomBlindBoxes =
    typeof options.getBlindBoxCustomConfigV2 === 'function' ? options.getBlindBoxCustomConfigV2 : () => [];
  const remoteCatalog =
    options.remoteCatalog ||
    createRemoteGiftCatalogCache({
      dataDir: options.dataDir,
      cachePath: options.cachePath,
      fetchRemote: options.fetchRemote,
      onUpdated: (snapshot) => {
        roomCache = null;
        globalCache = null;
        artworkCatalog = null;
        if (!giftCatalogInitializer) {
          options.onUpdated?.(snapshot);
          return;
        }
        queueMicrotask(() => {
          if (stopped) return;
          giftCatalogInitializer
            ?.initialize({ refresh: false, reason: 'catalog-update' })
            .catch((error) => logger.warn?.('[GiftCatalog] background asset refresh failed:', error?.message || error));
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
  const imageResources = remoteImageCache?.getSourceImagePath ? createGiftImageResources({
    imageCache: remoteImageCache,
    getCatalog: () => remoteCatalog.getSnapshot(),
    getRevision: remoteCatalog.getRevision ? () => remoteCatalog.getRevision() : undefined,
    now: options.now,
  }) : null;
  let roomSnapshot = local.getSnapshot();
  let roomRefreshPending = null;
  let unsubscribe = giftCatalogInitializer?.onStateChanged?.((state) => {
    if (stopped || state.status !== 'ready') return;
    if (state.total > 0 && !state.error) assetsUpdatedAt = state.completedAt || assetsUpdatedAt;
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

  function readRoomSnapshot() {
    const custom = getCustomBlindBoxes();
    const key = [local.getRevision?.(), remoteCatalog.getRevision?.(), remoteImageCache?.getRevision?.(), JSON.stringify(custom)];
    const cacheable = local.getRevision && remoteCatalog.getRevision && (!remoteImageCache || remoteImageCache.getRevision);
    if (!cacheable || !roomCache || !key.every((value, index) => value === roomCache.key[index])) {
      roomSnapshot = local.getSnapshot();
      const snapshot = decorateWithCachedImages(mergeRoomCatalog(roomSnapshot, remoteCatalog.getSnapshot(), custom), remoteImageCache);
      roomCache = { key, snapshot: cloneRoomSnapshot(snapshot, true) };
    }
    return roomCache.snapshot;
  }

  function getSnapshot() { return structuredClone(readRoomSnapshot()); }

  async function refresh(options = {}) {
    const roomId = local.getRoomId?.();
    if (roomRefreshPending && roomRefreshPending.roomId === roomId) return roomRefreshPending.promise;
    const request = { roomId };
    const assertCurrent = () => {
      if (roomRefreshPending !== request || local.getRoomId?.() !== roomId) {
        throw createPublicError('直播间已切换，请重新刷新在售礼物。');
      }
    };
    request.promise = (async () => {
      const localSnapshot = await local.refresh(options);
      assertCurrent();
      let serverSnapshot;
      try {
        serverSnapshot = await remoteCatalog.refresh({ reason: 'room' });
      } catch (error) {
        serverSnapshot = remoteCatalog.getSnapshot();
        logger.warn?.('[GiftCatalog] room artwork refresh failed:', error?.message || error);
      }
      assertCurrent();
      const snapshot = await decorateRoomSnapshot(localSnapshot, serverSnapshot, remoteImageCache, getCustomBlindBoxes());
      assertCurrent();
      roomSnapshot = localSnapshot;
      roomCache = null;
      globalCache = null;
      artworkCatalog = null;
      return cloneRoomSnapshot(snapshot, localSnapshot.cached === true);
    })().finally(() => {
      if (roomRefreshPending === request) roomRefreshPending = null;
    });
    roomRefreshPending = request;
    return request.promise;
  }

  async function refreshRemote(options = {}) {
    const serverSnapshot = await remoteCatalog.refresh(options);
    await decorateRoomSnapshot(
      local.getSnapshot(),
      serverSnapshot,
      remoteImageCache,
      getCustomBlindBoxes(),
    );
    roomCache = null;
    globalCache = null;
    artworkCatalog = null;
    return serverSnapshot;
  }

  function readGlobalSnapshot() {
    const key = [remoteCatalog.getRevision?.(), remoteImageCache?.getRevision?.(), assetsUpdatedAt];
    const cacheable = remoteCatalog.getRevision && (!remoteImageCache || remoteImageCache.getRevision);
    if (cacheable && globalCache && key.every((value, index) => value === globalCache.key[index])) {
      return globalCache.snapshot;
    }
    const snapshot = remoteCatalog.getSnapshot();
    if (!snapshot) return null;
    const gifts = (Array.isArray(snapshot.gifts) ? snapshot.gifts : []).map((gift) => ({
      ...gift,
      imagePath: remoteImageCache ? remoteImageCache.getCachedGiftImagePath(gift) : '',
    }));
    const result = { ...snapshot, assetsUpdatedAt, count: gifts.length, gifts };
    if (cacheable) globalCache = { key, snapshot: result };
    return result;
  }

  function getGlobalSnapshot({ conditional = false, contentRevision } = {}) {
    const snapshot = readGlobalSnapshot();
    if (!conditional || !snapshot) return structuredClone(snapshot);
    if (globalContent?.snapshot !== snapshot) {
      globalContent = { snapshot, revision: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
    }
    if (contentRevision === globalContent.revision) return { contentRevision, unchanged: true };
    return { ...structuredClone(snapshot), contentRevision: globalContent.revision, unchanged: false };
  }

  function getArtworkResolver() {
    const custom = getCustomBlindBoxes();
    const key = [local.getRevision?.(), remoteCatalog.getRevision?.(), JSON.stringify(custom)];
    if (!local.getRevision || !remoteCatalog.getRevision || !artworkCatalog ||
      !key.every((value, index) => value === artworkCatalog.key[index])) {
      const global = remoteCatalog.getSnapshot();
      roomSnapshot = local.getSnapshot();
      const room = mergeRoomCatalog(roomSnapshot, global, custom);
      const gifts = new Map();
      for (const gift of Array.isArray(global?.gifts) ? global.gifts : []) {
        gifts.set(gift.variantId || String(gift.id), { gift, imagePath: '' });
      }
      for (const gift of room.gifts) {
        gifts.set(gift.variantId || String(gift.id), { gift, imagePath: gift.imagePath });
      }
      const byGiftId = new Map();
      for (const entry of gifts.values()) {
        const id = String(entry.gift.id);
        byGiftId.set(id, byGiftId.has(id) ? null : entry);
      }
      artworkCatalog = { key, gifts, byGiftId };
    }
    // Image integrity expires independently of the unchanged gift identity index.
    const imageRevision = remoteImageCache?.getRevision?.();
    if (artworkCache?.catalog !== artworkCatalog || artworkCache.imageRevision !== imageRevision ||
      (remoteImageCache && !remoteImageCache.getRevision)) {
      const { gifts, byGiftId } = artworkCatalog;
      const paths = new Map();
      artworkCache = { catalog: artworkCatalog, imageRevision, resolve(key) {
        if (!paths.has(key)) {
          const entry = gifts.get(key) || byGiftId.get(key);
          if (!entry) return undefined;
          paths.set(key, remoteImageCache ? remoteImageCache.getCachedGiftImagePath(entry.gift) : entry.imagePath);
        }
        return paths.get(key);
      } };
    }
    return artworkCache.resolve;
  }

  function searchLocal(value) {
    const query = validateRemoteGiftQuery(value);
    const snapshot = remoteCatalog.getSnapshot();
    if (!snapshot) throw createPublicError('服务器礼物目录本地缓存尚不可用。');
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

  function resolveGiftImagePath(giftId, _imagePath, rule) {
    const id = String(giftId || '').trim();
    const gift =
      typeof remoteCatalog.getGift === 'function'
        ? remoteCatalog.getGift(id, rule?.giftIdentity?.variantId)
        : remoteCatalog
            .getSnapshot()
            ?.gifts?.find(
              (item) =>
                String(item.id) === id &&
                (!rule?.giftIdentity?.variantId || item.variantId === rule.giftIdentity.variantId),
            );
    const candidate = gift || roomSnapshot.gifts.find((item) => String(item.id) === id);
    if (!candidate) return '';
    if (candidate.variantId && candidate.variantId !== rule?.giftIdentity?.variantId) return '';
    return remoteImageCache ? remoteImageCache.getCachedGiftImagePath(candidate) : candidate.imagePath || '';
  }

  function initializeGlobalCatalog(request = {}) {
    if (!giftCatalogInitializer) return Promise.reject(new Error('全局礼物目录初始化服务未配置。'));
    return giftCatalogInitializer.initialize(request);
  }

  return {
    getSnapshot,
    getGlobalSnapshot,
    getArtworkResolver,
    imageResources,
    getInitializationState: () =>
      giftCatalogInitializer?.getState?.() || {
        status: 'ready',
        phase: 'complete',
        percent: 100,
      },
    initializeGlobalCatalog,
    isGlobalCatalogInitialized: () => giftCatalogInitializer?.isInitialized?.() !== false,
    onInitializationStateChanged: (listener) => giftCatalogInitializer?.onStateChanged?.(listener) || (() => {}),
    refresh,
    refreshRemote,
    searchRemote,
    searchLocal,
    resolveGiftImagePath,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopped = true;
      imageResources?.dispose();
      const drainImages = !options.remoteImageCache ? remoteImageCache?.dispose?.() : undefined;
      try {
        unsubscribe?.();
      } finally {
        unsubscribe = null;
        // Shared caches and the local catalog retain their existing owners.
        if (!options.remoteCatalog) remoteCatalog.stop?.();
      }
      return drainImages;
    },
    start() {
      if (disposed) return;
      stopped = false;
      remoteCatalog.start?.(
        giftCatalogInitializer ? (request) => initializeGlobalCatalog({ ...request, force: true }) : undefined,
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
  if (serverSnapshot?.schemaVersion === 3) {
    return mergeVariantRoomCatalog(roomSnapshot, serverSnapshot, customBlindBoxes);
  }
  if (serverSnapshot?.gifts?.length && serverSnapshot.gifts.every((gift) => gift.variantId)) {
    const variantIdByGiftId = new Map(serverSnapshot.gifts.map((gift) => [gift.id, gift.variantId]));
    return mergeVariantRoomCatalog(
      roomSnapshot,
      {
        ...serverSnapshot,
        variantBlindBoxes: (serverSnapshot.blindBoxes || []).map((box) => ({
          variantId: variantIdByGiftId.get(box.giftId),
          outputVariantIds: box.outputGiftIds.map((id) => variantIdByGiftId.get(id)),
        })),
      },
      customBlindBoxes,
    );
  }
  const room = roomSnapshot && typeof roomSnapshot === 'object' ? roomSnapshot : {};
  const serverById = new Map(
    (Array.isArray(serverSnapshot?.gifts) ? serverSnapshot.gifts : []).map((gift) => [
      String(gift?.id || '').trim(),
      gift,
    ]),
  );
  const roomGifts = Array.isArray(room.gifts) ? room.gifts : [];
  const panelGiftIds = new Set(roomGifts.map((gift) => String(gift?.id || '').trim()).filter(Boolean));
  const gifts = roomGifts.map((gift) => ({
    ...gift,
    sourceUrl: String(serverById.get(String(gift?.id || '').trim())?.sourceUrl || '') || '',
    imagePath: String(serverById.get(String(gift?.id || '').trim())?.imagePath || '') || '',
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
  for (const relation of Array.isArray(serverSnapshot?.blindBoxes) ? serverSnapshot.blindBoxes : []) {
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

async function decorateRoomSnapshot(roomSnapshot, serverSnapshot, remoteImageCache, customBlindBoxes = []) {
  const merged = mergeRoomCatalog(roomSnapshot, serverSnapshot, customBlindBoxes);
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
      return structuredClone(publicGift);
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
  if (typeof value !== 'string') throw createPublicError('服务器礼物搜索词必须是字符串。');
  const query = value.trim();
  const length = Array.from(query).length;
  if (length < 1 || length > 100) throw createPublicError('请输入 1–100 个字符的礼物名称或 ID。');
  return query;
}

module.exports = { createHybridGiftSaleCatalogService, mergeRoomCatalog };
