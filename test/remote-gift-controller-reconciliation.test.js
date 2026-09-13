'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GiftSyncState,
  createRemoteGiftController,
} = require('../src/electron/remote-gift-controller');
const {
  capabilityPage,
  createDeferred,
  createFixture,
  historyPage,
  legacyPage,
  makeEvent,
  waitFor,
} = require('./helpers/remote-gift-controller-fixture');

test('silent open SSE recovers finals and later ticks use the advanced cursor', async () => {
  let catchUpCalls = 0;
  const fixture = createFixture({
    getGiftEventsPage(input) {
      if (!Object.hasOwn(input, 'after'))
        return capabilityPage({ latestCursor: 10 });
      catchUpCalls += 1;
      if (catchUpCalls === 1)
        return capabilityPage({ nextCursor: 10, latestCursor: 10 });
      if (catchUpCalls === 2) {
        return capabilityPage({
          events: [makeEvent('silent-final', 11)],
          nextCursor: 11,
          latestCursor: 11,
        });
      }
      return capabilityPage({ nextCursor: 11, latestCursor: 11 });
    },
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  const firstTimer = fixture.scheduledTimers.find(
    (timer) => timer.delay === 10_000,
  );
  assert.ok(firstTimer);
  firstTimer.callback();
  await controller.whenIdle();

  assert.deepEqual(fixture.liveImports, ['silent-final']);
  assert.equal(controller.getCursor(), 11);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);

  const secondTimer = fixture.scheduledTimers.at(-1);
  assert.notEqual(secondTimer, firstTimer);
  assert.equal(secondTimer.delay, 10_000);
  secondTimer.callback();
  await controller.whenIdle();

  assert.equal(catchUpCalls, 3);
  assert.deepEqual(fixture.pullCalls, [null, 10, 10, 11]);
  assert.equal(controller.getCursor(), 11);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('silent-stream reconciliation does not overlap a pending cursor pull', async () => {
  let catchUpCalls = 0;
  const pending = createDeferred();
  const fixture = createFixture({
    getGiftEventsPage(input) {
      if (!Object.hasOwn(input, 'after'))
        return capabilityPage({ latestCursor: 10 });
      catchUpCalls += 1;
      if (catchUpCalls === 1)
        return capabilityPage({ nextCursor: 10, latestCursor: 10 });
      return pending.promise;
    },
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  const timer = fixture.scheduledTimers.find(
    (scheduled) => scheduled.delay === 10_000,
  );
  assert.ok(timer);
  timer.callback();
  await waitFor(() => catchUpCalls === 2);

  timer.callback();
  await Promise.resolve();
  assert.equal(catchUpCalls, 2);
  assert.equal(controller.getStatus().state, GiftSyncState.CATCHING_UP);

  pending.resolve(capabilityPage({ nextCursor: 10, latestCursor: 10 }));
  await controller.whenIdle();
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('stop invalidates a silent-stream reconciliation callback before it pulls', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();
  const timer = fixture.scheduledTimers.find(
    (scheduled) => scheduled.delay === 10_000,
  );
  assert.ok(timer);
  const pullCount = fixture.pullCalls.length;

  controller.stop();
  timer.callback();
  await controller.whenIdle();

  assert.equal(timer.cleared, true);
  assert.equal(fixture.pullCalls.length, pullCount);
  assert.deepEqual(fixture.liveImports, []);
  assert.equal(controller.getStatus().state, GiftSyncState.OFFLINE);
  controller.dispose();
});

test('dispose invalidates a silent-stream reconciliation callback before it writes', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();
  const timer = fixture.scheduledTimers.find(
    (scheduled) => scheduled.delay === 10_000,
  );
  assert.ok(timer);
  const pullCount = fixture.pullCalls.length;

  controller.dispose();
  timer.callback();
  await controller.whenIdle();

  assert.equal(timer.cleared, true);
  assert.equal(fixture.pullCalls.length, pullCount);
  assert.deepEqual(fixture.liveImports, []);
  assert.equal(controller.getStatus().state, GiftSyncState.OFFLINE);
});

test('restart invalidates the previous silent-stream callback', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();
  const timer = fixture.scheduledTimers.find(
    (scheduled) => scheduled.delay === 10_000,
  );
  assert.ok(timer);

  const restarted = controller.start();
  timer.callback();
  assert.equal(timer.cleared, true);
  assert.equal(fixture.liveImports.length, 0);
  assert.equal(await restarted, true);
  await controller.whenIdle();

  assert.deepEqual(fixture.liveImports, []);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('authorization epoch fence rejects a stale silent-stream callback', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();
  const timer = fixture.scheduledTimers.find(
    (scheduled) => scheduled.delay === 10_000,
  );
  assert.ok(timer);
  fixture.authorization.epoch += 1;
  const pullCount = fixture.pullCalls.length;

  timer.callback();
  await controller.whenIdle();

  assert.equal(fixture.pullCalls.length, pullCount + 2);
  assert.deepEqual(fixture.liveImports, []);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('legacy reconciliation remains LEGACY_PARTIAL after a silent-stream pull', async () => {
  let legacyPulls = 0;
  const fixture = createFixture({
    discovery: legacyPage({ nextCursor: 5 }),
    streamEpoch: null,
    getGiftEventsPage(input) {
      if (!Object.hasOwn(input, 'after')) return legacyPage({ nextCursor: 5 });
      legacyPulls += 1;
      return legacyPage({
        events: legacyPulls === 1 ? [makeEvent('legacy-silent', 6)] : [],
        nextCursor: 6,
      });
    },
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  const timer = fixture.scheduledTimers.find(
    (scheduled) => scheduled.delay === 10_000,
  );
  assert.ok(timer);
  timer.callback();
  await controller.whenIdle();

  assert.deepEqual(fixture.liveImports, ['legacy-silent']);
  assert.equal(controller.getCursor(), 6);
  assert.equal(controller.getStatus().state, GiftSyncState.LEGACY_PARTIAL);
  assert.equal(fixture.activeContexts.at(-1).partial, true);
  controller.dispose();
});

test('repeated transient recovery failures back off and stop invalidates the retry', async () => {
  let attempts = 0;
  const fixture = createFixture({
    getGiftEventsPage() {
      attempts += 1;
      throw Object.assign(new Error('REQUEST_TIMEOUT'), { retryable: true });
    },
  });
  const controller = createRemoteGiftController(fixture.options);
  await controller.start();
  fixture.scheduledTimers[0].callback();
  await controller.whenIdle();
  assert.deepEqual(fixture.timerDelays, [1000, 2000]);
  controller.stop();
  fixture.scheduledTimers[1].callback();
  await controller.whenIdle();
  assert.equal(attempts, 2);
  controller.dispose();
});

test('retryable silent-stream pull uses reconnect backoff and cancels stale polling', async () => {
  let catchUpCalls = 0;
  const fixture = createFixture({
    getGiftEventsPage(input) {
      if (!Object.hasOwn(input, 'after'))
        return capabilityPage({ latestCursor: 10 });
      catchUpCalls += 1;
      if (catchUpCalls === 2) {
        throw Object.assign(new Error('REQUEST_TIMEOUT'), { retryable: true });
      }
      return capabilityPage({ nextCursor: 10, latestCursor: 10 });
    },
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();
  const reconcileTimer = fixture.scheduledTimers.find(
    (timer) => timer.delay === 10_000,
  );
  assert.ok(reconcileTimer);

  reconcileTimer.callback();
  await controller.whenIdle();

  assert.equal(controller.getStatus().state, GiftSyncState.ERROR);
  const reconnectTimer = fixture.scheduledTimers.find(
    (timer) => timer.delay === 1_000 && !timer.cleared,
  );
  assert.ok(reconnectTimer);
  const pullCount = fixture.pullCalls.length;
  reconcileTimer.callback();
  await controller.whenIdle();
  assert.equal(fixture.pullCalls.length, pullCount);

  reconnectTimer.callback();
  await controller.whenIdle();

  assert.equal(catchUpCalls, 3);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  assert.deepEqual(fixture.timerDelays, [10_000, 1_000, 10_000]);
  controller.dispose();
});

test('catch-up keeps an invalidation that arrives during its pending pull', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);
  await controller.start();
  await controller.whenIdle();
  const first = createDeferred();
  let pulls = 0;
  fixture.options.licenseManager.getGiftEventsInternal = async () => {
    pulls += 1;
    if (pulls === 1) return first.promise;
    return capabilityPage({
      nextCursor: 12,
      latestCursor: 12,
      events: pulls === 2 ? [makeEvent('second', 12)] : [],
    });
  };
  fixture.stream.onEvent(makeEvent('first', 11));
  await waitFor(() => pulls === 1);
  fixture.stream.onEvent(makeEvent('second', 12));
  first.resolve(
    capabilityPage({
      nextCursor: 11,
      latestCursor: 11,
      events: [makeEvent('first', 11)],
    }),
  );
  await controller.whenIdle();
  assert.equal(controller.getCursor(), 12);
  assert.equal(pulls, 2);
  controller.dispose();
});
