'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readServerFixture } = require('../scripts/verify-server-contract');
const fixture = readServerFixture('docs/protocol/fixtures/gift-catalog-variants.json');
const { giftVariantId } = require('../src/shared/gift-identity');
const { createRemoteGiftCatalogCache, normalizeRemoteCatalog } = require('../src/bilibili/gift/remote-catalog-cache');
const { mergeRoomCatalog } = require('../src/bilibili/gift/hybrid-catalog');

function sign(catalog) {
  const variants = catalog.variants.map(
    ({ firstSeenAt, lastSeenAt, firstSeenRunId, lastSeenRunId, ...gift }) => gift,
  );
  catalog.version = `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify({ variants, blindBoxes: catalog.blindBoxes })).digest('hex')}`;
  return catalog;
}

function categoryCatalog() {
  const catalog = structuredClone(fixture.response);
  catalog.variants = [catalog.variants[0], catalog.variants[1], catalog.variants[2],
    structuredClone(catalog.variants[0])].map((gift, index) => {
    const giftId = String(91001 + index);
    const name = ['第一个盒子', '共享产物', '直送礼物', '第二个盒子'][index];
    const updated = { ...gift, giftId, name,
      giftCategory: ['blindBox', 'blindBoxOutput', 'directGift', 'blindBox'][index],
      metadata: { ...gift.metadata, id: Number(giftId), name } };
    return { ...updated, variantId: giftVariantId(updated) };
  });
  catalog.count = catalog.variantCount = 4;
  catalog.blindBoxes = [0, 3].map(index => ({
    variantId: catalog.variants[index].variantId,
    outputVariantIds: [catalog.variants[1].variantId], awards: [],
  }));
  return sign(catalog);
}

test('all named categories and shared pools survive normalization, cache and restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-category-'));
  const options = { dataDir, logger: {}, fetchRemote: async () => categoryCatalog() };
  const cache = createRemoteGiftCatalogCache(options);
  t.after(() => { cache.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const snapshot = await cache.refresh();
  assert.deepEqual(snapshot.gifts.map(gift => gift.giftCategory),
    ['blindBox', 'blindBoxOutput', 'directGift', 'blindBox']);
  assert.ok(snapshot.gifts.every(gift => !Object.hasOwn(gift, 'isBlindBox')));
  assert.equal(snapshot.variantBlindBoxes.length, 2);
  const restarted = createRemoteGiftCatalogCache(options);
  t.after(() => restarted.stop());
  assert.deepEqual(restarted.getSnapshot().gifts, snapshot.gifts);
  const room = mergeRoomCatalog({ gifts: [{ ...snapshot.gifts[1], priceRaw: 1 }] }, snapshot);
  assert.equal(room.gifts[0].giftCategory, undefined);
});

test('missing, old numeric and contradictory categories never replace a successful snapshot', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-category-reject-'));
  let response = categoryCatalog();
  const cache = createRemoteGiftCatalogCache({ dataDir, logger: {}, fetchRemote: async () => response });
  t.after(() => { cache.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const original = await cache.refresh();
  const bytes = fs.readFileSync(cache.cachePath, 'utf8');
  const invalid = [0, 1, '0', '1', '0+1', null, undefined, 'unknown', 'blindBoxOutput'];
  for (const category of invalid) {
    response = categoryCatalog();
    response.variants[2].giftCategory = category;
    if (category === undefined) delete response.variants[2].giftCategory;
    sign(response);
    await assert.rejects(cache.refresh({ force: true }), /CATALOG_INVALID/);
    assert.equal(cache.getSnapshot().version, original.version);
    assert.equal(fs.readFileSync(cache.cachePath, 'utf8'), bytes);
  }
  for (const mutate of [
    value => { value.variants[1].giftCategory = 'directGift'; },
    value => { value.variants[0].giftCategory = 'directGift'; },
    value => { value.variants[2].isBlindBox = false; },
  ]) {
    response = categoryCatalog();
    mutate(response);
    sign(response);
    await assert.rejects(cache.refresh({ force: true }), /CATALOG_INVALID/);
    assert.equal(fs.readFileSync(cache.cachePath, 'utf8'), bytes);
  }
});

test('flat catalog uses the same enum and rejects contradictory pool membership', () => {
  const catalog = categoryCatalog();
  const flat = { schemaVersion: 2, version: 'category-fixture',
    gifts: catalog.variants.map(gift => ({ ...gift, id: gift.giftId, active: true })),
    blindBoxes: [{ giftId: '91001', outputGiftIds: ['91002'] }] };
  assert.equal(normalizeRemoteCatalog(flat).gifts[1].giftCategory, 'blindBoxOutput');
  flat.gifts[1].giftCategory = 'directGift';
  assert.throws(() => normalizeRemoteCatalog(flat), /REMOTE_CATALOG_BLIND_BOXES_INVALID/);
});
