'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildBilibiliWbiQuery, createBilibiliWbiMixinKey } = require('../../src/bilibili/wbi-signer');

const IMG_URL = `https://i0.hdslb.com/bfs/wbi/${'a'.repeat(32)}.png`;
const SUB_URL = `https://i0.hdslb.com/bfs/wbi/${'b'.repeat(32)}.png`;

function freshClient(t) {
  const modulePaths = [
    require.resolve('../../src/bilibili/wbi-signer'),
    require.resolve('../../src/bilibili/danmaku/api-client'),
  ];
  const previous = modulePaths.map((modulePath) => require.cache[modulePath]);
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  t.after(() => {
    modulePaths.forEach((modulePath, index) => {
      delete require.cache[modulePath];
      if (previous[index]) require.cache[modulePath] = previous[index];
    });
  });
  const { BilibiliApiClient } = require('../../src/bilibili/danmaku/api-client');
  return new BilibiliApiClient('123', { cookieHeader: 'SESSDATA=synthetic-session' });
}

function keyResponse(imgUrl = IMG_URL, subUrl = SUB_URL) {
  return Response.json({ code: 0, data: { wbi_img: { img_url: imgUrl, sub_url: subUrl } } });
}

test('getDanmuInfo refreshes rejected WBI material and signs the read again once', async (t) => {
  const client = freshClient(t);
  const now = 1_702_204_169_000;
  t.mock.method(Date, 'now', () => now);
  const queries = [];
  let navRequests = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(options.headers.Cookie, 'SESSDATA=synthetic-session');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.endsWith('/nav')) {
      navRequests += 1;
      return navRequests === 1 ? keyResponse() : keyResponse(SUB_URL, IMG_URL);
    }
    queries.push(new URL(url).search.slice(1));
    return queries.length === 1
      ? Response.json({ code: -352, message: 'synthetic signature rejection' })
      : Response.json({ code: 0, data: { token: 'synthetic-token', host_list: [] } });
  });

  assert.deepEqual(await client.resolveDanmuInfo('123'), { token: 'synthetic-token', host_list: [] });
  assert.equal(navRequests, 2);
  assert.deepEqual(queries, [
    buildBilibiliWbiQuery({ id: '123', type: 0 }, createBilibiliWbiMixinKey(IMG_URL, SUB_URL), now),
    buildBilibiliWbiQuery({ id: '123', type: 0 }, createBilibiliWbiMixinKey(SUB_URL, IMG_URL), now),
  ]);
});

test('getDanmuInfo stops after its refreshed signature is rejected', async (t) => {
  const client = freshClient(t);
  let navRequests = 0;
  let danmuRequests = 0;
  t.mock.method(global, 'fetch', async (url) => {
    if (url.endsWith('/nav')) {
      navRequests += 1;
      return keyResponse();
    }
    danmuRequests += 1;
    return Response.json({ code: -352, message: 'synthetic signature rejection' });
  });

  await assert.rejects(client.resolveDanmuInfo('123'), /-352/);
  assert.equal(navRequests, 2);
  assert.equal(danmuRequests, 2);
});

for (const code of [-412, '-352']) {
  test(`getDanmuInfo does not refresh for code ${JSON.stringify(code)}`, async (t) => {
    const client = freshClient(t);
    let navRequests = 0;
    let danmuRequests = 0;
    t.mock.method(global, 'fetch', async (url) => {
      if (url.endsWith('/nav')) {
        navRequests += 1;
        return keyResponse();
      }
      danmuRequests += 1;
      return Response.json({ code, message: 'synthetic rejection' });
    });

    await assert.rejects(client.resolveDanmuInfo('123'), /getDanmuInfo/);
    assert.equal(navRequests, 1);
    assert.equal(danmuRequests, 1);
  });
}

test('getDanmuInfo does not refresh on an HTTP failure', async (t) => {
  const client = freshClient(t);
  let navRequests = 0;
  let danmuRequests = 0;
  t.mock.method(global, 'fetch', async (url) => {
    if (url.endsWith('/nav')) {
      navRequests += 1;
      return keyResponse();
    }
    danmuRequests += 1;
    return Response.json({ code: -352 }, { status: 403 });
  });

  await assert.rejects(client.resolveDanmuInfo('123'), /403/);
  assert.equal(navRequests, 1);
  assert.equal(danmuRequests, 1);
});

test('a delayed getDanmuInfo rejection reuses the newer WBI generation from a concurrent read', async (t) => {
  const client = freshClient(t);
  const delayed = Promise.withResolvers();
  const requestCounts = new Map();
  let navRequests = 0;
  t.mock.method(global, 'fetch', async (url) => {
    if (url.endsWith('/nav')) {
      navRequests += 1;
      return keyResponse();
    }
    const roomId = new URL(url).searchParams.get('id');
    const count = (requestCounts.get(roomId) || 0) + 1;
    requestCounts.set(roomId, count);
    if (roomId === '123' && count === 1) return delayed.promise;
    return count === 1
      ? Response.json({ code: -352 })
      : Response.json({ code: 0, data: { token: `synthetic-${roomId}` } });
  });

  const first = client.resolveDanmuInfo('123');
  const second = client.resolveDanmuInfo('456');
  const secondResult = await second;
  delayed.resolve(Response.json({ code: -352 }));
  const firstResult = await first;

  assert.deepEqual(firstResult, { token: 'synthetic-123' });
  assert.deepEqual(secondResult, { token: 'synthetic-456' });
  assert.equal(navRequests, 2);
  assert.deepEqual([...requestCounts], [['123', 2], ['456', 2]]);
});
