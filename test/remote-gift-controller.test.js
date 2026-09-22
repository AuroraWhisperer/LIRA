'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GiftSyncState, createRemoteGiftController } = require('../src/electron/remote-gift-controller');
const {
  capabilityPage,
  createDeferred,
  createFixture,
  historyPage,
  legacyPage,
  makeEvent,
  waitFor,
} = require('./helpers/remote-gift-controller-fixture');

test('controller bootstraps history, catches recovery cursor, and becomes LIVE', async () => {
  const fixture = createFixture({
    discovery: capabilityPage({ latestCursor: 12 }),
    historyPages: new Map([
      [
        null,
        historyPage({
          eventIds: ['history-1'],
          nextPageToken: 'page-2',
          hasMore: true,
          recoveryCursor: 10,
        }),
      ],
      [
        'page-2',
        historyPage({
          eventIds: ['history-2'],
          recoveryCursor: 10,
        }),
      ],
    ]),
    catchUpPages: new Map([
      [
        10,
        capabilityPage({
          events: [makeEvent('live-11', 11), makeEvent('live-12', 12)],
          nextCursor: 12,
          latestCursor: 12,
        }),
      ],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  assert.equal(await controller.start(), true);
  await controller.whenIdle();

  assert.deepEqual(fixture.historyCalls, [null, 'page-2']);
  assert.deepEqual(fixture.pullCalls, [null, 10]);
  assert.deepEqual(fixture.historyImports, ['history-1', 'history-2']);
  assert.deepEqual(fixture.liveImports, ['live-11', 'live-12']);
  assert.equal(controller.getCursor(), 12);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  assert.equal(controller.getStatus().dirty, false);
  assert.equal(controller.getStatus().epochValidated, true);
  assert.equal(fixture.activeContexts.at(-1).syncState, GiftSyncState.LIVE);
  controller.dispose();
});

test('controller reports LEGACY_PARTIAL when history capability is absent', async () => {
  const fixture = createFixture({
    discovery: legacyPage({ nextCursor: 5 }),
    streamEpoch: null,
  });
  const controller = createRemoteGiftController(fixture.options);

  assert.equal(await controller.start(), true);
  await controller.whenIdle();

  assert.deepEqual(fixture.pullCalls, [null]);
  assert.deepEqual(fixture.historyCalls, []);
  assert.equal(fixture.runtimeState.finalCursor, 5);
  assert.equal(fixture.runtimeState.bootstrapComplete, false);
  assert.equal(controller.getStatus().state, GiftSyncState.LEGACY_PARTIAL);
  assert.equal(fixture.activeContexts.at(-1).partial, true);
  controller.dispose();
});

test('stop freezes local queries without exposing the previous source', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  controller.stop();
  await controller.whenIdle();

  assert.equal(controller.getStatus().state, GiftSyncState.OFFLINE);
  assert.equal(controller.getStatus().sourceId, null);
  assert.equal(controller.getStatus().cursor, null);
  assert.equal(controller.getStatus().latestCursor, null);
  assert.deepEqual(fixture.activeContexts.at(-1), {
    sourceId: null,
    syncState: GiftSyncState.OFFLINE,
    partial: true,
    syncedThroughCursor: null,
    syncedAt: null,
    latestCursor: null,
    dirty: false,
    epochValidated: false,
  });
  controller.dispose();
});

test('expired bootstrap token restarts from page one without resetting projection', async () => {
  const expired = new Error('BOOTSTRAP_TOKEN_EXPIRED');
  expired.code = 'BOOTSTRAP_TOKEN_EXPIRED';
  const fixture = createFixture({
    initialState: {
      bootstrapPageToken: 'expired-token',
      bootstrapRecoveryCursor: 10,
      bootstrapSyncEpoch: 'epoch-1',
    },
    discovery: capabilityPage({ latestCursor: 12 }),
    historyPages: new Map([
      ['expired-token', expired],
      [null, historyPage({ eventIds: ['history-1'], recoveryCursor: 12 })],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.deepEqual(fixture.historyCalls, ['expired-token', null]);
  assert.deepEqual(fixture.restartCalls, [{ sourceId: fixture.source.id, projectionGeneration: 1 }]);
  assert.equal(fixture.resetCalls.length, 0);
  assert.equal(fixture.runtimeState.finalCursor, 12);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('invalid bootstrap token replaces the projection before restarting', async () => {
  const invalid = new Error('INVALID_BOOTSTRAP_TOKEN');
  invalid.code = 'INVALID_BOOTSTRAP_TOKEN';
  const fixture = createFixture({
    initialState: {
      bootstrapPageToken: 'invalid-token',
      bootstrapRecoveryCursor: 10,
      bootstrapSyncEpoch: 'epoch-1',
    },
    historyPages: new Map([
      ['invalid-token', invalid],
      [null, historyPage({ eventIds: ['rebuilt'], recoveryCursor: 10 })],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.deepEqual(fixture.restartCalls, []);
  assert.deepEqual(fixture.resetCalls, [fixture.source.id]);
  assert.deepEqual(fixture.historyImports, ['rebuilt']);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('epoch mismatch replaces only the current projection before bootstrap', async () => {
  const fixture = createFixture({
    initialState: {
      bootstrapComplete: true,
      syncEpoch: 'old-epoch',
      finalCursor: 99,
    },
    discovery: capabilityPage({ syncEpoch: 'epoch-1', latestCursor: 10 }),
    historyPages: new Map([[null, historyPage({ eventIds: ['rebuilt'], recoveryCursor: 10 })]]),
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.deepEqual(fixture.resetCalls, [fixture.source.id]);
  assert.deepEqual(fixture.historyImports, ['rebuilt']);
  assert.equal(fixture.runtimeState.projectionGeneration, 2);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('late history response after stop fails the four-field fence', async () => {
  const deferred = createDeferred();
  const fixture = createFixture({
    getHistoryPage: async (_pageToken, signal) => {
      fixture.historySignals.push(signal);
      return deferred.promise;
    },
  });
  const controller = createRemoteGiftController(fixture.options);
  const starting = controller.start();
  await waitFor(() => fixture.historySignals.length >= 1);

  controller.stop();
  assert.equal(fixture.historySignals[0].aborted, true);
  deferred.resolve(historyPage({ eventIds: ['late'], recoveryCursor: 10 }));
  assert.equal(await starting, false);
  await controller.whenIdle();

  assert.deepEqual(fixture.historyImports, []);
  assert.equal(controller.getStatus().state, GiftSyncState.OFFLINE);
  controller.dispose();
});

test('authorization epoch rotation rejects the old response and restarts', async () => {
  let historyAttempt = 0;
  const fixture = createFixture({
    getHistoryPage: async () => {
      historyAttempt += 1;
      if (historyAttempt === 1) {
        fixture.authorization.epoch += 1;
        return historyPage({ eventIds: ['stale'], recoveryCursor: 10 });
      }
      return historyPage({ eventIds: ['fresh'], recoveryCursor: 10 });
    },
  });
  const controller = createRemoteGiftController(fixture.options);

  assert.equal(await controller.start(), false);
  await controller.whenIdle();

  assert.deepEqual(fixture.historyImports, ['fresh']);
  assert.deepEqual(fixture.historyCalls, [null, null]);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('epoch-aware catch-up rejects a cursor gap before committing the page', async () => {
  const fixture = createFixture({
    discovery: capabilityPage({ latestCursor: 12 }),
    historyPages: new Map([[null, historyPage({ recoveryCursor: 10 })]]),
    catchUpPages: new Map([
      [
        10,
        capabilityPage({
          events: [makeEvent('gap-12', 12)],
          nextCursor: 12,
          latestCursor: 12,
        }),
      ],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  assert.equal(await controller.start(), false);
  await controller.whenIdle();

  assert.equal(fixture.catchUpCommits.length, 0);
  assert.deepEqual(fixture.liveImports, []);
  assert.deepEqual(fixture.resetCalls, [fixture.source.id]);
  assert.equal(controller.getStatus().state, GiftSyncState.ERROR);
  controller.dispose();
});

test('bootstrap rejects a repeated continuation token without committing', async () => {
  const fixture = createFixture({
    historyPages: new Map([
      [
        null,
        historyPage({
          nextPageToken: 'repeated-token',
          hasMore: true,
        }),
      ],
      [
        'repeated-token',
        historyPage({
          nextPageToken: 'repeated-token',
          hasMore: true,
        }),
      ],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  assert.equal(await controller.start(), false);
  await controller.whenIdle();

  assert.deepEqual(fixture.historyCalls, [null, 'repeated-token']);
  assert.equal(controller.getStatus().state, GiftSyncState.ERROR);
  controller.dispose();
});

test('epoch-aware catch-up rejects a non-advancing partial page', async () => {
  const fixture = createFixture({
    initialState: {
      bootstrapComplete: true,
      syncEpoch: 'epoch-1',
      finalCursor: 10,
    },
    discovery: capabilityPage({ latestCursor: 12 }),
    catchUpPages: new Map([
      [
        10,
        capabilityPage({
          nextCursor: 10,
          hasMore: true,
          latestCursor: 12,
        }),
      ],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  assert.equal(await controller.start(), false);
  await controller.whenIdle();

  assert.equal(fixture.catchUpCommits.length, 0);
  assert.equal(controller.getStatus().state, GiftSyncState.ERROR);
  controller.dispose();
});

test('legacy catch-up rejects a non-advancing partial page', async () => {
  const fixture = createFixture({
    discovery: legacyPage({ nextCursor: 5, hasMore: true }),
    catchUpPages: new Map([[5, legacyPage({ nextCursor: 5, hasMore: true })]]),
    streamEpoch: null,
  });
  const controller = createRemoteGiftController(fixture.options);

  assert.equal(await controller.start(), true);
  fixture.stream.onEvent(makeEvent('hint-6', 6));
  await controller.whenIdle();

  assert.deepEqual(fixture.pullCalls, [null, 5]);
  assert.equal(controller.getStatus().state, GiftSyncState.ERROR);
  controller.dispose();
});

test('loopback HTTP source is rejected', async () => {
  const fixture = createFixture({
    remoteBaseUrl: 'http://127.0.0.1:13000',
  });
  const controller = createRemoteGiftController(fixture.options);

  assert.equal(await controller.start(), false);
  assert.equal(controller.getStatus().state, GiftSyncState.ERROR);
  assert.equal(fixture.source.sourceKey, null);
  controller.dispose();
});
