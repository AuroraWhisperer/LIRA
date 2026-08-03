'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MessageDeduplicator } = require('../src/bilibili/danmaku/message-deduplicator');

test('deduplicates one command across masked danmaku and full history identities', () => {
  const deduplicator = new MessageDeduplicator();
  const timestamp = Date.now();

  assert.equal(deduplicator.remember(0, '点歌1', timestamp, {
    userName: '哈***',
    source: 'danmaku'
  }), true);
  assert.equal(deduplicator.remember(12345, '点歌1', timestamp, {
    userName: '哈极光dd_',
    source: 'history'
  }), false);
  assert.equal(deduplicator.remember(12345, '点歌1', timestamp, {
    userName: '哈极光dd_',
    source: 'history'
  }), false);
});

test('keeps simultaneous commands from different viewers', () => {
  const deduplicator = new MessageDeduplicator();
  const timestamp = Date.now();

  assert.equal(deduplicator.remember(101, '点歌 同一首', timestamp, {
    userName: '观众甲',
    source: 'danmaku'
  }), true);
  assert.equal(deduplicator.remember(202, '点歌 同一首', timestamp, {
    userName: '观众乙',
    source: 'history'
  }), true);
});

test('matches repeated cross-source commands one to one', () => {
  const deduplicator = new MessageDeduplicator();
  const timestamp = Date.now();
  const danmaku = { userName: '哈***', source: 'danmaku' };
  const history = { userName: '哈极光dd_', source: 'history' };

  assert.equal(deduplicator.remember(0, '点歌1', timestamp, danmaku), true);
  assert.equal(deduplicator.remember(0, '点歌1', timestamp + 1000, danmaku), true);
  assert.equal(deduplicator.remember(12345, '点歌1', timestamp, history), false);
  assert.equal(deduplicator.remember(12345, '点歌1', timestamp + 1000, history), false);
});
