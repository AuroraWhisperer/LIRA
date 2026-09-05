'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CACHE_FILE_NAME,
  createRemoteGiftCatalogCache: createRemoteGiftCatalogCacheImpl,
  normalizeImageBaseUrl,
  normalizeBilibiliImageUrl,
  normalizeImagePath,
  normalizeRemoteCatalog: normalizeRemoteCatalogImpl,
} = require('../src/bilibili/gift/remote-catalog-cache');
const {
  createHybridGiftSaleCatalogService,
  mergeRoomCatalog,
} = require('../src/bilibili/gift/hybrid-catalog');

const QUIET_LOGGER = { debug() {}, warn() {} };
const UPDATED_AT = '2026-08-29T08:00:00.000Z';

function v2CatalogResponse(response) {
  if (!response || response.notModified === true || response.ok === false) {
    return response;
  }
  return {
    schemaVersion: 2,
    blindBoxes: [],
    ...response,
    gifts: (response.gifts || []).map((gift) => ({
      active: true,
      isBlindBox: false,
      ...gift,
    })),
  };
}

function createRemoteGiftCatalogCache(options) {
  const fetchRemote = options.fetchRemote;
  return createRemoteGiftCatalogCacheImpl({
    ...options,
    fetchRemote: async (request) =>
      v2CatalogResponse(await fetchRemote(request)),
  });
}

function normalizeRemoteCatalog(response, options) {
  return normalizeRemoteCatalogImpl(v2CatalogResponse(response), options);
}

test('point gift lookup follows catalog replacements and does not expose mutable rows', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-index-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let version = 1;
  const cache = createRemoteGiftCatalogCache({
    dataDir, logger: QUIET_LOGGER,
    fetchRemote: async () => ({
      schemaVersion: 2, blindBoxes: [],
      version: String(version), updatedAt: UPDATED_AT,
      gifts: [{ id: version === 3 ? '1002' : '1001', name: `gift-${version}`, priceRaw: 1000, coinType: 'gold' }],
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
    local: { getSnapshot: () => ({ gifts: [] }), refresh: async () => ({ gifts: [] }) },
    remoteCatalog: {
      getSnapshot() { snapshots += 1; return { gifts: [] }; },
      getGift: (id) => id === '1001' ? { id, imagePath } : null,
      refresh: async () => ({ gifts: [] }),
    },
    remoteImageCache: {
      getCachedGiftImagePath(gift) { imageChecks += 1; return gift.imagePath; },
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
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-'),
  );
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

    const [first, second] = await Promise.all([
      cache.refresh({ force: true }),
      cache.refresh({ force: true }),
    ]);
    assert.equal(calls, 1);
    assert.strictEqual(first, second);
    assert.equal(first.cached, false);
    assert.equal(first.source, 'server');
    assert.equal(first.gifts[0].id, '100');
    assert.equal(
      first.gifts[0].imagePath,
      'https://api.lirahub.cn/gift-media/images/hash.webp',
    );
    assert.equal(first.gifts[0].battery, 10);
    assert.equal(first.gifts[0].rmb, 1);
    assert.equal(updates.length, 1);

    const cacheFile = path.join(dataDir, CACHE_FILE_NAME);
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
    assert.equal(
      restoredSnapshot.gifts[0].imagePath,
      'https://api.lirahub.cn/gift-media/images/hash.webp',
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('uses the persisted etag for 304 and keeps the previous gifts', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-'),
  );
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
          gifts: [
            { id: '200', name: '保留礼物', priceRaw: 2000, coinType: 'gold' },
          ],
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
    const persisted = JSON.parse(
      fs.readFileSync(path.join(dataDir, CACHE_FILE_NAME), 'utf8'),
    );
    assert.equal(persisted.etag, '"catalog-9"');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('keeps a usable persisted snapshot when a refresh fails', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-'),
  );
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
          gifts: [
            { id: '300', name: '离线可用', priceRaw: 100, coinType: 'gold' },
          ],
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
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-future-'),
  );
  try {
    const nowMs = Date.parse('2026-08-29T08:00:00.000Z');
    fs.writeFileSync(
      path.join(dataDir, CACHE_FILE_NAME),
      JSON.stringify({
        etag: '"old"',
        schemaVersion: 2,
        version: 'old',
        updatedAt: UPDATED_AT,
        checkedAt: '2099-01-01T00:00:00.000Z',
        gifts: [{
          id: '301',
          name: '旧礼物',
          priceRaw: 100,
          coinType: 'gold',
          active: true,
          isBlindBox: false,
        }],
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
          gifts: [
            { id: '302', name: '新礼物', priceRaw: 200, coinType: 'gold' },
          ],
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
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-stop-'),
  );
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
    assert.equal(fs.existsSync(path.join(dataDir, CACHE_FILE_NAME)), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('normalizes only same-origin immutable gift images and rejects duplicate ids', () => {
  assert.throws(
    () =>
      normalizeRemoteCatalog({
        ok: false,
        error: 'REMOTE_CATALOG_FAILED',
        data: { version: 'spoofed', gifts: [{ id: '399', name: '不应接受' }] },
      }),
    (error) => error.code === 'REMOTE_CATALOG_FAILED',
  );
  assert.equal(
    normalizeImagePath('/gift-media/images/a.webp', 'https://api.lirahub.cn'),
    'https://api.lirahub.cn/gift-media/images/a.webp',
  );
  assert.equal(
    normalizeImagePath(
      '/gift-media/images/../secret',
      'https://api.lirahub.cn',
    ),
    '',
  );
  assert.equal(
    normalizeImagePath(
      '/gift-media/images/nested/hash.webp',
      'https://api.lirahub.cn',
    ),
    '',
  );
  assert.equal(
    normalizeImagePath(
      '/gift-media/images/hash%2Ewebp',
      'https://api.lirahub.cn',
    ),
    '',
  );
  assert.equal(
    normalizeImagePath('https://evil.example/a.webp', 'https://api.lirahub.cn'),
    '',
  );
  assert.equal(
    normalizeImagePath('/gift-media/images/a.webp', 'http://evil.example'),
    '',
  );
  assert.equal(normalizeImageBaseUrl('http://127.0.0.1:13000'), '');
  assert.equal(normalizeImageBaseUrl('https://localhost'), '');
  assert.equal(normalizeImageBaseUrl('https://127.0.0.1'), '');
  assert.equal(normalizeImageBaseUrl('https://[::1]'), '');
  assert.equal(normalizeImageBaseUrl('https://bad_host.example'), '');
  assert.equal(normalizeImageBaseUrl('https://api.lirahub.cn/path'), '');
  assert.equal(
    normalizeImagePath('https://api.lirahub.cn/gift-media/images/a.webp'),
    '',
  );

  const advertisedOrigin = normalizeRemoteCatalog({
    ok: true,
    version: 'advertised-origin',
    imageBaseUrl: 'https://untrusted.example',
    gifts: [
      {
        id: '401',
        name: '不可信图片',
        priceRaw: 100,
        coinType: 'gold',
        imageUrl: '/gift-media/images/a.webp',
      },
    ],
  });
  assert.equal(advertisedOrigin.gifts[0].imagePath, '');

  assert.throws(
    () =>
      normalizeRemoteCatalog({
        ok: true,
        version: 'duplicate',
        gifts: [
          { id: '400', name: '第一条', priceRaw: 100, coinType: 'gold' },
          { id: '000400', name: '重复条', priceRaw: 100, coinType: 'gold' },
        ],
      }),
    (error) => error.code === 'REMOTE_CATALOG_DUPLICATE_GIFT',
  );

  const snapshot = normalizeRemoteCatalog({
    ok: true,
    version: '12',
    imageBaseUrl: 'https://api.lirahub.cn',
    gifts: [
      { id: '400', name: '第一条', priceRaw: 100, coinType: 'gold' },
      { id: '13000', name: '发红包', priceRaw: 0, coinType: 'gold' },
      { id: '33972', name: '舰长一号', priceRaw: 100, coinType: 'gold' },
      { id: '401', name: '免费礼物', priceRaw: 0, coinType: 'gold' },
      { id: '402', name: '银瓜子礼物', priceRaw: 25, coinType: 'silver' },
    ],
  });
  assert.deepEqual(
    snapshot.gifts.map((gift) => gift.id),
    ['400', '401'],
  );
  assert.equal(
    normalizeBilibiliImageUrl(
      'https://i0.hdslb.com/bfs/live/source.webp',
    ),
    'https://i0.hdslb.com/bfs/live/source.webp',
  );
  assert.equal(
    normalizeBilibiliImageUrl('https://evil.example/source.webp'),
    '',
  );
});

test('requires explicit v2 gift state booleans', () => {
  const missingActive = v2CatalogResponse({
    version: 'missing-active',
    gifts: [{ id: '410', name: '礼物', priceRaw: 100, coinType: 'gold' }],
  });
  delete missingActive.gifts[0].active;
  assert.throws(
    () => normalizeRemoteCatalogImpl(missingActive),
    (error) => error.code === 'REMOTE_CATALOG_GIFT_INVALID',
  );

  const invalidBlindBox = v2CatalogResponse({
    version: 'invalid-blind-box',
    gifts: [{ id: '411', name: '礼物', priceRaw: 100, coinType: 'gold' }],
  });
  invalidBlindBox.gifts[0].isBlindBox = 1;
  assert.throws(
    () => normalizeRemoteCatalogImpl(invalidBlindBox),
    (error) => error.code === 'REMOTE_CATALOG_GIFT_INVALID',
  );
});

test('persists and notifies a relation-only catalog update', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-relations-'),
  );
  try {
    let outputGiftId = '602';
    const updates = [];
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      minRefreshMs: 1,
      fetchRemote: async () => ({
        version: 'same-version',
        updatedAt: UPDATED_AT,
        gifts: [
          {
            id: '601',
            name: '盲盒',
            priceRaw: 5000,
            coinType: 'gold',
            isBlindBox: true,
          },
          { id: '602', name: '产物 A', priceRaw: 100, coinType: 'gold' },
          { id: '603', name: '产物 B', priceRaw: 200, coinType: 'gold' },
        ],
        blindBoxes: [{ giftId: '601', outputGiftIds: [outputGiftId] }],
      }),
      onUpdated: (snapshot) => updates.push(snapshot),
    });

    await cache.refresh({ force: true });
    outputGiftId = '603';
    await cache.refresh({ force: true });

    assert.equal(updates.length, 2);
    assert.deepEqual(cache.getSnapshot().blindBoxes, [
      { giftId: '601', outputGiftIds: ['603'] },
    ]);
    const persisted = JSON.parse(
      fs.readFileSync(path.join(dataDir, CACHE_FILE_NAME), 'utf8'),
    );
    assert.deepEqual(persisted.blindBoxes, cache.getSnapshot().blindBoxes);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('retains the previous snapshot when a relation reference is invalid', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-invalid-relation-'),
  );
  try {
    let outputGiftId = '612';
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      minRefreshMs: 1,
      fetchRemote: async () => ({
        version: outputGiftId === '612' ? 'valid' : 'invalid',
        gifts: [
          {
            id: '611',
            name: '盲盒',
            priceRaw: 5000,
            coinType: 'gold',
            isBlindBox: true,
          },
          { id: '612', name: '产物', priceRaw: 100, coinType: 'gold' },
        ],
        blindBoxes: [{ giftId: '611', outputGiftIds: [outputGiftId] }],
      }),
    });

    await cache.refresh({ force: true });
    outputGiftId = '999';
    await assert.rejects(
      cache.refresh({ force: true }),
      (error) => error.code === 'REMOTE_CATALOG_BLIND_BOXES_INVALID',
    );
    assert.equal(cache.getSnapshot().version, 'valid');
    assert.deepEqual(cache.getSnapshot().blindBoxes[0].outputGiftIds, ['612']);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('retains the in-memory snapshot when the replacement cannot be persisted', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-write-failure-'),
  );
  const cacheDir = path.join(dataDir, 'cache');
  try {
    let giftId = '621';
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      cachePath: path.join(cacheDir, 'catalog.json'),
      logger: QUIET_LOGGER,
      minRefreshMs: 1,
      fetchRemote: async () => ({
        version: giftId,
        gifts: [
          { id: giftId, name: `礼物 ${giftId}`, priceRaw: 100, coinType: 'gold' },
        ],
      }),
    });

    await cache.refresh({ force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.writeFileSync(cacheDir, 'blocks cache writes');
    giftId = '622';

    await assert.rejects(
      cache.refresh({ force: true }),
      (error) => error.code === 'REMOTE_CATALOG_CACHE_WRITE_FAILED',
    );
    assert.equal(cache.getGift('621').name, '礼物 621');
    assert.equal(cache.getGift('622'), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('does not persist or use a response-advertised image origin without configuration', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-untrusted-origin-'),
  );
  try {
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      fetchRemote: async () => ({
        ok: true,
        version: 'advertised-origin-refresh',
        imageBaseUrl: 'https://evil.example',
        gifts: [
          {
            id: '402',
            name: '不可信图片',
            priceRaw: 100,
            coinType: 'gold',
            imageUrl: '/gift-media/images/a.webp',
          },
        ],
      }),
    });

    const snapshot = await cache.refresh({ force: true });
    assert.equal(snapshot.gifts[0].imagePath, '');
    const persisted = JSON.parse(
      fs.readFileSync(path.join(dataDir, CACHE_FILE_NAME), 'utf8'),
    );
    assert.equal(persisted.imageBaseUrl, '');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('refreshes a persisted snapshot that has no prior check timestamp', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-unchecked-'),
  );
  try {
    fs.writeFileSync(
      path.join(dataDir, CACHE_FILE_NAME),
      JSON.stringify({
        etag: '"old"',
        schemaVersion: 2,
        version: 'old',
        updatedAt: UPDATED_AT,
        gifts: [{
          id: '499',
          name: '旧礼物',
          priceRaw: 100,
          coinType: 'gold',
          active: true,
          isBlindBox: false,
        }],
        blindBoxes: [],
      }),
    );
    let calls = 0;
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      minRefreshMs: 5 * 60 * 1000,
      fetchRemote: async (request) => {
        calls += 1;
        assert.equal(request.etag, '"old"');
        return {
          ok: true,
          version: 'checked',
          updatedAt: UPDATED_AT,
          gifts: [
            { id: '498', name: '新礼物', priceRaw: 200, coinType: 'gold' },
          ],
        };
      },
    });
    const snapshot = await cache.refresh();
    assert.equal(calls, 1);
    assert.equal(snapshot.gifts[0].id, '498');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rejects an empty replacement and keeps the last usable remote snapshot', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-empty-'),
  );
  try {
    let call = 0;
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      minRefreshMs: 1,
      fetchRemote: async () => {
        call += 1;
        return call === 1
          ? {
              ok: true,
              version: '1',
              gifts: [
                {
                  id: '500',
                  name: '有效礼物',
                  priceRaw: 100,
                  coinType: 'gold',
                },
              ],
            }
          : { ok: true, version: '2', gifts: [] };
      },
    });
    await cache.refresh({ force: true });
    await assert.rejects(
      cache.refresh({ force: true }),
      (error) => error.code === 'REMOTE_CATALOG_EMPTY',
    );
    assert.deepEqual(
      cache.getSnapshot().gifts.map((gift) => gift.id),
      ['500'],
    );
    const persisted = JSON.parse(
      fs.readFileSync(path.join(dataDir, CACHE_FILE_NAME), 'utf8'),
    );
    assert.equal(persisted.version, '1');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('strictly normalizes remote booleans and binds restored image paths to the configured origin', async () => {
  assert.equal(
    normalizeRemoteCatalog({
      ok: true,
      version: 'bools',
      stale: 'false',
      sources: { gifts: { stale: 'false' } },
      gifts: [
        {
          id: '501',
          name: '礼物',
          priceRaw: 100,
          coinType: 'gold',
          bagGift: 'false',
        },
      ],
    }).gifts[0].bagGift,
    false,
  );

  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-origin-'),
  );
  try {
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      imageBaseUrl: 'https://api.one.example',
      fetchRemote: async () => ({
        ok: true,
        version: '1',
        imageBaseUrl: 'https://api.one.example',
        gifts: [
          {
            id: '502',
            name: '图片礼物',
            priceRaw: 100,
            coinType: 'gold',
            imageUrl: '/gift-media/images/a.webp',
          },
        ],
      }),
    });
    await cache.refresh({ force: true });
    const switched = createRemoteGiftCatalogCache({
      dataDir,
      imageBaseUrl: 'https://api.two.example',
      fetchRemote: async () => null,
    });
    assert.equal(switched.getSnapshot().gifts[0].imagePath, '');
    assert.throws(
      () =>
        createRemoteGiftCatalogCache({
          dataDir,
          imageBaseUrl: 'http://127.0.0.1:13000',
          fetchRemote: async () => null,
        }),
      /REMOTE_CATALOG_IMAGE_BASE_INVALID/,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('keeps nonnegative-price gold gifts in the local catalog', () => {
  const snapshot = normalizeRemoteCatalog({
    ok: true,
    version: 'nullable-price',
    gifts: [
      { id: '503', name: '银瓜子礼物', priceRaw: 25, coinType: 'silver' },
      { id: '504', name: '免费礼物', priceRaw: 0, coinType: 'gold' },
      {
        id: '505',
        name: '付费礼物',
        priceRaw: 100,
        coinType: 'gold',
        sourceUrl: 'https://i0.hdslb.com/bfs/live/paid.webp',
      },
    ],
  });
  assert.deepEqual(snapshot.gifts.map((gift) => gift.id), ['504', '505']);
  assert.equal(snapshot.gifts[0].priceRaw, 0);
  assert.equal(
    snapshot.gifts[1].sourceUrl,
    'https://i0.hdslb.com/bfs/live/paid.webp',
  );
});

test('retains the validated image origin when later snapshots omit the optional field', async () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-remote-catalog-origin-retain-'),
  );
  try {
    let call = 0;
    const cache = createRemoteGiftCatalogCache({
      dataDir,
      logger: QUIET_LOGGER,
      minRefreshMs: 1,
      imageBaseUrl: 'https://api.example.test',
      fetchRemote: async () => {
        call += 1;
        return {
          ok: true,
          version: String(call),
          gifts: [
            {
              id: '503',
              name: '持续图片',
              priceRaw: 100,
              coinType: 'gold',
              imageUrl: '/gift-media/images/cover.webp',
            },
          ],
        };
      },
    });
    const first = await cache.refresh({ force: true });
    const second = await cache.refresh({ force: true });
    assert.equal(
      first.gifts[0].imagePath,
      'https://api.example.test/gift-media/images/cover.webp',
    );
    assert.equal(
      second.gifts[0].imagePath,
      'https://api.example.test/gift-media/images/cover.webp',
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('hybrid catalog keeps local room catalog primary and exposes remote search separately', async () => {
  const calls = { local: 0, remote: 0, search: 0 };
  const local = {
    getSnapshot: () => ({
      source: 'local',
      gifts: [
        { id: '1', name: '同名礼物' },
        { id: '2', name: '同名礼物' },
      ],
    }),
    refresh: async () => {
      calls.local += 1;
      return local.getSnapshot();
    },
  };
  const remote = {
    getSnapshot: () => ({
      source: 'server',
      version: '1',
      gifts: [
        { id: '1', name: '同名礼物', imagePath: 'first.webp' },
        { id: '2', name: '同名礼物', imagePath: 'second.webp' },
        { id: '21', name: '服务器礼物', imagePath: '' },
        { id: '22', name: '另一个礼物', imagePath: '' },
      ],
    }),
    refresh: async () => {
      calls.remote += 1;
      calls.search += 1;
      return remote.getSnapshot();
    },
  };
  const hybrid = createHybridGiftSaleCatalogService({
    local,
    remoteCatalog: remote,
  });
  assert.deepEqual(await hybrid.refresh(), {
    source: 'local',
    gifts: [
      { id: '1', name: '同名礼物', imagePath: 'first.webp' },
      { id: '2', name: '同名礼物', imagePath: 'second.webp' },
    ],
    count: 2,
    cached: false,
  });
  assert.equal(calls.local, 1);
  assert.deepEqual(hybrid.getSnapshot(), {
    source: 'local',
    gifts: [
      { id: '1', name: '同名礼物', imagePath: 'first.webp' },
      { id: '2', name: '同名礼物', imagePath: 'second.webp' },
    ],
    count: 2,
    cached: true,
  });
  const search = await hybrid.searchRemote('服务器');
  assert.deepEqual(search.gifts.map((gift) => gift.id), ['21']);
  assert.equal(calls.remote, 1);
  assert.equal(calls.search, 1);
});

test('room expansion uses exact box ids and removes relation-only outputs', () => {
  const serverSnapshot = {
    gifts: [
      { id: '900', name: '同名盲盒', active: true },
      { id: '901', name: '同名盲盒', active: true },
      { id: '902', name: '有效产物', active: true },
      { id: '903', name: '停用产物', active: false },
    ],
    blindBoxes: [
      { giftId: '900', outputGiftIds: ['902', '903'] },
    ],
  };

  const wrongId = mergeRoomCatalog(
    { gifts: [{ id: '901', name: '同名盲盒' }] },
    serverSnapshot,
  );
  assert.deepEqual(wrongId.gifts.map((gift) => gift.id), ['901']);

  const expanded = mergeRoomCatalog(
    { gifts: [{ id: '900', name: '同名盲盒' }] },
    serverSnapshot,
  );
  assert.deepEqual(expanded.gifts.map((gift) => gift.id), ['900', '902']);

  const removed = mergeRoomCatalog(
    { gifts: [{ id: '900', name: '同名盲盒' }] },
    { ...serverSnapshot, blindBoxes: [] },
  );
  assert.deepEqual(removed.gifts.map((gift) => gift.id), ['900']);

  const independentlyPresent = mergeRoomCatalog(
    {
      gifts: [
        { id: '900', name: '同名盲盒' },
        { id: '902', name: '有效产物' },
      ],
    },
    { ...serverSnapshot, blindBoxes: [] },
  );
  assert.deepEqual(
    independentlyPresent.gifts.map((gift) => gift.id),
    ['900', '902'],
  );
});

test('hybrid server search reports unavailable when refresh has no cache', async () => {
  const hybrid = createHybridGiftSaleCatalogService({
    local: {
      getSnapshot: () => ({ source: 'local', gifts: [] }),
      refresh: async () => ({ source: 'local', gifts: [] }),
    },
    remoteCatalog: {
      getSnapshot: () => null,
      refresh: async () => null,
    },
  });
  await assert.rejects(
    hybrid.searchRemote('礼物'),
    /服务器礼物目录本地缓存尚不可用/,
  );
});
