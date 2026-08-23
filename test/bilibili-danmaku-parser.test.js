'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractBilibiliDanmakuAvatarUrl,
  extractBilibiliDanmakuEmotes
} = require('../src/bilibili/parsers/danmaku-parser');

function createInfo(user) {
  const info = [];
  info[0] = Array(16).fill(null);
  info[0][15] = { user };
  return info;
}

test('danmaku avatar parser reads the live room user face', () => {
  const avatarUrl = 'https://i0.hdslb.com/bfs/face/example.webp';

  assert.equal(extractBilibiliDanmakuAvatarUrl(createInfo({ face: avatarUrl })), avatarUrl);
});

test('danmaku avatar parser supports the nested base face field', () => {
  const avatarUrl = 'https://i1.hdslb.com/bfs/face/example.jpg';

  assert.equal(extractBilibiliDanmakuAvatarUrl(createInfo({ base: { face: avatarUrl } })), avatarUrl);
});

test('danmaku avatar parser supports JSON encoded user metadata', () => {
  const avatarUrl = 'https://i2.hdslb.com/bfs/face/encoded.jpg';
  const info = [];
  info[0] = Array(16).fill(null);
  info[0][15] = JSON.stringify({ user: { base: { face: avatarUrl } } });

  assert.equal(extractBilibiliDanmakuAvatarUrl(info), avatarUrl);
});

test('danmaku avatar parser upgrades official HTTP avatars and rejects other hosts', () => {
  assert.equal(
    extractBilibiliDanmakuAvatarUrl(createInfo({ face: 'http://i0.hdslb.com/bfs/face/example.jpg' })),
    'https://i0.hdslb.com/bfs/face/example.jpg'
  );
  assert.equal(extractBilibiliDanmakuAvatarUrl(createInfo({ face: 'https://example.com/avatar.jpg' })), '');
  assert.equal(extractBilibiliDanmakuAvatarUrl(createInfo({ face: 'https://hdslb.com/avatar.jpg' })), '');
});

test('danmaku emote parser reads inline emotes from JSON encoded extra metadata', () => {
  const info = createInfo({ face: 'https://i0.hdslb.com/bfs/face/viewer.jpg' });
  info[0][15].extra = JSON.stringify({
    emots: {
      '[妙]': {
        emotion_unique: 'emoji_1',
        url: 'https://i0.hdslb.com/bfs/emote/miao.png',
        width: 64,
        height: 64
      }
    }
  });

  assert.deepEqual(extractBilibiliDanmakuEmotes(info), [{
    text: '[妙]',
    url: 'https://i0.hdslb.com/bfs/emote/miao.png',
    width: 64,
    height: 64
  }]);
});

test('danmaku emote parser reads whole-message emoticons and upgrades trusted HTTP images', () => {
  const info = createInfo({});
  info[1] = '[打call]';
  info[0][15].emoticon = {
    text: '[打call]',
    url: 'http://i1.hdslb.com/bfs/emote/call.gif',
    width: 180,
    height: 90
  };

  assert.deepEqual(extractBilibiliDanmakuEmotes(info), [{
    text: '[打call]',
    url: 'https://i1.hdslb.com/bfs/emote/call.gif',
    width: 180,
    height: 90
  }]);
});

test('danmaku emote parser rejects untrusted images and deduplicates trigger text', () => {
  const info = createInfo({});
  info[0][15].emots = {
    '[安全]': { url: 'https://i0.hdslb.com/bfs/emote/safe.webp', width: 40, height: 40 },
    '[坏]': { url: 'https://example.com/bad.png', width: 40, height: 40 }
  };
  info[0][15].extra = JSON.stringify({
    emots: {
      '[安全]': { url: 'https://i1.hdslb.com/bfs/emote/duplicate.webp', width: 80, height: 80 }
    }
  });

  assert.deepEqual(extractBilibiliDanmakuEmotes(info), [{
    text: '[安全]',
    url: 'https://i0.hdslb.com/bfs/emote/safe.webp',
    width: 40,
    height: 40
  }]);
});
