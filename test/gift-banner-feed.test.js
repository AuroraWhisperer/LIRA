'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');
const {
  validateGiftDisplaySettings,
  readGiftDisplaySettings,
  DEFAULT_GIFT_DISPLAY,
} = require('../src/bilibili/gift/display-settings');

test('feed speed maps linearly from five seconds to a tenth of a second per row', async () => {
  const { giftFeedRowDurationMs } = await loadModuleExports(path.resolve('public/js/shared/gift-feed-state.js'));
  assert.equal(giftFeedRowDurationMs(1), 5000);
  assert.equal(giftFeedRowDurationMs(50), 100);
  for (let speed = 2; speed <= 50; speed += 1) {
    assert.ok(Math.abs(giftFeedRowDurationMs(speed - 1) - giftFeedRowDurationMs(speed) - 4900 / 49) < 1e-9);
  }
});

test('display settings validate speed and preserve saved colors and rows from legacy settings', () => {
  assert.equal(DEFAULT_GIFT_DISPLAY.scrollSpeed, 25);
  for (const scrollSpeed of [1, 26, 50]) {
    const config = { ...DEFAULT_GIFT_DISPLAY, scrollSpeed };
    assert.deepEqual(validateGiftDisplaySettings(config), config);
    assert.deepEqual(readGiftDisplaySettings({ giftDisplayConfig: JSON.stringify(config) }), config);
  }
  for (const scrollSpeed of [0, 51, 1.5, '25', null, undefined, NaN, Infinity]) {
    assert.throws(() => validateGiftDisplaySettings({ ...DEFAULT_GIFT_DISPLAY, scrollSpeed }));
  }
  const legacy = {
    palette: 'bilibili-four',
    thresholds: [100, 1000, 10000],
    visibleRows: 7,
    intervalSeconds: 4,
    paused: true,
    lowPower: true,
  };
  const expected = {
    palette: legacy.palette,
    thresholds: legacy.thresholds,
    visibleRows: 7,
    scrollSpeed: 1,
    minGiftAmountCents: 0,
  };
  assert.deepEqual(readGiftDisplaySettings({ giftDisplayConfig: JSON.stringify(legacy) }), expected);
  assert.deepEqual(validateGiftDisplaySettings(legacy), expected);
  assert.deepEqual(readGiftDisplaySettings({ giftDisplayConfig: 'broken' }), DEFAULT_GIFT_DISPLAY);
});

test('feed minimum defaults to zero for old settings and accepts only nonnegative tenths of a yuan', () => {
  assert.equal(DEFAULT_GIFT_DISPLAY.minGiftAmountCents, 0);
  const legacy = { palette: 'bilibili-four', thresholds: [100, 1000, 10000], visibleRows: 7, scrollSpeed: 31 };
  const normalized = { ...legacy, minGiftAmountCents: 0 };
  assert.deepEqual(validateGiftDisplaySettings(legacy), normalized);
  assert.deepEqual(readGiftDisplaySettings({ giftDisplayConfig: JSON.stringify(legacy) }), normalized);
  for (const minGiftAmountCents of [0, 10, 110, 1250, 100000]) {
    const config = { ...legacy, minGiftAmountCents };
    assert.deepEqual(validateGiftDisplaySettings(config), config);
    assert.deepEqual(readGiftDisplaySettings({ giftDisplayConfig: JSON.stringify(config) }), config);
  }
  for (const minGiftAmountCents of [-10, 1, 11, 1.5, '100', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateGiftDisplaySettings({ ...legacy, minGiftAmountCents }), /最小礼物金额/);
  }
});

test('price bands use each historical unit price times quantity, with exact boundaries', async () => {
  const { giftTier, giftExportPages, resolveGiftArtwork } = await loadModuleExports(
    path.resolve('public/js/shared/gift-banner.js'),
  );
  for (const [amount, expected] of [
    [29.99, 0],
    [30, 1],
    [99.99, 1],
    [100, 2],
    [999.99, 2],
    [1000, 3],
    [9999999, 3],
  ]) {
    assert.equal(giftTier({ unitPrice: amount, num: 1 }, DEFAULT_GIFT_DISPLAY.thresholds), expected);
  }
  assert.equal(giftTier({ unitPrice: 10, num: 100, totalPrice: 10 }, DEFAULT_GIFT_DISPLAY.thresholds), 3);
  assert.deepEqual(
    Array.from(giftExportPages(Array(40).fill({}), 'combined'), (page) => page.length),
    [39, 1],
  );
  const entries = [
    { id: '1', name: '礼物', variantId: 'a', imagePath: '/overtime-gift-images/a.webp' },
    { id: '1', name: '礼物', variantId: 'b', imagePath: '/overtime-gift-images/b.webp' },
  ];
  assert.equal(
    resolveGiftArtwork({ giftId: '1', giftName: '礼物', giftVariantId: 'b' }, entries),
    entries[1].imagePath,
  );
  assert.equal(resolveGiftArtwork({ giftId: '1', giftName: '礼物' }, entries), '/img/gift-placeholder.png');
  for (const thresholds of [
    [0, 100, 200],
    [100, 100, 200],
    [200, 100, 300],
    [1.5, 200, 300],
  ]) {
    assert.throws(() => validateGiftDisplaySettings({ ...DEFAULT_GIFT_DISPLAY, thresholds }));
  }
});

test('guard purchases use bundled artwork for upstream IDs and never borrow the sender rank', async () => {
  const { resolveGiftArtwork } = await loadModuleExports(path.resolve('public/js/shared/gift-banner.js'));
  const guards = [
    { giftName: '总督', role: 'governor', ids: ['guard-1', '10001', '33909', '34639'] },
    { giftName: '提督', role: 'prefect', ids: ['guard-2', '10002', '33908', '34638'] },
    { giftName: '舰长', role: 'captain', ids: ['guard-3', '10003', '34637', '33972', '33978', '34636'] },
  ];
  for (const { giftName, role, ids } of guards) {
    for (const giftId of ids) {
      assert.equal(
        resolveGiftArtwork({ giftId, giftName, coinType: 'guard', guardLevel: 1 }, []),
        `/img/admin/gifts/bilibili-guard-${role}.webp`,
      );
    }
  }
  assert.equal(
    resolveGiftArtwork({ giftId: 'guard-3', giftName: '大航海' }, []),
    '/img/admin/gifts/bilibili-guard-captain.webp',
  );
  assert.equal(
    resolveGiftArtwork({ giftId: 'unknown', giftName: '大航海', coinType: 'guard', guardLevel: 3 }, []),
    '/img/gift-placeholder.png',
  );
  const ordinary = { giftId: '1', giftName: '舰长', coinType: 'gold', guardLevel: 3 };
  assert.equal(
    resolveGiftArtwork(ordinary, [{ id: '1', name: '舰长', imagePath: '/overtime-gift-images/ordinary.webp' }]),
    '/overtime-gift-images/ordinary.webp',
  );
});

test('feed scans every page, loops all events and keeps its current position on refresh', async () => {
  const { createGiftFeedState, scanTodayGifts, shanghaiToday } = await loadModuleExports(
    path.resolve('public/js/shared/gift-feed-state.js'),
    { URLSearchParams },
  );
  const records = Array.from({ length: 235 }, (_, id) => ({ eventId: String(id) }));
  let offset = 0;
  const result = await scanTodayGifts({
    day: '2026-09-18',
    onRevision: () => {},
    request: async () => {
      const items = records.slice(offset, (offset += 100));
      return { items, viewRevision: 'same', nextCursor: offset < records.length ? String(offset) : null };
    },
  });
  assert.equal(result.items.length, 235);
  const state = createGiftFeedState();
  state.replace(result.items);
  const seen = new Set();
  for (let i = 0; i < 235; i++) {
    seen.add(state.visible(3)[0].eventId);
    state.advance();
  }
  assert.equal(seen.size, 235);
  assert.equal(state.visible(3)[0].eventId, '0');
  state.advance(20);
  state.replace([...records, { eventId: 'new' }, records[0]]);
  assert.equal(state.visible(3)[0].eventId, '20');
  assert.equal(state.visible(3, true).length, 4);
  state.replace([records[0]]);
  assert.equal(state.visible(3, true).length, 1);
  assert.equal(shanghaiToday(Date.parse('2026-09-17T16:00:00Z')), '2026-09-18');
});
