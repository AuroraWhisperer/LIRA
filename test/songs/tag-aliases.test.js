'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { matchesLibraryTag } = require('../../src/music/tag-aliases');

const CASES = [
  ['maps viewer aliases to the library standard tag', true, [
    [' 抒情 ', '情歌'],
    ['K-Pop', 'k pop'],
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
