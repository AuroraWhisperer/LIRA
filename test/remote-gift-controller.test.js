'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRemoteGiftController,
} = require('../src/electron/remote-gift-controller');

test('remote gift controller baselines, opens SSE, then catches the race window', async () => {
  const fixture = createFixture();
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.deepEqual(fixture.pullCalls, [null, 5]);
  assert.deepEqual(
    fixture.imports.map((event) => [event.eventId, event.phase]),
    [['event-6', 'final']],
  );
  assert.deepEqual(fixture.savedCursors, [5, 6]);
  assert.equal(controller.getCursor(), 6);

  fixture.stream.onEvent(makeEvent('event-6', 'final', 6));
  fixture.stream.onEvent(makeEvent('event-7', 'progress', null));
  fixture.stream.onEvent(makeEvent('event-7', 'final', 7));
  await controller.whenIdle();

  assert.deepEqual(
    fixture.imports.map((event) => [event.eventId, event.phase]),
    [
      ['event-6', 'final'],
      ['event-7', 'progress'],
      ['event-7', 'final'],
    ],
  );
  assert.deepEqual(fixture.savedCursors, [5, 6, 7]);
  assert.equal(controller.getCursor(), 7);

  controller.stop();
  assert.equal(fixture.stream.signal.aborted, true);
  controller.dispose();
});

test('remote gift controller resumes from a durable cursor without replaying a baseline', async () => {
  const fixture = createFixture({ storedCursor: 10 });
  fixture.pages.set(10, {
    ok: true,
    events: [makeEvent('event-11', 'final', 11)],
    nextCursor: 11,
    hasMore: false,
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.deepEqual(fixture.pullCalls, [10]);
  assert.deepEqual(fixture.savedCursors, [11]);
  assert.deepEqual(
    fixture.imports.map((event) => event.eventId),
    ['event-11'],
  );

  await controller.resume();
  await controller.whenIdle();
  assert.equal(fixture.streamSignals[0].aborted, true);
  assert.equal(fixture.streamSignals.length, 2);
  controller.dispose();
});

test('remote gift controller stops delivery when authorization is unavailable', async () => {
  const fixture = createFixture();
  fixture.state.value = 'BLOCKED';
  const controller = createRemoteGiftController(fixture.options);

  assert.equal(await controller.start(), false);
  assert.deepEqual(fixture.pullCalls, []);
  assert.deepEqual(fixture.imports, []);
  controller.dispose();
});

test('remote gift controller drains bounded pages in cursor order', async () => {
  const fixture = createFixture({ storedCursor: 5 });
  fixture.pages.set(5, {
    ok: true,
    events: [makeEvent('event-6', 'final', 6)],
    nextCursor: 6,
    hasMore: true,
  });
  fixture.pages.set(6, {
    ok: true,
    events: [makeEvent('event-7', 'final', 7)],
    nextCursor: 7,
    hasMore: false,
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.deepEqual(fixture.pullCalls, [5, 6]);
  assert.deepEqual(
    fixture.imports.map((event) => event.eventId),
    ['event-6', 'event-7'],
  );
  assert.deepEqual(fixture.savedCursors, [6, 7]);
  controller.dispose();
});

test('a live final cursor gap is filled from durable recovery before delivery advances', async () => {
  const fixture = createFixture({ storedCursor: 5 });
  fixture.pages.set(5, {
    ok: true,
    events: [],
    nextCursor: 5,
    hasMore: false,
  });
  const controller = createRemoteGiftController(fixture.options);
  await controller.start();
  await controller.whenIdle();

  fixture.pages.set(5, {
    ok: true,
    events: [
      makeEvent('event-6', 'final', 6),
      makeEvent('event-7', 'final', 7),
    ],
    nextCursor: 7,
    hasMore: false,
  });
  fixture.stream.onEvent(makeEvent('event-7', 'final', 7));
  await controller.whenIdle();

  assert.deepEqual(fixture.pullCalls, [5, 5]);
  assert.deepEqual(
    fixture.imports.map((event) => event.eventId),
    ['event-6', 'event-7'],
  );
  assert.deepEqual(fixture.savedCursors, [6, 7]);
  controller.dispose();
});

test('a stalled recovery page aborts the stream and schedules a bounded reconnect', async () => {
  const fixture = createFixture({
    storedCursor: 5,
    pages: new Map([
      [
        5,
        { ok: true, events: [], nextCursor: 5, hasMore: true },
      ],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.equal(fixture.stream.signal.aborted, true);
  assert.deepEqual(fixture.timerDelays, [1_000]);
  assert.deepEqual(fixture.savedCursors, []);
  controller.dispose();
});

test('an empty recovery page cannot advance the cursor without events', async () => {
  const fixture = createFixture({
    storedCursor: 5,
    pages: new Map([
      [5, { ok: true, events: [], nextCursor: 6, hasMore: false }],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.equal(controller.getCursor(), 5);
  assert.deepEqual(fixture.savedCursors, []);
  assert.equal(fixture.stream.signal.aborted, true);
  controller.dispose();
});

test('a future stored cursor is replaced with a no-replay server baseline', async () => {
  const invalidCursor = new Error('INVALID_GIFT_CURSOR');
  invalidCursor.code = 'INVALID_GIFT_CURSOR';
  const fixture = createFixture({
    storedCursor: 50,
    pages: new Map([
      [50, invalidCursor],
      [null, { ok: true, events: [], nextCursor: 3, hasMore: false }],
    ]),
  });
  const controller = createRemoteGiftController(fixture.options);

  await controller.start();
  await controller.whenIdle();

  assert.deepEqual(fixture.pullCalls, [50, null]);
  assert.deepEqual(fixture.savedCursors, [3]);
  assert.equal(controller.getCursor(), 3);
  assert.equal(fixture.stream.signal.aborted, false);
  controller.dispose();
});

function createFixture(options = {}) {
  const state = { value: 'AUTHORIZED' };
  const pullCalls = [];
  const imports = [];
  const savedCursors = [];
  const streamSignals = [];
  const timerDelays = [];
  const timers = new Set();
  const pages = options.pages || new Map([
    [
      null,
      { ok: true, events: [], nextCursor: 5, hasMore: false },
    ],
    [
      5,
      {
        ok: true,
        events: [makeEvent('event-6', 'final', 6)],
        nextCursor: 6,
        hasMore: false,
      },
    ],
    [6, { ok: true, events: [], nextCursor: 6, hasMore: false }],
    [11, { ok: true, events: [], nextCursor: 11, hasMore: false }],
  ]);
  let stream = null;
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'AUTHORIZED' },
    getState: () => state.value,
    getSnapshot: () => ({
      streamer: { accountName: 'alice', subdomain: 'alice' },
      device: { id: 'device-a' },
    }),
    getRemoteBaseUrl: () => 'https://api.example.test',
    async getGiftEventsInternal(input = {}) {
      const after = input.after === undefined ? null : input.after;
      pullCalls.push(after);
      const page = pages.get(after);
      if (!page) throw new Error(`unexpected cursor ${after}`);
      if (page instanceof Error) throw page;
      return page;
    },
    watchGiftEventsInternal(streamOptions) {
      stream = streamOptions;
      streamSignals.push(streamOptions.signal);
      streamOptions.onOpen();
      return new Promise((resolve) => {
        if (streamOptions.signal.aborted) return resolve();
        streamOptions.signal.addEventListener('abort', resolve, { once: true });
      });
    },
  };
  const cursorStore = {
    load: () => options.storedCursor ?? null,
    save(_sourceKey, cursor) {
      savedCursors.push(cursor);
    },
  };
  return {
    state,
    pages,
    pullCalls,
    imports,
    savedCursors,
    streamSignals,
    timerDelays,
    get stream() {
      return stream;
    },
    options: {
      licenseManager,
      cursorStore,
      timers: {
        setTimeout(callback, delay) {
          const timer = { callback, delay, unref() {} };
          timers.add(timer);
          timerDelays.push(delay);
          return timer;
        },
        clearTimeout(timer) {
          timers.delete(timer);
        },
      },
      runtime: {
        async importProcessedGiftEvent(event) {
          imports.push(event);
        },
      },
    },
  };
}

function makeEvent(eventId, phase, cursor) {
  return {
    eventId,
    cursor,
    phase,
    gift: {
      giftId: '33988',
      giftName: '人气票',
      userName: 'Alice',
      num: 1,
      unitPrice: 0.1,
      totalPrice: 0.1,
      coinType: 'gold',
      isBlindBox: false,
      blindBoxName: '',
      blindBoxPrice: null,
      blindProfit: null,
      createdAt: '2027-01-15T08:00:00.000Z',
    },
  };
}
