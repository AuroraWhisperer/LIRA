'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom } = require('../helpers/toast-dom');

async function fixture() {
  const dom = createDom();
  dom.documentRef.head = dom.documentRef.createElement('head');
  const { createFontLibraryToast } = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/font-library-toast.js'), {
    document: {}, window: {}, setTimeout: () => 0, clearTimeout() {},
  });
  const listeners = new Set(); let retries = 0;
  const bridge = { getFontLibraryState: async () => ({ status: 'idle' }),
    retryFontLibrary: async () => { retries++; },
    onFontLibraryStateChanged: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
  const controller = createFontLibraryToast({ document: dom.documentRef, window: dom.windowRef, bridge,
    eventBus: { on: () => () => {} } });
  return { ...dom, controller, listeners, getRetries: () => retries };
}

test('font toast is silent for unchanged cache and updates the same node for progress and completion', async () => {
  const { controller, container } = await fixture();
  controller.handleState({ status: 'ready', total: 0 });
  assert.equal(container.children.length, 0);
  controller.handleState({ status: 'downloading', total: 8, completed: 0, currentFont: '小赖字体' });
  const node = container.children[0];
  controller.handleState({ status: 'downloading', total: 8, completed: 3 });
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0], node);
  const progress = node.children[0].children.find(child => child.tagName === 'progress');
  assert.equal(progress.value, 3);
  assert.equal(progress.max, 8);
  controller.handleState({ status: 'ready', total: 8, completed: 8, completedAt: 'done' });
  assert.match(node.className, /\btoast-success\b/);
  controller.handleState({ status: 'ready', total: 8, completed: 8, completedAt: 'done' });
  assert.equal(container.children.length, 1);
  controller.dispose();
});

test('resource toast uses byte progress for large files and stays silent while checking', async () => {
  const { controller, container } = await fixture();
  controller.handleState({ status: 'checking', total: 0 });
  controller.handleState({ status: 'error', total: 0 });
  assert.equal(container.children.length, 0);
  controller.handleState({ status: 'downloading', total: 62, completed: 58,
    totalBytes: 100 * 1024 * 1024, downloadedBytes: 25 * 1024 * 1024, currentFont: '世界地图高清底图' });
  const node = container.children[0];
  const progress = node.children[0].children.find(child => child.tagName === 'progress');
  assert.equal(progress.max, 100 * 1024 * 1024);
  assert.equal(progress.value, 25 * 1024 * 1024);
  controller.dispose();
});

test('font toast unsubscribes on disposal and does not revive after navigation', async () => {
  const { controller, listeners, container } = await fixture();
  await controller.init(); await controller.init();
  assert.equal(listeners.size, 1);
  controller.dispose();
  assert.equal(listeners.size, 0);
  controller.handleState({ status: 'downloading', total: 8 });
  assert.equal(container.children.length, 0);
});
