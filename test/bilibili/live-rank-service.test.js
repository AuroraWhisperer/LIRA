'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: settle } = require('node:timers/promises');
const { createLiveRankService } = require('../../src/bilibili/live-rank-service');
const { createDisplayDemand } = require('../../src/scenes/display-demand');

function fixture(t, getBoard) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  let scope = { owner: { scope: 'account-a', epoch: 1 }, roomId: '88' };
  let profiles = 0;
  const calls = [];
  const service = createLiveRankService({ demand: createDisplayDemand({ idleTimeoutMs: 3000 }),
    getScope: () => scope,
    getRoomProfile: async () => { profiles++; return { roomId: scope.roomId, uid: scope.roomId }; },
    provider: {
      getContext: async profile => ({ room: profile, area: { title: '虚拟', type: 2 } }),
      async getBoard(definition, context, signal) {
        calls.push({ id: definition.id, roomId: context.room.roomId, at: Date.now(), signal });
        if (getBoard) await getBoard(definition, context, signal);
        return { id: definition.id, status: 'ready', rows: [{ roomId: context.room.roomId, rank: 3, score: 42 }],
          updatedAt: Date.now(), current: { roomId: context.room.roomId, rank: 3, score: 42 } };
      },
    },
  });
  t.after(() => service.dispose());
  return { service, calls, setScope: value => { scope = value; }, get profiles() { return profiles; } };
}

test('many consumers share exactly two four-board fetches per second, then stop when idle', async t => {
  const f = fixture(t);
  assert.equal(f.calls.length, 0);
  for (let i = 0; i < 20; i++) f.service.getSnapshot();
  await settle();
  assert.equal(f.calls.length, 4);
  t.mock.timers.tick(499); await settle();
  assert.equal(f.calls.length, 4);
  t.mock.timers.tick(1); await settle();
  assert.equal(f.calls.length, 8);
  assert.equal(f.profiles, 1);
  t.mock.timers.tick(2500); await settle();
  const stoppedAt = f.calls.length;
  t.mock.timers.tick(10000); await settle();
  assert.equal(f.calls.length, stoppedAt);
  assert.ok(f.calls.every(call => call.signal.aborted));
  f.service.getSnapshot(); await settle();
  assert.equal(f.calls.length, stoppedAt + 4);
});

test('slow requests never overlap and old account results cannot enter a new room', async t => {
  let release;
  let pending = new Promise(resolve => { release = resolve; });
  const f = fixture(t, () => pending);
  f.service.getSnapshot(); await settle();
  t.mock.timers.tick(1500); await settle();
  f.service.getSnapshot(); await settle();
  assert.equal(f.calls.length, 4);
  f.setScope({ owner: { scope: 'account-b', epoch: 2 }, roomId: '99' });
  assert.equal(f.service.getSnapshot().boards[0].current, null);
  assert.equal(f.calls[0].signal.aborted, true);
  pending = null;
  release(); await settle();
  const next = f.service.getSnapshot();
  assert.equal(next.room.roomId, '99');
  assert.equal(next.boards[0].current.roomId, '99');
  f.setScope(null);
  assert.equal(f.service.getSnapshot().boards.length, 0);
});

test('one failed board backs off without discarding healthy boards and recovers with fresh data', async t => {
  let fail = false;
  const f = fixture(t, definition => {
    if (fail && definition.id === 'hot') throw Object.assign(new Error('rate limited'), { retryAfterMs: 2000 });
  });
  f.service.getSnapshot(); await settle();
  fail = true;
  t.mock.timers.tick(500); await settle();
  const stale = f.service.getSnapshot();
  assert.equal(stale.boards[0].status, 'stale');
  assert.equal(stale.boards[0].current.score, 42);
  assert.equal(stale.boards[1].status, 'ready');
  const hotCalls = () => f.calls.filter(call => call.id === 'hot').length;
  t.mock.timers.tick(500); await settle();
  assert.equal(hotCalls(), 2);
  fail = false;
  t.mock.timers.tick(1500); await settle();
  assert.equal(hotCalls(), 3);
  assert.equal(f.service.getSnapshot().boards[0].status, 'ready');
});
