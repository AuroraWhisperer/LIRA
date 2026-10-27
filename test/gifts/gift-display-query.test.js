'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('../helpers/gift-query-fixture');
const { getGiftHistory, getGiftSelection } = require('../../src/bilibili/gift/query-service');
const { scanTodayGifts } = require('../../public/js/shared/gift-feed-state.js');

test('conditional today scans read 5000 rows once and invalidate for time, source and row changes', async (t) => {
  const fx = createFixture();
  t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64));
  fx.setActiveSource(source.id);
  fx.context.now = () => '2026-09-02T00:00:00.000Z';
  fx.giftDb.exec('BEGIN');
  for (let index = 0; index < 5000; index++) fx.insertGift(source.id, `event-${index}`, { createdAt: '2026-09-01T17:00:00.000Z' });
  fx.insertGift(source.id, 'future', { createdAt: '2026-09-02T00:00:01.000Z' });
  fx.giftDb.exec('COMMIT');
  let requests = 0;
  let transferred = 0;
  const request = async (url) => {
    requests++;
    const options = Object.fromEntries(new URL(url, 'http://localhost').searchParams);
    const result = getGiftHistory(fx.context, { ...options, conditional: true });
    transferred += result.items.length;
    return result;
  };
  const scan = (previous) => scanTodayGifts({ request, day: '2026-09-02', previous, onRevision() {} });
  let result = await scan();
  const first = result;
  for (let index = 1; index < 20; index++) result = await scan(result);
  assert.equal(result.items, first.items);
  assert.equal(requests, 69);
  assert.equal(transferred, 5000);
  fx.giftDb.prepare('UPDATE gift_sync_state SET updated_at=? WHERE source_id=?').run('2026-09-02T00:00:00.500Z', source.id);
  assert.equal((await scan(result)).items, result.items, 'sync bookkeeping does not change gift contents');
  fx.context.now = () => '2026-09-02T00:00:02.000Z';
  result = await scan(result);
  assert.equal(result.items.length, 5001, 'the time boundary changes without a database write');
  fx.giftDb.prepare("UPDATE gift_events SET user_name='changed' WHERE platform_id='lira-server:event-0'").run();
  assert.equal((await scan(result)).items.find((item) => item.eventId === 'event-0').gift.userName, 'changed');
  const other = fx.resolveSource('b'.repeat(64));
  fx.setActiveSource(other.id);
  assert.equal((await scan(result)).items.length, 0);
});

test('conditional history versions do not acknowledge rollback, external commits or reopened stores', (t) => {
  const fx = createFixture();
  t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64));
  fx.setActiveSource(source.id);
  fx.insertGift(source.id, 'one');
  const options = { range: 'all', conditional: true };
  const first = getGiftHistory(fx.context, options);
  const known = { ...options, contentRevision: first.contentRevision };
  assert.equal(getGiftHistory(fx.context, known).unchanged, true);
  fx.giftDb.exec('BEGIN');
  fx.giftDb.exec("UPDATE gift_events SET user_name='rollback'");
  assert.throws(() => getGiftHistory(fx.context, known), /transaction within a transaction/);
  fx.giftDb.exec('ROLLBACK');
  assert.equal(getGiftHistory(fx.context, known).unchanged, true);
  const { DatabaseSync } = require('node:sqlite');
  const external = new DatabaseSync(fx.giftDb.prepare('PRAGMA database_list').all().find(row => row.name === 'main').file);
  try { external.exec("UPDATE gift_events SET user_name='external'"); }
  finally { external.close(); }
  assert.equal(getGiftHistory(fx.context, known).items[0].gift.userName, 'external');
  const { createGiftQueryStore } = require('../../src/storage/gift-query-store');
  fx.context.queryStore = createGiftQueryStore(fx.giftDb);
  assert.equal(getGiftHistory(fx.context, known).items.length, 1);
});

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
