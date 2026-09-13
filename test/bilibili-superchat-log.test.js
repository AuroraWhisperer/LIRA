'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  formatBilibiliSuperChatLog,
} = require('../src/bilibili/danmaku/message-handlers');

test('formats every received SuperChat with connection correlation', () => {
  assert.equal(
    formatBilibiliSuperChatLog(
      {
        uid: 123,
        userName: 'Alice',
        message: '支持主播',
        price: 30,
        messageTimestamp: 1785769654000,
      },
      {
        connectionGeneration: 2,
        connectionAttempt: 3,
        cmd: 'SUPER_CHAT_MESSAGE',
      },
    ),
    '[Bilibili][SuperChat] status=received user="Alice" uid="123" price=30 message="支持主播" trace={"connectionGeneration":2,"connectionAttempt":3,"cmd":"SUPER_CHAT_MESSAGE","messageTimestamp":"2026-08-03T15:07:34.000Z"}',
  );
});
