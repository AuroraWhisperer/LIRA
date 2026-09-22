'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CACHE_FILE_NAME } = require('../src/bilibili/gift/remote-catalog-cache');
const { createHybridGiftSaleCatalogService } = require('../src/bilibili/gift/hybrid-catalog');
const { QUIET_LOGGER, UPDATED_AT, createRemoteGiftCatalogCache } = require('./helpers/remote-catalog-fixture');

test('point gift lookup follows catalog replacements and does not expose mutable rows', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-index-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let version = 1;
  const cache = createRemoteGiftCatalogCache({
    dataDir,
    logger: QUIET_LOGGER,
    fetchRemote: async () => ({
      schemaVersion: 2,
      blindBoxes: [],
      version: String(version),
      updatedAt: UPDATED_AT,
      gifts: [
        {
          id: version === 3 ? '1002' : '1001',
          name: `gift-${version}`,
          priceRaw: 1000,
          coinType: 'gold',
        },
      ],
    }),
  });
  assert.equal(cache.getGift('1001'), null);
  await cache.refresh({ force: true });
  const row = cache.getGift('1001');
  row.name = 'modified';
  assert.equal(cache.getGift('1001').name, 'gift-1');
  version = 2;
  await cache.refresh({ force: true });
  assert.equal(cache.getGift('1001').name, 'gift-2');
  version = 3;
  await cache.refresh({ force: true });
  assert.equal(cache.getGift('1001'), null);
  cache.stop();
});

test('rule artwork lookup checks only the requested gift, not all catalog images', () => {
  let snapshots = 0;
  let imageChecks = 0;
  let imagePath = 'first';
  const catalog = createHybridGiftSaleCatalogService({
    local: {
      getSnapshot: () => ({ gifts: [] }),
      refresh: async () => ({ gifts: [] }),
    },
    remoteCatalog: {
      getSnapshot() {
        snapshots += 1;
        return { gifts: [] };
      },
      getGift: (id) => (id === '1001' ? { id, imagePath } : null),
      refresh: async () => ({ gifts: [] }),
    },
    remoteImageCache: {
      getCachedGiftImagePath(gift) {
        imageChecks += 1;
        return gift.imagePath;
      },
    },
  });
  const initialSnapshots = snapshots;
  assert.equal(catalog.resolveGiftImagePath('1001'), 'first');
  imagePath = 'updated';
  assert.equal(catalog.resolveGiftImagePath('1001'), 'updated');
  assert.equal(snapshots, initialSnapshots);
  assert.equal(imageChecks, 2);
});

test('persists and coalesces remote catalog refreshes', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-'));
  try {
    let calls = 0;
    const updates = [];
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      minRefreshMs: 1,
      imageBaseUrl: 'https://api.lirahub.cn',
      fetchRemote: async (request) => {
        calls += 1;
        assert.equal(request.etag, '');
        await Promise.resolve();
        return {
          ok: true,
          version: '7',
          updatedAt: UPDATED_AT,
          stale: false,
          sources: {
            gifts: { asOf: UPDATED_AT, stale: false },
            effects: { asOf: UPDATED_AT, stale: false },
          },
          imageBaseUrl: 'https://api.lirahub.cn',
          etag: '"catalog-7"',
          gifts: [
            {
              id: '000100',
              name: '示例礼物',
              priceRaw: 1000,
              coinType: 'gold',
              bagGift: false,
              imageUrl: '/gift-media/images/hash.webp',
            },
          ],
        };
      },
      onUpdated: (snapshot) => updates.push(snapshot),
    });

    const [first, second] = await Promise.all([cache.refresh({ force: true }), cache.refresh({ force: true })]);
    assert.equal(calls, 1);
    assert.strictEqual(first, second);
    assert.equal(first.cached, false);
    assert.equal(first.source, 'server');
    assert.equal(first.gifts[0].id, '100');
    assert.equal(first.gifts[0].imagePath, 'https://api.lirahub.cn/gift-media/images/hash.webp');
    assert.equal(first.gifts[0].battery, 10);
    assert.equal(first.gifts[0].rmb, 1);
    assert.equal(updates.length, 1);

    const cacheFile = path.join(dataDir, 'cache', CACHE_FILE_NAME);
    assert.equal(fs.existsSync(cacheFile), true);
    const persisted = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assert.equal(persisted.version, '7');
    assert.equal(persisted.etag, '"catalog-7"');

    const restored = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      imageBaseUrl: 'https://api.lirahub.cn',
      fetchRemote: async () => null,
    });
    const restoredSnapshot = restored.getSnapshot();
    assert.equal(restoredSnapshot.cached, true);
    assert.equal(restoredSnapshot.version, '7');
    assert.equal(restoredSnapshot.gifts[0].imagePath, 'https://api.lirahub.cn/gift-media/images/hash.webp');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('uses the persisted etag for 304 and keeps the previous gifts', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-'));
  try {
    let calls = 0;
    let receivedEtag = '';
    const fetchRemote = async (request) => {
      calls += 1;
      receivedEtag = request.etag;
      if (calls === 1) {
        return {
          ok: true,
          version: '9',
          updatedAt: UPDATED_AT,
          imageBaseUrl: 'https://api.lirahub.cn',
          etag: '"catalog-9"',
          gifts: [{ id: '200', name: '保留礼物', priceRaw: 2000, coinType: 'gold' }],
        };
      }
      return { notModified: true, etag: '"catalog-9"' };
    };
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      fetchRemote,
      minRefreshMs: 1,
      imageBaseUrl: 'https://api.lirahub.cn',
    });

    const first = await cache.refresh({ force: true });
    const second = await cache.refresh({ force: true });
    assert.equal(first.gifts[0].id, '200');
    assert.equal(second.cached, true);
    assert.equal(second.gifts[0].id, '200');
    assert.equal(receivedEtag, '"catalog-9"');
    assert.equal(calls, 2);
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'cache', CACHE_FILE_NAME), 'utf8'));
    assert.equal(persisted.etag, '"catalog-9"');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('keeps a usable persisted snapshot when a refresh fails', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-'));
  try {
    let shouldFail = false;
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      fetchRemote: async () => {
        if (shouldFail) throw new Error('offline');
        return {
          ok: true,
          version: '11',
          updatedAt: UPDATED_AT,
          imageBaseUrl: 'https://api.lirahub.cn',
          gifts: [{ id: '300', name: '离线可用', priceRaw: 100, coinType: 'gold' }],
        };
      },
    });
    await cache.refresh({ force: true });
    shouldFail = true;
    await assert.rejects(cache.refresh({ force: true }), /offline/);
    assert.equal(cache.getSnapshot().gifts[0].id, '300');

    const restored = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      imageBaseUrl: 'https://api.lirahub.cn',
      fetchRemote: async () => null,
    });
    assert.equal(restored.getSnapshot().gifts[0].name, '离线可用');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('does not let a future persisted check time suppress refresh', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-future-'));
  try {
    const nowMs = Date.parse('2026-08-29T08:00:00.000Z');
    fs.mkdirSync(path.join(dataDir, 'cache'), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'cache', CACHE_FILE_NAME),
      JSON.stringify({
        etag: '"old"',
        schemaVersion: 2,
        version: 'old',
        updatedAt: UPDATED_AT,
        checkedAt: '2099-01-01T00:00:00.000Z',
        gifts: [
          {
            id: '301',
            name: '旧礼物',
            priceRaw: 100,
            coinType: 'gold',
            active: true,
            giftCategory: 'directGift',
          },
        ],
        blindBoxes: [],
      }),
    );
    let calls = 0;
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      now: () => nowMs,
      minRefreshMs: 5 * 60 * 1000,
      fetchRemote: async (request) => {
        calls += 1;
        assert.equal(request.etag, '"old"');
        return {
          ok: true,
          version: 'new',
          updatedAt: UPDATED_AT,
          gifts: [{ id: '302', name: '新礼物', priceRaw: 200, coinType: 'gold' }],
        };
      },
    });

    const snapshot = await cache.refresh();
    assert.equal(calls, 1);
    assert.equal(snapshot.gifts[0].id, '302');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('stopping the cache suppresses late writes and update notifications', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-stop-'));
  try {
    let resolveFetch;
    const updates = [];
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      fetchRemote: () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      onUpdated: (snapshot) => updates.push(snapshot),
    });
    const pending = cache.refresh({ force: true });
    cache.stop();
    resolveFetch({
      ok: true,
      version: 'late',
      updatedAt: UPDATED_AT,
      gifts: [{ id: '303', name: '晚到礼物', priceRaw: 300, coinType: 'gold' }],
    });

    const snapshot = await pending;
    assert.equal(snapshot, null);
    assert.deepEqual(updates, []);
    assert.equal(fs.existsSync(path.join(dataDir, 'cache', CACHE_FILE_NAME)), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
