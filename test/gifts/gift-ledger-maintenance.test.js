'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { clearAllData, clearGiftData } = require('../../src/storage/database');
const { createFixture } = require('../helpers/gift-query-fixture');
const { createSettingsStore } = require('../../src/storage/settings-store');
const { applyRetentionPolicies } = require('../../src/storage/retention');
const { clearRecentGifts } = require('../../src/bilibili/gift/query-service');
const { createGiftMaintenanceStore } = require('../../src/storage/gift-maintenance-store');
const { createDomainServices } = require('../../src/server/domain-services');

const NOW = '2026-09-02T00:00:00.000Z';
const OLD = '2026-01-01T00:00:00.000Z';

test('database gift clear resets only the active source and derived settlements', () => {
  const fixture = createFixture();
  try {
    const seeded = seedPartitions(fixture);
    const result = clearGiftData(fixture.databases.giftDb, {
      sourceId: seeded.sourceA.id,
    });

    assert.equal(result.gifts, 1);
    assert.equal(result.overtimeSettlements, 1);
    assert.deepEqual(result.projectionReset, {
      sourceId: seeded.sourceA.id,
      projectionGeneration: 2,
    });
    assert.deepEqual(readGiftPartitions(fixture.databases.giftDb), [
      { platform_id: 'legacy', source_id: null },
      { platform_id: 'lira-server:b', source_id: seeded.sourceB.id },
    ]);
    assert.deepEqual(
      fixture.databases.giftDb
        .prepare('SELECT gift_event_id FROM overtime_settlements ORDER BY gift_event_id')
        .all()
        .map((row) => Number(row.gift_event_id)),
      [Number(seeded.sourceBEventId), Number(seeded.legacyId)],
    );
    const resetState = fixture.store.getState(seeded.sourceA.id);
    assert.equal(resetState.finalCursor, null);
    assert.equal(resetState.projectionGeneration, 2);
    assert.equal(fixture.store.getState(seeded.sourceB.id).finalCursor, 8);
  } finally {
    fixture.close();
  }
});

test('clear-all keeps other and legacy gift partitions while resetting current source', () => {
  const fixture = createFixture();
  try {
    const seeded = seedPartitions(fixture);
    const result = clearAllData(
      fixture.databases.songDb,
      fixture.databases.superChatDb,
      fixture.databases.giftDb,
      fixture.databases.musicDb,
      fixture.databases.checkinDb,
      { sourceId: seeded.sourceA.id },
    );

    assert.equal(result.cleared, true);
    assert.equal(result.deletedCounts.gifts, 1);
    assert.equal(result.deletedCounts.overtimeSettlements, 1);
    assert.deepEqual(result.giftProjectionReset, {
      sourceId: seeded.sourceA.id,
      projectionGeneration: 2,
    });
    assert.deepEqual(readGiftPartitions(fixture.databases.giftDb), [
      { platform_id: 'legacy', source_id: null },
      { platform_id: 'lira-server:b', source_id: seeded.sourceB.id },
    ]);
  } finally {
    fixture.close();
  }
});

test('gift clear with no current source preserves every partition', () => {
  const fixture = createFixture();
  try {
    const seeded = seedPartitions(fixture);
    const result = clearGiftData(fixture.databases.giftDb);

    assert.deepEqual(result, {
      gifts: 0,
      overtimeSettlements: 0,
      projectionReset: null,
    });
    assert.deepEqual(readGiftPartitions(fixture.databases.giftDb), [
      { platform_id: 'legacy', source_id: null },
      { platform_id: 'lira-server:a', source_id: seeded.sourceA.id },
      { platform_id: 'lira-server:b', source_id: seeded.sourceB.id },
    ]);
    assert.equal(fixture.store.getState(seeded.sourceA.id).finalCursor, 7);
    assert.equal(fixture.store.getState(seeded.sourceB.id).finalCursor, 8);
  } finally {
    fixture.close();
  }
});

test('domain gift clear resolves the active source and fails closed while switching', () => {
  const fixture = createFixture();
  const services = createDomainServices({
    db: fixture.databases,
    settingsStore: createSettingsStore(fixture.databases.songDb),
  });
  try {
    const seeded = seedPartitions(fixture);
    services.gifts.setActiveSource({
      sourceId: seeded.sourceA.id,
      syncState: 'SOURCE_SWITCHING',
    });
    assert.equal(services.data.clearGifts().projectionReset, null);
    assert.equal(fixture.store.getState(seeded.sourceA.id).finalCursor, 7);

    services.gifts.setActiveSource({
      sourceId: seeded.sourceA.id,
      syncState: 'LIVE',
    });
    assert.deepEqual(services.data.clearGifts().projectionReset, {
      sourceId: seeded.sourceA.id,
      projectionGeneration: 2,
    });
    assert.deepEqual(readGiftPartitions(fixture.databases.giftDb), [
      { platform_id: 'legacy', source_id: null },
      { platform_id: 'lira-server:b', source_id: seeded.sourceB.id },
    ]);
  } finally {
    services.gifts.dispose();
    services.overtime.dispose();
    fixture.close();
  }
});

test('domain clear-all resets the live overtime clock before another action can save it', () => {
  const fixture = createFixture();
  const services = createDomainServices({
    db: fixture.databases,
    settingsStore: createSettingsStore(fixture.databases.songDb),
  });
  try {
    services.overtime.setTime({ initialSeconds: 120, remainingSeconds: 120 });
    services.overtime.act('enable');
    services.overtime.act('start');

    assert.equal(services.data.clearAll().cleared, true);
    const snapshot = services.overtime.getSnapshot();
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.status, 'disabled');
    assert.equal(snapshot.effectiveRemainingMs, 0);
    assert.equal(snapshot.initialSeconds, 0);
    assert.equal(services.overtime.getCurrentEpoch(), 0);

    services.overtime.act('pause');
    const persisted = fixture.databases.giftDb
      .prepare('SELECT enabled, remaining_ms FROM overtime_machine_state WHERE id = 1')
      .get();
    assert.equal(persisted.enabled, 0);
    assert.equal(persisted.remaining_ms, 0);
  } finally {
    services.gifts.dispose();
    services.overtime.dispose();
    fixture.close();
  }
});

test('domain clear-all preserves the running overtime clock on a partial commit failure', () => {
  const fixture = createFixture();
  const services = createDomainServices({
    db: fixture.databases,
    settingsStore: createSettingsStore(fixture.databases.songDb),
  });
  const musicDb = fixture.databases.musicDb;
  const originalExec = musicDb.exec;
  try {
    services.overtime.setTime({ remainingSeconds: 120 });
    services.overtime.act('enable');
    services.overtime.act('start');
    musicDb.exec = function (sql) {
      if (sql === 'COMMIT') throw new Error('test commit failure');
      return originalExec.call(this, sql);
    };

    const result = services.data.clearAll();
    assert.equal(result.partial, true);
    assert.ok(result.committed.includes('giftDb'));
    const snapshot = services.overtime.getSnapshot();
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.status, 'running');
    assert.ok(snapshot.effectiveRemainingMs > 0);
  } finally {
    musicDb.exec = originalExec;
    services.gifts.dispose();
    services.overtime.dispose();
    fixture.close();
  }
});

test('retention and legacy clear-recent never delete remote-source rows', () => {
  const fixture = createFixture();
  try {
    const sourceA = fixture.store.resolveSource('e'.repeat(64));
    const sourceB = fixture.store.resolveSource('f'.repeat(64));
    fixture.insertGift(sourceA.id, 'remote-a', {
      createdAt: OLD,
    });
    fixture.insertGift(sourceB.id, 'remote-b', {
      createdAt: OLD,
    });
    fixture.insertGift(null, 'legacy-old', {
      cmd: 'SEND_GIFT',
      createdAt: OLD,
    });

    const dryRun = applyRetentionPolicies(fixture.databases, {
      dryRun: true,
      policy: {
        giftRawJsonDays: 0,
        giftEventDays: 30,
        requestDays: 0,
        superChatDays: 0,
        cooldownDays: 0,
      },
    });
    assert.equal(dryRun.giftEventsDeleted, 1);
    const applied = applyRetentionPolicies(fixture.databases, {
      policy: dryRun.policy,
    });
    assert.equal(applied.giftEventsDeleted, 1);
    assert.deepEqual(
      fixture.databases.giftDb
        .prepare('SELECT platform_id FROM gift_events ORDER BY platform_id')
        .all()
        .map((row) => row.platform_id),
      ['lira-server:remote-a', 'lira-server:remote-b'],
    );

    fixture.insertGift(null, 'legacy-recent', {
      cmd: 'SEND_GIFT',
      createdAt: NOW,
    });
    const cleared = clearRecentGifts({
      maintenanceStore: createGiftMaintenanceStore(fixture.databases.giftDb),
      getActiveGiftSource: () => ({
        sourceId: sourceA.id,
        syncState: 'LIVE',
      }),
    });
    assert.equal(cleared.deletedCount, 1);
    assert.deepEqual(
      fixture.databases.giftDb
        .prepare('SELECT platform_id FROM gift_events ORDER BY platform_id')
        .all()
        .map((row) => row.platform_id),
      ['lira-server:remote-a', 'lira-server:remote-b'],
    );
  } finally {
    fixture.close();
  }
});

function seedPartitions(fixture) {
  const giftDb = fixture.databases.giftDb;
  const sourceA = fixture.store.resolveSource('c'.repeat(64));
  const sourceB = fixture.store.resolveSource('d'.repeat(64));
  markComplete(giftDb, sourceA.id, 7);
  markComplete(giftDb, sourceB.id, 8);
  const sourceAEventId = fixture.insertGift(sourceA.id, 'a').lastInsertRowid;
  const sourceBEventId = fixture.insertGift(sourceB.id, 'b').lastInsertRowid;
  const legacyId = fixture.insertGift(null, 'legacy', {
    cmd: 'SEND_GIFT',
    platformId: 'legacy',
  }).lastInsertRowid;
  insertSettlement(giftDb, sourceAEventId, 'applied');
  insertSettlement(giftDb, sourceBEventId, 'pending');
  insertSettlement(giftDb, legacyId, 'ignored');
  return {
    sourceA,
    sourceB,
    sourceAEventId,
    sourceBEventId,
    legacyId,
  };
}

function markComplete(giftDb, sourceId, cursor) {
  giftDb
    .prepare(
      `
      UPDATE gift_sync_state
      SET sync_epoch = 'epoch-1', final_cursor = ?, bootstrap_complete = 1,
          last_validated_at = ?, updated_at = ?
      WHERE source_id = ?
    `,
    )
    .run(cursor, NOW, NOW, sourceId);
}

function insertSettlement(giftDb, giftEventId, status) {
  giftDb
    .prepare(
      `
      INSERT INTO overtime_settlements (
        gift_event_id, status, gift_id, gift_name, quantity, total_price,
        event_created_at, event_updated_at, settle_after_ms, retry_count,
        last_error, rule_mode, rule_snapshot_json, outcomes_json,
        created_at, updated_at
      ) VALUES (?, ?, 'gift-1', '礼物', 1, 1, ?, ?, 0, 0,
                '', 'fixed', '{}', '[]', ?, ?)
    `,
    )
    .run(giftEventId, status, NOW, NOW, NOW, NOW);
}

function readGiftPartitions(giftDb) {
  return giftDb
    .prepare('SELECT platform_id, source_id FROM gift_events ORDER BY platform_id')
    .all()
    .map((row) => ({
      platform_id: row.platform_id,
      source_id: row.source_id === null ? null : Number(row.source_id),
    }));
}
