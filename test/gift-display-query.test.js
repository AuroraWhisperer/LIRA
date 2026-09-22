'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./helpers/gift-query-fixture');
const { getGiftHistory, getGiftSelection } = require('../src/bilibili/gift/query-service');

test('Shanghai dates, independent names and today cover the full ledger before pagination', (t) => {
  const fx = createFixture();
  t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64));
  fx.setActiveSource(source.id);
  const records = [
    ['before', '2026-09-01T15:59:59.999Z'],
    ['start', '2026-09-01T16:00:00.000Z'],
    ['today', '2026-09-01T23:59:59.999Z'],
    ['future', '2026-09-02T00:00:00.000Z'],
  ];
  for (const [id, createdAt] of records)
    fx.insertGift(source.id, id, { createdAt, userName: '同名观众', giftName: '小礼物', giftStatsEligible: 0 });
  const options = { range: 'today', userQuery: '同名', giftQuery: '小礼', limit: 1 };
  const first = getGiftHistory(fx.context, options);
  assert.equal(first.total, 2);
  fx.context.now = () => '2026-09-03T01:00:00Z';
  const second = getGiftHistory(fx.context, { ...options, cursor: first.nextCursor });
  assert.equal(second.items[0].eventId, 'start');
  assert.equal(second.asOf, first.asOf);
  assert.throws(() => getGiftHistory(fx.context, { ...options, giftQuery: '不同', cursor: first.nextCursor }), {
    code: 'INVALID_GIFT_CURSOR',
  });
  const date = getGiftHistory(fx.context, { range: 'all', startDate: '2026-09-02', endDate: '2026-09-02' });
  assert.equal(date.total, 3);
  assert.throws(() => getGiftHistory(fx.context, { startDate: '2026-09-03', endDate: '2026-09-02' }), {
    code: 'INVALID_GIFT_FILTER',
  });
  assert.throws(() => getGiftHistory(fx.context, { startDate: '2026-02-30' }), { code: 'INVALID_GIFT_FILTER' });
});

test('selection freezes exact separate events, sorting and source generation', (t) => {
  const fx = createFixture();
  t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64));
  fx.setActiveSource(source.id);
  for (let i = 0; i < 130; i++) fx.insertGift(source.id, `gift-${i}`, { totalPrice: 3000 });
  const first = getGiftHistory(fx.context, { range: 'all', limit: 1 });
  const selection = getGiftSelection(fx.context, { viewRevision: first.viewRevision, eventIds: ['gift-0', 'gift-1'] });
  assert.deepEqual(
    selection.items.map((item) => item.eventId),
    ['gift-1', 'gift-0'],
  );
  assert.equal(getGiftSelection(fx.context, { viewRevision: first.viewRevision }).items.length, 130);
  fx.insertGift(source.id, 'late');
  assert.equal(selection.items.length, 2);
  assert.throws(() => getGiftSelection(fx.context, { viewRevision: first.viewRevision, eventIds: ['missing'] }), {
    code: 'GIFT_VIEW_STALE',
  });
  fx.giftDb
    .prepare('UPDATE gift_sync_state SET projection_generation = projection_generation + 1 WHERE source_id = ?')
    .run(source.id);
  assert.throws(() => getGiftSelection(fx.context, { viewRevision: first.viewRevision }), { code: 'GIFT_VIEW_STALE' });
  assert.throws(() => getGiftHistory(fx.context, { range: 'all', cursor: first.nextCursor }), {
    code: 'GIFT_VIEW_STALE',
  });
});

test('amount threshold filters record totals strictly before pagination and selection', (t) => {
  const fx = createFixture();
  t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64));
  fx.setActiveSource(source.id);
  const otherSource = fx.resolveSource('b'.repeat(64));
  for (const [id, totalPrice] of [
    ['below', 9.99],
    ['equal', 10],
    ['above', 10.01],
    ['batch', 20],
  ]) {
    fx.insertGift(source.id, id, {
      totalPrice,
      unitPrice: id === 'batch' ? 1 : totalPrice,
      num: id === 'batch' ? 20 : 1,
      userName: '小明',
      giftName: '小礼物',
    });
  }
  fx.insertGift(source.id, 'other-user', { totalPrice: 100, userName: '小红', giftName: '小礼物' });
  fx.insertGift(otherSource.id, 'other-source', { totalPrice: 100, userName: '小明', giftName: '小礼物' });
  const options = { range: 'all', amountAbove: '10.00', userQuery: '小明', giftQuery: '小礼', limit: 1 };
  const first = getGiftHistory(fx.context, options);
  assert.equal(first.total, 2);
  assert.equal(first.totalPages, 2);
  assert.equal(first.items[0].eventId, 'batch');
  const second = getGiftHistory(fx.context, { ...options, amountAbove: 10, cursor: first.nextCursor });
  assert.equal(second.items[0].eventId, 'above');
  assert.equal(second.total, 2);
  assert.equal(second.hasMore, false);
  assert.throws(() => getGiftHistory(fx.context, { ...options, amountAbove: 9, cursor: first.nextCursor }), {
    code: 'INVALID_GIFT_CURSOR',
  });
  const selectionOptions = { ...options, viewRevision: first.viewRevision };
  assert.deepEqual(
    getGiftSelection(fx.context, selectionOptions).items.map((item) => item.eventId),
    ['batch', 'above'],
  );
  assert.throws(() => getGiftSelection(fx.context, { ...selectionOptions, eventIds: ['equal'] }), {
    code: 'GIFT_VIEW_STALE',
  });
  assert.equal(getGiftSelection(fx.context, { ...selectionOptions, eventIds: ['above'] }).items.length, 1);
  assert.equal(getGiftHistory(fx.context, { ...options, amountAbove: '' }).total, 4);
  assert.equal(getGiftHistory(fx.context, { ...options, amountAbove: 0 }).total, 4);
  assert.equal(getGiftHistory(fx.context, { ...options, amountAbove: 100 }).total, 0);
  assert.equal(getGiftHistory(fx.context, { ...options, amountAbove: '10.01' }).total, 1);
});

test('amount thresholds validate money and preserve cursors without a threshold', (t) => {
  const fx = createFixture();
  t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64));
  fx.setActiveSource(source.id);
  fx.insertGift(source.id, 'first');
  fx.insertGift(source.id, 'second');
  const first = getGiftHistory(fx.context, { range: 'all', limit: 1 });
  const payload = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString());
  assert.deepEqual(payload.filters, { startDate: '', endDate: '', userQuery: '', giftQuery: '' });
  assert.equal(
    getGiftHistory(fx.context, { range: 'all', limit: 1, amountAbove: '', cursor: first.nextCursor }).items.length,
    1,
  );
  for (const amountAbove of [-1, 'NaN', Infinity, '0.001', '1 OR 1=1', {}, [], true, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => getGiftHistory(fx.context, { amountAbove }), { code: 'INVALID_GIFT_FILTER' });
    assert.throws(() => getGiftSelection(fx.context, { amountAbove, viewRevision: first.viewRevision }), {
      code: 'INVALID_GIFT_FILTER',
    });
  }
});
