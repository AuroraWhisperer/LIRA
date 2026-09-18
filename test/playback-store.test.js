'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createPlaybackStore } = require('../src/storage/playback-store');
const { MUSIC_SCHEMA } = require('../src/storage/schema');

test('late periodic snapshots cannot replace a newer unload snapshot', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MUSIC_SCHEMA);
  const store = createPlaybackStore(db);
  const snapshotVersion = { writerId: 'writer-one', generation: 1, sequence: 0 };
  db.prepare(
    'INSERT INTO play_queue_state (client_id, payload, updated_at) VALUES (?, ?, ?)',
  ).run('default', JSON.stringify({ snapshotVersion }), '2026-09-18');

  try {
    store.saveQueueState({
      currentTime: 42,
      snapshotVersion: { ...snapshotVersion, sequence: 2 },
    });
    store.saveQueueState({
      currentTime: 17,
      snapshotVersion: { ...snapshotVersion, sequence: 1 },
    });
    assert.equal(store.getQueueState().payload.currentTime, 42);
  } finally {
    db.close();
  }
});

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
      durationMs: 180000,
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
