'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  STATE_FILE_NAME,
  createGiftCatalogInitializer,
} = require('../src/bilibili/gift/gift-catalog-initializer');

const QUIET_LOGGER = { debug() {}, warn() {} };
const COMPLETED_AT = '2026-09-05T00:00:00.000Z';

test('initializes the catalog and all available images on first login', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-gift-catalog-initializer-success-'),
  );
  try {
    const snapshot = catalogSnapshot('v1', ['1', '2']);
    let refreshCalls = 0;
    let cacheCalls = 0;
    const states = [];
    const initializer = createGiftCatalogInitializer({
      dataDir,
      catalog: {
        getSnapshot: () => snapshot,
        refresh: async () => {
          refreshCalls += 1;
          return snapshot;
        },
      },
      imageCache: {
        cacheGifts: async (gifts, options) => {
          cacheCalls += 1;
          options.onProgress({
            completed: 1,
            total: gifts.length,
            available: 1,
            failed: 0,
            giftId: '1',
            giftName: '礼物1',
          });
          options.onProgress({
            completed: 2,
            total: gifts.length,
            available: 2,
            failed: 0,
            giftId: '2',
            giftName: '礼物2',
          });
          return gifts.map((gift) => ({
            ...gift,
            imagePath: `/overtime-gift-images/${gift.id}.webp`,
          }));
        },
      },
      now: () => Date.parse(COMPLETED_AT),
      logger: QUIET_LOGGER,
    });
    initializer.onStateChanged((state) => states.push(state));

    const result = await initializer.initialize();

    assert.equal(refreshCalls, 1);
    assert.equal(cacheCalls, 1);
    assert.equal(result.status, 'ready');
    assert.equal(result.background, false);
    assert.equal(result.phase, 'complete');
    assert.equal(result.total, 2);
    assert.equal(result.available, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.percent, 100);
    assert.equal(result.completedAt, COMPLETED_AT);
    assert.equal(states.some((state) => state.phase === 'catalog'), true);
    assert.equal(states.some((state) => state.phase === 'images'), true);
    assert.equal(initializer.isInitialized(), true);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(dataDir, STATE_FILE_NAME), 'utf8'),
    );
    assert.deepEqual(persisted, {
      schemaVersion: 2,
      catalogVersion: 'v1',
      total: 2,
      available: 2,
      failed: 0,
      completedAt: COMPLETED_AT,
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('reuses completed initialization state without redownloading images', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-gift-catalog-initializer-reuse-'),
  );
  try {
    const snapshot = catalogSnapshot('v2', ['3']);
    let cacheCalls = 0;
    const first = createGiftCatalogInitializer({
      dataDir,
      catalog: {
        getSnapshot: () => snapshot,
        refresh: async () => snapshot,
      },
      imageCache: {
        cacheGifts: async (gifts) => {
          cacheCalls += 1;
          return gifts.map((gift) => ({ ...gift, imagePath: '/cached.webp' }));
        },
      },
      now: () => Date.parse(COMPLETED_AT),
      logger: QUIET_LOGGER,
    });
    await first.initialize();

    let refreshCalls = 0;
    const second = createGiftCatalogInitializer({
      dataDir,
      catalog: {
        getSnapshot: () => snapshot,
        refresh: async () => {
          refreshCalls += 1;
          return snapshot;
        },
      },
      imageCache: {
        cacheGifts: async () => {
          throw new Error('should not redownload');
        },
      },
      logger: QUIET_LOGGER,
    });

    assert.equal(second.isInitialized(), true);
    assert.equal(second.getState().background, false);
    const result = await second.initialize();
    assert.equal(refreshCalls, 1);
    assert.equal(cacheCalls, 1);
    assert.equal(result.status, 'ready');
    assert.equal(result.background, true);
    assert.equal(result.phase, 'complete');
    assert.equal(result.available, 1);
    assert.equal(result.failed, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('allows initialization to complete when individual images fail', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-gift-catalog-initializer-partial-'),
  );
  try {
    const snapshot = catalogSnapshot('v3', ['4', '5']);
    const initializer = createGiftCatalogInitializer({
      dataDir,
      catalog: {
        getSnapshot: () => snapshot,
        refresh: async () => snapshot,
      },
      imageCache: {
        cacheGifts: async (gifts) =>
          gifts.map((gift, index) => ({
            ...gift,
            imagePath: index === 0 ? '/available.webp' : '',
          })),
      },
      logger: QUIET_LOGGER,
    });

    const result = await initializer.initialize();

    assert.equal(result.status, 'ready');
    assert.equal(result.phase, 'complete');
    assert.equal(result.available, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.warning, 'SOME_IMAGES_UNAVAILABLE');
    assert.equal(initializer.isInitialized(), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('fails first initialization when the catalog is unavailable and no local copy exists', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-gift-catalog-initializer-offline-'),
  );
  try {
    const initializer = createGiftCatalogInitializer({
      dataDir,
      catalog: {
        getSnapshot: () => null,
        refresh: async () => {
          throw new Error('catalog offline');
        },
      },
      imageCache: { cacheGifts: async () => [] },
      logger: QUIET_LOGGER,
    });

    await assert.rejects(initializer.initialize(), /catalog offline/);
    assert.equal(initializer.isInitialized(), false);
    assert.equal(initializer.getState().status, 'error');
    assert.equal(initializer.getState().phase, 'error');
    assert.equal(
      fs.existsSync(path.join(dataDir, STATE_FILE_NAME)),
      false,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('keeps a completed local catalog ready when its refresh fails', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-gift-catalog-initializer-stale-'),
  );
  try {
    const snapshot = catalogSnapshot('v4', ['6']);
    const first = createGiftCatalogInitializer({
      dataDir,
      catalog: {
        getSnapshot: () => snapshot,
        refresh: async () => snapshot,
      },
      imageCache: {
        cacheGifts: async (gifts) =>
          gifts.map((gift) => ({ ...gift, imagePath: '/cached.webp' })),
      },
      now: () => Date.parse(COMPLETED_AT),
      logger: QUIET_LOGGER,
    });
    await first.initialize();

    let cacheCalls = 0;
    const second = createGiftCatalogInitializer({
      dataDir,
      catalog: {
        getSnapshot: () => snapshot,
        refresh: async () => {
          throw new Error('offline');
        },
      },
      imageCache: {
        cacheGifts: async () => {
          cacheCalls += 1;
          return [];
        },
      },
      logger: QUIET_LOGGER,
    });

    const result = await second.initialize();
    assert.equal(result.status, 'ready');
    assert.equal(result.warning, 'CATALOG_REFRESH_FAILED');
    assert.equal(result.available, 1);
    assert.equal(cacheCalls, 0);
    assert.equal(second.isInitialized(), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('coalesces concurrent initialization requests into one scan', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-gift-catalog-initializer-single-flight-'),
  );
  try {
    const snapshot = catalogSnapshot('v5', ['7']);
    let releaseRefresh;
    let refreshCalls = 0;
    let cacheCalls = 0;
    const initializer = createGiftCatalogInitializer({
      dataDir,
      catalog: {
        getSnapshot: () => null,
        refresh: () => {
          refreshCalls += 1;
          return new Promise((resolve) => {
            releaseRefresh = () => resolve(snapshot);
          });
        },
      },
      imageCache: {
        cacheGifts: async (gifts) => {
          cacheCalls += 1;
          return gifts.map((gift) => ({ ...gift, imagePath: '/cached.webp' }));
        },
      },
      logger: QUIET_LOGGER,
    });

    const first = initializer.initialize();
    const second = initializer.initialize();
    assert.equal(first, second);
    releaseRefresh();
    await Promise.all([first, second]);
    assert.equal(refreshCalls, 1);
    assert.equal(cacheCalls, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function catalogSnapshot(version, ids) {
  return {
    source: 'server',
    version,
    gifts: ids.map((id) => ({ id, name: `礼物${id}` })),
  };
}
