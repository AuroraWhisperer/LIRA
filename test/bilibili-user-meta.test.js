'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { extractBilibiliDanmakuUserMeta } = require('../src/bilibili/utils/user-meta-extractor');

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
