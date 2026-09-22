'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createSongStore } = require('../src/storage/song-store');
const { createSongMetadataReader } = require('../src/music/song-metadata');

test('snapshot metadata reuses reads and invalidates for writes, rollback and deletion', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(SONG_SCHEMA);
    const read = createSongMetadataReader(createSongStore(db));
    const initial = read();
    assert.equal(read(), initial);
    db.prepare("INSERT INTO songs(name, tags, created_at, updated_at) VALUES (?, ?, '', '')").run('one', '治愈/抒情');
    const changed = read();
    assert.notEqual(changed, initial);
    assert.equal(changed.songCount, 1);
    assert.ok(changed.tags.length > 0);
    assert.equal(read(), changed);
    db.exec('BEGIN');
    db.prepare("UPDATE songs SET tags = 'discarded'").run();
    db.exec('ROLLBACK');
    assert.deepEqual(read().tags, changed.tags);
    db.exec('DELETE FROM songs');
    assert.equal(read().songCount, 0);
    assert.deepEqual(read().tags, []);
  } finally {
    db.close();
  }
});

test('metadata notices a commit from another connection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-song-metadata-'));
  const db = new DatabaseSync(path.join(dir, 'songs.db'));
  let writer;
  try {
    db.exec(SONG_SCHEMA);
    const read = createSongMetadataReader(createSongStore(db));
    assert.equal(read().songCount, 0);
    writer = new DatabaseSync(path.join(dir, 'songs.db'));
    writer.exec("INSERT INTO songs(name, created_at, updated_at) VALUES ('two', '', '')");
    assert.equal(read().songCount, 1);
  } finally {
    writer?.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
