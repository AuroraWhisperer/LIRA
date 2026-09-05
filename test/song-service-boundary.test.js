'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const songService = require('../src/music/song-service');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createSongStore } = require('../src/storage/song-store');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  return { db, store: createSongStore(db) };
}

test('song store migration preserves LIKE filtering and stable artist ordering', (t) => {
  const { store } = fixture(t);
  songService.saveSong(store, { name: 'Alpha', categoryName: 'Folk' });
  songService.saveSong(store, { name: '\u00c5ngstrom', categoryName: 'Other' });
  songService.saveSong(store, { name: 'Same', artist: '\u00c5bc' });
  songService.saveSong(store, { name: 'Same', artist: 'Zed' });
  assert.equal(songService.listSongs(store, { query: '%' }).length, 4);
  assert.equal(songService.listSongs(store, { query: '\u00e5ngstrom' }).length, 0);
  assert.equal(songService.listSongs(store, { category: 'F%k' }).length, 1);
  assert.deepEqual(songService.listSongs(store, { query: 'Same' }).map((row) => row.artist), ['Zed', '\u00c5bc']);
});

test('invalid supplied update IDs do not become song inserts', (t) => {
  const { store } = fixture(t);
  for (const id of ['0', 'not-an-id']) {
    assert.throws(() => songService.saveSong(store, { id, name: 'unwanted' }), /不存在/);
  }
  assert.equal(songService.countSongs(store), 0);
});

test('a storage failure rolls back the entire cloud song replacement', (t) => {
  const { db, store } = fixture(t);
  const original = songService.saveSong(store, { name: 'Original', categoryName: 'Original category' });
  db.exec("CREATE TRIGGER reject_fixture BEFORE INSERT ON songs WHEN NEW.name = 'Failure' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  assert.throws(() => songService.replaceCloudSongs(store, [
    { title: 'Replacement', categoryName: 'New category' },
    { title: 'Failure' },
  ]), /fixture failure/);
  assert.equal(songService.listSongs(store)[0].id, original.id);
  assert.equal(songService.countSongs(store), 1);
  assert.deepEqual(songService.listCategories(store).map((row) => row.name), ['Original category']);
});

test('song service uses the narrow song store behavior instead of a database handle', () => {
  const calls = [];
  const store = {
    saveSong(input) {
      calls.push(input);
      return {
        id: 7,
        name: input.name,
        artist: input.artist,
        category_id: 3,
        is_enabled: input.isEnabled,
      };
    },
  };

  const song = songService.saveSong(store, {
    name: '  边界歌曲  ',
    artist: '  测试歌手  ',
    categoryName: '  流行  ',
  });

  assert.equal(song.id, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, '边界歌曲');
  assert.equal(calls[0].artist, '测试歌手');
  assert.equal(calls[0].categoryName, '流行');
});
