'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRemoteLicenseClient,
  RemoteLicenseError,
} = require('../src/electron/license/remote-license-client');

test('remote client accepts an HTTPS root origin', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn/',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.challenge({ deviceId: 'device' });

  assert.equal(client.baseUrl, 'https://api.lirahub.cn');
  assert.equal(
    requests[0].url,
    'https://api.lirahub.cn/api/device/challenge',
  );
});

test('remote client rejects every non-HTTPS or non-root origin', () => {
  for (const baseUrl of [
    'http://127.0.0.1:13000',
    'http://127.0.0.2:13000',
    'http://localhost:13000',
    'http://[::1]:13000',
    'http://192.168.1.10:13000',
    'https://localhost',
    'https://localhost.',
    'https://127.0.0.1',
    'https://2130706433',
    'https://[::1]',
    'https://bad_host.example',
    'https://-bad.example',
    'https://user:password@api.lirahub.cn',
    'https://api.lirahub.cn/device',
    'https://api.lirahub.cn?token=secret',
    'https://api.lirahub.cn#fragment',
  ]) {
    assert.throws(
      () =>
        createRemoteLicenseClient({
          baseUrl,
          fetchImpl: async () => new Response('{}'),
        }),
      /HTTPS root origin/,
    );
  }
});

test('remote client marks throttling and server failures retryable without retrying auth rejection', async () => {
  for (const status of [429, 503]) {
    const client = createRemoteLicenseClient({
      baseUrl: 'https://api.lirahub.cn',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: `HTTP_${status}` }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    });
    await assert.rejects(
      client.challenge({ deviceId: 'device' }),
      (error) =>
        error instanceof RemoteLicenseError &&
        error.status === status &&
        error.retryable === true,
    );
  }

  const rejected = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'SESSION_SUPERSEDED' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
  });
  await assert.rejects(
    rejected.heartbeat('token'),
    (error) =>
      error instanceof RemoteLicenseError &&
      error.code === 'SESSION_SUPERSEDED' &&
      error.retryable === false,
  );

  const proxyFailure = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async () =>
      new Response('<html>Bad Gateway</html>', { status: 502 }),
  });
  await assert.rejects(
    proxyFailure.challenge({ deviceId: 'device' }),
    (error) =>
      error instanceof RemoteLicenseError &&
      error.code === 'INVALID_RESPONSE' &&
      error.status === 502 &&
      error.retryable === true,
  );

  const authProxyRejection = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async () =>
      new Response('<html>Unauthorized</html>', { status: 401 }),
  });
  await assert.rejects(
    authProxyRejection.profile('token'),
    (error) =>
      error instanceof RemoteLicenseError &&
      error.code === 'INVALID_RESPONSE' &&
      error.status === 401 &&
      error.retryable === false,
  );
});

test('remote client does not expose arbitrary response text as an error code', async () => {
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'accessToken=secret-value' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
  });

  await assert.rejects(
    client.challenge({ deviceId: 'device' }),
    (error) => error instanceof RemoteLicenseError && error.code === 'HTTP_400',
  );
});

test('remote client rejects non-object JSON responses as protocol errors', async () => {
  for (const body of ['null', '[]', '"ok"']) {
    const client = createRemoteLicenseClient({
      baseUrl: 'https://api.lirahub.cn',
      fetchImpl: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    await assert.rejects(
      client.challenge({ deviceId: 'device' }),
      (error) =>
        error instanceof RemoteLicenseError &&
        error.code === 'INVALID_RESPONSE' &&
        error.status === 200 &&
        error.retryable === true,
    );
  }
});

test('remote client sends the device token only to the fixed heartbeat endpoint', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn/',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.heartbeat('device-token');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.lirahub.cn/api/device/heartbeat');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer device-token');
  assert.equal(requests[0].init.redirect, 'error');
});

test('remote client reads the public flat gift catalog with conditional etag requests', async () => {
  const requests = [];
  let call = 0;
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            ok: true,
            version: '42',
            gifts: [],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              etag: '"catalog-42"',
            },
          },
        );
      }
      return new Response(null, {
        status: 304,
        headers: { etag: '"catalog-42"' },
      });
    },
  });

  const first = await client.getGiftCatalog('');
  assert.equal(first.version, '42');
  assert.equal(first.etag, '"catalog-42"');
  assert.equal(
    requests[0].url,
    'https://api.lirahub.cn/api/public/gifts/catalog?schemaVersion=2',
  );
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.body, undefined);
  assert.equal(requests[0].init.headers.Authorization, undefined);

  const second = await client.getGiftCatalog(first.etag, 'should-not-be-sent');
  assert.equal(second.notModified, true);
  assert.equal(second.etag, '"catalog-42"');
  assert.equal(requests[1].init.headers['If-None-Match'], '"catalog-42"');
  assert.equal(requests[1].init.headers.Authorization, undefined);
});

test('cloud sync client keeps settings and Bilibili credentials on fixed Device endpoints', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const body = url.endsWith('/bilibili-credentials') && init.method === 'GET'
        ? {
            initialized: true,
            revision: 2,
            loggedIn: true,
            cookie: 'DedeUserID=1; SESSDATA=secret; bili_jct=csrf',
          }
        : { ok: true, revision: 2 };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.getCloudState('device-token');
  await client.updateCloudSettings({ roomId: '123' }, 'device-token');
  const credentials = await client.getBilibiliCredentials('device-token');
  await client.setBilibiliCredentials(credentials.cookie, 'device-token');
  await client.clearBilibiliCredentials('device-token');

  assert.deepEqual(
    requests.map(({ url, init }) => [
      init.method,
      new URL(url).pathname,
      init.headers.Authorization,
    ]),
    [
      ['GET', '/api/device/cloud-state', 'Bearer device-token'],
      ['PUT', '/api/device/cloud-settings', 'Bearer device-token'],
      ['GET', '/api/device/bilibili-credentials', 'Bearer device-token'],
      ['PUT', '/api/device/bilibili-credentials', 'Bearer device-token'],
      ['DELETE', '/api/device/bilibili-credentials', 'Bearer device-token'],
    ],
  );
  assert.equal(requests.every(({ url }) => !url.includes('secret')), true);
  assert.deepEqual(JSON.parse(requests[3].init.body), {
    cookie: credentials.cookie,
  });
});

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
            controller.enqueue(
              encoder.encode(
                'event: cloud-state-changed\ndata: {"scopes":{"settings":2,',
              ),
            );
            controller.enqueue(
              encoder.encode('"songs":3,"ignored":9}}\n\n'),
            );
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

  assert.deepEqual(events, [
    { scopes: { settings: 2, songs: 3 } },
  ]);
  assert.equal(
    requests[0].url,
    'https://api.lirahub.cn/api/device/cloud-state/events',
  );
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Accept, 'text/event-stream');
  assert.equal(
    requests[0].init.headers.Authorization,
    'Bearer device-token',
  );
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

  const oversized = new TextEncoder().encode(
    `event: cloud-state-changed\ndata: ${'x'.repeat(70_000)}\n\n`,
  );
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

test('gift recovery uses the fixed Device endpoint and bounded cursor query', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({ ok: true, events: [], nextCursor: 5, hasMore: false }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    },
  });

  await client.getGiftEvents(3, 200, 'device-token');

  const url = new URL(requests[0].url);
  assert.equal(url.pathname, '/api/device/gift-events');
  assert.equal(url.searchParams.get('after'), '3');
  assert.equal(url.searchParams.get('limit'), '200');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer device-token');
  assert.equal(requests[0].init.body, undefined);
});

test('gift history and epoch-aware recovery use fixed abortable Device endpoints', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const pathname = new URL(url).pathname;
      const body =
        pathname === '/api/device/gift-history'
          ? {
              ok: true,
              events: [],
              nextPageToken: null,
              hasMore: false,
              recoveryCursor: 8,
              syncEpoch: 'epoch-1',
              historyBootstrapVersion: 1,
            }
          : {
              ok: true,
              events: [],
              nextCursor: 8,
              hasMore: false,
              historyBootstrapVersion: 1,
              syncEpoch: 'epoch-1',
              earliestCursor: 1,
              latestCursor: 8,
            };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const historyAbort = new AbortController();
  const recoveryAbort = new AbortController();

  await client.getGiftHistory(
    'opaque page/+ token',
    'device-token',
    { signal: historyAbort.signal },
  );
  await client.getGiftEvents(8, 200, 'device-token', {
    syncEpoch: 'epoch-1',
    signal: recoveryAbort.signal,
  });

  const historyUrl = new URL(requests[0].url);
  assert.equal(historyUrl.pathname, '/api/device/gift-history');
  assert.equal(historyUrl.searchParams.get('pageToken'), 'opaque page/+ token');
  assert.equal(requests[0].init.signal.aborted, false);
  const recoveryUrl = new URL(requests[1].url);
  assert.equal(recoveryUrl.searchParams.get('after'), '8');
  assert.equal(recoveryUrl.searchParams.get('syncEpoch'), 'epoch-1');
  assert.equal(requests[1].init.signal.aborted, false);
  assert.equal(
    requests.every(({ init }) => init.headers.Authorization === 'Bearer device-token'),
    true,
  );
});

test('external abort is not misreported as a request timeout', async () => {
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      }),
  });
  const controller = new AbortController();
  const pending = client.getGiftHistory(null, 'device-token', {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
});

test('cloud HTTP operations preserve their caller cancellation signal', async () => {
  const signals = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://review.example.test',
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      signals.push(init.signal);
      init.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }),
  });
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const pending = [
    client.getCloudState('fixture', options),
    client.getCloudSongs('fixture', options),
    client.updateCloudSettings({}, 'fixture', options),
    client.syncSongs([], 'fixture', options),
    client.getBilibiliCredentials('fixture', options),
    client.setBilibiliCredentials('fixture', 'fixture', options),
    client.clearBilibiliCredentials('fixture', options),
  ];
  controller.abort();
  for (const request of pending) await assert.rejects(request, (error) => error.name === 'AbortError');
  assert.equal(signals.length, 7);
  assert.equal(signals.every((signal) => signal.aborted), true);
});

test('SSE readers are cancelled and released when a consumer fails during open', async () => {
  let cancelled = 0;
  let released = 0;
  const client = createRemoteLicenseClient({
    baseUrl: 'https://review.example.test',
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: { getReader: () => ({
        read: async () => ({ done: true }),
        cancel: async () => { cancelled += 1; },
        releaseLock: () => { released += 1; },
      }) },
    }),
  });
  await assert.rejects(client.watchCloudStateChanges('fixture', {
    onOpen() { throw new Error('fixture consumer failure'); },
  }), /fixture consumer failure/);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
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
            controller.enqueue(
              encoder.encode(
                `event: gift-event\ndata: ${JSON.stringify(valid)}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `event: gift-event\ndata: ${JSON.stringify(invalid)}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `event: gift-event\ndata: ${JSON.stringify(extended)}\n\n`,
              ),
            );
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
  assert.deepEqual(Object.keys(events[0]).sort(), [
    'cursor',
    'eventId',
    'gift',
    'phase',
  ]);
  assert.equal(Object.hasOwn(events[0], 'uid'), false);
  assert.equal(Object.hasOwn(events[0].gift, 'uid'), false);
  assert.equal(
    requests[0].url,
    'https://api.lirahub.cn/api/device/gift-events/stream',
  );
  assert.equal(requests[0].init.headers.Authorization, 'Bearer device-token');
  assert.deepEqual(openedEpochs, ['epoch-1']);
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

  await assert.rejects(
    client.watchGiftEvents('device-token'),
    (error) => error.code === 'INVALID_RESPONSE',
  );
});
