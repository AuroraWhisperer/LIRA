'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractBilibiliDanmakuUserMeta,
  extractBilibiliHistoryUserMeta,
  extractBilibiliOnlineRankUserMeta,
} = require('../../src/bilibili/utils/user-meta-extractor');

test('danmaku metadata keeps a medal-only requester out of the guard tiers', () => {
  const info = [];
  info[0] = Array(16).fill(null);
  info[0][15] = {
    user: {
      medal: {
        name: 'imilly',
        level: 26,
        guard_level: 0,
      },
      guard: {
        level: 0,
      },
    },
  };
  info[3] = [26, 'imilly', 123, 456, 0, '', 0, 0, 0, 0, 0, 1, 789];
  info[7] = 3;

  assert.deepEqual(extractBilibiliDanmakuUserMeta(info), {
    guardLevel: 0,
    medalName: 'imilly',
    medalLevel: 26,
  });
});

test('danmaku metadata still reads legacy guard levels when the medal tuple has no guard field', () => {
  const info = [];
  info[3] = [12, '其他灯牌'];
  info[7] = 3;

  assert.deepEqual(extractBilibiliDanmakuUserMeta(info), {
    guardLevel: 3,
    medalName: '其他灯牌',
    medalLevel: 12,
  });
});

test('online rank metadata uses the current room guard instead of the worn medal guard', () => {
  assert.deepEqual(
    extractBilibiliOnlineRankUserMeta(
      {
        uid: 123,
        name: '点歌人',
        guard_level: 3,
        medalInfo: {
          guardLevel: 2,
          medalName: '其他房间灯牌',
          level: 30,
          targetId: 999,
        },
        uinfo: {
          guard: { level: 3 },
        },
      },
      456,
    ),
    {
      uid: '123',
      userName: '点歌人',
      guardLevel: 3,
      medalName: '',
      medalLevel: 0,
      currentRoomVerified: true,
    },
  );
});

test('online rank metadata carries the viewer avatar into the identity cache input', () => {
  assert.deepEqual(
    extractBilibiliOnlineRankUserMeta({
      uid: 123,
      name: '点歌人',
      uinfo: {
        base: {
          face: 'https://i0.hdslb.com/bfs/face/viewer.jpg',
        },
      },
    }),
    {
      uid: '123',
      userName: '点歌人',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/viewer.jpg',
      guardLevel: 0,
      medalName: '',
      medalLevel: 0,
    },
  );
});

test('danmaku metadata ignores a worn medal that belongs to another room', () => {
  const info = [];
  info[0] = Array(16).fill(null);
  info[0][15] = {
    user: {
      medal: {
        name: '其他房间灯牌',
        level: 30,
        guard_level: 2,
        ruid: 999,
      },
      guard: {
        level: 3,
      },
    },
  };
  info[3] = [30, '其他房间灯牌', '其他主播', 789, 0, '', 0, 0, 0, 0, 2, 1, 999];
  info[7] = 2;

  assert.deepEqual(extractBilibiliDanmakuUserMeta(info, 456), {
    guardLevel: 3,
    medalName: '',
    medalLevel: 0,
    currentRoomVerified: true,
  });
  const objectMetadata = extractBilibiliDanmakuUserMeta(info, 456);
  info[0][15] = JSON.stringify(info[0][15]);
  assert.deepEqual(extractBilibiliDanmakuUserMeta(info, 456), objectMetadata);
});

test('danmaku metadata keeps the current-room medal when nested worn medal belongs elsewhere', () => {
  const info = [];
  info[0] = Array(16).fill(null);
  info[0][15] = {
    user: {
      medal: {
        name: '别家牌子',
        level: 30,
        ruid: 999,
      },
      guard: {
        level: 0,
      },
    },
  };
  info[3] = [28, 'imilly', '当前主播', 123, 0, '', 0, 0, 0, 0, 0, 1, 456];

  assert.deepEqual(extractBilibiliDanmakuUserMeta(info, 456), {
    guardLevel: 0,
    medalName: 'imilly',
    medalLevel: 28,
    currentRoomVerified: true,
  });
});

test('history metadata drops a medal explicitly belonging to another room', () => {
  assert.deepEqual(
    extractBilibiliHistoryUserMeta(
      {
        guard_level: 2,
        medal: {
          medal_name: '别家牌子',
          medal_level: 30,
          target_id: 999,
        },
      },
      456,
    ),
    {
      guardLevel: 2,
      medalName: '',
      medalLevel: 0,
      currentRoomVerified: true,
    },
  );
});

test('danmaku delivery distinguishes verified current-room identity, another room medal and missing evidence', () => {
  const { MessageHandlers } = require('../../src/bilibili/danmaku/message-handlers');
  const { MessageDeduplicator } = require('../../src/bilibili/danmaku/message-deduplicator');
  const { UserInfoService } = require('../../src/bilibili/users/user-info-service');
  const users = new UserInfoService();
  users.setRoom({ roomId: '100', ownerUid: '456' });
  const run = users.beginRoomRun();
  const messages = [];
  const handler = new MessageHandlers({ onMessage: (event) => messages.push(event) }, users,
    new MessageDeduplicator(), {}, { startedAtMs: 1, roomOwnerUid: '456' });
  handler.updateRoomRunContext(run);
  try {
    for (const [uid, target] of [[1, 456], [2, 999], [3, 0]]) {
      const info = [];
      info[0] = [0, 0, 0, 0, Date.now()];
      info[1] = '点歌身份';
      info[2] = [uid, '观众'];
      info[3] = target ? [30, '粉丝牌', '主播', 100, 0, '', 0, 0, 0, 0, 2, 1, target] : [];
      handler.handleDanmaku({ cmd: 'DANMU_MSG', info });
    }
    assert.deepEqual(messages.map((event) => [event.requesterGuardVerified, event.requesterGuardLevel,
      event.requesterMedalVerified, event.requesterMedalLevel]), [
      [true, 2, true, 30], [true, 0, true, 0], [false, 0, false, 0],
    ]);
  } finally {
    handler.destroy();
    users.dispose();
  }
});

test('history delivery preserves known absence and never promotes unverified fallback metadata', () => {
  const { BilibiliDanmakuClient } = require('../../src/bilibili/danmaku-client');
  const delivered = [];
  const client = { stopped: false, deliverDanmaku: (event) => delivered.push(event) };
  const event = { uid: '42', message: '点歌历史', requesterGuardLevel: 3,
    requesterMedalName: '旧牌', requesterMedalLevel: 30, currentRoomVerified: true };
  BilibiliDanmakuClient.prototype.handleHistoryMessage.call(client, { ...event,
    identitySnapshot: { uid: '42', guard: { known: false }, fansMedal: { known: true, value: null } } });
  assert.equal(delivered[0].requesterGuardVerified, false);
  assert.equal(delivered[0].requesterMedalVerified, true);
  assert.equal(delivered[0].requesterMedalLevel, 0);
  assert.equal(delivered[0].requesterMedalName, '');
  BilibiliDanmakuClient.prototype.handleHistoryMessage.call(client, { ...event, currentRoomVerified: false });
  assert.equal(delivered[1].requesterGuardVerified, false);
  assert.equal(delivered[1].requesterMedalVerified, false);
});
