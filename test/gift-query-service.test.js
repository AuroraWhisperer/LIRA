'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  closeDatabases,
  createDatabases,
} = require('../src/storage/database');
const { createGiftSyncStore } = require('../src/storage/gift-sync-store');
const {
  getGiftSnapshot,
  getGiftHistory,
  getGiftStatistics,
  getGiftSprintSnapshot,
  resetGiftSprintProgress,
  searchGifts,
} = require('../src/bilibili/gift/query-service');
const {
  getBlindBoxStats,
  getBlindBoxAnalysis,
} = require('../src/bilibili/gift/blind-box-analysis');

const AS_OF = '2026-09-02T00:00:00.000Z';

test('history query accepts only 1-100 normalized Unicode code points', () => {
  const fixture = createFixture();
  try {
    const source = fixture.resolveSource('0'.repeat(64));
    fixture.setActiveSource(source.id, {
      syncState: 'LIVE',
      partial: false,
      dirty: false,
      epochValidated: true,
    });

    assert.doesNotThrow(() =>
      getGiftHistory(fixture.context, { range: 'all' }),
    );
    for (const query of ['a'.repeat(100), '\ud83c\udf81'.repeat(100)]) {
      assert.doesNotThrow(() =>
        getGiftHistory(fixture.context, {
          query,
          range: 'all',
        }),
      );
    }
    for (const query of ['', ' \t ', 'a'.repeat(101), '\ud83c\udf81'.repeat(101)]) {
      assert.throws(
        () => getGiftHistory(fixture.context, { query, range: 'all' }),
        (error) => error.code === 'INVALID_GIFT_QUERY',
      );
    }
  } finally {
    fixture.close();
  }
});

test('active-source history searches literally and keyset-pages beyond 3000 rows', () => {
  const fixture = createFixture();
  try {
    const sourceA = fixture.resolveSource('a'.repeat(64));
    const sourceB = fixture.resolveSource('b'.repeat(64));
    fixture.setActiveSource(sourceA.id, {
      syncState: 'LIVE',
      partial: false,
      dirty: false,
      epochValidated: true,
    });

    fixture.giftDb.exec('BEGIN');
    try {
      for (let index = 0; index < 3005; index += 1) {
        fixture.insertGift(sourceA.id, `event-${index}`, {
          giftName: index === 2500 ? '星光%_盒' : `礼物 ${index}`,
          giftStatsEligible: 0,
        });
      }
      fixture.insertGift(sourceB.id, 'event-0', { giftName: '其他账号' });
      fixture.insertGift(null, 'legacy', {
        cmd: 'SEND_GIFT',
        giftName: '旧本地记录',
      });
      fixture.giftDb.exec('COMMIT');
    } catch (error) {
      fixture.giftDb.exec('ROLLBACK');
      throw error;
    }

    const literal = getGiftHistory(fixture.context, {
      query: '%_',
      range: 'all',
      limit: 100,
    });
    assert.equal(literal.items.length, 1);
    assert.equal(literal.items[0].gift.giftName, '星光%_盒');
    assert.equal(literal.partial, false);
    assert.equal(Object.hasOwn(literal, 'sourceId'), false);

    const ids = [];
    let cursor = null;
    do {
      const page = getGiftHistory(fixture.context, {
        range: 'all',
        limit: 100,
        cursor,
      });
      ids.push(...page.items.map((item) => item.eventId));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (cursor);

    assert.equal(ids.length, 3005);
    assert.equal(new Set(ids).size, 3005);
    assert.equal(ids.includes('legacy'), false);
    assert.equal(ids.includes('event-0'), true);
  } finally {
    fixture.close();
  }
});

test('history sorting is deterministic across keyset pages with stable totals', () => {
  const fixture = createFixture();
  try {
    const source = fixture.resolveSource('e'.repeat(64));
    fixture.setActiveSource(source.id, {
      syncState: 'LIVE',
      partial: false,
      dirty: false,
      epochValidated: true,
    });
    const rows = [
      {
        id: 'ordinary-old',
        giftId: 'ordinary-old',
        giftName: '普通礼物',
        totalPrice: 1,
        createdAt: '2026-08-28T12:00:00.000Z',
      },
      {
        id: 'guard-governor',
        giftId: 'guard-1',
        giftName: '总督',
        totalPrice: 3,
        createdAt: '2026-08-29T12:00:00.000Z',
      },
      {
        id: 'blind-loss',
        giftId: 'blind-loss',
        giftName: '盲盒礼物',
        totalPrice: 5,
        isBlindBox: true,
        blindBoxPrice: 20005,
        createdAt: '2026-08-30T12:00:00.000Z',
      },
      {
        id: 'guard-captain',
        giftId: 'guard-3',
        giftName: '舰长',
        totalPrice: 2,
        createdAt: '2026-08-31T12:00:00.000Z',
      },
      {
        id: 'guard-admiral',
        giftId: 'guard-2',
        giftName: '提督',
        totalPrice: 4,
        createdAt: '2026-09-01T12:00:00.000Z',
      },
    ];
    for (const row of rows) fixture.insertGift(source.id, row.id, row);

    const expectedBySort = {
      created_at: ['ordinary-old', 'guard-governor', 'blind-loss', 'guard-captain', 'guard-admiral'],
      gift_name: ['guard-governor', 'guard-admiral', 'ordinary-old', 'blind-loss', 'guard-captain'],
      price: ['ordinary-old', 'guard-captain', 'guard-governor', 'guard-admiral', 'blind-loss'],
      remarks: ['ordinary-old', 'blind-loss', 'guard-captain', 'guard-admiral', 'guard-governor'],
    };

    for (const sortField of Object.keys(expectedBySort)) {
      for (const sortDirection of ['asc', 'desc']) {
        const first = getGiftHistory(fixture.context, {
          range: 'all',
          limit: 2,
          sortField,
          sortDirection,
        });
        const second = first.nextCursor
          ? getGiftHistory(fixture.context, {
              range: 'all',
              limit: 2,
              cursor: first.nextCursor,
              sortField,
              sortDirection,
            })
          : null;
        const third = second?.nextCursor
          ? getGiftHistory(fixture.context, {
              range: 'all',
              limit: 2,
              cursor: second.nextCursor,
              sortField,
              sortDirection,
            })
          : null;
        const ids = [
          ...first.items,
          ...(second?.items || []),
          ...(third?.items || []),
        ].map((item) => item.eventId);
        const expected =
          sortDirection === 'asc'
            ? expectedBySort[sortField]
            : [...expectedBySort[sortField]].reverse();
        assert.deepEqual(ids, expected);
        assert.equal(new Set(ids).size, rows.length);
        assert.equal(first.total, rows.length);
        assert.equal(first.totalPages, 3);
        assert.equal(second?.total, rows.length);
        assert.equal(third?.totalPages, 3);
      }
    }

    fixture.insertGift(source.id, 'same-price-first', {
      giftId: 'same-price-first',
      giftName: '同价',
      totalPrice: 2,
      createdAt: '2026-08-27T12:00:00.000Z',
    });
    fixture.insertGift(source.id, 'same-price-second', {
      giftId: 'same-price-second',
      giftName: '同价',
      totalPrice: 2,
      createdAt: '2026-08-27T12:00:00.000Z',
    });
    for (const sortDirection of ['asc', 'desc']) {
      const tiedPage = getGiftHistory(fixture.context, {
        query: '同价',
        range: 'all',
        limit: 1,
        sortField: 'price',
        sortDirection,
      });
      assert.deepEqual(
        tiedPage.items.map((item) => item.eventId),
        ['same-price-second'],
      );
      const tiedNext = getGiftHistory(fixture.context, {
        query: '同价',
        range: 'all',
        limit: 1,
        cursor: tiedPage.nextCursor,
        sortField: 'price',
        sortDirection,
      });
      assert.deepEqual(
        tiedNext.items.map((item) => item.eventId),
        ['same-price-first'],
      );
      assert.equal(tiedPage.total, 2);
      assert.equal(tiedPage.totalPages, 2);
    }
    const longUnicode = '🌟'.repeat(100);
    fixture.insertGift(source.id, 'long-unicode-first', {
      giftId: 'long-unicode-first',
      giftName: longUnicode,
      totalPrice: 7,
      createdAt: '2026-08-26T12:00:00.000Z',
    });
    fixture.insertGift(source.id, 'long-unicode-second', {
      giftId: 'long-unicode-second',
      giftName: longUnicode,
      totalPrice: 8,
      createdAt: '2026-08-25T12:00:00.000Z',
    });
    const longPage = getGiftHistory(fixture.context, {
      query: longUnicode,
      range: 'all',
      limit: 1,
      sortField: 'gift_name',
      sortDirection: 'asc',
    });
    assert.ok(longPage.nextCursor.length > 1024);
    assert.doesNotThrow(() =>
      getGiftHistory(fixture.context, {
        query: longUnicode,
        range: 'all',
        limit: 1,
        cursor: longPage.nextCursor,
        sortField: 'gift_name',
        sortDirection: 'asc',
      }),
    );

    const sorted = getGiftHistory(fixture.context, {
      range: 'all',
      limit: 2,
      sortField: 'gift_name',
      sortDirection: 'asc',
    });
    assert.throws(
      () =>
        getGiftHistory(fixture.context, {
          range: 'all',
          limit: 2,
          cursor: sorted.nextCursor,
          sortField: 'gift_name',
          sortDirection: 'desc',
        }),
      (error) => error.code === 'INVALID_GIFT_CURSOR',
    );
    assert.throws(
      () => getGiftHistory(fixture.context, { range: 'all', sortField: 'id' }),
      (error) => error.code === 'INVALID_GIFT_SORT_FIELD',
    );
    assert.throws(
      () =>
        getGiftHistory(fixture.context, {
          range: 'all',
          sortField: 'price',
          sortDirection: 'sideways',
        }),
      (error) => error.code === 'INVALID_GIFT_SORT_DIRECTION',
    );
  } finally {
    fixture.close();
  }
});

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
    assert.equal(
      getGiftStatistics(fixture.context, { range: 'all' }).partial,
      true,
    );
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
    assert.equal(
      result.timeSeries.at(-1).bucketStart,
      '2026-07-31T16:00:00.000Z',
    );
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
    assert.throws(() =>
      getGiftStatistics(fixture.context, { range: 'all' }),
    );

    update.run(1, 1.5, source.id);
    assert.throws(() =>
      getGiftStatistics(fixture.context, { range: 'all' }),
    );

    update.run(1, Number.MAX_SAFE_INTEGER, source.id);
    fixture.insertGift(source.id, 'overflow');
    assert.throws(
      () => getGiftStatistics(fixture.context, { range: 'all' }),
      /INVALID_GIFT_STATISTICS_AGGREGATE/,
    );
  } finally {
    fixture.close();
  }
});

test('legacy gift page reads and sprint reset stay within the active source', () => {
  const fixture = createFixture();
  try {
    const sourceA = fixture.resolveSource('e'.repeat(64));
    const sourceB = fixture.resolveSource('f'.repeat(64));
    const createdAt = new Date().toISOString();
    fixture.insertGift(sourceA.id, 'source-a', {
      giftName: '主播 A 礼物',
      userName: '主播 A 观众',
      totalPrice: 10,
      countedInSprint: 1,
      isBlindBox: true,
      blindBoxName: '主播 A 盲盒',
      blindBoxPrice: 4,
      createdAt,
    });
    fixture.insertGift(sourceB.id, 'source-b', {
      giftName: '主播 B 礼物',
      userName: '主播 B 观众',
      totalPrice: 20,
      countedInSprint: 1,
      isBlindBox: true,
      blindBoxName: '主播 B 盲盒',
      blindBoxPrice: 8,
      createdAt,
    });
    fixture.insertGift(null, 'legacy', {
      cmd: 'SEND_GIFT',
      giftName: '本地礼物',
      userName: '本地观众',
      totalPrice: 30,
      countedInSprint: 1,
      isBlindBox: true,
      blindBoxName: '本地盲盒',
      blindBoxPrice: 12,
      createdAt,
    });

    fixture.setActiveSource(sourceA.id);
    assert.deepEqual(readLegacyGiftPage(fixture.context), {
      recent: ['主播 A 礼物'],
      search: ['主播 A 礼物'],
      sprint: { receivedRmb: 10, countedGiftCount: 1 },
      blindBoxUsers: ['主播 A 观众'],
      blindBoxRecords: ['主播 A 礼物'],
    });

    fixture.setActiveSource(sourceB.id);
    assert.deepEqual(readLegacyGiftPage(fixture.context), {
      recent: ['主播 B 礼物'],
      search: ['主播 B 礼物'],
      sprint: { receivedRmb: 20, countedGiftCount: 1 },
      blindBoxUsers: ['主播 B 观众'],
      blindBoxRecords: ['主播 B 礼物'],
    });
    resetGiftSprintProgress(fixture.context);
    assert.deepEqual(
      fixture.giftDb
        .prepare(
          `
          SELECT source_id AS sourceId, counted_in_sprint AS counted
          FROM gift_events
          ORDER BY id ASC
        `,
        )
        .all()
        .map((row) => ({ ...row })),
      [
        { sourceId: sourceA.id, counted: 1 },
        { sourceId: sourceB.id, counted: 0 },
        { sourceId: null, counted: 1 },
      ],
    );

    fixture.setActiveSource(sourceA.id, { syncState: 'SOURCE_SWITCHING' });
    assert.deepEqual(readLegacyGiftPage(fixture.context), {
      recent: [],
      search: [],
      sprint: { receivedRmb: 0, countedGiftCount: 0 },
      blindBoxUsers: [],
      blindBoxRecords: [],
    });
    resetGiftSprintProgress(fixture.context);
    assert.equal(
      fixture.giftDb
        .prepare('SELECT counted_in_sprint FROM gift_events WHERE source_id = ?')
        .get(sourceA.id).counted_in_sprint,
      1,
    );

    fixture.setActiveSource(null, { syncState: 'OFFLINE' });
    assert.deepEqual(readLegacyGiftPage(fixture.context), {
      recent: [],
      search: [],
      sprint: { receivedRmb: 0, countedGiftCount: 0 },
      blindBoxUsers: [],
      blindBoxRecords: [],
    });
    resetGiftSprintProgress(fixture.context);
    assert.equal(
      fixture.giftDb
        .prepare('SELECT counted_in_sprint FROM gift_events WHERE source_id IS NULL')
        .get().counted_in_sprint,
      1,
    );

    fixture.clearActiveSource();
    assert.deepEqual(readLegacyGiftPage(fixture.context), {
      recent: ['本地礼物'],
      search: ['本地礼物'],
      sprint: { receivedRmb: 30, countedGiftCount: 1 },
      blindBoxUsers: ['本地观众'],
      blindBoxRecords: ['本地礼物'],
    });
  } finally {
    fixture.close();
  }
});

function readLegacyGiftPage(context) {
  const sprint = getGiftSprintSnapshot(context);
  const blindBoxStats = getBlindBoxStats(context);
  const blindBoxAnalysis = getBlindBoxAnalysis(context, {
    view: 'records',
    limit: 100,
  });
  return {
    recent: getGiftSnapshot(context).recent.map((row) => row.gift_name),
    search: searchGifts(context, {}).map((row) => row.gift_name),
    sprint: {
      receivedRmb: sprint.receivedRmb,
      countedGiftCount: sprint.countedGiftCount,
    },
    blindBoxUsers: blindBoxStats.perUser.map((row) => row.userName),
    blindBoxRecords: blindBoxAnalysis.items.map((row) => row.giftName),
  };
}

function createFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-query-'));
  const databases = createDatabases({ dataDir });
  const giftDb = databases.giftDb;
  const store = createGiftSyncStore({ giftDb, now: () => AS_OF });
  let activeSource = null;
  const insert = giftDb.prepare(`
    INSERT INTO gift_events (
      source_id, platform_id, cmd, gift_id, gift_name, user_name,
      num, unit_price, total_price, coin_type, is_blind_box,
      blind_box_name, blind_box_price, blind_profit,
      counted_in_sprint, detection_status, gift_stats_eligible,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return {
    databases,
    giftDb,
    context: {
      db: databases,
      now: () => AS_OF,
      settings: () => ({
        enableGiftSprint: 'true',
        giftSprintTargetRmb: 100,
      }),
      getActiveGiftSource: () => activeSource,
    },
    resolveSource: (sourceKey) => store.resolveSource(sourceKey),
    setActiveSource(sourceId, overrides = {}) {
      activeSource = {
        sourceId,
        syncState: 'BOOTSTRAPPING',
        partial: true,
        dirty: true,
        epochValidated: false,
        syncedThroughCursor: null,
        syncedAt: null,
        ...overrides,
      };
    },
    clearActiveSource() {
      activeSource = null;
    },
    insertGift(sourceId, eventId, overrides = {}) {
      const isBlindBox = overrides.isBlindBox === true;
      const totalPrice = overrides.totalPrice ?? 1;
      const blindBoxPrice = isBlindBox
        ? (overrides.blindBoxPrice ?? null)
        : null;
      return insert.run(
        sourceId,
        `lira-server:${eventId}`,
        overrides.cmd || 'LIRA_SERVER_GIFT',
        overrides.giftId || 'gift-1',
        overrides.giftName || '礼物',
        overrides.userName || '观众',
        overrides.num ?? 1,
        overrides.unitPrice ?? totalPrice,
        totalPrice,
        overrides.coinType || 'gold',
        isBlindBox ? 1 : 0,
        overrides.blindBoxName || '',
        blindBoxPrice,
        blindBoxPrice === null ? null : totalPrice - blindBoxPrice,
        overrides.countedInSprint ?? 0,
        overrides.detectionStatus || 'final',
        overrides.giftStatsEligible ?? 1,
        overrides.status || 'active',
        overrides.createdAt || '2026-09-01T12:00:00.000Z',
        overrides.updatedAt || '2026-09-01T12:00:00.000Z',
      );
    },
    close() {
      closeDatabases(databases);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
