'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { FansMedalPoller } = require('../../src/bilibili/danmaku/fans-medal-poller');
const { UserInfoService } = require('../../src/bilibili/users/user-info-service');

test('fans medal poller paginates through an injected user-info sink', async () => {
  const calls = [];
  const pages = [
    {
      num: 31,
      item: Array.from({ length: 30 }, (_, index) => ({
        uid: index + 1,
        name: `观众${index + 1}`,
        medal_name: 'imilly',
        level: 28,
        target_id: 456,
        guard_level: 0,
        uinfo_medal: { name: 'imilly', level: 28, ruid: 456, guard_level: 0 },
      })),
    },
    {
      num: 31,
      item: [
        {
          uid: 31,
          name: '第31人',
          medal_name: 'imilly',
          level: 12,
          target_id: 456,
          guard_level: 3,
          uinfo_medal: { name: 'imilly', level: 12, ruid: 456, guard_level: 3 },
        },
      ],
    },
  ];
  const service = new UserInfoService();
  service.setRoom({ roomId: '123', ownerUid: '456' });
  const context = service.beginRoomRun();
  const poller = new FansMedalPoller(
    {
      async fetchFansMembersRank(roomId, ruid, page, pageSize) {
        calls.push({ roomId, ruid, page, pageSize });
        return pages[page - 1];
      },
    },
    {
      ingestHint: (hint, ingestContext) => service.ingestHint(hint, ingestContext),
    },
  );

  await poller.pollFansMembers(context);

  assert.deepEqual(calls, [
    { roomId: '123', ruid: '456', page: 1, pageSize: 30 },
    { roomId: '123', ruid: '456', page: 2, pageSize: 30 },
  ]);
  assert.deepEqual(service.peek('31', { fields: ['name', 'guard', 'fansMedal'] }), {
    uid: '31',
    name: '第31人',
    room: { roomId: '123', ownerUid: '456' },
    guard: { known: true, level: 3 },
    fansMedal: {
      known: true,
      value: { name: 'imilly', level: 12, targetUid: '456' },
    },
  });
});

function schedulerFixture(fetchPage) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const hints = [];
  const calls = [];
  const poller = new FansMedalPoller({
    fetchFansMembersRank: async (...args) => {
      calls.push(args);
      return fetchPage(...args);
    },
  }, { ingestHint(hint) { hints.push(hint); return { snapshot: hint }; } }, {
    now: () => now,
    random: () => 0,
    setTimeout(callback, delay) { timers.set(++nextId, { callback, delay }); return nextId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const context = { roomId: '123', ownerUid: '456', generation: 1, runToken: 1 };
  return {
    poller, context, timers, calls, hints,
    advance(ms) { now += ms; },
    async settle() { for (let i = 0; i < 250; i += 1) await Promise.resolve(); },
    async next() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0];
      timers.delete(id);
      now += timer.delay;
      await timer.callback();
      return timer.delay;
    },
  };
}

function members(page, count = 30) {
  return { num: 1000, item: Array.from({ length: count }, (_, i) => ({
    uid: (page - 1) * 30 + i + 1, name: '观众',
    uinfo_medal: { name: '粉丝牌', level: 1, ruid: 456, guard_level: 0 },
  })) };
}

test('fans scans continue after the page budget and same-room reconnect preserves the timer', async (t) => {
  const f = schedulerFixture((_room, _owner, page) => members(page, page === 34 ? 10 : 30));
  t.after(() => f.poller.stop());
  f.poller.start(f.context);
  await f.settle();
  assert.equal(f.calls.length, 30);
  assert.equal(f.hints.length, 900);
  f.poller.start({ ...f.context });
  await f.settle();
  assert.equal(f.calls.length, 30);
  assert.equal(await f.next(), 1000);
  assert.equal(f.calls.length, 34);
  assert.equal(f.hints.at(-1).uid, '1000');
  f.poller.start({ ...f.context });
  assert.equal(f.calls.length, 34);
  assert.equal(await f.next(), 299000);
  assert.equal(f.calls[34][2], 1);
});

test('fans scan time budget yields and resumes the next page', async (t) => {
  const f = schedulerFixture((_room, _owner, page) => {
    f.advance(6000);
    return members(page);
  });
  t.after(() => f.poller.stop());
  f.poller.start(f.context);
  await f.settle();
  assert.deepEqual(f.calls.map((args) => args[2]), [1, 2]);
  await f.next();
  assert.deepEqual(f.calls.map((args) => args[2]), [1, 2, 3, 4]);
});

test('fans failures back off without clearing evidence and success restores the five-minute cadence', async (t) => {
  let fail = true;
  const f = schedulerFixture(() => {
    if (fail) throw new Error('temporary failure');
    return members(1, 1);
  });
  t.after(() => f.poller.stop());
  f.poller.start(f.context);
  await f.settle();
  assert.equal(await f.next(), 300000);
  assert.equal(await f.next(), 600000);
  assert.equal(await f.next(), 1200000);
  fail = false;
  assert.equal(await f.next(), 1800000);
  assert.equal(f.hints.length, 1);
  assert.equal(await f.next(), 300000);
  assert.equal(f.hints.length, 2);
});

test('room switch waits for old HTTP work and rejects its late identity hints', async (t) => {
  let resolveOld;
  const f = schedulerFixture((room) => room === '123'
    ? new Promise((resolve) => { resolveOld = resolve; })
    : members(1, 1));
  t.after(() => f.poller.stop());
  f.poller.start(f.context);
  f.poller.start({ ...f.context, roomId: '999', generation: 2 });
  assert.equal(f.calls.length, 1);
  resolveOld(members(1, 1));
  await f.settle();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1][0], '999');
  assert.equal(f.hints.length, 1);
  assert.equal(f.timers.size, 1);
});

test('stopping a pending scan prevents ingestion and timer resurrection', async () => {
  let resolvePage;
  const f = schedulerFixture(() => new Promise((resolve) => { resolvePage = resolve; }));
  f.poller.start(f.context);
  f.poller.stop();
  resolvePage(members(1, 1));
  await f.settle();
  assert.equal(f.hints.length, 0);
  assert.equal(f.timers.size, 0);
});
