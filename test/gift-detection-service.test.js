'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createGiftConsumerRegistry,
  createGiftDetectionService,
  createGiftStatisticsConsumer
} = require('../src/bilibili/gift');
const {
  DB_FILE_NAMES,
  closeDatabases,
  createDatabases,
  getSchemaVersions,
  openSqliteDatabase
} = require('../src/storage/database');

test('gift database v4 exposes the shared detection ledger columns', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-ledger-'));
  const db = createDatabases({ dataDir });

  try {
    assert.equal(getSchemaVersions(db).giftDb, 6);
    const columns = new Set(
      db.giftDb.prepare('PRAGMA table_info(gift_events)').all().map(column => column.name)
    );
    assert.deepEqual(
      [...columns].filter(name => [
        'detection_status',
        'first_detected_at_ms',
        'last_platform_at_ms',
        'finalized_at_ms',
        'gift_stats_eligible',
        'gift_stats_delivered',
        'overtime_epoch'
      ].includes(name)),
      [
        'detection_status',
        'first_detected_at_ms',
        'last_platform_at_ms',
        'finalized_at_ms',
        'gift_stats_eligible',
        'gift_stats_delivered',
        'overtime_epoch'
      ]
    );
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('gift database v3 upgrades before creating indexes that depend on v4 columns', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-v3-upgrade-'));
  let db = createDatabases({ dataDir });

  try {
    closeDatabases(db);
    const giftDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.giftDb));
    giftDb.exec(`
      DROP INDEX IF EXISTS idx_gift_events_detection_pending;
      DROP INDEX IF EXISTS idx_gift_events_gift_stats_delivery;
      ALTER TABLE gift_events DROP COLUMN overtime_epoch;
      ALTER TABLE gift_events DROP COLUMN gift_stats_delivered;
      ALTER TABLE gift_events DROP COLUMN gift_stats_eligible;
      ALTER TABLE gift_events DROP COLUMN finalized_at_ms;
      ALTER TABLE gift_events DROP COLUMN last_platform_at_ms;
      ALTER TABLE gift_events DROP COLUMN first_detected_at_ms;
      ALTER TABLE gift_events DROP COLUMN detection_status;
      UPDATE schema_version SET version = 3 WHERE key = 'gift_db';
    `);
    giftDb.close();

    db = createDatabases({ dataDir });
    assert.equal(getSchemaVersions(db).giftDb, 6);
    const indexes = new Set(
      db.giftDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name)
    );
    assert.equal(indexes.has('idx_gift_events_detection_pending'), true);
    assert.equal(indexes.has('idx_gift_events_gift_stats_delivery'), true);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('consumer registry isolates a failing consumer from the remaining consumers', () => {
  const delivered = [];
  const errors = [];
  const registry = createGiftConsumerRegistry({
    consumers: [
      {
        name: 'broken',
        handle() {
          throw new Error('consumer failed');
        }
      },
      {
        name: 'healthy',
        handle(event) {
          delivered.push(event.giftEventId);
        }
      }
    ],
    onError(error, consumerName) {
      errors.push({ message: error.message, consumerName });
    }
  });

  const result = registry.dispatch({ phase: 'final', giftEventId: 17 });

  assert.deepEqual(delivered, [17]);
  assert.deepEqual(errors, [{ message: 'consumer failed', consumerName: 'broken' }]);
  assert.deepEqual(result, { delivered: ['healthy'], failed: ['broken'] });
});

test('detection persists progress immediately and finalizes once after one quiet window', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-detection-'));
  const db = createDatabases({ dataDir });
  const clock = createFakeClock(1_800_000_000_000);
  const events = [];
  const statistics = createGiftStatisticsConsumer({ giftDb: db.giftDb });
  const registry = createGiftConsumerRegistry({
    consumers: [
      statistics,
      { name: 'recorder', handle: event => events.push(event) }
    ]
  });
  const detection = createGiftDetectionService({
    db,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
    state: { blindBoxCache: null }
  }, {
    consumerRegistry: registry,
    getOvertimeEpoch: () => 7,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });

  try {
    const first = detection.detect(makeGift({ num: 1, totalPrice: 0.1 }, clock.now()));
    assert.equal(first.detection_status, 'progress');
    assert.equal(first.gift_stats_eligible, 1);
    assert.equal(first.overtime_epoch, 7);
    assert.equal(first.counted_in_sprint, false);
    assert.deepEqual(events.map(event => event.phase), ['progress']);

    clock.advance(8_000);
    const progressed = detection.detect(makeGift({ num: 100, totalPrice: 10 }, clock.now()));
    assert.equal(progressed.id, first.id);
    assert.equal(progressed.num, 100);

    clock.advance(9_999);
    assert.equal(readGift(db, first.id).detection_status, 'progress');
    assert.deepEqual(events.map(event => event.phase), ['progress', 'progress']);

    clock.advance(1);
    const finalized = readGift(db, first.id);
    assert.equal(finalized.detection_status, 'final');
    assert.equal(finalized.gift_stats_delivered, 1);
    assert.equal(finalized.counted_in_sprint, 1);
    assert.deepEqual(events.map(event => event.phase), ['progress', 'progress', 'final']);

    clock.advance(20_000);
    detection.flushPending();
    assert.deepEqual(events.map(event => event.phase), ['progress', 'progress', 'final']);
  } finally {
    detection.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('final delivery retries after one second without another platform packet', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-delivery-retry-'));
  const db = createDatabases({ dataDir });
  const clock = createFakeClock(1_800_000_000_000);
  let attempts = 0;
  const detection = createGiftDetectionService({
    db,
    settings: () => ({ enableGiftSprint: 'true', giftBlindBoxConfig: '' }),
    state: { blindBoxCache: null }
  }, {
    consumerRegistry: createGiftConsumerRegistry({
      consumers: [{
        name: 'fails-once',
        handle(event) {
          if (event.phase !== 'final') return;
          attempts += 1;
          if (attempts === 1) throw new Error('temporary delivery failure');
        }
      }]
    }),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });

  try {
    detection.detect(makeGift({}, clock.now()));
    clock.advance(10_000);
    assert.equal(attempts, 1);

    clock.advance(999);
    assert.equal(attempts, 1);

    clock.advance(1);
    assert.equal(attempts, 2);

    clock.advance(30_000);
    assert.equal(attempts, 2);
  } finally {
    detection.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('consumer eligibility is frozen by the first packet', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-eligibility-'));
  const db = createDatabases({ dataDir });
  const clock = createFakeClock(1_800_000_000_000);
  let giftStatisticsEnabled = false;
  let overtimeEpoch = 0;
  const detection = createGiftDetectionService({
    db,
    settings: () => ({
      enableGiftSprint: giftStatisticsEnabled ? 'true' : 'false',
      giftBlindBoxConfig: ''
    }),
    state: { blindBoxCache: null }
  }, {
    consumerRegistry: createGiftConsumerRegistry(),
    getOvertimeEpoch: () => overtimeEpoch,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });

  try {
    overtimeEpoch = 3;
    const first = detection.detect(makeGift({}, clock.now()));
    giftStatisticsEnabled = true;
    overtimeEpoch = 4;
    clock.advance(1_000);
    const second = detection.detect(makeGift({ num: 2, totalPrice: 0.2 }, clock.now()));

    assert.equal(first.gift_stats_eligible, 0);
    assert.equal(first.overtime_epoch, 3);
    assert.equal(second.gift_stats_eligible, 0);
    assert.equal(second.overtime_epoch, 3);
  } finally {
    detection.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function makeGift(overrides, timestamp) {
  return {
    platformId: 'combo:shared:1',
    cmd: 'SEND_GIFT',
    giftId: '33988',
    giftName: '人气票',
    uid: '42',
    userName: 'Alice',
    num: 1,
    unitPrice: 0.1,
    totalPrice: 0.1,
    messageTimestamp: timestamp,
    ...overrides
  };
}

function readGift(db, id) {
  return db.giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(id);
}

function createFakeClock(startMs) {
  let currentMs = startMs;
  let nextId = 1;
  const timers = new Map();

  function runDueTimers() {
    while (true) {
      const due = [...timers.values()]
        .filter(timer => timer.at <= currentMs)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!due) return;
      timers.delete(due.id);
      due.callback();
    }
  }

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
      runDueTimers();
    }
  };
}
