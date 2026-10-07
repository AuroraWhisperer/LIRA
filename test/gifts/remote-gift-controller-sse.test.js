'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GiftSyncState, createRemoteGiftController } = require('../../src/electron/remote-gift-controller');
const {
  attachSseLicenseClient,
  capabilityPage,
  createDeferred,
  createFixture,
  historyPage,
  legacyPage,
  makeEvent,
  waitFor,
} = require('../helpers/remote-gift-controller-fixture');

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
    historyPages: new Map([[null, historyPage({ eventIds: ['rebuilt'], recoveryCursor: 10 })]]),
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

test('a gapped final burst still shares one recovery pull', async (t) => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);
  t.after(() => controller.dispose());
  await controller.start();
  let pulls = 0;
  fixture.options.licenseManager.getGiftEventsInternal = async (input) => {
    pulls += 1;
    assert.equal(input.after, 10);
    return capabilityPage({
      events: Array.from({ length: 20 }, (_, i) => makeEvent('gap-' + (i + 11), i + 11)),
      nextCursor: 30,
      latestCursor: 30,
    });
  };
  for (let cursor = 12; cursor <= 30; cursor += 1) {
    fixture.stream.onEvent(makeEvent('gap-' + cursor, cursor));
  }
  await controller.whenIdle();
  assert.equal(controller.getCursor(), 30);
  assert.equal(pulls, 1);
  assert.equal(fixture.liveImports.length, 20);
});

test('spaced final SSE events commit immediately without refreshing HTTP validation', async (t) => {
  const fixture = createFixture();
  let timestamp = '2026-09-01T02:00:00.000Z';
  fixture.options.now = () => timestamp;
  const controller = createRemoteGiftController(fixture.options);
  t.after(() => controller.dispose());
  await controller.start();
  await controller.whenIdle();
  const pullCount = fixture.pullCalls.length;
  const validatedAt = fixture.runtimeState.lastValidatedAt;
  const timer = fixture.scheduledTimers.at(-1);

  for (let cursor = 11; cursor <= 20; cursor += 1) {
    timestamp = '2026-09-01T02:00:05.000Z';
    fixture.stream.onEvent(makeEvent('spaced-' + cursor, cursor));
    assert.equal(controller.getCursor(), cursor);
    assert.equal(fixture.runtimeState.finalCursor, cursor);
    assert.equal(controller.getStatus().latestCursor, cursor);
    assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(fixture.pullCalls.length, pullCount);
  assert.equal(fixture.liveImports.length, 10);
  assert.equal(fixture.runtimeState.lastValidatedAt, validatedAt);
  assert.equal(fixture.activeContexts.at(-1).syncedAt, validatedAt);
  assert.equal(fixture.activeContexts.at(-1).partial, false);
  assert.equal(fixture.scheduledTimers.at(-1), timer);
  assert.equal(timer.cleared, undefined);
});

test('validated SSE canonical events reach progress and immediate final handoff', async () => {
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
      return capabilityPage({ nextCursor: 11, latestCursor: 11 });
    },
    importProcessedGiftEvent(event) {
      receivedEvents.push(event);
    },
  });
  const commitPage = fixture.options.runtime.commitGiftCatchUpPage;
  fixture.options.runtime.commitGiftCatchUpPage = (input) => {
    receivedEvents.push(...input.events);
    return commitPage(input);
  };
  const sse = attachSseLicenseClient(fixture);
  const controller = createRemoteGiftController(fixture.options);

  try {
    await controller.start();
    await controller.whenIdle();
    assert.equal(controller.getStatus().state, GiftSyncState.LIVE);

    const progress = { ...makeEvent('sse-progress', null), phase: 'progress' };
    sse.sendRaw(sse.frame(progress));
    await waitFor(() => receivedEvents.some((event) => event.eventId === 'sse-progress'));
    const progressEvent = receivedEvents.find((event) => event.eventId === 'sse-progress');
    assert.equal(progressEvent.cursor, null);
    assert.equal(progressEvent.gift.unitPriceCents, 10);
    assert.equal(progressEvent.gift.totalPriceCents, 10);

    sse.sendRaw(sse.frame(makeEvent('sse-final', 11)));
    await waitFor(() => receivedEvents.some((event) => event.eventId === 'sse-final'));

    const finalEvent = receivedEvents.find((event) => event.eventId === 'sse-final');
    assert.equal(finalEvent.phase, 'final');
    assert.equal(finalEvent.gift.totalPriceCents, 10);
    assert.equal(controller.getCursor(), 11);
    assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
    assert.equal(recoveryCalls, 1);
    assert.equal(
      fixture.timerDelays.some((delay) => delay === 1000),
      false,
    );
  } finally {
    controller.dispose();
    await controller.whenIdle();
  }
});

test('gift SSE wire boundary rejects malformed and privacy-sensitive extra fields', async () => {
  const receivedEvents = [];
  const fixture = createFixture({
    importProcessedGiftEvent(event) {
      receivedEvents.push(event);
    },
  });
  const sse = attachSseLicenseClient(fixture);
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
    sse.sendRaw([malformed, sse.frame(topLevelExtra), sse.frame(giftExtra), sse.frame(validProgress)].join(''));
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
      events: [makeEvent('recovered-11', 11), makeEvent('recovered-12', 12), event],
      nextCursor: 13,
      latestCursor: 13,
    }),
  );
  await controller.whenIdle();

  assert.equal(controller.getCursor(), 13);
  assert.equal(controller.getStatus().state, GiftSyncState.LIVE);
  controller.dispose();
});
