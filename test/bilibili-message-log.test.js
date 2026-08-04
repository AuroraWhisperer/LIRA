'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { formatBilibiliCommandLog } = require('../src/bilibili/bilibili-message-handler');

test('formats accepted commands with transport and connection trace', () => {
  assert.equal(
    formatBilibiliCommandLog({
      message: '点歌 日落',
      source: 'danmaku',
      userName: 'Alice',
      uid: 123,
      messageTimestamp: 1785769654000,
      connectionGeneration: 2,
      connectionAttempt: 3,
      cmd: 'DANMU_MSG'
    }, {
      accepted: true,
      queueItem: { song_name: '日落' }
    }),
    '[Bilibili][Command] status=accepted time=2026-08-03T15:07:34.000Z source=danmaku user="Alice" uid="123" message="点歌 日落" song="日落" trace={"connectionGeneration":2,"connectionAttempt":3,"cmd":"DANMU_MSG"}'
  );
});

test('formats ignored history commands with an explicit history command type', () => {
  assert.equal(
    formatBilibiliCommandLog({
      message: '点歌 日落',
      source: 'history',
      userName: 'Alice',
      uid: 123,
      messageTimestamp: 1785769654000,
      connectionGeneration: 2,
      connectionAttempt: 4,
      cmd: 'HISTORY'
    }, {
      accepted: false,
      reason: '用户冷却中。'
    }),
    '[Bilibili][Command] status=ignored time=2026-08-03T15:07:34.000Z source=history user="Alice" uid="123" message="点歌 日落" reason="用户冷却中。" trace={"connectionGeneration":2,"connectionAttempt":4,"cmd":"HISTORY"}'
  );
});
