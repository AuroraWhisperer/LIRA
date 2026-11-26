'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createGiftMaintenanceStore } = require('../../src/storage/gift-maintenance-store');
const { createOvertimeStore } = require('../../src/storage/overtime-store');
const { migrateOvertimeSettlementOrder } = require('../../src/storage/overtime-settlement-migration');
const schema = require('../../src/storage/schema');

function createTestGiftDb() {
  const scratchDir = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(scratchDir, { recursive: true });
  const tempPath = path.join(scratchDir, `test-gift-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(tempPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(schema.GIFT_TABLE_SCHEMA);
  db.exec(schema.GIFT_INDEX_SCHEMA);
  migrateOvertimeSettlementOrder(db);
  return { db, tempPath };
}

function seedGift(db, overrides = {}) {
  const defaults = {
    platform_id: `plat-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    gift_id: 'gift-1',
    gift_name: 'Test Gift',
    uid: `uid-${Math.random().toString(36).slice(2)}`,
    user_name: 'Test User',
    num: 1,
    unit_price: 10.0,
    total_price: 10.0,
    detection_status: 'final',
    gift_stats_eligible: 1,
    overtime_epoch: 1,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const data = { ...defaults, ...overrides };
  const result = db
    .prepare(
      `
    INSERT INTO gift_events (
      platform_id, gift_id, gift_name, uid, user_name, num, unit_price, total_price,
      detection_status, gift_stats_eligible, overtime_epoch, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      data.platform_id,
      data.gift_id,
      data.gift_name,
      data.uid,
      data.user_name,
      data.num,
      data.unit_price,
      data.total_price,
      data.detection_status,
      data.gift_stats_eligible,
      data.overtime_epoch,
      data.status,
      data.created_at,
      data.updated_at,
    );
  return result.lastInsertRowid;
}

function seedSettlement(db, giftEventId, status = 'pending', lastError = '') {
  const timestamp = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO overtime_settlements (
      gift_event_id, status, gift_id, gift_name, quantity, total_price,
      event_created_at, event_updated_at, settle_after_ms, retry_count,
      last_error, rule_mode, rule_snapshot_json, outcomes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    giftEventId,
    status,
    'gift-1',
    'Test Gift',
    1,
    10.0,
    timestamp,
    timestamp,
    status === 'pending' ? 60000 : 0,
    0,
    lastError,
    status === 'ignored' ? 'ignored' : 'fixed',
    '{}',
    '{}',
    timestamp,
    timestamp,
  );
}

const countSettlements = (db, status) =>
  db.prepare('SELECT COUNT(*) AS count FROM overtime_settlements WHERE status = ?').get(status).count;

test('local retention bounds each transaction and rolls back only the failing batch with its settlements', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(schema.GIFT_TABLE_SCHEMA);
  db.exec(schema.GIFT_INDEX_SCHEMA);
  migrateOvertimeSettlementOrder(db);
  db.exec(`WITH RECURSIVE rows(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM rows WHERE id < 2500)
    INSERT INTO gift_events (id, platform_id, gift_name, created_at, updated_at)
    SELECT id, 'expired-' || id, 'gift', '2020-01-01', '2020-01-01' FROM rows`);
  const recentGift = seedGift(db, { created_at: '2022-01-01' });
  seedSettlement(db, 1, 'pending');
  seedSettlement(db, 2, 'applied');
  seedSettlement(db, 1001, 'pending');
  const overtime = createOvertimeStore(db);
  const maintenance = createGiftMaintenanceStore(db);
  assert.deepEqual(maintenance.deleteExpiredLocalBatch('2021', 'now'), {
    deletedGifts: 1000, ignoredSettlements: 1, hasMore: true,
  });
  assert.equal(overtime.getSettlement(1).last_error, 'retention:expired');
  assert.equal(overtime.getSettlement(2).status, 'applied');

  db.exec(`CREATE TRIGGER fail_batch BEFORE DELETE ON gift_events WHEN OLD.id = 1500
    BEGIN SELECT RAISE(ABORT, 'batch failed'); END`);
  assert.throws(() => maintenance.deleteExpiredLocalBatch('2021', 'now'), /batch failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_events').get().n, 1501);
  assert.equal(countSettlements(db, 'pending'), 1);
  assert.equal(countSettlements(db, 'ignored'), 1);
  db.exec('DROP TRIGGER fail_batch');
  assert.equal(maintenance.deleteExpiredLocalBatch('2021', 'now').deletedGifts, 1000);
  assert.deepEqual(maintenance.deleteExpiredLocalBatch('2021', 'now'), {
    deletedGifts: 500, ignoredSettlements: 0, hasMore: false,
  });
  assert.deepEqual(db.prepare('SELECT id FROM gift_events').all().map((row) => row.id), [recentGift]);
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM gift_events INDEXED BY idx_gift_events_created_at
    WHERE source_id IS NULL AND created_at < ? ORDER BY created_at, id LIMIT ?`).all('2021', 1000);
  assert.ok(plan.some((row) => row.detail.includes('idx_gift_events_created_at')));
  assert.ok(plan.every((row) => !row.detail.includes('TEMP B-TREE')));
});

test('gift deletion rolls back a single ID and all 40000 matches on a final-chunk failure', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(schema.GIFT_TABLE_SCHEMA);
  migrateOvertimeSettlementOrder(db);
  db.exec(`WITH RECURSIVE rows(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM rows WHERE id < 40000)
    INSERT INTO gift_events (id, platform_id, gift_id, gift_name, uid, user_name, created_at, updated_at)
    SELECT id, 'expired-' || id, 'gift', 'gift', '1', 'viewer', '2020-01-01', '2020-01-01' FROM rows`);
  const kept = seedGift(db);
  seedSettlement(db, 1, 'pending');
  seedSettlement(db, 40000, 'pending', 'retry scheduled');
  seedSettlement(db, 2, 'applied');
  const maintenance = createGiftMaintenanceStore(db);
  assert.equal(maintenance.countGiftsByPredicate('id < ?', [Number(kept)]), 40000);
  const lastSettlement = db.prepare('SELECT status, last_error FROM overtime_settlements WHERE gift_event_id = 40000');
  const before = lastSettlement.get();
  db.exec(`CREATE TRIGGER fail_delete BEFORE DELETE ON gift_events WHEN OLD.id = 40000
    AND (SELECT status FROM overtime_settlements WHERE gift_event_id = OLD.id) = 'ignored'
    BEGIN SELECT CASE WHEN (SELECT COUNT(*) FROM gift_events) <= 1001
      THEN RAISE(ABORT, 'final chunk delete failure') ELSE RAISE(ABORT, 'single gift delete failure') END; END`);

  assert.throws(() => maintenance.deleteGiftsWithSettlements([40000], 'test:rollback', 'now'),
    /single gift delete failure/);
  assert.equal(db.isTransaction, false);
  assert.deepEqual(lastSettlement.get(), before);
  assert.ok(db.prepare('SELECT 1 FROM gift_events WHERE id = 40000').get());

  const deleteMatches = () => maintenance.deleteGiftsByPredicate('id < ?', [Number(kept)], 'retention:expired', 'now');
  assert.throws(deleteMatches, /final chunk delete failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 40001);
  assert.equal(countSettlements(db, 'pending'), 2);
  db.exec('DROP TRIGGER fail_delete');
  assert.deepEqual(deleteMatches(), { deletedGifts: 40000, ignoredSettlements: 2 });
  assert.equal(countSettlements(db, 'applied'), 1);
  assert.equal(countSettlements(db, 'ignored'), 2);
  assert.equal(db.prepare('SELECT id FROM gift_events').get().id, Number(kept));
});

test('gift-maintenance-store: countPending accuracy', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const overtimeStore = createOvertimeStore(db);
    const giftIds = [];

    // Seed gifts with pending settlements
    for (let i = 0; i < 10; i++) {
      const giftId = seedGift(db);
      giftIds.push(giftId);
      seedSettlement(db, giftId, 'pending');
    }

    // Verify initial pending count
    assert.equal(overtimeStore.countPending(), 10);

    // Delete half the gifts
    maintenance.deleteGiftsWithSettlements(giftIds.slice(0, 5), 'test:count-accuracy', new Date().toISOString());

    // Assert countPending reflects coordination
    assert.equal(overtimeStore.countPending(), 5);
    assert.equal(overtimeStore.getSettlement(giftIds[0]).last_error, 'test:count-accuracy');
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});

test('gift-maintenance-store: recent audit list without JOIN errors', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const overtimeStore = createOvertimeStore(db);

    // Seed gifts with applied settlements
    const giftIds = [];
    for (let i = 0; i < 5; i++) {
      const giftId = seedGift(db);
      giftIds.push(giftId);
      seedSettlement(db, giftId, 'applied');
    }

    // Delete parent gifts
    maintenance.deleteGiftsWithSettlements(giftIds, 'test:audit-list', new Date().toISOString());

    // Call listRecent - should not throw JOIN errors
    const recent = overtimeStore.listRecent(10);
    assert.equal(recent.length, 5);
    recent.forEach((settlement) => {
      assert.equal(settlement.status, 'applied');
    });
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});

test('clearRecent ignores only eligible pending settlements and preserves terminal audit rows', () => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const pendingGift = seedGift(db);
    const appliedGift = seedGift(db);
    const ignoredGift = seedGift(db);
    const giftWithoutSettlement = seedGift(db);
    const unpaidGift = seedGift(db, { total_price: 0 });
    seedSettlement(db, pendingGift, 'pending');
    seedSettlement(db, appliedGift, 'applied');
    seedSettlement(db, ignoredGift, 'ignored', 'prior decision');
    seedSettlement(db, unpaidGift, 'pending');
    const settlement = db.prepare(`SELECT status, rule_mode, settle_after_ms, last_error
      FROM overtime_settlements WHERE gift_event_id = ?`);
    const appliedBefore = settlement.get(appliedGift);
    const ignoredBefore = settlement.get(ignoredGift);

    const clearRecent = () => maintenance.clearRecent({ updatedAt: '2026-01-01T00:00:00.000Z' });
    assert.deepEqual(clearRecent(), { deletedGifts: 4, ignoredSettlements: 1 });
    const orphan = settlement.get(pendingGift);
    assert.equal(orphan.status, 'ignored');
    assert.equal(orphan.rule_mode, 'ignored');
    assert.equal(orphan.settle_after_ms, 0);
    assert.equal(orphan.last_error, 'manual:clear-recent');
    assert.deepEqual(settlement.get(appliedGift), appliedBefore);
    assert.deepEqual(settlement.get(ignoredGift), ignoredBefore);
    assert.equal(settlement.get(giftWithoutSettlement), undefined);

    assert.deepEqual(clearRecent(), { deletedGifts: 0, ignoredSettlements: 0 });
    assert.deepEqual(db.prepare('SELECT id FROM gift_events').all().map((row) => row.id), [unpaidGift]);
    assert.equal(settlement.get(unpaidGift).status, 'pending');
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});
