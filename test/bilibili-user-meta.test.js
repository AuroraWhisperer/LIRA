'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractBilibiliDanmakuUserMeta,
  extractBilibiliOnlineRankUserMeta
} = require('../src/bilibili/utils/user-meta-extractor');

test('danmaku metadata keeps a medal-only requester out of the guard tiers', () => {
  const info = [];
  info[0] = Array(16).fill(null);
  info[0][15] = {
    user: {
      medal: {
        name: 'imilly',
        level: 26,
        guard_level: 0
      },
      guard: {
        level: 0
      }
    }
  };
  info[3] = [26, 'imilly', 123, 456, 0, '', 0, 0, 0, 0, 0, 1, 789];
  info[7] = 3;

  assert.deepEqual(extractBilibiliDanmakuUserMeta(info), {
    guardLevel: 0,
    medalName: 'imilly',
    medalLevel: 26
  });
});

test('danmaku metadata still reads legacy guard levels when the medal tuple has no guard field', () => {
  const info = [];
  info[3] = [12, '其他灯牌'];
  info[7] = 3;

  assert.deepEqual(extractBilibiliDanmakuUserMeta(info), {
    guardLevel: 3,
    medalName: '其他灯牌',
    medalLevel: 12
  });
});

test('online rank metadata uses the current room guard instead of the worn medal guard', () => {
  assert.deepEqual(extractBilibiliOnlineRankUserMeta({
    uid: 123,
    name: '点歌人',
    guard_level: 3,
    medalInfo: {
      guardLevel: 2,
      medalName: '其他房间灯牌',
      level: 30,
      targetId: 999
    },
    uinfo: {
      guard: { level: 3 }
    }
  }, 456), {
    uid: '123',
    userName: '点歌人',
    guardLevel: 3,
    medalName: '',
    medalLevel: 0
  });
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
        ruid: 999
      },
      guard: {
        level: 3
      }
    }
  };
  info[3] = [30, '其他房间灯牌', '其他主播', 789, 0, '', 0, 0, 0, 0, 2, 1, 999];
  info[7] = 2;

  assert.deepEqual(extractBilibiliDanmakuUserMeta(info, 456), {
    guardLevel: 3,
    medalName: '',
    medalLevel: 0
  });
});
