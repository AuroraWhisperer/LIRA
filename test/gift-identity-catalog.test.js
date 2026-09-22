'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { readServerFixture } = require('../scripts/verify-server-contract');
const fixture = readServerFixture('docs/protocol/fixtures/gift-catalog-variants.json');
const { createRemoteGiftCatalogCache, normalizeRemoteCatalog } = require('../src/bilibili/gift/remote-catalog-cache');
const { mergeRoomCatalog, createHybridGiftSaleCatalogService } = require('../src/bilibili/gift/hybrid-catalog');

function largeArchive(size) {
  const response = structuredClone(fixture.response);
  const template = response.variants[0];
  const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  response.blindBoxes = [];
  response.variants = Array.from({ length: size }, (_, index) => {
    const name = `历史活动 ${index}`;
    return {
      ...template,
      name,
      giftCategory: 'directGift',
      isProjected: index === size - 1,
      metadata: { ...template.metadata, name },
      variantId: `gv_${hash([template.giftId, name, template.priceRaw, template.coinType, template.bagGift])}`,
    };
  }).sort((a, b) => a.variantId.localeCompare(b.variantId));
  response.count = 1;
  response.variantCount = size;
  response.version = `sha256:${hash({
    variants: response.variants.map(({ firstSeenAt, lastSeenAt, firstSeenRunId, lastSeenRunId, ...item }) => item),
    blindBoxes: [],
  })}`;
  return response;
}

test('complete archived catalogs cross 10000 identities without losing validation or persisted history', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-large-archive-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let response = largeArchive(10000);
  const options = { dataDir, imageBaseUrl: 'https://api.example.test', logger: {}, fetchRemote: async () => response };
  const cache = createRemoteGiftCatalogCache(options);
  t.after(() => cache.stop());
  assert.equal((await cache.refresh()).gifts.length, 10000);
  response = largeArchive(10001);
  const snapshot = await cache.refresh({ force: true });
  assert.equal(snapshot.gifts.length, 10001);
  assert.equal(new Set(snapshot.gifts.map((gift) => gift.variantId)).size, 10001);
  const saved = fs.readFileSync(cache.cachePath, 'utf8');
  const reopened = createRemoteGiftCatalogCache(options);
  t.after(() => reopened.stop());
  assert.equal(reopened.getSnapshot().gifts.length, 10001);
  for (const corrupt of [
    (value) => {
      value.variants[10000].name = '篡改身份';
    },
    (value) => {
      value.variantCount -= 1;
    },
    (value) => {
      value.variants[10000] = value.variants[0];
    },
  ]) {
    response = largeArchive(10001);
    corrupt(response);
    await assert.rejects(cache.refresh({ force: true }), /CATALOG_INVALID/);
    assert.equal(fs.readFileSync(cache.cachePath, 'utf8'), saved);
    assert.equal(cache.getSnapshot().gifts.length, 10001);
  }
});

test('schema 3 preserves same-ID gifts and relations through refresh, disk, and cloning', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-identity-catalog-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let response = structuredClone(fixture.response);
  const options = {
    dataDir,
    imageBaseUrl: 'https://api.example.test',
    logger: {},
    fetchRemote: async () => response,
  };
  const cache = createRemoteGiftCatalogCache(options);
  t.after(() => cache.stop());
  const snapshot = await cache.refresh();
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.gifts.filter((gift) => gift.id === '35429').length, 2);
  assert.equal(cache.getGift('35429'), null);
  assert.equal(cache.getGift('35429', fixture.qixiVariantId).name, '七夕盲盒');
  snapshot.gifts[0].giftIdentity.priceRaw = -1;
  assert.equal(cache.getSnapshot().gifts[0].giftIdentity.priceRaw, 9000);
  const bytes = fs.readFileSync(cache.cachePath, 'utf8');
  response = structuredClone(fixture.response);
  response.variants[0].priceRaw += 1;
  await assert.rejects(cache.refresh({ force: true }), /CATALOG_INVALID/);
  assert.equal(fs.readFileSync(cache.cachePath, 'utf8'), bytes);
  const restarted = createRemoteGiftCatalogCache(options);
  t.after(() => restarted.stop());
  assert.deepEqual(restarted.getSnapshot().gifts, cache.getSnapshot().gifts);
  assert.deepEqual(restarted.getSnapshot().variantBlindBoxes, fixture.response.blindBoxes);
});

test('room merge and rule artwork never substitute another name or price sharing the ID', () => {
  const snapshot = normalizeRemoteCatalog(fixture.response, {
    imageBaseUrl: 'https://api.example.test',
  });
  const autumn = snapshot.gifts.find((gift) => gift.variantId === fixture.autumnVariantId);
  const qixi = snapshot.gifts.find((gift) => gift.variantId === fixture.qixiVariantId);
  const merged = mergeRoomCatalog({ gifts: [{ ...autumn, variantId: undefined }] }, snapshot);
  assert.equal(merged.gifts[0].giftIdentity.variantId, autumn.variantId);
  assert.equal(
    merged.gifts.some((gift) => gift.variantId === fixture.outputVariantId),
    false,
  );
  const changed = mergeRoomCatalog({ gifts: [{ ...autumn, priceRaw: 20000 }] }, snapshot);
  assert.equal(changed.gifts[0].imagePath, '');
  assert.equal(changed.gifts[0].giftIdentity, undefined);
  const withOutputs = mergeRoomCatalog({ gifts: [qixi] }, snapshot);
  assert.equal(qixi.giftCategory, 'directGift');
  assert.equal(
    withOutputs.gifts.some((gift) => gift.variantId === fixture.outputVariantId),
    false,
  );
  const catalog = createHybridGiftSaleCatalogService({
    local: {
      getSnapshot: () => ({ gifts: [qixi] }),
      refresh: async () => ({ gifts: [qixi] }),
    },
    remoteCatalog: {
      getSnapshot: () => snapshot,
      refresh: async () => snapshot,
    },
    remoteImageCache: { getCachedGiftImagePath: (gift) => gift.variantId },
  });
  assert.equal(
    catalog.resolveGiftImagePath('35429', '', {
      giftIdentity: autumn.giftIdentity,
    }),
    autumn.variantId,
  );
  assert.equal(catalog.resolveGiftImagePath('35429', '', { giftName: '中秋盲盒' }), '');
  catalog.getSnapshot().gifts[0].giftIdentity.priceRaw = -1;
  assert.equal(catalog.getSnapshot().gifts[0].giftIdentity.priceRaw, qixi.priceRaw);
  catalog.dispose();
});
