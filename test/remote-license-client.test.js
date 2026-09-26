'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRemoteLicenseClient, RemoteLicenseError } = require('../src/electron/license/remote-license-client');

test('activation credentials stay in the JSON POST body and never enter the URL', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://synthetic-api.example',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true }));
    },
  });
  const credentials = {
    accountName: 'audit-fixture',
    password: '  歌手😀 AuditOnly!42&?+  ',
    activationCode: 'SYNTHETIC-CODE-008-011',
  };
  await client.activate(credentials);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://synthetic-api.example/api/device/activate');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(new Headers(requests[0].init.headers).get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(requests[0].init.body), credentials);
});

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
  assert.equal(requests[0].url, 'https://api.lirahub.cn/api/device/challenge');
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
      (error) => error instanceof RemoteLicenseError && error.status === status && error.retryable === true,
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
    (error) => error instanceof RemoteLicenseError && error.code === 'SESSION_SUPERSEDED' && error.retryable === false,
  );

  const proxyFailure = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async () => new Response('<html>Bad Gateway</html>', { status: 502 }),
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
    fetchImpl: async () => new Response('<html>Unauthorized</html>', { status: 401 }),
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

test('remote client carries only safe song error indexes', async () => {
  const values = [
    { value: 2, expected: 2 },
    { value: -1 },
    { value: 1.5 },
    { value: Number.MAX_SAFE_INTEGER + 1 },
    { value: '2' },
  ];
  for (const { value, expected } of values) {
    const client = createRemoteLicenseClient({
      baseUrl: 'https://api.lirahub.cn',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: 'INVALID_SONG', index: value }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    });
    await assert.rejects(client.syncSongs([], 'device-token'), (error) => {
      assert.equal(error instanceof RemoteLicenseError, true);
      assert.equal(error.code, 'INVALID_SONG');
      if (expected === undefined) assert.equal(error.index, undefined);
      else assert.equal(error.index, expected);
      return true;
    });
  }
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
  assert.equal(requests[0].url, 'https://api.lirahub.cn/api/public/gifts/catalog?schemaVersion=3');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.body, undefined);
  assert.equal(requests[0].init.headers.Authorization, undefined);

  const second = await client.getGiftCatalog(first.etag, 'should-not-be-sent');
  assert.equal(second.notModified, true);
  assert.equal(second.etag, '"catalog-42"');
  assert.equal(requests[1].init.headers['If-None-Match'], '"catalog-42"');
  assert.equal(requests[1].init.headers.Authorization, undefined);
});

test('gift catalog accepts large resource responses without raising auth response limits', async () => {
  const body = JSON.stringify({
    ok: true,
    variants: [],
    padding: 'x'.repeat(2 * 1024 * 1024),
  });
  const client = createRemoteLicenseClient({
    baseUrl: 'https://synthetic-api.example',
    fetchImpl: async () => new Response(body),
  });

  assert.equal((await client.getGiftCatalog()).padding.length, 2 * 1024 * 1024);
  await assert.rejects(client.heartbeat('test-token'), {
    code: 'RESPONSE_TOO_LARGE',
  });
});

test('gift catalog growth beyond 8 MiB remains within its independent response budget', async () => {
  const body = JSON.stringify({
    ok: true,
    padding: '礼'.repeat(3 * 1024 * 1024),
  });
  const client = createRemoteLicenseClient({
    baseUrl: 'https://synthetic-api.example',
    fetchImpl: async () => new Response(body),
  });

  assert.ok(Buffer.byteLength(body, 'utf8') > 8 * 1024 * 1024);
  const catalog = await client.getGiftCatalog();
  assert.equal(catalog.padding, '礼'.repeat(3 * 1024 * 1024));
});

test('cloud sync client keeps settings and Bilibili credentials on fixed Device endpoints', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const body =
        url.endsWith('/bilibili-credentials') && init.method === 'GET'
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
    requests.map(({ url, init }) => [init.method, new URL(url).pathname, init.headers.Authorization]),
    [
      ['GET', '/api/device/cloud-state', 'Bearer device-token'],
      ['PUT', '/api/device/cloud-settings', 'Bearer device-token'],
      ['GET', '/api/device/bilibili-credentials', 'Bearer device-token'],
      ['PUT', '/api/device/bilibili-credentials', 'Bearer device-token'],
      ['DELETE', '/api/device/bilibili-credentials', 'Bearer device-token'],
    ],
  );
  assert.equal(
    requests.every(({ url }) => !url.includes('secret')),
    true,
  );
  assert.deepEqual(JSON.parse(requests[3].init.body), {
    cookie: credentials.cookie,
  });
});

test('gift recovery uses the fixed Device endpoint and bounded cursor query', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true, events: [], nextCursor: 5, hasMore: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.getGiftEvents(3, 200, 'device-token');

  const url = new URL(requests[0].url);
  assert.equal(url.pathname, '/api/device/gift-events');
  assert.equal(requests[0].init.headers['X-Lira-Gift-Identity'], '1');
  assert.equal(url.searchParams.get('after'), '3');
  assert.equal(url.searchParams.get('limit'), '200');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer device-token');
  assert.equal(requests[0].init.body, undefined);
});

test('gift history, clear, and epoch-aware recovery use fixed abortable Device endpoints', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const pathname = new URL(url).pathname;
      const body =
        pathname === '/api/device/gift-history/clear'
          ? {
              ok: true,
              deletedCounts: { giftEvents: 12, giftEventDeliveries: 10 },
              syncEpoch: 'epoch-2',
            }
          : pathname === '/api/device/gift-history'
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

  await client.getGiftHistory('opaque page/+ token', 'device-token', {
    signal: historyAbort.signal,
  });
  await client.clearGiftHistory('device-token', {
    signal: historyAbort.signal,
  });
  await client.getGiftEvents(8, 200, 'device-token', {
    syncEpoch: 'epoch-1',
    signal: recoveryAbort.signal,
  });

  const historyUrl = new URL(requests[0].url);
  assert.equal(historyUrl.pathname, '/api/device/gift-history');
  assert.equal(requests[0].init.headers['X-Lira-Gift-Identity'], '1');
  assert.equal(requests[2].init.headers['X-Lira-Gift-Identity'], '1');
  assert.equal(historyUrl.searchParams.get('pageToken'), 'opaque page/+ token');
  assert.equal(requests[0].init.signal.aborted, false);
  const clearUrl = new URL(requests[1].url);
  assert.equal(clearUrl.pathname, '/api/device/gift-history/clear');
  assert.equal(clearUrl.search, '');
  assert.equal(requests[1].init.method, 'POST');
  assert.equal(requests[1].init.body, JSON.stringify({ confirm: true }));
  assert.equal(requests[1].init.signal.aborted, false);
  const recoveryUrl = new URL(requests[2].url);
  assert.equal(recoveryUrl.searchParams.get('after'), '8');
  assert.equal(recoveryUrl.searchParams.get('syncEpoch'), 'epoch-1');
  assert.equal(requests[2].init.signal.aborted, false);
  assert.equal(
    requests.every(({ init }) => init.headers.Authorization === 'Bearer device-token'),
    true,
  );
});

test('gift card profiles use a fixed authenticated endpoint and encode only the cursor', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://review.example.test',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client.getGiftCardProfiles(null, 'device-token');
  await client.getGiftCardProfiles('event:1&streamerId=other', 'device-token');
  assert.equal(new URL(requests[0].url).search, '');
  const url = new URL(requests[1].url);
  assert.equal(url.pathname, '/api/device/gift-card-profiles');
  assert.deepEqual([...url.searchParams], [['cursor', 'event:1&streamerId=other']]);
  for (const { url: address, init } of requests) {
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer device-token');
    assert.equal(init.body, undefined);
    assert.equal(address.includes('device-token'), false);
  }
});

test('external abort is not misreported as a request timeout', async () => {
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.lirahub.cn',
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
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
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        signals.push(init.signal);
        init.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), {
          once: true,
        });
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
  assert.equal(
    signals.every((signal) => signal.aborted),
    true,
  );
});
