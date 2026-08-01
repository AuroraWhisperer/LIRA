'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createPlaybackStore } = require('../src/storage/playback-store');
const { MUSIC_SCHEMA } = require('../src/storage/schema');

test('partial play-history updates preserve existing non-empty metadata', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MUSIC_SCHEMA);
  const store = createPlaybackStore(db);

  try {
    store.recordPlay({
      source: 'qq',
      id: '123',
      title: '完整标题',
      artists: ['完整歌手'],
      album: '完整专辑',
      coverUrl: 'https://example.test/cover.jpg',
      durationMs: 180000
    });

    store.recordPlay({ source: 'qq', id: '123' });

    const [row] = store.listHistory({ limit: 10 });
    assert.equal(row.title, '完整标题');
    assert.equal(row.artists, '完整歌手');
    assert.equal(row.album, '完整专辑');
    assert.equal(row.source, 'qq');
    assert.equal(row.sourceTrackId, '123');
    assert.equal(row.coverUrl, 'https://example.test/cover.jpg');
    assert.equal(row.durationMs, 180000);
    assert.equal(row.playCount, 2);
  } finally {
    db.close();
  }
});
