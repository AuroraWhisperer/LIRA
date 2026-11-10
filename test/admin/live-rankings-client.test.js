'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startLiveRankingsCanvasData, subscribeLiveRankings } = require('../../public/js/admin/live-rankings-client.js');
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

test('temporary ranking read failures preserve the last rows and recover on an unchanged snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ready = { version: 'one', status: 'ready', room: { roomId: '25' }, boards: [{ id: 'hot', status: 'ready',
    rows: [{ roomId: '25', rank: 25, score: 3210 }] }] };
  let attempt = 0;
  t.mock.method(global, 'fetch', async () => {
    attempt++;
    if (attempt === 2) throw new Error('synthetic connection interruption');
    return { ok: true, json: async () => ({ ok: true, data: attempt === 1 ? ready : { unchanged: true } }) };
  });
  const received = [];
  t.after(subscribeLiveRankings(data => received.push(data)));
  await flush();
  t.mock.timers.tick(500);
  await flush();
  const delayed = received.at(-1);
  assert.equal(delayed.status, 'stale');
  assert.equal(delayed.room?.roomId, '25');
  assert.equal(delayed.boards[0]?.rows[0].score, 3210);
  assert.equal(delayed.boards[0]?.status, 'stale');
  t.mock.timers.tick(500);
  await flush();
  assert.equal(received.at(-1).boards[0]?.status, 'ready');
});

test('ranking authorization failures clear the previously displayed room and rows', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let authorized = true;
  t.mock.method(global, 'fetch', async () => ({ ok: authorized, status: authorized ? 200 : 403,
    json: async () => authorized ? { ok: true, data: { version: 'one', room: { roomId: '25' }, boards: [{ id: 'hot', rows: [{ roomId: '25' }] }] } }
      : { ok: false } }));
  let received;
  t.after(subscribeLiveRankings(data => { received = data; }));
  await flush();
  authorized = false;
  t.mock.timers.tick(500);
  await flush();
  assert.equal(received.room, null);
  assert.equal(received.boards.length, 0);
});
