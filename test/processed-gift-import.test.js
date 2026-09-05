'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createGiftConsumerRegistry,
  createGiftDetectionService,
  createGiftService,
  createGiftStatisticsConsumer,
} = require('../src/bilibili/gift');
const { buildGiftFrameEvent } = require('../src/bilibili/gift/frame-config');
const {
  createOvertimeConsumer,
  createOvertimeService,
} = require('../src/overtime');
const {
  closeDatabases,
  createDatabases,
} = require('../src/storage/database');
const { createGiftSyncStore } = require('../src/storage/gift-sync-store');
const {
  canonicalCoinType,
  canonicalGiftId,
  canonicalGiftText,
  normalizeProcessedGiftEvent,
  normalizeProcessedGiftHistoryPage,
  normalizeProcessedGiftPage,
} = require('../src/shared/processed-gift-contract');

const giftSyncFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../lira-server/docs/protocol/fixtures/gift-sync-v1.json',
    ),
    'utf8',
  ),
);

test('processed server progress stays pending until the matching server final', () => {
  const fixture = createFixture();
  try {
    const progress = fixture.importProcessedEvent(
      makeEvent('progress', null, { num: 1, totalPrice: 0.1 }),
    );
    assert.equal(progress.detection_status, 'progress');
    assert.equal(progress.platform_id, 'lira-server:gift-event-1');
    assert.equal(progress.cmd, 'LIRA_SERVER_GIFT');
    assert.equal(progress.uid, '');
    assert.equal(progress.raw_json, '');
    assert.equal(progress.gift_stats_eligible, 1);
    assert.equal(progress.overtime_epoch, 7);
    assert.deepEqual(fixture.events.map((event) => event.phase), ['progress']);

    fixture.clock.advance(30_000);
    fixture.detection.flushPending({ force: true });
    assert.equal(readGift(fixture.db, progress.id).detection_status, 'progress');

    const finalized = fixture.importProcessedEvent(
      makeEvent('final', 11, { num: 3, totalPrice: 0.3 }),
    );
    assert.equal(finalized.id, progress.id);
    assert.equal(finalized.detection_status, 'final');
    assert.equal(finalized.num, 3);
    assert.equal(finalized.total_price, 0.3);
    assert.equal(readGift(fixture.db, finalized.id).gift_stats_delivered, 1);
    assert.equal(readGift(fixture.db, finalized.id).counted_in_sprint, 1);
    assert.deepEqual(
      fixture.events.map((event) => event.phase),
      ['progress', 'final'],
    );
    assert.deepEqual(fixture.finalizedIds, [progress.id]);

    const replay = fixture.importProcessedEvent(
      makeEvent('final', 11, { num: 3, totalPrice: 0.3 }),
    );
    assert.equal(replay.id, progress.id);
    assert.deepEqual(
      fixture.events.map((event) => event.phase),
      ['progress', 'final'],
    );
    assert.deepEqual(fixture.finalizedIds, [progress.id]);
  } finally {
    fixture.close();
  }
});

test('processed final-only recovery imports once without synthesizing progress delivery', () => {
  const fixture = createFixture();
  try {
    const recoveredEvent = makeEvent('final', 12, {
      isBlindBox: true,
      blindBoxId: '35206',
      blindBoxPrice: 0.3,
      blindProfit: -0.2,
    });
    const finalized = fixture.importProcessedEvent(recoveredEvent);
    assert.equal(finalized.detection_status, 'final');
    assert.equal(finalized.is_blind_box, true);
    assert.equal(finalized.blind_box_id, '35206');
    assert.equal(finalized.blind_profit, -0.2);
    assert.deepEqual(fixture.events.map((event) => event.phase), ['final']);
    assert.deepEqual(fixture.finalizedIds, [finalized.id]);

    fixture.importProcessedEvent(recoveredEvent);
    assert.deepEqual(fixture.events.map((event) => event.phase), ['final']);
  } finally {
    fixture.close();
  }
});

test('processed events are retained when local gift consumers are disabled', () => {
  const fixture = createFixture({
    enableGiftSprint: 'false',
    getOvertimeEpoch: () => 0,
  });
  try {
    const imported = fixture.importProcessedEvent(
      makeEvent('final', 14),
    );
    assert.equal(imported.detection_status, 'final');
    assert.equal(imported.gift_stats_eligible, 0);
    assert.equal(imported.overtime_epoch, 0);
    assert.deepEqual(fixture.events.map((event) => event.phase), ['final']);
  } finally {
    fixture.close();
  }
});

test('processed final reaches existing statistics, overtime, history, snapshot, and frame consumers once', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-processed-gift-integration-'),
  );
  const db = createDatabases({ dataDir });
  const clock = createFakeClock(1_800_000_000_000);
  const settings = {
    enableGiftSprint: 'true',
    giftSprintTargetRmb: '10',
    giftFrameEnabled: 'true',
    giftFrameThresholdRmb: '0.1',
    giftFrameTheme: 'woodland-bloom',
  };
  const overtimeUpdates = [];
  const overtime = createOvertimeService({
    giftDb: db.giftDb,
    now: clock.now,
    monotonicNow: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onUpdate: (update) => overtimeUpdates.push(update),
  });
  const snapshots = [];
  const frames = [];
  const context = {
    db,
    settings: () => settings,
    state: { blindBoxCache: null },
    now: () => new Date(clock.now() + 1).toISOString(),
  };
  let gifts;

  try {
    overtime.act('enable');
    overtime.replaceRules([
      {
        giftId: '33988',
        giftName: '人气票',
        imagePath: '',
        mode: 'fixed',
        fixedSeconds: 60,
        quantityMode: 'group',
        enabled: true,
        sortOrder: 0,
      },
    ]);
    gifts = createGiftService(context, {
      consumers: [createOvertimeConsumer({ service: overtime })],
      getOvertimeEpoch: overtime.getCurrentEpoch,
      onGiftFlushed(row) {
        snapshots.push(gifts.getSnapshot());
        const frame = buildGiftFrameEvent(row, settings);
        if (frame) frames.push(frame);
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    const sourceId = createSource(db.giftDb, 'e'.repeat(64));
    gifts.setActiveSource({
      sourceId,
      syncState: 'LIVE',
      partial: false,
      dirty: false,
      epochValidated: true,
      syncedThroughCursor: 21,
      syncedAt: new Date(clock.now()).toISOString(),
    });
    gifts.importProcessedEvent(makeEvent('progress', null), sourceId);
    const finalized = gifts.importProcessedEvent(
      makeEvent('final', 21, { num: 3, totalPrice: 0.3 }),
      sourceId,
    );
    gifts.importProcessedEvent(
      makeEvent('final', 21, { num: 3, totalPrice: 0.3 }),
      sourceId,
    );

    assert.equal(gifts.getSprintSnapshot().receivedRmb, 0.3);
    assert.equal(gifts.getSprintSnapshot().countedGiftCount, 1);
    const history = gifts.getHistory({ range: 'all' });
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].eventId, 'gift-event-1');
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].recent[0].id, finalized.id);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, 'gift:frame');
    assert.equal(frames[0].giftEventId, finalized.id);
    assert.equal(overtime.getSnapshot().effectiveRemainingMs, 60_000);
    assert.equal(
      db.giftDb
        .prepare(
          'SELECT COUNT(*) AS count FROM overtime_settlements WHERE gift_event_id = ?',
        )
        .get(finalized.id).count,
      1,
    );
    assert.equal(
      overtimeUpdates.filter((update) => update.reason === 'gift').length,
      1,
    );
  } finally {
    gifts?.dispose();
    overtime.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('processed importer rejects malformed or privacy-sensitive transport shapes', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () =>
        fixture.importProcessedEvent({
          ...makeEvent('final', 1),
          eventId: '../tenant',
        }),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );
    assert.throws(
      () =>
        fixture.importProcessedEvent({
          ...makeEvent('final', 1),
          gift: { ...makeEvent('final', 1).gift, totalPrice: 0 },
        }),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );
    assert.throws(
      () =>
        fixture.importProcessedEvent({
          ...makeEvent('final', 1),
          gift: { ...makeEvent('final', 1).gift, totalPrice: 0.001 },
        }),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );

    const imported = fixture.importProcessedEvent({
      ...makeEvent('final', 13),
      uid: 'must-not-be-used',
      rawJson: '{"secret":true}',
      gift: {
        ...makeEvent('final', 13).gift,
        uid: 'must-not-be-used',
        rawJson: '{"secret":true}',
      },
    });
    assert.equal(imported.uid, '');
    assert.equal(imported.raw_json, '');
  } finally {
    fixture.close();
  }
});

test('processed live importer requires an explicit captured source', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => fixture.detection.importProcessedEvent(makeEvent('final', 15)),
      /REMOTE_GIFT_SOURCE_REQUIRED/,
    );
  } finally {
    fixture.close();
  }
});

test('live final replay compares the full canonical DTO and rolls back its page', () => {
  const fixture = createFixture();
  try {
    const originalEvent = {
      ...makeEvent('final', 7, {
        giftId: ' gift  id ',
        giftName: ' Cafe\u0301\u00a0 Gift ',
        userName: ' Alice\u00a0 Smith ',
        num: 2,
        totalPrice: 0.2,
        coinType: ' GOLD ',
        isBlindBox: true,
        blindBoxId: '32251',
        blindBoxName: ' Cafe\u0301  Box ',
        blindBoxPrice: 0.1,
        blindProfit: 0.1,
        createdAt: '2027-01-15T16:00:00+08:00',
      }),
      eventId: 'existing-final',
    };
    const canonicalReplay = {
      ...makeEvent('final', 7, {
        giftId: 'gift  id',
        giftName: 'Caf\u00e9 Gift',
        userName: 'Alice Smith',
        num: 2,
        totalPrice: 0.2,
        coinType: 'gold',
        isBlindBox: true,
        blindBoxId: '32251',
        blindBoxName: 'Caf\u00e9 Box',
        blindBoxPrice: 0.1,
        blindProfit: 0.1,
      }),
      eventId: 'existing-final',
    };
    const original = fixture.importProcessedEvent(originalEvent);
    fixture.events.length = 0;
    fixture.finalizedIds.length = 0;

    const replay = fixture.importProcessedEvent(canonicalReplay);
    assert.equal(replay.id, original.id);
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.finalizedIds, []);

    const store = createGiftSyncStore({
      giftDb: fixture.db.giftDb,
      importHistoryRecord() {},
      importLiveEvent(event, sourceId, importOptions) {
        return fixture.detection.importProcessedEvent(
          event,
          sourceId,
          importOptions,
        );
      },
    });
    store.commitHistoryPage({
      sourceId: fixture.sourceId,
      projectionGeneration: 1,
      records: [],
      nextPageToken: null,
      hasMore: false,
      recoveryCursor: 5,
      syncEpoch: 'epoch-1',
    });

    const conflictCases = [
      ['giftId', { giftId: 'different-id' }],
      ['giftName', { giftName: 'Different Gift' }],
      ['userName', { userName: 'Bob' }],
      ['num', { num: 3 }],
      ['unitPriceCents', { unitPrice: 0.2 }],
      [
        'totalPriceCents/blindProfitCents',
        { totalPrice: 0.3, blindProfit: 0.2 },
      ],
      ['coinType', { coinType: 'silver' }],
      [
        'isBlindBox',
        {
          isBlindBox: false,
          blindBoxId: null,
          blindBoxName: '',
          blindBoxPrice: null,
          blindProfit: null,
        },
      ],
      ['blindBoxId', { blindBoxId: '35206' }],
      ['blindBoxName', { blindBoxName: 'Different Box' }],
      [
        'blindBoxPriceCents',
        { blindBoxPrice: 0.05, blindProfit: 0.15 },
      ],
      [
        'createdAt',
        { createdAt: '2027-01-15T08:00:01.000Z' },
      ],
    ];
    const originalRow = readGift(fixture.db, original.id);
    for (const [field, giftOverrides] of conflictCases) {
      const conflict = structuredClone(canonicalReplay);
      conflict.cursor = 6;
      Object.assign(conflict.gift, giftOverrides);
      assert.throws(
        () =>
          store.commitCatchUpPage({
            sourceId: fixture.sourceId,
            projectionGeneration: 1,
            events: [conflict],
            nextCursor: 6,
            syncEpoch: 'epoch-1',
            validatedAt: '2026-09-01T01:00:00.000Z',
          }),
        /PROCESSED_GIFT_EVENT_CONFLICT/,
        field,
      );
      assert.equal(store.getState(fixture.sourceId).finalCursor, 5, field);
      assert.deepEqual(readGift(fixture.db, original.id), originalRow, field);
    }
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.finalizedIds, []);

    const insertedBeforeConflict = {
      ...makeEvent('final', 6),
      eventId: 'inserted-before-conflict',
    };
    const conflict = structuredClone(canonicalReplay);
    conflict.cursor = 7;
    conflict.gift.giftName = 'Different Gift';
    assert.throws(
      () =>
        store.commitCatchUpPage({
          sourceId: fixture.sourceId,
          projectionGeneration: 1,
          events: [insertedBeforeConflict, conflict],
          nextCursor: 7,
          syncEpoch: 'epoch-1',
          validatedAt: '2026-09-01T01:00:00.000Z',
        }),
      /PROCESSED_GIFT_EVENT_CONFLICT/,
    );
    assert.equal(store.getState(fixture.sourceId).finalCursor, 5);
    assert.equal(
      fixture.db.giftDb
        .prepare(
          `
          SELECT COUNT(*) AS count FROM gift_events
          WHERE source_id = ? AND platform_id = ?
        `,
        )
        .get(
          fixture.sourceId,
          'lira-server:inserted-before-conflict',
        ).count,
      0,
    );
    assert.deepEqual(readGift(fixture.db, original.id), originalRow);
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.finalizedIds, []);

    assert.equal(
      fixture.db.giftDb
        .prepare(
          `
          SELECT COUNT(*) AS count FROM gift_events
          WHERE source_id = ? AND cmd = 'LIRA_SERVER_GIFT'
        `,
        )
        .get(fixture.sourceId).count,
      1,
    );

    const committed = store.commitCatchUpPage({
      sourceId: fixture.sourceId,
      projectionGeneration: 1,
      events: [insertedBeforeConflict],
      nextCursor: 6,
      syncEpoch: 'epoch-1',
      validatedAt: '2026-09-01T01:00:00.000Z',
    });
    const committedRow = fixture.db.giftDb
      .prepare(
        `
        SELECT * FROM gift_events
        WHERE source_id = ? AND platform_id = ?
      `,
      )
      .get(
        fixture.sourceId,
        'lira-server:inserted-before-conflict',
      );
    assert.equal(committed.finalCursor, 6);
    assert.equal(committedRow.gift_stats_delivered, 1);
    assert.equal(committedRow.counted_in_sprint, 1);
    assert.deepEqual(
      fixture.events.map((event) => event.phase),
      ['final'],
    );
    assert.deepEqual(fixture.finalizedIds, [Number(committedRow.id)]);
  } finally {
    fixture.close();
  }
});

test('history-only importer persists a final projection without live side effects', () => {
  const fixture = createFixture();
  try {
    const record = makeHistoryRecord({
      giftName: ' Cafe\u0301  礼物 ',
      coinType: ' GOLD ',
      createdAt: '2027-01-15T16:00:00+08:00',
    });
    const imported = fixture.detection.importProcessedHistoryRecord(
      record,
      fixture.sourceId,
    );
    assert.equal(imported.detection_status, 'final');
    assert.equal(imported.status, 'active');
    assert.equal(imported.gift_name, 'Café 礼物');
    assert.equal(imported.coin_type, 'gold');
    assert.equal(imported.created_at, '2027-01-15T08:00:00.000Z');

    const row = readGift(fixture.db, imported.id);
    assert.equal(row.source_id, fixture.sourceId);
    assert.equal(row.raw_json, '');
    assert.equal(row.uid, '');
    assert.equal(row.overtime_epoch, 0);
    assert.equal(row.counted_in_sprint, 0);
    assert.equal(row.gift_stats_eligible, 0);
    assert.equal(row.gift_stats_delivered, 1);
    assert.equal(row.first_detected_at_ms, Date.parse(row.created_at));
    assert.equal(row.last_platform_at_ms, Date.parse(row.created_at));
    assert.equal(row.finalized_at_ms, Date.parse(row.created_at));
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.finalizedIds, []);

    const replay = fixture.detection.importProcessedHistoryRecord(
      makeHistoryRecord({
        giftName: 'Café 礼物',
        coinType: 'gold',
      }),
      fixture.sourceId,
    );
    assert.equal(replay.id, imported.id);

    assert.throws(
      () =>
        fixture.detection.importProcessedHistoryRecord(
          makeHistoryRecord({ giftName: 'Different Gift' }),
          fixture.sourceId,
        ),
      /PROCESSED_GIFT_HISTORY_CONFLICT/,
    );

    const otherSourceId = createSource(fixture.db.giftDb, 'f'.repeat(64));
    const other = fixture.detection.importProcessedHistoryRecord(
      makeHistoryRecord({ giftName: 'Different Gift' }),
      otherSourceId,
    );
    assert.notEqual(other.id, imported.id);
  } finally {
    fixture.close();
  }
});

test('gift sync contract consumes the shared server fixture', () => {
  const canonicalCase = giftSyncFixture.canonicalCases.find(
    ({ name }) => name === 'canonical-paid-blind-box',
  );
  const coinTypeCase = giftSyncFixture.canonicalCases.find(
    ({ name }) => name === 'coin-type-normalizes-to-nfc',
  );
  assert.ok(canonicalCase);
  assert.ok(coinTypeCase);
  assert.equal(canonicalGiftId(' １２3 '), '１２3');
  assert.equal(
    canonicalGiftText(canonicalCase.input.gift.giftName),
    canonicalCase.expected.record.gift.giftName,
  );
  assert.equal(canonicalGiftText('A\u0085B'), 'A B');
  assert.equal(canonicalCoinType(' GOLD '), 'gold');
  assert.equal(
    canonicalCoinType(coinTypeCase.input.gift.coinType),
    coinTypeCase.expected.record.gift.coinType,
  );

  const historyPage = normalizeProcessedGiftHistoryPage(
    structuredClone(giftSyncFixture.bootstrapPage.response),
  );
  assert.equal(historyPage.events[0].gift.totalPriceCents, 250);
  assert.equal(
    historyPage.recoveryCursor,
    giftSyncFixture.bootstrapPage.response.recoveryCursor,
  );
  assert.equal(
    historyPage.historyBootstrapVersion,
    giftSyncFixture.historyBootstrapVersion,
  );

  for (const cursorCase of giftSyncFixture.cursorCases) {
    if (!cursorCase.response) continue;
    const page = normalizeProcessedGiftPage(
      structuredClone(cursorCase.response),
    );
    assert.equal(page.nextCursor, cursorCase.response.nextCursor);
  }
});

test('history wire contract rejects incomplete, coerced, or extended pages atomically', () => {
  const invalidMutations = [
    (page) => delete page.ok,
    (page) => {
      page.ok = 'true';
    },
    (page) => {
      page.extra = true;
    },
    (page) => {
      page.recoveryCursor = String(page.recoveryCursor);
    },
    (page) => {
      page.syncEpoch = 1;
    },
    (page) => {
      page.syncEpoch = 'x'.repeat(129);
    },
    (page) => {
      page.nextPageToken = 'x'.repeat(4097);
    },
    (page) => {
      page.events[0].extra = true;
    },
    (page) => {
      page.events[0].gift.extra = true;
    },
    (page) => delete page.events[0].gift.userName,
    (page) => {
      page.events[0].gift.userName = 123;
    },
    (page) => delete page.events[0].gift.coinType,
    (page) => {
      page.events[0].gift.coinType = 123;
    },
    (page) => delete page.events[0].gift.isBlindBox,
    (page) => {
      page.events[0].gift.isBlindBox = 1;
    },
    (page) => delete page.events[0].gift.blindBoxId,
    (page) => {
      page.events[0].gift.blindBoxId = '0';
    },
    (page) => delete page.events[0].gift.blindBoxName,
    (page) => delete page.events[0].gift.blindBoxPrice,
    (page) => {
      page.events[0].gift.blindBoxPrice = '2';
    },
    (page) => delete page.events[0].gift.blindProfit,
    (page) => {
      page.events[0].gift.blindProfit = '0.5';
    },
  ];

  for (const mutate of invalidMutations) {
    const page = structuredClone(giftSyncFixture.bootstrapPage.response);
    mutate(page);
    assert.throws(
      () => normalizeProcessedGiftHistoryPage(page),
      /INVALID_PROCESSED_GIFT_HISTORY_PAGE/,
    );
  }

  const imprecise = structuredClone(giftSyncFixture.bootstrapPage.response);
  imprecise.events[0].gift.unitPrice = 1.0000000009;
  imprecise.events[0].gift.totalPrice = 2.0000000009;
  imprecise.events[0].gift.blindBoxPrice = 1.5;
  imprecise.events[0].gift.blindProfit = 0.5;
  assert.equal(
    normalizeProcessedGiftHistoryPage(imprecise).events[0].gift.unitPriceCents,
    100,
  );

  const invalidMoney = structuredClone(giftSyncFixture.bootstrapPage.response);
  invalidMoney.events[0].gift.unitPrice = 1.001;
  assert.throws(
    () => normalizeProcessedGiftHistoryPage(invalidMoney),
    /INVALID_PROCESSED_GIFT_HISTORY_PAGE/,
  );
});

test('incremental wire contract is exact for v1 pages, events, and gifts', () => {
  const fixturePage = structuredClone(
    giftSyncFixture.cursorCases.find(
      ({ name }) => name === 'epoch-aware-no-update',
    ).response,
  );
  const historyRecord = structuredClone(
    giftSyncFixture.bootstrapPage.response.events[0],
  );
  fixturePage.events = [
    { ...historyRecord, cursor: 42, phase: 'final' },
  ];
  fixturePage.nextCursor = 42;
  fixturePage.latestCursor = 42;
  assert.equal(normalizeProcessedGiftPage(fixturePage).events.length, 1);

  const invalidMutations = [
    (page) => delete page.ok,
    (page) => {
      page.ok = false;
    },
    (page) => {
      page.extra = true;
    },
    (page) => delete page.syncEpoch,
    (page) => {
      page.nextCursor = '42';
    },
    (page) => {
      page.historyBootstrapVersion = '1';
    },
    (page) => {
      page.syncEpoch = 'x'.repeat(129);
    },
    (page) => {
      page.earliestCursor = '1';
    },
    (page) => {
      page.latestCursor = '42';
    },
    (page) => {
      page.events[0].extra = true;
    },
    (page) => {
      page.events[0].gift.extra = true;
    },
    (page) => {
      page.events[0].cursor = '42';
    },
    (page) => {
      page.events[0].gift.num = '2';
    },
    (page) => {
      page.events[0].gift.isBlindBox = 1;
    },
  ];

  for (const mutate of invalidMutations) {
    const page = structuredClone(fixturePage);
    mutate(page);
    assert.throws(
      () => normalizeProcessedGiftPage(page),
      /INVALID_PROCESSED_GIFT_PAGE/,
    );
  }

  assert.deepEqual(
    normalizeProcessedGiftPage({
      ok: true,
      events: [],
      nextCursor: 5,
      hasMore: false,
    }),
    {
      ok: true,
      events: [],
      nextCursor: 5,
      hasMore: false,
    },
  );

  assert.throws(
    () =>
      normalizeProcessedGiftEvent({
        ...fixturePage.events[0],
        uid: 'not-allowed',
      }),
    /INVALID_PROCESSED_GIFT_EVENT/,
  );
});

function createFixture(options = {}) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-processed-gift-'),
  );
  const db = createDatabases({ dataDir });
  const sourceId = createSource(db.giftDb, 'd'.repeat(64));
  const clock = createFakeClock(1_800_000_000_000);
  const events = [];
  const finalizedIds = [];
  const detection = createGiftDetectionService(
    {
      db,
       settings: () => ({
         enableGiftSprint: options.enableGiftSprint || 'true',
       }),
      state: { blindBoxCache: null },
    },
    {
      consumerRegistry: createGiftConsumerRegistry({
        consumers: [
          createGiftStatisticsConsumer({ giftDb: db.giftDb }),
          { name: 'recorder', handle: (event) => events.push(event) },
        ],
      }),
       getOvertimeEpoch: options.getOvertimeEpoch || (() => 7),
      onGiftFinalized: (row) => finalizedIds.push(Number(row.id)),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
  );
  return {
    db,
    detection,
    sourceId,
    importProcessedEvent(event) {
      return detection.importProcessedEvent(event, sourceId);
    },
    clock,
    events,
    finalizedIds,
    close() {
      detection.dispose();
      closeDatabases(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function makeHistoryRecord(giftOverrides = {}) {
  const event = makeEvent('final', 1, giftOverrides);
  return {
    eventId: event.eventId,
    gift: event.gift,
  };
}

function createSource(giftDb, sourceKey) {
  const timestamp = '2026-09-01T00:00:00.000Z';
  const result = giftDb
    .prepare(
      `
      INSERT INTO gift_sources (source_key, created_at, updated_at)
      VALUES (?, ?, ?)
    `,
    )
    .run(sourceKey, timestamp, timestamp);
  giftDb
    .prepare(
      'INSERT INTO gift_sync_state (source_id, updated_at) VALUES (?, ?)',
    )
    .run(result.lastInsertRowid, timestamp);
  return Number(result.lastInsertRowid);
}

function makeEvent(phase, cursor, giftOverrides = {}) {
  return {
    eventId: 'gift-event-1',
    cursor,
    phase,
    gift: {
      giftId: '33988',
      giftName: '人气票',
      userName: 'Alice',
      num: 1,
      unitPrice: 0.1,
      totalPrice: 0.1,
      coinType: 'gold',
      isBlindBox: false,
      blindBoxId: null,
      blindBoxName: '',
      blindBoxPrice: null,
      blindProfit: null,
      createdAt: '2027-01-15T08:00:00.000Z',
      ...giftOverrides,
    },
  };
}

function readGift(db, id) {
  return db.giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(id);
}

function createFakeClock(startMs) {
  let currentMs = startMs;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => currentMs,
    setTimeout(callback, delay) {
      const timer = { id: nextId, at: currentMs + delay, callback, unref() {} };
      nextId += 1;
      timers.set(timer.id, timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timers.delete(timer.id);
    },
    advance(deltaMs) {
      currentMs += deltaMs;
      while (true) {
        const due = [...timers.values()]
          .filter((timer) => timer.at <= currentMs)
          .sort((left, right) => left.at - right.at || left.id - right.id)[0];
        if (!due) break;
        timers.delete(due.id);
        due.callback();
      }
    },
  };
}
