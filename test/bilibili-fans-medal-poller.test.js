'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { FansMedalPoller } = require('../src/bilibili/danmaku/fans-medal-poller');
const { IdentityCache } = require('../src/bilibili/danmaku/identity-cache');

test('fans medal poller paginates the current-room member list into identity cache', async () => {
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
        uinfo_medal: { name: 'imilly', level: 28, ruid: 456, guard_level: 0 }
      }))
    },
    {
      num: 31,
      item: [{
        uid: 31,
        name: '第31人',
        medal_name: 'imilly',
        level: 12,
        target_id: 456,
        guard_level: 3,
        uinfo_medal: { name: 'imilly', level: 12, ruid: 456, guard_level: 3 }
      }]
    }
  ];
  const cache = new IdentityCache();
  const poller = new FansMedalPoller({
    async fetchFansMembersRank(roomId, ruid, page, pageSize) {
      calls.push({ roomId, ruid, page, pageSize });
      return pages[page - 1];
    }
  }, cache);

  await poller.pollFansMembers(123, 456);

  assert.deepEqual(calls, [
    { roomId: 123, ruid: 456, page: 1, pageSize: 30 },
    { roomId: 123, ruid: 456, page: 2, pageSize: 30 }
  ]);
  assert.deepEqual(cache.lookup(31, '第31人'), {
    uid: '31',
    userName: '第31人',
    guardLevel: 3,
    medalName: 'imilly',
    medalLevel: 12,
    seenAt: cache.lookup(31, '第31人').seenAt,
    currentRoom: true,
    source: 'fans_rank'
  });
});
