'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isGuardGiftAliasId } = require('./guard-gift-aliases');

const CACHE_FILE_NAME = 'overtime-gift-catalog.json';
const DEFAULT_POLL_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_MIN_REFRESH_MS = 5 * 60 * 1000;
const MAX_GIFTS = 10000;
const MAX_TEXT_LENGTH = 256;
const EXCLUDED_GIFT_IDS = new Set(['13000']);

function createRemoteGiftCatalogCache(options = {}) {
  const dataDir = String(options.dataDir || '').trim();
  if (!dataDir) throw new Error('dataDir is required.');
  if (typeof options.fetchRemote !== 'function') {
    throw new Error('fetchRemote is required.');
  }

  const now = typeof options.now === 'function' ? options.now : Date.now;
  const logger = options.logger || console;
  const pollIntervalMs = positiveMs(
    options.pollIntervalMs,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const minRefreshMs = positiveMs(options.minRefreshMs, DEFAULT_MIN_REFRESH_MS);
  const cachePath = path.resolve(
    options.cachePath || path.join(dataDir, CACHE_FILE_NAME),
  );
  const configuredImageBaseUrl = () => {
    const value =
      typeof options.imageBaseUrl === 'function'
        ? options.imageBaseUrl()
        : options.imageBaseUrl;
    if (value === undefined || value === null || String(value).trim() === '')
      return '';
    const normalized = normalizeImageBaseUrl(value);
    if (!normalized) throw catalogError('REMOTE_CATALOG_IMAGE_BASE_INVALID');
    return normalized;
  };
  const initialImageBaseUrl = configuredImageBaseUrl();
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  const bootstrapNowMs = currentTimeMs(now);
  let cache = readPersistedCache(
    cachePath,
    logger,
    initialImageBaseUrl,
    bootstrapNowMs,
  );
  let pending = null;
  let timer = null;
  let lifecycleGeneration = 0;
  let stopped = false;
  let lastAttemptMs = parseTime(cache?.checkedAt);

  function getSnapshot() {
    if (!cache?.snapshot) return null;
    return cloneSnapshot(cache.snapshot, true);
  }

  function refresh(requestOptions = {}) {
    if (stopped) return Promise.resolve(getSnapshot());
    if (pending) return pending;
    const currentMs = currentTimeMs(now);
    // A clock correction or a tampered persisted cache must not suppress all
    // future refreshes. Treat a future attempt timestamp as unknown.
    if (lastAttemptMs > currentMs) lastAttemptMs = 0;
    const force = requestOptions.force === true;
    if (
      !force &&
      lastAttemptMs > 0 &&
      currentMs - lastAttemptMs < minRefreshMs
    ) {
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
      if (stopped || requestGeneration !== lifecycleGeneration)
        return getSnapshot();

      // The license manager can be unavailable before the first authorization;
      // leave the local/previous snapshot untouched and try again later.
      if (!response) return getSnapshot();

      if (response.notModified === true) {
        if (!cache?.snapshot) {
          throw catalogError('REMOTE_CATALOG_NOT_MODIFIED_WITHOUT_CACHE');
        }
        const responseEtag = safeHeaderValue(response.etag);
        if (stopped || requestGeneration !== lifecycleGeneration)
          return getSnapshot();
        const nextCache = {
          ...cache,
          etag: responseEtag || cache.etag || '',
          checkedAt: isoTime(currentTimeMs(now)),
        };
        if (stopped || requestGeneration !== lifecycleGeneration)
          return getSnapshot();
        cache = nextCache;
        writePersistedCache(cachePath, cache, logger);
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
      if (stopped || requestGeneration !== lifecycleGeneration)
        return getSnapshot();
      cache = nextCache;
      if (changed) {
        writePersistedCache(cachePath, cache, logger);
        if (stopped || requestGeneration !== lifecycleGeneration)
          return getSnapshot();
        const update = cloneSnapshot(cache.snapshot, false);
        try {
          const result = options.onUpdated?.(update);
          if (result && typeof result.catch === 'function') {
            result.catch((error) =>
              logger.warn?.('[GiftCatalog] update notification failed:', error),
            );
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
      writePersistedCache(cachePath, cache, logger);
      return getSnapshot();
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  function start() {
    stopped = false;
    if (timer || pollIntervalMs <= 0) return;
    timer = setInterval(() => {
      refresh({ reason: 'schedule' }).catch((error) => {
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
    refresh,
    start,
    stop,
  };
}

function normalizeRemoteCatalog(response, options = {}) {
  if (response?.ok === false) {
    throw catalogError(
      String(response.error || response.code || 'REMOTE_CATALOG_INVALID'),
    );
  }
  const nested =
    response?.data &&
    response?.gifts == null &&
    typeof response.data === 'object' &&
    !Array.isArray(response.data)
      ? response.data
      : null;
  const source = nested ? nested : response;
  if (!source || source.ok === false) {
    throw catalogError(String(source?.error || 'REMOTE_CATALOG_INVALID'));
  }
  const rawGifts = Array.isArray(source.gifts) ? source.gifts : [];
  if (rawGifts.length === 0) throw catalogError('REMOTE_CATALOG_EMPTY');
  if (rawGifts.length > MAX_GIFTS)
    throw catalogError('REMOTE_CATALOG_TOO_LARGE');
  // The server origin is supplied by the composition root (the configured
  // license API base).  Never trust an origin echoed inside the response;
  // accepting it would let a proxy redirect image requests to an arbitrary
  // HTTPS host when this normalizer is used without an explicit base.
  const configuredImageBaseUrl = normalizeImageBaseUrl(options.imageBaseUrl);
  const gifts = [];
  const seenIds = new Set();
  for (const rawGift of rawGifts) {
    const gift = normalizeRemoteGift(rawGift, configuredImageBaseUrl);
    if (!gift || seenIds.has(gift.id)) continue;
    seenIds.add(gift.id);
    gifts.push(gift);
  }
  if (gifts.length === 0) throw catalogError('REMOTE_CATALOG_EMPTY');
  const version = safeText(source.version || source.revision, MAX_TEXT_LENGTH);
  if (!version) throw catalogError('REMOTE_CATALOG_VERSION_MISSING');
  const updatedAt =
    validIso(source.updatedAt || source.refreshedAt) ||
    isoTime(options.now || Date.now());
  const sources = normalizeSources(source.sources);
  return {
    source: 'server',
    roomId: '',
    panelCount: gifts.length,
    version,
    refreshedAt: updatedAt,
    updatedAt,
    stale:
      parseBooleanLike(source.stale) ||
      sources.gifts.stale ||
      sources.effects.stale,
    sources,
    count: gifts.length,
    gifts,
  };
}

function normalizeRemoteGift(value, imageBaseUrl) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawId = String(value.id ?? value.giftId ?? value.gift_id ?? '').trim();
  if (!/^\d{1,20}$/u.test(rawId)) return null;
  const id = rawId.replace(/^0+(?=\d)/u, '');
  try {
    if (BigInt(id) <= 0n) return null;
  } catch (_) {
    return null;
  }
  if (EXCLUDED_GIFT_IDS.has(id) || isGuardGiftAliasId(id)) return null;
  const name =
    safeText(value.name ?? value.displayName ?? value.giftName, 100) ||
    `礼物 ${id}`;
  const priceRaw = finiteNonNegative(value.priceRaw ?? value.price_raw);
  const coinType = safeText(value.coinType ?? value.coin_type, 32);
  const battery =
    value.battery == null
      ? coinType === 'gold'
        ? priceRaw / 100
        : null
      : finiteNonNegative(value.battery);
  const rmb =
    value.rmb == null
      ? coinType === 'gold'
        ? priceRaw / 1000
        : null
      : finiteNonNegative(value.rmb);
  return {
    id,
    name,
    battery,
    rmb,
    priceRaw,
    coinType,
    bagGift: parseBooleanLike(value.bagGift ?? value.bag_gift),
    imagePath: normalizeImagePath(
      value.imagePath || value.imageUrl,
      imageBaseUrl,
    ),
  };
}

function normalizeSources(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    gifts: normalizeSource(source.gifts),
    effects: normalizeSource(source.effects),
  };
}

function normalizeSource(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    asOf: validIso(source.asOf) || null,
    stale: parseBooleanLike(source.stale),
  };
}

function normalizeImagePath(value, imageBaseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let base = null;
  try {
    base = imageBaseUrl ? new URL(String(imageBaseUrl)) : null;
  } catch (_) {
    return '';
  }
  if (
    base &&
    (base.username ||
      base.password ||
      base.search ||
      base.hash ||
      (base.protocol !== 'https:' &&
        !(base.protocol === 'http:' && base.hostname === '127.0.0.1')))
  ) {
    return '';
  }
  // An absolute remote URL is only trusted after the composition root has
  // supplied the configured server origin.  This prevents a startup or
  // tampered response from turning a missing base into an arbitrary image
  // request; the main process supplies the configured base before refresh.
  if (!base) return '';
  let parsed;
  try {
    parsed = new URL(raw, base || undefined);
  } catch (_) {
    return '';
  }
  if (!/^\/gift-media\/images\/[A-Za-z0-9._-]+$/u.test(parsed.pathname))
    return '';
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    return '';
  if (base && parsed.origin !== base.origin) return '';
  return parsed.href;
}

function normalizeImageBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      return '';
    if (
      parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1')
    )
      return '';
    return parsed.origin;
  } catch (_) {
    return '';
  }
}

function parseBooleanLike(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined)
    return false;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function readPersistedCache(
  filePath,
  logger,
  imageBaseUrl = '',
  nowMs = Date.now(),
) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const currentMs = Number.isFinite(Number(nowMs))
      ? Number(nowMs)
      : Date.now();
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
        fetchedAt:
          validIso(parsed.fetchedAt) ||
          validIso(snapshot.fetchedAt) ||
          snapshot.updatedAt,
      },
    };
  } catch (error) {
    logger.debug?.(
      '[GiftCatalog] no usable persisted remote cache:',
      error?.message || error,
    );
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
          version: value.snapshot.version,
          updatedAt: value.snapshot.updatedAt,
          stale: value.snapshot.stale,
          sources: value.snapshot.sources,
          gifts: value.snapshot.gifts,
          fetchedAt: value.snapshot.fetchedAt,
          checkedAt: value.checkedAt,
        },
        null,
        2,
      )}\n`,
    );
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    logger.warn?.('[GiftCatalog] cache write failed:', error?.message || error);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch (error) {
        logger.debug?.(
          '[GiftCatalog] temporary cache cleanup failed:',
          error?.message || error,
        );
      }
    }
  }
}

function cloneSnapshot(snapshot, cached) {
  return {
    ...snapshot,
    cached,
    sources: {
      gifts: { ...snapshot.sources.gifts },
      effects: { ...snapshot.sources.effects },
    },
    gifts: snapshot.gifts.map((gift) => ({ ...gift })),
  };
}

function snapshotFingerprint(snapshot) {
  return JSON.stringify({
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
    stale: snapshot.stale,
    sources: snapshot.sources,
    gifts: snapshot.gifts,
  });
}

function catalogError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function positiveMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function safeText(value, maxLength) {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength);
}

function safeHeaderValue(value) {
  const text = String(value || '')
    .trim()
    .slice(0, 256);
  return /[\r\n]/u.test(text) ? '' : text;
}

function validIso(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
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

function isoTime(value) {
  return new Date(Number(value) || Date.now()).toISOString();
}

module.exports = {
  CACHE_FILE_NAME,
  createRemoteGiftCatalogCache,
  normalizeImageBaseUrl,
  normalizeImagePath,
  normalizeRemoteCatalog,
  normalizeRemoteGift,
};
