'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const test = require('node:test');
const { giftVariantId } = require('../../src/shared/gift-identity');

test('a provisional room gift and its official identity count as one historical artwork candidate', async () => {
  const gift = { id: '101', name: '花', priceRaw: 1000, coinType: 'gold', bagGift: false, imagePath: '' };
  const formal = { ...gift, variantId: giftVariantId(gift), imagePath: '/overtime-gift-images/flower.webp' };
  const withArt = { ...gift, id: '103', imagePath: '/overtime-gift-images/already-visible.webp' };
  const officialWithArt = { ...withArt, variantId: giftVariantId(withArt) };
  const gate = Promise.withResolvers();
  const [artwork, { eventBus, Events }] = await loadModuleExports([
    path.join(__dirname, '../../public/js/admin/gifts/artwork-catalog.js'),
    path.join(__dirname, '../../public/js/shared/event-bus.js'),
  ], { AbortController, window: { fetch: () => gate.promise } });
  const dispose = artwork.initGiftArtworkCatalog();
  const room = item => eventBus.emit(Events.GIFT_CATALOG_UPDATED, { snapshot: { roomId: '111', gifts: [item] } });
  room(gift);
  room(withArt);
  assert.equal(artwork.findGiftArtwork(withArt.id, withArt.name), withArt.imagePath);
  gate.resolve({ ok: true, json: async () => ({ data: { gifts: [formal, officialWithArt] } }) });
  await artwork.loadGiftArtworkCatalog();
  assert.equal(artwork.findGiftArtwork(withArt.id, withArt.name), withArt.imagePath);
  assert.equal(artwork.findGiftArtwork(gift.id, gift.name, formal.variantId), formal.imagePath);
  assert.equal(artwork.findGiftArtwork(gift.id, gift.name), formal.imagePath);
  room(gift);
  assert.equal(artwork.findGiftArtwork(gift.id, gift.name), formal.imagePath);
  room({ ...gift, priceRaw: 2000 });
  assert.equal(artwork.findGiftArtwork(gift.id, gift.name), '');
  assert.equal(artwork.findGiftArtwork(gift.id, gift.name, formal.variantId), formal.imagePath);
  const incomplete = { ...gift, id: '102', bagGift: null };
  room(incomplete);
  const complete = { ...gift, id: '102' };
  room({ ...complete, variantId: giftVariantId(complete), imagePath: formal.imagePath });
  assert.equal(artwork.findGiftArtwork('102', gift.name), '');
  dispose();
});

test('ordinary gifts containing a guard title keep their artwork and canonical guard IDs take priority', async () => {
  const { resolveGuardTier } = require('../../src/bilibili/gift/guard-thanks-config');
  const list = { classList: { toggle() {} }, querySelectorAll: () => [] };
  const [{ giftRecent }, artwork] = await loadModuleExports([
    path.join(__dirname, '../../public/js/admin/gifts/recent.js'),
    path.join(__dirname, '../../public/js/admin/gifts/artwork-catalog.js'),
  ], { document: { getElementById: () => list }, window: { getComputedStyle: () => ({ gridTemplateColumns: '1fr' }) } });
  const ordinary = { gift_id: '31036', gift_name: '舰长的祝福', coin_type: 'gold' };
  assert.equal(resolveGuardTier(ordinary), null);
  assert.equal(artwork.getGuardBadge(ordinary), null);
  assert.equal(artwork.getGuardBadge({ gift_id: 'guard-3', gift_name: '总督' }).level, 3);
  assert.equal(artwork.getGuardBadge({ gift_id: '34637', gift_name: '舰长一号' }).level, 3);
  assert.equal(artwork.getGuardBadge({ gift_id: 'guard-unknown', gift_name: '提督' }).level, 2);
  assert.equal(artwork.getGuardBadge({ gift_name: 'Prefect' }).level, 2);
  giftRecent.renderGiftRecentList([{ ...ordinary, unit_price: 1200, total_price: 1200, num: 1 }]);
  assert.match(list.innerHTML, /gift-high-value-icon/);
  assert.doesNotMatch(list.innerHTML, /guard-card|gift-guard-icon/);
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
    AbortController,
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
  const [{ giftRecent: recent }, { eventBus }, artwork] = await loadModuleExports([
    path.join(__dirname, '../../public/js/admin/gifts/recent.js'),
    path.join(__dirname, '../../public/js/shared/event-bus.js'),
    path.join(__dirname, '../../public/js/admin/gifts/artwork-catalog.js'),
  ],
    sandbox,
  );
  const { getGiftToastArtwork, getBlindBoxIcon } = artwork;
  artwork.initGiftArtworkCatalog();
  await artwork.loadGiftArtworkCatalog();
  const output = {
    is_blind_box: true,
    gift_id: '900',
    gift_name: '产物',
    blind_box_id: old.id,
    blind_box_name: old.name,
    blind_box_variant_id: old.variantId,
  };
  assert.equal(getBlindBoxIcon(output).src, old.imagePath);
  assert.equal(
    getBlindBoxIcon({
      ...output,
      blind_box_name: renamed.name,
      blind_box_variant_id: renamed.variantId,
    }).src,
    renamed.imagePath,
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
  eventBus.emit('gift:catalog_updated', {
    snapshot: {
      gifts: [
        { ...renamed, imagePath: '' },
        { ...repriced, imagePath: '/overtime-gift-images/repriced.png' },
      ],
    },
  });
  assert.equal(recent.getHighValueGiftArtwork(record).src, renamed.imagePath);
  assert.equal(
    getGiftToastArtwork({ ...record, gift_variant_id: repriced.variantId }),
    '/overtime-gift-images/repriced.png',
  );
  assert.equal(
    recent.getHighValueGiftArtwork({
      ...record,
      gift_variant_id: repriced.variantId,
    }).src,
    '/overtime-gift-images/repriced.png',
  );
});
