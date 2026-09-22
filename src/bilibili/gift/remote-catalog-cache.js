'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeRemoteCatalog,
  normalizeRemoteGift,
  catalogError,
  validIso,
  isoTime,
} = require('./remote-catalog-contract');
const {
  normalizeImageBaseUrl,
  normalizeBilibiliImageUrl,
  normalizeImagePath,
} = require('./remote-catalog-image-policy');
const { resolveDataPaths } = require('../../shared/data-paths');

const CACHE_FILE_NAME = 'overtime-gift-catalog-v2.json';
const DEFAULT_POLL_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MIN_REFRESH_MS = 5 * 60 * 1000;

function createRemoteGiftCatalogCache(options = {}) {
  const dataDir = String(options.dataDir || '').trim();
  if (!dataDir) throw new Error('dataDir is required.');
  if (typeof options.fetchRemote !== 'function') {
    throw new Error('fetchRemote is required.');
  }

  const now = typeof options.now === 'function' ? options.now : Date.now;
  const logger = options.logger || console;
  const pollIntervalMs = positiveMs(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  const minRefreshMs = positiveMs(options.minRefreshMs, DEFAULT_MIN_REFRESH_MS);
  const cachePath = path.resolve(options.cachePath || resolveDataPaths(dataDir).giftCatalogPath);
  const configuredImageBaseUrl = () => {
    const value = typeof options.imageBaseUrl === 'function' ? options.imageBaseUrl() : options.imageBaseUrl;
    if (value === undefined || value === null || String(value).trim() === '') return '';
    const normalized = normalizeImageBaseUrl(value);
    if (!normalized) throw catalogError('REMOTE_CATALOG_IMAGE_BASE_INVALID');
    return normalized;
  };
  const initialImageBaseUrl = configuredImageBaseUrl();
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  const bootstrapNowMs = currentTimeMs(now);
  let cache = readPersistedCache(cachePath, logger, initialImageBaseUrl, bootstrapNowMs);
  let giftsById = indexGifts(cache?.snapshot?.gifts || []);
  let pending = null;
  let timer = null;
  let lifecycleGeneration = 0;
  let stopped = false;
  let lastAttemptMs = parseTime(cache?.checkedAt);

  function getSnapshot() {
    if (!cache?.snapshot) return null;
    return cloneSnapshot(cache.snapshot, true);
  }

  function getGift(giftId, variantId) {
    const candidates = (giftsById.get(String(giftId || '').trim()) || []).filter(
      (gift) => !variantId || gift.variantId === variantId,
    );
    const gift = candidates.length === 1 ? candidates[0] : null;
    return gift ? structuredClone(gift) : null;
  }

  function refresh(requestOptions = {}) {
    if (stopped) return Promise.resolve(getSnapshot());
    if (pending) return pending;
    const currentMs = currentTimeMs(now);
    // A clock correction or a tampered persisted cache must not suppress all
    // future refreshes. Treat a future attempt timestamp as unknown.
    if (lastAttemptMs > currentMs) lastAttemptMs = 0;
    const force = requestOptions.force === true;
    if (!force && lastAttemptMs > 0 && currentMs - lastAttemptMs < minRefreshMs) {
      return Promise.resolve(getSnapshot());
    }

    lastAttemptMs = currentMs;
    const requestGeneration = lifecycleGeneration;
    pending = (async () => {
      const response = await options.fetchRemote({
        etag: safeHeaderValue(cache?.etag),
      });

      // stop() invalidates in-flight work. Do not write a late response or
      // notify a WebSocket that the owning runtime has already shut down.
      if (stopped || requestGeneration !== lifecycleGeneration) return getSnapshot();

      // The license manager can be unavailable before the first authorization;
      // leave the local/previous snapshot untouched and try again later.
      if (!response) return getSnapshot();

      if (response.notModified === true) {
        if (!cache?.snapshot) {
          throw catalogError('REMOTE_CATALOG_NOT_MODIFIED_WITHOUT_CACHE');
        }
        const responseEtag = safeHeaderValue(response.etag);
        if (stopped || requestGeneration !== lifecycleGeneration) return getSnapshot();
        const nextCache = {
          ...cache,
          etag: responseEtag || cache.etag || '',
          checkedAt: isoTime(currentTimeMs(now)),
        };
        if (stopped || requestGeneration !== lifecycleGeneration) return getSnapshot();
        if (writePersistedCache(cachePath, nextCache, logger)) cache = nextCache;
        return getSnapshot();
      }

      const configuredBaseUrl = configuredImageBaseUrl();
      // Only the composition root may choose the media origin. A response
      // field is untrusted and must not redirect image requests.
      const imageBaseUrl = configuredBaseUrl || cache?.imageBaseUrl || '';
      const snapshot = normalizeRemoteCatalog(response, {
        now: currentTimeMs(now),
        logger,
        imageBaseUrl: imageBaseUrl || undefined,
      });
      const nextEtag = safeHeaderValue(response.etag);
      const fingerprint = snapshotFingerprint(snapshot);
      const changed = !cache || cache.fingerprint !== fingerprint;
      const nextCache = {
        etag: nextEtag || cache?.etag || '',
        imageBaseUrl,
        fingerprint,
        checkedAt: isoTime(currentTimeMs(now)),
        snapshot: {
          ...snapshot,
          fetchedAt: isoTime(currentTimeMs(now)),
        },
      };
      if (stopped || requestGeneration !== lifecycleGeneration) return getSnapshot();
      if (changed) {
        if (!writePersistedCache(cachePath, nextCache, logger)) {
          throw catalogError('REMOTE_CATALOG_CACHE_WRITE_FAILED');
        }
        cache = nextCache;
        giftsById = indexGifts(snapshot.gifts);
        if (stopped || requestGeneration !== lifecycleGeneration) return getSnapshot();
        const update = cloneSnapshot(cache.snapshot, false);
        try {
          const result = options.onUpdated?.(update);
          if (result && typeof result.catch === 'function') {
            result.catch((error) => logger.warn?.('[GiftCatalog] update notification failed:', error));
          }
        } catch (error) {
          logger.warn?.('[GiftCatalog] update notification failed:', error);
        }
        return update;
      }
      // Persist refreshed source/stale metadata even when the gift rows did
      // not change. This keeps a restarted client from losing the latest
      // server freshness information while avoiding another update event for
      // an identical snapshot.
      if (writePersistedCache(cachePath, nextCache, logger)) cache = nextCache;
      return getSnapshot();
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  function start(onPoll = refresh) {
    stopped = false;
    if (timer || pollIntervalMs <= 0) return;
    timer = setInterval(() => {
      onPoll({ reason: 'schedule' }).catch((error) => {
        logger.warn?.('[GiftCatalog] scheduled refresh failed:', error);
      });
    }, pollIntervalMs);
    timer.unref?.();
  }

  function stop() {
    stopped = true;
    lifecycleGeneration += 1;
    lastAttemptMs = 0;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    cachePath,
    getSnapshot,
    getGift,
    refresh,
    start,
    stop,
  };
}

function readPersistedCache(filePath, logger, imageBaseUrl = '', nowMs = Date.now()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const currentMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    const persistedCheckedMs = parseTime(parsed.checkedAt);
    // Never let a future timestamp from a damaged or manually copied cache
    // block the first conditional request after startup.
    const futureChecked = persistedCheckedMs > currentMs;
    const checkedMs = futureChecked ? 0 : persistedCheckedMs;
    const snapshot = normalizeRemoteCatalog(parsed, {
      now: checkedMs || currentMs,
      imageBaseUrl: imageBaseUrl || undefined,
    });
    const fingerprint = snapshotFingerprint(snapshot);
    return {
      etag: safeHeaderValue(parsed.etag),
      imageBaseUrl: imageBaseUrl || '',
      fingerprint,
      checkedAt: futureChecked ? '' : checkedMs ? isoTime(checkedMs) : '',
      snapshot: {
        ...snapshot,
        fetchedAt: validIso(parsed.fetchedAt) || validIso(snapshot.fetchedAt) || snapshot.updatedAt,
      },
    };
  } catch (error) {
    logger.debug?.('[GiftCatalog] no usable persisted remote cache:', error?.message || error);
    return null;
  }
}

function writePersistedCache(filePath, value, logger) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(
      tempPath,
      `${JSON.stringify(
        {
          etag: value.etag,
          imageBaseUrl: value.imageBaseUrl || '',
          schemaVersion: value.snapshot.schemaVersion,
          version: value.snapshot.version,
          updatedAt: value.snapshot.updatedAt,
          stale: value.snapshot.stale,
          sources: value.snapshot.sources,
          gifts: value.snapshot.gifts,
          blindBoxes: value.snapshot.blindBoxes,
          ...(value.snapshot.rawCatalog || {}),
          fetchedAt: value.snapshot.fetchedAt,
          checkedAt: value.checkedAt,
        },
        null,
        2,
      )}\n`,
    );
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (error) {
    logger.warn?.('[GiftCatalog] cache write failed:', error?.message || error);
    return false;
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch (error) {
        logger.debug?.('[GiftCatalog] temporary cache cleanup failed:', error?.message || error);
      }
    }
  }
}

function cloneSnapshot(snapshot, cached) {
  const { rawCatalog: _rawCatalog, ...publicSnapshot } = snapshot;
  return {
    ...structuredClone(publicSnapshot),
    cached,
    sources: {
      gifts: { ...snapshot.sources.gifts },
      effects: { ...snapshot.sources.effects },
    },
    gifts: structuredClone(snapshot.gifts),
    blindBoxes: snapshot.blindBoxes.map((box) => ({
      ...box,
      outputGiftIds: [...box.outputGiftIds],
    })),
  };
}

function snapshotFingerprint(snapshot) {
  return JSON.stringify({
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
    stale: snapshot.stale,
    sources: snapshot.sources,
    gifts: snapshot.gifts,
    blindBoxes: snapshot.blindBoxes,
  });
}

function indexGifts(gifts) {
  const byId = new Map();
  for (const gift of gifts) {
    if (!byId.has(gift.id)) byId.set(gift.id, []);
    byId.get(gift.id).push(gift);
  }
  return byId;
}

function positiveMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function safeHeaderValue(value) {
  const text = String(value || '')
    .trim()
    .slice(0, 256);
  return /[\r\n]/u.test(text) ? '' : text;
}

function parseTime(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

function currentTimeMs(clock) {
  const value = typeof clock === 'function' ? clock() : Date.now();
  const time = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(time) ? time : Date.now();
}

module.exports = {
  CACHE_FILE_NAME,
  createRemoteGiftCatalogCache,
  normalizeImageBaseUrl,
  normalizeBilibiliImageUrl,
  normalizeImagePath,
  normalizeRemoteCatalog,
  normalizeRemoteGift,
};
