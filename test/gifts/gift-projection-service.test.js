'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createFakeClock,
  createGiftSource,
  makeProcessedGiftEvent,
  readGift,
} = require('../helpers/processed-gift-fixture');
const { createGiftProjectionStore } = require('../../src/storage/gift-projection-store');
const {
  createGiftConsumerRegistry,
  createGiftProjectionService,
  createGiftStatisticsConsumer,
} = require('../../src/bilibili/gift');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { getGiftHistory } = require('../../src/bilibili/gift/query-service');
const { normalizeProcessedGiftEvent } = require('../../src/shared/processed-gift-contract');
const { createFixture: createQueryFixture } = require('../helpers/gift-query-fixture');

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
  assert.deepEqual(errors, [{ message: 'consumer failed', consumerName: 'broken' }]);
  assert.deepEqual(result, { delivered: ['healthy'], failed: ['broken'] });
});

test('final delivery retries after one second without another platform packet', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-delivery-retry-'));
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-eligibility-'));
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
    const first = projection.importProcessedEvent(makeProcessedGiftEvent({}, { phase: 'progress' }), sourceId);
    giftStatisticsEnabled = true;
    overtimeEpoch = 4;
    clock.advance(1_000);
    const second = projection.importProcessedEvent(makeProcessedGiftEvent({ num: 2, totalPrice: 0.2 }), sourceId);

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-retry-pause-'));
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
    const row = projection.importProcessedEvent(makeProcessedGiftEvent(), sourceId);
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

test('a transient database read failure during consumer retry is contained and retried', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-read-retry-'));
  const db = createDatabases({ dataDir });
  const sourceId = createGiftSource(db.giftDb);
  const clock = createFakeClock(1_800_000_000_000);
  const projectionStore = createGiftProjectionStore(db.giftDb);
  const read = projectionStore.read;
  let failRead = false;
  projectionStore.read = (id) => {
    if (failRead) throw new Error('synthetic projection read failure');
    return read(id);
  };
  let attempts = 0;
  const projection = createGiftProjectionService(
    { db, projectionStore, settings: () => ({}) },
    {
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      consumerRegistry: createGiftConsumerRegistry({
        consumers: [
          {
            name: 'once',
            handle() {
              if (++attempts === 1) throw new Error('synthetic consumer failure');
            },
          },
        ],
        onError() {},
      }),
    },
  );
  try {
    projection.importProcessedEvent(makeProcessedGiftEvent(), sourceId);
    assert.equal(attempts, 1);
    failRead = true;
    assert.doesNotThrow(() => clock.advance(1000));
    assert.equal(attempts, 1);
    failRead = false;
    clock.advance(2000);
    assert.equal(attempts, 2);
    clock.advance(30000);
    assert.equal(attempts, 2);
  } finally {
    projection.dispose();
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('optional display v1 survives projection and repeated final deliveries without exposing viewer identity', (t) => {
  const fx = createQueryFixture();
  t.after(() => fx.close());
  const source = fx.resolveSource('a'.repeat(64));
  fx.setActiveSource(source.id);
  const service = createGiftProjectionService(fx.context);
  t.after(() => service.dispose());
  const event = {
    eventId: 'profile-test',
    cursor: 1,
    phase: 'final',
    gift: {
      giftId: '1',
      giftName: '礼物',
      userName: '观众',
      num: 1,
      unitPrice: 100,
      totalPrice: 100,
      coinType: 'gold',
      isBlindBox: false,
      blindBoxId: null,
      blindBoxName: '',
      blindBoxPrice: null,
      blindProfit: null,
      createdAt: '2026-09-01T12:00:00Z',
      display: {
        version: 1,
        avatarUrl: 'https://i0.hdslb.com/bfs/face/test.webp',
        guardLevel: 3,
      },
    },
  };
  const normalized = normalizeProcessedGiftEvent(event);
  service.importProcessedEvent(normalized, source.id);
  service.importProcessedEvent(normalized, source.id);
  const history = getGiftHistory(fx.context, { range: 'all' });
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].gift.guardLevel, 3);
  assert.equal(history.items[0].gift.avatarUrl, event.gift.display.avatarUrl);
  const old = structuredClone(event);
  delete old.gift.display;
  assert.doesNotThrow(() => normalizeProcessedGiftEvent(old));
  for (const display of [
    { ...event.gift.display, version: 2 },
    { ...event.gift.display, guardLevel: 4 },
    { ...event.gift.display, avatarUrl: 'https://evil.invalid/image.png' },
    { ...event.gift.display, uid: '1' },
  ]) {
    assert.throws(() => normalizeProcessedGiftEvent({ ...event, gift: { ...event.gift, display } }));
  }
});
