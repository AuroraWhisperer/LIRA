'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GiftSyncState,
  createRemoteGiftController,
} = require('../src/electron/remote-gift-controller');
const {
  createRemoteLicenseClient,
} = require('../src/electron/license/remote-license-client');
const {
  capabilityPage,
  createDeferred,
  createFixture,
  historyPage,
  legacyPage,
  makeEvent,
  waitFor,
} = require('./helpers/remote-gift-controller-fixture');

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
      if (attempts === 1)
        throw Object.assign(new Error('REQUEST_TIMEOUT'), { retryable: true });
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
      nextCursor: 30,
      latestCursor: 30,
      events:
        pulls === 1
          ? Array.from({ length: 20 }, (_, i) =>
              makeEvent(`burst-${i}`, i + 11),
            )
          : [],
    });
  };
  for (let i = 0; i < 20; i += 1)
    fixture.stream.onEvent(makeEvent(`burst-${i}`, i + 11));
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
          init.signal.addEventListener('abort', () => controller.close(), {
            once: true,
          });
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
      encoder.encode(
        `event: gift-event\ndata: ${JSON.stringify(progress)}\n\n`,
      ),
    );
    await waitFor(() =>
      receivedEvents.some((event) => event.eventId === 'sse-progress'),
    );
    const progressEvent = receivedEvents.find(
      (event) => event.eventId === 'sse-progress',
    );
    assert.equal(progressEvent.cursor, null);
    assert.equal(progressEvent.gift.unitPriceCents, 10);
    assert.equal(progressEvent.gift.totalPriceCents, 10);

    streamController.enqueue(
      encoder.encode(
        `event: gift-event\ndata: ${JSON.stringify(makeEvent('sse-final', 11))}\n\n`,
      ),
    );
    await waitFor(() => recoveryCalls === 2);
    await waitFor(() =>
      receivedEvents.some((event) => event.eventId === 'sse-final'),
    );

    const finalEvent = receivedEvents.find(
      (event) => event.eventId === 'sse-final',
    );
    assert.equal(finalEvent.phase, 'final');
    assert.equal(finalEvent.gift.totalPriceCents, 10);
    assert.equal(controller.getCursor(), 10);
    assert.equal(controller.getStatus().state, GiftSyncState.CATCHING_UP);
    assert.equal(
      fixture.timerDelays.some((delay) => delay === 1000),
      false,
    );
  } finally {
    controller.dispose();
    delayedRecovery?.resolve(
      capabilityPage({ nextCursor: 10, latestCursor: 10 }),
    );
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
          init.signal.addEventListener('abort', () => controller.close(), {
            once: true,
          });
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
    const validProgress = {
      ...makeEvent('valid-progress', null),
      phase: 'progress',
    };
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
    await waitFor(() =>
      receivedEvents.some((event) => event.eventId === 'valid-progress'),
    );

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
