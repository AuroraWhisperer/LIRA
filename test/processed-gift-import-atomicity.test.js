'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGiftSyncStore } = require('../src/storage/gift-sync-store');
const {
  createFixture,
  makeEvent,
  makeHistoryRecord,
  readGift,
} = require('./helpers/processed-gift-fixture');

test('paused gift imports roll back history and catch-up cursors until writes resume', () => {
  const fixture = createFixture();
  const store = createGiftSyncStore({
    giftDb: fixture.db.giftDb,
    importHistoryRecord: fixture.detection.importProcessedHistoryRecord,
    importLiveEvent: fixture.detection.importProcessedEvent,
  });
  try {
    const history = {
      sourceId: fixture.sourceId,
      projectionGeneration: 1,
      records: [makeHistoryRecord()],
      nextPageToken: null,
      hasMore: false,
      recoveryCursor: 5,
      syncEpoch: 'epoch-1',
    };
    const initial = store.getState(fixture.sourceId);
    fixture.detection.pauseDetection();
    assert.throws(
      () => store.commitHistoryPage(history),
      /GIFT_DETECTION_PAUSED/,
    );
    assert.deepEqual(store.getState(fixture.sourceId), initial);
    assert.equal(
      fixture.db.giftDb
        .prepare('SELECT COUNT(*) AS count FROM gift_events')
        .get().count,
      0,
    );
    fixture.detection.resumeDetection();
    store.commitHistoryPage(history);

    const event = { ...makeEvent('final', 6), eventId: 'next-final' };
    const page = {
      sourceId: fixture.sourceId,
      projectionGeneration: 1,
      events: [event],
      nextCursor: 6,
      syncEpoch: 'epoch-1',
    };
    const bootstrapped = store.getState(fixture.sourceId);
    fixture.detection.pauseDetection();
    assert.throws(() => store.commitCatchUpPage(page), /GIFT_DETECTION_PAUSED/);
    assert.deepEqual(store.getState(fixture.sourceId), bootstrapped);
    assert.equal(
      fixture.db.giftDb
        .prepare('SELECT COUNT(*) AS count FROM gift_events')
        .get().count,
      1,
    );
    fixture.detection.resumeDetection();
    assert.equal(store.commitCatchUpPage(page).finalCursor, 6);
    assert.equal(
      fixture.db.giftDb
        .prepare('SELECT COUNT(*) AS count FROM gift_events')
        .get().count,
      2,
    );
  } finally {
    fixture.close();
  }
});

test('a deferred gift delivery cannot replay its old row across a clear-all pause', () => {
  const fixture = createFixture();
  const afterCommit = [];
  try {
    const row = fixture.detection.importProcessedEvent(
      makeEvent('final', 1),
      fixture.sourceId,
      { registerAfterCommit: (callback) => afterCommit.push(callback) },
    );
    assert.equal(afterCommit.length, 1);
    fixture.detection.pauseDetection();
    fixture.db.giftDb
      .prepare('DELETE FROM gift_events WHERE id = ?')
      .run(row.id);
    fixture.detection.resumeDetection();
    afterCommit[0]();
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.finalizedIds, []);
  } finally {
    fixture.close();
  }
});

test('live final replay compares the full canonical DTO and rolls back its page', () => {
  const fixture = createFixture();
  try {
    const originalEvent = {
      ...makeEvent('final', 7, {
        giftId: ' gift  id ',
        giftName: ' Cafe\u0301\u00a0 Gift ',
        userName: ' Alice\u00a0 Smith ',
        num: 2,
        totalPrice: 0.2,
        coinType: ' GOLD ',
        isBlindBox: true,
        blindBoxId: '32251',
        blindBoxName: ' Cafe\u0301  Box ',
        blindBoxPrice: 0.1,
        blindProfit: 0.1,
        createdAt: '2027-01-15T16:00:00+08:00',
      }),
      eventId: 'existing-final',
    };
    const canonicalReplay = {
      ...makeEvent('final', 7, {
        giftId: 'gift  id',
        giftName: 'Caf\u00e9 Gift',
        userName: 'Alice Smith',
        num: 2,
        totalPrice: 0.2,
        coinType: 'gold',
        isBlindBox: true,
        blindBoxId: '32251',
        blindBoxName: 'Caf\u00e9 Box',
        blindBoxPrice: 0.1,
        blindProfit: 0.1,
      }),
      eventId: 'existing-final',
    };
    const original = fixture.importProcessedEvent(originalEvent);
    fixture.events.length = 0;
    fixture.finalizedIds.length = 0;

    const replay = fixture.importProcessedEvent(canonicalReplay);
    assert.equal(replay.id, original.id);
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.finalizedIds, []);

    const store = createGiftSyncStore({
      giftDb: fixture.db.giftDb,
      importHistoryRecord() {},
      importLiveEvent(event, sourceId, importOptions) {
        return fixture.detection.importProcessedEvent(
          event,
          sourceId,
          importOptions,
        );
      },
    });
    store.commitHistoryPage({
      sourceId: fixture.sourceId,
      projectionGeneration: 1,
      records: [],
      nextPageToken: null,
      hasMore: false,
      recoveryCursor: 5,
      syncEpoch: 'epoch-1',
    });

    const conflictCases = [
      ['giftId', { giftId: 'different-id' }],
      ['giftName', { giftName: 'Different Gift' }],
      ['userName', { userName: 'Bob' }],
      ['num', { num: 3 }],
      ['unitPriceCents', { unitPrice: 0.2 }],
      [
        'totalPriceCents/blindProfitCents',
        { totalPrice: 0.3, blindProfit: 0.2 },
      ],
      ['coinType', { coinType: 'silver' }],
      [
        'isBlindBox',
        {
          isBlindBox: false,
          blindBoxId: null,
          blindBoxName: '',
          blindBoxPrice: null,
          blindProfit: null,
        },
      ],
      ['blindBoxId', { blindBoxId: '35206' }],
      ['blindBoxName', { blindBoxName: 'Different Box' }],
      ['blindBoxPriceCents', { blindBoxPrice: 0.05, blindProfit: 0.15 }],
      ['createdAt', { createdAt: '2027-01-15T08:00:01.000Z' }],
    ];
    const originalRow = readGift(fixture.db, original.id);
    for (const [field, giftOverrides] of conflictCases) {
      const conflict = structuredClone(canonicalReplay);
      conflict.cursor = 6;
      Object.assign(conflict.gift, giftOverrides);
      assert.throws(
        () =>
          store.commitCatchUpPage({
            sourceId: fixture.sourceId,
            projectionGeneration: 1,
            events: [conflict],
            nextCursor: 6,
            syncEpoch: 'epoch-1',
            validatedAt: '2026-09-01T01:00:00.000Z',
          }),
        /PROCESSED_GIFT_EVENT_CONFLICT/,
        field,
      );
      assert.equal(store.getState(fixture.sourceId).finalCursor, 5, field);
      assert.deepEqual(readGift(fixture.db, original.id), originalRow, field);
    }
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.finalizedIds, []);

    const insertedBeforeConflict = {
      ...makeEvent('final', 6),
      eventId: 'inserted-before-conflict',
    };
    const conflict = structuredClone(canonicalReplay);
    conflict.cursor = 7;
    conflict.gift.giftName = 'Different Gift';
    assert.throws(
      () =>
        store.commitCatchUpPage({
          sourceId: fixture.sourceId,
          projectionGeneration: 1,
          events: [insertedBeforeConflict, conflict],
          nextCursor: 7,
          syncEpoch: 'epoch-1',
          validatedAt: '2026-09-01T01:00:00.000Z',
        }),
      /PROCESSED_GIFT_EVENT_CONFLICT/,
    );
    assert.equal(store.getState(fixture.sourceId).finalCursor, 5);
    assert.equal(
      fixture.db.giftDb
        .prepare(
          `
          SELECT COUNT(*) AS count FROM gift_events
          WHERE source_id = ? AND platform_id = ?
        `,
        )
        .get(fixture.sourceId, 'lira-server:inserted-before-conflict').count,
      0,
    );
    assert.deepEqual(readGift(fixture.db, original.id), originalRow);
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.finalizedIds, []);

    assert.equal(
      fixture.db.giftDb
        .prepare(
          `
          SELECT COUNT(*) AS count FROM gift_events
          WHERE source_id = ? AND cmd = 'LIRA_SERVER_GIFT'
        `,
        )
        .get(fixture.sourceId).count,
      1,
    );

    const committed = store.commitCatchUpPage({
      sourceId: fixture.sourceId,
      projectionGeneration: 1,
      events: [insertedBeforeConflict],
      nextCursor: 6,
      syncEpoch: 'epoch-1',
      validatedAt: '2026-09-01T01:00:00.000Z',
    });
    const committedRow = fixture.db.giftDb
      .prepare(
        `
        SELECT * FROM gift_events
        WHERE source_id = ? AND platform_id = ?
      `,
      )
      .get(fixture.sourceId, 'lira-server:inserted-before-conflict');
    assert.equal(committed.finalCursor, 6);
    assert.equal(committedRow.gift_stats_delivered, 1);
    assert.equal(committedRow.counted_in_sprint, 1);
    assert.deepEqual(
      fixture.events.map((event) => event.phase),
      ['final'],
    );
    assert.deepEqual(fixture.finalizedIds, [Number(committedRow.id)]);
  } finally {
    fixture.close();
  }
});
