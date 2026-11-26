'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { sceneAppearanceKey } = require('../../public/js/shared/scene-shared-appearance.js');

async function fixture(t) {
  const timers = new Map();
  let serial = 0;
  const { createCanvasSharedAppearance } = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/canvas-shared-appearance.js'), {
    AbortController, setTimeout(fn, delay) { timers.set(++serial, { fn, delay }); return serial; },
    clearTimeout(id) { timers.delete(id); },
  });
  const item = { type: 'songlist', appearance: { config: { songBoardTitle: 'old scene' } } };
  const twin = structuredClone(item);
  const values = { songBoardTitle: 'desktop', songBoardFontSize: '32' };
  let readError = false;
  let saveError = false;
  let deferredRead;
  let deferredSave;
  let holdRead = false;
  let holdSave = false;
  let signal;
  let subscribed = true;
  let notifyModel;
  let items = [item, twin];
  const reads = [];
  const writes = [];
  const provider = createCanvasSharedAppearance({
    model: { getSnapshot: () => ({ items }), subscribeSnapshot(fn) { notifyModel = fn; fn(); return () => { subscribed = false; }; } },
    request: async (body, requestSignal) => {
      signal = requestSignal;
      if (body.action === 'read') {
        reads.push(body.items);
        if (readError) throw new Error('read failed');
        const data = Object.fromEntries(body.items.map(item => [sceneAppearanceKey(item.type, item.config), { ...values }]));
        if (holdRead) await new Promise(resolve => { deferredRead = resolve; });
        return data;
      }
      writes.push(body.patch);
      if (holdSave) await new Promise(resolve => { deferredSave = resolve; });
      if (saveError) throw new Error('save failed');
      Object.assign(values, body.patch);
      return { ...values };
    },
  });
  t.after(() => provider.dispose());
  async function tick(delay) {
    const scheduled = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(scheduled, `expected a scheduled ${delay} ms callback`);
    const [id, timer] = scheduled;
    timers.delete(id);
    await timer.fn();
  }
  return { provider, item, twin, values, writes, reads, tick, timers,
    setItems(next) { items = next; notifyModel(); },
    readError(value) { readError = value; }, saveError(value) { saveError = value; },
    holdRead() { holdRead = true; }, finishRead() { holdRead = false; deferredRead(); },
    holdSave() { holdSave = true; }, finishSave() { holdSave = false; deferredSave(); },
    isDisposed: () => signal.aborted && !subscribed && !timers.size,
  };
}

test('shared appearance follows the desktop, shares instances and retains failed edits for retry or discard', async t => {
  const f = await fixture(t);
  f.readError(true);
  await f.tick(0);
  assert.equal(f.provider.getState(f.item).loaded, false);
  assert.match(f.provider.getState(f.item).error, /read failed/);
  f.readError(false);
  await f.provider.reload();
  assert.equal(f.provider.getState(f.item).draft.songBoardTitle, 'desktop');
  f.provider.edit(f.item, { songBoardTitle: 'canvas' });
  assert.equal(f.provider.getState(f.twin).draft.songBoardTitle, 'canvas');
  f.saveError(true);
  await assert.rejects(f.provider.flush(), /save failed/);
  assert.equal(f.provider.getState(f.item).dirty, true);
  f.values.songBoardFontSize = '48';
  await f.provider.reload();
  assert.equal(f.provider.getState(f.item).draft.songBoardTitle, 'canvas');
  assert.equal(f.provider.getState(f.item).draft.songBoardFontSize, '48');
  f.saveError(false);
  await f.provider.flush();
  assert.equal(f.values.songBoardTitle, 'canvas');
  assert.equal(f.provider.getState(f.item).dirty, false);
  f.provider.edit(f.item, { songBoardTitle: 'discard' });
  f.provider.discardAll();
  assert.equal(f.provider.getState(f.twin).draft.songBoardTitle, 'canvas');
  f.provider.dispose();
  assert.equal(f.isDisposed(), true);
});

test('a failed style write blocks surviving twins but expires with its last layer', async t => {
  const f = await fixture(t);
  await f.tick(0);
  f.saveError(true);
  f.provider.edit(f.item, { songBoardTitle: 'failed' });
  f.setItems([f.twin]);
  await assert.rejects(f.provider.flush(), /save failed/);
  f.setItems([]);
  await f.provider.flush();
  assert.equal(f.writes.length, 1);
  assert.equal(f.provider.getStatuses().length, 0);
  f.setItems([f.item]);
  await f.tick(0);
  assert.equal(f.provider.getState(f.item).draft.songBoardTitle, 'desktop');
});

test('deleting the last layer preserves its pending autosave and reuses it when the style returns', async t => {
  const f = await fixture(t);
  await f.tick(0);
  f.provider.edit(f.item, { songBoardTitle: 'first' });
  f.setItems([]);
  f.holdSave();
  await f.tick(180);
  f.setItems([f.twin]);
  assert.equal(f.provider.getState(f.twin).draft.songBoardTitle, 'first');
  f.provider.edit(f.twin, { songBoardTitle: 'second' });
  f.setItems([]);
  const applying = f.provider.flush();
  f.finishSave();
  await applying;
  assert.equal(f.values.songBoardTitle, 'second');
  assert.deepEqual(f.writes.map(patch => patch.songBoardTitle), ['first', 'second']);
  assert.equal(f.timers.size, 0);
});

test('a detached autosave failure releases the style and lets the remaining scene publish', async t => {
  const f = await fixture(t);
  await f.tick(0);
  f.provider.edit(f.item, { songBoardTitle: 'pending' });
  f.holdSave();
  const applying = f.provider.flush();
  f.setItems([]);
  f.saveError(true);
  f.finishSave();
  await applying;
  await f.provider.flush();
  assert.equal(f.writes.length, 1);
  f.setItems([f.twin]);
  await f.tick(0);
  assert.equal(f.provider.getState(f.twin).draft.songBoardTitle, 'desktop');
});

test('geometry keeps the polling deadline while new appearance owners are read promptly', async t => {
  const f = await fixture(t);
  await f.tick(0);
  const deadline = [...f.timers.keys()][0];
  for (let x = 1; x <= 60; x++) f.setItems([{ ...f.item, x }, { ...f.twin, x }]);
  assert.equal(f.reads.length, 1);
  assert.equal(f.timers.has(deadline), true, 'moving layers must not replace the scheduled owner read');
  f.holdRead();
  const reading = f.tick(750);
  const opening = { type: 'opening', appearance: { config: { style: 'original' } } };
  f.setItems([f.item, opening]);
  f.finishRead(); await reading;
  await f.tick(0);
  assert.equal(f.reads.at(-1).length, 2, 'an owner added during a request is included immediately after that request');
  f.setItems([]);
  assert.equal(f.timers.size, 0, 'a canvas without shared owners has no appearance polling task');
});

test('a stale read cannot undo a save and edits made during a save are serialized', async t => {
  const f = await fixture(t);
  await f.tick(0);
  f.holdRead();
  const read = f.tick(750);
  f.provider.edit(f.item, { songBoardTitle: 'newer' });
  await f.provider.flush();
  f.finishRead(); await read;
  assert.equal(f.provider.getState(f.item).saved.songBoardTitle, 'newer');
  f.holdSave();
  f.provider.edit(f.item, { songBoardTitle: 'first' });
  const save = f.provider.flush();
  f.provider.edit(f.twin, { songBoardTitle: 'second' });
  f.finishSave(); await save;
  assert.equal(f.values.songBoardTitle, 'second');
  assert.equal(f.provider.getState(f.item).dirty, false);
  assert.deepEqual(f.writes.map(patch => patch.songBoardTitle), ['newer', 'first', 'second']);
});
