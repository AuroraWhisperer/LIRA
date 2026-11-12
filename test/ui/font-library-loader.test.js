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
  Object.assign(dom.windowRef, { ...clock, liraLicense: bridge, fetch, AbortController });
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
  publish({ status: 'downloading', completed: 3 });
  const superseded = documentRef.head.children[1];
  publish({ status: 'downloading', completed: 4 });
  const latest = documentRef.head.children[1];
  assert.notEqual(latest, superseded);
  superseded.fire('load');
  assert.deepEqual(documentRef.head.children, [next, latest]);
  latest.fire('load');
  assert.deepEqual(documentRef.head.children, [latest], 'Only the latest loaded sheet remains.');
  publish({ status: 'ready', completed: 5 });
  documentRef.head.children[1].fire('error');
  assert.deepEqual(documentRef.head.children, [latest], 'A failed refresh preserves the usable sheet.');
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
  let pendingSignal;
  const navigating = await fixture(t, undefined, async (url, { signal } = {}) => {
    pendingSignal = signal;
    return pending.promise;
  });
  navigating.dispose();
  assert.equal(pendingSignal.aborted, true);
  pending.resolve({ ok: true, json: async () => ({ status: 'ready', completed: 1 }) });
  await settle();
  assert.equal(navigating.documentRef.head.children.length, 0);
});

test('browser sources wait for a manual retry after resource failure and stop reading when ready', async t => {
  const changed = Promise.withResolvers();
  const requests = [];
  const f = await fixture(t, undefined, async (url, options = {}) => {
    requests.push({ url, signal: options.signal });
    const state = requests.length === 1 ? { status: 'error', completed: 0, completedAt: 'failed' }
      : requests.length === 2 ? await changed.promise : { status: 'ready', completed: 1, completedAt: 'recovered' };
    return { ok: true, json: async () => state };
  });
  await settle();
  f.clock.tick(2000);
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url, 'http://local.test').searchParams.get('after'), 'error:0:failed');
  f.clock.tick(120000);
  await settle();
  assert.equal(requests.length, 2, 'An in-flight local wait does not start duplicate requests.');
  changed.resolve({ status: 'checking', completed: 0 });
  await settle();
  f.clock.tick(2000);
  await settle();
  assert.equal(requests.length, 3);
  assert.equal(f.documentRef.head.children.length, 1);
  f.documentRef.head.children[0].fire('load');
  f.clock.tick(60000);
  await settle();
  assert.equal(requests.length, 3);
  f.dispose();
  assert.equal(requests[1].signal.aborted, true);
});

test('failed font stylesheets retry the same state and stop retrying after disposal', async t => {
  const listeners = new Set();
  const state = { status: 'ready', completed: 2, completedAt: 'ready' };
  const f = await fixture(t, {
    getFontLibraryState: async () => state,
    onFontLibraryStateChanged: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  });
  await settle();
  const failed = f.documentRef.head.children[0];
  failed.fire('error');
  f.clock.tick(60000);
  assert.equal(f.documentRef.head.children.length, 1);
  const retried = f.documentRef.head.children[0];
  assert.notEqual(retried, failed);
  retried.fire('load');
  for (const listener of listeners) listener(state);
  assert.deepEqual(f.documentRef.head.children, [retried]);
  for (const listener of listeners) listener({ ...state, completedAt: 'new' });
  f.documentRef.head.children[1].fire('error');
  f.dispose();
  f.clock.tick(60000);
  assert.deepEqual(f.documentRef.head.children, [retried]);
});

test('browser status failures recover and repeated failures have a finite retry budget', async t => {
  let requests = 0;
  const f = await fixture(t, undefined, async () => {
    if (++requests === 1) throw new Error('temporary status failure');
    return { ok: true, json: async () => ({ status: 'ready', completed: 1 }) };
  });
  await settle();
  f.clock.tick(60000);
  await settle();
  assert.equal(f.documentRef.head.children.length, 1);
  f.documentRef.head.children[0].fire('load');
  const recoveredRequests = requests;
  f.clock.tick(60000);
  await settle();
  assert.equal(requests, recoveredRequests);

  let failures = 0;
  const unavailable = await fixture(t, undefined, async () => { failures++; throw new Error('offline'); });
  for (let index = 0; index < 10; index++) {
    unavailable.clock.tick(60000);
    await settle();
  }
  assert.ok(failures > 1 && failures <= 4);
  const stopped = failures;
  unavailable.clock.tick(60000);
  await settle();
  assert.equal(failures, stopped);
});
