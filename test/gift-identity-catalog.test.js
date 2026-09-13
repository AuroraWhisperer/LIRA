'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const fixture = require('../../lira-server/docs/protocol/fixtures/gift-catalog-variants.json');
const { createRemoteGiftCatalogCache, normalizeRemoteCatalog } = require('../src/bilibili/gift/remote-catalog-cache');
const { mergeRoomCatalog, createHybridGiftSaleCatalogService } = require('../src/bilibili/gift/hybrid-catalog');

test('schema 3 preserves same-ID gifts and relations through refresh, disk, and cloning', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-identity-catalog-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let response = structuredClone(fixture.response);
  const options = { dataDir, imageBaseUrl: 'https://api.example.test', logger: {},
    fetchRemote: async () => response };
  const cache = createRemoteGiftCatalogCache(options);
  t.after(() => cache.stop());
  const snapshot = await cache.refresh();
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.gifts.filter(gift => gift.id === '35429').length, 2);
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
  const snapshot = normalizeRemoteCatalog(fixture.response, { imageBaseUrl: 'https://api.example.test' });
  const autumn = snapshot.gifts.find(gift => gift.variantId === fixture.autumnVariantId);
  const qixi = snapshot.gifts.find(gift => gift.variantId === fixture.qixiVariantId);
  const merged = mergeRoomCatalog({ gifts: [{ ...autumn, variantId: undefined }] }, snapshot);
  assert.equal(merged.gifts[0].giftIdentity.variantId, autumn.variantId);
  assert.equal(merged.gifts.some(gift => gift.variantId === fixture.outputVariantId), false);
  const changed = mergeRoomCatalog({ gifts: [{ ...autumn, priceRaw: 20000 }] }, snapshot);
  assert.equal(changed.gifts[0].imagePath, '');
  assert.equal(changed.gifts[0].giftIdentity, undefined);
  const withOutputs = mergeRoomCatalog({ gifts: [qixi] }, snapshot);
  assert.equal(withOutputs.gifts.some(gift => gift.variantId === fixture.outputVariantId), true);
  const catalog = createHybridGiftSaleCatalogService({
    local: { getSnapshot: () => ({ gifts: [qixi] }), refresh: async () => ({ gifts: [qixi] }) },
    remoteCatalog: { getSnapshot: () => snapshot, refresh: async () => snapshot },
    remoteImageCache: { getCachedGiftImagePath: gift => gift.variantId },
  });
  assert.equal(catalog.resolveGiftImagePath('35429', '', { giftIdentity: autumn.giftIdentity }), autumn.variantId);
  assert.equal(catalog.resolveGiftImagePath('35429', '', { giftName: '中秋盲盒' }), '');
  catalog.getSnapshot().gifts[0].giftIdentity.priceRaw = -1;
  assert.equal(catalog.getSnapshot().gifts[0].giftIdentity.priceRaw, qixi.priceRaw);
  catalog.dispose();
});
