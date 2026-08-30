'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MUSIC_API_CACHE_TTL_MS,
  MUSIC_LYRIC_CACHE_TTL_MS,
} = require('../src/music/music-cache');
const { DANMAKU_MESSAGE_LIMIT } = require('../src/bilibili/danmaku/contract');
const sender = require('../src/bilibili/danmaku/sender-service');

test('music cache owner exports the API and lyric TTL policies', () => {
  assert.equal(MUSIC_API_CACHE_TTL_MS, 5 * 60 * 1000);
  assert.equal(MUSIC_LYRIC_CACHE_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});

test('danmaku sender re-exports the shared transport message limit', () => {
  assert.equal(sender.DANMAKU_MESSAGE_LIMIT, DANMAKU_MESSAGE_LIMIT);
});
