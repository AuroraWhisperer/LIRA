'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isBilibiliCommandText } = require('../../src/bilibili/danmaku/command-text');

test('check-in and fortune commands participate in danmaku command filtering', () => {
  for (const [text, expected] of [
    ['签到', true], ['簽到', true], ['抽签', true], ['抽籤', true],
    ['点歌 晴天', true], ['點歌 晴天', true], ['隨機点歌', true], ['取消點歌', true],
    ['路过', false], ['帮我抽签', false],
  ]) {
    assert.equal(isBilibiliCommandText(text), expected, text);
  }
});
