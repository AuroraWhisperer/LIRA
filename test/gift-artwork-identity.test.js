'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { giftVariantId } = require('../src/shared/gift-identity');

test('recent gifts and source-box icons keep reused IDs and repriced identities separate', async () => {
  const makeGift = (name, priceRaw, image) => {
    const gift = { id: '32251', name, priceRaw, coinType: 'gold', bagGift: false,
      imagePath: image ? `/overtime-gift-images/${image}.webp` : '' };
    return { ...gift, variantId: giftVariantId(gift) };
  };
  const old = makeGift('心动盲盒', 5000, 'old-box');
  const renamed = makeGift('新上架礼物', 1200000, 'new-gift');
  const repriced = makeGift('新上架礼物', 1300000, '');
  let onUpdate;
  const sandbox = {
    window: { AdminApp: { utils: {}, eventBus: { on: (_event, handler) => {
      onUpdate = handler;
      return () => {};
    } } }, fetch: async () => ({ ok: true, json: async () => ({ ok: true,
      data: { gifts: [old, renamed, repriced] } }) }) },
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/admin/gifts/recent.js'), 'utf8');
  vm.runInNewContext(`const eventBus = window.AdminApp.eventBus;
    const Events = { GIFT_CATALOG_UPDATED: 'gift:catalog_updated' };
    const getLegacyAdminModules = () => window.AdminApp;
    ${fs.readFileSync(path.join(__dirname, '../public/js/shared/gift-image-fallback.js'), 'utf8').replace(/^export /gm, '')}
    ${source.replace(/^import .*?;\r?\n/gm, '')}`, sandbox);
  const recent = sandbox.window.AdminApp.gifts.recent;
  await recent.loadGiftArtworkCatalog();
  const output = { is_blind_box: true, gift_id: '900', gift_name: '产物',
    blind_box_id: old.id, blind_box_name: old.name, blind_box_variant_id: old.variantId };
  assert.equal(recent.getBlindBoxIcon(output).src, old.imagePath);
  assert.equal(recent.getBlindBoxIcon({ ...output, blind_box_name: renamed.name,
    blind_box_variant_id: renamed.variantId }).src, renamed.imagePath);
  assert.equal(recent.getBlindBoxIcon({ ...output, blind_box_name: renamed.name,
    blind_box_variant_id: renamed.variantId }).className, 'blind-box-default');
  const record = { gift_id: renamed.id, gift_name: renamed.name, unit_price: 1200,
    gift_variant_id: renamed.variantId };
  assert.equal(recent.getHighValueGiftArtwork(record).src, renamed.imagePath);
  assert.equal(recent.getHighValueGiftArtwork({ ...record, gift_variant_id: null }).src, '/img/gift-placeholder.png');
  assert.equal(recent.getHighValueGiftArtwork({ ...record, gift_variant_id: repriced.variantId }).src, '/img/gift-placeholder.png');
  onUpdate({ snapshot: { gifts: [{ ...renamed, imagePath: '' },
    { ...repriced, imagePath: '/overtime-gift-images/repriced.webp' }] } });
  assert.equal(recent.getHighValueGiftArtwork(record).src, renamed.imagePath);
  assert.equal(recent.getHighValueGiftArtwork({ ...record,
    gift_variant_id: repriced.variantId }).src, '/overtime-gift-images/repriced.webp');
});
