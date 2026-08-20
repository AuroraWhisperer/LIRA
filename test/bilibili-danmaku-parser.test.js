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

test('danmaku avatar parser rejects non-Bilibili or insecure image URLs', () => {
  assert.equal(extractBilibiliDanmakuAvatarUrl(createInfo({ face: 'http://i0.hdslb.com/bfs/face/example.jpg' })), '');
  assert.equal(extractBilibiliDanmakuAvatarUrl(createInfo({ face: 'https://example.com/avatar.jpg' })), '');
  assert.equal(extractBilibiliDanmakuAvatarUrl(createInfo({ face: 'https://hdslb.com/avatar.jpg' })), '');
});
