'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { extractBilibiliDanmakuAvatarUrl } = require('../src/bilibili/parsers/danmaku-parser');

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
