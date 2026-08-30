'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractBilibiliSuperChatMessage,
} = require('../src/bilibili/parsers/superchat-parser');

test('superchat metadata drops a medal explicitly belonging to another room', () => {
  const result = extractBilibiliSuperChatMessage(
    {
      data: {
        message: '点歌',
        uid: 123,
        user_info: {
          uname: '点歌人',
        },
        medal_info: {
          medal_name: '别家牌子',
          medal_level: 30,
          target_id: 999,
          guard_level: 2,
        },
      },
    },
    456,
  );

  assert.equal(result.medalName, '');
  assert.equal(result.medalLevel, 0);
  assert.equal(result.guardLevel, 0);
  assert.equal(result.currentRoomVerified, true);
});

test('superchat maps a trusted user face into the identity avatar', () => {
  const result = extractBilibiliSuperChatMessage({
    data: {
      uid: 123,
      user_info: {
        uname: '点歌人',
        face: 'https://i0.hdslb.com/bfs/face/superchat.jpg',
      },
    },
  });

  assert.equal(result.avatarUrl, 'https://i0.hdslb.com/bfs/face/superchat.jpg');
});
