'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGiftSyncStore } = require('../../src/storage/gift-sync-store');
const { createRemoteGiftController, GiftSyncState } = require('../../src/electron/remote-gift-controller');
const { createFixture: createGifts, createFakeClock } = require('../helpers/processed-gift-fixture');
const { createFixture, createDeferred, capabilityPage, makeEvent, waitFor } =
  require('../helpers/remote-gift-controller-fixture');

function createPersistentFixture(t, afterImport = () => {}, afterDelivery = () => {}) {
  const gifts = createGifts();
  const fixture = createFixture();
  const deliveryCursors = [];
  const store = createGiftSyncStore({
    giftDb: gifts.db.giftDb,
    importHistoryRecord: gifts.detection.importProcessedHistoryRecord,
    importLiveEvent(event, sourceId, options) {
      const row = gifts.detection.importProcessedEvent(event, sourceId, {
        ...options,
        registerAfterCommit(callback) {
          options.registerAfterCommit(() => {
            deliveryCursors.push(store.getState(sourceId).finalCursor);
            callback();
            afterDelivery();
          });
        },
      });
      afterImport();
      return row;
    },
  });
  Object.assign(fixture.options.runtime, {
    resolveGiftSource: store.resolveSource,
    getGiftSyncState: store.getState,
    commitGiftHistoryPage: store.commitHistoryPage,
    commitGiftCatchUpPage: store.commitCatchUpPage,
    commitLegacyGiftPage: store.commitLegacyPage,
    resetGiftProjectionForRebuild: store.resetProjectionForRebuild,
    restartGiftHistoryBootstrap: store.restartHistoryBootstrap,
    importProcessedGiftEvent: gifts.detection.importProcessedEvent,
  });
  t.after(() => gifts.close());
  return { fixture, gifts, store, deliveryCursors };
}

test('SSE finals persist before effects and a new controller recovers from the saved cursor', async (t) => {
  const { fixture, gifts, store, deliveryCursors } = createPersistentFixture(t);
  let controller = createRemoteGiftController(fixture.options);
  t.after(() => controller.dispose());
  await controller.start();
  const sourceId = controller.getStatus().sourceId;
  const validatedAt = store.getState(sourceId).lastValidatedAt;
  const pullsBefore = fixture.pullCalls.length;
  const event = makeEvent('durable-final', 11);

  fixture.stream.onEvent(event);
  fixture.stream.onEvent(event);
  fixture.stream.onEvent(makeEvent('old-final', 9));
  assert.equal(store.getState(sourceId).finalCursor, 11);
  assert.equal(store.getState(sourceId).lastValidatedAt, validatedAt);
  assert.deepEqual(deliveryCursors, [11]);
  assert.equal(gifts.finalizedIds.length, 1);
  assert.equal(gifts.events.length, 1);
  assert.equal(fixture.pullCalls.length, pullsBefore);
  controller.dispose();

  fixture.options.licenseManager.getGiftEventsInternal = async (input) => {
    fixture.pullCalls.push(input.after ?? null);
    return capabilityPage({ nextCursor: 11, latestCursor: 11 });
  };
  controller = createRemoteGiftController(fixture.options);
  await controller.start();
  assert.deepEqual(fixture.pullCalls.slice(pullsBefore), [null, 11]);
  assert.equal(fixture.historyCalls.length, 1);
  assert.equal(controller.getCursor(), 11);
  fixture.stream.onEvent(event);
  fixture.stream.onEvent(makeEvent('next-final', 12));
  assert.equal(controller.getCursor(), 12);
  assert.deepEqual(deliveryCursors, [11, 12]);
  assert.equal(gifts.events.length, 2);
  assert.equal(gifts.finalizedIds.length, 2);
  assert.equal(gifts.db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 2);
});

test('a failed SSE transaction rolls back its row, cursor and effects before HTTP recovery', async (t) => {
  let failCommit = true;
  const { fixture, gifts, store, deliveryCursors } = createPersistentFixture(t, () => {
    if (failCommit) throw new Error('INJECTED_TRANSACTION_FAILURE');
  });
  const controller = createRemoteGiftController(fixture.options);
  t.after(() => controller.dispose());
  await controller.start();
  const sourceId = controller.getStatus().sourceId;
  const previousState = store.getState(sourceId);
  const pending = createDeferred();
  const afters = [];
  fixture.options.licenseManager.getGiftEventsInternal = async (input) => {
    afters.push(input.after);
    return pending.promise;
  };
  const event = makeEvent('rollback-final', 11);

  fixture.stream.onEvent(event);
  await waitFor(() => afters.length === 1);
  assert.deepEqual(store.getState(sourceId), previousState);
  assert.equal(gifts.db.giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count, 0);
  assert.deepEqual(gifts.events, []);
  assert.deepEqual(gifts.finalizedIds, []);
  assert.deepEqual(deliveryCursors, []);
  assert.equal(controller.getCursor(), 10);
  assert.deepEqual(afters, [10]);

  failCommit = false;
  pending.resolve(capabilityPage({ events: [event], nextCursor: 11, latestCursor: 11 }));
  await controller.whenIdle();
  assert.equal(store.getState(sourceId).finalCursor, 11);
  assert.deepEqual(deliveryCursors, [11]);
  assert.equal(gifts.finalizedIds.length, 1);
  assert.equal(gifts.events.length, 1);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
});

test('post-commit delivery failure reconciles from durable progress without replaying the final', async (t) => {
  const { fixture, gifts, store } = createPersistentFixture(t, () => {}, () => {
    throw new Error('LOCAL_NOTIFICATION_FAILED');
  });
  const controller = createRemoteGiftController(fixture.options);
  t.after(() => controller.dispose());
  await controller.start();
  const sourceId = controller.getStatus().sourceId;
  const afters = [];
  fixture.options.licenseManager.getGiftEventsInternal = async (input) => {
    afters.push(input.after);
    return capabilityPage({ nextCursor: 11, latestCursor: 11 });
  };

  fixture.stream.onEvent(makeEvent('committed-before-notification', 11));
  await controller.whenIdle();
  assert.deepEqual(afters, [11]);
  assert.equal(store.getState(sourceId).finalCursor, 11);
  assert.equal(controller.getCursor(), 11);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  assert.equal(gifts.events.length, 1);
  assert.equal(gifts.finalizedIds.length, 1);
});

test('continuous live commits do not postpone the ten-second reconciliation deadline', async (t) => {
  const clock = createFakeClock(Date.parse('2026-09-01T02:00:00.000Z'));
  let serverCursor = 10;
  const fixture = createFixture({
    getGiftEventsPage: () => capabilityPage({ nextCursor: serverCursor, latestCursor: serverCursor }),
  });
  fixture.options.timers = clock;
  fixture.options.now = () => new Date(clock.now()).toISOString();
  const controller = createRemoteGiftController(fixture.options);
  t.after(() => controller.dispose());
  await controller.start();
  const validatedAt = fixture.runtimeState.lastValidatedAt;

  for (let second = 1; second <= 9; second += 1) {
    clock.advance(1000);
    serverCursor += 1;
    fixture.stream.onEvent(makeEvent('continuous-' + serverCursor, serverCursor));
    await controller.whenIdle();
  }
  assert.equal(controller.getCursor(), 19);
  assert.deepEqual(fixture.pullCalls, [null, 10]);
  assert.equal(fixture.runtimeState.lastValidatedAt, validatedAt);

  // The last final is silently missed by the stream.
  serverCursor = 20;
  fixture.options.licenseManager.getGiftEventsInternal = async (input) => {
    fixture.pullCalls.push(input.after);
    return capabilityPage({ events: [makeEvent('missed-20', 20)], nextCursor: 20, latestCursor: 20 });
  };
  clock.advance(1000);
  await controller.whenIdle();
  assert.deepEqual(fixture.pullCalls, [null, 10, 19]);
  assert.equal(controller.getCursor(), 20);
  assert.equal(fixture.runtimeState.lastValidatedAt, '2026-09-01T02:00:10.000Z');
  assert.equal(fixture.liveImports.length, 10);
});

test('replaced stream callbacks cannot commit or invalidate the current stream', async (t) => {
  const fixture = createFixture();
  const streams = [];
  fixture.options.licenseManager.watchGiftEventsInternal = (options) => {
    const pending = createDeferred();
    streams.push({ options, pending });
    options.signal.addEventListener('abort', pending.resolve, { once: true });
    options.onOpen({ syncEpoch: 'epoch-1' });
    return pending.promise;
  };
  const controller = createRemoteGiftController(fixture.options);
  t.after(() => controller.dispose());
  await controller.start();
  streams[0].pending.resolve();
  await waitFor(() => controller.getStatus().state === GiftSyncState.OFFLINE);
  fixture.scheduledTimers.find((timer) => timer.delay === 1000 && !timer.cleared).callback();
  await controller.whenIdle();
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  const pullsBefore = fixture.pullCalls.length;

  streams[0].options.onOpen({ syncEpoch: 'stale-epoch' });
  streams[0].options.onEvent(makeEvent('stale-final', 11));
  assert.equal(controller.getCursor(), 10);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  streams[1].options.onEvent(makeEvent('current-final', 11));
  assert.equal(controller.getCursor(), 11);
  assert.deepEqual(fixture.liveImports, ['current-final']);
  assert.equal(fixture.pullCalls.length, pullsBefore);
});

test('a source stopped by post-commit delivery is not restored by the final handler', async (t) => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);
  t.after(() => controller.dispose());
  await controller.start();
  const commitPage = fixture.options.runtime.commitGiftCatchUpPage;
  fixture.options.runtime.commitGiftCatchUpPage = (input) => {
    const state = commitPage(input);
    controller.stop();
    return state;
  };
  const pullsBefore = fixture.pullCalls.length;
  fixture.stream.onEvent(makeEvent('last-final', 11));
  assert.equal(fixture.runtimeState.finalCursor, 11);
  assert.equal(controller.getCursor(), null);
  assert.equal(controller.getStatus().state, GiftSyncState.OFFLINE);
  assert.equal(fixture.activeContexts.at(-1).sourceId, null);
  assert.equal(fixture.pullCalls.length, pullsBefore);
});
