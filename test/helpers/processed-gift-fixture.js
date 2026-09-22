'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createGiftConsumerRegistry,
  createGiftProjectionService,
  createGiftStatisticsConsumer,
} = require('../../src/bilibili/gift');
const { closeDatabases, createDatabases } = require('../../src/storage/database');

function createFixture(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-processed-gift-'));
  const db = createDatabases({ dataDir });
  const sourceId = createSource(db.giftDb, 'd'.repeat(64));
  const clock = createFakeClock(1_800_000_000_000);
  const events = [];
  const finalizedIds = [];
  const detection = createGiftProjectionService(
    {
      db,
      settings: () => ({
        enableGiftSprint: options.enableGiftSprint || 'true',
      }),
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
    .prepare('INSERT INTO gift_sync_state (source_id, updated_at) VALUES (?, ?)')
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

module.exports = {
  createFakeClock,
  createFixture,
  createSource,
  makeEvent,
  makeHistoryRecord,
  readGift,
};
