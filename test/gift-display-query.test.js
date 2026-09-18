'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./helpers/gift-query-fixture');
const { getGiftHistory, getGiftSelection } = require('../src/bilibili/gift/query-service');

test('Shanghai dates, independent names and today cover the full ledger before pagination', (t) => {
  const fx = createFixture(); t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64)); fx.setActiveSource(source.id);
  const records = [
    ['before', '2026-09-01T15:59:59.999Z'], ['start', '2026-09-01T16:00:00.000Z'],
    ['today', '2026-09-01T23:59:59.999Z'], ['future', '2026-09-02T00:00:00.000Z'],
  ];
  for (const [id, createdAt] of records) fx.insertGift(source.id, id, { createdAt, userName: '同名观众', giftName: '小礼物', giftStatsEligible: 0 });
  const options = { range: 'today', userQuery: '同名', giftQuery: '小礼', limit: 1 };
  const first = getGiftHistory(fx.context, options);
  assert.equal(first.total, 2);
  fx.context.now = () => '2026-09-03T01:00:00Z';
  const second = getGiftHistory(fx.context, { ...options, cursor: first.nextCursor });
  assert.equal(second.items[0].eventId, 'start');
  assert.equal(second.asOf, first.asOf);
  assert.throws(() => getGiftHistory(fx.context, { ...options, giftQuery: '不同', cursor: first.nextCursor }), { code: 'INVALID_GIFT_CURSOR' });
  const date = getGiftHistory(fx.context, { range: 'all', startDate: '2026-09-02', endDate: '2026-09-02' });
  assert.equal(date.total, 3);
  assert.throws(() => getGiftHistory(fx.context, { startDate: '2026-09-03', endDate: '2026-09-02' }), { code: 'INVALID_GIFT_FILTER' });
  assert.throws(() => getGiftHistory(fx.context, { startDate: '2026-02-30' }), { code: 'INVALID_GIFT_FILTER' });
});

test('selection freezes exact separate events, sorting and source generation', (t) => {
  const fx = createFixture(); t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64)); fx.setActiveSource(source.id);
  for (let i = 0; i < 130; i++) fx.insertGift(source.id, `gift-${i}`, { totalPrice: 3000 });
  const first = getGiftHistory(fx.context, { range: 'all', limit: 1 });
  const selection = getGiftSelection(fx.context, { viewRevision: first.viewRevision, eventIds: ['gift-0', 'gift-1'] });
  assert.deepEqual(selection.items.map((item) => item.eventId), ['gift-1', 'gift-0']);
  assert.equal(getGiftSelection(fx.context, { viewRevision: first.viewRevision }).items.length, 130);
  fx.insertGift(source.id, 'late');
  assert.equal(selection.items.length, 2);
  assert.throws(() => getGiftSelection(fx.context, { viewRevision: first.viewRevision, eventIds: ['missing'] }), { code: 'GIFT_VIEW_STALE' });
  fx.giftDb.prepare('UPDATE gift_sync_state SET projection_generation = projection_generation + 1 WHERE source_id = ?').run(source.id);
  assert.throws(() => getGiftSelection(fx.context, { viewRevision: first.viewRevision }), { code: 'GIFT_VIEW_STALE' });
  assert.throws(() => getGiftHistory(fx.context, { range: 'all', cursor: first.nextCursor }), { code: 'GIFT_VIEW_STALE' });
});
