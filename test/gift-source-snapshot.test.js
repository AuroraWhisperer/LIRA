'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGiftService } = require('../src/bilibili/gift');
const { createGiftExportRuntime } = require('../src/server/gift-export-runtime');
const { createFixture } = require('./helpers/gift-query-fixture');

test('recent gift snapshots recover when the active source becomes readable again', (t) => {
  const fixture = createFixture();
  const gifts = createGiftService(fixture.context);
  t.after(() => {
    gifts.dispose();
    fixture.close();
  });
  const snapshots = [];
  const runtime = createGiftExportRuntime({
    getServices: () => ({ gifts }),
    broadcastSnapshot: (reason) => {
      snapshots.push({ reason, ...gifts.getSnapshot() });
    },
  });
  const sourceA = fixture.resolveSource('a'.repeat(64));
  const sourceB = fixture.resolveSource('b'.repeat(64));
  fixture.insertGift(sourceA.id, 'gift-a', { giftName: 'Gift A' });
  fixture.insertGift(sourceB.id, 'gift-b', { giftName: 'Gift B' });

  runtime.setActiveGiftSource({ sourceId: sourceA.id, syncState: 'LIVE' });
  assert.equal(snapshots.at(-1).recent[0].gift_name, 'Gift A');

  for (const syncState of [
    'BOOTSTRAPPING', 'CATCHING_UP', 'LIVE', 'LEGACY_PARTIAL', 'ERROR', 'OFFLINE',
  ]) {
    runtime.setActiveGiftSource({ sourceId: null, syncState: 'SOURCE_SWITCHING' });
    runtime.setActiveGiftSource({ sourceId: sourceA.id, syncState: 'SOURCE_SWITCHING' });
    assert.deepEqual(snapshots.at(-1).recent, []);
    assert.equal(snapshots.at(-1).viewRevision, null);
    assert.throws(() => gifts.getHistory(), { code: 'GIFT_SOURCE_UNAVAILABLE' });
    const beforeRecovery = snapshots.length;

    runtime.setActiveGiftSource({ sourceId: sourceA.id, syncState });

    assert.equal(gifts.getHistory({ range: 'all' }).items[0].eventId, 'gift-a');
    assert.deepEqual(snapshots.at(-1).recent.map((row) => row.gift_name), ['Gift A'],
      `${syncState} must refresh the recent list as soon as history is readable`);
    assert.equal(snapshots.at(-1).viewRevision, gifts.getViewRevision());
    assert.equal(snapshots.at(-1).reason, 'gift:source');
    assert.equal(snapshots.length, beforeRecovery + 1);

    runtime.setActiveGiftSource({ sourceId: sourceA.id, syncState });
    assert.equal(snapshots.length, beforeRecovery + 1);
  }

  runtime.setActiveGiftSource({ sourceId: sourceB.id, syncState: 'SOURCE_SWITCHING' });
  assert.deepEqual(snapshots.at(-1).recent, []);
  runtime.setActiveGiftSource({ sourceId: sourceB.id, syncState: 'CATCHING_UP' });
  assert.deepEqual(snapshots.at(-1).recent.map((row) => row.gift_name), ['Gift B']);

  const beforeLive = snapshots.length;
  runtime.setActiveGiftSource({ sourceId: sourceB.id, syncState: 'LIVE' });
  assert.equal(snapshots.length, beforeLive);
  runtime.setActiveGiftSource({ sourceId: null, syncState: 'OFFLINE' });
  assert.deepEqual(snapshots.at(-1).recent, []);
  assert.equal(snapshots.at(-1).viewRevision, null);
});
