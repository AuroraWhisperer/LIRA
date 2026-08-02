# 存储与数据库 — SQLite 多库架构、Schema、迁移、持久化

> 涉及文件：`src/storage/database.js`, `src/storage/schema.js`, `src/storage/settings-store.js`, `src/storage/theme-store.js`, `src/storage/cooldown-store.js`, `src/storage/playback-store.js`, `src/storage/retention.js`

---

## 技术选型

| 技术 | 说明 |
|------|------|
| **Node.js 内置 SQLite (`DatabaseSync`)** | Node.js ≥22 引入的同步 API，零依赖 |
| **WAL 日志模式** | 支持并发读，写入性能优于默认 journal |
| **synchronous = NORMAL** | 平衡安全与性能（WAL 模式下足够安全） |
| **cache_size = -8000** | 8MB 缓存（负值表示 KB） |
| **temp_store = MEMORY** | 临时表/排序在内存中 |
| **4 独立数据库** | 按领域拆分，避免锁竞争 |
| **增量 Schema 迁移** | 版本号递增，只追加不修改 |

---

## 四数据库架构

```
data/
├── song-request-data.db    (点歌主库)
│   ├── settings            # KV 设置表
│   ├── schema_version      # 迁移版本记录
│   ├── songs               # 歌曲库
│   ├── song_categories     # 歌曲分类
│   ├── queue               # 点歌队列
│   ├── requests            # 点歌历史流水
│   ├── import_batches      # 导入批次记录
│   ├── theme_presets       # 主题预设
│   └── user_cooldowns      # 用户点歌冷却
│
├── super-chat-data.db      (醒目留言库)
│   ├── schema_version
│   └── super_chats         # 醒目留言记录
│
├── gift-data.db            (礼物库)
│   ├── schema_version
│   └── gift_events         # 礼物流水
│
└── music-data.db           (播放器库)
    ├── schema_version
    ├── play_history        # 播放历史
    ├── play_queue_state    # 播放队列持久化
    ├── favorites           # 收藏歌曲
    ├── playlists           # 自定义歌单
    └── playlist_tracks     # 歌单-歌曲关联
```

### 为何分库？

1. **隔离锁竞争**：WAL 模式下读不阻塞，但写入仍是串行的。将高频写入（gift_events）与低频操作（songs）分离。
2. **独立生命周期**：礼物数据可以独立清空/保留，不影响歌曲库。
3. **文件大小控制**：礼物流水可能极大量（高频礼物直播），单独一个文件便于管理。
4. **清晰职责边界**：一个 DB 一个领域，代码中注入对应的 db 句柄。

---

## Schema 版本迁移系统

### 设计原则

- **只追加，不修改**：迁移步骤按数组下标排列，新增步骤追加到末尾。
- **版本号永不回退**：库版本高于代码版本时跳过（用户降级程序的保护）。
- **每步一个事务**：迁移失败时自动回滚，不影响已完成的步骤。

### 实现 (`schema.js`)

```javascript
runMigrations(db, key, steps)
// key: 'song_db' | 'super_chat_db' | 'gift_db' | 'music_db'
// steps: [v1_fn, v2_fn, v3_fn, ...] // index+1 = version

工作流：
  1. 创建 schema_version 表（如不存在）
  2. 读取当前版本 current
  3. 从 current 到 target 逐步执行
  4. 每步在事务中：
     a. 执行迁移函数 (ALTER TABLE / CREATE INDEX)
     b. 更新 schema_version
     c. COMMIT
  5. 失败 → ROLLBACK + 抛出错误
```

### 注册的迁移步骤 (`database.js`)

```javascript
song_db 迁移：
  v1: ensureSongColumns() / ensureQueueColumns() / ensureRequesterMetaColumns()
  v2: seedThemePresets(defaultSettings)

super_chat_db 迁移：
  v1: 基线（建表由 SUPER_CHAT_SCHEMA 完成）

gift_db 迁移：
  v1: ensureGiftColumns()
  v2: CREATE INDEX idx_gift_events_platform_id

music_db 迁移：
  v1: 基线（建表由 MUSIC_SCHEMA 完成）
```

---

## 各表 DDL 详解

### song-request-data.db

#### settings — 键值设置表
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```
所有设置以 KV 存储，类型用字符串（`'true'` / `'false'` / `'300'`）。

#### songs — 歌曲库
```sql
CREATE TABLE songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_pinyin TEXT NOT NULL DEFAULT '',    -- 拼音（搜索排序）
  name_initial TEXT NOT NULL DEFAULT '#',  -- 首字母（分组导航）
  artist TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES song_categories(id),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',           -- 逗号分隔标签
  language TEXT NOT NULL DEFAULT '',
  source_platform TEXT NOT NULL DEFAULT '',-- 来源平台（local/qq/netease）
  original_group TEXT NOT NULL DEFAULT '', -- 原始歌单分组
  created_at / updated_at
);
-- 唯一索引：name + artist（防重复）
CREATE UNIQUE INDEX idx_songs_name_artist ON songs(name, artist);
-- 首字母索引（导航）
CREATE INDEX idx_songs_initial ON songs(name_initial);
```

#### queue — 点歌队列
```sql
CREATE TABLE queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER REFERENCES songs(id),
  song_name TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  category_name TEXT NOT NULL DEFAULT '',
  requester_uid TEXT NOT NULL DEFAULT '',
  requester_name TEXT NOT NULL DEFAULT '',
  requester_guard_level INTEGER NOT NULL DEFAULT 0,  -- 大航海等级
  requester_medal_name TEXT NOT NULL DEFAULT '',       -- 粉丝牌
  requester_medal_level INTEGER NOT NULL DEFAULT 0,   -- 粉丝牌等级
  source TEXT NOT NULL DEFAULT 'admin',  -- admin/danmaku/superchat
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting/playing/completed/deleted
  is_pinned INTEGER NOT NULL DEFAULT 0,  -- 置顶
  pinned_at TEXT NOT NULL DEFAULT '',
  created_at / updated_at
);
CREATE INDEX idx_queue_status ON queue(status, is_pinned, pinned_at, created_at);
```

#### requests — 点歌历史流水
```sql
CREATE TABLE requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER REFERENCES queue(id),
  song_id INTEGER REFERENCES songs(id),
  song_name, artist, category_name,
  requester_uid, requester_name,
  requester_guard_level, requester_medal_name, requester_medal_level,
  message TEXT NOT NULL DEFAULT '',      -- 观众原始弹幕文本
  source TEXT NOT NULL DEFAULT 'admin',
  created_at
);
CREATE INDEX idx_requests_created_at ON requests(created_at);
CREATE INDEX idx_requests_requester ON requests(requester_uid, created_at);
```

#### user_cooldowns — 点歌冷却
```sql
CREATE TABLE user_cooldowns (
  user_key TEXT PRIMARY KEY,           -- uid 或 userName（取决于配置）
  uid TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  last_request_at INTEGER NOT NULL DEFAULT 0,  -- 上次点歌时间戳
  request_count INTEGER NOT NULL DEFAULT 0,     -- 窗口内点歌次数
  updated_at TEXT NOT NULL
);
```
> **设计要点**：冷却数据从内存 Map 迁移到 SQLite，重启后不丢失。用户无法通过重启应用绕过冷却限制。

#### theme_presets — 主题预设
```sql
CREATE TABLE theme_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'all',    -- all/queue/songBoard/blindBox
  payload TEXT NOT NULL,                -- JSON：所有外观键值对
  is_builtin INTEGER NOT NULL DEFAULT 0,-- 内置预设（不可删除）
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at / updated_at
);
```

### super-chat-data.db

```sql
CREATE TABLE super_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id TEXT NOT NULL DEFAULT '',  -- Bilibili SC ID（去重）
  uid, user_name,
  price REAL NOT NULL DEFAULT 0,         -- 金额（RMB）
  message TEXT NOT NULL DEFAULT '',
  requester_guard_level, requester_medal_name, requester_medal_level,
  status TEXT NOT NULL DEFAULT 'active', -- active/completed/ignored
  source TEXT NOT NULL DEFAULT 'superchat',
  created_at / updated_at
);
CREATE INDEX idx_super_chats_status ON super_chats(status, created_at);
CREATE INDEX idx_super_chats_created_at ON super_chats(created_at);
```

### gift-data.db

```sql
CREATE TABLE gift_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id TEXT NOT NULL DEFAULT '',
  cmd TEXT NOT NULL DEFAULT '',          -- 原始命令
  gift_id, gift_name,
  uid, user_name,
  num INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total_price REAL NOT NULL DEFAULT 0,
  coin_type TEXT NOT NULL DEFAULT '',    -- gold/silver
  is_blind_box INTEGER NOT NULL DEFAULT 0,
  blind_box_name TEXT NOT NULL DEFAULT '',
  blind_box_price REAL,
  blind_profit REAL,                     -- 盲盒实际收益
  counted_in_sprint INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  raw_json TEXT NOT NULL DEFAULT '',     -- 原始 JSON（调试/回放）
  created_at / updated_at
);
CREATE INDEX idx_gift_events_status ON gift_events(status, created_at);
CREATE INDEX idx_gift_events_sprint ON gift_events(counted_in_sprint, status, created_at);
CREATE INDEX idx_gift_events_created_at ON gift_events(created_at);
CREATE INDEX idx_gift_events_platform_id ON gift_events(platform_id);
```

### music-data.db

```sql
-- 播放历史（去重：同一用户 + 同一歌曲合并播放次数）
CREATE TABLE play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL DEFAULT 'default',
  track_key TEXT NOT NULL,               -- source:trackId 唯一标识
  source, track_id, title, artists, album, cover_url,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT '',       -- 来源（search/playlist/queue等）
  requester_name TEXT NOT NULL DEFAULT '',
  play_count INTEGER NOT NULL DEFAULT 1,
  played_at TEXT NOT NULL,
  created_at / updated_at
);
CREATE UNIQUE INDEX idx_play_history_track ON play_history(client_id, track_key);

-- 播放队列持久化（完整 JSON 状态）
CREATE TABLE play_queue_state (
  client_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,                 -- JSON：完整队列状态
  updated_at TEXT NOT NULL
);

-- 收藏
CREATE TABLE favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_key TEXT NOT NULL UNIQUE,
  source, track_id, title, artists, album, cover_url, duration_ms,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 自定义歌单
CREATE TABLE playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at / updated_at
);

-- 歌单-歌曲关联
CREATE TABLE playlist_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_key, source, track_id, title, artists, album, cover_url, duration_ms,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_playlist_tracks_unique ON playlist_tracks(playlist_id, track_key);
```

---

## 数据保留策略 (`retention.js`)

### 策略配置

通过 settings 表配置保留天数：

```
giftRawJsonRetentionDays    — 礼物流水保留天数（默认 30）
requestRetentionDays         — 点歌历史保留天数（默认 90）
superChatRetentionDays       — SC 记录保留天数（默认 90）
coolDownRetentionDays        — 冷却记录保留天数（默认 7）
```

### 执行

```
applyRetentionPolicies(db, { policy, dryRun })
    │
    ├─ gift_events.raw_json → 清空旧记录的 raw_json（保留其他字段）
    ├─ gift_events → 删除过期礼物流水
    ├─ requests → 删除过期点歌历史
    ├─ super_chats → 删除过期 SC 记录
    ├─ user_cooldowns → 删除过期冷却记录
    └─ 返回 { giftRawJsonCleared, giftEventsDeleted, requestsDeleted, ... }
```

可以在启动时自动运行（`autoRetentionOnStartup: true`），或手动触发。

---

## 数据库初始化与关闭

### 打开数据库

```javascript
function openSqliteDatabase(filePath, options = {}) {
  const database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA cache_size = -8000;
    PRAGMA temp_store = MEMORY;
    ${options.foreignKeys ? 'PRAGMA foreign_keys = ON;' : ''}
  `);
  return database;
}
```

### 关闭数据库

```javascript
function closeDatabases(...databases) {
  for (const db of flattenDatabases(databases)) {
    try { db.close(); } catch (_) { /* 忽略关闭错误 */ }
  }
}
```
支持 `(songDb, superChatDb, giftDb, musicDb)` 和 `({ songDb, ... })` 两种传参。

### 关闭前优化

```javascript
function optimizeDatabases(...databases) {
  for (const db of flattenDatabases(databases)) {
    try { db.exec('PRAGMA optimize'); } catch (_) {}
  }
}
```
在 shutdown 序列中调用，整理碎片并更新统计信息。

---

## 存储层子模块

### settings-store.js
- `getSettings()` → 从 settings 表读取所有 KV → 合并默认值 → 返回纯对象
- `setSetting(key, value)` → INSERT OR REPLACE → 广播 WebSocket 更新
- `migrateQueueScrollSpeedSetting()` → 旧版设置值迁移
- `clearLegacyIdentityRuleDefaults()` → 清理旧版身份规则
- `migrateBlindBoxConfig()` → 盲盒配置迁移

### theme-store.js
- `listThemes(scope?)` → 列出主题预设
- `saveTheme(name, payload, scope)` → 保存/更新主题
- `deleteTheme(name)` → 删除（内置主题不可删除）
- `applyTheme(name)` → 将主题 payload 写入 settings 表
- `seedThemePresets(db, defaultSettings)` → 迁移 v2：初始化内置主题

### cooldown-store.js
- `loadInto(map)` → 从 user_cooldowns 表恢复到内存 Map
- `save(userKey, data)` → 写入/更新 user_cooldowns 行
- `cleanup()` → 删除过期记录

### playback-store.js
- `saveQueueState(payload, { clientId })` → 写入 play_queue_state
- `loadQueueState(clientId)` → 读取 play_queue_state
- `addPlayHistory(track)` → INSERT OR REPLACE play_history（更新 play_count）
- `getPlayHistory(clientId, limit)` → 查询播放历史
- `addFavorite(track)` / `removeFavorite(trackKey)` → 收藏管理
- `createPlaylist(name)` / `addToPlaylist(playlistId, track)` → 歌单管理
