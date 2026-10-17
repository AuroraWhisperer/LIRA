'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom } = require('../helpers/toast-dom');

async function fixture({ fontSnapshot = { status: 'idle' } } = {}) {
  const dom = createDom();
  const region = dom.documentRef.createElement('section');
  region.hidden = true;
  const list = dom.documentRef.createElement('ul');
  region.append(list);
  dom.documentRef.body.append(region);
  const getElementById = dom.documentRef.getElementById;
  dom.documentRef.getElementById = id =>
    ({ resourceDownloads: region, resourceDownloadList: list })[id] || getElementById(id);
  const { createResourceDownloads } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/admin/resource-downloads.js'),
    { window: {}, document: {}, setTimeout: () => 0, clearTimeout() {} },
  );
  const listeners = { fonts: new Set(), gifts: new Set() };
  const subscribe = key => listener => {
    listeners[key].add(listener);
    return () => listeners[key].delete(listener);
  };
  const bridge = {
    getFontLibraryState: async () => fontSnapshot,
    getGiftCatalogState: async () => ({ status: 'ready', phase: 'complete', total: 0 }),
    onFontLibraryStateChanged: subscribe('fonts'),
    onGiftCatalogStateChanged: subscribe('gifts'),
  };
  const controller = createResourceDownloads({ window: dom.windowRef, document: dom.documentRef,
    bridge, eventBus: { on: () => () => {} } });
  const emit = (key, state) => listeners[key].forEach(listener => listener(state));
  return { ...dom, region, list, listeners, controller, emit };
}

test('active downloads remain visible after dismissing toast; terminal rows and empty region disappear', async () => {
  const { controller, emit, region, list, container } = await fixture();
  await controller.init();
  assert.equal(region.hidden, true);
  emit('fonts', { status: 'checking' });
  assert.equal(region.hidden, true);
  emit('fonts', { status: 'downloading', total: 8, completed: 2, currentFont: '小赖字体' });
  const [fonts, gifts] = list.children;
  assert.equal(region.hidden, false);
  assert.equal(fonts.hidden, false);
  assert.equal(gifts.hidden, true);
  assert.match(fonts.textContent, /25%.*已处理 2 \/ 8 · 小赖字体/);
  assert.equal(fonts.children[1].value, 2);
  assert.equal(fonts.children[1].max, 8);
  container.children[0].fire('click');
  assert.equal(region.hidden, false);
  assert.equal(fonts.hidden, false);
  emit('gifts', { status: 'updating', phase: 'images', total: 10, completed: 4, available: 3, failed: 1 });
  assert.equal(gifts.hidden, false);
  assert.match(gifts.textContent, /40%.*失败 1/);
  emit('fonts', { status: 'ready', total: 8, completed: 8 });
  assert.equal(fonts.hidden, true);
  assert.equal(region.hidden, false);
  emit('gifts', { status: 'error', phase: 'error', total: 10, completed: 10, failed: 1 });
  assert.equal(gifts.hidden, true);
  assert.equal(region.hidden, true);
  emit('fonts', { status: 'downloading', total: 1, completed: 0 });
  assert.equal(region.hidden, false);
  assert.equal(list.children.length, 2);
  controller.dispose();
});

test('initial progress is restored once; newer events win over late snapshots and disposal unsubscribes', async () => {
  let resolveSnapshot;
  const snapshot = new Promise(resolve => { resolveSnapshot = resolve; });
  const { controller, emit, list, listeners } = await fixture({ fontSnapshot: snapshot });
  const initialization = controller.init();
  await controller.init();
  assert.equal(listeners.fonts.size, 1);
  assert.equal(listeners.gifts.size, 1);
  emit('fonts', { status: 'downloading', total: 4, completed: 3 });
  resolveSnapshot({ status: 'downloading', total: 4, completed: 0 });
  await initialization;
  assert.match(list.children[0].textContent, /75%/);
  controller.dispose();
  assert.equal(listeners.fonts.size, 0);
  assert.equal(listeners.gifts.size, 0);
});

test('opening during a download renders the current snapshot without waiting for another event', async () => {
  const { controller, region, list } = await fixture({
    fontSnapshot: { status: 'downloading', total: 4, completed: 2 },
  });
  await controller.init();
  assert.equal(region.hidden, false);
  assert.match(list.children[0].textContent, /50%/);
  controller.dispose();
});
