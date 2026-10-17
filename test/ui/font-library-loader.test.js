'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom, createClock } = require('../helpers/toast-dom');

async function fixture(t, bridge, fetch) {
  const dom = createDom();
  const clock = createClock();
  dom.documentRef.head = dom.documentRef.createElement('head');
  Object.assign(dom.windowRef, { ...clock, liraLicense: bridge, fetch });
  const dispose = () => {
    for (const listener of [...(dom.windowListeners.get('pagehide') || [])]) listener();
  };
  t.after(dispose);
  await loadModuleExports(path.resolve(__dirname, '../../public/js/shared/font-library-loader.js'), {
    window: dom.windowRef, document: dom.documentRef,
  });
  return { ...dom, clock, dispose };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('desktop font refresh preserves the previous stylesheet until load and ignores a stale initial snapshot', async t => {
  const initial = Promise.withResolvers();
  const listeners = new Set();
  const { documentRef, dispose } = await fixture(t, {
    getFontLibraryState: () => initial.promise,
    onFontLibraryStateChanged: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  });
  const publish = state => { for (const listener of listeners) listener(state); };
  publish({ status: 'downloading', completed: 0 });
  assert.equal(documentRef.head.children.length, 0);
  publish({ status: 'downloading', completed: 1 });
  const first = documentRef.head.children[0];
  first.fire('load');
  initial.resolve({ status: 'ready', completed: 0 });
  await settle();
  assert.equal(documentRef.head.children.length, 1);
  publish({ status: 'downloading', completed: 1 });
  assert.equal(documentRef.head.children[0], first);
  publish({ status: 'ready', completed: 2, completedAt: 'done' });
  assert.equal(documentRef.head.children.length, 2);
  const next = documentRef.head.children[1];
  next.fire('load');
  assert.deepEqual(documentRef.head.children, [next]);
  dispose();
  assert.equal(listeners.size, 0);
});

test('browser source polls only during downloads and stops after completion or navigation', async t => {
  let requests = 0;
  const states = [{ status: 'downloading', completed: 0 }, { status: 'ready', completed: 1 }];
  const { clock, documentRef, dispose } = await fixture(t, undefined, async url => {
    assert.equal(url, '/font-library/status');
    return { ok: true, json: async () => states[requests++] };
  });
  await settle();
  assert.equal(requests, 1);
  clock.tick(1999);
  assert.equal(requests, 1);
  clock.tick(1);
  await settle();
  assert.equal(documentRef.head.children.length, 1);
  clock.tick(10000);
  assert.equal(requests, 2);
  dispose();

  const pending = Promise.withResolvers();
  const navigating = await fixture(t, undefined, async () => pending.promise);
  navigating.dispose();
  pending.resolve({ ok: true, json: async () => ({ status: 'ready', completed: 1 }) });
  await settle();
  assert.equal(navigating.documentRef.head.children.length, 0);
});
