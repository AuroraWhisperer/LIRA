'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOutputReviewPrompt } = require('../src/ai/safety');

test('output review compares the candidate with the original question', () => {
  const prompt = buildOutputReviewPrompt(
    '推荐几首舒缓的情歌',
    '你喜欢男声还是女声？你想听哪个年代？'
  );

  assert.match(prompt, /推荐几首舒缓的情歌/);
  assert.match(prompt, /男声还是女声/);
  assert.match(prompt, /逐项满足用户明确条件/);
  assert.match(prompt, /不必要的追问/);
  assert.match(prompt, /不得改变已有的确定事实/);
});
