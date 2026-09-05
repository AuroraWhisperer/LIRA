'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  closeDatabases,
  createDatabases,
  getSchemaVersions,
} = require('../src/storage/database');
const { createGiftSyncStore } = require('../src/storage/gift-sync-store');

test('gift migration partitions remote rows and fails closed without a source', () => {
  const fixture = createFixture();
  try {
    assert.equal(getSchemaVersions(fixture.databases).giftDb, 9);
    assert.equal(
      fixture.giftDb.prepare('PRAGMA foreign_keys').get().foreign_keys,
      1,
    );
    assert.equal(hasColumn(fixture.giftDb, 'gift_events', 'source_id'), true);
    assert.equal(hasColumn(fixture.giftDb, 'gift_events', 'blind_box_id'), true);
    assert.equal(hasTable(fixture.giftDb, 'gift_sources'), true);
    assert.equal(hasTable(fixture.giftDb, 'gift_sync_state'), true);

    assert.throws(
      () => insertRemoteGift(fixture.giftDb, null, 'event-without-source'),
      /REMOTE_GIFT_SOURCE_REQUIRED/,
    );
    assert.throws(
      () => insertRemoteGift(fixture.giftDb, 999_999, 'unknown-source'),
      /REMOTE_GIFT_SOURCE_REQUIRED|FOREIGN KEY constraint failed/,
    );

    const legacyResult = fixture.giftDb
      .prepare(
        `
        INSERT INTO gift_events (
          platform_id, cmd, gift_id, gift_name, num, total_price,
          detection_status, status, created_at, updated_at
        ) VALUES ('legacy', 'SEND_GIFT', '1', 'Legacy', 1, 1,
                  'final', 'active', ?, ?)
      `,
      )
      .run(NOW, NOW);
    assert.equal(
      fixture.giftDb
        .prepare('SELECT source_id FROM gift_events WHERE id = ?')
        .get(legacyResult.lastInsertRowid).source_id,
      null,
    );
    assert.throws(
      () =>
        fixture.giftDb
          .prepare(
            "UPDATE gift_events SET cmd = 'LIRA_SERVER_GIFT' WHERE id = ?",
          )
          .run(legacyResult.lastInsertRowid),
      /REMOTE_GIFT_SOURCE_REQUIRED/,
    );

    const sourceA = fixture.store.resolveSource('a'.repeat(64));
    const sourceB = fixture.store.resolveSource('b'.repeat(64));
    insertRemoteGift(fixture.giftDb, sourceA.id, 'same-event');
    insertRemoteGift(fixture.giftDb, sourceB.id, 'same-event');
    assert.throws(
      () => insertRemoteGift(fixture.giftDb, sourceA.id, 'same-event'),
      /UNIQUE constraint failed/,
    );
  } finally {
    fixture.close();
  }
});

test('history page rows and progress token commit or roll back together', () => {
  const imported = [];
  const fixture = createFixture({
    importHistoryRecord(record, sourceId) {
      if (record.eventId === 'bad') throw new Error('INVALID_HISTORY_RECORD');
      insertRemoteGift(fixture.giftDb, sourceId, record.eventId);
      imported.push(record.eventId);
    },
  });
  try {
    const source = fixture.store.resolveSource('c'.repeat(64));
    const initial = fixture.store.getState(source.id);
    assert.equal(initial.bootstrapComplete, false);
    assert.equal(initial.projectionGeneration, 1);

    const first = fixture.store.commitHistoryPage({
      sourceId: source.id,
      projectionGeneration: 1,
      records: [{ eventId: 'one' }],
      nextPageToken: 'opaque-next',
      hasMore: true,
      recoveryCursor: 40,
      syncEpoch: 'epoch-1',
    });
    assert.equal(first.bootstrapPageToken, 'opaque-next');
    assert.equal(first.bootstrapRecoveryCursor, 40);
    assert.equal(first.bootstrapSyncEpoch, 'epoch-1');
    assert.equal(first.bootstrapComplete, false);

    assert.throws(
      () =>
        fixture.store.commitHistoryPage({
          sourceId: source.id,
          projectionGeneration: 1,
          records: [{ eventId: 'two' }, { eventId: 'bad' }],
          nextPageToken: 'must-not-commit',
          hasMore: true,
          recoveryCursor: 40,
          syncEpoch: 'epoch-1',
        }),
      /INVALID_HISTORY_RECORD/,
    );
    assert.equal(countEvent(fixture.giftDb, source.id, 'two'), 0);
    assert.equal(
      fixture.store.getState(source.id).bootstrapPageToken,
      'opaque-next',
    );

    const complete = fixture.store.commitHistoryPage({
      sourceId: source.id,
      projectionGeneration: 1,
      records: [{ eventId: 'three' }],
      nextPageToken: null,
      hasMore: false,
      recoveryCursor: 40,
      syncEpoch: 'epoch-1',
    });
    assert.equal(complete.bootstrapComplete, true);
    assert.equal(complete.bootstrapPageToken, null);
    assert.equal(complete.finalCursor, 40);
    assert.equal(complete.syncEpoch, 'epoch-1');
    assert.deepEqual(imported, ['one', 'two', 'three']);
  } finally {
    fixture.close();
  }
});

test('catch-up and projection replacement fence stale generations', () => {
  const fixture = createFixture({
    importHistoryRecord(record, sourceId) {
      insertRemoteGift(fixture.giftDb, sourceId, record.eventId);
    },
    importLiveEvent(event, sourceId) {
      insertRemoteGift(fixture.giftDb, sourceId, event.eventId);
    },
  });
  try {
    const source = fixture.store.resolveSource('d'.repeat(64));
    fixture.store.commitHistoryPage({
      sourceId: source.id,
      projectionGeneration: 1,
      records: [{ eventId: 'history' }],
      nextPageToken: null,
      hasMore: false,
      recoveryCursor: 5,
      syncEpoch: 'epoch-1',
    });
    const caughtUp = fixture.store.commitCatchUpPage({
      sourceId: source.id,
      projectionGeneration: 1,
      events: [{ eventId: 'live-6', cursor: 6 }],
      nextCursor: 6,
      syncEpoch: 'epoch-1',
      validatedAt: '2026-09-01T01:00:00.000Z',
    });
    assert.equal(caughtUp.finalCursor, 6);
    assert.equal(caughtUp.lastValidatedAt, '2026-09-01T01:00:00.000Z');

    const reset = fixture.store.resetProjectionForRebuild(source.id);
    assert.equal(reset.projectionGeneration, 2);
    assert.equal(reset.bootstrapComplete, false);
    assert.equal(reset.finalCursor, null);
    assert.equal(
      fixture.giftDb
        .prepare('SELECT COUNT(*) AS count FROM gift_events WHERE source_id = ?')
        .get(source.id).count,
      0,
    );
    assert.throws(
      () =>
        fixture.store.commitCatchUpPage({
          sourceId: source.id,
          projectionGeneration: 1,
          events: [{ eventId: 'stale', cursor: 7 }],
          nextCursor: 7,
          syncEpoch: 'epoch-1',
        }),
      /STALE_GIFT_PROJECTION/,
    );
    assert.equal(countEvent(fixture.giftDb, source.id, 'stale'), 0);
  } finally {
    fixture.close();
  }
});

test('epoch catch-up rejects cursor gaps without committing rows or progress', () => {
  const fixture = createFixture({
    importHistoryRecord(record, sourceId) {
      insertRemoteGift(fixture.giftDb, sourceId, record.eventId);
    },
    importLiveEvent(event, sourceId) {
      insertRemoteGift(fixture.giftDb, sourceId, event.eventId);
    },
  });
  try {
    const source = fixture.store.resolveSource('e'.repeat(64));
    fixture.store.commitHistoryPage({
      sourceId: source.id,
      projectionGeneration: 1,
      records: [],
      nextPageToken: null,
      hasMore: false,
      recoveryCursor: 5,
      syncEpoch: 'epoch-1',
    });

    assert.throws(
      () =>
        fixture.store.commitCatchUpPage({
          sourceId: source.id,
          projectionGeneration: 1,
          events: [{ eventId: 'gap-7', cursor: 7 }],
          nextCursor: 7,
          syncEpoch: 'epoch-1',
        }),
      /INVALID_GIFT_CATCH_UP_PAGE/,
    );
    assert.equal(fixture.store.getState(source.id).finalCursor, 5);
    assert.equal(countEvent(fixture.giftDb, source.id, 'gap-7'), 0);
  } finally {
    fixture.close();
  }
});

test('legacy page effects are discarded on rollback and run after commit', () => {
  const effects = [];
  const fixture = createFixture({
    importLiveEvent(event, sourceId, importOptions) {
      if (event.eventId === 'bad') throw new Error('INVALID_LIVE_EVENT');
      insertRemoteGift(fixture.giftDb, sourceId, event.eventId);
      importOptions.registerAfterCommit(() => {
        effects.push({
          eventId: event.eventId,
          finalCursor: fixture.store.getState(sourceId).finalCursor,
        });
      });
    },
  });
  try {
    const source = fixture.store.resolveSource('9'.repeat(64));
    assert.throws(
      () =>
        fixture.store.commitLegacyPage({
          sourceId: source.id,
          projectionGeneration: 1,
          events: [
            { eventId: 'rolled-back', cursor: 1 },
            { eventId: 'bad', cursor: 2 },
          ],
          nextCursor: 2,
        }),
      /INVALID_LIVE_EVENT/,
    );
    assert.equal(countEvent(fixture.giftDb, source.id, 'rolled-back'), 0);
    assert.deepEqual(effects, []);

    const committed = fixture.store.commitLegacyPage({
      sourceId: source.id,
      projectionGeneration: 1,
      events: [{ eventId: 'committed', cursor: 1 }],
      nextCursor: 1,
    });
    assert.equal(committed.finalCursor, 1);
    assert.deepEqual(effects, [{ eventId: 'committed', finalCursor: 1 }]);
  } finally {
    fixture.close();
  }
});

test('expired bootstrap token restart clears anchors but preserves partial rows', () => {
  const fixture = createFixture({
    importHistoryRecord(record, sourceId) {
      insertRemoteGift(fixture.giftDb, sourceId, record.eventId);
    },
  });
  try {
    const source = fixture.store.resolveSource('f'.repeat(64));
    fixture.store.commitHistoryPage({
      sourceId: source.id,
      projectionGeneration: 1,
      records: [{ eventId: 'partial' }],
      nextPageToken: 'opaque-next',
      hasMore: true,
      recoveryCursor: 40,
      syncEpoch: 'epoch-1',
    });

    const restarted = fixture.store.restartHistoryBootstrap(source.id, 1);
    assert.equal(restarted.bootstrapPageToken, null);
    assert.equal(restarted.bootstrapRecoveryCursor, null);
    assert.equal(restarted.bootstrapSyncEpoch, null);
    assert.equal(restarted.projectionGeneration, 1);
    assert.equal(countEvent(fixture.giftDb, source.id, 'partial'), 1);

    const continued = fixture.store.commitHistoryPage({
      sourceId: source.id,
      projectionGeneration: 1,
      records: [],
      nextPageToken: 'new-token',
      hasMore: true,
      recoveryCursor: 55,
      syncEpoch: 'epoch-1',
    });
    assert.equal(continued.bootstrapRecoveryCursor, 55);
  } finally {
    fixture.close();
  }
});

const NOW = '2026-09-01T00:00:00.000Z';

function createFixture(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-gift-sync-'));
  const databases = createDatabases({ dataDir });
  const fixture = {
    dataDir,
    databases,
    giftDb: databases.giftDb,
    store: null,
    close() {
      closeDatabases(databases);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  fixture.store = createGiftSyncStore({
    giftDb: fixture.giftDb,
    now: () => NOW,
    importHistoryRecord: options.importHistoryRecord,
    importLiveEvent: options.importLiveEvent,
  });
  return fixture;
}

function insertRemoteGift(giftDb, sourceId, eventId) {
  return giftDb
    .prepare(
      `
      INSERT INTO gift_events (
        source_id, platform_id, cmd, gift_id, gift_name, user_name,
        num, unit_price, total_price, detection_status, status,
        created_at, updated_at
      ) VALUES (?, ?, 'LIRA_SERVER_GIFT', '1', 'Gift', 'Viewer',
                1, 1, 1, 'final', 'active', ?, ?)
    `,
    )
    .run(sourceId, `lira-server:${eventId}`, NOW, NOW);
}

function countEvent(giftDb, sourceId, eventId) {
  return giftDb
    .prepare(
      `
      SELECT COUNT(*) AS count FROM gift_events
      WHERE source_id = ? AND platform_id = ? AND cmd = 'LIRA_SERVER_GIFT'
    `,
    )
    .get(sourceId, `lira-server:${eventId}`).count;
}

function hasTable(db, name) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function hasColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}
