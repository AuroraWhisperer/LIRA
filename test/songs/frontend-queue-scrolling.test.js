'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { FakeNode } = require('../helpers/fake-dom');
const { loadModuleExports, loadModuleScope } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

function loadQueueModule(file, globals = {}) {
  return loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', file), {
    window: {}, location: { search: '' }, URLSearchParams, ...globals,
  });
}

test('identity song text scrolls only when its rendered width overflows', async () => {
  const { scheduleIdentityContentScroll } = await loadQueueModule('queue-scroll.js', {
    requestAnimationFrame(callback) {
      callback();
    },
  });

  let longAnimated = false;
  const container = (scrollWidth, animate) => ({
    clientWidth: 100,
    classList: { toggle() {} },
    querySelector: () => ({ scrollWidth, animate }),
  });

  scheduleIdentityContentScroll({
    querySelectorAll: () => [
      container(300, () => { longAnimated = true; }),
      container(90, () => assert.fail('fitting song text must not animate')),
    ],
  });

  assert.equal(longAnimated, true);
});

test('queue resize preserves real rows while removing stale loop copies', async () => {
  let scheduledResize;
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    setTimeout(callback) { scheduledResize = callback; return 1; },
    clearTimeout() { scheduledResize = null; },
    document: {
      addEventListener() {},
      querySelector: () => null,
      getElementById: () => content,
    },
    window: {},
  };
  const evaluate = await loadModuleScope(path.join(ROOT_DIR, 'public/js/overlays/queue.js'), sandbox);

  const realRow = new FakeNode('div');
  realRow.outerHTML = '<div>original row</div>';
  const list = new FakeNode('div');
  list.append(realRow);
  for (const clone of [new FakeNode('div'), new FakeNode('div')]) {
    clone.dataset.loopClone = 'true';
    list.append(clone);
  }
  list.scrollHeight = 240;
  list.querySelectorAll = (selector) => selector === '[data-loop-clone="true"]'
    ? list.children.filter((row) => row.dataset.loopClone === 'true') : [];
  const viewport = { clientHeight: 300, querySelector: () => list };
  const content = {
    querySelector: () => viewport,
    querySelectorAll: () => [],
    set innerHTML(_html) { assert.fail('resize must not rebuild the queue DOM'); },
  };

  evaluate("state = { settings: { overlayQueueStyle: 'classic' } };");
  evaluate('handleQueueViewportResize()');
  scheduledResize();
  assert.deepEqual(list.children, [realRow]);
});

test('classic and identity queues append one loop copy only when the rows overflow', async () => {
  const { configureClassicVerticalScroll, configureIdentityVerticalScroll } = await loadQueueModule('queue-scroll.js', {
    document: { documentElement: { style: { setProperty() {} } } },
  });
  const viewport = { clientHeight: 300 };
  const settings = { queueScrollMode: 'loop' };
  const rows = '<div>歌曲</div>';
  for (const configure of [configureClassicVerticalScroll, configureIdentityVerticalScroll]) {
    const copies = [];
    const list = new FakeNode('div');
    list.insertAdjacentHTML = (_position, html) => copies.push(html);
    list.scrollHeight = 280;
    configure(viewport, list, settings, rows);
    assert.deepEqual(copies, [], configure.name);
    list.scrollHeight = 500;
    configure(viewport, list, settings, rows);
    assert.deepEqual(copies, [rows], configure.name);
  }
});
