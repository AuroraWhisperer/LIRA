'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBilibiliWbiQuery,
  createBilibiliWbiMixinKey,
  signBilibiliWbiParams,
} = require('../../src/bilibili/wbi-signer');

const IMG_URL = 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png';
const SUB_URL = 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png';
const MIXIN_KEY = 'ea1db124af3c7062474693fa704f4ff8';

function freshSigner(t) {
  const modulePath = require.resolve('../../src/bilibili/wbi-signer');
  const previous = require.cache[modulePath];
  delete require.cache[modulePath];
  t.after(() => {
    delete require.cache[modulePath];
    if (previous) require.cache[modulePath] = previous;
  });
  return require(modulePath);
}

function keyResponse() {
  return Response.json({ code: 0, data: { wbi_img: { img_url: IMG_URL, sub_url: SUB_URL } } });
}

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
  const query = buildBilibiliWbiQuery({ text: "a!b'c(d)e*", space: 'hello world' }, MIXIN_KEY, 1_000);

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

  const query = await signBilibiliWbiParams({ foo: '114', bar: '514', baz: 1919810 }, { Cookie: 'SESSDATA=fixture' });

  assert.equal(query, 'bar=514&baz=1919810&foo=114&wts=1702204169&w_rid=6149fdadf571698ca7e6a567265cd0ee');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.bilibili.com/x/web-interface/nav');
  assert.equal(calls[0].options.headers.Cookie, 'SESSDATA=fixture');
});

test('concurrent WBI callers share one key request and a ten-minute success cache', async (t) => {
  const signer = freshSigner(t);
  const pending = Promise.withResolvers();
  const request = t.mock.method(global, 'fetch', () => pending.promise);
  let now = 1_702_204_169_000;
  t.mock.method(Date, 'now', () => now);

  const first = signer.getBilibiliWbiMixinKey({});
  const second = signer.signBilibiliWbiParams({ id: 123, type: 0 }, {});
  assert.equal(request.mock.callCount(), 1);
  pending.resolve(keyResponse());
  assert.equal(await first, MIXIN_KEY);
  assert.equal(await second, buildBilibiliWbiQuery({ id: 123, type: 0 }, MIXIN_KEY, now));
  now += 10 * 60 * 1000 - 1;
  assert.equal(await signer.getBilibiliWbiMixinKey({}), MIXIN_KEY);
  assert.equal(request.mock.callCount(), 1);
  request.mock.mockImplementation(() => keyResponse());
  now += 1;
  assert.equal(await signer.getBilibiliWbiMixinKey({}), MIXIN_KEY);
  assert.equal(request.mock.callCount(), 2);
});

test('a failed shared WBI request is cleared so later callers can retry', async (t) => {
  const signer = freshSigner(t);
  const pending = Promise.withResolvers();
  const request = t.mock.method(global, 'fetch', () => pending.promise);
  const first = signer.getBilibiliWbiMixinKey({});
  const second = signer.getBilibiliWbiMixinKey({});
  const failures = Promise.all([
    assert.rejects(first, /synthetic nav failure/),
    assert.rejects(second, /synthetic nav failure/),
  ]);
  pending.reject(new Error('synthetic nav failure'));
  await failures;
  assert.equal(request.mock.callCount(), 1);

  request.mock.mockImplementation(() => keyResponse());
  assert.equal(await signer.getBilibiliWbiMixinKey({}), MIXIN_KEY);
  assert.equal(request.mock.callCount(), 2);
});

test('invalidating an old WBI generation preserves a newer key even when its value is unchanged', async (t) => {
  const signer = freshSigner(t);
  const request = t.mock.method(global, 'fetch', () => keyResponse());
  const first = await signer.getBilibiliWbiKey({});
  signer.invalidateBilibiliWbiKey(first);
  const second = await signer.getBilibiliWbiKey({});
  assert.notEqual(first, second);
  assert.equal(first.mixinKey, second.mixinKey);

  signer.invalidateBilibiliWbiKey(first);
  assert.equal(await signer.getBilibiliWbiKey({}), second);
  assert.equal(request.mock.callCount(), 2);
});
