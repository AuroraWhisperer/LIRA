// 编写人：Aurora
// 各数据库的 DDL 定义与通用递增迁移器。
// 本模块只描述表结构，不含业务逻辑；迁移步骤由 database.js 注册。
'use strict';

// ── 通用递增迁移器 ──

/**
 * 按顺序执行迁移步骤，steps[0] 对应 version 1、steps[1] 对应 version 2 ⋯
 * 已执行过的步骤不会重复执行；新增步骤只需往数组末尾追加。
 */
function runMigrations(db, key, steps) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      key TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0
    )
  `);

  const row = db.prepare('SELECT version FROM schema_version WHERE key = ?').get(key);
  const current = row ? Number(row.version) || 0 : 0;
  const target = steps.length;

  // 库版本高于代码版本时（用户降级过程序）不做任何事，避免把新表结构改坏
  if (current >= target) {
    writeSchemaVersion(db, key, Math.max(current, target));
    return { key, from: current, to: current, applied: 0 };
  }

  let applied = 0;
  for (let index = current; index < target; index += 1) {
    const step = steps[index];
    const version = index + 1;
    db.exec('BEGIN');
    try {
      if (typeof step === 'function') step(db);
      writeSchemaVersion(db, key, version);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`[Schema] ${key} migration to v${version} failed: ${error.message}`);
    }
    applied += 1;
  }

  return { key, from: current, to: target, applied };
}

function writeSchemaVersion(db, key, version) {
  db.prepare(`
    INSERT INTO schema_version (key, version) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET version = excluded.version
    WHERE version < excluded.version
  `).run(key, version);
}

function getSchemaVersion(db, key) {
  try {
    const row = db.prepare('SELECT version FROM schema_version WHERE key = ?').get(key);
    return row ? Number(row.version) || 0 : 0;
  } catch (_) {
    return 0;
  }
}

// ── 点歌库 DDL ──

const SONG_SCHEMA = `
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

  -- 点歌流水此前只有主键索引，统计和保留期清理都要走全表扫描
  CREATE INDEX IF NOT EXISTS idx_requests_created_at
    ON requests(created_at);
  CREATE INDEX IF NOT EXISTS idx_requests_requester
    ON requests(requester_uid, created_at);
  CREATE INDEX IF NOT EXISTS idx_requests_song_name
    ON requests(song_name);

  CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_count INTEGER NOT NULL,
    inserted_count INTEGER NOT NULL,
    duplicate_count INTEGER NOT NULL,
    failed_count INTEGER NOT NULL,
    created_category_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 主题预设：把 settings 里几十个外观键收成一行一套，可切换
  CREATE TABLE IF NOT EXISTS theme_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL DEFAULT 'all',
    payload TEXT NOT NULL,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_theme_presets_scope
    ON theme_presets(scope, sort_order, id);

  -- 用户点歌冷却：原先只在内存 Map 里，重启即失效
  CREATE TABLE IF NOT EXISTS user_cooldowns (
    user_key TEXT PRIMARY KEY,
    uid TEXT NOT NULL DEFAULT '',
    user_name TEXT NOT NULL DEFAULT '',
    last_request_at INTEGER NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_user_cooldowns_last
    ON user_cooldowns(last_request_at);
`;

// ── 醒目留言 DDL ──

const SUPER_CHAT_SCHEMA = `
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
  CREATE INDEX IF NOT EXISTS idx_super_chats_created_at
    ON super_chats(created_at);
`;

// ── 礼物 DDL ──

const GIFT_SCHEMA = `
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
  CREATE INDEX IF NOT EXISTS idx_gift_events_created_at
    ON gift_events(created_at);
`;

// ── 播放器 DDL ──
// 播放状态原先只在浏览器 localStorage，清缓存即丢失、多页面无法共享

const MUSIC_SCHEMA = `
  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL DEFAULT 'default',
    track_key TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    track_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    artists TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT '',
    requester_name TEXT NOT NULL DEFAULT '',
    play_count INTEGER NOT NULL DEFAULT 1,
    played_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_play_history_track
    ON play_history(client_id, track_key);
  CREATE INDEX IF NOT EXISTS idx_play_history_played_at
    ON play_history(client_id, played_at);

  CREATE TABLE IF NOT EXISTS play_queue_state (
    client_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT '',
    track_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    artists TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_favorites_order
    ON favorites(sort_order, id);

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    track_key TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    track_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    artists TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_tracks_unique
    ON playlist_tracks(playlist_id, track_key);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order
    ON playlist_tracks(playlist_id, sort_order, id);
`;

module.exports = {
  runMigrations,
  getSchemaVersion,
  SONG_SCHEMA,
  SUPER_CHAT_SCHEMA,
  GIFT_SCHEMA,
  MUSIC_SCHEMA
};
