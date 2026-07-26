// 编写人：Aurora
// 数据库创建、迁移、列补全、清空操作。
// 通过 createDatabases({ dataDir }) 显式初始化，不自动创建连接。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  now,
  cleanText,
  normalizeSuperChatPrice,
  normalizeGuardLevel,
  normalizePositiveInteger
} = require('../shared/utils');

// ── 工厂函数：创建并初始化所有数据库 ──

function createDatabases(options = {}) {
  const dataDir = String(options.dataDir || '');
  if (!dataDir) throw new Error('dataDir is required to create databases.');

  const SONG_DB_PATH = path.join(dataDir, 'song-request-data.db');
  const SUPER_CHAT_DB_PATH = path.join(dataDir, 'super-chat-data.db');
  const GIFT_DB_PATH = path.join(dataDir, 'gift-data.db');

  fs.mkdirSync(dataDir, { recursive: true });

  const songDb = openSqliteDatabase(SONG_DB_PATH, { foreignKeys: true });
  const superChatDb = openSqliteDatabase(SUPER_CHAT_DB_PATH);
  const giftDb = openSqliteDatabase(GIFT_DB_PATH);

  // Song DB schema
  songDb.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS song_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_pinyin TEXT NOT NULL DEFAULT '',
      name_initial TEXT NOT NULL DEFAULT '#',
      artist TEXT NOT NULL DEFAULT '',
      category_id INTEGER,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      source_platform TEXT NOT NULL DEFAULT '',
      original_group TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES song_categories(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_name_artist
      ON songs(name, artist);
    CREATE INDEX IF NOT EXISTS idx_songs_initial
      ON songs(name_initial);
    CREATE INDEX IF NOT EXISTS idx_songs_category
      ON songs(category_id);

    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER,
      song_name TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      category_name TEXT NOT NULL DEFAULT '',
      requester_uid TEXT NOT NULL DEFAULT '',
      requester_name TEXT NOT NULL DEFAULT '',
      requester_guard_level INTEGER NOT NULL DEFAULT 0,
      requester_medal_name TEXT NOT NULL DEFAULT '',
      requester_medal_level INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'admin',
      status TEXT NOT NULL DEFAULT 'waiting',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      pinned_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (song_id) REFERENCES songs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_queue_status
      ON queue(status, is_pinned, pinned_at, created_at);

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_id INTEGER,
      song_id INTEGER,
      song_name TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      category_name TEXT NOT NULL DEFAULT '',
      requester_uid TEXT NOT NULL DEFAULT '',
      requester_name TEXT NOT NULL DEFAULT '',
      requester_guard_level INTEGER NOT NULL DEFAULT 0,
      requester_medal_name TEXT NOT NULL DEFAULT '',
      requester_medal_level INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      FOREIGN KEY (queue_id) REFERENCES queue(id),
      FOREIGN KEY (song_id) REFERENCES songs(id)
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_count INTEGER NOT NULL,
      inserted_count INTEGER NOT NULL,
      duplicate_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      created_category_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // SuperChat DB schema
  superChatDb.exec(`
    CREATE TABLE IF NOT EXISTS super_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL DEFAULT '',
      uid TEXT NOT NULL DEFAULT '',
      user_name TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      requester_guard_level INTEGER NOT NULL DEFAULT 0,
      requester_medal_name TEXT NOT NULL DEFAULT '',
      requester_medal_level INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'superchat',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_super_chats_status
      ON super_chats(status, created_at);
  `);

  // Gift DB schema
  giftDb.exec(`
    CREATE TABLE IF NOT EXISTS gift_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL DEFAULT '',
      cmd TEXT NOT NULL DEFAULT '',
      gift_id TEXT NOT NULL DEFAULT '',
      gift_name TEXT NOT NULL DEFAULT '',
      uid TEXT NOT NULL DEFAULT '',
      user_name TEXT NOT NULL DEFAULT '',
      num INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      coin_type TEXT NOT NULL DEFAULT '',
      is_blind_box INTEGER NOT NULL DEFAULT 0,
      blind_box_name TEXT NOT NULL DEFAULT '',
      blind_box_price REAL,
      blind_profit REAL,
      counted_in_sprint INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      raw_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gift_events_status
      ON gift_events(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_gift_events_sprint
      ON gift_events(counted_in_sprint, status, created_at);
  `);

  // Run migrations
  ensureSongColumns(songDb);
  ensureQueueColumns(songDb);
  ensureRequesterMetaColumns(songDb, 'queue');
  ensureRequesterMetaColumns(songDb, 'requests');
  ensureGiftColumns(giftDb);
  // repairGiftV2Events needs Bilibili parsing — kept in server.js for now,
  // will move to bilibili/gift-service.js later.
  migrateLegacySuperChatsToDedicatedDatabase(songDb, superChatDb);

  return { songDb, superChatDb, giftDb };
}

// ── 底层：打开单个数据库 ──

function openSqliteDatabase(filePath, options = {}) {
  const database = new DatabaseSync(filePath);
  const pragmas = ['PRAGMA journal_mode = WAL'];
  if (options.foreignKeys === true) {
    pragmas.push('PRAGMA foreign_keys = ON');
  }
  database.exec(`${pragmas.join(';\n')};`);
  return database;
}

// ── 列补全 ──

function ensureSongColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(songs)').all().map((column) => column.name));
  const wanted = [
    ['tags', "TEXT NOT NULL DEFAULT ''"],
    ['language', "TEXT NOT NULL DEFAULT ''"],
    ['source_platform', "TEXT NOT NULL DEFAULT ''"],
    ['original_group', "TEXT NOT NULL DEFAULT ''"]
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE songs ADD COLUMN ${name} ${definition}`);
    }
  }
}

function ensureQueueColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(queue)').all().map((column) => column.name));
  if (!columns.has('pinned_at')) {
    db.exec("ALTER TABLE queue ADD COLUMN pinned_at TEXT NOT NULL DEFAULT ''");
    db.prepare(`
      UPDATE queue SET pinned_at = updated_at
      WHERE is_pinned = 1 AND pinned_at = ''
    `).run();
  }
}

function ensureRequesterMetaColumns(db, tableName) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
  const wanted = [
    ['requester_guard_level', 'INTEGER NOT NULL DEFAULT 0'],
    ['requester_medal_name', "TEXT NOT NULL DEFAULT ''"],
    ['requester_medal_level', 'INTEGER NOT NULL DEFAULT 0']
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
    }
  }
}

function ensureGiftColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(gift_events)').all().map((column) => column.name));
  const wanted = [
    ['cmd', "TEXT NOT NULL DEFAULT ''"],
    ['is_blind_box', 'INTEGER NOT NULL DEFAULT 0'],
    ['blind_box_name', "TEXT NOT NULL DEFAULT ''"],
    ['blind_box_price', 'REAL'],
    ['blind_profit', 'REAL'],
    ['counted_in_sprint', 'INTEGER NOT NULL DEFAULT 0'],
    ['raw_json', "TEXT NOT NULL DEFAULT ''"]
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE gift_events ADD COLUMN ${name} ${definition}`);
    }
  }
}

// ── 数据迁移 ──

function migrateLegacySuperChatsToDedicatedDatabase(songDb, superChatDb) {
  const legacyTable = songDb.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'super_chats'
  `).get();
  if (!legacyTable) return;

  const rows = songDb.prepare('SELECT * FROM super_chats ORDER BY id ASC').all();
  if (rows.length === 0) return;

  let migrated = 0;
  superChatDb.exec('BEGIN');
  try {
    for (const row of rows) {
      const fingerprint = legacySuperChatFingerprint(row);
      const existing = superChatDb.prepare(`
        SELECT id
        FROM super_chats
        WHERE (platform_id != '' AND platform_id = ?)
           OR (platform_id = '' AND ? != '' AND uid = ? AND message = ? AND created_at = ?)
        LIMIT 1
      `).get(
        cleanText(row.platform_id),
        fingerprint,
        cleanText(row.uid),
        cleanText(row.message),
        cleanText(row.created_at)
      );
      if (existing) continue;

      superChatDb.prepare(`
        INSERT INTO super_chats (
          platform_id, uid, user_name, price, message,
          requester_guard_level, requester_medal_name, requester_medal_level,
          status, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cleanText(row.platform_id),
        cleanText(row.uid),
        cleanText(row.user_name) || '观众',
        normalizeSuperChatPrice(row.price),
        cleanText(row.message),
        normalizeGuardLevel(row.requester_guard_level),
        cleanText(row.requester_medal_name),
        normalizePositiveInteger(row.requester_medal_level),
        cleanText(row.status) || 'active',
        cleanText(row.source) || 'superchat',
        cleanText(row.created_at) || now(),
        cleanText(row.updated_at) || cleanText(row.created_at) || now()
      );
      migrated += 1;
    }
    superChatDb.exec('COMMIT');
  } catch (error) {
    superChatDb.exec('ROLLBACK');
    throw error;
  }

  if (migrated > 0) {
    console.log(`[Startup] migrated ${migrated} legacy super chat record(s).`);
  }
}

function legacySuperChatFingerprint(row) {
  if (!row) return '';
  return [
    cleanText(row.uid),
    cleanText(row.message),
    cleanText(row.created_at)
  ].join('|');
}

// ── 清空操作 ──

function clearSongLibraryData(db) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM songs').run();
    db.prepare('DELETE FROM song_categories').run();
    db.prepare('DELETE FROM import_batches').run();
    db.prepare(`
      DELETE FROM sqlite_sequence
      WHERE name IN ('songs', 'song_categories', 'import_batches')
    `).run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    cleared: true,
    scope: 'song-library',
    preserved: ['settings', 'theme', 'roomId', 'queue', 'requestHistory']
  };
}

function clearSuperChatData(db) {
  db.exec('BEGIN');
  try {
    const result = db.prepare('SELECT COUNT(*) AS count FROM super_chats').get();
    const cleared = result ? result.count : 0;
    db.prepare('DELETE FROM super_chats').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'super_chats'").run();
    db.exec('COMMIT');
    return {
      cleared: true,
      scope: 'super-chats',
      deletedCount: cleared
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function clearAllData(songDb, superChatDb, giftDb) {
  const counts = { songs: 0, categories: 0, queue: 0, requests: 0, sc: 0, gifts: 0 };

  // Clear song DB tables except settings
  songDb.exec('BEGIN');
  try {
    counts.songs = (songDb.prepare('SELECT COUNT(*) AS count FROM songs').get() || {}).count || 0;
    counts.categories = (songDb.prepare('SELECT COUNT(*) AS count FROM song_categories').get() || {}).count || 0;
    counts.queue = (songDb.prepare("SELECT COUNT(*) AS count FROM queue WHERE status != 'deleted'").get() || {}).count || 0;
    counts.requests = (songDb.prepare('SELECT COUNT(*) AS count FROM requests').get() || {}).count || 0;

    songDb.prepare('DELETE FROM songs').run();
    songDb.prepare('DELETE FROM song_categories').run();
    songDb.prepare('DELETE FROM import_batches').run();
    songDb.prepare('DELETE FROM queue').run();
    songDb.prepare('DELETE FROM requests').run();
    songDb.prepare(`
      DELETE FROM sqlite_sequence
      WHERE name IN ('songs', 'song_categories', 'import_batches', 'queue', 'requests')
    `).run();
    songDb.exec('COMMIT');
  } catch (error) {
    songDb.exec('ROLLBACK');
    throw error;
  }

  // Clear SC database
  superChatDb.exec('BEGIN');
  try {
    counts.sc = (superChatDb.prepare('SELECT COUNT(*) AS count FROM super_chats').get() || {}).count || 0;
    superChatDb.prepare('DELETE FROM super_chats').run();
    superChatDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'super_chats'").run();
    superChatDb.exec('COMMIT');
  } catch (error) {
    superChatDb.exec('ROLLBACK');
    throw error;
  }

  // Clear gift database
  giftDb.exec('BEGIN');
  try {
    counts.gifts = (giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get() || {}).count || 0;
    giftDb.prepare('DELETE FROM gift_events').run();
    giftDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'gift_events'").run();
    giftDb.exec('COMMIT');
  } catch (error) {
    giftDb.exec('ROLLBACK');
    throw error;
  }

  return {
    cleared: true,
    scope: 'all',
    preserved: ['settings'],
    deletedCounts: counts,
    totalDeleted: Object.values(counts).reduce((a, b) => a + b, 0)
  };
}

module.exports = {
  createDatabases,
  openSqliteDatabase,
  ensureSongColumns,
  ensureQueueColumns,
  ensureRequesterMetaColumns,
  ensureGiftColumns,
  migrateLegacySuperChatsToDedicatedDatabase,
  clearSongLibraryData,
  clearSuperChatData,
  clearAllData
};
