'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { giftVariantId } = require('../src/shared/gift-identity');
const TICKET_IDENTITY = { priceRaw: 100, coinType: 'gold', bagGift: false };
TICKET_IDENTITY.variantId = giftVariantId({
  ...TICKET_IDENTITY,
  giftId: '33988',
  name: '人气票',
});
const { createGiftService } = require('../src/bilibili/gift');
const { buildGiftFrameEvent } = require('../src/bilibili/gift/frame-config');
const {
  createOvertimeConsumer,
  createOvertimeService,
} = require('../src/overtime');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const { readServerFixture } = require('../scripts/verify-server-contract');
const heartBox = readServerFixture('test/fixtures/heart-blind-box-events.json');
const { getGiftSnapshot } = require('../src/bilibili/gift/query-service');
const {
  createFakeClock,
  createFixture,
  createSource,
  makeEvent,
  makeHistoryRecord,
  readGift,
} = require('./helpers/processed-gift-fixture');

test('heart-box output metadata survives remote import and recent snapshot projection', () => {
  const fixture = createFixture();
  try {
    for (const [index, item] of heartBox.outputs.entries()) {
      const event = makeEvent('final', index + 1, {
        giftId: item.id,
        giftName: item.name,
        unitPrice: item.rmb,
        totalPrice: item.rmb,
        isBlindBox: true,
        blindBoxId: heartBox.box.id,
        blindBoxName: heartBox.box.name,
        blindBoxPrice: heartBox.box.rmb,
        blindProfit: item.profit,
      });
      event.eventId = `heart-output-${index}`;
      fixture.importProcessedEvent(event);
      fixture.importProcessedEvent(event);
    }
    const snapshot = getGiftSnapshot({
      db: fixture.db,
      getActiveGiftSource: () => ({ sourceId: fixture.sourceId }),
    });
    assert.equal(snapshot.recent.length, 2);
    for (const item of heartBox.outputs) {
      const row = snapshot.recent.find((gift) => gift.gift_id === item.id);
      assert.equal(row.is_blind_box, true);
      assert.equal(row.blind_box_id, heartBox.box.id);
      assert.equal(row.blind_box_name, heartBox.box.name);
      assert.equal(row.total_price, item.rmb);
      assert.equal(row.blind_box_price, heartBox.box.rmb);
      assert.equal(row.blind_profit, item.profit);
    }
  } finally {
    fixture.close();
  }
});

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
    assert.deepEqual(
      fixture.events.map((event) => event.phase),
      ['progress'],
    );

    fixture.clock.advance(30_000);
    fixture.detection.recover();
    assert.equal(
      readGift(fixture.db, progress.id).detection_status,
      'progress',
    );

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

test('gift projection runtime never finalizes or consumes old local gifts', () => {
  const fixture = createFixture();
  fixture.detection.dispose();
  const timestamp = new Date(fixture.clock.now()).toISOString();
  fixture.db.giftDb
    .prepare(
      `
    INSERT INTO gift_events (
      platform_id, cmd, gift_name, total_price, gift_stats_eligible,
      detection_status, created_at, updated_at
    ) VALUES (?, 'SEND_GIFT_V2', '旧礼物', 5, 1, ?, ?, ?)
  `,
    )
    .run('legacy-combo', 'progress', timestamp, timestamp);
  fixture.db.giftDb
    .prepare(
      `
    INSERT INTO gift_events (
      platform_id, cmd, gift_name, total_price, gift_stats_eligible,
      detection_status, created_at, updated_at
    ) VALUES ('legacy-final', 'SEND_GIFT', '旧礼物', 5, 1, 'final', ?, ?)
  `,
    )
    .run(timestamp, timestamp);
  const legacy = fixture.db.giftDb
    .prepare("SELECT * FROM gift_events WHERE platform_id = 'legacy-combo'")
    .get();
  const legacyFinal = fixture.db.giftDb
    .prepare("SELECT * FROM gift_events WHERE platform_id = 'legacy-final'")
    .get();
  const finalized = [];
  const gifts = createGiftService(
    { db: fixture.db, settings: () => ({ enableGiftSprint: 'true' }) },
    {
      now: fixture.clock.now,
      setTimeout: fixture.clock.setTimeout,
      clearTimeout: fixture.clock.clearTimeout,
      onGiftFinalized: (row) => finalized.push(row.id),
    },
  );
  try {
    for (const method of [
      'add',
      'detect',
      'flushPending',
      'finalizeDetected',
    ]) {
      assert.equal(gifts[method], undefined, `${method} must not be exposed`);
    }
    assert.equal(gifts.getStatus().pendingCount, 0);
    const progress = gifts.importProcessedEvent(
      makeEvent('progress', null),
      fixture.sourceId,
    );
    fixture.clock.advance(30_000);
    gifts.recover();
    gifts.pauseDetection();
    gifts.resumeDetection();
    assert.equal(
      readGift(fixture.db, progress.id).detection_status,
      'progress',
    );
    assert.equal(gifts.getStatus().pendingCount, 1);
    assert.deepEqual(finalized, []);

    gifts.importProcessedEvent(makeEvent('final', 1), fixture.sourceId);
    gifts.importProcessedEvent(makeEvent('final', 1), fixture.sourceId);
    assert.deepEqual(finalized, [progress.id]);
    assert.equal(readGift(fixture.db, progress.id).counted_in_sprint, 1);
    gifts.dispose();
    fixture.clock.advance(30_000);
    assert.deepEqual(readGift(fixture.db, legacy.id), legacy);
    assert.deepEqual(readGift(fixture.db, legacyFinal.id), legacyFinal);
  } finally {
    gifts.dispose();
    fixture.close();
  }
});

test('server unit prices and totals are projected without client price inference', () => {
  const fixture = createFixture();
  try {
    for (const [index, unitPrice] of [0, 10].entries()) {
      const event = makeEvent('final', index + 1, {
        num: 3,
        unitPrice,
        totalPrice: 0.3,
        isBlindBox: true,
        blindBoxPrice: 0.9,
        blindProfit: -0.6,
      });
      event.eventId = `authoritative-price-${index}`;
      const row = fixture.importProcessedEvent(event);
      assert.equal(row.num, 3);
      assert.equal(row.unit_price, unitPrice);
      assert.equal(row.total_price, 0.3);
      assert.equal(row.blind_box_price, 0.9);
      assert.equal(row.blind_profit, -0.6);
    }
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
    assert.deepEqual(
      fixture.events.map((event) => event.phase),
      ['final'],
    );
    assert.deepEqual(fixture.finalizedIds, [finalized.id]);

    fixture.importProcessedEvent(recoveredEvent);
    assert.deepEqual(
      fixture.events.map((event) => event.phase),
      ['final'],
    );
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
    const imported = fixture.importProcessedEvent(makeEvent('final', 14));
    assert.equal(imported.detection_status, 'final');
    assert.equal(imported.gift_stats_eligible, 0);
    assert.equal(imported.overtime_epoch, 0);
    assert.deepEqual(
      fixture.events.map((event) => event.phase),
      ['final'],
    );
  } finally {
    fixture.close();
  }
});

test('processed final reaches existing statistics, overtime, history, snapshot, and frame consumers once', () => {
  const makeTicketEvent = (phase, cursor, overrides = {}) =>
    makeEvent(phase, cursor, {
      giftVariantId: TICKET_IDENTITY.variantId,
      blindBoxVariantId: null,
      ...overrides,
    });
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
        giftIdentity: TICKET_IDENTITY,
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
    gifts.importProcessedEvent(makeTicketEvent('progress', null), sourceId);
    const finalized = gifts.importProcessedEvent(
      makeTicketEvent('final', 21, { num: 3, totalPrice: 0.3 }),
      sourceId,
    );
    gifts.importProcessedEvent(
      makeTicketEvent('final', 21, { num: 3, totalPrice: 0.3 }),
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
