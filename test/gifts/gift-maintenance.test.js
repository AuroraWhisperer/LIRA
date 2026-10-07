'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createGiftMaintenanceStore } = require('../../src/storage/gift-maintenance-store');
const { createOvertimeStore } = require('../../src/overtime/overtime-store');
const schema = require('../../src/storage/schema');

function createTestGiftDb() {
  const tempPath = path.join(os.tmpdir(), `test-gift-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(tempPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(schema.GIFT_TABLE_SCHEMA);
  db.exec(schema.GIFT_INDEX_SCHEMA);
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

function seedSettlement(db, giftEventId, status = 'pending') {
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
    0,
    0,
    '',
    'fixed',
    '{}',
    '{}',
    timestamp,
    timestamp,
  );
}

const countSettlements = (db, status) =>
  db.prepare('SELECT COUNT(*) AS count FROM overtime_settlements WHERE status = ?').get(status).count;

for (const scenario of [
  {
    name: 'clearRecentGifts predicate',
    reason: 'manual:clear-recent',
    seed(db) {
      // Every third gift has a pending settlement, the next an applied one, the last none.
      for (let i = 0; i < 50; i++) {
        const giftId = seedGift(db, { gift_name: `Gift ${i}` });
        if (i % 3 === 0) seedSettlement(db, giftId, 'pending');
        else if (i % 3 === 1) seedSettlement(db, giftId, 'applied');
      }
      return {
        where: "status = 'active' AND total_price > 0 AND detection_status = 'final' AND gift_stats_eligible = 1",
        params: [],
      };
    },
    expected: { deleted: 50, remaining: 0, ignored: 17, applied: 17 },
  },
  {
    name: 'retention predicate',
    reason: 'retention:expired',
    seed(db) {
      const now = Date.now();
      const oldDate = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
      for (let i = 0; i < 10; i++) {
        const giftId = seedGift(db, { created_at: oldDate, updated_at: oldDate });
        seedSettlement(db, giftId, i % 2 === 0 ? 'pending' : 'applied');
      }
      for (let i = 0; i < 5; i++) seedGift(db);
      return { where: 'created_at < ?', params: [new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()] };
    },
    expected: { deleted: 10, remaining: 5, ignored: 5, applied: 5 },
  },
]) {
  test(`gift-maintenance-store: ${scenario.name} ignores pending and keeps applied settlements`, () => {
    const { db, tempPath } = createTestGiftDb();
    try {
      const maintenance = createGiftMaintenanceStore(db);
      const { where, params } = scenario.seed(db);

      const result = maintenance.deleteGiftsByPredicate(where, params, scenario.reason, new Date().toISOString());

      assert.equal(result.deletedGifts, scenario.expected.deleted);
      assert.equal(result.ignoredSettlements, scenario.expected.ignored);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, scenario.expected.remaining);
      assert.equal(countSettlements(db, 'pending'), 0);
      assert.equal(countSettlements(db, 'ignored'), scenario.expected.ignored);
      assert.equal(countSettlements(db, 'applied'), scenario.expected.applied);
    } finally {
      db.close();
      fs.unlinkSync(tempPath);
    }
  });
}

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

test('gift-maintenance-store: empty deletion', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);

    // Delete with no matching gifts
    const result = maintenance.deleteGiftsByPredicate('id = ?', [999999], 'test:empty', new Date().toISOString());

    assert.equal(result.deletedGifts, 0);
    assert.equal(result.ignoredSettlements, 0);
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});

test('gift-maintenance-store: a failed gift delete rolls back the settlement update', () => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const giftId = seedGift(db);
    seedSettlement(db, giftId, 'pending');
    // Fail after the settlement update so the transaction must undo it.
    db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON gift_events BEGIN SELECT RAISE(ABORT, 'delete failure'); END");

    assert.throws(
      () => maintenance.deleteGiftsWithSettlements([giftId], 'test:rollback', new Date().toISOString()),
      /delete failure/,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM gift_events WHERE id = ?').get(giftId).count, 1);
    const settlement = db.prepare('SELECT status, last_error FROM overtime_settlements WHERE gift_event_id = ?').get(giftId);
    assert.equal(settlement.status, 'pending');
    assert.notEqual(settlement.last_error, 'test:rollback');
    assert.equal(db.isTransaction, false);
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});

test('gift-maintenance-store: countGiftsByPredicate for dry-run', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const now = new Date();
    const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

    // Seed old gifts
    for (let i = 0; i < 15; i++) {
      seedGift(db, { created_at: oldDate, updated_at: oldDate });
    }

    // Count without deleting
    const threshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const count = maintenance.countGiftsByPredicate('created_at < ?', [threshold]);

    assert.equal(count, 15);

    // Verify no deletion occurred
    const totalCount = db.prepare('SELECT COUNT(*) AS count FROM gift_events').get();
    assert.equal(totalCount.count, 15);
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});

test('gift-maintenance-store: deleting gifts ignores only pending settlements and preserves audit rows', () => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const pendingGift = seedGift(db);
    const appliedGift = seedGift(db);
    const ignoredGift = seedGift(db);
    seedSettlement(db, pendingGift, 'pending');
    seedSettlement(db, appliedGift, 'applied');
    seedSettlement(db, ignoredGift, 'ignored');

    const result = maintenance.deleteGiftsWithSettlements(
      [pendingGift, appliedGift, ignoredGift],
      'test:mixed-states',
      new Date().toISOString(),
    );

    assert.equal(result.deletedGifts, 3);
    assert.equal(result.ignoredSettlements, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 0);
    const settlement = (giftId) =>
      db.prepare('SELECT * FROM overtime_settlements WHERE gift_event_id = ?').get(giftId);
    // The orphaned pending settlement can no longer be applied.
    const orphan = settlement(pendingGift);
    assert.equal(orphan.status, 'ignored');
    assert.equal(orphan.rule_mode, 'ignored');
    assert.equal(orphan.settle_after_ms, 0);
    assert.ok(orphan.last_error.includes('test:mixed-states'));
    // Applied and already-ignored settlements remain as the audit trail.
    assert.equal(settlement(appliedGift).status, 'applied');
    assert.equal(settlement(ignoredGift).status, 'ignored');
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});
