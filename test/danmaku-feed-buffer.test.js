'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createDanmakuFeedBuffer } = require('../src/bilibili/danmaku/feed-buffer');

test('danmaku feed buffer projects public fields and keeps a bounded defensive snapshot', () => {
  const feed = createDanmakuFeedBuffer({ limit: 2 });
  feed.setRoom('100');

  feed.push({ uid: '1', userName: '甲', message: '第一条', secret: 'drop-me', messageTimestamp: 1000 });
  const second = feed.push({
    uid: '2',
    userName: '乙',
    message: '第二条[妙]',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/viewer.jpg',
    requesterGuardLevel: 3,
    requesterMedalName: '米粒',
    requesterMedalLevel: 16,
    messageTimestamp: 2000,
    emotes: [{ text: '[妙]', url: 'https://i0.hdslb.com/bfs/emote/miao.png', width: 64, height: 64 }]
  });
  feed.push({ uid: '3', userName: '丙', message: '第三条', messageTimestamp: 3000 });

  assert.equal(second.id, 2);
  assert.deepEqual(Object.keys(second), [
    'id', 'uid', 'name', 'message', 'avatarUrl', 'guardLevel', 'medalName',
    'medalLevel', 'timestamp', 'emotes'
  ]);
  assert.deepEqual(feed.getSnapshot().map(item => item.name), ['乙', '丙']);
  const snapshot = feed.getSnapshot();
  snapshot[0].name = '篡改';
  snapshot[0].emotes[0].text = '篡改';
  assert.equal(feed.getSnapshot()[0].name, '乙');
  assert.equal(feed.getSnapshot()[0].emotes[0].text, '[妙]');
});

test('danmaku feed buffer clears only when the active room changes', () => {
  const feed = createDanmakuFeedBuffer({ limit: 4 });
  feed.setRoom('100');
  feed.push({ uid: '1', userName: '甲', message: '保留' });

  assert.equal(feed.setRoom('100'), false);
  assert.equal(feed.getSnapshot().length, 1);
  assert.equal(feed.setRoom('200'), true);
  assert.equal(feed.getSnapshot().length, 0);
  assert.equal(feed.push({ uid: '2', userName: '乙', message: '新房间' }).id, 2);
});

test('danmaku feed buffer ignores empty messages', () => {
  const feed = createDanmakuFeedBuffer();
  assert.equal(feed.push({ userName: '甲', message: '   ' }), null);
  assert.deepEqual(feed.getSnapshot(), []);
});

test('danmaku feed buffer keeps the latest 50 messages by default', () => {
  const feed = createDanmakuFeedBuffer();
  for (let index = 1; index <= 51; index += 1) {
    feed.push({ userName: `观众${index}`, message: `第${index}条` });
  }

  const snapshot = feed.getSnapshot();
  assert.equal(snapshot.length, 50);
  assert.equal(snapshot[0].message, '第2条');
  assert.equal(snapshot[49].message, '第51条');
});
