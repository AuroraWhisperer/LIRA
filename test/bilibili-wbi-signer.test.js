'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBilibiliWbiQuery,
  createBilibiliWbiMixinKey,
  signBilibiliWbiParams,
} = require('../src/bilibili/wbi-signer');

const IMG_URL =
  'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png';
const SUB_URL =
  'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png';
const MIXIN_KEY = 'ea1db124af3c7062474693fa704f4ff8';

test('WBI mixin and query builders are deterministic pure functions', () => {
  assert.equal(createBilibiliWbiMixinKey(IMG_URL, SUB_URL), MIXIN_KEY);

  const params = { foo: '114', bar: '514', baz: 1919810 };
  assert.equal(
    buildBilibiliWbiQuery(params, MIXIN_KEY, 1_702_204_169_000),
    'bar=514&baz=1919810&foo=114&wts=1702204169&w_rid=6149fdadf571698ca7e6a567265cd0ee',
  );
  assert.deepEqual(params, { foo: '114', bar: '514', baz: 1919810 });
});

test('WBI query builder removes forbidden characters before encoding', () => {
  const query = buildBilibiliWbiQuery(
    { text: "a!b'c(d)e*", space: 'hello world' },
    MIXIN_KEY,
    1_000,
  );

  assert.match(query, /^space=hello%20world&text=abcde&wts=1&w_rid=[a-f0-9]{32}$/u);
});

test('legacy WBI signer keeps its network-facing contract', async (t) => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const calls = [];
  t.after(() => {
    global.fetch = originalFetch;
    Date.now = originalNow;
  });
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 0,
          data: { wbi_img: { img_url: IMG_URL, sub_url: SUB_URL } },
        }),
    };
  };
  Date.now = () => 1_702_204_169_000;

  const query = await signBilibiliWbiParams(
    { foo: '114', bar: '514', baz: 1919810 },
    { Cookie: 'SESSDATA=fixture' },
  );

  assert.equal(
    query,
    'bar=514&baz=1919810&foo=114&wts=1702204169&w_rid=6149fdadf571698ca7e6a567265cd0ee',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.bilibili.com/x/web-interface/nav');
  assert.equal(calls[0].options.headers.Cookie, 'SESSDATA=fixture');
});
