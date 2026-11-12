'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const songService = require('../../src/music/song-service');
const { DatabaseSync } = require('node:sqlite');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { createQueueStore } = require('../../src/storage/queue-store');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createSongStore } = require('../../src/storage/song-store');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  return { db, store: createSongStore(db) };
}

test('song creation, renaming and cloud restoration derive the Chinese initial from the song name', (t) => {
  const { store } = fixture(t);
  for (const [name, initial] of [['江南', 'J'], ['富士山下', 'F'], ['告白', 'G'], ['来日方长', 'L'], ['妈妈', 'M'], ['Alpha', 'A'], ['123', '#']]) {
    const saved = songService.saveSong(store, { name });
    assert.equal(saved.name_initial, initial, name);
  }
  const song = songService.listSongs(store, { query: '江南' })[0];
  songService.saveSong(store, { id: song.id, name: '富士山下', artist: '另一个版本' });
  assert.equal(songService.listSongs(store, { artist: '另一个版本' })[0].name_initial, 'F');
  songService.replaceCloudSongs(store, [{ title: '江南', artist: '云端歌手' }]);
  assert.equal(songService.listSongs(store)[0].name_initial, 'J');
});

test('song store migration preserves LIKE filtering and stable artist ordering', (t) => {
  const { store } = fixture(t);
  songService.saveSong(store, { name: 'Alpha', categoryName: 'Folk' });
  songService.saveSong(store, { name: '\u00c5ngstrom', categoryName: 'Other' });
  songService.saveSong(store, { name: 'Same', artist: '\u00c5bc' });
  songService.saveSong(store, { name: 'Same', artist: 'Zed' });
  assert.equal(songService.listSongs(store, { query: '%' }).length, 4);
  assert.equal(songService.listSongs(store, { query: '\u00e5ngstrom' }).length, 0);
  assert.equal(songService.listSongs(store, { category: 'F%k' }).length, 1);
  assert.deepEqual(
    songService.listSongs(store, { query: 'Same' }).map((row) => row.artist),
    ['Zed', '\u00c5bc'],
  );
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
  const original = songService.saveSong(store, {
    name: 'Original',
    categoryName: 'Original category',
  });
  db.exec(
    "CREATE TRIGGER reject_fixture BEFORE INSERT ON songs WHEN NEW.name = 'Failure' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  assert.throws(
    () =>
      songService.replaceCloudSongs(store, [
        { title: 'Replacement', categoryName: 'New category' },
        { title: 'Failure' },
      ]),
    /fixture failure/,
  );
  assert.equal(songService.listSongs(store)[0].id, original.id);
  assert.equal(songService.countSongs(store), 1);
  assert.deepEqual(
    songService.listCategories(store).map((row) => row.name),
    ['Original category'],
  );
});

test('deleting a song preserves queue and request history without song references', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-delete-'));
  const databases = createDatabases({ dataDir });
  const { songDb } = databases;
  const songStore = createSongStore(songDb);

  try {
    const song = songService.saveSong(songStore, {
      name: '待删除歌曲',
      artist: '测试歌手',
      categoryName: '测试分类',
    });
    const queueStore = createQueueStore(songDb);
    const queueItem = queueStore.insertRequest({
      songId: song.id,
      songName: song.name,
      artist: song.artist,
      categoryName: '测试分类',
      requesterUid: '123',
      requesterName: '测试观众',
      requesterGuardLevel: 0,
      requesterMedalName: '',
      requesterMedalLevel: 0,
      message: '点歌 待删除歌曲',
      source: 'danmaku',
      status: 'waiting',
      isPinned: 0,
      pinnedAt: '',
      createdAt: '2026-08-30T00:00:00.000Z',
    });

    songService.deleteSong(songStore, song.id);

    assert.equal(songDb.prepare('SELECT id FROM songs WHERE id = ?').get(song.id), undefined);
    assert.deepEqual(
      {
        ...songDb.prepare('SELECT song_id, song_name FROM queue WHERE id = ?').get(queueItem.id),
      },
      { song_id: null, song_name: '待删除歌曲' },
    );
    assert.deepEqual(
      {
        ...songDb.prepare('SELECT song_id, song_name, message FROM requests WHERE queue_id = ?').get(queueItem.id),
      },
      {
        song_id: null,
        song_name: '待删除歌曲',
        message: '点歌 待删除歌曲',
      },
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
