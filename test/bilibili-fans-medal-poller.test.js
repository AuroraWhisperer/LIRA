'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { FansMedalPoller } = require('../src/bilibili/danmaku/fans-medal-poller');
const { UserInfoService } = require('../src/bilibili/users/user-info-service');

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
  const service = new UserInfoService();
  service.setRoom({ roomId: '123', ownerUid: '456' });
  const context = service.beginRoomRun();
  const poller = new FansMedalPoller({
    async fetchFansMembersRank(roomId, ruid, page, pageSize) {
      calls.push({ roomId, ruid, page, pageSize });
      return pages[page - 1];
    }
  }, {
    ingestHint: (hint, ingestContext) => service.ingestHint(hint, ingestContext)
  });

  await poller.pollFansMembers(context);

  assert.deepEqual(calls, [
    { roomId: '123', ruid: '456', page: 1, pageSize: 30 },
    { roomId: '123', ruid: '456', page: 2, pageSize: 30 }
  ]);
  assert.deepEqual(service.peek('31', { fields: ['name', 'guard', 'fansMedal'] }), {
    uid: '31',
    name: '第31人',
    room: { roomId: '123', ownerUid: '456' },
    guard: { known: true, level: 3 },
    fansMedal: {
      known: true,
      value: { name: 'imilly', level: 12, targetUid: '456' }
    }
  });
});
