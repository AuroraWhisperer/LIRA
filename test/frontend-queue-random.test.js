'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('./helpers/admin-html');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { createDom, createClock } = require('./helpers/toast-dom');

test('queue random button uses the same primary styling before the next button', () => {
  const html = readAdminHtml();
  assert.match(
    html,
    /id="randomSongBtn" class="primary" type="button"[\s\S]*?随机点歌[\s\S]*?id="nextBtn" class="primary"/,
  );
});

test('queue random click stays disabled while pending and recovers after success or failure', async () => {
  const dom = createDom();
  const clock = createClock();
  const elements = Object.fromEntries(
    ['randomSongBtn', 'nextBtn', 'clearBtn'].map((id) => [
      id, dom.documentRef.createElement('button'),
    ]),
  );
  const calls = [];
  let pending = Promise.withResolvers();
  const globals = {
    window: { ...dom.windowRef, __API_TOKEN__: 'test-token' },
    document: {
      ...dom.documentRef,
      getElementById: (id) => elements[id] || dom.documentRef.getElementById(id),
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/state') {
        return { json: async () => ({ ok: true, data: {} }) };
      }
      return pending.promise;
    },
  };
  const queue = await loadModuleExports(
    path.resolve(__dirname, '../public/js/admin/queue.js'), globals,
  );
  queue.initQueueForm();
  const button = elements.randomSongBtn;
  const click = button.fire('click');
  assert.equal(button.disabled, true);
  await button.fire('click');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/queue/random');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
  pending.resolve({
    ok: true,
    text: async () => JSON.stringify({ ok: true, data: { song_name: '测试歌' } }),
  });
  await click;
  assert.equal(button.disabled, false);
  assert.equal(calls[1].url, '/api/state');
  assert.match(dom.container.textContent, /测试歌/);

  clock.tick(4000);
  pending = Promise.withResolvers();
  const failedClick = button.fire('click');
  pending.resolve({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ ok: false, error: '当前已暂停接收点歌。' }),
  });
  await failedClick;
  assert.equal(button.disabled, false);
  assert.equal(calls.length, 3);
  assert.match(dom.container.textContent, /暂停接收点歌/);
});
