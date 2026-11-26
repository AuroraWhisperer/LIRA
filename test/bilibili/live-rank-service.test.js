'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: settle } = require('node:timers/promises');
const { createLiveRankService } = require('../../src/bilibili/live-rank-service');
const { createDisplayDemand } = require('../../src/scenes/display-demand');
const { routes } = require('../../src/server/routes/bilibili-routes');

function fixture(t, getBoard, idleTimeoutMs = 3000) {
  const start = Date.UTC(2026, 8, 1, 12);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start });
  let scope = { owner: { scope: 'account-a', epoch: 1 }, roomId: '88' };
  let profiles = 0;
  let wallOffset = 0;
  const timerNow = Date.now.bind(Date);
  t.mock.method(Date, 'now', () => timerNow() + wallOffset);
  t.mock.method(performance, 'now', () => timerNow() - start);
  const calls = [];
  const service = createLiveRankService({ demand: createDisplayDemand({ idleTimeoutMs }),
    getScope: () => scope,
    getRoomProfile: async () => { profiles++; return { roomId: scope.roomId, uid: scope.roomId }; },
    provider: {
      getContext: async profile => ({ room: profile, area: { title: '虚拟', type: 2 } }),
      async getBoard(definition, context, signal) {
        calls.push({ id: definition.id, roomId: context.room.roomId, at: Date.now(), signal });
        const score = (await getBoard?.(definition, context, signal)) ?? 42;
        return { id: definition.id, status: 'ready', rows: [{ roomId: context.room.roomId, rank: 3, score }],
          updatedAt: Date.now(), current: { roomId: context.room.roomId, rank: 3, score } };
      },
    },
  });
  t.after(() => service.dispose());
  return { service, calls, setScope: value => { scope = value; }, setWallOffset: value => { wallOffset = value; },
    get profiles() { return profiles; } };
}

test('rolling the wall clock back does not stall healthy boards or shorten the failed board retry', async t => {
  let score = 1;
  const f = fixture(t, definition => {
    if (definition.id === 'hot' && score === 1) throw Object.assign(new Error('retry'), { retryAfterMs: 2000 });
    return score;
  });
  f.service.touch(); await settle();
  const initial = f.service.getSnapshot();
  assert.equal(initial.boards[0].retryAt, initial.serverNow + 2000);
  f.setWallOffset(-60000);
  score = 2;
  t.mock.timers.tick(500); await settle();
  const snapshot = f.service.getSnapshot();
  assert.equal(snapshot.serverNow, initial.serverNow - 59500);
  assert.equal(snapshot.boards[1].current.score, 2);
  assert.equal(f.calls.filter(call => call.id === 'hot').length, 1);
  t.mock.timers.tick(1500); await settle();
  assert.equal(f.service.getSnapshot().boards[0].current.score, 2);
  for (let ms = 2500; ms <= 60000; ms += 500) {
    score = 100 + ms / 500;
    f.service.touch();
    t.mock.timers.tick(500); await settle();
    if (ms === 30500) assert.deepEqual(f.service.getSnapshot().boards.map(b => b.current.score), [161, 161, 161, 161]);
  }
  assert.equal(f.profiles, 2, 'the minute-long context TTL also uses elapsed time');
});

test('a versioned read receives the three completed boards while the area request is pending', async t => {
  const area = Promise.withResolvers();
  let score = 1;
  const f = fixture(t, definition => score === 2 && definition.id === 'popular-area' ? area.promise : score, 65000);
  const read = version => {
    let data;
    routes['GET /api/bilibili/live-rankings']({ liveRankings: f.service }, { query: new URLSearchParams({ version }) }, {
      setHeader() {}, writeHead() {}, end(body) { data = JSON.parse(body).data; },
    });
    return data;
  };
  f.service.touch(); await settle();
  const first = read('');
  score = 2;
  t.mock.timers.tick(59500); await settle();
  const partial = read(first.version);
  assert.deepEqual(partial.boards?.map(board => board.current.score), [2, 2, 2, 1]);
  assert.equal(read(partial.version).unchanged, true);
  score = 3;
  t.mock.timers.tick(500); await settle();
  const next = read(partial.version);
  assert.deepEqual(next.boards?.map(board => board.current.score), [3, 3, 3, 1]);
  assert.equal(f.calls.filter(call => call.id === 'popular-area').length, 2);
  area.resolve(2); await settle();
  assert.equal(read(next.version).boards[3].current.score, 2);
});

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
  f.setWallOffset(-60000);
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
