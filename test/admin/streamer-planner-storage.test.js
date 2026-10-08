'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');

const STORAGE_KEY = 'admin.streamerWorkbench.v3';
const PREVIOUS_STORAGE_KEY = 'admin.streamerWorkbench.v2';
const LEGACY_STORAGE_KEY = 'admin.streamerPlanner.v1';
const sandbox = {};
vm.runInNewContext(
  `${readJsModuleBundle('public', 'js', 'admin', 'streamer-planner-storage.js')}\nthis.createStorage = createPlannerStorage;`,
  sandbox,
);
const createStorage = sandbox.createStorage;

test('corrupt current records block writes even when older records are valid', () => {
  const stored = new Map([
    [STORAGE_KEY, '{broken'],
    [PREVIOUS_STORAGE_KEY, JSON.stringify({ version: 2, tasks: [{ title: '旧待办' }], notes: [] })],
    [LEGACY_STORAGE_KEY, JSON.stringify([{ title: '更旧的待办' }])],
  ]);
  const original = [...stored];
  const storage = createStorage(() => ({
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  }));
  const planner = storage.read();
  assert.equal(planner.tasks.length, 0);
  assert.equal(storage.getStatus().readFailed, true);
  assert.equal(storage.write(planner), false);
  assert.deepEqual([...stored], original);
});

test('storage access failure keeps writes blocked for the current workbench', () => {
  let available = false;
  let writes = 0;
  const storage = createStorage(() => {
    if (!available) throw new Error('Storage access denied');
    return { setItem() { writes++; } };
  });
  const planner = storage.read();
  available = true;
  assert.equal(storage.write(planner), false);
  assert.equal(storage.getStatus().readFailed, true);
  assert.equal(writes, 0);
});

test('write failures report failure without changing the draft and recover on a successful write', () => {
  const stored = new Map();
  let writable = false;
  const storage = createStorage(() => ({
    getItem: (key) => stored.get(key) ?? null,
    setItem(key, value) {
      if (!writable) throw new Error('Quota exceeded');
      stored.set(key, value);
    },
  }));
  const planner = storage.read();
  planner.notes.push({ id: 'note-1', body: '保留草稿' });
  assert.equal(storage.write(planner), false);
  assert.equal(storage.getStatus().saveFailed, true);
  assert.equal(planner.notes[0].body, '保留草稿');
  assert.equal(stored.has(STORAGE_KEY), false);
  writable = true;
  assert.equal(storage.write(planner), true);
  assert.equal(storage.getStatus().saveFailed, false);
  assert.equal(JSON.parse(stored.get(STORAGE_KEY)).notes[0].body, '保留草稿');
});
