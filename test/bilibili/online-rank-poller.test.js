'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { OnlineRankPoller } = require('../../src/bilibili/danmaku/online-rank-poller');
const { UserInfoService } = require('../../src/bilibili/users/user-info-service');

function fixture(t) {
  const users = new UserInfoService();
  const calls = [];
  const snapshots = [];
  const poller = new OnlineRankPoller({
    fetchOnlineRank(roomId, ownerUid, sort) {
      const request = Promise.withResolvers();
      calls.push({ roomId, ownerUid, sort, resolve: request.resolve });
      return request.promise;
    },
  }, {
    ingestHint() {},
    replaceOnlineSnapshot(ids, context) { snapshots.push({ ids, context }); },
  });
  t.after(() => { poller.stop(); users.dispose(); });
  function run(roomId = '100') {
    users.setRoom({ roomId, ownerUid: '999' });
    return users.beginRoomRun();
  }
  function finishPair(start, uid) {
    calls[start].resolve({ item: [{ uid, name: `访客${uid}` }] });
    calls[start + 1].resolve({ item: [] });
  }
  return { calls, snapshots, poller, run, finishPair };
}

test('same room run shares both pending orderings and keeps its original polling deadline', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { poller, calls, snapshots, run, finishPair } = fixture(t);
  const context = run();
  poller.start(context);
  const first = poller.pollOnlineRank(context);
  t.mock.timers.tick(20_000);
  poller.start(context);
  assert.deepEqual(calls.map(c => c.sort), ['contribution_rank', 'entry_time_rank']);
  assert.equal(poller.pollOnlineRank(context), first);
  finishPair(0, '1');
  await first;
  assert.deepEqual(snapshots, [{ ids: ['1'], context }]);
  poller.start(context);
  t.mock.timers.tick(39_999);
  assert.equal(calls.length, 2);
  t.mock.timers.tick(1);
  assert.equal(calls.length, 4);
  const second = poller.pollOnlineRank(context);
  finishPair(2, '2');
  await second;
  assert.deepEqual(snapshots.map(s => s.ids), [['1'], ['2']]);
});

for (const change of ['new run in the same room', 'room A to B to A', 'stop and start with the same context']) {
  test(`${change} starts fresh orderings and rejects the late prior snapshot`, async t => {
    const { poller, calls, snapshots, run, finishPair } = fixture(t);
    const old = run();
    poller.start(old);
    const previous = poller.pollOnlineRank(old);
    let current = old;
    let middle;
    if (change === 'stop and start with the same context') {
      poller.stop();
    } else {
      if (change === 'room A to B to A') {
        const otherRoom = run('200');
        poller.start(otherRoom);
        middle = poller.pollOnlineRank(otherRoom);
      }
      current = run();
    }
    poller.start(current);
    const latest = poller.pollOnlineRank(current);
    const finalPair = middle ? 4 : 2;
    assert.equal(calls.length, finalPair + 2);
    finishPair(0, '1');
    if (middle) finishPair(2, '2');
    await Promise.all([previous, middle]);
    assert.deepEqual(snapshots, []);
    assert.equal(poller.pollOnlineRank(current), latest);
    finishPair(finalPair, '3');
    await latest;
    assert.deepEqual(snapshots, [{ ids: ['3'], context: current }]);
  });
}

test('fresh runtimes with identical room and token values own independent reads', async t => {
  const first = fixture(t);
  const second = fixture(t);
  const old = first.run();
  const current = second.run();
  assert.deepEqual(old, current);
  first.poller.start(old);
  const previous = first.poller.pollInFlight;
  first.poller.stop();
  second.poller.start(current);
  const latest = second.poller.pollInFlight;
  assert.deepEqual([first.calls.length, second.calls.length], [2, 2]);
  second.finishPair(0, '2');
  first.finishPair(0, '1');
  await Promise.all([previous, latest]);
  assert.deepEqual(second.snapshots, [{ ids: ['2'], context: current }]);
  assert.deepEqual(first.snapshots, []);
});
