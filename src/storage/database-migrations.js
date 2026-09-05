'use strict';

const {
  now,
  cleanText,
  normalizeSuperChatPrice,
  normalizeGuardLevel,
  normalizePositiveInteger,
} = require('../shared/utils');
const schema = require('./schema');
const { seedThemePresets } = require('./theme-store');

// ── 迁移注册表 ──
// 数组下标 + 1 即版本号。只能往末尾追加，不能改动已发布的步骤。

function runAllMigrations(databases, options = {}) {
  const { songDb, superChatDb, giftDb, musicDb, checkinDb } = databases;
  const defaultSettings = options.defaultSettings || {};
  const results = [];

  results.push(
    schema.runMigrations(songDb, 'song_db', [
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
        db.prepare(
          `
        UPDATE queue SET song_id = NULL
        WHERE song_id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY name, artist ORDER BY updated_at DESC, id DESC) AS rn
            FROM songs
          ) WHERE rn > 1
        )
      `,
        ).run();
        db.prepare(
          `
        UPDATE requests SET song_id = NULL
        WHERE song_id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY name, artist ORDER BY updated_at DESC, id DESC) AS rn
            FROM songs
          ) WHERE rn > 1
        )
      `,
        ).run();
        // 删除重复行，保留最新的
        db.prepare(
          `
        DELETE FROM songs WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY name, artist ORDER BY updated_at DESC, id DESC) AS rn
            FROM songs
          ) WHERE rn > 1
        )
      `,
        ).run();
        db.exec(
          'CREATE UNIQUE INDEX idx_songs_name_artist ON songs(name, artist)',
        );
      },
      // v4：保存 Excel 点歌价格说明，旧歌曲默认留空
      (db) => {
        ensureSongRequestPriceColumn(db);
      },
      // v5：保存 Excel 歌切说明，旧歌曲默认留空
      (db) => {
        ensureSongClipColumn(db);
      },
    ]),
  );

  // 醒目留言库此前完全没有迁移入口，v1 建立基线以便后续加列
  results.push(
    schema.runMigrations(superChatDb, 'super_chat_db', [
      () => {
        /* 基线：建表已在 SUPER_CHAT_SCHEMA 完成 */
      },
    ]),
  );

  results.push(
    schema.runMigrations(giftDb, 'gift_db', [
      (db) => {
        ensureGiftColumns(db);
      },
      (db) => {
        // v2: 补齐 platform_id 索引，避免全表扫描导致礼物漏记
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_gift_events_platform_id ON gift_events(platform_id)',
        );
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
        db.prepare(
          `
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
      `,
        ).run();
        db.exec(`
        CREATE INDEX IF NOT EXISTS idx_gift_events_detection_pending
          ON gift_events(detection_status, last_platform_at_ms);
        CREATE INDEX IF NOT EXISTS idx_gift_events_gift_stats_delivery
          ON gift_events(detection_status, gift_stats_eligible, gift_stats_delivered, id);
      `);
      },
      (db) => {
        // v5: 加班机状态、规则与结算流水均位于 gift-data.db，以支持单事务结算。
        db.prepare(
          `
        INSERT OR IGNORE INTO overtime_machine_state (
          id, enabled, enable_epoch, initial_seconds, remaining_ms,
          anchor_at_ms, status, background_path, background_fit, revision, updated_at
        ) VALUES (1, 0, 0, 0, 0, 0, 'paused', '', 'cover', 0, ?)
      `,
        ).run(now());
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
      },
      (db) => {
        // v8: 服务器权威礼物按来源分区，并把同步状态放入同一个礼物库。
        db.exec(`
          CREATE TABLE IF NOT EXISTS gift_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_key TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `);
        const columns = new Set(
          db
            .prepare('PRAGMA table_info(gift_events)')
            .all()
            .map((column) => column.name),
        );
        if (!columns.has('source_id')) {
          db.exec(
            'ALTER TABLE gift_events ADD COLUMN source_id INTEGER REFERENCES gift_sources(id)',
          );
        }
        db.exec(`
          CREATE TABLE IF NOT EXISTS gift_sync_state (
            source_id INTEGER PRIMARY KEY
              REFERENCES gift_sources(id) ON DELETE CASCADE,
            sync_epoch TEXT,
            final_cursor INTEGER
              CHECK (final_cursor IS NULL OR final_cursor >= 0),
            bootstrap_complete INTEGER NOT NULL DEFAULT 0
              CHECK (bootstrap_complete IN (0, 1)),
            bootstrap_page_token TEXT,
            bootstrap_recovery_cursor INTEGER
              CHECK (
                bootstrap_recovery_cursor IS NULL
                OR bootstrap_recovery_cursor >= 0
              ),
            bootstrap_sync_epoch TEXT,
            projection_generation INTEGER NOT NULL DEFAULT 1
              CHECK (projection_generation >= 1),
            last_validated_at TEXT,
            updated_at TEXT NOT NULL,
            CHECK (
              bootstrap_complete = 0 OR (
                sync_epoch IS NOT NULL
                AND final_cursor IS NOT NULL
                AND bootstrap_page_token IS NULL
              )
            )
          );
          CREATE INDEX IF NOT EXISTS idx_gift_events_source_time
            ON gift_events(
              source_id, detection_status, status, created_at DESC, id DESC
            );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_events_remote_source_event
            ON gift_events(source_id, platform_id, cmd)
            WHERE source_id IS NOT NULL AND cmd = 'LIRA_SERVER_GIFT';
          CREATE TRIGGER IF NOT EXISTS trg_remote_gift_source_insert
          BEFORE INSERT ON gift_events
          WHEN NEW.cmd = 'LIRA_SERVER_GIFT' AND (
            NEW.source_id IS NULL OR
            NOT EXISTS (SELECT 1 FROM gift_sources WHERE id = NEW.source_id)
          )
          BEGIN
            SELECT RAISE(ABORT, 'REMOTE_GIFT_SOURCE_REQUIRED');
          END;
          CREATE TRIGGER IF NOT EXISTS trg_remote_gift_source_update
          BEFORE UPDATE ON gift_events
          WHEN NEW.cmd = 'LIRA_SERVER_GIFT' AND (
            NEW.source_id IS NULL OR
            NOT EXISTS (SELECT 1 FROM gift_sources WHERE id = NEW.source_id)
          )
          BEGIN
            SELECT RAISE(ABORT, 'REMOTE_GIFT_SOURCE_REQUIRED');
          END;
        `);
      },
      (db) => {
        // v9: 远端盲盒事件保留稳定的盒子礼物 ID；旧行保持 NULL。
        ensureGiftBlindBoxIdColumn(db);
      },
    ]),
  );

  results.push(
    schema.runMigrations(musicDb, 'music_db', [
      () => {
        /* 基线：建表已在 MUSIC_SCHEMA 完成 */
      },
    ]),
  );

  results.push(
    schema.runMigrations(checkinDb, 'checkin_db', [
      () => {
        /* 基线：建表已在 CHECKIN_SCHEMA 完成 */
      },
    ]),
  );

  for (const result of results) {
    if (result.applied > 0) {
      console.log(
        `[Schema] ${result.key}: v${result.from} → v${result.to} (${result.applied} step(s))`,
      );
    }
  }
  return results;
}

function getSchemaVersions(databases) {
  return {
    songDb: schema.getSchemaVersion(databases.songDb, 'song_db'),
    superChatDb: schema.getSchemaVersion(
      databases.superChatDb,
      'super_chat_db',
    ),
    giftDb: schema.getSchemaVersion(databases.giftDb, 'gift_db'),
    musicDb: schema.getSchemaVersion(databases.musicDb, 'music_db'),
    checkinDb: schema.getSchemaVersion(databases.checkinDb, 'checkin_db'),
  };
}

// ── 列补全 ──

function ensureSongColumns(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(songs)')
      .all()
      .map((column) => column.name),
  );
  const wanted = [
    ['tags', "TEXT NOT NULL DEFAULT ''"],
    ['language', "TEXT NOT NULL DEFAULT ''"],
    ['source_platform', "TEXT NOT NULL DEFAULT ''"],
    ['original_group', "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE songs ADD COLUMN ${name} ${definition}`);
    }
  }
}

function ensureSongRequestPriceColumn(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(songs)')
      .all()
      .map((column) => column.name),
  );
  if (!columns.has('request_price')) {
    db.exec(
      "ALTER TABLE songs ADD COLUMN request_price TEXT NOT NULL DEFAULT ''",
    );
  }
}

function ensureSongClipColumn(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(songs)')
      .all()
      .map((column) => column.name),
  );
  if (!columns.has('song_clip')) {
    db.exec("ALTER TABLE songs ADD COLUMN song_clip TEXT NOT NULL DEFAULT ''");
  }
}

function ensureQueueColumns(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(queue)')
      .all()
      .map((column) => column.name),
  );
  if (!columns.has('pinned_at')) {
    db.exec("ALTER TABLE queue ADD COLUMN pinned_at TEXT NOT NULL DEFAULT ''");
    db.prepare(
      `
      UPDATE queue SET pinned_at = updated_at
      WHERE is_pinned = 1 AND pinned_at = ''
    `,
    ).run();
  }
}

function ensureRequesterMetaColumns(db, tableName) {
  const columns = new Set(
    db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((column) => column.name),
  );
  const wanted = [
    ['requester_guard_level', 'INTEGER NOT NULL DEFAULT 0'],
    ['requester_medal_name', "TEXT NOT NULL DEFAULT ''"],
    ['requester_medal_level', 'INTEGER NOT NULL DEFAULT 0'],
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
    }
  }
}

function ensureGiftColumns(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(gift_events)')
      .all()
      .map((column) => column.name),
  );
  const wanted = [
    ['cmd', "TEXT NOT NULL DEFAULT ''"],
    ['is_blind_box', 'INTEGER NOT NULL DEFAULT 0'],
    ['blind_box_name', "TEXT NOT NULL DEFAULT ''"],
    ['blind_box_price', 'REAL'],
    ['blind_profit', 'REAL'],
    ['counted_in_sprint', 'INTEGER NOT NULL DEFAULT 0'],
    ['raw_json', "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE gift_events ADD COLUMN ${name} ${definition}`);
    }
  }
}

function ensureGiftBlindBoxIdColumn(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(gift_events)')
      .all()
      .map((column) => column.name),
  );
  if (!columns.has('blind_box_id')) {
    db.exec('ALTER TABLE gift_events ADD COLUMN blind_box_id TEXT');
  }
}

function ensureGiftDetectionColumns(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(gift_events)')
      .all()
      .map((column) => column.name),
  );
  const wanted = [
    ['detection_status', "TEXT NOT NULL DEFAULT 'progress'"],
    ['first_detected_at_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_platform_at_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['finalized_at_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['gift_stats_eligible', 'INTEGER NOT NULL DEFAULT 0'],
    ['gift_stats_delivered', 'INTEGER NOT NULL DEFAULT 0'],
    ['overtime_epoch', 'INTEGER NOT NULL DEFAULT 0'],
  ];

  for (const [name, definition] of wanted) {
    if (!columns.has(name))
      db.exec(`ALTER TABLE gift_events ADD COLUMN ${name} ${definition}`);
  }
}

function collapseDuplicateGiftIdentities(db) {
  const groups = db
    .prepare(
      `
    SELECT platform_id, uid
    FROM gift_events
    WHERE platform_id != '' AND uid != ''
    GROUP BY platform_id, uid
    HAVING COUNT(*) > 1
  `,
    )
    .all();

  for (const group of groups) {
    const rows = db
      .prepare(
        `
      SELECT * FROM gift_events
      WHERE platform_id = ? AND uid = ?
      ORDER BY id ASC
    `,
      )
      .all(group.platform_id, group.uid);
    const canonical = rows[0];
    const latest = rows.at(-1);
    const mergedNum = Math.max(
      ...rows.map((row) => normalizePositiveInteger(row.num) || 1),
    );
    const mergedTotal = Math.max(
      ...rows.map((row) => Number(row.total_price) || 0),
    );

    db.prepare(
      `
      UPDATE gift_events
      SET user_name = ?, num = ?, unit_price = ?, total_price = ?,
          counted_in_sprint = ?, updated_at = ?
      WHERE id = ?
    `,
    ).run(
      cleanText(latest.user_name) || cleanText(canonical.user_name),
      mergedNum,
      mergedNum > 0 ? mergedTotal / mergedNum : 0,
      mergedTotal,
      rows.some((row) => Number(row.counted_in_sprint) === 1) ? 1 : 0,
      cleanText(latest.updated_at) || cleanText(canonical.updated_at),
      Number(canonical.id),
    );
    db.prepare(
      `
      DELETE FROM gift_events
      WHERE platform_id = ? AND uid = ? AND id != ?
    `,
    ).run(group.platform_id, group.uid, Number(canonical.id));
  }
}

// ── 数据迁移 ──

function migrateLegacySuperChatsToDedicatedDatabase(songDb, superChatDb) {
  const legacyTable = songDb
    .prepare(
      `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'super_chats'
  `,
    )
    .get();
  if (!legacyTable) return;

  const rows = songDb
    .prepare('SELECT * FROM super_chats ORDER BY id ASC')
    .all();
  if (rows.length === 0) {
    dropLegacySuperChatTable(songDb, 0);
    return;
  }

  let migrated = 0;
  superChatDb.exec('BEGIN');
  try {
    for (const row of rows) {
      const fingerprint = legacySuperChatFingerprint(row);
      const existing = superChatDb
        .prepare(
          `
        SELECT id
        FROM super_chats
        WHERE (platform_id != '' AND platform_id = ?)
           OR (platform_id = '' AND ? != '' AND uid = ? AND message = ? AND created_at = ?)
        LIMIT 1
      `,
        )
        .get(
          cleanText(row.platform_id),
          fingerprint,
          cleanText(row.uid),
          cleanText(row.message),
          cleanText(row.created_at),
        );
      if (existing) continue;

      superChatDb
        .prepare(
          `
        INSERT INTO super_chats (
          platform_id, uid, user_name, price, message,
          requester_guard_level, requester_medal_name, requester_medal_level,
          status, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
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
          cleanText(row.updated_at) || cleanText(row.created_at) || now(),
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
      console.log(
        '[Startup] dropped legacy super_chats table from song database.',
      );
    }
  } catch (error) {
    console.warn(
      '[Startup] failed to drop legacy super_chats table:',
      error.message,
    );
  }
}

function legacySuperChatFingerprint(row) {
  if (!row) return '';
  return [
    cleanText(row.uid),
    cleanText(row.message),
    cleanText(row.created_at),
  ].join('|');
}

module.exports = {
  runAllMigrations,
  getSchemaVersions,
  ensureSongColumns,
  ensureSongRequestPriceColumn,
  ensureSongClipColumn,
  ensureQueueColumns,
  ensureRequesterMetaColumns,
  ensureGiftColumns,
  ensureGiftDetectionColumns,
  collapseDuplicateGiftIdentities,
  migrateLegacySuperChatsToDedicatedDatabase,
  dropLegacySuperChatTable,
  legacySuperChatFingerprint,
};
