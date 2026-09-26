'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');

test('cloud state event stream uses DeviceBearer and parses revision-only SSE frames', async () => {
  const requests = [];
  const encoder = new TextEncoder();
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(': connected\n\n'));
            controller.enqueue(encoder.encode('event: cloud-state-changed\ndata: {"scopes":{"settings":2,'));
            controller.enqueue(encoder.encode('"songs":3,"ignored":9}}\n\n'));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        },
      );
    },
  });
  const events = [];

  await client.watchCloudStateChanges('device-token', {
    onChange(event) {
      events.push(event);
    },
  });

  assert.deepEqual(events, [{ scopes: { settings: 2, songs: 3 } }]);
  assert.equal(requests[0].url, 'https://api.lirahub.cn/api/device/cloud-state/events');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Accept, 'text/event-stream');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer device-token');
  assert.equal(requests[0].init.body, undefined);
});

test('cloud state event stream rejects non-SSE and oversized event data', async () => {
  const createClient = (response) =>
    createRemoteLicenseClient({
      baseUrl: 'https://api.lirahub.cn',
      fetchImpl: async () => response,
    });

  await assert.rejects(
    createClient(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ).watchCloudStateChanges('device-token'),
    (error) => error.code === 'INVALID_RESPONSE',
  );

  const oversized = new TextEncoder().encode(`event: cloud-state-changed\ndata: ${'x'.repeat(70_000)}\n\n`);
  await assert.rejects(
    createClient(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(oversized);
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    ).watchCloudStateChanges('device-token'),
    (error) => error.code === 'RESPONSE_TOO_LARGE',
  );
});

test('SSE budgets each event independently of network chunk boundaries', async () => {
  const count = 2000;
  const frames = Array.from({ length: count }, (_, index) =>
    `event: cloud-state-changed\r\ndata: {"scopes":{"settings":${index}}}\r\n\r\n`,
  ).join('');
  assert.ok(Buffer.byteLength(frames) > 64 * 1024);
  for (const chunks of [[frames], [frames.slice(0, 27), frames.slice(27)]]) {
    const events = [];
    const client = createRemoteLicenseClient({
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }), { headers: { 'content-type': 'text/event-stream' } }),
    });
    await client.watchCloudStateChanges('synthetic', { onChange: (event) => events.push(event) });
    assert.equal(events.length, count);
    assert.equal(events.at(-1).scopes.settings, count - 1);
  }
});

test('SSE applies the event budget to UTF-8 bytes and cancels an oversized unfinished event', async () => {
  let cancelled = false;
  let delivered = false;
  const client = createRemoteLicenseClient({
    fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) {
        if (delivered) controller.error(new Error('event budget was not applied'));
        else controller.enqueue(new TextEncoder().encode(`data: ${'字'.repeat(23000)}`));
        delivered = true;
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } }),
  });
  await assert.rejects(client.watchCloudStateChanges('synthetic'), { code: 'RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('tiny SSE chunks do not repeatedly scan the accumulated unfinished event', async (t) => {
  const frame = new TextEncoder().encode(`event: cloud-state-changed\r\ndata: ${JSON.stringify({
    scopes: { settings: 7 }, padding: 'a'.repeat(30000),
  })}\r\n\r\n`);
  let offset = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (offset < frame.length) controller.enqueue(frame.subarray(offset, ++offset));
      else controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
  const client = createRemoteLicenseClient({ fetchImpl: async () => response });
  const byteLength = Buffer.byteLength;
  let scanned = 0;
  t.mock.method(Buffer, 'byteLength', (value, encoding) => {
    scanned += value.length;
    return byteLength(value, encoding);
  });
  const events = [];
  await client.watchCloudStateChanges('synthetic', { onChange: (event) => events.push(event) });
  assert.deepEqual(events, [{ scopes: { settings: 7 } }]);
  assert.ok(scanned < frame.length * 4, `${frame.length} input bytes caused ${scanned} characters to be rescanned`);
});

test('SSE readers are cancelled and released when a consumer fails during open', async () => {
  let cancelled = 0;
  let released = 0;
  const client = createRemoteLicenseClient({
    baseUrl: 'https://review.example.test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: {
        getReader: () => ({
          read: async () => ({ done: true }),
          cancel: async () => {
            cancelled += 1;
          },
          releaseLock: () => {
            released += 1;
          },
        }),
      },
    }),
  });
  await assert.rejects(
    client.watchCloudStateChanges('fixture', {
      onOpen() {
        throw new Error('fixture consumer failure');
      },
    }),
    /fixture consumer failure/,
  );
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('a rejected non-SSE response cancels its body before retrying', async () => {
  for (const watch of ['watchCloudStateChanges', 'watchGiftEvents']) {
    let cancelled = 0;
    const client = createRemoteLicenseClient({
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled += 1;
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    });
    await assert.rejects(client[watch]('synthetic-token'), { code: 'INVALID_RESPONSE' });
    assert.equal(cancelled, 1, 'rejected response bodies must release their underlying connection');
  }
});

test('gift event stream allowlists valid SSE fields and ignores malformed blocks', async () => {
  const requests = [];
  const encoder = new TextEncoder();
  const valid = {
    eventId: 'event-1',
    cursor: 1,
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
  const invalid = {
    ...valid,
    eventId: 'event-2',
    cursor: 2,
    gift: { ...valid.gift, totalPrice: 0 },
  };
  const extended = { ...valid, cursor: 3, uid: 'not-forwarded' };
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`event: gift-event\ndata: ${JSON.stringify(valid)}\n\n`));
            controller.enqueue(encoder.encode(`event: gift-event\ndata: ${JSON.stringify(invalid)}\n\n`));
            controller.enqueue(encoder.encode(`event: gift-event\ndata: ${JSON.stringify(extended)}\n\n`));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'x-lira-gift-sync-epoch': 'epoch-1',
          },
        },
      );
    },
  });
  const events = [];
  const openedEpochs = [];

  await client.watchGiftEvents('device-token', {
    onEvent: (event) => events.push(event),
    onOpen: ({ syncEpoch }) => openedEpochs.push(syncEpoch),
  });

  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ['cursor', 'eventId', 'gift', 'phase']);
  assert.equal(Object.hasOwn(events[0], 'uid'), false);
  assert.equal(Object.hasOwn(events[0].gift, 'uid'), false);
  assert.equal(requests[0].url, 'https://api.lirahub.cn/api/device/gift-events/stream');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer device-token');
  assert.deepEqual(openedEpochs, ['epoch-1']);
  assert.equal(requests[0].init.headers['X-Lira-Gift-Identity'], '1');
});

test('gift event stream rejects an oversized sync epoch header', async () => {
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async () =>
      new Response('', {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'x-lira-gift-sync-epoch': 'x'.repeat(129),
        },
      }),
  });

  await assert.rejects(client.watchGiftEvents('device-token'), (error) => error.code === 'INVALID_RESPONSE');
});
