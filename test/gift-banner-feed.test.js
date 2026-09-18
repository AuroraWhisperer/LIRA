'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { validateGiftDisplaySettings, DEFAULT_GIFT_DISPLAY } = require('../src/bilibili/gift/display-settings');

test('price bands use each historical unit price times quantity, with exact boundaries', async () => {
  const { giftTier, giftExportPages, resolveGiftArtwork } = await loadModuleExports(path.resolve('public/js/shared/gift-banner.js'));
  for (const [amount, expected] of [[99.99, 0], [100, 1], [499.99, 1], [500, 2], [999.99, 2], [1000, 3], [9999999, 3]]) {
    assert.equal(giftTier({ unitPrice: amount, num: 1 }, DEFAULT_GIFT_DISPLAY.thresholds), expected);
  }
  assert.equal(giftTier({ unitPrice: 10, num: 100, totalPrice: 10 }, DEFAULT_GIFT_DISPLAY.thresholds), 3);
  assert.deepEqual(Array.from(giftExportPages(Array(40).fill({}), 'combined'), (page) => page.length), [39, 1]);
  const entries = [{ id: '1', name: '礼物', variantId: 'a', imagePath: '/overtime-gift-images/a.webp' }, { id: '1', name: '礼物', variantId: 'b', imagePath: '/overtime-gift-images/b.webp' }];
  assert.equal(resolveGiftArtwork({ giftId: '1', giftName: '礼物', giftVariantId: 'b' }, entries), entries[1].imagePath);
  assert.equal(resolveGiftArtwork({ giftId: '1', giftName: '礼物' }, entries), '/img/gift-placeholder.png');
  for (const thresholds of [[0, 100, 200], [100, 100, 200], [200, 100, 300], [1.5, 200, 300]]) {
    assert.throws(() => validateGiftDisplaySettings({ ...DEFAULT_GIFT_DISPLAY, thresholds }));
  }
});

test('feed scans every page, loops all events and keeps its current position on refresh', async () => {
  const { createGiftFeedState, scanTodayGifts, shanghaiToday } = await loadModuleExports(path.resolve('public/js/shared/gift-feed-state.js'), { URLSearchParams });
  const records = Array.from({ length: 235 }, (_, id) => ({ eventId: String(id) }));
  let offset = 0;
  const result = await scanTodayGifts({ day: '2026-09-18', onRevision: () => {}, request: async () => {
    const items = records.slice(offset, offset += 100);
    return { items, viewRevision: 'same', nextCursor: offset < records.length ? String(offset) : null };
  } });
  assert.equal(result.items.length, 235);
  const state = createGiftFeedState(); state.replace(result.items);
  const seen = new Set();
  for (let i = 0; i < 235; i++) { seen.add(state.visible(3)[0].eventId); state.advance(); }
  assert.equal(seen.size, 235);
  assert.equal(state.visible(3)[0].eventId, '0');
  state.advance(20); state.replace([...records, { eventId: 'new' }, records[0]]);
  assert.equal(state.visible(3)[0].eventId, '20');
  assert.equal(state.visible(3, true).length, 4);
  state.replace([records[0]]); assert.equal(state.visible(3, true).length, 1);
  assert.equal(shanghaiToday(Date.parse('2026-09-17T16:00:00Z')), '2026-09-18');
});
