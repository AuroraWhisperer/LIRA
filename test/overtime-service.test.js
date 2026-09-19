'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MAX_OVERTIME_SECONDS } = require('../src/overtime');
const {
  clearAllData,
  closeDatabases,
  createDatabases,
  getSchemaVersions,
} = require('../src/storage/database');
const { createFixture } = require('./helpers/overtime-service-fixture');

test('gift database v10 creates overtime tables and safe singleton defaults', () => {
  const fixture = createFixture();
  try {
    assert.equal(getSchemaVersions(fixture.db).giftDb, 12);
    const tables = new Set(
      fixture.db.giftDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    assert.equal(tables.has('overtime_machine_state'), true);
    assert.equal(tables.has('overtime_gift_rules'), true);
    assert.equal(tables.has('overtime_settlements'), true);

    const state = fixture.db.giftDb
      .prepare('SELECT * FROM overtime_machine_state WHERE id = 1')
      .get();
    assert.equal(state.enabled, 0);
    assert.equal(state.enable_epoch, 0);
    assert.equal(state.initial_seconds, 0);
    assert.equal(state.remaining_ms, 0);
    assert.equal(state.status, 'paused');
    assert.equal(state.background_path, '');
    assert.equal(state.background_fit, 'cover');
    assert.equal(state.revision, 0);
  } finally {
    fixture.close();
  }
});

test('reloading a cleared overtime state cancels the previous clocks pending zero transition', () => {
  const fixture = createFixture();
  const service = fixture.createService();
  try {
    service.setTime({ remainingSeconds: 120 });
    service.act('enable');
    service.act('start');
    const previousRevision = service.getSnapshot().revision;
    const { songDb, superChatDb, giftDb, musicDb, checkinDb } = fixture.db;
    assert.equal(
      clearAllData(songDb, superChatDb, giftDb, musicDb, checkinDb).cleared,
      true,
    );
    service.reloadState();
    fixture.clock.advance(121_000);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 0);
    assert.equal(service.getSnapshot().status, 'disabled');
    assert.equal(service.getSnapshot().revision, previousRevision + 1);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('pausing recovery stops zero-timer writes and resumes the elapsed clock', () => {
  const fixture = createFixture();
  const service = fixture.createService();
  try {
    service.setTime({ remainingSeconds: 120 });
    service.act('enable');
    service.act('start');
    const before = fixture.db.giftDb
      .prepare('SELECT * FROM overtime_machine_state')
      .get();
    assert.equal(service.pauseRecovery(), true);
    assert.equal(service.pauseRecovery(), false);
    fixture.clock.advance(121_000);
    assert.deepEqual(
      fixture.db.giftDb.prepare('SELECT * FROM overtime_machine_state').get(),
      before,
    );
    service.resumeRecovery();
    fixture.clock.advance(0);
    assert.equal(service.getSnapshot().status, 'finished');
    assert.equal(
      fixture.db.giftDb
        .prepare('SELECT remaining_ms FROM overtime_machine_state')
        .get().remaining_ms,
      0,
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('pausing recovery blocks settlement retries and incoming gifts until resumed', () => {
  const fixture = createFixture();
  let attempts = 0;
  const service = fixture.createService({
    randomInt() {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary settlement failure');
      return 0;
    },
  });
  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 10 });
    service.replaceRules([
      {
        giftId: 'blind',
        giftName: 'Blind',
        mode: 'random',
        enabled: true,
        outcomes: [
          { seconds: 60, weight: 1 },
          { seconds: -30, weight: 1 },
        ],
      },
    ]);
    const event = fixture.insertFinalGift({
      giftId: 'blind',
      overtimeEpoch: 1,
    });
    assert.throws(
      () => service.finalizeGift(event),
      /temporary settlement failure/,
    );
    const before = fixture.getSettlement(event.giftEventId);
    service.pauseRecovery();
    fixture.clock.advance(5_000);
    assert.equal(service.observeGift(event), false);
    assert.equal(service.finalizeGift(event), false);
    assert.equal(attempts, 1);
    assert.deepEqual(fixture.getSettlement(event.giftEventId), before);
    service.resumeRecovery();
    assert.equal(attempts, 2);
    assert.equal(fixture.getSettlement(event.giftEventId).status, 'applied');
    assert.equal(service.getSnapshot().effectiveRemainingMs, 70_000);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('gift database v10 preserves v5 overtime state while widening its bounds', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-overtime-migration-'),
  );
  let db = createDatabases({ dataDir });
  try {
    db.giftDb.exec(`
      DROP TABLE overtime_machine_state;
      CREATE TABLE overtime_machine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        enable_epoch INTEGER NOT NULL DEFAULT 0 CHECK (enable_epoch >= 0),
        initial_seconds INTEGER NOT NULL DEFAULT 0 CHECK (initial_seconds BETWEEN 0 AND 3599999),
        remaining_ms INTEGER NOT NULL DEFAULT 0 CHECK (remaining_ms BETWEEN 0 AND 3599999000),
        anchor_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (anchor_at_ms >= 0),
        status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('paused', 'running', 'finished')),
        background_path TEXT NOT NULL DEFAULT '',
        background_fit TEXT NOT NULL DEFAULT 'cover' CHECK (background_fit IN ('cover', 'contain', 'fill')),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        updated_at TEXT NOT NULL
      );
      INSERT INTO overtime_machine_state VALUES (
        1, 1, 7, 3600, 2700000, 1234, 'paused', '/img/overtime-machine/night.webp',
        'contain', 9, '2026-08-14T00:00:00.000Z'
      );
      UPDATE schema_version SET version = 5 WHERE key = 'gift_db';
    `);
    closeDatabases(db);

    db = createDatabases({ dataDir });
    const state = db.giftDb
      .prepare('SELECT * FROM overtime_machine_state WHERE id = 1')
      .get();
    assert.equal(getSchemaVersions(db).giftDb, 12);
    assert.equal(state.enabled, 1);
    assert.equal(state.enable_epoch, 7);
    assert.equal(state.remaining_ms, 2_700_000);
    assert.equal(state.background_fit, 'contain');
    db.giftDb
      .prepare(
        'UPDATE overtime_machine_state SET remaining_ms = ? WHERE id = 1',
      )
      .run(MAX_OVERTIME_SECONDS * 1000);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('gift database v10 adds nullable blind_box_id to an existing v8 database', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'song-plugin-blind-box-id-migration-'),
  );
  let db = createDatabases({ dataDir });
  try {
    db.giftDb.exec(`
      ALTER TABLE gift_events DROP COLUMN blind_box_id;
      INSERT INTO gift_events (gift_id, gift_name, created_at, updated_at)
      VALUES ('35207', 'legacy output', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z');
      UPDATE schema_version SET version = 8 WHERE key = 'gift_db';
    `);
    closeDatabases(db);

    db = createDatabases({ dataDir });
    assert.equal(getSchemaVersions(db).giftDb, 12);
    const columns = new Set(
      db.giftDb
        .prepare('PRAGMA table_info(gift_events)')
        .all()
        .map((column) => column.name),
    );
    assert.equal(columns.has('blind_box_id'), true);
    const row = db.giftDb
      .prepare(
        "SELECT gift_id, gift_name, blind_box_id FROM gift_events WHERE gift_id = '35207'",
      )
      .get();
    assert.equal(row.gift_id, '35207');
    assert.equal(row.gift_name, 'legacy output');
    assert.equal(row.blind_box_id, null);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
