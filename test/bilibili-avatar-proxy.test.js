'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');
const { routes } = require('../src/server/routes/bilibili-routes');

test('Bilibili avatar proxy fetches only trusted HTTPS image URLs', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(Buffer.from([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' }
    });
  };
  const client = new BilibiliApiClient('123');

  try {
    const image = await client.fetchAvatarImage('https://i0.hdslb.com/bfs/face/viewer.jpg');
    assert.equal(image.contentType, 'image/jpeg');
    assert.deepEqual(image.data, Buffer.from([1, 2, 3]));
    assert.equal(requests[0].url, 'https://i0.hdslb.com/bfs/face/viewer.jpg');
    assert.match(requests[0].options.headers.Referer, /live\.bilibili\.com/);

    await assert.rejects(
      client.fetchAvatarImage('http://i0.hdslb.com/bfs/face/viewer.jpg'),
      /头像地址无效/
    );
    await assert.rejects(
      client.fetchAvatarImage('https://hdslb.com.attacker.test/avatar.jpg'),
      /头像地址无效/
    );
    assert.equal(requests.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Bilibili avatar route returns an inline cacheable image', async () => {
  const response = createResponseRecorder();
  await routes['GET /api/bilibili/avatar']({
    bilibili: {
      fetchAvatarImage: async (url) => {
        assert.equal(url, 'https://i0.hdslb.com/bfs/face/viewer.jpg');
        return { contentType: 'image/png', data: Buffer.from([4, 5, 6]) };
      }
    }
  }, {
    query: new URLSearchParams({ url: 'https://i0.hdslb.com/bfs/face/viewer.jpg' })
  }, response);

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
    }
  };
}
