'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');
const { routes } = require('../src/server/routes/bilibili-routes');

test('avatar proxy requests a bounded CDN thumbnail for original collection artwork', async (t) => {
  t.mock.method(global, 'fetch', async (url) => {
    assert.equal(url, 'https://i0.hdslb.com/bfs/garb/collection.png@256w_256h_1c_1s.webp');
    return new Response(Buffer.from([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } });
  });
  const image = await new BilibiliApiClient('').fetchAvatarImage('https://i0.hdslb.com/bfs/garb/collection.png');
  assert.equal(image.contentType, 'image/webp');
  assert.deepEqual(image.data, Buffer.from([1, 2, 3]));
});

test('collection thumbnails still obey the avatar byte limit', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response('', {
    headers: { 'Content-Type': 'image/webp', 'Content-Length': String(2 * 1024 * 1024 + 1) },
  }));
  await assert.rejects(new BilibiliApiClient('').fetchAvatarImage(
    'https://i0.hdslb.com/bfs/garb/collection.png',
  ), /头像文件过大/);
});

test('ordinary avatars preserve their URLs and supported image formats', async (t) => {
  let contentType;
  let source;
  t.mock.method(global, 'fetch', async (url) => {
    assert.equal(url, source);
    return new Response(Buffer.from([1, 2, 3]), { headers: { 'Content-Type': contentType } });
  });
  const client = new BilibiliApiClient('');
  for (const extension of ['jpeg', 'png', 'webp', 'gif', 'avif']) {
    source = `https://i0.hdslb.com/bfs/face/viewer.${extension}`;
    contentType = `image/${extension}`;
    assert.equal((await client.fetchAvatarImage(source)).contentType, contentType);
  }
});

test('avatar proxy accepts collection WebP URLs and upgrades protocol-relative URLs before fetching', async (t) => {
  const source = '//i0.hdslb.com/bfs/garb/collection.png@152w_152h_1c_1s.webp';
  const fetch = t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, `https:${source}`);
    assert.equal(new Headers(options.headers).has('cookie'), false);
    return new Response(Buffer.from([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } });
  });
  const client = new BilibiliApiClient('', { cookieHeader: 'SESSDATA=synthetic-session' });
  for (const url of [source, `https:${source}`]) {
    const image = await client.fetchAvatarImage(url);
    assert.equal(image.contentType, 'image/webp');
    assert.deepEqual(image.data, Buffer.from([1, 2, 3]));
  }
  await assert.rejects(client.fetchAvatarImage('//hdslb.com.attacker.test/avatar.webp'), /头像地址无效/);
  assert.equal(fetch.mock.callCount(), 2);
});

test('Bilibili avatar proxy fetches only trusted HTTPS image URLs', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(Buffer.from([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    });
  };
  const client = new BilibiliApiClient('123', { cookieHeader: 'SESSDATA=synthetic-session' });

  try {
    const image = await client.fetchAvatarImage(
      'https://i0.hdslb.com/bfs/face/viewer.jpg',
    );
    assert.equal(image.contentType, 'image/jpeg');
    assert.deepEqual(image.data, Buffer.from([1, 2, 3]));
    assert.equal(requests[0].url, 'https://i0.hdslb.com/bfs/face/viewer.jpg');
    assert.match(requests[0].options.headers.Referer, /live\.bilibili\.com/);
    assert.equal(new Headers(requests[0].options.headers).has('cookie'), false);
    assert.equal(client.requestHeaders().Cookie, 'SESSDATA=synthetic-session');

    await assert.rejects(
      client.fetchAvatarImage('http://i0.hdslb.com/bfs/face/viewer.jpg'),
      /头像地址无效/,
    );
    await assert.rejects(
      client.fetchAvatarImage('https://hdslb.com.attacker.test/avatar.jpg'),
      /头像地址无效/,
    );
    assert.equal(requests.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Bilibili avatar route returns an inline cacheable image', async () => {
  const response = createResponseRecorder();
  await routes['GET /api/bilibili/avatar'](
    {
      bilibili: {
        fetchAvatarImage: async (url) => {
          assert.equal(url, 'https://i0.hdslb.com/bfs/face/viewer.jpg');
          return { contentType: 'image/png', data: Buffer.from([4, 5, 6]) };
        },
      },
    },
    {
      query: new URLSearchParams({
        url: 'https://i0.hdslb.com/bfs/face/viewer.jpg',
      }),
    },
    response,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'image/png');
  assert.match(response.headers['Cache-Control'], /max-age=3600/);
  assert.equal(response.headers['Content-Disposition'], 'inline');
  assert.deepEqual(response.body, Buffer.from([4, 5, 6]));
});

function createResponseRecorder() {
  return {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}
