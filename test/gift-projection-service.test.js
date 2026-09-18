'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createGiftSource,
  makeProcessedGiftEvent,
} = require('./helpers/processed-gifts');
const {
  createGiftConsumerRegistry,
  createGiftProjectionService,
  createGiftStatisticsConsumer,
} = require('../src/bilibili/gift');
const {
  DB_FILE_NAMES,
  closeDatabases,
  createDatabases,
  getSchemaVersions,
  openSqliteDatabase,
} = require('../src/storage/database');

test('gift database v4 exposes the shared projection ledger columns', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-ledger-'),
  );
  const db = createDatabases({ dataDir });

  try {
    assert.equal(getSchemaVersions(db).giftDb, 11);
    const columns = new Set(
      db.giftDb
        .prepare('PRAGMA table_info(gift_events)')
        .all()
        .map((column) => column.name),
    );
    assert.deepEqual(
      [...columns].filter((name) =>
        [
          'detection_status',
          'first_detected_at_ms',
          'last_platform_at_ms',
          'finalized_at_ms',
          'gift_stats_eligible',
          'gift_stats_delivered',
          'overtime_epoch',
        ].includes(name),
      ),
      [
        'detection_status',
        'first_detected_at_ms',
        'last_platform_at_ms',
        'finalized_at_ms',
        'gift_stats_eligible',
        'gift_stats_delivered',
        'overtime_epoch',
      ],
    );
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('gift database v3 upgrades before creating indexes that depend on v4 columns', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-v3-upgrade-'),
  );
  let db = createDatabases({ dataDir });

  try {
    closeDatabases(db);
    const giftDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.giftDb));
    giftDb.exec(`
      DROP INDEX IF EXISTS idx_gift_events_detection_pending;
      DROP INDEX IF EXISTS idx_gift_events_gift_stats_delivery;
      DROP INDEX IF EXISTS idx_gift_events_source_time;
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
    assert.equal(getSchemaVersions(db).giftDb, 11);
    const indexes = new Set(
      db.giftDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => row.name),
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
        },
      },
      {
        name: 'healthy',
        handle(event) {
          delivered.push(event.giftEventId);
        },
      },
    ],
    onError(error, consumerName) {
      errors.push({ message: error.message, consumerName });
    },
  });

  const result = registry.dispatch({ phase: 'final', giftEventId: 17 });

  assert.deepEqual(delivered, [17]);
  assert.deepEqual(errors, [
    { message: 'consumer failed', consumerName: 'broken' },
  ]);
  assert.deepEqual(result, { delivered: ['healthy'], failed: ['broken'] });
});

test('final delivery retries after one second without another platform packet', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-delivery-retry-'),
  );
  const db = createDatabases({ dataDir });
  const clock = createFakeClock(1_800_000_000_000);
  let attempts = 0;
  const sourceId = createGiftSource(db.giftDb);
  const projection = createGiftProjectionService(
    {
      db,
      settings: () => ({ enableGiftSprint: 'true' }),
    },
    {
      consumerRegistry: createGiftConsumerRegistry({
        consumers: [
          {
            name: 'fails-once',
            handle(event) {
              if (event.phase !== 'final') return;
              attempts += 1;
              if (attempts === 1) throw new Error('temporary delivery failure');
            },
          },
        ],
      }),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
  );

  try {
    projection.importProcessedEvent(makeProcessedGiftEvent(), sourceId);
    assert.equal(attempts, 1);

    clock.advance(999);
    assert.equal(attempts, 1);

    clock.advance(1);
    assert.equal(attempts, 2);

    clock.advance(30_000);
    assert.equal(attempts, 2);
  } finally {
    projection.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('consumer eligibility is frozen by the first server phase', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-gift-eligibility-'),
  );
  const db = createDatabases({ dataDir });
  const clock = createFakeClock(1_800_000_000_000);
  let giftStatisticsEnabled = false;
  let overtimeEpoch = 0;
  const sourceId = createGiftSource(db.giftDb);
  const projection = createGiftProjectionService(
    {
      db,
      settings: () => ({
        enableGiftSprint: giftStatisticsEnabled ? 'true' : 'false',
      }),
    },
    {
      consumerRegistry: createGiftConsumerRegistry(),
      getOvertimeEpoch: () => overtimeEpoch,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
  );

  try {
    overtimeEpoch = 3;
    const first = projection.importProcessedEvent(
      makeProcessedGiftEvent({}, { phase: 'progress' }),
      sourceId,
    );
    giftStatisticsEnabled = true;
    overtimeEpoch = 4;
    clock.advance(1_000);
    const second = projection.importProcessedEvent(
      makeProcessedGiftEvent({ num: 2, totalPrice: 0.2 }),
      sourceId,
    );

    assert.equal(first.gift_stats_eligible, 0);
    assert.equal(first.overtime_epoch, 3);
    assert.equal(second.gift_stats_eligible, 0);
    assert.equal(second.overtime_epoch, 3);
  } finally {
    projection.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('pause cancels consumer retries and resume retains failed non-statistics deliveries', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-gift-retry-pause-'),
  );
  const db = createDatabases({ dataDir });
  const clock = createFakeClock(1_800_000_000_000);
  let attempts = 0;
  const sourceId = createGiftSource(db.giftDb);
  const projection = createGiftProjectionService(
    { db, settings: () => ({ enableGiftSprint: 'true' }), state: {} },
    {
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      consumerRegistry: createGiftConsumerRegistry({
        consumers: [
          createGiftStatisticsConsumer({ giftDb: db.giftDb }),
          {
            name: 'retry-once',
            handle(event) {
              if (event.phase !== 'final') return;
              attempts += 1;
              if (attempts === 1) throw new Error('retry required');
            },
          },
        ],
        onError() {},
      }),
    },
  );
  try {
    const row = projection.importProcessedEvent(
      makeProcessedGiftEvent(),
      sourceId,
    );
    assert.equal(attempts, 1);
    assert.equal(readGift(db, row.id).gift_stats_delivered, 1);
    projection.pauseDetection();
    clock.advance(30_000);
    assert.equal(attempts, 1);
    projection.resumeDetection();
    clock.advance(30_000);
    assert.equal(attempts, 2);
    clock.advance(30_000);
    assert.equal(attempts, 2);
  } finally {
    projection.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

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
        .filter((timer) => timer.at <= currentMs)
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
    },
  };
}
