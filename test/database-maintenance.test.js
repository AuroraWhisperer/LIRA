'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  DB_FILE_NAMES,
  clearAllData,
  closeDatabases,
  createDatabases,
  getSchemaVersions
} = require('../src/storage/database');

function createPreV1SongDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`
      CREATE TABLE songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_pinyin TEXT NOT NULL DEFAULT '',
        name_initial TEXT NOT NULL DEFAULT '#',
        artist TEXT NOT NULL DEFAULT '',
        category_id INTEGER,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER,
        song_name TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        category_name TEXT NOT NULL DEFAULT '',
        requester_uid TEXT NOT NULL DEFAULT '',
        requester_name TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'admin',
        status TEXT NOT NULL DEFAULT 'waiting',
        is_pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        queue_id INTEGER,
        song_id INTEGER,
        song_name TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        category_name TEXT NOT NULL DEFAULT '',
        requester_uid TEXT NOT NULL DEFAULT '',
        requester_name TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'admin',
        created_at TEXT NOT NULL
      );
      INSERT INTO songs (
        name, name_pinyin, name_initial, artist, category_id,
        is_enabled, note, created_at, updated_at
      ) VALUES (
        'Legacy Song', 'legacy song', 'L', 'Legacy Artist', NULL,
        1, 'keep me', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO queue (
        song_id, song_name, artist, requester_uid, requester_name,
        status, is_pinned, created_at, updated_at
      ) VALUES (
        1, 'Legacy Song', 'Legacy Artist', 'legacy-user', 'Legacy User',
        'waiting', 1, '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:02.000Z'
      );
    `);
  } finally {
    db.close();
  }
}

function createPreV1GiftDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`
      CREATE TABLE gift_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_id TEXT NOT NULL DEFAULT '',
        gift_id TEXT NOT NULL DEFAULT '',
        gift_name TEXT NOT NULL DEFAULT '',
        uid TEXT NOT NULL DEFAULT '',
        user_name TEXT NOT NULL DEFAULT '',
        num INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL DEFAULT 0,
        total_price REAL NOT NULL DEFAULT 0,
        coin_type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO gift_events (
        platform_id, gift_id, gift_name, uid, user_name, num,
        unit_price, total_price, coin_type, status, created_at, updated_at
      ) VALUES (
        'legacy-event', 'gift-1', 'Legacy Gift', 'legacy-user', 'Legacy User', 2,
        10, 20, 'gold', 'active',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z'
      );
    `);
  } finally {
    db.close();
  }
}

function getIndexColumns(db, indexName) {
  return db.prepare(`PRAGMA index_info(${indexName})`).all().map((row) => row.name);
}

test('clearAllData counts deleted and active queue rows', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-clear-all-'));
  const databases = createDatabases({ dataDir });
  try {
    const insertQueue = databases.songDb.prepare(`
      INSERT INTO queue (song_name, created_at, updated_at, status)
      VALUES (?, ?, ?, ?)
    `);
    insertQueue.run('Active', '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z', 'waiting');
    insertQueue.run('Deleted', '2026-08-15T00:00:01.000Z', '2026-08-15T00:00:01.000Z', 'deleted');

    const result = clearAllData(
      databases.songDb,
      databases.superChatDb,
      databases.giftDb,
      databases.musicDb,
      databases.checkinDb
    );

    assert.equal(result.deletedCounts.queue, 2);
    assert.equal(result.totalDeleted, Object.values(result.deletedCounts)
      .reduce((total, count) => total + count, 0));
    assert.equal(databases.songDb.prepare('SELECT COUNT(*) AS count FROM queue').get().count, 0);
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('createDatabases upgrades genuine pre-v1 song and gift databases idempotently', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-pre-v1-'));
  createPreV1SongDatabase(path.join(dataDir, DB_FILE_NAMES.songDb));
  createPreV1GiftDatabase(path.join(dataDir, DB_FILE_NAMES.giftDb));

  let databases;
  try {
    for (let startup = 0; startup < 2; startup += 1) {
      databases = createDatabases({ dataDir });

      assert.deepEqual(getSchemaVersions(databases), {
        songDb: 3,
        superChatDb: 1,
        giftDb: 7,
        musicDb: 1,
        checkinDb: 1
      });
      assert.deepEqual(getIndexColumns(databases.songDb, 'idx_queue_status'), [
        'status',
        'is_pinned',
        'pinned_at',
        'created_at'
      ]);
      assert.deepEqual(getIndexColumns(databases.giftDb, 'idx_gift_events_sprint'), [
        'counted_in_sprint',
        'status',
        'created_at'
      ]);

      const song = databases.songDb.prepare(`
        SELECT name, artist, note FROM songs WHERE id = 1
      `).get();
      assert.deepEqual({ ...song }, {
        name: 'Legacy Song',
        artist: 'Legacy Artist',
        note: 'keep me'
      });
      const queue = databases.songDb.prepare(`
        SELECT song_name, requester_uid, is_pinned, pinned_at FROM queue WHERE id = 1
      `).get();
      assert.deepEqual({ ...queue }, {
        song_name: 'Legacy Song',
        requester_uid: 'legacy-user',
        is_pinned: 1,
        pinned_at: '2026-01-01T00:00:02.000Z'
      });
      const gift = databases.giftDb.prepare(`
        SELECT gift_name, num, counted_in_sprint, detection_status,
               gift_stats_eligible, gift_stats_delivered
        FROM gift_events WHERE id = 1
      `).get();
      assert.deepEqual({ ...gift }, {
        gift_name: 'Legacy Gift',
        num: 2,
        counted_in_sprint: 0,
        detection_status: 'final',
        gift_stats_eligible: 1,
        gift_stats_delivered: 1
      });

      for (const db of Object.values(databases)) {
        assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      }

      closeDatabases(databases);
      databases = null;
    }
  } finally {
    if (databases) closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('createDatabases closes every opened handle when initialization fails', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-init-failure-'));
  const songDb = new DatabaseSync(path.join(dataDir, DB_FILE_NAMES.songDb));
  songDb.exec(`
    CREATE TABLE songs (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      name_initial TEXT NOT NULL DEFAULT '#',
      category_id INTEGER
    );
  `);
  songDb.close();

  const originalClose = DatabaseSync.prototype.close;
  let closeCount = 0;
  DatabaseSync.prototype.close = function closeAndCount() {
    closeCount += 1;
    return originalClose.call(this);
  };

  try {
    assert.throws(
      () => createDatabases({ dataDir }),
      /song_db migration to v3 failed/
    );
    assert.equal(closeCount, 5);
  } finally {
    DatabaseSync.prototype.close = originalClose;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
