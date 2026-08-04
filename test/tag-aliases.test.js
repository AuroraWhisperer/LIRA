'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { matchesLibraryTag } = require('../src/music/tag-aliases');

test('maps viewer aliases to the library standard tag', () => {
  assert.equal(matchesLibraryTag('抒情', '情歌'), true);
  assert.equal(matchesLibraryTag('抒情', '抒情歌'), true);
  assert.equal(matchesLibraryTag(' 抒情 ', '情歌'), true);
  assert.equal(matchesLibraryTag('治愈', '治愈系'), true);
  assert.equal(matchesLibraryTag('治愈', '暖心'), true);
  assert.equal(matchesLibraryTag('怀旧', '回忆杀'), true);
  assert.equal(matchesLibraryTag('怀旧', '老歌'), true);
});

test('matches common K-Pop spelling variants', () => {
  assert.equal(matchesLibraryTag('K-Pop', 'k-pop'), true);
  assert.equal(matchesLibraryTag('K-Pop', 'KPOP'), true);
  assert.equal(matchesLibraryTag('K-Pop', 'k pop'), true);
  assert.equal(matchesLibraryTag('K-Pop', '韩流'), true);
});

test('matches clear aliases used by the current song library', () => {
  assert.equal(matchesLibraryTag('影视OST', 'OST'), true);
  assert.equal(matchesLibraryTag('影视OST', '影视原声'), true);
  assert.equal(matchesLibraryTag('国风', '中国风'), true);
  assert.equal(matchesLibraryTag('小甜歌', '甜歌'), true);
});

test('does not reverse a library alias into the standard tag', () => {
  assert.equal(matchesLibraryTag('情歌', '抒情'), false);
  assert.equal(matchesLibraryTag('抒情歌', '抒情'), false);
});

test('keeps direct matches and rejects unrelated or partial tags', () => {
  assert.equal(matchesLibraryTag('摇滚', '摇滚'), true);
  assert.equal(matchesLibraryTag('ROCK', 'rock'), true);
  assert.equal(matchesLibraryTag('抒情', '治愈'), false);
  assert.equal(matchesLibraryTag('抒情', '情'), false);
  assert.equal(matchesLibraryTag('', ''), false);
});
