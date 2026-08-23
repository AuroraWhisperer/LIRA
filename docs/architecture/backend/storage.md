# 存储层:数据目录、SQLite 五库与迁移

> 涉及文件:[src/storage/database.js](../../../src/storage/database.js)、[src/storage/schema.js](../../../src/storage/schema.js)、[src/storage/retention.js](../../../src/storage/retention.js)、[src/storage/settings-store.js](../../../src/storage/settings-store.js)、[src/storage/theme-store.js](../../../src/storage/theme-store.js)、[src/storage/playback-store.js](../../../src/storage/playback-store.js)、[src/storage/cooldown-store.js](../../../src/storage/cooldown-store.js)、[src/storage/checkin-store.js](../../../src/storage/checkin-store.js)

本文档是数据库与数据目录的**唯一事实源**:数据库文件名、表清单、DDL 要点、迁移版本、保留策略只在此成表。其他文档一律链接此处。

## 1. 技术选型

- **`node:sqlite` 内置模块 `DatabaseSync`**(同步 API),零第三方数据库依赖;要求 Node ≥ 24(见 [engineering/build.md](../engineering/build.md))。
- 每库统一 PRAGMA([database.js:199-212](../../../src/storage/database.js#L199-L212)):`journal_mode=WAL`、`synchronous=NORMAL`、`cache_size=-8000`、`temp_store=MEMORY`;`songDb`/`musicDb` 额外 `foreign_keys=ON`。
- **多库拆分**:按域隔离,避免单库写锁竞争与误清数据,详见 ADR [0004-reuse-monolith-and-gift-db](../adr/0004-reuse-monolith-and-gift-db.md)。

## 2. 数据目录布局(唯一成表处)

`dataDir` 解析顺序:`runtimeOptions.dataDir` → 环境变量 `SONG_PLUGIN_DATA_DIR` → 仓库根 `data/`([server.js:57-61](../../../src/server.js#L57-L61));Electron 模式下 `app.setPath('userData', 安装目录/data)`(见 [desktop/main.md](../desktop/main.md))。

```
data/
├── song-request-data.db       # 点歌库(songs/queue/requests/settings/AI/主题/冷却)
├── super-chat-data.db         # 醒目留言库
├── gift-data.db               # 礼物库(gift_events + 加班机三表)
├── music-data.db              # 播放器库(历史/队列态/收藏/歌单)
├── checkin-data.db            # 签到库
├── music-api-cache/           # 音乐 API 响应 JSON 缓存(TTL 5 分钟)
├── music-lyrics-cache/        # 歌词缓存(TTL 30 天)
├── .session-token             # 会话令牌(0600,服务关闭时删除)
├── .server-runtime.json       # 运行时信息 {pid, port, host}
├── music-auth/qq.cookies.enc          # QQ 音乐 Cookie 快照(safeStorage 加密)
├── music-auth/netease.cookies.enc     # 网易云 Cookie 快照
├── bilibili-auth/cookies.enc          # B站 Cookie 快照
├── bilibili-auth/cookies.txt          # 可选明文导出(脚本用)
├── Partitions/                # Chromium 登录分区持久化目录
└── local-media-access.json      # 本地媒体文件允许清单
```

认证文件格式与生命周期见 [desktop/auth.md](../desktop/auth.md);`logs/` 目录(ai.log / terminal.log / desktop.log)位于 data 目录的**父目录**。

## 3. 五库 × 表清单(唯一成表处)

共 **25 张业务表 + 每库 1 张 `schema_version`**。文件常量 `DB_FILE_NAMES`([database.js:20-26](../../../src/storage/database.js#L20-L26)),DDL 定义在 [schema.js](../../../src/storage/schema.js)。

### 3.1 song-request-data.db(点歌库,14 表)

| 表 | 用途 | 关键列/索引 |
|---|---|---|
| `settings` | 全部设置键值(key/value/updated_at),见 §7 | key PK |
| `ai_configuration` | AI 配置与凭证(与 settings 隔离,**避免通用设置接口回传密钥**) | key PK、`is_secret` 标记 |
| `ai_request_logs` | AI 请求审计日志 | uid/user_name/category/status/latency_ms/input_tokens/output_tokens/tool_calls/error_code;idx created_at |
| `ai_api_usage` | 月度配额计数 | PK(category, month_key)、request_count |
| `ai_viewer_context` | 观众对话上下文 | uid PK、payload、expires_at |
| `ai_query_cache` | 查询缓存 | cache_key PK、expires_at |
| `ai_blacklist` | AI 黑名单 | uid PK、reason |
| `song_categories` | 歌曲分类 | name UNIQUE、sort_order、is_enabled |
| `songs` | 曲库 | name/name_pinyin/name_initial/artist/category_id/tags/language/source_platform/original_group;唯一索引 `idx_songs_name_artist(name, artist)` 由迁移 v3 创建 |
| `queue` | 点歌队列 | song_id(FK)、requester_* 元数据、source(admin/danmaku/…)、status、is_pinned/pinned_at;idx(status, is_pinned, pinned_at, created_at) |
| `requests` | 点歌流水(统计/保留期清理) | queue_id/song_id(FK)、message;idx created_at、idx(requester_uid, created_at)、idx song_name |
| `import_batches` | 批量导入批次记录 | total/inserted/duplicate/failed/created_category |
| `theme_presets` | 主题预设(外观键收成一行一套) | name UNIQUE、scope、payload、is_builtin;idx(scope, sort_order, id) |
| `user_cooldowns` | 用户点歌冷却(**重启后从 DB 恢复**,防绕过) | user_key PK、last_request_at、request_count |

### 3.2 super-chat-data.db(醒目留言库,1 表)

| 表 | 用途 | 关键列/索引 |
|---|---|---|
| `super_chats` | SC 流水 | platform_id、price REAL、status(active/assisted/deleted);idx(status, created_at)、idx created_at |

历史数据由 `migrateLegacySuperChatsToDedicatedDatabase` 从 songDb 旧表迁移后删表([database.js:337-414](../../../src/storage/database.js#L337-L414))。

### 3.3 gift-data.db(礼物库,4 表)

| 表 | 用途 | 关键列/索引 |
|---|---|---|
| `gift_events` | 礼物事件 + **共享检测账本**(见 [bilibili/gift.md](bilibili/gift.md)) | 业务列 + 检测列 `detection_status/first_detected_at_ms/last_platform_at_ms/finalized_at_ms/gift_stats_eligible/gift_stats_delivered/overtime_epoch`;idx status/sprint/created_at/platform_id,唯一索引 `(platform_id, uid)`(迁移 v3) |
| `overtime_machine_state` | 加班机单例状态 | **id=1 CHECK 单行**;enabled/enable_epoch/initial_seconds/remaining_ms/anchor_at_ms/status(paused\|running\|finished)/background_path/background_fit(cover\|contain\|fill)/revision,见 [overtime.md](overtime.md) |
| `overtime_gift_rules` | 加班机礼物规则 | gift_id PK、mode(fixed\|random\|display)、fixed_seconds、outcomes_json、enabled、sort_order；display 文字与数量模式存于 outcomes_json |
| `overtime_settlements` | 结算流水(幂等) | gift_event_id **UNIQUE**、status(pending\|applied\|ignored)、rule_snapshot_json、requested/applied_delta_seconds、settle_after_ms、retry_count;idx(status, settle_after_ms)、idx(status, id DESC) |

### 3.4 music-data.db(播放器库,5 表)

| 表 | 用途 | 关键列/索引 |
|---|---|---|
| `play_history` | 播放历史 | client_id/track_key/source/track_id/play_count/played_at;唯一 idx(client_id, track_key) |
| `play_queue_state` | 播放队列快照(按 client 存 payload JSON) | client_id PK |
| `favorites` | 收藏 | track_key UNIQUE、sort_order |
| `playlists` | 歌单 | name UNIQUE、sort_order |
| `playlist_tracks` | 歌单曲目 | FK playlist_id ON DELETE CASCADE;唯一 idx(playlist_id, track_key) |

### 3.5 checkin-data.db(签到库,1 表)

| 表 | 用途 | 关键列/索引 |
|---|---|---|
| `checkin_users` | 签到用户 | uid PK、total_days、first/last_checkin_at、last_checkin_date;idx last_checkin_date |

## 4. Schema 迁移系统

`runMigrations(db, key, steps)`([schema.js:12-47](../../../src/storage/schema.js#L12-L47)):steps 数组下标+1 即版本号,**只允许末尾追加**;每步一个事务(BEGIN/COMMIT,失败 ROLLBACK 并抛错);版本只升不降(检测到库版本高于代码版本时跳过,防止用户降级损坏数据)。

各库注册的迁移步骤([database.js:59-185](../../../src/storage/database.js#L59-L185)):

| 库 | key | 版本 | 步骤内容 |
|---|---|---|---|
| songDb | `song_db` | v1-v3 | v1 列补全(tags/language/source_platform/original_group、pinned_at、requester_* 元数据);v2 `seedThemePresets`;v3 清理重复 (name, artist) 后建唯一索引 |
| superChatDb | `super_chat_db` | v1 | 基线 |
| giftDb | `gift_db` | v1-v7 | v1 `ensureGiftColumns`(cmd/blind_box/raw_json 等);v2 platform_id 索引;v3 `collapseDuplicateGiftIdentities` + 唯一索引 (platform_id, uid);v4 **检测账本升级**(`ensureGiftDetectionColumns`,历史记录标记 final 且仅归属礼物统计);v5 插入加班机单例行(id=1);v6 扩展加班机倒计时安全上限;v7 放开加班机 `display` 文字展板规则模式 |
| musicDb | `music_db` | v1 | 基线 |
| checkinDb | `checkin_db` | v1 | 基线 |

初始化顺序固定为基础表 DDL → 不可变迁移 → 依赖迁移列的索引 DDL → legacy Super Chat 搬迁。song/gift 的组合 schema 导出仅用于兼容；`createDatabases()` 使用拆分后的 table/index schema，避免真正的 pre-v1 库在 `pinned_at` 或 `counted_in_sprint` 补列前创建相关索引。任何初始化步骤失败时，本次已打开的全部数据库句柄都会关闭。版本可由 `/api/state` 的 `schemaVersions` 或 `GET /api/database/stats` 查看(见 [api.md](api.md))。

## 5. 数据保留策略(Retention)

[src/storage/retention.js](../../../src/storage/retention.js):默认策略 `DEFAULT_POLICY` = 礼物原始报文 30 天清文本(保留解析结果)、礼物事件/点歌流水/SC **永久保留(0 = 不清理)**、冷却记录 1 天。settings 键 → policy 翻译见 `readRetentionPolicy`(giftRawJsonRetentionDays 等,§7)。

- `applyRetentionPolicies(databases, {policy, dryRun})`:dryRun 只统计不删除;gift_events 清 raw_json 用 UPDATE(保留行),其余按 `created_at < 阈值` 删行。
- `runStartupRetention()`:启动时按 `autoRetentionOnStartup==='true'` 执行(见 [server-core.md](server-core.md) §5),失败不阻断启动。
- `getRetentionStats(databases)`:各表行数/最早最晚时间/raw_json 字节数,供管理页展示。

## 6. 清库操作

[database.js](../../../src/storage/database.js) 的清空函数(经 `/api/database/*` 暴露,见 [api.md](api.md)):

| 函数 | 范围 | 保留 |
|---|---|---|
| `clearSongLibraryData` | songs/song_categories/import_batches | settings、theme_presets、queue/requests(仅解除 song_id 外键) |
| `clearSuperChatData` | super_chats | — |
| `clearPlaybackData` | play_history/play_queue_state | favorites/playlists |
| `clearGiftData` | **gift_events + overtime_settlements 同事务**(`BEGIN IMMEDIATE`) | overtime_machine_state/overtime_gift_rules |
| `clearAllData` | 五库全部业务数据(见下文矩阵) | 配置类表(settings/ai_configuration/theme_presets/overtime_*/favorites/playlists) |

### 6.1 Clear-All Matrix(清空全部矩阵)

`clearAllData()` 使用 **两阶段提交**确保原子性。矩阵常量 `CLEAR_ALL_MATRIX`([database.js:465-516](../../../src/storage/database.js#L465-L516)):

**保留(Preserve)**:配置类表,清空后应用仍可用
- `settings`:直播间号、主题颜色、所有功能开关
- `ai_configuration`:AI 提供商配置与凭证
- `theme_presets`:主题预设(内置 + 用户自建)
- `overtime_machine_state`:加班机状态(清空后重置为 id=1 禁用行)
- `overtime_gift_rules`:加班机礼物规则
- `favorites`:播放器收藏
- `playlists` + `playlist_tracks`:播放器歌单

**删除(Delete)**:全部业务数据
- 点歌业务:`songs`、`song_categories`(清空后重建默认分类)、`queue`、`requests`、`import_batches`、`user_cooldowns`
- AI 运行时:`ai_request_logs`、`ai_api_usage`、`ai_viewer_context`、`ai_query_cache`、`ai_blacklist`
- 直播数据:`super_chats`、`gift_events`、`overtime_settlements`、`checkin_users`
- 播放器数据:`play_history`、`play_queue_state`

**重建(Recreate)**:业务必需的默认行
- `song_categories`:插入"默认分类"行(name='默认分类', sort_order=0, is_enabled=1)
- `overtime_machine_state`:确保 id=1 行存在且为禁用状态(enabled=0, status='paused')

### 6.2 两阶段提交流程

**Phase 1**(预提交验证):
1. 对所有 5 个数据库依次执行 `BEGIN` + `DELETE` + 统计行数,但**不提交**
2. 若任一 BEGIN/DELETE 失败,回滚全部并抛出聚合错误(`error.details` 包含各库状态)

**Phase 2**(提交):
1. 依次对所有数据库执行 `COMMIT`
2. 若全部成功:重建默认行,返回 `{ cleared: true, preserved: [...], deletedCounts: {...}, recreated: [...] }`
3. 若任一 COMMIT 失败:立即停止,返回 `{ ok: false, partial: true, committed: [...], failed: [...], deletedCounts: {...} }`

部分失败时数据库处于**不一致状态**(部分库已清空、部分未清空),路由返回 HTTP 500 + `partial: true`,前端强制刷新页面并提示用户手动检查。

### 6.3 并发写入静默(Quiesce)

清空全部前路由会调用上下文的静默方法([data-routes.js:30-37](../../../src/server/routes/data-routes.js#L30-L37)):
- `context.gifts.pauseDetection()`:暂停礼物检测写入
- `context.overtime.pauseRecovery()`:暂停加班机后台恢复写入
- 路由同时清理音乐 API 与歌词文件缓存；Electron 桌面端在成功响应后还会清理 QQ 音乐、网易云音乐会话缓存（不删除登录 Cookie）。

成功后恢复:
- `context.gifts.resumeDetection()`
- `context.overtime.resumeRecovery()`

部分失败时**不恢复**,避免向不一致的数据库写入。

## 7. 设置存储(settings-store)

`createSettingsStore(db)`([settings-store.js:126](../../../src/storage/settings-store.js#L126-L155)):首次调用把 `DEFAULT_SETTINGS` 全部 `INSERT OR IGNORE` 进 DB;`getSettings()` 内存缓存合并默认值;`setSetting(key, value)` 持久化并清缓存。默认键按组:

| 分组 | 键(代表) |
|---|---|
| 直播间 | `roomId`、`enableBilibili`、`paused`、`queueLimit`、`userCooldownSeconds` |
| 首次启动引导 | `onboardingVersion`、`onboardingCompletedAt`、`onboardingSkippedOptional`；仅保存完成契约版本、完成时间和可选步骤跳过记录 |
| 点歌行为 | `onlyFromLibrary`、`allowDuplicate`、`allowCompactRequest` |
| 弹幕机器人 | `enableRandomTagReply`、`enableCheckinBot`、`enableFortuneBot`、`enableCustomReplyBot`、`checkinBlessings`、`fortunePool`、`customReplyRules` |
| 礼物 | `enableGiftSprint`、`giftSprintTargetRmb`、`giftBlindBoxConfig`、`enableGiftNotification`、`giftFrameEnabled`、`giftFrameThresholdRmb`、`giftFrameTheme`、`giftFrameMotionMode`；礼物边框默认关闭、阈值为 20 元、主题为 `woodland-bloom`、动效为 `auto`；新安装的盲盒目录来自 `src/storage/default-blind-box-config.json`，旧字符串格式迁移使用 `settings-store.js` 内冻结的历史价格快照 |
| 滚动/字号 | `scrollSeconds`、风格 1 的 `queueScrollMode`/`queueScrollSpeed`/`queueSongFontSize`、风格 2 的 `identityQueueScrollMode`/`identityQueueScrollSpeed`/`identityQueueFontSize`、风格 3–6 各自的 `storybook*`/`neonVinyl*`/`cherryRibbon*`/`goldenLily*` 字号与滚动键、`songBoardFontSize` 及各 `*RangeVersion`/`queueStyleSettingsVersion` 迁移版本键；`queueStyleSettingsVersion=1` 首次升级时把旧共享值复制到各风格键 |
| 主题 | `themePrimary/themeAccent/themeText/themeBackground/themeOpacity/themeRadius/themeFontScale` 等 + `songBoard*` 独立一套 |
| 悬浮层 | `danmakuOverlayStyle`(`bubble`/`signal`/`minimal`，默认 `signal`)、`overlayQueueStyle`(`classic`/`identity`/`storybook`/`neon-vinyl`/`cherry-ribbon`/`golden-lily`,遗留 `festival` 按 identity 使用)、插画风格各自的 `*QueueFontFamily`/`*QueueFontWeight`/`*QueueUseCustomTextColor`/`*QueueTextColor`、`overlayLowPowerMode`、`backdropBlur`、`glowIntensity`、`overlayPin1-3`、`overlayRule1-6` 及颜色/字号 |
| 桌面歌词 | `desktopLyric*` 全套(字体/描边/大小/透明度/缩放/逐字高亮方式) |
| WeSing | `weSingCachePath`、`weSingLyricOffsetMs` |
| 开播动画 | `openingEnabled`、`openingTitle`、`openingSubtitle`、`openingName`、`openingFooter`、`openingQuality`、`openingTrackMotion`(`heart`/`barber`/`progress`，默认 `heart`)、`openingShowNotes`、`openingShowEq`、`openingAudioFile`、`openingAudioName`、`openingAudioVolume`；上传音频文件位于 data 目录 `opening-music/` |
| 保留期 | `giftRawJsonRetentionDays`(30)、`giftEventRetentionDays`(0)、`requestRetentionDays`(0)、`superChatRetentionDays`(0)、`autoRetentionOnStartup` |
| 更新 | `enableAutoUpdate` |

完整键表以 [settings-store.js:15-124](../../../src/storage/settings-store.js#L15-L124) 为准;设置经 WS 快照 `settings` 字段全量下发(见 [ws.md](ws.md))。

其他 store 模块:`theme-store`(presets 增删改查/应用/内置播种)、`playback-store`(saveQueueState/loadQueueState/播放历史/收藏/歌单)、`cooldown-store`(`loadInto` 重启恢复 + `COOLDOWN_RETENTION_MS`)、`checkin-store`(签到读写)。关闭时统一 `optimizeDatabases`(PRAGMA optimize)→ `closeDatabases`(见 [server-core.md](server-core.md) §6.2)。
