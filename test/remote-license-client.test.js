'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRemoteLicenseClient,
  RemoteLicenseError,
} = require('../src/electron/license/remote-license-client');

test('debug client accepts an explicitly configured loopback HTTP tunnel', async () => {
  const requests = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'http://127.0.0.1:13000',
    isProduction: false,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.challenge({ deviceId: 'device' });

  assert.equal(client.baseUrl, 'http://127.0.0.1:13000');
  assert.equal(requests[0].url, 'http://127.0.0.1:13000/api/device/challenge');
});

test('client still rejects non-loopback HTTP license endpoints', () => {
  assert.throws(
    () =>
      createRemoteLicenseClient({
        baseUrl: 'http://localhost:13000',
        isProduction: true,
        fetchImpl: async () => new Response('{}'),
      }),
    /License API must use HTTPS/,
  );
  assert.throws(
    () =>
      createRemoteLicenseClient({
        baseUrl: 'http://192.168.1.10:13000',
        isProduction: true,
        fetchImpl: async () => new Response('{}'),
      }),
    /License API must use HTTPS/,
  );
});

test('remote client marks throttling and server failures retryable without retrying auth rejection', async () => {
  for (const status of [429, 503]) {
    const client = createRemoteLicenseClient({
      baseUrl: 'https://api.lirahub.cn',
      isProduction: true,
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
    isProduction: true,
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
    isProduction: true,
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
    isProduction: true,
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
    isProduction: true,
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
      isProduction: true,
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
    isProduction: true,
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
    isProduction: true,
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
    'https://api.lirahub.cn/api/public/gifts/catalog',
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
