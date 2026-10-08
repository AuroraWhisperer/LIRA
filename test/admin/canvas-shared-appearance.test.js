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
  const writes = [];
  const provider = createCanvasSharedAppearance({
    model: { getSnapshot: () => ({ items: [item, twin] }), subscribeSnapshot(fn) { fn(); return () => { subscribed = false; }; } },
    request: async (body, requestSignal) => {
      signal = requestSignal;
      if (body.action === 'read') {
        if (readError) throw new Error('read failed');
        const data = { [sceneAppearanceKey(item.type, item.appearance.config)]: { ...values } };
        if (holdRead) await new Promise(resolve => { deferredRead = resolve; });
        return data;
      }
      writes.push(body.patch);
      if (saveError) throw new Error('save failed');
      if (holdSave) await new Promise(resolve => { deferredSave = resolve; });
      Object.assign(values, body.patch);
      return { ...values };
    },
  });
  t.after(() => provider.dispose());
  async function tick(delay) {
    const [id, timer] = [...timers].find(([, timer]) => timer.delay === delay);
    timers.delete(id);
    await timer.fn();
  }
  return { provider, item, twin, values, writes, tick, timers,
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
  assert.equal(f.provider.getStates()[0].dirty, true);
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
