'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { matchesLibraryTag } = require('../../src/music/tag-aliases');

const CASES = [
  ['maps viewer aliases to the library standard tag', true, [
    ['抒情', '情歌'],
    ['抒情', '抒情歌'],
    [' 抒情 ', '情歌'],
    ['治愈', '治愈系'],
    ['治愈', '暖心'],
    ['怀旧', '回忆杀'],
    ['怀旧', '老歌'],
  ]],
  ['matches common K-Pop spelling variants', true, [
    ['K-Pop', 'k-pop'],
    ['K-Pop', 'KPOP'],
    ['K-Pop', 'k pop'],
    ['K-Pop', '韩流'],
  ]],
  ['matches clear aliases used by the current song library', true, [
    ['影视OST', 'OST'],
    ['影视OST', '影视原声'],
    ['国风', '中国风'],
    ['小甜歌', '甜歌'],
  ]],
  ['keeps direct matches', true, [
    ['摇滚', '摇滚'],
    ['ROCK', 'rock'],
  ]],
  ['does not reverse a library alias into the standard tag', false, [
    ['情歌', '抒情'],
    ['抒情歌', '抒情'],
  ]],
  ['rejects unrelated, partial and empty tags', false, [
    ['抒情', '治愈'],
    ['抒情', '情'],
    ['', ''],
  ]],
];

test('library tag matching follows the alias table in one direction only', () => {
  for (const [description, expected, pairs] of CASES) {
    for (const [libraryTag, viewerTerm] of pairs) {
      assert.equal(matchesLibraryTag(libraryTag, viewerTerm), expected, `${description}: ${libraryTag} / ${viewerTerm}`);
    }
  }
});
