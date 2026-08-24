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
const { createGiftMaintenanceStore } = require('./gift-maintenance-store');

const DB_FILE_NAMES = {
  songDb: 'song-request-data.db',
  superChatDb: 'super-chat-data.db',
  giftDb: 'gift-data.db',
  musicDb: 'music-data.db',
  checkinDb: 'checkin-data.db'
};

// ── 工厂函数：创建并初始化所有数据库 ──

function createDatabases(options = {}) {
  const dataDir = String(options.dataDir || '');
  if (!dataDir) throw new Error('dataDir is required to create databases.');

  fs.mkdirSync(dataDir, { recursive: true });
  const databases = {};

  try {
    databases.songDb = openSqliteDatabase(
      path.join(dataDir, DB_FILE_NAMES.songDb),
      { foreignKeys: true }
    );
    databases.superChatDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.superChatDb));
    databases.giftDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.giftDb));
    databases.musicDb = openSqliteDatabase(
      path.join(dataDir, DB_FILE_NAMES.musicDb),
      { foreignKeys: true }
    );
    databases.checkinDb = openSqliteDatabase(path.join(dataDir, DB_FILE_NAMES.checkinDb));

    // 依赖迁移列的索引必须在不可变迁移完成后创建。
    databases.songDb.exec(schema.SONG_TABLE_SCHEMA);
    databases.superChatDb.exec(schema.SUPER_CHAT_SCHEMA);
    databases.giftDb.exec(schema.GIFT_TABLE_SCHEMA);
    databases.musicDb.exec(schema.MUSIC_SCHEMA);
    databases.checkinDb.exec(schema.CHECKIN_SCHEMA);

    runAllMigrations(databases, options);
    databases.songDb.exec(schema.SONG_INDEX_SCHEMA);
    databases.giftDb.exec(schema.GIFT_INDEX_SCHEMA);
    migrateLegacySuperChatsToDedicatedDatabase(databases.songDb, databases.superChatDb);

    return databases;
  } catch (error) {
    closeDatabases(databases);
    throw error;
  }
}

// ── 迁移注册表 ──
// 数组下标 + 1 即版本号。只能往末尾追加，不能改动已发布的步骤。

function runAllMigrations(databases, options = {}) {
  const { songDb, superChatDb, giftDb, musicDb, checkinDb } = databases;
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
    },
    // v4：保存 Excel 点歌价格说明，旧歌曲默认留空
    (db) => {
      ensureSongRequestPriceColumn(db);
    },
    // v5：保存 Excel 歌切说明，旧歌曲默认留空
    (db) => {
      ensureSongClipColumn(db);
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
    },
    (db) => {
      // v3: 同一平台事件允许属于不同 UID，但同一 UID 只能保留一条。
      collapseDuplicateGiftIdentities(db);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_events_platform_uid
        ON gift_events(platform_id, uid)
        WHERE platform_id != '' AND uid != ''
      `);
    },
    (db) => {
      // v4: gift_events 升级为共享检测账本；历史记录只属于礼物统计，禁止回放给加班机。
      ensureGiftDetectionColumns(db);
      db.prepare(`
        UPDATE gift_events
        SET detection_status = 'final',
            first_detected_at_ms = CASE
              WHEN strftime('%s', created_at) IS NULL THEN 0
              ELSE CAST(strftime('%s', created_at) AS INTEGER) * 1000
            END,
            last_platform_at_ms = CASE
              WHEN strftime('%s', updated_at) IS NULL THEN 0
              ELSE CAST(strftime('%s', updated_at) AS INTEGER) * 1000
            END,
            finalized_at_ms = CASE
              WHEN strftime('%s', updated_at) IS NULL THEN 0
              ELSE CAST(strftime('%s', updated_at) AS INTEGER) * 1000
            END,
            gift_stats_eligible = 1,
            gift_stats_delivered = 1,
            overtime_epoch = 0
      `).run();
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_gift_events_detection_pending
          ON gift_events(detection_status, last_platform_at_ms);
        CREATE INDEX IF NOT EXISTS idx_gift_events_gift_stats_delivery
          ON gift_events(detection_status, gift_stats_eligible, gift_stats_delivered, id);
      `);
    },
    (db) => {
      // v5: 加班机状态、规则与结算流水均位于 gift-data.db，以支持单事务结算。
      db.prepare(`
        INSERT OR IGNORE INTO overtime_machine_state (
          id, enabled, enable_epoch, initial_seconds, remaining_ms,
          anchor_at_ms, status, background_path, background_fit, revision, updated_at
        ) VALUES (1, 0, 0, 0, 0, 0, 'paused', '', 'cover', 0, ?)
      `).run(now());
    },
    (db) => {
      // v6: 乘法可产生超长倒计时，将安全上限扩展为 9,999 个 365 天年。
      db.exec(`
        ALTER TABLE overtime_machine_state RENAME TO overtime_machine_state_v5;
        CREATE TABLE overtime_machine_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
          enable_epoch INTEGER NOT NULL DEFAULT 0 CHECK (enable_epoch >= 0),
          initial_seconds INTEGER NOT NULL DEFAULT 0 CHECK (initial_seconds BETWEEN 0 AND 315328464000),
          remaining_ms INTEGER NOT NULL DEFAULT 0 CHECK (remaining_ms BETWEEN 0 AND 315328464000000),
          anchor_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (anchor_at_ms >= 0),
          status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('paused', 'running', 'finished')),
          background_path TEXT NOT NULL DEFAULT '',
          background_fit TEXT NOT NULL DEFAULT 'cover' CHECK (background_fit IN ('cover', 'contain', 'fill')),
          revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
          updated_at TEXT NOT NULL
        );
        INSERT INTO overtime_machine_state (
          id, enabled, enable_epoch, initial_seconds, remaining_ms,
          anchor_at_ms, status, background_path, background_fit, revision, updated_at
        )
        SELECT id, enabled, enable_epoch, initial_seconds, remaining_ms,
               anchor_at_ms, status, background_path, background_fit, revision, updated_at
        FROM overtime_machine_state_v5;
        DROP TABLE overtime_machine_state_v5;
      `);
    },
    (db) => {
      // v7: 允许礼物规则只展示文字而不改动加班时间。
      db.exec(`
        ALTER TABLE overtime_gift_rules RENAME TO overtime_gift_rules_v6;
        CREATE TABLE overtime_gift_rules (
          gift_id TEXT PRIMARY KEY,
          gift_name TEXT NOT NULL DEFAULT '',
          image_path TEXT NOT NULL DEFAULT '',
          mode TEXT NOT NULL CHECK (mode IN ('fixed', 'random', 'display')),
          fixed_seconds INTEGER,
          outcomes_json TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          sort_order INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        INSERT INTO overtime_gift_rules (
          gift_id, gift_name, image_path, mode, fixed_seconds,
          outcomes_json, enabled, sort_order, updated_at
        )
        SELECT gift_id, gift_name, image_path, mode, fixed_seconds,
               outcomes_json, enabled, sort_order, updated_at
        FROM overtime_gift_rules_v6;
        DROP TABLE overtime_gift_rules_v6;
        CREATE INDEX IF NOT EXISTS idx_overtime_gift_rules_order
          ON overtime_gift_rules(enabled DESC, sort_order, gift_id);
      `);
    }
  ]));

  results.push(schema.runMigrations(musicDb, 'music_db', [
    () => { /* 基线：建表已在 MUSIC_SCHEMA 完成 */ }
  ]));

  results.push(schema.runMigrations(checkinDb, 'checkin_db', [
    () => { /* 基线：建表已在 CHECKIN_SCHEMA 完成 */ }
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
    musicDb: schema.getSchemaVersion(databases.musicDb, 'music_db'),
    checkinDb: schema.getSchemaVersion(databases.checkinDb, 'checkin_db')
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

function ensureSongRequestPriceColumn(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(songs)').all().map((column) => column.name));
  if (!columns.has('request_price')) {
    db.exec("ALTER TABLE songs ADD COLUMN request_price TEXT NOT NULL DEFAULT ''");
  }
}

function ensureSongClipColumn(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(songs)').all().map((column) => column.name));
  if (!columns.has('song_clip')) {
    db.exec("ALTER TABLE songs ADD COLUMN song_clip TEXT NOT NULL DEFAULT ''");
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

function ensureGiftDetectionColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(gift_events)').all().map(column => column.name));
  const wanted = [
    ['detection_status', "TEXT NOT NULL DEFAULT 'progress'"],
    ['first_detected_at_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_platform_at_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['finalized_at_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['gift_stats_eligible', 'INTEGER NOT NULL DEFAULT 0'],
    ['gift_stats_delivered', 'INTEGER NOT NULL DEFAULT 0'],
    ['overtime_epoch', 'INTEGER NOT NULL DEFAULT 0']
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) db.exec(`ALTER TABLE gift_events ADD COLUMN ${name} ${definition}`);
  }
}

function collapseDuplicateGiftIdentities(db) {
  const groups = db.prepare(`
    SELECT platform_id, uid
    FROM gift_events
    WHERE platform_id != '' AND uid != ''
    GROUP BY platform_id, uid
    HAVING COUNT(*) > 1
  `).all();

  for (const group of groups) {
    const rows = db.prepare(`
      SELECT * FROM gift_events
      WHERE platform_id = ? AND uid = ?
      ORDER BY id ASC
    `).all(group.platform_id, group.uid);
    const canonical = rows[0];
    const latest = rows.at(-1);
    const mergedNum = Math.max(...rows.map(row => normalizePositiveInteger(row.num) || 1));
    const mergedTotal = Math.max(...rows.map(row => Number(row.total_price) || 0));

    db.prepare(`
      UPDATE gift_events
      SET user_name = ?, num = ?, unit_price = ?, total_price = ?,
          counted_in_sprint = ?, updated_at = ?
      WHERE id = ?
    `).run(
      cleanText(latest.user_name) || cleanText(canonical.user_name),
      mergedNum,
      mergedNum > 0 ? mergedTotal / mergedNum : 0,
      mergedTotal,
      rows.some(row => Number(row.counted_in_sprint) === 1) ? 1 : 0,
      cleanText(latest.updated_at) || cleanText(canonical.updated_at),
      Number(canonical.id)
    );
    db.prepare(`
      DELETE FROM gift_events
      WHERE platform_id = ? AND uid = ? AND id != ?
    `).run(group.platform_id, group.uid, Number(canonical.id));
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

// ── 清空操作矩阵 ──

/**
 * Clear-all matrix: 定义哪些表保留、删除、重建默认行。
 * 保留：配置类（settings、ai_configuration、theme_presets、favorites、playlists）
 *       加班机状态（overtime_machine_state、overtime_gift_rules）
 * 删除：所有业务数据（歌曲、队列、礼物、SC、播放历史、签到等）
 * 重建：默认分类、禁用加班机初始状态
 */
const CLEAR_ALL_MATRIX = {
  preserve: [
    'settings',
    'ai_configuration',
    'theme_presets',
    'overtime_machine_state',
    'overtime_gift_rules',
    'favorites',
    'playlists',
    'playlist_tracks'
  ],
  delete: [
    'songs',
    'song_categories',
    'queue',
    'requests',
    'import_batches',
    'user_cooldowns',
    'ai_request_logs',
    'ai_api_usage',
    'ai_viewer_context',
    'ai_query_cache',
    'ai_blacklist',
    'super_chats',
    'gift_events',
    'overtime_settlements',
    'play_history',
    'play_queue_state',
    'checkin_users'
  ],
  recreate: [
    {
      table: 'song_categories',
      row: { name: '默认', sort_order: 0, is_enabled: 1 }
    },
    {
      table: 'overtime_machine_state',
      row: {
        id: 1,
        enabled: 0,
        enable_epoch: 0,
        initial_seconds: 0,
        remaining_ms: 0,
        anchor_at_ms: 0,
        status: 'paused',
        background_path: '',
        background_fit: 'cover',
        revision: 0
      }
    }
  ]
};

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
  const timestamp = now();

  giftDb.exec('BEGIN IMMEDIATE');
  try {
    // 第一步：将所有 pending settlements 标记为 ignored
    giftDb.prepare(`
      UPDATE overtime_settlements
      SET status = 'ignored', rule_mode = 'ignored', settle_after_ms = 0,
          last_error = ?, updated_at = ?
      WHERE status = 'pending'
    `).run('manual:clear-gifts', timestamp);

    // 第二步：删除所有礼物事件
    const giftCount = countRows(giftDb, 'gift_events');
    giftDb.prepare('DELETE FROM gift_events').run();

    // 第三步：删除所有结算记录（包括 applied/ignored 审计记录）
    // 这是用户显式的"清空全部礼物数据"操作
    giftDb.prepare('DELETE FROM overtime_settlements').run();

    // 清理自增序列
    giftDb.prepare(`
      DELETE FROM sqlite_sequence WHERE name IN ('gift_events', 'overtime_settlements')
    `).run();

    giftDb.exec('COMMIT');
    return { gifts: giftCount };
  } catch (error) {
    giftDb.exec('ROLLBACK');
    throw error;
  }
}

/**
 * 清空全部业务数据，保留配置。使用两阶段提交确保原子性。
 * Phase 1: 开启所有事务并执行 DELETE，但不提交
 * Phase 2: 依次提交所有事务；如有失败则返回部分失败状态
 */
function clearAllData(songDb, superChatDb, giftDb, musicDb, checkinDb) {
  const counts = {
    songs: 0,
    categories: 0,
    queue: 0,
    requests: 0,
    importBatches: 0,
    userCooldowns: 0,
    aiRequestLogs: 0,
    aiApiUsage: 0,
    aiViewerContext: 0,
    aiQueryCache: 0,
    aiBlacklist: 0,
    sc: 0,
    gifts: 0,
    overtimeSettlements: 0,
    playHistory: 0,
    playQueueState: 0,
    checkins: 0
  };

  const databases = [
    { name: 'songDb', db: songDb },
    { name: 'superChatDb', db: superChatDb },
    { name: 'giftDb', db: giftDb },
    { name: 'musicDb', db: musicDb },
    { name: 'checkinDb', db: checkinDb }
  ];

  // Phase 1: 开启所有事务并执行 DELETE，统计行数
  const beginErrors = [];
  const rollbackAll = () => {
    for (const { name, db } of databases) {
      if (db) {
        try {
          db.exec('ROLLBACK');
        } catch (rollbackError) {
          console.warn(`[Database] Failed to rollback ${name}:`, rollbackError.message);
        }
      }
    }
  };

  try {
    // songDb: 清空业务数据，保留 settings, ai_configuration, theme_presets
    songDb.exec('BEGIN');
    counts.songs = countRows(songDb, 'songs');
    counts.categories = countRows(songDb, 'song_categories');
    counts.queue = countRows(songDb, 'queue');
    counts.requests = countRows(songDb, 'requests');
    counts.importBatches = countRows(songDb, 'import_batches');
    counts.userCooldowns = countRows(songDb, 'user_cooldowns');
    counts.aiRequestLogs = countRows(songDb, 'ai_request_logs');
    counts.aiApiUsage = countRows(songDb, 'ai_api_usage');
    counts.aiViewerContext = countRows(songDb, 'ai_viewer_context');
    counts.aiQueryCache = countRows(songDb, 'ai_query_cache');
    counts.aiBlacklist = countRows(songDb, 'ai_blacklist');

    songDb.prepare('DELETE FROM requests').run();
    songDb.prepare('DELETE FROM queue').run();
    songDb.prepare('DELETE FROM songs').run();
    songDb.prepare('DELETE FROM song_categories').run();
    songDb.prepare('DELETE FROM import_batches').run();
    songDb.prepare('DELETE FROM user_cooldowns').run();
    songDb.prepare('DELETE FROM ai_request_logs').run();
    songDb.prepare('DELETE FROM ai_api_usage').run();
    songDb.prepare('DELETE FROM ai_viewer_context').run();
    songDb.prepare('DELETE FROM ai_query_cache').run();
    songDb.prepare('DELETE FROM ai_blacklist').run();
    songDb.prepare(`
      DELETE FROM sqlite_sequence
      WHERE name IN ('songs', 'song_categories', 'import_batches', 'queue', 'requests', 'ai_request_logs')
    `).run();
  } catch (error) {
    beginErrors.push({ db: 'songDb', phase: 'delete', error: error.message });
    rollbackAll();
  }

  if (beginErrors.length === 0) {
    try {
      superChatDb.exec('BEGIN');
      counts.sc = countRows(superChatDb, 'super_chats');
      superChatDb.prepare('DELETE FROM super_chats').run();
      superChatDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'super_chats'").run();
    } catch (error) {
      beginErrors.push({ db: 'superChatDb', phase: 'delete', error: error.message });
      rollbackAll();
    }
  }

  if (beginErrors.length === 0) {
    try {
      giftDb.exec('BEGIN IMMEDIATE');
      counts.gifts = countRows(giftDb, 'gift_events');
      counts.overtimeSettlements = countRows(giftDb, 'overtime_settlements');
      const timestamp = now();

      // 将所有 pending settlements 标记为 ignored
      giftDb.prepare(`
        UPDATE overtime_settlements
        SET status = 'ignored', rule_mode = 'ignored', settle_after_ms = 0,
            last_error = ?, updated_at = ?
        WHERE status = 'pending'
      `).run('manual:clear-all', timestamp);

      // 删除所有礼物事件
      giftDb.prepare('DELETE FROM gift_events').run();

      // 手动清空全部操作：删除所有结算记录（包括审计记录）
      giftDb.prepare('DELETE FROM overtime_settlements').run();

      giftDb.prepare(`
        DELETE FROM sqlite_sequence WHERE name IN ('gift_events', 'overtime_settlements')
      `).run();
    } catch (error) {
      beginErrors.push({ db: 'giftDb', phase: 'delete', error: error.message });
      rollbackAll();
    }
  }

  if (beginErrors.length === 0 && musicDb) {
    try {
      musicDb.exec('BEGIN');
      counts.playHistory = countRows(musicDb, 'play_history');
      counts.playQueueState = countRows(musicDb, 'play_queue_state');
      musicDb.prepare('DELETE FROM play_history').run();
      musicDb.prepare('DELETE FROM play_queue_state').run();
      musicDb.prepare("DELETE FROM sqlite_sequence WHERE name = 'play_history'").run();
    } catch (error) {
      beginErrors.push({ db: 'musicDb', phase: 'delete', error: error.message });
      rollbackAll();
    }
  }

  if (beginErrors.length === 0 && checkinDb) {
    try {
      checkinDb.exec('BEGIN');
      counts.checkins = countRows(checkinDb, 'checkin_users');
      checkinDb.prepare('DELETE FROM checkin_users').run();
    } catch (error) {
      beginErrors.push({ db: 'checkinDb', phase: 'delete', error: error.message });
      rollbackAll();
    }
  }

  // 如果 Phase 1 有任何失败，返回错误
  if (beginErrors.length > 0) {
    const error = new Error(`Clear-all pre-commit failed: ${beginErrors.map(e => `${e.db} ${e.phase}`).join(', ')}`);
    error.details = beginErrors;
    throw error;
  }

  // Phase 2: 依次提交所有事务
  const commitResults = [];
  const committed = [];
  const failed = [];

  for (const { name, db } of databases) {
    if (!db) continue;
    try {
      db.exec('COMMIT');
      committed.push(name);
      commitResults.push({ db: name, status: 'committed' });
    } catch (error) {
      failed.push(name);
      commitResults.push({ db: name, status: 'failed', error: error.message });
      // 首次提交失败后立即停止，不再尝试后续提交
      break;
    }
  }

  // 如果有提交失败，返回部分失败状态
  if (failed.length > 0) {
    const committedSet = new Set(committed);
    const rolledBack = [];
    const rollbackFailed = [];
    for (const { name, db } of databases) {
      if (!db || committedSet.has(name)) continue;
      try {
        db.exec('ROLLBACK');
        rolledBack.push(name);
      } catch (error) {
        rollbackFailed.push(name);
      }
    }

    return {
      ok: false,
      partial: true,
      committed,
      failed,
      rolledBack,
      rollbackFailed,
      error: `Commit failed at ${failed[0]}`,
      deletedCounts: counts,
      results: commitResults
    };
  }

  // Phase 3: 所有提交成功，重建默认行
  try {
    // 重建默认分类
    const timestamp = now();
    songDb.prepare(`
      INSERT INTO song_categories (name, sort_order, is_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('默认', 0, 1, timestamp, timestamp);

    // 确保加班机状态行存在且为禁用状态
    giftDb.prepare(`
      INSERT OR REPLACE INTO overtime_machine_state (
        id, enabled, enable_epoch, initial_seconds, remaining_ms,
        anchor_at_ms, status, background_path, background_fit, revision, updated_at
      ) VALUES (1, 0, 0, 0, 0, 0, 'paused', '', 'cover', 0, ?)
    `).run(timestamp);
  } catch (error) {
    console.warn('[Database] Failed to recreate defaults after clear-all:', error.message);
  }

  return {
    cleared: true,
    scope: 'all',
    preserved: CLEAR_ALL_MATRIX.preserve,
    deletedCounts: counts,
    totalDeleted: Object.values(counts).reduce((a, b) => a + b, 0),
    recreated: ['song_categories', 'overtime_machine_state']
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
  ensureGiftDetectionColumns,
  migrateLegacySuperChatsToDedicatedDatabase,
  clearSongLibraryData,
  clearSuperChatData,
  clearPlaybackData,
  clearGiftData,
  clearAllData,
  closeDatabases,
  optimizeDatabases
};
