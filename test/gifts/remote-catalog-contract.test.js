'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  normalizeImageBaseUrl,
  normalizeBilibiliImageUrl,
  normalizeImagePath,
  normalizeRemoteCatalog: normalizeRemoteCatalogImpl,
} = require('../../src/bilibili/gift/remote-catalog-cache');
const {
  createRemoteGiftCatalogCache,
  normalizeRemoteCatalog,
  v2CatalogResponse,
} = require('../helpers/remote-catalog-fixture');

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
  assert.equal(normalizeImagePath('/gift-media/images/../secret', 'https://api.lirahub.cn'), '');
  assert.equal(normalizeImagePath('/gift-media/images/nested/hash.webp', 'https://api.lirahub.cn'), '');
  assert.equal(normalizeImagePath('/gift-media/images/hash%2Ewebp', 'https://api.lirahub.cn'), '');
  assert.equal(normalizeImagePath('https://evil.example/a.webp', 'https://api.lirahub.cn'), '');
  assert.equal(normalizeImagePath('/gift-media/images/a.webp', 'http://evil.example'), '');
  assert.equal(normalizeImageBaseUrl('http://127.0.0.1:13000'), '');
  assert.equal(normalizeImageBaseUrl('https://localhost'), '');
  assert.equal(normalizeImageBaseUrl('https://127.0.0.1'), '');
  assert.equal(normalizeImageBaseUrl('https://[::1]'), '');
  assert.equal(normalizeImageBaseUrl('https://bad_host.example'), '');
  assert.equal(normalizeImageBaseUrl('https://api.lirahub.cn/path'), '');
  assert.equal(normalizeImagePath('https://api.lirahub.cn/gift-media/images/a.webp'), '');

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
      {
        id: '400',
        name: '第一条',
        priceRaw: 100,
        coinType: 'gold',
        sourceUrl: 'https://i0.hdslb.com/bfs/live/paid.webp',
      },
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
  assert.equal(snapshot.gifts[0].sourceUrl, 'https://i0.hdslb.com/bfs/live/paid.webp');
  assert.equal(snapshot.gifts[1].priceRaw, 0);
  assert.equal(
    normalizeBilibiliImageUrl('https://i0.hdslb.com/bfs/live/source.webp'),
    'https://i0.hdslb.com/bfs/live/source.webp',
  );
  assert.equal(normalizeBilibiliImageUrl('https://evil.example/source.webp'), '');
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
  invalidBlindBox.gifts[0].giftCategory = 1;
  assert.throws(
    () => normalizeRemoteCatalogImpl(invalidBlindBox),
    (error) => error.code === 'REMOTE_CATALOG_GIFT_INVALID',
  );
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

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-remote-catalog-origin-'));
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
