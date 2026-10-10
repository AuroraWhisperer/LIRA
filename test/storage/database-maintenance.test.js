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
  getSchemaVersions,
  openSqliteDatabase,
} = require('../../src/storage/database');

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
  return db
    .prepare(`PRAGMA index_info(${indexName})`)
    .all()
    .map((row) => row.name);
}

test('createDatabases upgrades genuine pre-v1 song and gift databases idempotently', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-pre-v1-'));
  createPreV1SongDatabase(path.join(dataDir, DB_FILE_NAMES.songDb));
  createPreV1GiftDatabase(path.join(dataDir, DB_FILE_NAMES.giftDb));

  let databases;
  try {
    for (let startup = 0; startup < 2; startup += 1) {
      databases = createDatabases({ dataDir });

      assert.deepEqual(getSchemaVersions(databases), {
        songDb: 11,
        superChatDb: 1,
        giftDb: 16,
        musicDb: 1,
        checkinDb: 1,
        lotteryDb: 2,
      });
      assert.deepEqual(getIndexColumns(databases.songDb, 'idx_queue_status'), [
        'status',
        'is_pinned',
        'pinned_at',
        'created_at',
      ]);
      assert.deepEqual(getIndexColumns(databases.giftDb, 'idx_gift_events_sprint'), [
        'counted_in_sprint',
        'status',
        'created_at',
      ]);

      const song = databases.songDb
        .prepare(
          `
        SELECT name, artist, note, request_price, song_clip FROM songs WHERE id = 1
      `,
        )
        .get();
      assert.deepEqual(
        { ...song },
        {
          name: 'Legacy Song',
          artist: 'Legacy Artist',
          note: 'keep me',
          request_price: '',
          song_clip: '',
        },
      );
      const queue = databases.songDb
        .prepare(
          `
        SELECT song_name, requester_uid, is_pinned, pinned_at FROM queue WHERE id = 1
      `,
        )
        .get();
      assert.deepEqual(
        { ...queue },
        {
          song_name: 'Legacy Song',
          requester_uid: 'legacy-user',
          is_pinned: 1,
          pinned_at: '2026-01-01T00:00:02.000Z',
        },
      );
      const gift = databases.giftDb
        .prepare(
          `
        SELECT gift_name, num, counted_in_sprint, detection_status,
               gift_stats_eligible, gift_stats_delivered, blind_box_id
        FROM gift_events WHERE id = 1
      `,
        )
        .get();
      assert.deepEqual(
        { ...gift },
        {
          gift_name: 'Legacy Gift',
          num: 2,
          counted_in_sprint: 0,
          detection_status: 'final',
          gift_stats_eligible: 1,
          gift_stats_delivered: 1,
          blind_box_id: null,
        },
      );

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
    assert.throws(() => createDatabases({ dataDir }), /song_db migration to v3 failed/);
    assert.equal(closeCount, 5);
  } finally {
    DatabaseSync.prototype.close = originalClose;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('gift database v3 upgrades before creating indexes that depend on v4 columns', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-v3-upgrade-'));
  let db = createDatabases({ dataDir });

  try {
    closeDatabases(db);
    const giftDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.giftDb));
    giftDb.exec(`
      DROP INDEX IF EXISTS idx_gift_events_detection_pending;
      DROP INDEX IF EXISTS idx_gift_events_gift_stats_delivery;
      DROP INDEX IF EXISTS idx_gift_events_source_time;
      DROP INDEX IF EXISTS idx_gift_events_source_recent;
      DROP INDEX IF EXISTS idx_gift_events_source_time_asc;
      ALTER TABLE gift_events DROP COLUMN overtime_epoch;
      ALTER TABLE gift_events DROP COLUMN gift_stats_delivered;
      ALTER TABLE gift_events DROP COLUMN gift_stats_eligible;
      ALTER TABLE gift_events DROP COLUMN finalized_at_ms;
      ALTER TABLE gift_events DROP COLUMN last_platform_at_ms;
      ALTER TABLE gift_events DROP COLUMN first_detected_at_ms;
      ALTER TABLE gift_events DROP COLUMN detection_status;
      UPDATE schema_version SET version = 3 WHERE key = 'gift_db';
    `);
    giftDb.close();

    db = createDatabases({ dataDir });
    const indexes = new Set(
      db.giftDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => row.name),
    );
    assert.equal(indexes.has('idx_gift_events_detection_pending'), true);
    assert.equal(indexes.has('idx_gift_events_gift_stats_delivery'), true);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('gift database v3 identity migration remains intact after later migrations', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-gift-v3-'));
  let db = createDatabases({ dataDir });

  try {
    db.giftDb.exec('DROP INDEX idx_gift_events_platform_uid');
    db.giftDb.prepare("UPDATE schema_version SET version = 2 WHERE key = 'gift_db'").run();
    const insert = db.giftDb.prepare(`
      INSERT INTO gift_events (
        platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, counted_in_sprint,
        status, created_at, updated_at
      ) VALUES (?, 'SEND_GIFT', '1', 'Rose', ?, ?, ?, ?, ?, 1, 'active', ?, ?)
    `);
    const createdAt = new Date().toISOString();
    insert.run('duplicate-platform', '42', 'Alice', 1, 1, 1, createdAt, createdAt);
    insert.run('duplicate-platform', '42', 'Alice Renamed', 5, 1, 5, createdAt, createdAt);
    insert.run('duplicate-platform', '43', 'Bob', 1, 1, 1, createdAt, createdAt);
    closeDatabases(db);

    db = createDatabases({ dataDir });
    const rows = db.giftDb
      .prepare(
        `
      SELECT * FROM gift_events WHERE platform_id = ? ORDER BY uid
    `,
      )
      .all('duplicate-platform');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].uid, '42');
    assert.equal(rows[0].user_name, 'Alice Renamed');
    assert.equal(rows[0].num, 5);
    assert.equal(rows[0].total_price, 5);
    assert.equal(rows[1].uid, '43');
    assert.throws(() => insertDuplicateGift(db.giftDb, createdAt), /UNIQUE constraint failed/);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function insertDuplicateGift(giftDb, createdAt) {
  giftDb
    .prepare(
      `
    INSERT INTO gift_events (
      platform_id, cmd, gift_id, gift_name, uid, user_name,
      num, unit_price, total_price, status, created_at, updated_at
    ) VALUES ('duplicate-platform', 'SEND_GIFT', '1', 'Rose', '42', 'Alice',
      1, 1, 1, 'active', ?, ?)
  `,
    )
    .run(createdAt, createdAt);
}

function createLegacySuperChatTable(dataDir, rows) {
  const songDb = new DatabaseSync(path.join(dataDir, DB_FILE_NAMES.songDb));
  try {
    songDb.exec(`
      CREATE TABLE super_chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_id TEXT, uid TEXT, user_name TEXT, price REAL, message TEXT,
        requester_guard_level INTEGER, requester_medal_name TEXT, requester_medal_level INTEGER,
        status TEXT, source TEXT, created_at TEXT, updated_at TEXT
      );
    `);
    const insert = songDb.prepare(`
      INSERT INTO super_chats (
        platform_id, uid, user_name, price, message, requester_guard_level,
        requester_medal_name, requester_medal_level, status, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        row.platformId ?? '',
        row.uid ?? '',
        row.userName ?? '',
        row.price ?? 0,
        row.message ?? '',
        row.guardLevel ?? 0,
        row.medalName ?? '',
        row.medalLevel ?? 0,
        row.status ?? '',
        row.source ?? '',
        row.createdAt ?? '',
        row.updatedAt ?? '',
      );
    }
  } finally {
    songDb.close();
  }
}

function hasLegacySuperChatTable(databases) {
  return Boolean(
    databases.songDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'super_chats'").get(),
  );
}

function readSuperChats(databases) {
  return databases.superChatDb
    .prepare(
      `SELECT platform_id, uid, user_name, price, message, requester_guard_level,
              requester_medal_name, requester_medal_level, status, source, created_at, updated_at
       FROM super_chats ORDER BY id`,
    )
    .all()
    .map((row) => ({ ...row }));
}

const LEGACY_SC_TIME = '2026-01-02T03:04:05.000Z';

test('legacy song-database SuperChats move once, deduplicate and drop the old table', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-legacy-sc-'));
  let databases = createDatabases({ dataDir });
  try {
    databases.superChatDb
      .prepare(
        `INSERT INTO super_chats (platform_id, uid, user_name, price, message, created_at, updated_at)
         VALUES ('sc-existing', '1', 'Existing', 50, 'already moved', ?, ?)`,
      )
      .run(LEGACY_SC_TIME, LEGACY_SC_TIME);
    closeDatabases(databases);
    databases = null;
    createLegacySuperChatTable(dataDir, [
      {
        platformId: 'sc-existing',
        uid: '1',
        userName: 'Existing',
        price: 50,
        message: 'duplicate of moved row',
        createdAt: LEGACY_SC_TIME,
      },
      {
        platformId: ' sc-1 ',
        uid: '2',
        userName: ' Viewer ',
        price: 30,
        message: ' hello ',
        guardLevel: 2,
        medalName: 'Medal',
        medalLevel: 7,
        status: 'deleted',
        source: 'manual',
        createdAt: LEGACY_SC_TIME,
        updatedAt: '2026-01-02T03:05:00.000Z',
      },
      { platformId: 'sc-1', uid: '2', message: 'same platform id', createdAt: LEGACY_SC_TIME },
      { uid: '3', message: 'no platform id', price: 40, guardLevel: 9, medalLevel: -1, createdAt: LEGACY_SC_TIME },
      { uid: '3', message: 'no platform id', price: 40, createdAt: LEGACY_SC_TIME },
    ]);

    for (let startup = 0; startup < 2; startup += 1) {
      databases = createDatabases({ dataDir });
      assert.equal(hasLegacySuperChatTable(databases), false);
      assert.deepEqual(readSuperChats(databases), [
        {
          platform_id: 'sc-existing',
          uid: '1',
          user_name: 'Existing',
          price: 50,
          message: 'already moved',
          requester_guard_level: 0,
          requester_medal_name: '',
          requester_medal_level: 0,
          status: 'active',
          source: 'superchat',
          created_at: LEGACY_SC_TIME,
          updated_at: LEGACY_SC_TIME,
        },
        {
          platform_id: 'sc-1',
          uid: '2',
          user_name: 'Viewer',
          price: 30,
          message: 'hello',
          requester_guard_level: 2,
          requester_medal_name: 'Medal',
          requester_medal_level: 7,
          status: 'deleted',
          source: 'manual',
          created_at: LEGACY_SC_TIME,
          updated_at: '2026-01-02T03:05:00.000Z',
        },
        {
          platform_id: '',
          uid: '3',
          user_name: '观众',
          price: 40,
          message: 'no platform id',
          requester_guard_level: 0,
          requester_medal_name: '',
          requester_medal_level: 0,
          status: 'active',
          source: 'superchat',
          created_at: LEGACY_SC_TIME,
          updated_at: LEGACY_SC_TIME,
        },
      ]);
      closeDatabases(databases);
      databases = null;
    }
  } finally {
    if (databases) closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a failed legacy SuperChat copy rolls back and keeps the old table for the next startup', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-legacy-sc-failure-'));
  let databases = createDatabases({ dataDir });
  try {
    databases.superChatDb.exec(`
      CREATE TRIGGER fail_legacy_copy BEFORE INSERT ON super_chats
      WHEN NEW.platform_id = 'sc-fail'
      BEGIN SELECT RAISE(ABORT, 'legacy copy failure'); END;
    `);
    closeDatabases(databases);
    databases = null;
    createLegacySuperChatTable(dataDir, [
      { platformId: 'sc-before', uid: '1', message: 'copied before failure', createdAt: LEGACY_SC_TIME },
      { platformId: 'sc-fail', uid: '2', message: 'fails', createdAt: LEGACY_SC_TIME },
    ]);

    assert.throws(() => createDatabases({ dataDir }), /legacy copy failure/);

    const superChatDb = new DatabaseSync(path.join(dataDir, DB_FILE_NAMES.superChatDb));
    try {
      assert.equal(superChatDb.prepare('SELECT COUNT(*) AS count FROM super_chats').get().count, 0);
      superChatDb.exec('DROP TRIGGER fail_legacy_copy');
    } finally {
      superChatDb.close();
    }
    const songDb = new DatabaseSync(path.join(dataDir, DB_FILE_NAMES.songDb));
    try {
      assert.equal(songDb.prepare('SELECT COUNT(*) AS count FROM super_chats').get().count, 2);
    } finally {
      songDb.close();
    }

    databases = createDatabases({ dataDir });
    assert.equal(hasLegacySuperChatTable(databases), false);
    assert.deepEqual(
      readSuperChats(databases).map((row) => row.platform_id),
      ['sc-before', 'sc-fail'],
    );
  } finally {
    if (databases) closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
