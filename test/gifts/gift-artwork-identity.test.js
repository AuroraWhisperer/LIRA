'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const test = require('node:test');
const { giftVariantId } = require('../../src/shared/gift-identity');

test('high-value artwork skips catalog lookup below the unit-price threshold and for invalid prices', async () => {
  let lookups = 0;
  class CountingMap extends Map {
    get(key) { lookups += 1; return super.get(key); }
    values() { lookups += 1; return super.values(); }
  }
  const { giftRecent } = await loadModuleExports(path.join(__dirname, '../../public/js/admin/gifts/recent.js'), {
    Map: CountingMap,
    window: {
      fetch: async () => ({
        ok: true,
        json: async () => ({ data: { gifts: [
          { id: '1', variantId: 'one', name: '礼物', imagePath: '/overtime-gift-images/one.webp' },
        ] } }),
      }),
    },
  });
  await giftRecent.loadGiftArtworkCatalog();
  lookups = 0;
  for (const unit_price of [0, 1, 999.99, NaN, Infinity, -Infinity, undefined, 'invalid']) {
    for (const gift_variant_id of [undefined, 'one']) {
      assert.equal(giftRecent.getHighValueGiftArtwork({
        gift_id: '1', gift_name: '礼物', gift_variant_id, unit_price, total_price: 5000,
      }), null);
    }
  }
  assert.equal(lookups, 0);
  assert.equal(giftRecent.getHighValueGiftArtwork({
    gift_id: '1', gift_name: '礼物', unit_price: 1000,
  }).src, '/overtime-gift-images/one.webp');
  assert.equal(giftRecent.getHighValueGiftArtwork({ unit_price: 1000 }).src, '/img/gift-placeholder.png');
});

test('name-based artwork lookup resolves through the catalog index without rescanning it per row', async () => {
  let scans = 0;
  class CountingMap extends Map {
    values() { scans += 1; return super.values(); }
    [Symbol.iterator]() { scans += 1; return super[Symbol.iterator](); }
  }
  const sandbox = {
    Map: CountingMap,
    window: {
      fetch: async () => ({
        ok: true,
        json: async () => ({ data: { gifts: [
          { id: '1', name: '礼物', imagePath: '/overtime-gift-images/one.webp' },
        ] } }),
      }),
    },
  };
  const { getGiftToastArtwork, giftRecent } = await loadModuleExports(
    path.join(__dirname, '../../public/js/admin/gifts/recent.js'),
    sandbox,
  );
  await giftRecent.loadGiftArtworkCatalog();
  scans = 0;
  for (let row = 0; row < 5; row += 1) {
    assert.equal(getGiftToastArtwork({ gift_id: '1', gift_name: '礼物' }), '/overtime-gift-images/one.webp');
  }
  assert.equal(scans, 0);
  assert.equal(getGiftToastArtwork({ gift_id: '1', gift_name: '不存在的礼物' }), '');
  assert.equal(scans, 0);
});

test('recent gifts and source-box icons keep reused IDs and repriced identities separate', async () => {
  const makeGift = (name, priceRaw, image) => {
    const gift = {
      id: '32251',
      name,
      priceRaw,
      coinType: 'gold',
      bagGift: false,
      imagePath: image ? `/overtime-gift-images/${image}.webp` : '',
    };
    return { ...gift, variantId: giftVariantId(gift) };
  };
  const old = makeGift('心动盲盒', 5000, 'old-box');
  const renamed = makeGift('新上架礼物', 1200000, 'new-gift');
  const repriced = makeGift('新上架礼物', 1300000, '');
  const sandbox = {
    window: {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: { gifts: [old, renamed, repriced] },
        }),
      }),
    },
  };
  const { getGiftToastArtwork, giftRecent: recent } = await loadModuleExports(
    path.join(__dirname, '../../public/js/admin/gifts/recent.js'),
    sandbox,
  );
  await recent.loadGiftArtworkCatalog();
  const output = {
    is_blind_box: true,
    gift_id: '900',
    gift_name: '产物',
    blind_box_id: old.id,
    blind_box_name: old.name,
    blind_box_variant_id: old.variantId,
  };
  assert.equal(recent.getBlindBoxIcon(output).src, old.imagePath);
  assert.equal(
    recent.getBlindBoxIcon({
      ...output,
      blind_box_name: renamed.name,
      blind_box_variant_id: renamed.variantId,
    }).src,
    renamed.imagePath,
  );
  assert.equal(
    recent.getBlindBoxIcon({
      ...output,
      blind_box_name: renamed.name,
      blind_box_variant_id: renamed.variantId,
    }).className,
    'blind-box-default',
  );
  const record = {
    gift_id: renamed.id,
    gift_name: renamed.name,
    unit_price: 1200,
    gift_variant_id: renamed.variantId,
  };
  assert.equal(recent.getHighValueGiftArtwork(record).src, renamed.imagePath);
  assert.equal(getGiftToastArtwork(record), renamed.imagePath);
  assert.equal(getGiftToastArtwork({ ...record, gift_variant_id: null }), '');
  assert.equal(getGiftToastArtwork({ ...record, gift_variant_id: repriced.variantId }), '');
  assert.equal(
    getGiftToastArtwork({ gift_id: 'guard-3', coin_type: 'guard', gift_name: '舰长' }),
    '/img/admin/gifts/bilibili-guard-captain.webp',
  );
  assert.equal(recent.getHighValueGiftArtwork({ ...record, gift_variant_id: null }).src, '/img/gift-placeholder.png');
  assert.equal(
    recent.getHighValueGiftArtwork({
      ...record,
      gift_variant_id: repriced.variantId,
    }).src,
    '/img/gift-placeholder.png',
  );
  sandbox.window.AdminApp.eventBus.emit('gift:catalog_updated', {
    snapshot: {
      gifts: [
        { ...renamed, imagePath: '' },
        { ...repriced, imagePath: '/overtime-gift-images/repriced.webp' },
      ],
    },
  });
  assert.equal(recent.getHighValueGiftArtwork(record).src, renamed.imagePath);
  assert.equal(
    getGiftToastArtwork({ ...record, gift_variant_id: repriced.variantId }),
    '/overtime-gift-images/repriced.webp',
  );
  assert.equal(
    recent.getHighValueGiftArtwork({
      ...record,
      gift_variant_id: repriced.variantId,
    }).src,
    '/overtime-gift-images/repriced.webp',
  );
});
