// 编写人：Aurora
// 数据库创建、迁移注册、清空操作。
// 通过 createDatabases({ dataDir }) 显式初始化，不自动创建连接。
// DDL 在 schema.js，各表读写在同目录的 *-store.js。
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
const schema = require('./schema');
const { seedThemePresets } = require('./theme-store');

const DB_FILE_NAMES = {
  songDb: 'song-request-data.db',
  superChatDb: 'super-chat-data.db',
  giftDb: 'gift-data.db',
  musicDb: 'music-data.db'
};

// ── 工厂函数：创建并初始化所有数据库 ──

function createDatabases(options = {}) {
  const dataDir = String(options.dataDir || '');
  if (!dataDir) throw new Error('dataDir is required to create databases.');

  fs.mkdirSync(dataDir, { recursive: true });

  const songDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.songDb), { foreignKeys: true });
  const superChatDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.superChatDb));
  const giftDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.giftDb));
  const musicDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.musicDb), { foreignKeys: true });

  // 建表是幂等的，每次启动都跑；一次性的数据搬迁走下面的迁移步骤
  songDb.exec(schema.SONG_SCHEMA);
  superChatDb.exec(schema.SUPER_CHAT_SCHEMA);
  giftDb.exec(schema.GIFT_SCHEMA);
  musicDb.exec(schema.MUSIC_SCHEMA);

  const databases = { songDb, superChatDb, giftDb, musicDb };
  runAllMigrations(databases, options);
  migrateLegacySuperChatsToDedicatedDatabase(songDb, superChatDb);

  return databases;
}

// ── 迁移注册表 ──
// 数组下标 + 1 即版本号。只能往末尾追加，不能改动已发布的步骤。

function runAllMigrations(databases, options = {}) {
  const { songDb, superChatDb, giftDb, musicDb } = databases;
  const defaultSettings = options.defaultSettings || {};
  const results = [];

  results.push(schema.runMigrations(songDb, 'song_db', [
    // v1：老版本遗留的列补全
    (db) => {
      ensureSongColumns(db);
      ensureQueueColumns(db);
      ensureRequesterMetaColumns(db, 'queue');
      ensureRequesterMetaColumns(db, 'requests');
    },
    // v2：主题预设内置项 + 现有外观留档
    (db) => {
      seedThemePresets(db, defaultSettings);
    },
    // v3：清理重复 (name, artist) 后重建唯一索引
    (db) => {
      db.exec('DROP INDEX IF EXISTS idx_songs_name_artist');
      // 解除外键引用
      db.prepare(`
        UPDATE queue SET song_id = NULL
        WHERE song_id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY name, artist ORDER BY updated_at DESC, id DESC) AS rn
            FROM songs
          ) WHERE rn > 1
        )
      `).run();
      db.prepare(`
        UPDATE requests SET song_id = NULL
        WHERE song_id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY name, artist ORDER BY updated_at DESC, id DESC) AS rn
            FROM songs
          ) WHERE rn > 1
        )
      `).run();
      // 删除重复行，保留最新的
      db.prepare(`
        DELETE FROM songs WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY name, artist ORDER BY updated_at DESC, id DESC) AS rn
            FROM songs
          ) WHERE rn > 1
        )
      `).run();
      db.exec('CREATE UNIQUE INDEX idx_songs_name_artist ON songs(name, artist)');
    }
  ]));

  // 醒目留言库此前完全没有迁移入口，v1 建立基线以便后续加列
  results.push(schema.runMigrations(superChatDb, 'super_chat_db', [
    () => { /* 基线：建表已在 SUPER_CHAT_SCHEMA 完成 */ }
  ]));

  results.push(schema.runMigrations(giftDb, 'gift_db', [
    (db) => { ensureGiftColumns(db); },
    (db) => {
      // v2: 补齐 platform_id 索引，避免全表扫描导致礼物漏记
      db.exec('CREATE INDEX IF NOT EXISTS idx_gift_events_platform_id ON gift_events(platform_id)');
    }
  ]));

  results.push(schema.runMigrations(musicDb, 'music_db', [
    () => { /* 基线：建表已在 MUSIC_SCHEMA 完成 */ }
  ]));

  for (const result of results) {
    if (result.applied > 0) {
      console.log(`[Schema] ${result.key}: v${result.from} → v${result.to} (${result.applied} step(s))`);
    }
  }
  return results;
}

function getSchemaVersions(databases) {
  return {
    songDb: schema.getSchemaVersion(databases.songDb, 'song_db'),
    superChatDb: schema.getSchemaVersion(databases.superChatDb, 'super_chat_db'),
    giftDb: schema.getSchemaVersion(databases.giftDb, 'gift_db'),
    musicDb: schema.getSchemaVersion(databases.musicDb, 'music_db')
  };
}

// ── 底层：打开单个数据库 ──

function openSqliteDatabase(filePath, options = {}) {
  const database = new DatabaseSync(filePath);
  const pragmas = [
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = NORMAL',
    'PRAGMA cache_size = -8000',
    'PRAGMA temp_store = MEMORY'
  ];
  if (options.foreignKeys === true) {
    pragmas.push('PRAGMA foreign_keys = ON');
  }
  database.exec(pragmas.map((p) => `${p};`).join('\n'));
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
  if (rows.length === 0) {
    dropLegacySuperChatTable(songDb, 0);
    return;
  }

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
  dropLegacySuperChatTable(songDb, migrated);
}

function dropLegacySuperChatTable(songDb, migrated) {
  try {
    songDb.exec('DROP TABLE IF EXISTS super_chats');
    if (migrated > 0) {
      console.log('[Startup] dropped legacy super_chats table from song database.');
    }
  } catch (error) {
    console.warn('[Startup] failed to drop legacy super_chats table:', error.message);
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
    db.prepare('UPDATE queue SET song_id = NULL WHERE song_id IS NOT NULL').run();
    db.prepare('UPDATE requests SET song_id = NULL WHERE song_id IS NOT NULL').run();
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

/** 清空播放器数据；主题预设留在 songDb，不受影响 */
function clearPlaybackData(musicDb) {
  musicDb.exec('BEGIN');
  try {
    const history = (musicDb.prepare('SELECT COUNT(*) AS count FROM play_history').get() || {}).count || 0;
    musicDb.prepare('DELETE FROM play_history').run();
    musicDb.prepare('DELETE FROM play_queue_state').run();
    musicDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'play_history'").run();
    musicDb.exec('COMMIT');
    return { cleared: true, scope: 'playback', deletedCount: history };
  } catch (error) {
    musicDb.exec('ROLLBACK');
    throw error;
  }
}

function clearGiftData(giftDb) {
  let count = 0;
  giftDb.exec('BEGIN');
  try {
    count = countRows(giftDb, 'gift_events');
    giftDb.prepare('DELETE FROM gift_events').run();
    giftDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'gift_events'").run();
    giftDb.exec('COMMIT');
  } catch (error) {
    giftDb.exec('ROLLBACK');
    throw error;
  }
  return { gifts: count };
}

function clearAllData(songDb, superChatDb, giftDb, musicDb) {
  const counts = {
    songs: 0, categories: 0, queue: 0, requests: 0,
    sc: 0, gifts: 0, playHistory: 0
  };

  // 点歌库：settings 和 theme_presets 保留，其余业务数据清空
  songDb.exec('BEGIN');
  try {
    counts.songs = countRows(songDb, 'songs');
    counts.categories = countRows(songDb, 'song_categories');
    counts.queue = (songDb.prepare("SELECT COUNT(*) AS count FROM queue WHERE status != 'deleted'").get() || {}).count || 0;
    counts.requests = countRows(songDb, 'requests');

    songDb.prepare('DELETE FROM requests').run();
    songDb.prepare('DELETE FROM queue').run();
    songDb.prepare('DELETE FROM songs').run();
    songDb.prepare('DELETE FROM song_categories').run();
    songDb.prepare('DELETE FROM import_batches').run();
    songDb.prepare('DELETE FROM user_cooldowns').run();
    songDb.prepare(`
      DELETE FROM sqlite_sequence
      WHERE name IN ('songs', 'song_categories', 'import_batches', 'queue', 'requests')
    `).run();
    songDb.exec('COMMIT');
  } catch (error) {
    songDb.exec('ROLLBACK');
    throw error;
  }

  superChatDb.exec('BEGIN');
  try {
    counts.sc = countRows(superChatDb, 'super_chats');
    superChatDb.prepare('DELETE FROM super_chats').run();
    superChatDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'super_chats'").run();
    superChatDb.exec('COMMIT');
  } catch (error) {
    superChatDb.exec('ROLLBACK');
    throw error;
  }

  giftDb.exec('BEGIN');
  try {
    counts.gifts = countRows(giftDb, 'gift_events');
    giftDb.prepare('DELETE FROM gift_events').run();
    giftDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'gift_events'").run();
    giftDb.exec('COMMIT');
  } catch (error) {
    giftDb.exec('ROLLBACK');
    throw error;
  }

  if (musicDb) {
    counts.playHistory = clearPlaybackData(musicDb).deletedCount;
  }

  return {
    cleared: true,
    scope: 'all',
    preserved: ['settings', 'themePresets'],
    deletedCounts: counts,
    totalDeleted: Object.values(counts).reduce((a, b) => a + b, 0)
  };
}

function countRows(db, tableName) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() || {}).count || 0;
}

// ── 数据库关闭与优化 ──

/** 关闭所有数据库连接；由 server.js shutdown 统一调用，不在各处散写 .close() */
function closeDatabases(...databases) {
  for (const db of flattenDatabases(databases)) {
    try { db.close(); } catch (_) { /* 忽略关闭时错误 */ }
  }
}

function optimizeDatabases(...databases) {
  for (const db of flattenDatabases(databases)) {
    try {
      db.exec('PRAGMA optimize');
    } catch (error) {
      console.warn('[Shutdown] database optimize failed:', error.message);
    }
  }
}

// 同时接受 (songDb, superChatDb, ...) 和 ({ songDb, superChatDb, ... }) 两种传法
function flattenDatabases(args) {
  const list = [];
  for (const entry of args) {
    if (!entry) continue;
    if (typeof entry.close === 'function' || typeof entry.exec === 'function') {
      list.push(entry);
    } else if (typeof entry === 'object') {
      for (const value of Object.values(entry)) {
        if (value && typeof value.exec === 'function') list.push(value);
      }
    }
  }
  return list;
}

module.exports = {
  DB_FILE_NAMES,
  createDatabases,
  openSqliteDatabase,
  runAllMigrations,
  getSchemaVersions,
  ensureSongColumns,
  ensureQueueColumns,
  ensureRequesterMetaColumns,
  ensureGiftColumns,
  migrateLegacySuperChatsToDedicatedDatabase,
  clearSongLibraryData,
  clearSuperChatData,
  clearPlaybackData,
  clearGiftData,
  clearAllData,
  closeDatabases,
  optimizeDatabases
};
