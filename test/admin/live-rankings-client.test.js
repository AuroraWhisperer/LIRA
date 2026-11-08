'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startLiveRankingsCanvasData } = require('../../public/js/admin/live-rankings-client.js');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('ranking previews query only while their browser attachment and layer are active', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const read = t.mock.method(global, 'fetch', async () => ({ ok: true,
    json: async () => ({ ok: true, data: { version: 'one', boards: [] } }) }));
  const state = { draft: { document: { items: [{ type: 'live-rankings', visible: true }] } } };
  let change;
  const dispose = startLiveRankingsCanvasData({ getState: () => state,
    subscribe(listener) { change = listener; listener(state); return () => {}; } }, () => {});
  t.after(dispose);
  assert.equal(read.mock.callCount(), 0);
  dispose.setActive(true);
  await flush();
  assert.equal(read.mock.callCount(), 1);
  dispose.setActive(false);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(read.mock.callCount(), 1);
  state.draft.document.items[0].visible = false;
  dispose.setActive(true);
  assert.equal(read.mock.callCount(), 1);
  state.draft.document.items[0].visible = true;
  change(state);
  await flush();
  assert.equal(read.mock.callCount(), 2);
});
