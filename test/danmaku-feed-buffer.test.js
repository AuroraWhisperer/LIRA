'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDanmakuFeedBuffer,
} = require('../src/bilibili/danmaku/feed-buffer');

test('danmaku feed buffer projects public fields and keeps a bounded defensive snapshot', () => {
  const feed = createDanmakuFeedBuffer({ limit: 2 });
  feed.setRoom('100');

  feed.push({
    uid: '1',
    userName: '甲',
    message: '第一条',
    secret: 'drop-me',
    messageTimestamp: 1000,
  });
  const second = feed.push({
    uid: '2',
    userName: '乙',
    message: '第二条[妙]',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/viewer.jpg',
    requesterGuardLevel: 3,
    requesterMedalName: '米粒',
    requesterMedalLevel: 16,
    messageTimestamp: 2000,
    emotes: [
      {
        text: '[妙]',
        url: 'https://i0.hdslb.com/bfs/emote/miao.png',
        width: 64,
        height: 64,
      },
    ],
  });
  feed.push({
    uid: '3',
    userName: '丙',
    message: '第三条',
    messageTimestamp: 3000,
  });

  assert.equal(second.id, 2);
  assert.deepEqual(Object.keys(second), [
    'id',
    'uid',
    'name',
    'message',
    'avatarUrl',
    'guardLevel',
    'medalName',
    'medalLevel',
    'timestamp',
    'emotes',
  ]);
  assert.deepEqual(
    feed.getSnapshot().map((item) => item.name),
    ['乙', '丙'],
  );
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
  assert.equal(
    feed.push({ uid: '2', userName: '乙', message: '新房间' }).id,
    2,
  );
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

test('finalized gifts share the public feed without exposing ledger fields', () => {
  const feed = createDanmakuFeedBuffer({ limit: 2 });
  feed.setRoom('100');
  feed.push({ name: '观众', message: '好听' });
  const gift = feed.pushGift({
    id: 71, detection_status: 'final', uid: '42', user_name: '晚风',
    gift_name: '小花花', num: 10, total_price: 100,
    source_event_id: 'private-ledger-id', raw_data: 'private',
  });
  assert.equal(gift.id, 2);
  assert.equal(gift.kind, 'gift');
  assert.equal(gift.name, '晚风');
  assert.equal(gift.message, '送出 小花花 × 10');
  assert.equal(gift.giftName, '小花花');
  assert.equal(gift.giftCount, 10);
  for (const field of ['total_price', 'source_event_id', 'raw_data', 'detection_status']) {
    assert.equal(Object.hasOwn(gift, field), false);
  }
  gift.giftName = '篡改';
  assert.equal(feed.getSnapshot()[1].giftName, '小花花');
  feed.push({ message: '谢谢' });
  assert.deepEqual(feed.getSnapshot().map(item => item.id), [2, 3]);
  feed.setRoom('200');
  assert.deepEqual(feed.getSnapshot(), []);
});

test('gift feed projection ignores progress and invalid gift quantities', () => {
  const feed = createDanmakuFeedBuffer();
  assert.equal(feed.pushGift({ detection_status: 'progress', num: 5 }), null);
  for (const num of [0, -1, 1.5, Infinity, 'invalid', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(feed.pushGift({ detection_status: 'final', num }), null);
  }
  assert.deepEqual(feed.getSnapshot(), []);
});
