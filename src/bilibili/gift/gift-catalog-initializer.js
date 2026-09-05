'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STATE_FILE_NAME = 'overtime-gift-assets-state-v2.json';
const STATE_SCHEMA_VERSION = 2;

function createGiftCatalogInitializer(options = {}) {
  const dataDir = String(options.dataDir || '').trim();
  const catalog = options.catalog;
  const imageCache = options.imageCache;
  if (!dataDir) throw new Error('dataDir is required.');
  if (
    !catalog ||
    typeof catalog.getSnapshot !== 'function' ||
    typeof catalog.refresh !== 'function'
  )
    throw new Error('catalog is required.');
  if (!imageCache || typeof imageCache.cacheGifts !== 'function')
    throw new Error('imageCache is required.');

  const logger = options.logger || console;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const statePath = path.resolve(
    options.statePath || path.join(dataDir, STATE_FILE_NAME),
  );
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  let completion = readCompletion(statePath, logger);
  let state = initialState(catalog.getSnapshot(), completion);
  let pending = null;
  const listeners = new Set();

  function getState() {
    return { ...state };
  }

  function isInitialized() {
    return Boolean(completion && catalog.getSnapshot());
  }

  function publish(next) {
    state = normalizeState({ ...state, ...next });
    const snapshot = getState();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        logger.debug?.(
          '[GiftCatalog] initialization listener failed:',
          error?.message || error,
        );
      }
    }
    return snapshot;
  }

  function onStateChanged(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function initialize(request = {}) {
    if (pending) return pending;
    const wasInitialized = isInitialized();
    pending = (async () => {
      publish({
        status: wasInitialized ? 'updating' : 'running',
        background: wasInitialized,
        phase: 'catalog',
        completed: 0,
        total: 0,
        available: 0,
        failed: 0,
        percent: 0,
        currentGiftId: '',
        currentGiftName: '',
        completedAt: null,
        error: '',
      });

      let snapshot = null;
      let refreshError = null;
      try {
        snapshot = request.refresh === false
          ? catalog.getSnapshot()
          : await catalog.refresh({
              force: request.force !== false,
              reason: request.reason || 'initialization',
            });
      } catch (error) {
        refreshError = error;
        snapshot = catalog.getSnapshot();
      }
      snapshot = snapshot || catalog.getSnapshot();
      if (!snapshot || !Array.isArray(snapshot.gifts) || !snapshot.gifts.length) {
        throw refreshError || new Error('REMOTE_CATALOG_NOT_READY');
      }

      let version = String(snapshot.version || '').trim();
      if (
        typeof imageCache.isGiftImageCurrent !== 'function' &&
        wasInitialized &&
        completion?.catalogVersion === version &&
        completion.failed === 0
      ) {
        return publish({
          status: 'ready',
          phase: 'complete',
          version,
          completed: completion.total,
          total: completion.total,
          available: completion.available,
          failed: 0,
          percent: 100,
          completedAt: completion.completedAt,
          warning: refreshError ? 'CATALOG_REFRESH_FAILED' : '',
        });
      }

      let completed = 0;
      let available = 0;
      let failed = 0;
      // A room refresh can publish a newer catalog while images are downloading.
      // Finish that latest snapshot too, without another remote request.
      for (;;) {
        version = String(snapshot.version || '').trim();
        const gifts = snapshot.gifts;
        const work = wasInitialized && typeof imageCache.isGiftImageCurrent === 'function'
          ? gifts.filter((gift) =>
              !imageCache.isGiftImageCurrent(gift) &&
              imageCache.hasGiftImageSource?.(gift) !== false)
          : gifts;
        if (work.length) {
          publish({
            status: wasInitialized ? 'updating' : 'running',
            phase: 'images',
            version,
            completed: 0,
            total: work.length,
            available: 0,
            failed: 0,
            percent: 5,
            warning: refreshError ? 'CATALOG_REFRESH_FAILED' : '',
          });
          const cachedGifts = await imageCache.cacheGifts(work, {
            onProgress(progress) {
              publish({
                completed: progress.completed,
                total: progress.total,
                available: progress.available,
                failed: progress.failed,
                percent:
                  progress.total > 0
                    ? 5 + Math.floor((progress.completed / progress.total) * 95)
                    : 100,
                currentGiftId: progress.giftId,
                currentGiftName: progress.giftName,
              });
            },
          });
          completed = work.length;
          available = cachedGifts.filter((gift, index) =>
            typeof imageCache.isGiftImageCurrent === 'function'
              ? imageCache.isGiftImageCurrent(work[index])
              : Boolean(gift.imagePath),
          ).length;
          failed = work.length - available;
        }
        const latest = catalog.getSnapshot();
        if (latest && JSON.stringify([latest.version, latest.gifts]) !==
          JSON.stringify([snapshot.version, snapshot.gifts])) {
          snapshot = latest;
          continue;
        }
        const catalogAvailable = typeof imageCache.isGiftImageCurrent === 'function'
          ? gifts.filter((gift) => imageCache.isGiftImageCurrent(gift)).length
          : gifts.length - (work.length ? failed : 0);
        completion = {
          schemaVersion: STATE_SCHEMA_VERSION,
          catalogVersion: version,
          total: gifts.length,
          available: catalogAvailable,
          failed: gifts.length - catalogAvailable,
          completedAt: isoTime(now()),
        };
        writeCompletion(statePath, completion);
        break;
      }
      return publish({
        status: 'ready',
        phase: 'complete',
        version,
        completed,
        total: completed,
        available,
        failed,
        percent: 100,
        currentGiftId: '',
        currentGiftName: '',
        completedAt: completion.completedAt,
        error: '',
        warning:
          failed === 0
            ? refreshError
              ? 'CATALOG_REFRESH_FAILED'
              : ''
            : 'SOME_IMAGES_UNAVAILABLE',
      });
    })()
      .catch((error) => {
        publish({
          status: wasInitialized ? 'ready' : 'error',
          phase: wasInitialized ? 'complete' : 'error',
          percent: wasInitialized ? 100 : state.percent,
          currentGiftId: '',
          currentGiftName: '',
          completedAt: isoTime(now()),
          error: safeErrorCode(error),
          warning: wasInitialized ? 'CATALOG_REFRESH_FAILED' : '',
        });
        throw error;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  return {
    statePath,
    getState,
    initialize,
    isInitialized,
    onStateChanged,
  };
}

function initialState(snapshot, completion) {
  if (snapshot && completion) {
    return normalizeState({
      status: 'ready',
      phase: 'complete',
      version: completion.catalogVersion,
      completed: completion.total,
      total: completion.total,
      available: completion.available,
      failed: completion.failed,
      percent: 100,
      completedAt: completion.completedAt,
      warning: completion.failed > 0 ? 'SOME_IMAGES_UNAVAILABLE' : '',
    });
  }
  return normalizeState({ status: 'required', phase: 'idle' });
}

function normalizeState(value = {}) {
  const total = nonNegativeInteger(value.total);
  const completed = Math.min(nonNegativeInteger(value.completed), total);
  const available = Math.min(nonNegativeInteger(value.available), completed);
  const failed = Math.min(nonNegativeInteger(value.failed), completed);
  return {
    status: ['required', 'running', 'updating', 'ready', 'error'].includes(
      value.status,
    )
      ? value.status
      : 'required',
    background: value.background === true,
    phase: ['idle', 'catalog', 'images', 'complete', 'error'].includes(
      value.phase,
    )
      ? value.phase
      : 'idle',
    version: safeText(value.version, 256),
    completed,
    total,
    available,
    failed,
    percent: Math.max(0, Math.min(100, nonNegativeInteger(value.percent))),
    currentGiftId: safeText(value.currentGiftId, 32),
    currentGiftName: safeText(value.currentGiftName, 100),
    completedAt: validIso(value.completedAt) || null,
    error: safeText(value.error, 64),
    warning: safeText(value.warning, 64),
  };
}

function readCompletion(filePath, logger) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (
      value?.schemaVersion !== STATE_SCHEMA_VERSION ||
      !safeText(value.catalogVersion, 256) ||
      !validIso(value.completedAt)
    )
      return null;
    const total = nonNegativeInteger(value.total);
    const available = Math.min(nonNegativeInteger(value.available), total);
    const failed = Math.min(nonNegativeInteger(value.failed), total);
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      catalogVersion: safeText(value.catalogVersion, 256),
      total,
      available,
      failed,
      completedAt: validIso(value.completedAt),
    };
  } catch (error) {
    logger.debug?.(
      '[GiftCatalog] no completed asset initialization:',
      error?.message || error,
    );
    return null;
  }
}

function writeCompletion(filePath, value) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  );
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function safeErrorCode(error) {
  const code = String(error?.code || error?.message || 'CATALOG_INITIALIZATION_FAILED')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/gu, '_')
    .slice(0, 64);
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(code)
    ? code
    : 'CATALOG_INITIALIZATION_FAILED';
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function safeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function validIso(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function isoTime(value) {
  const time = Number(value);
  return new Date(Number.isFinite(time) ? time : Date.now()).toISOString();
}

module.exports = {
  STATE_FILE_NAME,
  createGiftCatalogInitializer,
  readCompletion,
};
