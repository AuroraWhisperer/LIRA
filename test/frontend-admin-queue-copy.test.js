'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { createDom, createClock } = require('./helpers/toast-dom');

const ROOT_DIR = path.join(__dirname, '..');
const MESSAGE = '测试 "SC" & <留言>\n继续加油 ⚡🥵';

async function createQueueRuntime({
  clipboardMode = 'native',
  fallbackOk = true,
} = {}) {
  const dom = createDom();
  const clock = createClock();
  const copied = [];
  const messages = [];
  const inputs = new Set();
  let selectedText = '';
  const entities = {
    amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#96': '`',
  };
  const createList = () => ({
    buttons: [],
    style: { setProperty() {} },
    set innerHTML(html) {
      this.buttons = [
        ...html.matchAll(/<button\b[^>]*data-copy="([^"]*)"[^>]*>/g),
      ].map((match) => {
        const listeners = [];
        return {
          dataset: {
            copy: match[1].replace(
              /&(amp|lt|gt|quot|#39|#96);/g,
              (_, entity) => entities[entity],
            ),
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
    navigator: clipboardMode === 'missing'
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
        [elements.superChatList, elements.queueList].flatMap((list) =>
          list.querySelectorAll(selector),
        ),
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
  await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/queue.js'),
    globals,
  );
  return {
    queue: globals.window.AdminApp.queue,
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
    const { queue, elements, copied, messages, inputs } =
      await createQueueRuntime({ clipboardMode });
    renderState(queue);
    await elements.superChatList.buttons[0].click();

    assert.deepEqual(copied, [MESSAGE]);
    assert.deepEqual(messages, ['SC 已复制']);
    assert.equal(inputs.size, 0);
  });
}

test('SC copy reports failure when neither clipboard path succeeds', async () => {
  const { queue, elements, copied, messages, inputs } =
    await createQueueRuntime({
      clipboardMode: 'denied',
      fallbackOk: false,
    });
  renderState(queue);
  await elements.superChatList.buttons[0].click();

  assert.deepEqual(copied, []);
  assert.deepEqual(messages, ['复制失败，请重试']);
  assert.equal(inputs.size, 0);
});
