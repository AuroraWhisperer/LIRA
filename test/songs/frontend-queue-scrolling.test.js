'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readQueueOverlayBundle: readJsModuleBundle } = require('../helpers/queue-overlay-bundle');
const { loadModuleExports } = require('../helpers/frontend-modules');

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

test('queue resize preserves real rows while removing stale loop copies', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
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
  vm.runInNewContext(source, sandbox);

  const removed = [];
  const realRow = {
    outerHTML: '<div>original row</div>',
    remove() {
      assert.fail('real queue rows must remain mounted');
    },
  };
  const cloneRows = [
    {
      remove() {
        removed.push('first');
        list.children = list.children.filter((node) => node !== this);
      },
    },
    {
      remove() {
        removed.push('second');
        list.children = list.children.filter((node) => node !== this);
      },
    },
  ];
  const list = {
    scrollHeight: 240,
    classList: { add() {}, remove() {} },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-loop-clone="true"]');
      return list.children.filter((node) => node !== realRow);
    },
    children: [realRow, ...cloneRows],
  };
  const viewport = { clientHeight: 300, querySelector: () => list };
  const content = {
    querySelector: () => viewport,
    querySelectorAll: () => [],
    set innerHTML(_html) { assert.fail('resize must not rebuild the queue DOM'); },
  };

  vm.runInNewContext("state = { settings: { overlayQueueStyle: 'classic' } };", sandbox);
  sandbox.handleQueueViewportResize();
  assert.equal(typeof scheduledResize, 'function');
  scheduledResize();
  assert.deepEqual(removed, ['first', 'second']);
  assert.deepEqual(list.children, [realRow]);
});

test('identity queue scrolls only when its rows overflow', async () => {
  const { configureIdentityVerticalScroll } = await loadQueueModule('queue-scroll.js', {
    document: {
      getElementById: () => ({ textContent: '' }),
      documentElement: { style: { setProperty() {} } },
    },
  });
  const createList = (scrollHeight) => {
    const list = {
      scrollHeight,
      duplicatedHtml: '',
      classList: { add() {}, remove() {} },
      insertAdjacentHTML(_position, html) {
        list.duplicatedHtml += html;
      },
    };
    return list;
  };

  const overflowing = createList(500);
  assert.equal(
    configureIdentityVerticalScroll({ clientHeight: 300 }, overflowing, { queueScrollMode: 'loop' }, '<div>rows</div>', 4),
    true,
  );
  const fitting = createList(280);
  const fittingViewport = { clientHeight: 300, style: {}, parentElement: null, getBoundingClientRect: () => ({ top: 40 }) };
  assert.equal(configureIdentityVerticalScroll(fittingViewport, fitting, {}, '<div>rows</div>', 4), false);
  assert.equal(fitting.duplicatedHtml, '', 'fitting content must not be duplicated');
});
