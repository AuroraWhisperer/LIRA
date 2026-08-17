'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createGiftMaintenanceStore } = require('../src/storage/gift-maintenance-store');
const { createOvertimeStore } = require('../src/overtime/overtime-store');
const schema = require('../src/storage/schema');

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
    updated_at: new Date().toISOString()
  };
  const data = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO gift_events (
      platform_id, gift_id, gift_name, uid, user_name, num, unit_price, total_price,
      detection_status, gift_stats_eligible, overtime_epoch, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.platform_id, data.gift_id, data.gift_name, data.uid, data.user_name,
    data.num, data.unit_price, data.total_price, data.detection_status,
    data.gift_stats_eligible, data.overtime_epoch, data.status,
    data.created_at, data.updated_at
  );
  return result.lastInsertRowid;
}

function seedSettlement(db, giftEventId, status = 'pending') {
  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO overtime_settlements (
      gift_event_id, status, gift_id, gift_name, quantity, total_price,
      event_created_at, event_updated_at, settle_after_ms, retry_count,
      last_error, rule_mode, rule_snapshot_json, outcomes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    giftEventId, status, 'gift-1', 'Test Gift', 1, 10.0,
    timestamp, timestamp, 0, 0, '', 'fixed', '{}', '{}', timestamp, timestamp
  );
}

test('gift-maintenance-store: orphan prevention', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const giftId = seedGift(db);
    seedSettlement(db, giftId, 'pending');

    // Verify settlement exists and is pending
    let settlement = db.prepare('SELECT * FROM overtime_settlements WHERE gift_event_id = ?').get(giftId);
    assert.equal(settlement.status, 'pending');

    // Delete gift with coordination
    const result = maintenance.deleteGiftsWithSettlements([giftId], 'test:orphan-prevention', new Date().toISOString());

    // Assert gift deleted
    assert.equal(result.deletedGifts, 1);
    const gift = db.prepare('SELECT * FROM gift_events WHERE id = ?').get(giftId);
    assert.equal(gift, undefined);

    // Assert settlement marked as ignored
    assert.equal(result.ignoredSettlements, 1);
    settlement = db.prepare('SELECT * FROM overtime_settlements WHERE gift_event_id = ?').get(giftId);
    assert.equal(settlement.status, 'ignored');
    assert.equal(settlement.rule_mode, 'ignored');
    assert.equal(settlement.settle_after_ms, 0);
    assert.ok(settlement.last_error.includes('test:orphan-prevention'));
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});

test('gift-maintenance-store: audit preservation', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const giftId = seedGift(db);
    seedSettlement(db, giftId, 'applied');

    // Delete gift
    const result = maintenance.deleteGiftsWithSettlements([giftId], 'test:audit-preservation', new Date().toISOString());

    // Assert gift deleted
    assert.equal(result.deletedGifts, 1);
    const gift = db.prepare('SELECT * FROM gift_events WHERE id = ?').get(giftId);
    assert.equal(gift, undefined);

    // Assert applied settlement preserved (not deleted, not modified)
    assert.equal(result.ignoredSettlements, 0);
    const settlement = db.prepare('SELECT * FROM overtime_settlements WHERE gift_event_id = ?').get(giftId);
    assert.ok(settlement, 'Applied settlement should be preserved');
    assert.equal(settlement.status, 'applied');
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});

test('gift-maintenance-store: clearRecentGifts coordination', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const giftIds = [];

    // Seed 50 eligible gifts with mix of pending/applied settlements
    for (let i = 0; i < 50; i++) {
      const giftId = seedGift(db, { gift_name: `Gift ${i}` });
      giftIds.push(giftId);
      if (i % 3 === 0) {
        seedSettlement(db, giftId, 'pending');
      } else if (i % 3 === 1) {
        seedSettlement(db, giftId, 'applied');
      }
      // i % 3 === 2: no settlement
    }

    // Delete all eligible gifts
    const whereClause = `
      status = 'active' AND total_price > 0
      AND detection_status = 'final' AND gift_stats_eligible = 1
    `.trim();

    const result = maintenance.deleteGiftsByPredicate(
      whereClause,
      [],
      'manual:clear-recent',
      new Date().toISOString()
    );

    // Assert all gifts deleted
    assert.equal(result.deletedGifts, 50);
    const remainingGifts = db.prepare('SELECT COUNT(*) AS count FROM gift_events').get();
    assert.equal(remainingGifts.count, 0);

    // Assert no orphaned pending settlements
    const pendingCount = db.prepare(`
      SELECT COUNT(*) AS count FROM overtime_settlements WHERE status = 'pending'
    `).get();
    assert.equal(pendingCount.count, 0);

    // Assert applied settlements intact (every 3rd gift starting at 1: indices 1,4,7,10,13,16,19,22,25,28,31,34,37,40,43,46,49)
    const appliedCount = db.prepare(`
      SELECT COUNT(*) AS count FROM overtime_settlements WHERE status = 'applied'
    `).get();
    const expectedApplied = Math.floor((50 - 1) / 3) + 1; // 17 gifts have applied settlements
    assert.equal(appliedCount.count, expectedApplied);

    // Assert ignored settlements created
    const ignoredCount = db.prepare(`
      SELECT COUNT(*) AS count FROM overtime_settlements WHERE status = 'ignored'
    `).get();
    assert.ok(ignoredCount.count > 0);
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});

test('gift-maintenance-store: retention coordination', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const now = new Date();
    const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
    const recentDate = now.toISOString();

    // Seed old gifts with settlements
    const oldGiftIds = [];
    for (let i = 0; i < 10; i++) {
      const giftId = seedGift(db, { created_at: oldDate, updated_at: oldDate });
      oldGiftIds.push(giftId);
      if (i % 2 === 0) {
        seedSettlement(db, giftId, 'pending');
      } else {
        seedSettlement(db, giftId, 'applied');
      }
    }

    // Seed recent gifts
    for (let i = 0; i < 5; i++) {
      seedGift(db, { created_at: recentDate, updated_at: recentDate });
    }

    // Apply retention: delete gifts older than 30 days
    const threshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = maintenance.deleteGiftsByPredicate(
      'created_at < ?',
      [threshold],
      'retention:expired',
      now.toISOString()
    );

    // Assert old gifts deleted
    assert.equal(result.deletedGifts, 10);

    // Assert recent gifts preserved
    const remainingCount = db.prepare('SELECT COUNT(*) AS count FROM gift_events').get();
    assert.equal(remainingCount.count, 5);

    // Assert old pending settlements ignored
    const pendingCount = db.prepare(`
      SELECT COUNT(*) AS count FROM overtime_settlements WHERE status = 'pending'
    `).get();
    assert.equal(pendingCount.count, 0);

    // Assert old applied settlements preserved
    const appliedCount = db.prepare(`
      SELECT COUNT(*) AS count FROM overtime_settlements WHERE status = 'applied'
    `).get();
    assert.equal(appliedCount.count, 5);
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
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
    maintenance.deleteGiftsWithSettlements(
      giftIds.slice(0, 5),
      'test:count-accuracy',
      new Date().toISOString()
    );

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
    maintenance.deleteGiftsWithSettlements(
      giftIds,
      'test:audit-list',
      new Date().toISOString()
    );

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
    const result = maintenance.deleteGiftsByPredicate(
      'id = ?',
      [999999],
      'test:empty',
      new Date().toISOString()
    );

    assert.equal(result.deletedGifts, 0);
    assert.equal(result.ignoredSettlements, 0);
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});

test('gift-maintenance-store: transaction rollback on error', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const giftId = seedGift(db);
    seedSettlement(db, giftId, 'pending');

    // Force an error by closing the database
    db.close();

    // Attempt deletion - should throw
    assert.throws(() => {
      maintenance.deleteGiftsWithSettlements([giftId], 'test:rollback', new Date().toISOString());
    });
  } finally {
    try {
      if (db) db.close();
    } catch (_) {}
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

test('gift-maintenance-store: mixed settlement states', (t) => {
  const { db, tempPath } = createTestGiftDb();
  try {
    const maintenance = createGiftMaintenanceStore(db);
    const gift1 = seedGift(db);
    const gift2 = seedGift(db);
    const gift3 = seedGift(db);

    seedSettlement(db, gift1, 'pending');
    seedSettlement(db, gift2, 'applied');
    seedSettlement(db, gift3, 'ignored');

    // Delete all three
    const result = maintenance.deleteGiftsWithSettlements(
      [gift1, gift2, gift3],
      'test:mixed-states',
      new Date().toISOString()
    );

    // Assert all gifts deleted
    assert.equal(result.deletedGifts, 3);

    // Assert only pending settlement was updated
    assert.equal(result.ignoredSettlements, 1);

    // Verify settlement states
    const s1 = db.prepare('SELECT * FROM overtime_settlements WHERE gift_event_id = ?').get(gift1);
    const s2 = db.prepare('SELECT * FROM overtime_settlements WHERE gift_event_id = ?').get(gift2);
    const s3 = db.prepare('SELECT * FROM overtime_settlements WHERE gift_event_id = ?').get(gift3);

    assert.equal(s1.status, 'ignored');
    assert.equal(s2.status, 'applied'); // unchanged
    assert.equal(s3.status, 'ignored'); // unchanged
  } finally {
    db.close();
    fs.unlinkSync(tempPath);
  }
});
