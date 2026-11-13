'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { toSimplifiedChinese } = require('../../src/shared/chinese-text');

test('Chinese comparison folds variants without changing Latin, punctuation or supplementary characters', () => {
  assert.equal(toSimplifiedChinese('點歌 後來／隨機＋國語＋張學友，簽到🎵'), '点歌 后来／随机＋国语＋张学友，签到🎵');
  assert.equal(toSimplifiedChinese('發髮臺檯裏裡'), '发发台台里里');
  assert.equal(toSimplifiedChinese('㒓𠉂ABC'), '𠉂𠉂ABC');
  assert.equal(toSimplifiedChinese('薴苧苎'), '苎苎苎');
  assert.equal(toSimplifiedChinese('简体 café A1 TRIP'), '简体 café A1 TRIP');
});
