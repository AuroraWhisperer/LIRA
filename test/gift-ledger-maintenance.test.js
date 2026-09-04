'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  clearAllData,
  clearGiftData,
  closeDatabases,
  createDatabases,
} = require('../src/storage/database');
const { createGiftSyncStore } = require('../src/storage/gift-sync-store');
const { createSettingsStore } = require('../src/storage/settings-store');
const { applyRetentionPolicies } = require('../src/storage/retention');
const { clearRecentGifts } = require('../src/bilibili/gift/query-service');
const { createDomainServices } = require('../src/server/domain-services');

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
        .prepare(
          'SELECT gift_event_id FROM overtime_settlements ORDER BY gift_event_id',
        )
        .all()
        .map((row) => Number(row.gift_event_id)),
      [Number(seeded.sourceBEventId), Number(seeded.legacyId)],
    );
    const resetState = fixture.store.getState(seeded.sourceA.id);
    assert.equal(resetState.sourceId, seeded.sourceA.id);
    assert.equal(resetState.syncEpoch, null);
    assert.equal(resetState.finalCursor, null);
    assert.equal(resetState.bootstrapComplete, false);
    assert.equal(resetState.bootstrapPageToken, null);
    assert.equal(resetState.bootstrapRecoveryCursor, null);
    assert.equal(resetState.bootstrapSyncEpoch, null);
    assert.equal(resetState.projectionGeneration, 2);
    assert.equal(resetState.lastValidatedAt, null);
    assert.equal(Number.isFinite(Date.parse(resetState.updatedAt)), true);
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

test('retention and legacy clear-recent never delete remote-source rows', () => {
  const fixture = createFixture();
  try {
    const sourceA = fixture.store.resolveSource('e'.repeat(64));
    const sourceB = fixture.store.resolveSource('f'.repeat(64));
    insertGift(fixture.databases.giftDb, sourceA.id, 'remote-a', {
      createdAt: OLD,
    });
    insertGift(fixture.databases.giftDb, sourceB.id, 'remote-b', {
      createdAt: OLD,
    });
    insertGift(fixture.databases.giftDb, null, 'legacy-old', {
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

    insertGift(fixture.databases.giftDb, null, 'legacy-recent', {
      cmd: 'SEND_GIFT',
      createdAt: NOW,
    });
    const cleared = clearRecentGifts({
      db: fixture.databases,
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

function createFixture() {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-gift-maintenance-'),
  );
  const databases = createDatabases({ dataDir });
  return {
    dataDir,
    databases,
    store: createGiftSyncStore({ giftDb: databases.giftDb, now: () => NOW }),
    close() {
      closeDatabases(databases);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function seedPartitions(fixture) {
  const giftDb = fixture.databases.giftDb;
  const sourceA = fixture.store.resolveSource('c'.repeat(64));
  const sourceB = fixture.store.resolveSource('d'.repeat(64));
  markComplete(giftDb, sourceA.id, 7);
  markComplete(giftDb, sourceB.id, 8);
  const sourceAEventId = insertGift(giftDb, sourceA.id, 'a').lastInsertRowid;
  const sourceBEventId = insertGift(giftDb, sourceB.id, 'b').lastInsertRowid;
  const legacyId = insertGift(giftDb, null, 'legacy', {
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

function insertGift(giftDb, sourceId, eventId, overrides = {}) {
  return giftDb
    .prepare(
      `
      INSERT INTO gift_events (
        source_id, platform_id, cmd, gift_id, gift_name, user_name,
        num, unit_price, total_price, detection_status,
        gift_stats_eligible, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'gift-1', '礼物', '观众', 1, 1, 1,
                'final', 1, 'active', ?, ?)
    `,
    )
    .run(
      sourceId,
      overrides.platformId || `lira-server:${eventId}`,
      overrides.cmd || 'LIRA_SERVER_GIFT',
      overrides.createdAt || NOW,
      overrides.createdAt || NOW,
    );
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
    .prepare(
      'SELECT platform_id, source_id FROM gift_events ORDER BY platform_id',
    )
    .all()
    .map((row) => ({
      platform_id: row.platform_id,
      source_id: row.source_id === null ? null : Number(row.source_id),
    }));
}
