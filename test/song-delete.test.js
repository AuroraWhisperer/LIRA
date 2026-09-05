'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const songService = require('../src/music/song-service');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const { createQueueStore } = require('../src/storage/queue-store');
const { createSongStore } = require('../src/storage/song-store');

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

    assert.equal(
      songDb.prepare('SELECT id FROM songs WHERE id = ?').get(song.id),
      undefined,
    );
    assert.deepEqual(
      {
        ...songDb
          .prepare('SELECT song_id, song_name FROM queue WHERE id = ?')
          .get(queueItem.id),
      },
      { song_id: null, song_name: '待删除歌曲' },
    );
    assert.deepEqual(
      {
        ...songDb
          .prepare(
            'SELECT song_id, song_name, message FROM requests WHERE queue_id = ?',
          )
          .get(queueItem.id),
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
