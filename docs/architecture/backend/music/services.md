# 音乐领域服务:注册表、缓存、曲库、队列与歌词状态

> 涉及文件:[provider-registry.js](../../../../src/music/provider-registry.js)、[provider-health.js](../../../../src/music/provider-health.js)、[stream-resolver.js](../../../../src/music/stream-resolver.js)、[track-contract.js](../../../../src/music/track-contract.js)、[music-cache.js](../../../../src/music/music-cache.js)、[lyrics-service.js](../../../../src/music/lyrics-service.js)、[song-service.js](../../../../src/music/song-service.js)、[queue-service.js](../../../../src/music/queue-service.js)、[song-matcher.js](../../../../src/music/song-matcher.js)、[random-song-filter.js](../../../../src/music/random-song-filter.js)、[tag-aliases.js](../../../../src/music/tag-aliases.js)、[requester-target-store.js](../../../../src/music/requester-target-store.js)、[song-import-schema.js](../../../../src/music/song-import-schema.js)、[song-file-codec.js](../../../../src/music/song-file-codec.js)、[lyric-state.js](../../../../src/music/lyric-state.js)、[lyric-timeline.js](../../../../src/music/lyric-timeline.js)

本文档是 `src/music/` 下**非 Provider、非 WeSing** 模块的唯一事实源:模块职责、导出签名、关键算法与常量只在此成表。上游 Provider 逆向工程见 [qq-provider.md](qq-provider.md) / [netease-provider.md](netease-provider.md);全民 K 歌采集见 [wesing.md](wesing.md);HTTP 端点见 [api.md](../api.md)(music-routes / song-routes / queue-routes 节);WebSocket 快照字段与消息见 [ws.md](../ws.md);DB 表结构见 [storage.md](../storage.md);领域装配点见 [server-core.md](../server-core.md) §5。

## 1. 模块地图

| 模块 | 职责 | 归属 |
|---|---|---|
| provider-registry.js | Provider 实例注册表 + 平台归一化 | §3 |
| provider-health.js | 健康检查聚合门面 | §3 |
| stream-resolver.js + track-contract.js | 播放 URL 解析编排与曲目契约 | §4 |
| music-cache.js | API/歌词磁盘缓存(TTL + 容量裁剪) | §5 |
| lyrics-service.js | 搜索 / 首页 / 歌词 / 匹配 / 歌单写入的门面 | §6 |
| song-service.js | 曲库 CRUD、分类、导入导出、随机选歌 | §7 |
| queue-service.js | 点歌队列统一语义 | §8 |
| song-matcher.js | 曲目匹配打分(自动接受阈值) | §9 |
| random-song-filter.js + tag-aliases.js | 随机点歌纯筛选规则与标签别名 | §10 |
| song-import-schema.js + song-file-codec.js | 导入导出列契约与 CSV/XLSX 编解码 | §11 |
| requester-target-store.js | 随机点歌请求者定位(弹幕机器人用) | §12 |
| lyric-state.js / lyric-timeline.js | 歌词状态/时间轴归一化(WS 载荷生产者) | §13 |
| providers/ + lyrics.js + wesing-* | 见各自文档 | — |

## 2. 领域装配(server-core.md §5 的接线详情)

运行时组件在 [server.js:109-192](../../../../src/server.js#L109-L192) 装配:

| 组件 | 创建 | 注入方 |
|---|---|---|
| `lyricsService` | `createLyricsService({ apiCacheDir: <data>/music-api-cache, lyricCacheDir: <data>/music-lyrics-cache })` | [server.js:109-112](../../../../src/server.js#L109-L112);缓存目录常量见 [server.js:67-68](../../../../src/server.js#L67-L68),落盘布局见 [storage.md](../storage.md) §2 |
| `musicRegistry` | `createMusicProviderRegistry()`(首次,无参;启动重建时注入 `musicAuth` 适配器) | [server.js:166](../../../../src/server.js#L166)、[server.js:443](../../../../src/server.js#L443) |
| `weSingCapture` | `createWeSingCapture({…})`,内含 `createWeSingOnlineLyricResolver({ getRegistry, lyricsService })` | [server.js:167-192](../../../../src/server.js#L167-L192),见 [wesing.md](wesing.md) |

`createDomainServices` 产出 `songs`(song-service 封装)与 `queue`(queue-service 封装),见 [server-core.md](../server-core.md) §5 的表;API context 的 `music` 组把 `registry` + `lyrics` 注入路由([server.js:404-405](../../../../src/server.js#L404-L405)),`weSing` 组见 [wesing.md](wesing.md) §8。

## 3. Provider 注册表与健康检查

### 3.1 provider-registry.js

| 导出 | 签名 | 行为 | 出处 |
|---|---|---|---|
| `SUPPORTED_MUSIC_PLATFORMS` | `Set['qq','netease']` | 平台白名单 | [provider-registry.js:6](../../../../src/music/provider-registry.js#L6) |
| `PROVIDER_LABELS` | `{ qq:'QQ音乐', netease:'网易云音乐' }` | 平台显示名 | [provider-registry.js:8-11](../../../../src/music/provider-registry.js#L8-L11) |
| `normalizeMusicPlatform` | `(value) => 'qq'\|'netease'` | 小写 trim 后校验白名单,否则抛"音乐平台只能是 qq 或 netease。" | [provider-registry.js:13-19](../../../../src/music/provider-registry.js#L13-L19) |
| `createMusicProviderRegistry(options)` | 工厂 | 见下 | [provider-registry.js:21-57](../../../../src/music/provider-registry.js#L21-L57) |
| `PlaceholderMusicProvider` | 类 | 未接入平台占位:`healthCheck` 返回 `provider-not-integrated`(已登录)或 `login-required`;其余方法一律抛"尚未接入" | [provider-registry.js:59-112](../../../../src/music/provider-registry.js#L59-L112) |

`createMusicProviderRegistry({ getAuthState, getCookieHeader })` 返回:

| 方法 | 行为 |
|---|---|
| `get(platform)` | 归一化后取实例(不存在的平台抛错) |
| `list()` | 两个 Provider 实例数组 |
| `healthCheck(platform?)` | 传平台只查单个;不传 `Promise.all` 并发查全部 |
| `getHealthyFallback(preferredPlatform)` | 并发健康检查,返回**第一个 ok 且非首选平台**的 Provider(返回原始健康对象);全挂返回 null |

两个真实 Provider 都注入同一对 `getAuthState` / `getCookieHeader`,Cookie 与登录态来源见 [auth.md](../../desktop/auth.md)。

### 3.2 provider-health.js

`getMusicProviderHealth(registry, platform)`([provider-health.js:7-10](../../../../src/music/provider-health.js#L7-L10)):仅转发到 `registry.healthCheck`(有 platform 先归一化),是 `/api/music/health` 的处理核心(见 [api.md](../api.md) 的 music-routes 节)。

## 4. 流解析编排(stream-resolver.js + track-contract.js)

Provider 内部实现见各 Provider 文档 §7.2;这里只记录编排层语义。

### 4.1 normalizeMusicTrackForProvider(track-contract.js)

[track-contract.js:6-37](../../../../src/music/track-contract.js#L6-L37):Provider 入参的唯一清洗点,违反即抛错:

| 字段 | 规则 |
|---|---|
| `id` / `sourceTrackId` / `title` | `cleanText` 后**必填**,缺失抛"歌曲信息不完整。" |
| `source` | `normalizeMusicPlatform` 归一 |
| `artists` | 清洗过滤后 **`slice(0, 8)` 最多 8 位** |
| `sourceSongId` | `max(0, Number(sourceSongId || songId))` — 非数值置 0 |
| `sourceSongType` | 安全非负整数;兼容读取 `songType`,缺失或非法置 0 |
| `playable` / `vip` | 仅显式 `false` / `true` 生效 |
| 其余(`album`/`durationMs`/`coverUrl`/`sourceMediaId`/`sourceAlbumId`) | 归一化容错 |

### 4.2 resolveMusicStream(stream-resolver.js)

[stream-resolver.js:7-13](../../../../src/music/stream-resolver.js#L7-L13):

```
1. normalizedTrack = normalizeMusicTrackForProvider(track)
2. provider = registry.get(normalizedTrack.source)
3. return provider.resolvePlayableUrl(normalizedTrack, { forceRefresh, quality })
```

- **TTL**:两个 Provider 各自 `STREAM_TTL_MS = 5 分钟`([qq-provider.js:15](../../../../src/music/providers/qq-provider.js#L15)、[netease-provider.js:8](../../../../src/music/providers/netease-provider.js#L8)),返回值带 `expireAt`/`playUrlExpireAt`;当前两个 Provider 均**忽略 `forceRefresh`**(QQ 由 vkey 缓存、网易云是纯字符串构造),刷新语义实际由播放器调用方与 §5 缓存层决定
- 本模块自身**不做磁盘缓存**(流 URL 短命,缓存无意义);歌词与首页内容缓存见 §5

## 5. 音乐缓存(music-cache.js)

磁盘 JSON 缓存,两目录两 TTL([storage.md](../storage.md) §2 有目录布局):

| 常量 | 值 | 用途 | 出处 |
|---|---|---|---|
| `MUSIC_API_CACHE_TTL_MS` | `5 * 60 * 1000`(5 分钟) | 首页内容缓存 | [music-cache.js:9](../../../../src/music/music-cache.js#L9) |
| `MUSIC_LYRIC_CACHE_TTL_MS` | `30 * 24 * 60 * 60 * 1000`(30 天) | 歌词缓存 | [music-cache.js:10](../../../../src/music/music-cache.js#L10) |
| API 目录容量上限 | 50 MB | 写缓存后裁剪 | [music-cache.js:36](../../../../src/music/music-cache.js#L36) |
| 歌词目录容量上限 | 300 MB | 同上 | 同上 |

| 函数 | 行为 |
|---|---|
| `musicCacheKey(scope, payload)` | `sha1(<scope>:<JSON.stringify(payload)>)` 十六进制([music-cache.js:12-16](../../../../src/music/music-cache.js#L12-L16)) |
| `readMusicJsonCache(dir, key, ttlMs)` | 读 `<key>.json`;`mtimeMs` 超 TTL 视为未命中;文件为 `{savedAt, data}` 信封,返回 `data`([music-cache.js:18-27](../../../../src/music/music-cache.js#L18-L27)) |
| `writeMusicJsonCache(dir, key, data)` | 写信封 + 按目录容量上限裁剪(按 mtime 从旧到新删,**缓存失败绝不影响播放**,全 try/catch 吞掉)([music-cache.js:29-38](../../../../src/music/music-cache.js#L29-L38)) |
| `clearMusicCache(apiDir, lyricDir)` | 删两目录重建,返回 `{clearedBytes, clearedFiles, after}`([music-cache.js:66-77](../../../../src/music/music-cache.js#L66-L77)) |
| `getMusicCacheStats(apiDir, lyricDir)` | `{api, lyrics, totalBytes, totalFiles}`([music-cache.js:79-86](../../../../src/music/music-cache.js#L79-L86)) |

## 6. 歌词与音乐搜索服务(lyrics-service.js)

### 6.1 工厂与门面

`createLyricsService({ apiCacheDir, lyricCacheDir })`([lyrics-service.js:17-34](../../../../src/music/lyrics-service.js#L17-L34))返回门面对象;文件底部另有模块级兼容单例 `compatibilityService` 与 `initLyricsService(apiDir, lyricDir)` 重配([lyrics-service.js:15,36-42](../../../../src/music/lyrics-service.js#L15-L42))。常量与 music-cache.js 同名同值([lyrics-service.js:12-13](../../../../src/music/lyrics-service.js#L12-L13))。

| 门面方法 | 行为 |
|---|---|
| `searchMusicTracks(registry, body)` | 平台缺省 `netease`;关键词取 `keyword/query/songName`,**截 120 字符**,空抛错;`limit` clamp 1-30 默认 20;返回 `{source, keyword, tracks}`([lyrics-service.js:44-55](../../../../src/music/lyrics-service.js#L44-L55)) |
| `getMusicHomeContent(registry, body)` | 首页内容(带缓存),见 §6.2 |
| `getMusicTrackLyrics(registry, body)` | 歌词(带缓存),见 §6.3 |
| `parseLyricPayload(body)` | 纯文本歌词解析:`lyric/translation/wordLyric(yrc)/roma` 各**截 512 KB**,`cleanTextPreserveLines` 保换行,喂 `parseLyricResult`;供前端直接粘贴歌词用([lyrics-service.js:150-156](../../../../src/music/lyrics-service.js#L150-L156)) |
| `matchMusicTrackCandidates(body)` | 匹配打分入口:`songName` 截 120 必填、`artist` 截 80、`durationMs`;candidates 截 50;`threshold: 70` 硬编码;返回 `{request, threshold, results}`([lyrics-service.js:158-171](../../../../src/music/lyrics-service.js#L158-L171)) |
| `writeMusicPlaylistTracks(registry, body, operation)` | 歌单写入门面,见 §6.4 |
| `normalizeMusicTrackForProvider` | 透传 §4.1 |

### 6.2 首页内容(`getMusicHomeContentWithCache`,[lyrics-service.js:62-113](../../../../src/music/lyrics-service.js#L62-L113))

`action` 八选一:

| action | 行为 | 缓存 |
|---|---|---|
| `personalized` | 推荐歌单,`limit` 转发时截 30,带 `page` | **缓存**(key 含 platform/action/limit/playlistId,**page 不入 key**,故 `page > 1` 必须绕过缓存) |
| `playlist-tracks` | 歌单详情,`playlistId` 必填 | **缓存**(且结果非空才写) |
| `daily` | 每日推荐 | **不缓存**——注释:radio/daily 的重点是每次给新歌,缓存会让它们永远返回同一批 |
| `radio` | 电台 | 不缓存 |
| `liked` | 我喜欢 | 不缓存 |
| `created-playlists` | 我的歌单;`body.track` 存在时并发标注 `containsTrack`(见 §6.5) | 不缓存 |
| `collected-playlists` | 收藏歌单 | 不缓存 |
| `recent` | 最近播放 | 不缓存 |
| 其他 | 抛"未知音乐首页动作。" | — |

缓存规则:仅 `personalized` / `playlist-tracks` 可缓存;`refresh === true` 或 `page > 1` **绕过缓存**;命中时返回 `{...cached, cached: true}`。`limit` clamp 1-5000 默认 100,`offset` ≥ 0,`page` clamp 1-50。

### 6.3 歌词(`getMusicTrackLyricsWithCache`,[lyrics-service.js:119-129](../../../../src/music/lyrics-service.js#L119-L129))

- 入参先过 `normalizeMusicTrackForProvider`(强制完整契约)
- 缓存 key:`musicCacheKey('lyrics-v3', { source, sourceTrackId })` — **版本前缀 v3 参与 hash**,解析器升级即自然失效
- TTL 30 天(§5);命中返回 `{...cached, cached: true}`
- 未命中 → `provider.getLyrics(normalizedTrack)` → 写缓存

### 6.4 歌单写入([lyrics-service.js:131-148](../../../../src/music/lyrics-service.js#L131-L148))

- 平台缺省 `qq`;playlist 从 `body.playlist` 归一(纯数字 `id`/`tid` 双取,title 截 200);`tracks` 截 100 首,空抛"缺少要修改的音乐歌曲。"
- `operation === 'remove'` → `removeTracksFromPlaylist`,否则 `addTracksToPlaylist`;Provider 缺方法抛"当前音乐 Provider 不支持修改歌单。"
- 返回 `{ source, operation, playlist, result }`

### 6.5 成员标注([lyrics-service.js:173-214](../../../../src/music/lyrics-service.js#L173-L214))

`annotatePlaylistMembership(provider, platform, playlists, track)`:**并发 6** 逐个歌单调用 `provider.playlistContainsTrack`(网易云用轻量 trackIds;QQ 无此方法则回退拉 5000 首线性比对,见 [qq-provider.md](qq-provider.md) §8),失败标 `containsTrack: null`。`getProviderTrackId` 对 QQ 优先数值 `sourceSongId`(写入用),否则 mid;网易云恒用数字 id。

## 7. 曲库服务(song-service.js)

### 7.1 歌曲 CRUD

| 函数 | 行为 | 出处 |
|---|---|---|
| `saveSong(db, input)` | **upsert 语义**:有 `input.id` 走 UPDATE(不存在抛"歌曲不存在",UNIQUE 冲突翻译成"歌曲名称和艺术家与已有歌曲重复");无 id 时先按 `(name, artist)` 精确查重,存在则 UPDATE 其余字段,否则 INSERT。`name` 必填;分类缺省"默认"(`ensureCategory`);`name_pinyin = name_initial = getInitial(name)` | [song-service.js:20-88](../../../../src/music/song-service.js#L20-L88) |
| `listSongs(db, filters)` | 过滤:关键词(`songs.name/artist/tags/category_name` 四列 LIKE)、分类列表、language、artist、`enabledOnly`;**tag 过滤在 SQL 之后用 JS 全匹配**(大小写不敏感);排序按 `name_initial` + `name`(`zh-Hans-CN-u-co-pinyin`);返回行 `is_enabled` 布尔化 | [song-service.js:90-146](../../../../src/music/song-service.js#L90-L146) |
| `findSong(db, songName, artist?)` | 有 artist 先精确 `(name, artist)`;否则按 name 取 `updated_at` 最新;仅启用歌曲 | [song-service.js:148-172](../../../../src/music/song-service.js#L148-L172) |
| `findUniqueSongNameMatch(db, songName)` | 精确失败后 LIKE `%name%`(转义 `\ % _`),**恰好 1 条才返回**(模糊匹配拒绝猜测) | [song-service.js:174-191](../../../../src/music/song-service.js#L174-L191) |
| `deleteSong` / `toggleSong` / `countSongs` | 单曲写操作封装(按 id 删除;切换启用返回 `{ok}`;总数) | [song-service.js:200-216](../../../../src/music/song-service.js#L200-L216) |

### 7.2 分类与标签

- `listCategories`:`sort_order ASC, name` 排序,`is_enabled` 布尔化
- `ensureCategory(name)`:`INSERT OR 返回` 语义,新建时 `sort_order=0, is_enabled=1`([song-service.js:231-242](../../../../src/music/song-service.js#L231-L242))
- `listTags`:扫描全表非空 tags,按 `[,，]` 切分去重,`zh-Hans-CN` 排序([song-service.js:366-373](../../../../src/music/song-service.js#L366-L373))
- `splitSongTags`:逗号(全/半角)切分

### 7.3 导入(importSongs,[song-service.js:246-316](../../../../src/music/song-service.js#L246-L316))

- `normalizeImportedSongRow` 逐行归一(§11);单事务 `BEGIN`/`COMMIT`,失败 `ROLLBACK`
- 逐行:名空计 failed → `(name, artist)` 重复计 duplicate 跳过 → 新分类计数 → INSERT
- 结束写 `import_batches` 批次记录;返回 `{total, inserted, duplicate, failed, createdCategories, failures}`

### 7.4 随机选歌(pickRandomSong,[song-service.js:320-346](../../../../src/music/song-service.js#L320-L346))

1. `listRandomSongCandidates(db, scopeText)`:SQL 只取 `is_enabled=1` 的全量行 + 分类启用标记,组合筛选交给纯模块 `filterRandomSongCandidates`(§10)
2. 排除**最近 10 次** `source = 'random' 或 'random:%'` 的点歌流水歌名(`requests` 表,`datetime(created_at) DESC LIMIT 10`)——避免随机重复刚点过的歌
3. 排除后为空则回退全池;`randomSourceValue(scopeText)` 生成 `source = 'random'` 或 `random:<scope>`(弹幕机器人据此定位请求者,见 §12)

`describeRandomSongScope`(导出名映射到库版,[song-service.js:348-357](../../../../src/music/song-service.js#L348-L357)):同样的数据源调 `describeRandomSongScope`(§10),供"随机点歌说明"用。`normalizeRandomScopeText` 会剥掉前导 `+＋:：-—` 符号([song-service.js:375-381](../../../../src/music/song-service.js#L375-L381))。

## 8. 点歌队列(queue-service.js)

### 8.1 统一队列语义

单表 `queue` 承载全部状态,状态机取值:**`current` / `waiting` / `done` / `deleted` / `skipped`**(无独立 playing/finished 态;快照 `current` 恒为 null,消费方取 `waiting` 首项作为当前播放):

```
waiting ──(消费方取首项播放,快照 current 恒为 null)
   │
   ├─ next   (服务端)────────▶ done      # 把当前首项标记完成
   ├─ clear  (服务端)────────▶ deleted   # 全部 active 项
   ├─ delete ─────────────────▶ deleted
   ├─ skip   ─────────────────▶ skipped
   └─ done   ─────────────────▶ done
```

`current` 是历史遗留态,`ensureUnifiedQueue`([queue-service.js:215-220](../../../../src/music/queue-service.js#L215-L220))在启动/清库修复时把它归位为 `waiting`。

### 8.2 addQueueItem(context, input)([queue-service.js:16-121](../../../../src/music/queue-service.js#L16-L121))

校验链(顺序即语义):

1. `songName` 必填
2. **队列上限**:`queueLimit` 设置(defaults 兜底),统计 `status IN ('current','waiting')` 的活跃数,满则抛"点歌队列已达到上限。"
3. **重复检查**:`allowDuplicate !== 'true'` 时,活跃队列内同名(仅 song_name)即抛"队列里已经有这首歌。"
4. **曲库校验**:`onlyFromLibrary === 'true'` 且 `findSong` 未命中 → 抛"歌库里没有这首歌。"

入队(与 `requests` 流水**同事务**):`song_id`/`song_name`/`artist`/`category_name` 在命中曲库时用曲库规范值;`requester_name` 缺省"观众";`source` 缺省 `admin`;`status = 'waiting'`;`is_pinned` 时 `pinned_at = createdAt`。返回 `normalizeQueueRow`(布尔化 `is_pinned`、归一 guard/medal)。

### 8.3 handleQueueAction(context, action, rawId)([queue-service.js:125-170](../../../../src/music/queue-service.js#L125-L170))

| action | 行为 |
|---|---|
| `next` | 取活跃队列**第一个**(排序 `is_pinned DESC, pinned_at ASC, created_at ASC, id ASC`)标 `done`;无活跃项则空转 |
| `clear` | 全部活跃项 → `deleted` |
| `pin` / `unpin` | 置位 + `pinned_at = updatedAt` / 清空 |
| `delete` | → `deleted` |
| `done` | → `done` |
| `skip` | → `skipped` |
| 其他 | 抛"未知队列操作。" |

### 8.4 快照与启动清理

- `getQueueSnapshot`([queue-service.js:174-188](../../../../src/music/queue-service.js#L174-L188)):返回 **`{ current: null, waiting: [...] }`**——`current` 恒为 null,前端自行消费(与 WS 快照 `queue` 字段一一对应,见 [ws.md](../ws.md) §2);waiting 排序同 `next`,并 LEFT JOIN `requests.message AS request_message`
- `clearActiveQueueOnStartup`([queue-service.js:203-213](../../../../src/music/queue-service.js#L203-L213)):启动时活跃项全部 → `deleted`(调用点见 [server-core.md](../server-core.md) §5 启动修复链)

## 9. 歌曲匹配(song-matcher.js)

**打分模型**,弹幕点歌智能匹配与 WeSing 在线兜底共用(见 [wesing.md](wesing.md) §7)。

| 常数 | 值 | 出处 |
|---|---|---|
| `AUTO_ACCEPT_SCORE` | 70 | [song-matcher.js:3](../../../../src/music/song-matcher.js#L3) |

`scoreTrackMatch(request, candidate)`([song-matcher.js:12-53](../../../../src/music/song-matcher.js#L12-L53))加分项:

| 条件 | 加分 |
|---|---|
| `track.title === request.songName` 完全一致 | +60 |
| 任一 artist 与请求 artist 完全一致 | +25 |
| 清洗后标题一致但原文不同(`cleanTitle === cleanSongName && title !== songName`) | +15 |
| 双 durationMs > 0 且差 ≤ 5000ms | +10 |
| 有专辑信息且专辑不含惩罚词 | +5 |

惩罚项(`penaltyRules`,[song-matcher.js:85-94](../../../../src/music/song-matcher.js#L85-L94)),作用于 `title + album` 小写文本:

| 关键词 | 扣分 |
|---|---|
| `live\|现场\|演唱会` | -15 |
| `dj\|remix\|混音\|电音` | -25 |
| `伴奏\|纯音乐\|instrumental` | -30 |
| `翻唱\|cover` | -20 |
| `加速\|慢速\|speed up\|sped up\|slowed` | -20 |

`rankTrackCandidates` 按分数降序、同分按标题字典序;`normalizeSongKey` 剥括号内容与全部标点空白([song-matcher.js:105-110](../../../../src/music/song-matcher.js#L105-L110))。`normalizeCandidate` 兼容 `artists[]` 与 `artist` 按 `/` 切分。

## 10. 随机点歌筛选(random-song-filter.js + tag-aliases.js)

### 10.1 词法

- `parseRandomSongTerms(scopeText)`:`+`(全/半角)分隔为 AND 条件,空片段忽略([random-song-filter.js:30-35](../../../../src/music/random-song-filter.js#L30-L35))
- `filterRandomSongCandidates(songs, scopeText)`:**每个词必须命中同一首歌**(不是多首歌各满足一条)([random-song-filter.js:41-45](../../../../src/music/random-song-filter.js#L41-L45))
- `songMatchesScopeTerm`([random-song-filter.js:61-66](../../../../src/music/random-song-filter.js#L61-L66)):先整词匹配;未中且词含空格时按空格拆 AND——兼容 `"说唱 苦情"` 直接输入,同时保留 `"A1 TRIP"` 这类带空格的完整歌手名
- `describeRandomSongScope`:`{ terms, unmatchedTerms, hasCandidates }`

### 10.2 单条件命中(`songMatchesTerm`,[random-song-filter.js:68-85](../../../../src/music/random-song-filter.js#L68-L85))

四路 OR:

| 维度 | 匹配方式 |
|---|---|
| 歌手 | 整串或按 `/\s*(?:\/|&|＆)\s*/` 切分后逐段 `normalizeComparable` 相等 |
| 语言 | `randomLanguageAliases(term)` 命中组内任一别名(`LANGUAGE_ALIAS_GROUPS`:[random-song-filter.js:8-14](../../../../src/music/random-song-filter.js#L8-L14):日语/韩语/英语/粤语/国语组,含 ja/jp/ko/en/chinese 等码),歌曲 language 按 `/、，,` 切分后比对 |
| 分类 | 歌曲分类启用(`category_is_enabled !== 0`)且 `randomCategoryAliases` 命中(`CATEGORY_ALIAS_GROUPS`:[random-song-filter.js:16-24](../../../../src/music/random-song-filter.js#L16-L24):流行/R&B/说唱/摇滚/民谣/舞曲/影视原声) |
| 标签 | `splitSongTags`(分隔符 `[,，、;；|]`,**整项匹配**避免"情"误中"抒情")逐项过 `matchesLibraryTag` |

### 10.3 标签别名(tag-aliases.js)

`LIBRARY_TAG_ALIASES`([tag-aliases.js:4-12](../../../../src/music/tag-aliases.js#L4-L12)):观众叫法 → 歌库标准标签单向映射(抒情/治愈/怀旧/国风/小甜歌/影视OST/K-Pop)。`matchesLibraryTag(libraryTag, viewerTerm)`([tag-aliases.js:25-31](../../../../src/music/tag-aliases.js#L25-L31)):先原样相等,再查 `LIBRARY_TAG_BY_VIEWER_ALIAS`(构建时把每个别名归一化映射到标准标签);**不反向展开**——歌库里的非标准标签不会因观众输入标准词而被扩展命中。归一化 = 压缩空白 + `toLocaleLowerCase('zh-Hans-CN')`。

## 11. 导入导出契约(song-import-schema.js + song-file-codec.js)

### 11.1 列契约(song-import-schema.js)

`SONG_EXPORT_HEADERS` 10 列([song-import-schema.js:5-16](../../../../src/music/song-import-schema.js#L5-L16)):`歌曲名字 / 原唱/首发歌手 / 歌曲分类 / 歌曲标签 / 是否可点 / 语言 / 点歌价格 / 歌切 / 核对平台 / 核对备注`。`点歌价格` 是自由文本说明，例如 `免费 / 心动 / 30元SC / 舰长 / 冠歌`;`歌切` 是可放链接、BV 号、时间点或其他说明的自由文本。两列均不参与点歌资格或排序判断。

`SONG_IMPORT_ALIASES` 每字段维护中英文别名([song-import-schema.js:18-29](../../../../src/music/song-import-schema.js#L18-L29));`requestPrice` 接受 `requestPrice / request_price / 点歌价格 / 点歌价 / 点歌门槛 / 点歌要求`;`songClip` 接受 `songClip / song_clip / 歌切 / 歌切链接 / 歌曲切片 / 切片链接`。`firstValue` 按别名顺序取首个非空;`parseEnabled` 识别 `是/可点/启用/true/yes/y/1` 与反向集,未识别回退默认值。`normalizeImportedSongRow` 产出清洗后的行,分类缺省"默认"，点歌价格与歌切均缺省空字符串。

### 11.2 编解码(song-file-codec.js)

| 函数 | 行为 |
|---|---|
| `parseSongsFromXlsx(buffer)` | 零依赖 ZIP 解析(`readZipFiles`):定位 `xl/worksheets/sheet\d+.xml`、读 `sharedStrings.xml`、`parseWorksheetXml`;表头检测 = 任一行单元格命中别名;无表头按导出列序解析;`name` 为空的尾行丢弃([song-file-codec.js:19-37](../../../../src/music/song-file-codec.js#L19-L37)) |
| `buildSongsCsv(rows)` | 表头 + `csvCell` 转义逐行 |
| `buildSongsWorkbook(rows)` | 手工拼 xlsx(inlineStr 单元格 + 6 个 zip 条目,含 workbook/styles/rels) |
| `templateSongs()` | 两行示例数据(晴天/小幸运)，点歌价格示例覆盖 `免费` 及 `心动 / 30元SC / 舰长 / 冠歌`，歌切默认留空 |
| `songToExportRow(song)` | 行映射(分类缺省"默认"、`is_enabled` → 是/否、`request_price` → 点歌价格、`song_clip` → 歌切，核对平台导出为空) |

## 12. 请求者定位(requester-target-store.js)

`createRequesterTargetStore(songDb).getLatestRandomRequester()`([requester-target-store.js:5-25](../../../../src/music/requester-target-store.js#L5-L25)):查 `requests` 表最近一条 `source='random' 或 'random:%'` 且 uid 或 name 非空的行,返回 `{uid, name, source, createdAt}`;供弹幕机器人把随机点歌结果回复给触发者(见 [bilibili/danmaku.md](../bilibili/danmaku.md))。

## 13. 歌词状态与时间轴(lyric-state.js / lyric-timeline.js)

### 13.1 归一化规则(共同)

两个模块是 WS `lyric-state` / `lyric-timeline` 载荷的唯一**归一化**入口,上游原始输入一律先过这里再进快照(WS 契约见 [ws.md](../ws.md) §2/§3):

- 状态枚举 **`idle` / `loading` / `ready` / `empty`**,非法值落 `idle`([lyric-state.js:7-9](../../../../src/music/lyric-state.js#L7-L9)、[lyric-timeline.js:9-11](../../../../src/music/lyric-timeline.js#L9-L11))
- 控制字符(0x00-0x1F、0x7F)替换为空格;`trackTitle` 截 120、`artists` 每项截 80 且最多 8 个、`lineText`/`translation` 截 240
- 时间一律 `clampNumber` 到 `[0, MAX_TIME_MS = 24h]`;`progress` clamp 到 `[0, 1]`
- 逐字词:最多 120 个,`text` 截 40,`endMs` 下限取 `startMs`

### 13.2 差异

| 模块 | 特有规则 | 出处 |
|---|---|---|
| `normalizeLyricState` | 单行语义:`currentMs`/`durationMs`/`progress`/`playing`/`locked`/`words[]`;兼容版本字段 `generation`/`sequence` 用于客户端拒绝旧状态回灌 | [lyric-state.js:5-30](../../../../src/music/lyric-state.js#L5-L30) |
| `normalizeLyricTimeline` | 全曲语义:**`MAX_LINES = 500` 行上限 + `MAX_TEXT_BUDGET = 48 KB` 文本预算**(按 `text+translation+roma` 长度累计,超预算即截断后续行);输入行按 `startMs` 稳定排序 | [lyric-timeline.js:3-5,7-37](../../../../src/music/lyric-timeline.js#L3-L37) |

### 13.3 生产者

| 载荷 | 生产者 | 广播点 |
|---|---|---|
| `lyricState`(快照 16 字段之一 + `lyric-state` 消息) | 播放页上报:API context `playbackLyrics.publish(state)`;WeSing 采集:`weSingCapture.onState` 在 active 且有 `lyricState` 时同步 | [server.js:345-349](../../../../src/server.js#L345-L349)、[server.js:183-188](../../../../src/server.js#L183-L188) |
| `lyricTimeline`(快照字段 + `lyric-timeline` 消息) | `publishLyricTimeline(input)`:归一化后广播;WeSing `onTimeline` 仅 `active` 时发布 | [server.js:161-165](../../../../src/server.js#L161-L165)、[server.js:189-191](../../../../src/server.js#L189-L191) |

歌词内容本身的时序消费在下方 §14 的解析器文档。

## 14. 歌词解析器(src/music/lyrics.js)

`lyrics.js` 是 QQ 音乐与网易云音乐**共用**的歌词行模型实现。导出 4 个函数：`parseLyricResult`、`parseLrc`、`parseWordLyric`、`findCurrentLyricLine`([lyrics.js:225-230](../../../../src/music/lyrics.js#L225-L230))。

### 14.1 parseLyricResult(rawLyric, rawTranslation, rawWordLyric, rawRoma)([lyrics.js:45-75](../../../../src/music/lyrics.js#L45-L75))

组合四路原始文本，产出完整行数组：

1. `parseWordLyric(rawWordLyric)` → 逐字行；`parseLrc(rawLyric)` → LRC 行
2. **LRC 非空取 LRC，空则降级为逐字行**（无词版行，`{startMs, endMs, text}`）([lyrics.js:48-50](../../../../src/music/lyrics.js#L48-L50))
3. 翻译/罗马音各经 `parseTimedText`（先 LRC 后逐字）解析，并构造各自的 `createTimedTextResolver`
4. 每行输出 `{ startMs, endMs, text, translation, roma, words[] }`：
   - `endMs` 缺失时取下一行 `startMs`([lyrics.js:69](../../../../src/music/lyrics.js#L69))
   - `roma` = API 罗马音优先；空则取 `[kana:…]` 假名注音（§14.5）
   - `words` = 逐字行按 `startMs` 精确对齐([lyrics.js:72](../../../../src/music/lyrics.js#L72))

### 14.2 parseLrc(rawText)([lyrics.js:113-137](../../../../src/music/lyrics.js#L113-L137))

| 事实 | 值 |
|---|---|
| 行正则 | `/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g` — 支持 `[mm:ss]`、`[mm:ss.xxx]`、`[mm:ss:xxx]` |
| 同行多时间戳 | 生成多条记录（卡拉 OK 重复行） |
| 空文本行 | 跳过（`if (!lyricText) continue`）|
| 分数位处理 | 3 位直接毫秒；不足 3 位 `padEnd(3,'0')`([lyrics.js:143-146](../../../../src/music/lyrics.js#L143-L146)) |
| 排序 | `startMs` 升序，同值按文本字典序 |

### 14.3 parseWordLyric(rawText)([lyrics.js:149-202](../../../../src/music/lyrics.js#L149-L202))

逐字歌词（QQ 音乐 QRC 解密产物 / 网易云 YRC）的行与词提取：

| 层级 | 正则 | 说明 |
|---|---|---|
| 行 | `/\[(\d+),(\d+)\]([\s\S]*)/` | `[startMs,durationMs,body]` |
| 前缀词（优先） | `/\((\d+),(\d+),\d*\)([^()]+)/g` | `(start,duration,?)text` |
| 后缀词（仅无前缀时） | `/([^()]*)\((\d+),(\d+)\)/g` | `text(start,duration)` |

每词输出 `{ startMs, endMs: startMs + max(0, durationMs), text }`；无词的行整体丢弃；行 `text` = 所有词文本拼接后 `trim()`。

### 14.4 createTimedTextResolver(lines, toleranceMs=100)([lyrics.js:86-111](../../../../src/music/lyrics.js#L86-L111))

用于翻译/罗马音行的时间容差匹配（QQ 音乐翻译行常有毫秒级偏移）：

1. 过滤非有限 `startMs` → 升序排序 → `exact = Map(startMs → text)`
2. 查询：`exact.has(startMs)` 直中；否则二分查找最近邻，`|Δ| ≤ 100ms` 才命中，否则返回 `''`

### 14.5 假名注音([lyrics.js:11-43](../../../../src/music/lyrics.js#L11-L43))

QQ 音乐 LRC 主歌词里可能携带 `[kana:…]` 标签存日语假名读音：

- `extractKanaReadings`：`/\[kana:([^\]]+)\]/` 匹配后，按数字分隔符切分为读音数组
- `mapKanaToLines`：遍历歌词行，按 CJK 字符（U+4E00-9FFF / U+3400-4DBF / U+F900-FAFF）消费读音，每行读音空格连接存入 `Map(startMs → kanaText)`；读音不足时已有读音的字就不再消费后续

CJK 判定三范围：`0x4E00-0x9FFF`（基本汉字）、`0x3400-0x4DBF`（扩展 A）、`0xF900-0xFAFF`（兼容汉字）([lyrics.js:4-8](../../../../src/music/lyrics.js#L4-L8))。

### 14.6 findCurrentLyricLine(lines, currentMs)([lyrics.js:204-223](../../../../src/music/lyrics.js#L204-L223))

二分查找**最后一个 `startMs ≤ currentMs` 的行**；`lines` 为空或 `currentMs` 非数字时返回 `null`。是播放页、WeSing 采集与歌词窗口的唯一当前行定位入口。

## 15. 常量总表

| 常量 | 值 | 模块 |
|---|---|---|
| `AUTO_ACCEPT_SCORE` | 70 | song-matcher |
| `MUSIC_API_CACHE_TTL_MS` | 5 min | music-cache / lyrics-service |
| `MUSIC_LYRIC_CACHE_TTL_MS` | 30 天 | 同上 |
| API/歌词缓存容量上限 | 50 MB / 300 MB | music-cache |
| `STREAM_TTL_MS`(各 Provider) | 5 min | qq-provider / netease-provider |
| 歌词逐字词/文本上限 | 120 词 / text 40 字符 | lyric-state |
| 时间轴行数/文本预算 | 500 行 / 48 KB | lyric-timeline |
| `MAX_TIME_MS` | 24h | lyric-state / lyric-timeline |
| 匹配 `threshold` | 70 | lyrics-service |
| 成员标注并发 | 6 | lyrics-service |
| 写入曲目/歌词文本上限 | 100 首 / 512 KB 每字段 | lyrics-service |

## 15. 跨 Provider 的规范形状(Track / Playlist)

两个 Provider 的映射函数(`mapQQSong` / `mapNeteaseSong`,详情见各自文档 §8)产出**同一形状**,是歌词服务、播放器、歌单写入门面与 WS 载荷的公共契约:

| 字段 | 说明 |
|---|---|
| `id` | `qq:<mid>` 或 `netease:<数字id>`(前端展示与去重主键) |
| `source` | `'qq'` / `'netease'` |
| `sourceTrackId` | QQ 为 mid(写入/流解析用),网易云为数字 id |
| `sourceMediaId` | QQ 音频文件 media mid,缺失回退 track mid;网易云缺省空串 |
| `sourceSongId` | **仅 QQ 有意义**:数值 songId(歌词新版接口与歌单写入必填);网易云恒缺省 0 |
| `sourceSongType` | **仅 QQ 有意义**:上游 song type,用于付费音质 vkey 请求;缺失或非法为 0 |
| `sourceAlbumId` | 专辑 mid/id,缺失空串 |
| `title` / `artists[]` / `album` | 清洗后的文本;artists 由 track-contract 限 8 个 |
| `durationMs` | 毫秒,≥ 0(QQ 来自秒字段 ×1000) |
| `coverUrl` | 直链或构造 URL(QQ 见 [qq-provider.md](qq-provider.md) §8.4,网易云见 [netease-provider.md](netease-provider.md) §8.1) |
| `playable` / `vip` | 平台可用性/付费标记(QQ 恒 `playable: true`) |

Playlist 形状:`{ id, source, title, description, coverUrl, trackCount, playCount, creatorUserId, dirId?, tid? }`——`dirId`/`tid` 仅 QQ 有(写入目标与"我喜欢"识别,见 [qq-provider.md](qq-provider.md) §7.12);推荐卡片(`mapRecommendCard`)无 dirId/tid,不可直接写入。
