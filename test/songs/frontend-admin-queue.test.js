'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom, createClock } = require('../helpers/toast-dom');

const ROOT_DIR = path.join(__dirname, '../..');
const MESSAGE = '测试 "SC" & <留言>\n继续加油 ⚡🥵';

async function createQueueRuntime({ clipboardMode = 'native', fallbackOk = true } = {}) {
  const dom = createDom();
  const clock = createClock();
  const copied = [];
  const messages = [];
  const inputs = new Set();
  let selectedText = '';
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
    '#96': '`',
  };
  const createList = () => ({
    buttons: [],
    style: { setProperty() {} },
    set innerHTML(html) {
      this.buttons = [...html.matchAll(/<button\b[^>]*data-copy="([^"]*)"[^>]*>/g)].map((match) => {
        const listeners = [];
        return {
          dataset: {
            copy: match[1].replace(/&(amp|lt|gt|quot|#39|#96);/g, (_, entity) => entities[entity]),
          },
          addEventListener(type, listener) {
            if (type === 'click') listeners.push(listener);
          },
          async click() {
            for (const listener of listeners) await listener();
            messages.push(...dom.container.children.map((node) => node.children[0].textContent));
            clock.tick(3000);
          },
        };
      });
    },
    querySelectorAll(selector) {
      return selector === '[data-copy]' ? this.buttons : [];
    },
  });
  const elements = {
    superChatList: createList(),
    queueList: createList(),
    superChatSize: {},
    songCount: {},
    queueSize: {},
    liveStatus: {},
    toast: dom.container,
  };
  const globals = {
    window: dom.windowRef,
    navigator:
      clipboardMode === 'missing'
        ? {}
        : {
            clipboard: {
              async writeText(text) {
                if (clipboardMode === 'denied') {
                  throw new Error('Write permission denied.');
                }
                copied.push(text);
              },
            },
          },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    document: {
      ...dom.documentRef,
      getElementById: (id) => elements[id] || null,
      querySelectorAll: (selector) =>
        [elements.superChatList, elements.queueList].flatMap((list) => list.querySelectorAll(selector)),
      createElement(tag) {
        if (tag !== 'textarea') return dom.documentRef.createElement(tag);
        return {
          style: {},
          classList: { add() {}, remove() {} },
          setAttribute() {},
          select() {
            selectedText = this.value;
          },
          remove() {
            inputs.delete(this);
          },
        };
      },
      body: { append: (input) => inputs.add(input) },
      execCommand(command) {
        assert.equal(command, 'copy');
        if (fallbackOk) copied.push(selectedText);
        return fallbackOk;
      },
    },
  };
  const queue = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/queue.js'), globals);
  return {
    queue,
    elements,
    copied,
    messages,
    inputs,
  };
}

function renderState(queue, message = MESSAGE) {
  queue.renderState(
    {
      queue: { current: { id: 2, song_name: '测试歌名' }, waiting: [] },
      superChats: [{ id: 1, price: 30, message }],
    },
    [],
  );
}

test('SC and song copy buttons copy their own text once after state refresh', async () => {
  const { queue, elements, copied, messages } = await createQueueRuntime();
  renderState(queue);
  await elements.superChatList.buttons[0].click();
  await elements.queueList.buttons[0].click();
  renderState(queue, '更新后的 SC');
  await elements.superChatList.buttons[0].click();

  assert.deepEqual(copied, [MESSAGE, '测试歌名', '更新后的 SC']);
  assert.deepEqual(messages, ['SC 已复制', '歌名已复制', 'SC 已复制']);
});

test('SC copy remains bound after the SC queue renders independently', async () => {
  const { queue, elements, copied, messages } = await createQueueRuntime();
  renderState(queue);
  queue.renderSuperChatQueue([{ id: 3, price: 2, message: MESSAGE }]);
  await elements.superChatList.buttons[0].click();

  assert.deepEqual(copied, [MESSAGE]);
  assert.deepEqual(messages, ['SC 已复制']);
});

for (const clipboardMode of ['denied', 'missing']) {
  test(`SC copy falls back when the clipboard API is ${clipboardMode}`, async () => {
    const { queue, elements, copied, messages, inputs } = await createQueueRuntime({ clipboardMode });
    renderState(queue);
    await elements.superChatList.buttons[0].click();

    assert.deepEqual(copied, [MESSAGE]);
    assert.deepEqual(messages, ['SC 已复制']);
    assert.equal(inputs.size, 0);
  });
}

test('SC copy reports failure when neither clipboard path succeeds', async () => {
  const { queue, elements, copied, messages, inputs } = await createQueueRuntime({
    clipboardMode: 'denied',
    fallbackOk: false,
  });
  renderState(queue);
  await elements.superChatList.buttons[0].click();

  assert.deepEqual(copied, []);
  assert.deepEqual(messages, ['复制失败，请重试']);
  assert.equal(inputs.size, 0);
});

test('queue actions remain unique non-submit buttons in the actual page', () => {
  const buttons = [...readAdminFragmentHtml('pages/admin/song/shell-start.html').matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  for (const id of ['randomSongBtn', 'nextBtn', 'clearBtn']) {
    const matches = buttons.filter((tag) => new RegExp(`\\sid\\s*=\\s*["']${id}["']`).test(tag));
    assert.equal(matches.length, 1, `${id} must be a unique button`);
    assert.match(matches[0], /\stype\s*=\s*["']button["']/);
  }
});

test('queue random click stays disabled while pending and recovers after success or failure', async () => {
  const dom = createDom();
  const clock = createClock();
  const elements = Object.fromEntries(
    ['randomSongBtn', 'nextBtn', 'clearBtn'].map((id) => [id, dom.documentRef.createElement('button')]),
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
  const queue = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/queue.js'), globals);
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
