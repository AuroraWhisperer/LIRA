'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CACHE_FILE_NAME } = require('../../src/bilibili/gift/remote-catalog-cache');
const { createRemoteLicenseClient } = require('../../src/electron/license/remote-license-client');
const { QUIET_LOGGER, UPDATED_AT, createRemoteGiftCatalogCache } = require('../helpers/remote-catalog-fixture');

const CATALOG_LIMIT = 32 * 1024 * 1024;

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

for (const [label, checkedAt] of [
  ['a future persisted check time', '2099-01-01T00:00:00.000Z'],
  ['a missing persisted check time', undefined],
]) {
  test(`${label} does not suppress the first refresh`, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-checked-'));
    try {
      fs.mkdirSync(path.join(dataDir, 'cache'), { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'cache', CACHE_FILE_NAME),
        JSON.stringify({
          etag: '"old"',
          schemaVersion: 2,
          version: 'old',
          updatedAt: UPDATED_AT,
          ...(checkedAt ? { checkedAt } : {}),
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
        now: () => Date.parse('2026-08-29T08:00:00.000Z'),
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
}

test('persists and notifies a relation-only catalog update', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-relations-'));
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
            giftCategory: 'blindBox',
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
    assert.deepEqual(cache.getSnapshot().blindBoxes, [{ giftId: '601', outputGiftIds: ['603'] }]);
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'cache', CACHE_FILE_NAME), 'utf8'));
    assert.deepEqual(persisted.blindBoxes, cache.getSnapshot().blindBoxes);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('retains the previous snapshot when a relation reference is invalid', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-invalid-relation-'));
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
            giftCategory: 'blindBox',
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-write-failure-'));
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
          {
            id: giftId,
            name: `礼物 ${giftId}`,
            priceRaw: 100,
            coinType: 'gold',
          },
        ],
      }),
    });

    await cache.refresh({ force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.writeFileSync(cacheDir, 'blocks cache writes');
    giftId = '622';

    await assert.rejects(cache.refresh({ force: true }), (error) => error.code === 'REMOTE_CATALOG_CACHE_WRITE_FAILED');
    assert.equal(cache.getGift('621').name, '礼物 621');
    assert.equal(cache.getGift('622'), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('does not persist or use a response-advertised image origin without configuration', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-untrusted-origin-'));
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
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'cache', CACHE_FILE_NAME), 'utf8'));
    assert.equal(persisted.imageBaseUrl, '');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rejects an empty replacement and keeps the last usable remote snapshot', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-empty-'));
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
    await assert.rejects(cache.refresh({ force: true }), (error) => error.code === 'REMOTE_CATALOG_EMPTY');
    assert.deepEqual(
      cache.getSnapshot().gifts.map((gift) => gift.id),
      ['500'],
    );
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'cache', CACHE_FILE_NAME), 'utf8'));
    assert.equal(persisted.version, '1');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('retains the validated image origin when later snapshots omit the optional field', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-origin-retain-'));
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
    assert.equal(first.gifts[0].imagePath, 'https://api.example.test/gift-media/images/cover.webp');
    assert.equal(second.gifts[0].imagePath, 'https://api.example.test/gift-media/images/cover.webp');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('catalog accepts exactly 32 MiB of UTF-8 JSON', async () => {
  const empty = JSON.stringify({ ok: true, padding: '' });
  const padding = ' '.repeat(CATALOG_LIMIT - Buffer.byteLength(empty));
  const body = JSON.stringify({ ok: true, padding });
  assert.equal(Buffer.byteLength(body), CATALOG_LIMIT);
  const client = createRemoteLicenseClient({ fetchImpl: async () => new Response(body) });
  assert.equal((await client.getGiftCatalog()).padding.length, padding.length);
});

test('over-limit streaming catalog is cancelled and the previous memory and disk catalog survive', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-catalog-capacity-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let overflow = false;
  let cancelled = false;
  let pulls = 0;
  const chunk = new Uint8Array(1024 * 1024).fill(32);
  const client = createRemoteLicenseClient({
    fetchImpl: async () => {
      if (!overflow)
        return new Response(
          JSON.stringify({
            ok: true,
            version: 'known-good',
            updatedAt: UPDATED_AT,
            gifts: [{ id: '1001', name: 'Saved gift', priceRaw: 1000, coinType: 'gold' }],
          }),
          { headers: { ETag: '"known-good"' } },
        );
      return new Response(
        new ReadableStream(
          {
            pull(controller) {
              pulls += 1;
              controller.enqueue(pulls <= 32 ? chunk : new Uint8Array([32]));
              if (pulls === 34) controller.close();
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
      );
    },
  });
  const cache = createRemoteGiftCatalogCache({
    dataDir,
    logger: QUIET_LOGGER,
    fetchRemote: ({ etag }) => client.getGiftCatalog(etag),
  });
  t.after(() => cache.stop());
  await cache.refresh({ force: true });
  const previous = cache.getSnapshot();
  const cachePath = path.join(dataDir, 'cache', CACHE_FILE_NAME);
  const persisted = fs.readFileSync(cachePath);
  overflow = true;
  await assert.rejects(cache.refresh({ force: true }), { code: 'RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, true);
  assert.equal(pulls, 33);
  assert.deepEqual(cache.getSnapshot(), previous);
  assert.deepEqual(fs.readFileSync(cachePath), persisted);
  assert.equal(cache.getGift('1001').name, 'Saved gift');
  overflow = false;
  await cache.refresh({ force: true });
  assert.equal(cache.getGift('1001').name, 'Saved gift');
});
