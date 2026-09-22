'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getGiftHistory, getGiftStatistics } = require('../src/bilibili/gift/query-service');
const { createFixture } = require('./helpers/gift-query-fixture');

test('statistics use cents, canonical rows, active source and completeness state', () => {
  const fixture = createFixture();
  try {
    const sourceA = fixture.resolveSource('c'.repeat(64));
    const sourceB = fixture.resolveSource('d'.repeat(64));
    fixture.setActiveSource(sourceA.id, {
      syncState: 'LIVE',
      partial: false,
      dirty: false,
      epochValidated: true,
      syncedThroughCursor: 18,
      syncedAt: '2026-09-01T23:59:00.000Z',
    });
    fixture.insertGift(sourceA.id, 'ordinary', {
      giftId: 'ordinary',
      giftName: '普通礼物',
      num: 2,
      unitPrice: 0.5,
      totalPrice: 1,
      giftStatsEligible: 0,
    });
    fixture.insertGift(sourceA.id, 'known-box', {
      giftId: 'known',
      giftName: '盲盒礼物',
      blindBoxName: '星光盒',
      isBlindBox: true,
      totalPrice: 2.5,
      blindBoxPrice: 1.2,
    });
    fixture.insertGift(sourceA.id, 'unknown-box', {
      giftId: 'unknown',
      giftName: '未知成本礼物',
      blindBoxName: '星光盒',
      isBlindBox: true,
      totalPrice: 3,
      blindBoxPrice: null,
    });
    fixture.insertGift(sourceB.id, 'other-source', { totalPrice: 999 });
    fixture.insertGift(null, 'legacy', {
      cmd: 'SEND_GIFT',
      totalPrice: 999,
    });
    fixture.insertGift(sourceA.id, 'inactive', {
      status: 'deleted',
      totalPrice: 999,
    });

    const result = getGiftStatistics(fixture.context, { range: 'all' });
    assert.equal(result.partial, false);
    assert.equal(result.syncState, 'LIVE');
    assert.equal(result.syncedThroughCursor, 18);
    assert.deepEqual(result.summary, {
      eventCount: 3,
      itemCount: 4,
      totalPriceCents: 650,
      blindBoxEventCount: 2,
      blindBoxPriceCents: 120,
      blindBoxValueCents: 550,
      blindProfitCents: 130,
      blindBoxUnknownCostEventCount: 1,
    });
    assert.equal(result.timeZone, 'Asia/Shanghai');
    assert.equal(result.timeSeries.length, 1);
    assert.equal(result.timeSeries[0].totalPriceCents, 650);

    const boxOnly = getGiftStatistics(fixture.context, {
      query: '星光盒',
      range: 'all',
    });
    assert.equal(boxOnly.summary.eventCount, 2);
    assert.equal(boxOnly.summary.totalPriceCents, 550);

    fixture.setActiveSource(sourceA.id, {
      syncState: 'OFFLINE',
      partial: true,
      dirty: false,
      epochValidated: false,
    });
    assert.equal(getGiftStatistics(fixture.context, { range: 'all' }).partial, true);
    fixture.setActiveSource(null, { syncState: 'SOURCE_SWITCHING' });
    assert.throws(
      () => getGiftHistory(fixture.context, { range: 'all' }),
      (error) => error.code === 'GIFT_SOURCE_UNAVAILABLE',
    );
  } finally {
    fixture.close();
  }
});

test('statistics canonicalize top gifts and expose bounded full metrics', () => {
  const fixture = createFixture();
  try {
    const source = fixture.resolveSource('1'.repeat(64));
    fixture.setActiveSource(source.id, {
      syncState: 'LIVE',
      partial: false,
      dirty: false,
      epochValidated: true,
    });
    fixture.insertGift(source.id, 'canonical-a', {
      giftId: 'e\u0301',
      giftName: '星  光',
      totalPrice: 2,
      isBlindBox: true,
      blindBoxPrice: 1,
    });
    fixture.insertGift(source.id, 'canonical-b', {
      giftId: '\u00e9',
      giftName: '星 光',
      totalPrice: 3,
      isBlindBox: true,
      blindBoxPrice: 1,
    });
    for (let index = 0; index < 50; index += 1) {
      fixture.insertGift(source.id, `rank-${index}`, {
        giftId: `rank-${index}`,
        giftName: `排行 ${index}`,
        totalPrice: 1 + index / 100,
      });
    }

    const result = getGiftStatistics(fixture.context, { range: 'all' });
    assert.equal(result.topGifts.length, 50);
    assert.deepEqual(result.topGifts[0], {
      giftId: '\u00e9',
      giftName: '星 光',
      eventCount: 2,
      itemCount: 2,
      totalPriceCents: 500,
      blindBoxEventCount: 2,
      blindBoxUnknownCostEventCount: 0,
      blindBoxPriceCents: 200,
      blindBoxValueCents: 500,
      blindProfitCents: 300,
    });
    assert.deepEqual(result.timeSeries, [
      {
        bucketStart: '2026-08-31T16:00:00.000Z',
        ...result.summary,
      },
    ]);
  } finally {
    fixture.close();
  }
});

test('all-time statistics retain only the latest 240 Shanghai month buckets', () => {
  const fixture = createFixture();
  try {
    const source = fixture.resolveSource('2'.repeat(64));
    fixture.setActiveSource(source.id, {
      syncState: 'LIVE',
      partial: false,
      dirty: false,
      epochValidated: true,
    });
    fixture.giftDb.exec('BEGIN');
    try {
      for (let index = 0; index < 241; index += 1) {
        fixture.insertGift(source.id, `month-${index}`, {
          createdAt: new Date(Date.UTC(2006, 7 + index, 15, 4)).toISOString(),
        });
      }
      fixture.giftDb.exec('COMMIT');
    } catch (error) {
      fixture.giftDb.exec('ROLLBACK');
      throw error;
    }

    const result = getGiftStatistics(fixture.context, { range: 'all' });
    assert.equal(result.timeSeries.length, 240);
    assert.equal(result.timeSeries[0].bucketStart, '2006-08-31T16:00:00.000Z');
    assert.equal(result.timeSeries.at(-1).bucketStart, '2026-07-31T16:00:00.000Z');
    assert.deepEqual(
      Object.keys(result.timeSeries[0]).sort(),
      [
        'blindBoxEventCount',
        'blindBoxPriceCents',
        'blindBoxUnknownCostEventCount',
        'blindBoxValueCents',
        'blindProfitCents',
        'bucketStart',
        'eventCount',
        'itemCount',
        'totalPriceCents',
      ].sort(),
    );
  } finally {
    fixture.close();
  }
});

test('statistics fail closed on corrupt money, quantity, and aggregate overflow', () => {
  const fixture = createFixture();
  try {
    const source = fixture.resolveSource('3'.repeat(64));
    fixture.setActiveSource(source.id, {
      syncState: 'LIVE',
      partial: false,
      dirty: false,
      epochValidated: true,
    });
    fixture.insertGift(source.id, 'corrupt');
    const update = fixture.giftDb.prepare(`
      UPDATE gift_events
      SET total_price = ?, num = ?
      WHERE source_id = ? AND platform_id = 'lira-server:corrupt'
    `);

    update.run(0.001, 1, source.id);
    assert.throws(() => getGiftStatistics(fixture.context, { range: 'all' }));

    update.run(1, 1.5, source.id);
    assert.throws(() => getGiftStatistics(fixture.context, { range: 'all' }));

    update.run(1, Number.MAX_SAFE_INTEGER, source.id);
    fixture.insertGift(source.id, 'overflow');
    assert.throws(() => getGiftStatistics(fixture.context, { range: 'all' }), /INVALID_GIFT_STATISTICS_AGGREGATE/);
  } finally {
    fixture.close();
  }
});
