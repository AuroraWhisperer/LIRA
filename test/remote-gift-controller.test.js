'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GiftSyncState,
  createRemoteGiftController,
} = require('../src/electron/remote-gift-controller');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');

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
  assert.deepEqual(fixture.restartCalls, [
    { sourceId: fixture.source.id, projectionGeneration: 1 },
  ]);
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
    historyPages: new Map([
      [null, historyPage({ eventIds: ['rebuilt'], recoveryCursor: 10 })],
    ]),
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
    historyPages: new Map([
      [null, historyPage({ recoveryCursor: 10 })],
    ]),
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
    catchUpPages: new Map([
      [5, legacyPage({ nextCursor: 5, hasMore: true })],
    ]),
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

test('unexpected SSE closure makes the active projection partial and offline', async () => {
  const fixture = createFixture({ closeStreamImmediately: true });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controller.getStatus().state, GiftSyncState.OFFLINE);
  assert.equal(fixture.activeContexts.at(-1).partial, true);
  assert.equal(fixture.timerDelays[0], 1_000);
  controller.dispose();
});

test('SSE epoch mismatch triggers a generation-safe rebuild', async () => {
  const fixture = createFixture({
    initialState: {
      bootstrapComplete: true,
      syncEpoch: 'epoch-1',
      finalCursor: 10,
    },
    streamEpochs: ['epoch-2', 'epoch-1'],
    historyPages: new Map([
      [null, historyPage({ eventIds: ['rebuilt'], recoveryCursor: 10 })],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.equal(fixture.resetCalls.length, 1);
  assert.deepEqual(fixture.historyImports, ['rebuilt']);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('transient discovery failure retries initialization and reaches LIVE', async () => {
  let attempts = 0;
  const fixture = createFixture({
    getGiftEventsPage() {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('REQUEST_TIMEOUT'), { retryable: true });
      return capabilityPage();
    },
  });
  const controller = createRemoteGiftController(fixture.options);
  assert.equal(await controller.start(), false);
  assert.equal(fixture.scheduledTimers.length, 1);
  assert.equal(fixture.scheduledTimers[0].delay, 1000);
  fixture.scheduledTimers[0].callback();
  await controller.whenIdle();
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('a final event burst shares one cursor catch-up task', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);
  await controller.start();
  await controller.whenIdle();
  let pulls = 0;
  fixture.options.licenseManager.getGiftEventsInternal = async () => {
    pulls += 1;
    return capabilityPage({
      nextCursor: 30, latestCursor: 30,
      events: pulls === 1 ? Array.from({ length: 20 }, (_, i) => makeEvent(`burst-${i}`, i + 11)) : [],
    });
  };
  for (let i = 0; i < 20; i += 1) fixture.stream.onEvent(makeEvent(`burst-${i}`, i + 11));
  await controller.whenIdle();
  assert.equal(controller.getCursor(), 30);
  assert.equal(pulls, 1);
  controller.dispose();
});

test('a contiguous final SSE is projected before cursor catch-up returns', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);
  await controller.start();
  await controller.whenIdle();

  const deferred = createDeferred();
  let pulls = 0;
  fixture.options.licenseManager.getGiftEventsInternal = async (input = {}) => {
    pulls += 1;
    if (input.after === 10) return deferred.promise;
    return capabilityPage({ nextCursor: 11, latestCursor: 11 });
  };

  const event = makeEvent('live-final', 11);
  fixture.stream.onEvent(event);
  await waitFor(() => pulls === 1);

  assert.deepEqual(fixture.liveImports, ['live-final']);
  assert.equal(controller.getCursor(), 10);
  assert.equal(controller.getStatus().state, GiftSyncState.CATCHING_UP);

  deferred.resolve(
    capabilityPage({
      events: [event],
      nextCursor: 11,
      latestCursor: 11,
    }),
  );
  await controller.whenIdle();

  assert.equal(controller.getCursor(), 11);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('validated SSE canonical events reach progress and immediate final handoff', async () => {
  const encoder = new TextEncoder();
  let streamController;
  let delayedRecovery;
  let recoveryCalls = 0;
  const receivedEvents = [];
  const fixture = createFixture({
    getGiftEventsPage(input) {
      if (!Object.hasOwn(input, 'after')) {
        return capabilityPage({ latestCursor: 10 });
      }
      recoveryCalls += 1;
      if (recoveryCalls === 1) {
        return capabilityPage({ nextCursor: 10, latestCursor: 10 });
      }
      delayedRecovery = createDeferred();
      return delayedRecovery.promise;
    },
    importProcessedGiftEvent(event) {
      receivedEvents.push(event);
    },
  });
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async (_url, init) => {
      const stream = new ReadableStream({
        start(controller) {
          streamController = controller;
          init.signal.addEventListener(
            'abort',
            () => controller.close(),
            { once: true },
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'x-lira-gift-sync-epoch': 'epoch-1',
        },
      });
    },
  });
  fixture.options.licenseManager.watchGiftEventsInternal = (streamOptions) =>
    client.watchGiftEvents('device-token', streamOptions);
  const controller = createRemoteGiftController(fixture.options);

  try {
    await controller.start();
    await controller.whenIdle();
    assert.equal(controller.getStatus().state, GiftSyncState.LIVE);

    const progress = { ...makeEvent('sse-progress', null), phase: 'progress' };
    streamController.enqueue(
      encoder.encode(`event: gift-event\ndata: ${JSON.stringify(progress)}\n\n`),
    );
    await waitFor(() => receivedEvents.some((event) => event.eventId === 'sse-progress'));
    const progressEvent = receivedEvents.find((event) => event.eventId === 'sse-progress');
    assert.equal(progressEvent.cursor, null);
    assert.equal(progressEvent.gift.unitPriceCents, 10);
    assert.equal(progressEvent.gift.totalPriceCents, 10);

    streamController.enqueue(
      encoder.encode(
        `event: gift-event\ndata: ${JSON.stringify(makeEvent('sse-final', 11))}\n\n`,
      ),
    );
    await waitFor(() => recoveryCalls === 2);
    await waitFor(() => receivedEvents.some((event) => event.eventId === 'sse-final'));

    const finalEvent = receivedEvents.find((event) => event.eventId === 'sse-final');
    assert.equal(finalEvent.phase, 'final');
    assert.equal(finalEvent.gift.totalPriceCents, 10);
    assert.equal(controller.getCursor(), 10);
    assert.equal(controller.getStatus().state, GiftSyncState.CATCHING_UP);
    assert.equal(fixture.timerDelays.some((delay) => delay === 1000), false);
  } finally {
    controller.dispose();
    delayedRecovery?.resolve(capabilityPage({ nextCursor: 10, latestCursor: 10 }));
    await controller.whenIdle();
  }
});

test('gift SSE wire boundary rejects malformed and privacy-sensitive extra fields', async () => {
  const encoder = new TextEncoder();
  let streamController;
  const receivedEvents = [];
  const fixture = createFixture({
    importProcessedGiftEvent(event) {
      receivedEvents.push(event);
    },
  });
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async (_url, init) => {
      const stream = new ReadableStream({
        start(controller) {
          streamController = controller;
          init.signal.addEventListener(
            'abort',
            () => controller.close(),
            { once: true },
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'x-lira-gift-sync-epoch': 'epoch-1',
        },
      });
    },
  });
  fixture.options.licenseManager.watchGiftEventsInternal = (streamOptions) =>
    client.watchGiftEvents('device-token', streamOptions);
  const controller = createRemoteGiftController(fixture.options);

  try {
    await controller.start();
    await controller.whenIdle();
    assert.equal(controller.getStatus().state, GiftSyncState.LIVE);

    const malformed = 'event: gift-event\ndata: {"eventId":\n\n';
    const topLevelExtra = {
      ...makeEvent('top-level-extra', 11),
      uid: 'private-user-id',
    };
    const giftExtra = {
      ...makeEvent('gift-extra', 12),
      gift: { ...makeEvent('gift-extra', 12).gift, roomId: 'private-room-id' },
    };
    const validProgress = { ...makeEvent('valid-progress', null), phase: 'progress' };
    streamController.enqueue(
      encoder.encode(
        [
          malformed,
          `event: gift-event\ndata: ${JSON.stringify(topLevelExtra)}\n\n`,
          `event: gift-event\ndata: ${JSON.stringify(giftExtra)}\n\n`,
          `event: gift-event\ndata: ${JSON.stringify(validProgress)}\n\n`,
        ].join(''),
      ),
    );
    await waitFor(() => receivedEvents.some((event) => event.eventId === 'valid-progress'));

    assert.deepEqual(
      receivedEvents.map((event) => event.eventId),
      ['valid-progress'],
    );
    assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  } finally {
    controller.dispose();
    await controller.whenIdle();
  }
});

test('a failed immediate final projection falls back to cursor catch-up', async () => {
  let immediateAttempts = 0;
  const fixture = createFixture({
    importProcessedGiftEvent() {
      immediateAttempts += 1;
      return Promise.reject(new Error('LOCAL_IMPORT_FAILED'));
    },
  });
  const controller = createRemoteGiftController(fixture.options);
  await controller.start();
  await controller.whenIdle();

  const deferred = createDeferred();
  let pulls = 0;
  fixture.options.licenseManager.getGiftEventsInternal = async (input = {}) => {
    pulls += 1;
    if (input.after === 10) return deferred.promise;
    return capabilityPage({ nextCursor: 11, latestCursor: 11 });
  };

  const event = makeEvent('recovered-final', 11);
  fixture.stream.onEvent(event);
  await waitFor(() => pulls === 1);

  assert.equal(immediateAttempts, 1);
  assert.deepEqual(fixture.liveImports, []);

  deferred.resolve(
    capabilityPage({
      events: [event],
      nextCursor: 11,
      latestCursor: 11,
    }),
  );
  await controller.whenIdle();

  assert.deepEqual(fixture.liveImports, ['recovered-final']);
  assert.equal(controller.getCursor(), 11);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});

test('a final SSE cursor gap waits for ordered catch-up', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);
  await controller.start();
  await controller.whenIdle();

  const deferred = createDeferred();
  let pulls = 0;
  fixture.options.licenseManager.getGiftEventsInternal = async (input = {}) => {
    pulls += 1;
    if (input.after === 10) return deferred.promise;
    return capabilityPage({ nextCursor: 13, latestCursor: 13 });
  };

  const event = makeEvent('gapped-final', 13);
  fixture.stream.onEvent(event);
  await waitFor(() => pulls === 1);

  assert.deepEqual(fixture.liveImports, []);

  deferred.resolve(
    capabilityPage({
      events: [
        makeEvent('recovered-11', 11),
        makeEvent('recovered-12', 12),
        event,
      ],
      nextCursor: 13,
      latestCursor: 13,
    }),
  );
  await controller.whenIdle();

  assert.equal(controller.getCursor(), 13);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
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

test('stop invalidates a silent-stream reconciliation callback before it pulls', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();
  const timer = fixture.scheduledTimers.find((scheduled) => scheduled.delay === 10_000);
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
  const timer = fixture.scheduledTimers.find((scheduled) => scheduled.delay === 10_000);
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
    return capabilityPage({ nextCursor: 12, latestCursor: 12, events: pulls === 2 ? [makeEvent('second', 12)] : [] });
  };
  fixture.stream.onEvent(makeEvent('first', 11));
  await waitFor(() => pulls === 1);
  fixture.stream.onEvent(makeEvent('second', 12));
  first.resolve(capabilityPage({ nextCursor: 11, latestCursor: 11, events: [makeEvent('first', 11)] }));
  await controller.whenIdle();
  assert.equal(controller.getCursor(), 12);
  assert.equal(pulls, 2);
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

function createFixture(options = {}) {
  const source = { id: 7, sourceKey: null };
  const state = { value: 'AUTHORIZED' };
  const authorization = { epoch: options.authorizationEpoch ?? 3 };
  const historyCalls = [];
  const pullCalls = [];
  const historySignals = [];
  const activeContexts = [];
  const resetCalls = [];
  const restartCalls = [];
  const historyImports = [];
  const liveImports = [];
  const catchUpCommits = [];
  const streamSignals = [];
  const timerDelays = [];
  const scheduledTimers = [];
  const baseState = {
    sourceId: source.id,
    syncEpoch: null,
    finalCursor: null,
    bootstrapComplete: false,
    bootstrapPageToken: null,
    bootstrapRecoveryCursor: null,
    bootstrapSyncEpoch: null,
    projectionGeneration: 1,
    lastValidatedAt: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...(options.initialState || {}),
  };
  const runtimeState = { ...baseState };
  const discovery =
    options.discovery || capabilityPage({ latestCursor: 10 });
  const historyPages =
    options.historyPages ||
    new Map([[null, historyPage({ eventIds: [], recoveryCursor: 10 })]]);
  const catchUpPages =
    options.catchUpPages ||
    new Map([
      [
        discovery.latestCursor,
        capabilityPage({
          events: [],
          nextCursor: discovery.latestCursor,
          latestCursor: discovery.latestCursor,
          syncEpoch: discovery.syncEpoch,
        }),
      ],
    ]);
  let stream = null;
  let streamOpenCount = 0;

  const licenseManager = {
    LicenseState: { AUTHORIZED: 'AUTHORIZED' },
    getState: () => state.value,
    getAuthorizationEpoch: () => authorization.epoch,
    getSnapshot: () => ({
      streamer: { accountName: 'alice', subdomain: 'mutable-subdomain' },
      device: { id: 'mutable-device' },
    }),
    getRemoteBaseUrl: () =>
      options.remoteBaseUrl || 'https://api.example.test',
    async getGiftEventsInternal(input = {}) {
      const after = input.after === undefined ? null : input.after;
      pullCalls.push(after);
      if (options.getGiftEventsPage) {
        return options.getGiftEventsPage(input);
      }
      if (after === null) return discovery;
      const page = catchUpPages.get(after);
      if (!page) throw new Error(`unexpected cursor ${after}`);
      if (page instanceof Error) throw page;
      return page;
    },
    async getGiftHistoryInternal(input = {}) {
      const pageToken = input.pageToken ?? null;
      historyCalls.push(pageToken);
      historySignals.push(input.signal);
      if (options.getHistoryPage) {
        return options.getHistoryPage(pageToken, input.signal);
      }
      const page = historyPages.get(pageToken);
      if (!page) throw new Error(`unexpected page token ${pageToken}`);
      if (page instanceof Error) throw page;
      return page;
    },
    watchGiftEventsInternal(streamOptions) {
      stream = streamOptions;
      streamSignals.push(streamOptions.signal);
      const configuredEpoch = Array.isArray(options.streamEpochs)
        ? options.streamEpochs[
            Math.min(streamOpenCount, options.streamEpochs.length - 1)
          ]
        : options.streamEpoch;
      streamOpenCount += 1;
      streamOptions.onOpen({
        syncEpoch:
          configuredEpoch === undefined
            ? discovery.syncEpoch || null
            : configuredEpoch,
      });
      if (options.closeStreamImmediately) return Promise.resolve();
      return new Promise((resolve) => {
        if (streamOptions.signal.aborted) return resolve();
        streamOptions.signal.addEventListener('abort', resolve, { once: true });
      });
    },
  };

  const runtime = {
    resolveGiftSource(sourceKey) {
      source.sourceKey = sourceKey;
      return { ...source };
    },
    getGiftSyncState(sourceId) {
      assert.equal(sourceId, source.id);
      return Object.freeze({ ...runtimeState });
    },
    commitGiftHistoryPage(input) {
      assertFence(input);
      for (const record of input.records) historyImports.push(record.eventId);
      runtimeState.bootstrapPageToken = input.hasMore
        ? input.nextPageToken
        : null;
      runtimeState.bootstrapRecoveryCursor = input.hasMore
        ? input.recoveryCursor
        : null;
      runtimeState.bootstrapSyncEpoch = input.hasMore ? input.syncEpoch : null;
      if (!input.hasMore) {
        runtimeState.bootstrapComplete = true;
        runtimeState.syncEpoch = input.syncEpoch;
        runtimeState.finalCursor = input.recoveryCursor;
      }
      return Object.freeze({ ...runtimeState });
    },
    restartGiftHistoryBootstrap(sourceId, projectionGeneration) {
      const input = { sourceId, projectionGeneration };
      assertFence(input);
      restartCalls.push({
        sourceId: input.sourceId,
        projectionGeneration: input.projectionGeneration,
      });
      runtimeState.bootstrapPageToken = null;
      runtimeState.bootstrapRecoveryCursor = null;
      runtimeState.bootstrapSyncEpoch = null;
      return Object.freeze({ ...runtimeState });
    },
    commitGiftCatchUpPage(input) {
      assertFence(input);
      catchUpCommits.push({ ...input });
      for (const event of input.events) liveImports.push(event.eventId);
      runtimeState.finalCursor = input.nextCursor;
      if (input.validatedAt) runtimeState.lastValidatedAt = input.validatedAt;
      return Object.freeze({ ...runtimeState });
    },
    commitLegacyGiftPage(input) {
      assertFence(input);
      for (const event of input.events) liveImports.push(event.eventId);
      runtimeState.finalCursor = input.nextCursor;
      return Object.freeze({ ...runtimeState });
    },
    resetGiftProjectionForRebuild(sourceId) {
      assert.equal(sourceId, source.id);
      resetCalls.push(sourceId);
      Object.assign(runtimeState, {
        syncEpoch: null,
        finalCursor: null,
        bootstrapComplete: false,
        bootstrapPageToken: null,
        bootstrapRecoveryCursor: null,
        bootstrapSyncEpoch: null,
        projectionGeneration: runtimeState.projectionGeneration + 1,
        lastValidatedAt: null,
      });
      return Object.freeze({ ...runtimeState });
    },
    setActiveGiftSource(context) {
      activeContexts.push({ ...context });
    },
    async importProcessedGiftEvent(event, sourceId) {
      assert.equal(sourceId, source.id);
      if (options.importProcessedGiftEvent) {
        return options.importProcessedGiftEvent(event, sourceId);
      }
      liveImports.push(event.eventId);
    },
  };

  function assertFence(input) {
    assert.equal(input.sourceId, source.id);
    if (input.projectionGeneration !== runtimeState.projectionGeneration) {
      throw new Error('STALE_GIFT_PROJECTION');
    }
  }

  return {
    source,
    state,
    authorization,
    runtimeState,
    historyCalls,
    pullCalls,
    historySignals,
    activeContexts,
    resetCalls,
    restartCalls,
    historyImports,
    liveImports,
    catchUpCommits,
    streamSignals,
    timerDelays,
    scheduledTimers,
    get stream() {
      return stream;
    },
    options: {
      licenseManager,
      runtime,
      timers: {
        setTimeout(callback, delay) {
          timerDelays.push(delay);
          const timer = { callback, delay, unref() {} };
          scheduledTimers.push(timer);
          return timer;
        },
        clearTimeout(timer) {
          timer.cleared = true;
        },
      },
      now: () => '2026-09-01T02:00:00.000Z',
    },
  };
}

function capabilityPage(overrides = {}) {
  return {
    ok: true,
    events: [],
    nextCursor: overrides.nextCursor ?? overrides.latestCursor ?? 10,
    hasMore: false,
    historyBootstrapVersion: 1,
    syncEpoch: 'epoch-1',
    earliestCursor: 1,
    latestCursor: 10,
    ...overrides,
  };
}

function legacyPage(overrides = {}) {
  return {
    ok: true,
    events: [],
    nextCursor: 5,
    hasMore: false,
    ...overrides,
  };
}

function historyPage(options = {}) {
  return {
    ok: true,
    events: (options.eventIds || []).map(makeHistoryRecord),
    nextPageToken: options.nextPageToken ?? null,
    hasMore: options.hasMore ?? false,
    recoveryCursor: options.recoveryCursor ?? 10,
    syncEpoch: options.syncEpoch || 'epoch-1',
    historyBootstrapVersion: 1,
  };
}

function makeHistoryRecord(eventId) {
  const event = makeEvent(eventId, 1);
  return { eventId: event.eventId, gift: event.gift };
}

function makeEvent(eventId, cursor) {
  return {
    eventId,
    cursor,
    phase: 'final',
    gift: {
      giftId: '33988',
      giftName: '人气票',
      userName: 'Alice',
      num: 1,
      unitPrice: 0.1,
      totalPrice: 0.1,
      coinType: 'gold',
      isBlindBox: false,
      blindBoxId: null,
      blindBoxName: '',
      blindBoxPrice: null,
      blindProfit: null,
      createdAt: '2027-01-15T08:00:00.000Z',
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition not reached');
}
