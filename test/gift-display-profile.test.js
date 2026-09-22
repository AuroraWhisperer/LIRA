'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./helpers/gift-query-fixture');
const { normalizeProcessedGiftEvent } = require('../src/shared/processed-gift-contract');
const { createGiftProjectionService } = require('../src/bilibili/gift');
const { getGiftHistory } = require('../src/bilibili/gift/query-service');

test('optional display v1 survives projection and repeated final deliveries without exposing viewer identity', (t) => {
  const fx = createFixture();
  t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64));
  fx.setActiveSource(source.id);
  const service = createGiftProjectionService(fx.context);
  t.after(() => service.dispose());
  const event = {
    eventId: 'profile-test',
    cursor: 1,
    phase: 'final',
    gift: {
      giftId: '1',
      giftName: '礼物',
      userName: '观众',
      num: 1,
      unitPrice: 100,
      totalPrice: 100,
      coinType: 'gold',
      isBlindBox: false,
      blindBoxId: null,
      blindBoxName: '',
      blindBoxPrice: null,
      blindProfit: null,
      createdAt: '2026-09-01T12:00:00Z',
      display: {
        version: 1,
        avatarUrl: 'https://i0.hdslb.com/bfs/face/test.webp',
        guardLevel: 3,
      },
    },
  };
  const normalized = normalizeProcessedGiftEvent(event);
  service.importProcessedEvent(normalized, source.id);
  service.importProcessedEvent(normalized, source.id);
  const history = getGiftHistory(fx.context, { range: 'all' });
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].gift.guardLevel, 3);
  assert.equal(history.items[0].gift.avatarUrl, event.gift.display.avatarUrl);
  const old = structuredClone(event);
  delete old.gift.display;
  assert.doesNotThrow(() => normalizeProcessedGiftEvent(old));
  for (const display of [
    { ...event.gift.display, version: 2 },
    { ...event.gift.display, guardLevel: 4 },
    { ...event.gift.display, avatarUrl: 'https://evil.invalid/image.png' },
    { ...event.gift.display, uid: '1' },
  ]) {
    assert.throws(() => normalizeProcessedGiftEvent({ ...event, gift: { ...event.gift, display } }));
  }
});
