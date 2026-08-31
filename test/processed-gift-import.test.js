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

test('processed server progress stays pending until the matching server final', () => {
  const fixture = createFixture();
  try {
    const progress = fixture.detection.importProcessedEvent(
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

    const finalized = fixture.detection.importProcessedEvent(
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

    const replay = fixture.detection.importProcessedEvent(
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
    const finalized = fixture.detection.importProcessedEvent(
      makeEvent('final', 12, { isBlindBox: true, blindProfit: -0.2 }),
    );
    assert.equal(finalized.detection_status, 'final');
    assert.equal(finalized.is_blind_box, true);
    assert.equal(finalized.blind_profit, -0.2);
    assert.deepEqual(fixture.events.map((event) => event.phase), ['final']);
    assert.deepEqual(fixture.finalizedIds, [finalized.id]);

    fixture.detection.importProcessedEvent(makeEvent('final', 12));
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
    const imported = fixture.detection.importProcessedEvent(
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

    gifts.importProcessedEvent(makeEvent('progress', null));
    const finalized = gifts.importProcessedEvent(
      makeEvent('final', 21, { num: 3, totalPrice: 0.3 }),
    );
    gifts.importProcessedEvent(
      makeEvent('final', 21, { num: 3, totalPrice: 0.3 }),
    );

    assert.equal(gifts.getSprintSnapshot().receivedRmb, 0.3);
    assert.equal(gifts.getSprintSnapshot().countedGiftCount, 1);
    assert.equal(gifts.getHistory().total, 1);
    assert.equal(gifts.getHistory().items[0].id, finalized.id);
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
        fixture.detection.importProcessedEvent({
          ...makeEvent('final', 1),
          eventId: '../tenant',
        }),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );
    assert.throws(
      () =>
        fixture.detection.importProcessedEvent({
          ...makeEvent('final', 1),
          gift: { ...makeEvent('final', 1).gift, totalPrice: 0 },
        }),
      /INVALID_PROCESSED_GIFT_EVENT/,
    );

    const imported = fixture.detection.importProcessedEvent({
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

function createFixture(options = {}) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-processed-gift-'),
  );
  const db = createDatabases({ dataDir });
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
