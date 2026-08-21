'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { HistoryPoller } = require('../src/bilibili/danmaku/history-poller');
const { OnlineRankPoller } = require('../src/bilibili/danmaku/online-rank-poller');
const { MessageDeduplicator } = require('../src/bilibili/danmaku/message-deduplicator');
const { UserInfoService } = require('../src/bilibili/users/user-info-service');

test('history poller deduplicates and submits a stable old-to-new hint order', async () => {
  const now = Date.now();
  const observed = [];
  const service = new UserInfoService({ now: () => now });
  service.setRoom({ roomId: '100', ownerUid: '999' });
  const context = service.beginRoomRun();
  const poller = new HistoryPoller({
    async fetchHistory() {
      return {
        room: [
          { uid: '1', nickname: 'new', text: '点歌 新', timeline: now - 1000 },
          { uid: '1', nickname: 'old', text: '点歌 旧', timeline: now - 2000 },
          { uid: '1', nickname: 'old', text: '点歌 旧', timeline: now - 2000 }
        ]
      };
    }
  }, message => observed.push(message.userName), {
    startedAtMs: now - 5000,
    roomOwnerUid: '999',
    deduplicator: new MessageDeduplicator(),
    isCommandText: () => true,
    onIdentityHint: (hint, ingestContext) => service.ingestHint(hint, ingestContext)
  });

  await poller.pollHistory(context);
  assert.deepEqual(observed, ['old', 'new']);
});

test('online rank poller uses the injected sink and replaces the latest snapshot', async () => {
  const service = new UserInfoService();
  service.setRoom({ roomId: '100', ownerUid: '999' });
  const context = service.beginRoomRun();
  const poller = new OnlineRankPoller({
    async fetchOnlineRank(roomId, ownerUid, page) {
      assert.equal(roomId, '100');
      assert.equal(ownerUid, '999');
      return page === 1
        ? { list: [{ uid: '1', uname: 'Alice', face: 'https://i0.hdslb.com/bfs/face/a.jpg', medal_info: { name: '牌', level: 1, ruid: 999 } }], onlineNum: 1 }
        : { list: [], onlineNum: 1 };
    }
  }, {
    ingestHint: (hint, ingestContext) => service.ingestHint(hint, ingestContext),
    replaceOnlineSnapshot: (uids, replaceContext) => service.replaceOnlineSnapshot(uids, replaceContext)
  });

  await poller.pollOnlineRank(context);
  assert.deepEqual(service.listOnline({ fields: ['name'] }), [{ uid: '1', name: 'Alice' }]);
});
