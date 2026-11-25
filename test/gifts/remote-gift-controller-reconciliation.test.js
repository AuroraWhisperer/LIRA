'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GiftSyncState, createRemoteGiftController } = require('../../src/electron/remote-gift-controller');
const {
  capabilityPage,
  createDeferred,
  createFixture,
  historyPage,
  legacyPage,
  makeEvent,
  waitFor,
} = require('../helpers/remote-gift-controller-fixture');

test('unchanged retention summaries preserve the live stream and only request daily maintenance once', async (t) => {
  const f = createFixture({
    initialState: { bootstrapComplete: true, finalCursor: 10, syncEpoch: 'epoch-1' },
    discovery: capabilityPage({ giftRetentionVersion: 1 }),
  });
  let time = Date.parse('2026-09-01T02:00:00Z');
  let summaries = 0;
  let maintenance = 0;
  f.options.now = () => new Date(time).toISOString();
  f.options.runtime.getGiftRetentionProgress = () => ({ active: { revision: 1, detail_start: '2026-06-01' } });
  f.options.runtime.pruneLocalGiftRetention = () => maintenance++;
  f.options.licenseManager.getGiftSummariesInternal = async () => {
    summaries++;
    return { revision: 1, syncEpoch: 'epoch-1', detailStart: '2026-06-01', rows: [], hasMore: false };
  };
  const controller = createRemoteGiftController(f.options);
  t.after(() => controller.dispose());
  await controller.start();
  const pulls = f.pullCalls.length;
  for (const milliseconds of [10000, 600000, 86400000]) {
    time += milliseconds;
    f.scheduledTimers.at(-1).callback();
    await controller.whenIdle();
  }
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  assert.equal(summaries, 3);
  assert.equal(f.streamSignals.length, 1);
  assert.equal(f.streamSignals[0].aborted, false);
  assert.equal(f.pullCalls.length - pulls, 3);
  assert.equal(maintenance, 2);
});

test('retention staging invalidates a pending SSE reconnect and honors its remaining Retry-After', async (t) => {
  const f = createFixture({
    initialState: { bootstrapComplete: true, finalCursor: 10, syncEpoch: 'epoch-1' },
    discovery: capabilityPage({ giftRetentionVersion: 1 }),
  });
  const { runtime, licenseManager } = f.options;
  const current = { revision: 1, syncEpoch: 'epoch-1', detailStart: '2026-06-01', rows: [], hasMore: false };
  let time = Date.parse('2026-09-01T02:00:00Z');
  f.options.now = () => new Date(time).toISOString();
  runtime.getGiftRetentionProgress = () => ({ active: { revision: 1, detail_start: current.detailStart } });
  runtime.commitGiftSummaryPage = ({ page }) => ({ staging: {
    id: 2, member_snapshot_id: 1, covered_cursor: 10,
    phase: page.hasMore ? 'summaries' : 'catchup', summary_page_token: page.nextPageToken,
  } });
  let activations = 0;
  runtime.activateGiftRetention = () => { activations++; };
  runtime.pruneLocalGiftRetention = () => {};
  licenseManager.getGiftSummariesInternal = async () => current;
  const disconnect = createDeferred();
  const watch = licenseManager.watchGiftEventsInternal;
  licenseManager.watchGiftEventsInternal = options => {
    const connection = watch(options);
    return f.streamSignals.length === 1 ? Promise.race([connection, disconnect.promise]) : connection;
  };
  const controller = createRemoteGiftController(f.options);
  t.after(() => controller.dispose());
  await controller.start();
  const firstStream = f.stream;
  const summary = createDeferred();
  const lastPage = createDeferred();
  const tokens = [];
  licenseManager.getGiftSummariesInternal = ({ pageToken }) => {
    tokens.push(pageToken);
    return pageToken === null ? summary.promise : lastPage.promise;
  };
  time += 600_000;
  f.scheduledTimers.at(-1).callback();
  await waitFor(() => tokens.length === 1);
  disconnect.reject(Object.assign(new Error('disconnected'), { retryAfterMs: 60_000 }));
  await waitFor(() => f.scheduledTimers.at(-1).delay === 60_000);
  const pendingRetry = f.scheduledTimers.at(-1);
  summary.resolve({ ...current, revision: 2, hasMore: true, nextPageToken: 'next' });
  await waitFor(() => tokens.includes('next'));
  assert.equal(controller.getStatus().state, GiftSyncState.BOOTSTRAPPING);
  pendingRetry.callback();
  firstStream.onEvent(makeEvent('stale-final', 11));
  assert.equal(f.streamSignals.length, 1);
  assert.equal(controller.getStatus().state, GiftSyncState.BOOTSTRAPPING);
  assert.equal(controller.getCursor(), 10);

  time += 10_000;
  lastPage.resolve({ ...current, revision: 2 });
  await controller.whenIdle();
  assert.equal(activations, 1);
  assert.equal(f.streamSignals.length, 1);
  assert.equal(f.runtimeState.lastValidatedAt, f.options.now());
  const remainingRetry = f.scheduledTimers.at(-1);
  assert.equal(remainingRetry.delay, 50_000);
  time += remainingRetry.delay;
  remainingRetry.callback();
  await controller.whenIdle();
  assert.equal(f.streamSignals.length, 2);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  assert.equal(f.runtimeState.lastValidatedAt, f.options.now());
});

test('silent open SSE recovers finals and later ticks use the advanced cursor', async () => {
  let catchUpCalls = 0;
  const fixture = createFixture({
    getGiftEventsPage(input) {
      if (!Object.hasOwn(input, 'after')) return capabilityPage({ latestCursor: 10 });
      catchUpCalls += 1;
      if (catchUpCalls === 1) return capabilityPage({ nextCursor: 10, latestCursor: 10 });
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

  const firstTimer = fixture.scheduledTimers.find((timer) => timer.delay === 10_000);
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
      if (!Object.hasOwn(input, 'after')) return capabilityPage({ latestCursor: 10 });
      catchUpCalls += 1;
      if (catchUpCalls === 1) return capabilityPage({ nextCursor: 10, latestCursor: 10 });
      return pending.promise;
    },
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  const timer = fixture.scheduledTimers.find((scheduled) => scheduled.delay === 10_000);
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

for (const action of ['stop', 'dispose']) {
  test(`${action} invalidates a silent-stream reconciliation callback before it pulls`, async () => {
    const fixture = createFixture();
    const controller = createRemoteGiftController(fixture.options);

    await controller.start();
    await controller.whenIdle();
    const timer = fixture.scheduledTimers.find((scheduled) => scheduled.delay === 10_000);
    assert.ok(timer);
    const pullCount = fixture.pullCalls.length;

    controller[action]();
    timer.callback();
    await controller.whenIdle();

    assert.equal(timer.cleared, true);
    assert.equal(fixture.pullCalls.length, pullCount);
    assert.deepEqual(fixture.liveImports, []);
    assert.equal(controller.getStatus().state, GiftSyncState.OFFLINE);
    controller.dispose();
  });
}

test('restart invalidates the previous silent-stream callback', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();
  const timer = fixture.scheduledTimers.find((scheduled) => scheduled.delay === 10_000);
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
  const timer = fixture.scheduledTimers.find((scheduled) => scheduled.delay === 10_000);
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

  const timer = fixture.scheduledTimers.find((scheduled) => scheduled.delay === 10_000);
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
      if (!Object.hasOwn(input, 'after')) return capabilityPage({ latestCursor: 10 });
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
  const reconcileTimer = fixture.scheduledTimers.find((timer) => timer.delay === 10_000);
  assert.ok(reconcileTimer);

  reconcileTimer.callback();
  await controller.whenIdle();

  assert.equal(controller.getStatus().state, GiftSyncState.ERROR);
  const reconnectTimer = fixture.scheduledTimers.find((timer) => timer.delay === 1_000 && !timer.cleared);
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
  fixture.stream.onEvent(makeEvent('first', 11));
  assert.equal(controller.getCursor(), 11);
  const first = createDeferred();
  const afters = [];
  let pulls = 0;
  fixture.options.licenseManager.getGiftEventsInternal = async (input) => {
    afters.push(input.after);
    pulls += 1;
    if (pulls === 1) return first.promise;
    return capabilityPage({
      nextCursor: 12,
      latestCursor: 12,
      events: pulls === 2 ? [makeEvent('second', 12)] : [],
    });
  };
  fixture.scheduledTimers.at(-1).callback();
  await waitFor(() => pulls === 1);
  fixture.stream.onEvent(makeEvent('second', 12));
  assert.equal(controller.getCursor(), 11);
  assert.deepEqual(fixture.liveImports, ['first']);
  first.resolve(
    capabilityPage({
      nextCursor: 11,
      latestCursor: 11,
      events: [],
    }),
  );
  await controller.whenIdle();
  assert.equal(controller.getCursor(), 12);
  assert.equal(pulls, 2);
  assert.deepEqual(afters, [11, 11]);
  assert.deepEqual(fixture.liveImports, ['first', 'second']);
  controller.dispose();
});
