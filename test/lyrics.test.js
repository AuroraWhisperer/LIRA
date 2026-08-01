'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLyricResult, parseWordLyric } = require('../src/music/lyrics');

test('parseWordLyric supports QQ QRC suffix timing', () => {
  const lines = parseWordLyric(
    '[1000,1900]jia (1000,900)yi(1900,1000)\n[4000,1000]bing(4000,1000)'
  );

  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'jia yi');
  assert.deepEqual(lines[0].words.map((word) => word.text), ['jia ', 'yi']);
  assert.equal(lines[1].text, 'bing');
});

test('parseLyricResult derives base lines from QRC and aligns alternates within 100ms', () => {
  const result = parseLyricResult(
    '',
    '[00:01.05]翻译一\n[00:04.04]翻译二',
    '[1000,1900]甲(1000,900)乙(1900,1000)\n[4000,1000]丙(4000,1000)',
    '[1001,1900]jia (1001,900)yi(1901,1000)\n[4001,1000]bing(4001,1000)'
  );

  assert.deepEqual(result.map((line) => ({
    startMs: line.startMs,
    text: line.text,
    translation: line.translation,
    roma: line.roma
  })), [
    { startMs: 1000, text: '甲乙', translation: '翻译一', roma: 'jia yi' },
    { startMs: 4000, text: '丙', translation: '翻译二', roma: 'bing' }
  ]);
});
