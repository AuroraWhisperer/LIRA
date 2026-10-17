# 音乐领域服务:注册表、缓存、曲库、队列与歌词状态

> 涉及文件:[provider-registry.js](../../../../src/music/provider-registry.js)、[provider-health.js](../../../../src/music/provider-health.js)、[stream-resolver.js](../../../../src/music/stream-resolver.js)、[track-contract.js](../../../../src/music/track-contract.js)、[music-cache.js](../../../../src/music/music-cache.js)、[lyrics-service.js](../../../../src/music/lyrics-service.js)、[song-service.js](../../../../src/music/song-service.js)、[song-store.js](../../../../src/storage/song-store.js)、[queue-service.js](../../../../src/music/queue-service.js)、[song-matcher.js](../../../../src/music/song-matcher.js)、[random-song-filter.js](../../../../src/music/random-song-filter.js)、[tag-aliases.js](../../../../src/music/tag-aliases.js)、[requester-target-store.js](../../../../src/storage/requester-target-store.js)、[song-import-schema.js](../../../../src/music/song-import-schema.js)、[song-file-codec.js](../../../../src/music/song-file-codec.js)、[lyric-state.js](../../../../src/music/lyric-state.js)、[lyric-timeline.js](../../../../src/music/lyric-timeline.js)

本文档是 `src/music/` 下**非 Provider、非 WeSing** 模块的唯一事实源:模块职责、导出签名、关键算法与常量只在此成表。上游 Provider 逆向工程见 [qq-provider.md](qq-provider.md) / [netease-provider.md](netease-provider.md);全民 K 歌采集见 [wesing.md](wesing.md);HTTP 端点见 [api.md](../api.md)(music-routes / song-routes / queue-routes 节);WebSocket 快照字段与消息见 [ws.md](../ws.md);DB 表结构见 [storage.md](../storage.md);领域装配点见 [server-core.md](../server-core.md) §5。

## 1. 模块地图

| 模块                                       | 职责                                                     | 归属 |
| ------------------------------------------ | -------------------------------------------------------- | ---- |
| provider-registry.js                       | Provider 实例注册表 + 平台归一化                         | §3   |
| provider-health.js                         | 健康检查聚合门面                                         | §3   |
| stream-resolver.js + track-contract.js     | 播放 URL 解析编排与曲目契约                              | §4   |
| music-cache.js                             | API/歌词磁盘缓存(TTL + 容量裁剪)                         | §5   |
| lyrics-service.js                          | 搜索 / 首页 / 歌词 / 匹配 / 歌单写入的门面               | §6   |
| song-service.js + song-field-utils.js      | 曲库业务规则、字段归一化与解析纯函数；SQL 由 song-store.js 持有 | §7   |
| queue-service.js                           | 点歌队列统一语义                                         | §8   |
| song-cooldown.js                           | 歌曲冷却身份、到期计算与用户可读拦截原因                   | §8   |
| song-matcher.js                            | 曲目匹配打分(自动接受阈值)                               | §9   |
| random-song-filter.js + tag-aliases.js     | 随机点歌纯筛选规则与标签别名                             | §10  |
| song-import-schema.js + song-file-codec.js | 导入导出列契约与 CSV/XLSX 编解码                         | §11  |
| requester-target-store.js                  | 随机点歌请求者定位(弹幕机器人用)                         | §12  |
| lyric-state.js / lyric-timeline.js         | 歌词状态/时间轴归一化(WS 载荷生产者)                     | §13  |
| lyric-source-selection.js                 | 按实际播放状态与手动偏好选择歌词输出                     | §13  |
| qq-client-* / netease-client-*            | 外部 QQ / 网易云客户端的只读识别、时钟与歌词采集         | §13  |
| external-client-lyrics.js                 | 外部播放器固定本平台的歌词解析                          | §13  |
| providers/ + lyric-parser.js + wesing-*          | 见各自文档                                               | —    |

## 2. 领域装配(server-core.md §5 的接线详情)

[music-runtime.js](../../../../src/server/music-runtime.js) 的 `buildMusicRuntime` 拥有音乐组件装配，`server.js` 负责接线和生命周期：

| 组件 | 创建与注入 |
| --- | --- |
| `lyricsService` | `createLyricsService({ apiCacheDir: dataDir.apiCacheDir, lyricCacheDir: dataDir.lyricCacheDir })`；路径从 `runtime-config.js` 传入，分别对应 `<data>/cache/music-api-cache`、`<data>/cache/music-lyrics-cache` |
| `musicRegistry` | `createMusicProviderRegistry()`；server 启动时通过 `setMusicRegistry(options.musicAuth || {})` 注入认证适配 |
| `weSingCapture` | `createWeSingCapture({…})`；同一装配模块创建 `createWeSingOnlineLyricResolver({ getRegistry, lyricsService, getPreferences })`，见 [wesing.md](wesing.md) |

物理目录的完整清单只在 [storage.md](../storage.md) §2 维护；计算入口是 [data-paths.js](../../../../src/shared/data-paths.js) 的 `resolveDataPaths`，经 [runtime-config.js](../../../../src/server/runtime-config.js) 传入。旧根目录缓存迁移归 [data-directory-migration.js](../../../../src/storage/data-directory-migration.js) 所有，旧目录不是当前写入位置。

[domain-services.js](../../../../src/server/domain-services.js) 的 `createDomainServices` 创建 SongStore 并产出 `songs`、`queue`；[runtime-api-context.js](../../../../src/server/runtime-api-context.js) 将 `registry` 与 `lyrics` 接入 API context，领域端口分组见 [server-core.md](../server-core.md) §5。

## 3. Provider 注册表与健康检查

### 3.1 provider-registry.js

| 导出                                   | 签名                                    | 行为                                                                                                            | 出处                                                                               |
| -------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `SUPPORTED_MUSIC_PLATFORMS`            | `Set['qq','netease']`                   | 平台白名单                                                                                                      | [provider-registry.js:6](../../../../src/music/provider-registry.js#L6)            |
| `normalizeMusicPlatform`               | `(value) => 'qq'\|'netease'`            | 小写 trim 后校验白名单,否则抛"音乐平台只能是 qq 或 netease。"                                                   | [provider-registry.js:13-19](../../../../src/music/provider-registry.js#L13-L19)   |
| `createMusicProviderRegistry(options)` | 工厂                                    | 见下                                                                                                            | [provider-registry.js:21-57](../../../../src/music/provider-registry.js#L21-L57)   |

`createMusicProviderRegistry({ getAuthState, getCookieHeader })` 返回:

| 方法                                    | 行为                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `get(platform)`                         | 归一化后取实例(不存在的平台抛错)                                                       |
| `list()`                                | 两个 Provider 实例数组                                                                 |
| `healthCheck(platform?)`                | 传平台只查单个;不传 `Promise.all` 并发查全部                                           |
| `getHealthyFallback(preferredPlatform)` | 并发健康检查,返回**第一个 ok 且非首选平台**的 Provider(返回原始健康对象);全挂返回 null |

两个真实 Provider 都注入同一对 `getAuthState` / `getCookieHeader`,Cookie 与登录态来源见 [auth.md](../../desktop/auth.md)。

### 3.2 provider-health.js

`getMusicProviderHealth(registry, platform)`([provider-health.js:7-10](../../../../src/music/provider-health.js#L7-L10)):仅转发到 `registry.healthCheck`(有 platform 先归一化),是 `/api/music/health` 的处理核心(见 [api.md](../api.md) 的 music-routes 节)。

## 4. 流解析编排(stream-resolver.js + track-contract.js)

QQ 加密媒体由 `qq-encrypted-stream.js` 通过 Node `pipeline` 解密并写入响应，传递下游背压；客户端中断或响应提前关闭会中止上游 fetch。等待响应头和等待上游下一块数据各有 30 秒期限，期限只包围主动读取，不计入下游背压；超时会取消上游并返回/断开响应。响应头和实际累计字节均受 64 MiB 上限约束，超过实际额度时断开已开始的响应；拒绝、取消和完成路径均释放响应体及 QMC2 实例。

Provider 内部实现见各 Provider 文档 §7.2;这里只记录编排层语义。

### 4.1 normalizeMusicTrackForProvider(track-contract.js)

[track-contract.js:6-37](../../../../src/music/track-contract.js#L6-L37):Provider 入参的唯一清洗点,违反即抛错:

| 字段                                                                  | 规则                                            |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| `id` / `sourceTrackId` / `title`                                      | `cleanText` 后**必填**,缺失抛"歌曲信息不完整。" |
| `source`                                                              | `normalizeMusicPlatform` 归一                   |
| `artists`                                                             | 清洗过滤后 **`slice(0, 8)` 最多 8 位**          |
| `sourceSongId`                                                        | `max(0, Number(sourceSongId                     |     | songId))` — 非数值置 0 |
| `sourceSongType`                                                      | 安全非负整数;兼容读取 `songType`,缺失或非法置 0 |
| `playable` / `vip`                                                    | 仅显式 `false` / `true` 生效                    |
| 其余(`album`/`durationMs`/`coverUrl`/`sourceMediaId`/`sourceAlbumId`) | 归一化容错                                      |

### 4.2 resolveMusicStream(stream-resolver.js)

[stream-resolver.js:7-13](../../../../src/music/stream-resolver.js#L7-L13):

```
1. normalizedTrack = normalizeMusicTrackForProvider(track)
2. provider = registry.get(normalizedTrack.source)
3. return provider.resolvePlayableUrl(normalizedTrack, { forceRefresh, quality })
```

- **TTL**：QQ 流由 [qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js) 管理，默认有效期 5 分钟；网易云 [resolvePlayableUrl](../../../../src/music/providers/netease-provider.js) 每次请求原生 player URL 接口，使用返回的 `expi`，缺失时才回退 5 分钟，并保留试听/权限结果。`forceRefresh` 从调用链传入，不应据此推断所有 Provider 都有相同的缓存策略。
- 本模块自身**不做磁盘缓存**(流 URL 短命,缓存无意义);歌词与首页内容缓存见 §5

## 5. 音乐缓存(music-cache.js)

磁盘 JSON 缓存,两目录两 TTL([storage.md](../storage.md) §2 有目录布局):

| 常量                       | 值                                | 用途         | 出处                                                          |
| -------------------------- | --------------------------------- | ------------ | ------------------------------------------------------------- |
| `MUSIC_API_CACHE_TTL_MS`   | `5 * 60 * 1000`(5 分钟)           | 首页内容缓存 | [music-cache.js:9](../../../../src/music/music-cache.js#L9)   |
| `MUSIC_LYRIC_CACHE_TTL_MS` | `30 * 24 * 60 * 60 * 1000`(30 天) | 歌词缓存     | [music-cache.js:10](../../../../src/music/music-cache.js#L10) |
| API 目录容量上限           | 50 MB                             | 写缓存后裁剪 | [music-cache.js:36](../../../../src/music/music-cache.js#L36) |
| 歌词目录容量上限           | 300 MB                            | 同上         | 同上                                                          |

| 函数                                   | 行为                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `musicCacheKey(scope, payload)`        | `sha1(<scope>:<JSON.stringify(payload)>)` 十六进制([music-cache.js:12-16](../../../../src/music/music-cache.js#L12-L16))                                          |
| `readMusicJsonCache(dir, key, ttlMs)`  | 读 `<key>.json`;`mtimeMs` 超 TTL 视为未命中;文件为 `{savedAt, data}` 信封,返回 `data`([music-cache.js:18-27](../../../../src/music/music-cache.js#L18-L27))       |
| `writeMusicJsonCache(dir, key, data)`  | 写信封后扫描目录统计精确容量；仅超额时按 mtime 排序并从旧到新删除(**缓存失败绝不影响播放**,全 try/catch 吞掉)([music-cache.js:29-38](../../../../src/music/music-cache.js#L29-L38)) |
| `clearMusicCache(apiDir, lyricDir)`    | 删两目录重建,返回 `{clearedBytes, clearedFiles, after}`([music-cache.js:66-77](../../../../src/music/music-cache.js#L66-L77))                                     |
| `getMusicCacheStats(apiDir, lyricDir)` | `{api, lyrics, totalBytes, totalFiles}`([music-cache.js:79-86](../../../../src/music/music-cache.js#L79-L86))                                                     |

## 6. 歌词与音乐搜索服务(lyrics-service.js)

### 6.1 工厂与门面

`createLyricsService({ apiCacheDir, lyricCacheDir })`([lyrics-service.js:17-34](../../../../src/music/lyrics-service.js#L17-L34))返回门面对象;文件底部另有模块级兼容单例 `compatibilityService` 与 `initLyricsService(apiDir, lyricDir)` 重配([lyrics-service.js:15,36-42](../../../../src/music/lyrics-service.js#L15-L42))。常量与 music-cache.js 同名同值([lyrics-service.js:12-13](../../../../src/music/lyrics-service.js#L12-L13))。

| 门面方法                                              | 行为                                                                                                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchMusicTracks(registry, body)`                   | 平台缺省 `netease`;关键词取 `keyword/query/songName`,**截 120 字符**,空抛错;`limit` clamp 1-30 默认 20;返回 `{source, keyword, tracks}`([lyrics-service.js:44-55](../../../../src/music/lyrics-service.js#L44-L55))               |
| `getMusicHomeContent(registry, body)`                 | 首页内容(带缓存),见 §6.2                                                                                                                                                                                                          |
| `getMusicTrackLyrics(registry, body)`                 | 歌词(带缓存),见 §6.3                                                                                                                                                                                                              |
| `parseLyricPayload(body)`                             | 纯文本歌词解析:`lyric/translation/wordLyric(yrc)/roma` 各**截 512 KB**,`cleanTextPreserveLines` 保换行,喂 `parseLyricResult`;供前端直接粘贴歌词用([lyrics-service.js:150-156](../../../../src/music/lyrics-service.js#L150-L156)) |
| `matchMusicTrackCandidates(body)`                     | 匹配打分入口:`songName` 截 120 必填、`artist` 截 80、`durationMs`;candidates 截 50;`threshold: 70` 硬编码;返回 `{request, threshold, results}`([lyrics-service.js:158-171](../../../../src/music/lyrics-service.js#L158-L171))    |
| `writeMusicPlaylistTracks(registry, body, operation)` | 歌单写入门面,见 §6.4                                                                                                                                                                                                              |
| `normalizeMusicTrackForProvider`                      | 透传 §4.1                                                                                                                                                                                                                         |

### 6.2 首页内容(`getMusicHomeContentWithCache`,[lyrics-service.js:62-113](../../../../src/music/lyrics-service.js#L62-L113))

`action` 八选一:

| action                | 行为                                                          | 缓存                                                                                           |
| --------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `personalized`        | 推荐歌单,`limit` 转发时截 30,带 `page`                        | **缓存**(key 含 platform/action/limit/playlistId,**page 不入 key**,故 `page > 1` 必须绕过缓存) |
| `playlist-tracks`     | 歌单详情,`playlistId` 必填                                    | **不缓存**，直接读取 Provider；由播放器内容缓存及后台刷新负责                                                                       |
| `daily`               | 每日推荐                                                      | **不缓存**——注释:radio/daily 的重点是每次给新歌,缓存会让它们永远返回同一批                     |
| `radio`               | 电台                                                          | 不缓存                                                                                         |
| `liked`               | 我喜欢                                                        | 不缓存                                                                                         |
| `created-playlists`   | 我的歌单;`body.track` 存在时并发标注 `containsTrack`(见 §6.5) | 不缓存                                                                                         |
| `collected-playlists` | 收藏歌单                                                      | 不缓存                                                                                         |
| `recent`              | 最近播放                                                      | 不缓存                                                                                         |
| 其他                  | 抛"未知音乐首页动作。"                                        | —                                                                                              |

缓存规则:仅 `personalized` 可缓存;`refresh === true` 或 `page > 1` **绕过缓存**;命中时返回 `{...cached, cached: true}`。`limit` clamp 1-5000 默认 100,`offset` ≥ 0,`page` clamp 1-50。

### 6.3 歌词(`getMusicTrackLyricsWithCache`,[lyrics-service.js:119-129](../../../../src/music/lyrics-service.js#L119-L129))

- 入参先过 `normalizeMusicTrackForProvider`(强制完整契约)
- 缓存 key:`musicCacheKey(version, { source, sourceTrackId })`；网易云使用 `lyrics-v6`，QQ 保持 `lyrics-v5`。版本前缀参与 hash，旧网易云无逐字缓存不会压制新解析结果。
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

| 函数                                       | 行为                                                                                                                                                                                                                                                                                    | 出处                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `saveSong(store, input)`                   | **upsert 语义**:有 `input.id` 走 UPDATE(不存在抛"歌曲不存在",UNIQUE 冲突翻译成"歌曲名称和艺术家与已有歌曲重复");无 id 时先按 `(name, artist)` 精确查重,存在则 UPDATE 其余字段,否则 INSERT。`name` 必填;分类缺省"默认"(`ensureCategory`);`name_pinyin = name_initial = getInitial(name)` | [song-service.js](../../../../src/music/song-service.js) |
| `listSongs(store, filters)`                | store 保留关键词/分类的 SQL LIKE 语义，将分类候选以 OR 组合后与其他条件取交集；领域层做语言/歌手完整字段及任一完整 tag 匹配，再按 `name_initial` + `name`(`zh-Hans-CN-u-co-pinyin`) 稳定排序并布尔化 `is_enabled` | [song-service.js](../../../../src/music/song-service.js) |
| `findSong(store, songName, artist?)`       | 有 artist 先精确 `(name, artist)`;否则按 name 取 `updated_at` 最新;仅启用歌曲 | [song-service.js](../../../../src/music/song-service.js) |
| `findUniqueSongNameMatch(store, songName)` | 精确失败后由 store 执行转义 LIKE `%name%`,**恰好 1 条才返回**(模糊匹配拒绝猜测) | [song-service.js](../../../../src/music/song-service.js) |
| `deleteSong` / `toggleSong` / `countSongs` | 委托 store 的单曲写操作(删除时在同一事务解除 queue/request 引用);切换启用返回 `{ok}`;总数 | [song-service.js](../../../../src/music/song-service.js) |

### 7.2 分类与标签

快照通过 `domainServices.songs.getMetadata()` 读取分类、标签和歌曲总数。`song-metadata.js` 按 SongStore 的 `getChangeToken()` 缓存这些查询结果；令牌组合本连接 `total_changes()` 与 `PRAGMA data_version`，同时识别其他 store 的写入、批量导入、清库及其他数据库连接提交。失效粒度为整个 songDb，非歌库写入也可能触发一次重读；无库变更的礼物快照复用结果。缓存只用于提交后的快照读取，不保存 SQLite statement 或原始行到跨层接口。

- `listCategories`:`sort_order ASC, name` 排序,`is_enabled` 布尔化(store 查询)
- `ensureCategory(name)`:`INSERT OR 返回` 语义,新建时 `sort_order=0, is_enabled=1`(store 原子写入)
- `listTags`:领域层扫描 store 提供的非空 tags，使用共用字段解析器切分去重，`zh-Hans-CN` 排序
- `splitSongTags`:兼容全/半角逗号、顿号、分号和竖线；语言字段统一支持全角斜杠。歌手字段保留显式兼容模式：库筛选兼容逗号分隔导入，随机请求保留歌手名内的逗号，不把合法姓名拆碎。

### 7.3 导入(importSongs,[song-service.js](../../../../src/music/song-service.js))

旧 JSON/XLSX 导入现在也遵守最终完整歌库容量约束，去重与超限原子拒绝由 [SongStore](../storage.md) 拥有；失败不广播或请求云同步。旧入口没有额外限制重复原始行数量，显式更新导入的输入行限制仍按其独立契约执行。

- `normalizeImportedSongRow` 与空歌名/云快照校验由领域层负责(§11);`store.importRows` 将有效行与 `import_batches` 写入同一事务,失败 `ROLLBACK`
- 逐行:价格别名冲突或名空计 failed，`failures` 返回数据行序号与原因 → `(name, artist)` 重复计 duplicate 跳过（不更新已有价格/歌切） → 新分类计数 → INSERT;`store.replaceAll` 负责清空并解除历史引用后原子写入云快照
- 结束写 `import_batches` 批次记录;返回 `{total, inserted, duplicate, failed, createdCategories, failures}`

云端快照与表格导入是不同契约：上传边界 [mapSongForSync](../../../../src/electron/license/license-response-utils.js) 将本地 `name`/`is_enabled` 等字段映射为唯一的网络 `title`/`enabled` 等 camelCase 字段；下载由 `replaceCloudSongs` 将 canonical 字段映射回本地模型。网络不发送重复别名，本地 SQLite 列名、CRUD 输入及 §11 的表格导入别名继续使用各自契约。跨端字段与配套升级要求见 [歌曲同步规格](../../../../specs/cloud-authoritative-streamer-sync_design.md)。

表格预览和应用由 [song-import-update.js](../../../../src/music/song-import-update.js) 的 `previewSongImport(store,input)` / `applySongImport(store,input)` 拥有。按清洗后的歌名加歌手精确匹配，包含停用歌曲。管理页固定传 `replaceAll: true`，完整覆盖匹配歌曲的所有导入字段并删除表格中未列出的旧歌曲；文本空白/缺列清空、分类默认为「默认」、是否可点默认为是。不传替换选项的旧调用仅新增和更新，不删除无关记录。兼容更新的缺列保留、空默认保留；显式 `allowEmptyClear` 仅清空存在列的文本，分类空变默认，启用空保留。非空启用值必须明确，价格新值超过 1000 UTF-16 code unit 无效。

预览给新增/更新/未改变/冲突/无效计数，替换时额外给删除计数和删除明细（row 为 null）；同身份同指定内容重复折叠，不同内容的全组冲突，任何冲突或无效禁止整批提交。预览 token 绑定完整歌曲（含更新时间）、全部分类与输入/空值/替换选项；提交委托 `store.applyImportUpdate(buildPlan)` 在事务内重算并检查，避免预览后歌曲/分类变化时覆盖编辑。通过后一次事务写入，失败全部回滚，匹配歌曲保持原 song id；删除仅解除队列和历史的歌曲关联，保留其文本快照。替换以最终表格计容量，允许将超限旧库缩减至 5000 首以内；空表仍拒绝。详细 API 和错误见 [API 歌库域](../api.md)。

### 7.4 随机选歌(pickRandomSong,[song-service.js](../../../../src/music/song-service.js))

1. store 只取 `is_enabled=1` 的全量行 + 分类启用标记,组合筛选交给纯模块 `filterRandomSongCandidates`(§10)
2. store 提供最近 10 次 `source = 'random' 或 'random:%'` 的点歌流水歌名(`requests` 表),领域层排除它们——避免随机重复刚点过的歌
3. 排除后为空则回退全池;`randomSourceValue(scopeText)` 生成 `source = 'random'` 或 `random:<scope>`(弹幕机器人据此定位请求者,见 §12)

`describeRandomSongScope`(导出名映射到库版,[song-service.js](../../../../src/music/song-service.js)):同样的数据源调 `describeRandomSongScope`(§10),供"随机点歌说明"用。`normalizeRandomScopeText` 会剥掉前导 `+＋:：-—` 符号。

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

`current` 是历史遗留态,`ensureUnifiedQueue`([queue-service.js](../../../../src/music/queue-service.js))在启动/清库修复时把它归位为 `waiting`。

### 8.2 addQueueItem(context, input)([queue-service.js](../../../../src/music/queue-service.js))

校验链(顺序即语义):

1. `songName` 必填
2. **观众资格**：仅内部入口标记 `viewerRequest: true` 时由 [song-request-policy.js](../../../../src/music/song-request-policy.js) 检查有效 UID 黑名单、配额所需身份、大航海与粉丝牌门槛。默认均不限，已过期名单忽略；名单启用但无法核验 UID 时拒绝，不能把 `open_id` 当 UID。粉丝牌与大航海分别依赖当前房间已核验证据；免牌只豁免粉丝牌，不豁免大航海门槛。
3. **队列上限**:`queueLimit` 设置(defaults 兜底),统计 `status IN ('current','waiting')` 的活跃数,满则抛"点歌队列已达到上限。"
4. **曲库校验**:`onlyFromLibrary === 'true'` 且 `findSong` 未命中 → 抛"歌库里没有这首歌。"
5. **单首歌曲冷却**：按匹配后的规范歌名＋歌手（NFKC、小写、空白清洗）与当前账号 scope 检查最近成功入队时间；小时为滚动时长，自然日按北京时间零点加设定天数计算。未到期抛 `SONG_COOLDOWN`，带用户可读原因和 `availableAt`。
6. **重复检查**:`allowDuplicate !== 'true'` 时,活跃队列内同名(仅 song_name)即抛"队列里已经有这首歌。"

每人同时排队上限在 `queue-store.insertRequest` 的 `BEGIN IMMEDIATE` 事务内检查，以 `requests.identity_type` 与 `queue.requester_uid` 统计活跃队列，包含 LIVE；改昵称不释放配额，完成、删除、跳过与清空后释放，重启仍从已存队列统计。超限抛 `USER_QUEUE_FULL`，不写入流水、歌曲冷却或队列。资格与配额同样约束普通弹幕、随机点歌（含桌面随机按钮）及 SC；SC 置顶不豁免，歌库手动入队保留管理员能力。保存新规则不删除已有队列。

分身份用户间隔由同一 policy 根据本直播间已核验的大航海身份选择；空串沿用 `userCooldownSeconds`，0 明确不限制。弹幕桥在入队前检查、成功后记录既有冷却 store；普通 UID 与 `open_id` 使用独立键，开启间隔却缺稳定身份时拒绝。

冷却使用实际入队时刻，不能使用上游消息时间。存储事务内再次检查，并将最近成功入队时间与队列、流水原子写入；失败或冷却拦截不更新时间。关闭规则期间也记录成功时间，改规则据此重新计算。完成、跳过、删除、清空队列及重启保留记录；升级前流水不回填冷却。账号 scope 来自组合根，客户端输入不能选择冷却归属。

空歌名、队列满、仅歌库拒绝、重复与冷却由队列 owner 标记稳定业务 code（见 [HTTP 队列契约](../api.md)）。手动与随机入口统一映射为 400；弹幕桥返回 `accepted:false`、`code`、`reason`，仅在既有 `enableRandomTagReply` 开启时生成 @ 原请求者的提示，不更新成功点歌冷却、不写入请求。

入队(与 `requests` 流水及 `song_cooldowns` **同事务**):`song_id`/`song_name`/`artist`/`category_name` 在命中曲库时用曲库规范值;`requester_name` 缺省"观众";`source` 缺省 `admin`;`status = 'waiting'`;`is_pinned` 时 `pinned_at = createdAt`。返回 `normalizeQueueRow`(布尔化 `is_pinned` / `is_live`、归一 guard/medal)。

### 8.3 handleQueueAction(context, action, rawId)([queue-service.js](../../../../src/music/queue-service.js))

| action          | 行为                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `next`          | 按下述统一顺序完成队首；无活跃项则空转 |
| `clear`         | 全部活跃项 → `deleted`                                                                                     |
| `pin` / `unpin` | 置位并更新 `pinned_at` / 清空；连续置顶时间至少递增 1ms，最近置顶最靠前                                                                      |
| `live` / `unlive` | 仅允许当前队首切换 `is_live`；ID 非正整数或队首已变化时拒绝，HTTP 返回 409 `QUEUE_LIVE_NOT_FIRST` |
| `delete`        | → `deleted`                                                                                                |
| `done`          | → `done`                                                                                                   |
| `skip`          | → `skipped`                                                                                                |
| 其他            | 抛"未知队列操作。"                                                                                         |

排序统一为：LIVE → 手动置顶（最近置顶优先）→ 开启 `guardPriorityEnabled` 时按点歌入队携带的总督(1)、提督(2)、舰长(3)、非大航海(0) → 原创建时间和 ID。默认关闭身份优先；开关保存立即作用于已有队列。LIVE 是手动标记，最多一首，独立于 `status`；不触发播放器。完成、删除、跳过、清空移除该项，不自动标记下一首。

### 8.4 快照与重启恢复

- `getQueueSnapshot`([queue-service.js](../../../../src/music/queue-service.js)):返回 **`{ current: null, waiting: [...] }`**——`current` 恒为 null,前端自行消费(与 WS 快照 `queue` 字段一一对应,见 [ws.md](../ws.md) §2);waiting 排序同 `next`,并 LEFT JOIN `requests.message AS request_message`
- 启动调用 `ensureUnifiedQueue`([queue-service.js](../../../../src/music/queue-service.js))，仅将历史 `current` 态归位为 `waiting`；未完成点歌的 ID、内容、时间、LIVE 与置顶标记保留，已完成/删除/跳过的项不恢复。只有显式完成或清空操作改变相应状态（调用点见 [server-core.md](../server-core.md) §5 启动修复链）。

## 9. 歌曲匹配(song-matcher.js)

**打分模型**,弹幕点歌智能匹配与 WeSing 在线兜底共用(见 [wesing.md](wesing.md) §7)。

| 常数                | 值  | 出处                                                          |
| ------------------- | --- | ------------------------------------------------------------- |
| `AUTO_ACCEPT_SCORE` | 70  | [song-matcher.js:3](../../../../src/music/song-matcher.js#L3) |

`scoreTrackMatch(request, candidate)`([song-matcher.js:12-53](../../../../src/music/song-matcher.js#L12-L53))加分项:

| 条件                                                                           | 加分 |
| ------------------------------------------------------------------------------ | ---- |
| `track.title === request.songName` 完全一致                                    | +60  |
| 任一 artist 与请求 artist 完全一致                                             | +25  |
| 清洗后标题一致但原文不同(`cleanTitle === cleanSongName && title !== songName`) | +15  |
| 双 durationMs > 0 且差 ≤ 5000ms                                                | +10  |
| 有专辑信息且专辑不含惩罚词                                                     | +5   |

惩罚项(`penaltyRules`,[song-matcher.js:85-94](../../../../src/music/song-matcher.js#L85-L94)),作用于 `title + album` 小写文本:

| 关键词                                  | 扣分 |
| --------------------------------------- | ---- |
| `live\|现场\|演唱会`                    | -15  |
| `dj\|remix\|混音\|电音`                 | -25  |
| `伴奏\|纯音乐\|instrumental`            | -30  |
| `翻唱\|cover`                           | -20  |
| `加速\|慢速\|speed up\|sped up\|slowed` | -20  |

`rankTrackCandidates` 按分数降序、同分按标题字典序;`normalizeSongKey` 剥括号内容与全部标点空白([song-matcher.js](../../../../src/music/song-matcher.js))。`normalizeCandidate` 兼容 `artists[]` 与 `artist` 按 `/` 切分，并保留同一候选的 Provider 标识、封面及权益字段；评分不会丢失 QQ 的 `sourceSongId/sourceMediaId/sourceSongType` 等播放与歌单元数据。

## 10. 随机点歌筛选(random-song-filter.js + tag-aliases.js)

随机抽取在已有条件匹配后通过 `queueService.filterSongsByCooldown` 排除冷却项，再应用既有最近随机歌曲避让。条件无匹配仍返回空；有匹配但全部冷却抛 `SONG_COOLDOWN`，点歌桥生成专门回复。最终入队仍校验冷却。

### 10.1 词法

- `parseRandomSongTerms(scopeText)`:`+`(全/半角)分隔为 AND 条件,空片段忽略([random-song-filter.js:30-35](../../../../src/music/random-song-filter.js#L30-L35))
- `filterRandomSongCandidates(songs, scopeText)`:**每个词必须命中同一首歌**(不是多首歌各满足一条)([random-song-filter.js:41-45](../../../../src/music/random-song-filter.js#L41-L45))
- `songMatchesScopeTerm`([random-song-filter.js:61-66](../../../../src/music/random-song-filter.js#L61-L66)):先整词匹配;未中且词含空格时按空格拆 AND——兼容 `"说唱 苦情"` 直接输入,同时保留 `"A1 TRIP"` 这类带空格的完整歌手名
- `describeRandomSongScope`:`{ terms, unmatchedTerms, hasCandidates }`

### 10.2 单条件命中(`songMatchesTerm`,[random-song-filter.js:68-85](../../../../src/music/random-song-filter.js#L68-L85))

四路 OR:

| 维度 | 匹配方式                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 歌手 | 整串或按 `/\s*(?:\/                                                                                                                                                                                                                                  | &                                                            | ＆)\s*/`切分后逐段`normalizeComparable` 相等 |
| 语言 | `randomLanguageAliases(term)` 命中组内任一别名(`LANGUAGE_ALIAS_GROUPS`:[random-song-filter.js:8-14](../../../../src/music/random-song-filter.js#L8-L14):日语/韩语/英语/粤语/国语组,含 ja/jp/ko/en/chinese 等码),歌曲 language 按 `/、，,` 切分后比对 |
| 分类 | 歌曲分类启用(`category_is_enabled !== 0`)且 `randomCategoryAliases` 命中(`CATEGORY_ALIAS_GROUPS`:[random-song-filter.js:16-24](../../../../src/music/random-song-filter.js#L16-L24):流行/R&B/说唱/摇滚/民谣/舞曲/影视原声)                           |
| 标签 | `splitSongTags`(分隔符 `[,，、;；                                                                                                                                                                                                                    | ]`,**整项匹配**避免"情"误中"抒情")逐项过 `matchesLibraryTag` |

### 10.3 标签别名(tag-aliases.js)

`LIBRARY_TAG_ALIASES`([tag-aliases.js:4-12](../../../../src/music/tag-aliases.js#L4-L12)):观众叫法 → 歌库标准标签单向映射(抒情/治愈/怀旧/国风/小甜歌/影视OST/K-Pop)。`matchesLibraryTag(libraryTag, viewerTerm)`([tag-aliases.js:25-31](../../../../src/music/tag-aliases.js#L25-L31)):先原样相等,再查 `LIBRARY_TAG_BY_VIEWER_ALIAS`(构建时把每个别名归一化映射到标准标签);**不反向展开**——歌库里的非标准标签不会因观众输入标准词而被扩展命中。归一化 = 压缩空白 + `toLocaleLowerCase('zh-Hans-CN')`。

## 11. 导入导出契约(song-import-schema.js + song-file-codec.js)

### 11.1 列契约(song-import-schema.js)

`SONG_EXPORT_HEADERS` 10 列([song-import-schema.js:5-16](../../../../src/music/song-import-schema.js#L5-L16)):`歌曲名字 / 原唱/首发歌手 / 歌曲分类 / 歌曲标签 / 是否可点 / 语言 / 点歌价格 / 歌切 / 核对平台 / 核对备注`。`点歌价格` 是自由文本说明，例如 `免费 / 心动 / 30元SC / 舰长 / 冠歌`;`歌切` 是可放链接、BV 号、时间点或其他说明的自由文本。两列均不参与点歌资格或排序判断。

下载模板使用 `SONG_TEMPLATE_HEADERS`，只将标签列表头改为 `歌曲标签（如：怀旧、抒情、治愈）`；其余列名与顺序沿用导出表头。CSV/XLSX 模板仅含表头，不含示例歌曲。XLSX 标签列加宽以容纳提示。后端导入和前端 CSV/TSV/粘贴解析均接受该表头别名，普通歌库导出的表头不变。

`SONG_IMPORT_ALIASES` 每字段维护中英文别名([song-import-schema.js](../../../../src/music/song-import-schema.js));`requestPrice` 接受 `requestPrice / request_price / 点歌价格 / 点歌价 / 点歌门槛 / 点歌要求 / 点歌条件 / 点歌说明`;`songClip` 接受 `songClip / song_clip / 歌切 / 歌切链接 / 歌曲切片 / 切片链接`。价格所有非空别名经文本规范化后必须相同，否则该数据行失败；其他字段的 `firstValue` 仍按别名顺序取首个非空，布尔 `false` 和数值 `0` 不当作缺值。`parseEnabled` 识别 `是/可点/启用/true/yes/y/1` 与反向集，原生 `false/0` 与字符串 `false/0` 均表示停用，空值或未识别值回退默认值。`normalizeImportedSongRow` 产出清洗后的行,分类缺省"默认"，点歌价格与歌切均缺省空字符串。

按 [点歌资料规范](../../../../specs/song-request-metadata.md)，价格和歌切在导入、保存中使用 `cleanTextPreserveLines`，保留内部空格和换行，统一 CRLF、去除控制字符及首尾空白；价格数值 0 变为文本 `0`。显式升级原先的空白折叠和价格首别名规则，其余字段不变。普通保存省略价格/歌切保留旧值，显式空字符串清空。

### 11.2 编解码(song-file-codec.js)

| 函数                         | 行为                                                                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseSongsFromXlsx(buffer, options?)` | 零依赖 ZIP 解析(`readZipFiles`):定位 `xl/worksheets/sheet\d+.xml`、读 `sharedStrings.xml`、`parseWorksheetXml`;表头检测 = 任一行单元格命中别名;默认新增模式无表头按导出列序解析、丢弃空歌名行；`preserveMissing:true` 预览导入保留无歌名的非空行交由预览报无效，保留缺列语义且无表头要求完整十列。 |
| `buildSongsCsv(rows, options?)` | 表头 + `csvCell` 转义逐行；`template:true` 使用模板表头，下载模板传入空 rows |
| `buildSongsWorkbook(rows, options?)` | 手工拼 xlsx(inlineStr 单元格 + 6 个 zip 条目,含 workbook/styles/rels)；`template:true` 使用模板表头及标签列宽，下载模板传入空 rows |
| `songToExportRow(song)`      | 行映射(分类缺省"默认"、`is_enabled` → 是/否、`request_price` → 点歌价格、`song_clip` → 歌切，`source_platform` → 核对平台保存值；阶段 4 显式替代空值规则) |

`parseSongsFromXlsx(buffer,{preserveMissing:true})` 用于替换及兼容更新预览：保留无歌名的非空数据行供预览报无效，表头缺列不补为默认字段，无表头必须完整十列；默认新增解析行为不变。

前端 [song-import-parser.js](../../../../public/js/admin/song-import-parser.js) 按首条有内容的逻辑记录中引号外的 Tab 识别 TSV，否则按 CSV 解析；引号内的 Tab、换行和转义双引号不改变格式判断，支持本程序导出的价格与歌切文本重新导入。

## 12. 请求者定位(storage/requester-target-store.js)

`createRequesterTargetStore(songDb).getLatestRandomRequester()`([requester-target-store.js:5-25](../../../../src/storage/requester-target-store.js#L5-L25)):查 `requests` 表最近一条 `source='random' 或 'random:%'` 且 uid 或 name 非空的行,返回 `{uid, name, source, createdAt}`;供弹幕机器人把随机点歌结果回复给触发者(见 [bilibili/danmaku.md](../bilibili/danmaku.md))。

## 13. 歌词状态与时间轴(lyric-state.js / lyric-timeline.js)

`music-runtime` 分别保存内置播放器、外部 QQ、外部网易云和全民 K 歌的候选状态与完整时间轴。`selection` 是跟随偏好（`auto / internal / qq-client / netease-client / wesing`），`source` 是当前实际输出来源（不含 auto）。候选的 `playing` 取实际播放状态，不以歌词已加载为前提；未选中的播放器仍持续更新候选。只有实际输出来源向歌词窗口、预览与浏览器源广播，切换时立即发布该来源已缓存的完整时间轴和状态。

时间轴入口归一化并整体替换候选对象；运行时记住最近已比较的引用，单纯时钟/播放状态更新不重复序列化整首歌词。同内容的新对象仍经内容比较并记入缓存，实际歌词变化正常发布；切换来源强制发布时间轴并推进广播代际，即使两端歌词内容相同也不省略。采集和状态广播频率保持原样。

[lyric-source-selection.js](../../../../src/music/lyric-source-selection.js) 拥有智能播放的选择规则：

- 只有一个来源正在播放时，跟随该来源，包括用户此前选了其他来源的情况。
- 多个来源同时播放时，优先使用正在播放的手动所选来源；否则保持仍在播放的当前来源；再按 `internal → qq-client → netease-client → wesing` 选择。
- 没有来源播放时，保留手动所选来源的等待或暂停状态；智能播放优先保留有曲目的当前来源，再按上述顺序选有曲目的来源，全部不可用时回到 internal。

偏好不持久化，服务重启默认 `selection: 'auto'`，初始 `source: 'internal'`。`selectLyricSource` 只修改偏好，不启停采集或控制音频。Electron 主进程显式传入 `nativeMusicCapture: true`，`server.js` 在音乐注册表就绪后调用 `musicRuntime.start()`，独立启动所有受支持的采集器；独立 server / 测试默认不启动原生采集，可显式启用。服务退出统一停止采集。旧 WeSing active 接口的 true 会确保 WeSing 已启用并设置 wesing 偏好；false 仅在当前偏好为 wesing 时恢复 auto，持续检测保留。

内置 HTTP 的输入 `generation/sequence` 门槛与广播的全局版本分别维护。内置时间轴变化推进输入代际，并立即缓存新曲的加载状态，清空进度和歌词，防止旧曲状态继续输出；匹配的新状态到达前保留候选最后的实际播放标志，空曲目则明确清除该标志。过时状态不覆盖候选，响应返回最后接受的内置状态及 `nextGeneration = max(内置门槛, 广播代际) + 1`，只供发送端恢复。当前输出的时间轴改变或来源切换时，广播代际递增并重置 sequence；当前状态广播递增 sequence。外部来源输出期间仍接受有效内置候选，输入版本不会被其他播放器的状态误判为旧包；`nextGeneration` 不进入快照或 WS 广播。

管理状态 `lyricSource` 为 `{source, selection, playingSources, qqClient, neteaseClient, weSing}`；`playingSources` 使用上述来源顺序，仅列实际正在播放的来源。`qqClient` / `neteaseClient` 共有字段为 `active / supported / detected / status / message / trackTitle / artists / currentMs / durationMs / playing / lyricSource`；其中 `lyricSource` 表示实际歌词平台（qq、netease 或空），区别于顶层输出来源。WeSing 字段由 [wesing.md](wesing.md) 维护。完整采集诊断仅向 Admin 提供。

### 13.1 归一化规则(共同)

两个模块是 WS `lyric-state` / `lyric-timeline` 载荷的唯一**归一化**入口,上游原始输入一律先过这里再进快照(WS 契约见 [ws.md](../ws.md) §2/§3):

- 状态枚举 **`idle` / `loading` / `ready` / `empty`**,非法值落 `idle`([lyric-state.js:7-9](../../../../src/music/lyric-state.js#L7-L9)、[lyric-timeline.js:9-11](../../../../src/music/lyric-timeline.js#L9-L11))
- 控制字符(0x00-0x1F、0x7F)替换为空格;`trackTitle` 截 120、`artists` 每项截 80 且最多 8 个、`lineText`/`translation` 截 240
- 时间一律 `clampNumber` 到 `[0, MAX_TIME_MS = 24h]`;`progress` clamp 到 `[0, 1]`
- 逐字词:当前句状态与时间轴每行共用 `lyric-normalization.js` 的 `normalizeLyricWords`，最多 120 个，`text` 截 40 且保留有意义的空格，`endMs` 下限取 `startMs`。

上述文本上限按 UTF-16 码元计算；截断恰好落在代理对中间时退回一个码元，避免发布半个字符。完整时间轴中的文本、翻译与罗马音沿用相同规则，长度预算不改为字素数量。

### 13.2 差异

| 模块                     | 特有规则                                                                                                                                                       | 出处                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `normalizeLyricState`    | 单行语义:`currentMs`/`durationMs`/`progress`/`playing`/`playbackRate`/`locked`/`words[]`;`playbackRate` 接受有限正数并限制为 0.5–2，缺失或非法时为 1；位置仍为歌曲毫秒坐标，速率用于客户端时钟与动画推进。兼容版本字段 `generation`/`sequence` 用于客户端拒绝旧状态回灌 | [lyric-state.js](../../../../src/music/lyric-state.js) |
| `normalizeLyricTimeline` | 全曲语义:**`MAX_LINES = 500` 行上限 + `MAX_TEXT_BUDGET = 48 KB` 文本预算**(按 `text+translation+roma` 长度累计,超预算即截断后续行);输入行按 `startMs` 稳定排序。每行可选 `words: [{text,startMs,endMs}]` 预载逐字时间，词数组 JSON 的 UTF-8 总预算 512 KiB；超预算的行仅省略 `words`，保留全文并回退当前句状态。 | [lyric-timeline.js](../../../../src/music/lyric-timeline.js) |

内置、QQ、网易云和 WeSing 的完整时间轴均经过同一归一化入口。管理页快照和增量消息保留上述逐字时间；歌词浏览器源的 `overlay-projection` 对快照及 `lyric-timeline` 均仅允许词文本、起止时间，未知嵌套字段仍剔除。旧时间轴不带 `words` 时继续使用 `lyricState.words`；新增字段不改变消息类型、权限或持久化。

### 13.3 生产者

| 载荷                                                | 生产者                                                                                                                        | 广播点                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `lyricState`（快照与 `lyric-state` 消息） | 内置 HTTP、QQ / 网易云 / WeSing `onState` 更新各自候选；仅实际输出来源广播 | [music-runtime.js](../../../../src/server/music-runtime.js) 的 `publishCurrentState` |
| `lyricTimeline`（快照与 `lyric-timeline` 消息） | 内置 HTTP、QQ / 网易云 / WeSing `onTimeline` 更新各自候选；仅实际输出来源广播 | [music-runtime.js](../../../../src/server/music-runtime.js) 的 `publishCurrentTimeline` |

场景输出通知在本轮来源仲裁的时间轴与状态更新完成后合并发送一次，避免重复读取或把新时间轴与旧状态组合；未变化的时间轴与被拒绝的状态不触发通知。歌词内容本身的时序消费在下方 §14 的解析器文档。

### 13.4 外部 QQ 音乐

[qq-client-monitor.js](../../../../src/music/qq-client-monitor.js) 在 Windows 上以隐藏的 PowerShell 子进程只读采样系统媒体会话，每 500 ms 检查 QQMusic 会话的歌名、歌手、播放状态、速率及时间轴；不控制客户端、不读取客户端凭据。辅助进程启动失败、error 或退出时按 500 / 1000 / 2000 ms 最多自动重试三次，有效样本重置重试预算；停用或服务退出取消重试并关闭进程，旧进程及已缓冲回调失效。

[qq-client-capture.js](../../../../src/music/qq-client-capture.js) 负责曲目及解析代际：新歌名至少经过连续两次样本；连续的旧曲时钟须等待超过切换边界的新时间戳，已随新歌名更新且时长变化或进度明显回跳的时钟可在歌名稳定后接受。无效或倒退的时间戳保持 loading。SMTC 的 Position 是 LastUpdatedTime 时刻的位置；播放中按经过时间及 PlaybackRate 外推并限制在曲目时长内，暂停不外推，不能仅因锚点超过 3 秒未更新而判定失效。有效时钟下短暂无会话容忍 1.5 秒，持续失联、明确 Stopped/Closed 或采集错误清除旧曲。

QQ / 网易云采集器都提供 `getStatus()`、`getLyricState()`、`getTimeline()` 快照。采集状态区分 inactive、waiting、loading、ready、empty、error；只有有效时钟和非空歌词同时就绪才 ready。管理状态 `playing` 保留实际播放状态，即使歌词缺失或加载中；歌词状态的 `playing` 只在 ready 时为真。歌词读取错误映射为 overlay idle，清除旧内容；无歌词为 empty。异步歌词结果不能覆盖新曲或停用后的状态；暂停、继续及同曲 seek 不重复解析歌词。手动重新检测会重建该采集器与当前曲目解析，不修改跟随偏好。

### 13.5 外部网易云音乐

[netease-client-monitor.js](../../../../src/music/netease-client-monitor.js) 每 500 ms 优先读取 cloudmusic 的 SMTC 歌曲、状态和时钟；没有可用媒体会话时，匹配 cloudmusic 进程的播放窗口标题，先通过 [netease-native-player-source.js](../../../../src/music/netease-native-player-source.js) 读取该进程播放引擎的歌曲 ID、播放/暂停状态、毫秒进度与时长。这条路径不依赖普通页、唱片样式的进度控件。读取仅使用 `PROCESS_VM_READ`，不注入、不写入、不申请调试权限；在 `cloudmusic.dll` 有界 `.text`（最多 32 MiB）中定位两个唯一代码特征，目标必须位于该模块 `.data` 内。每个进程定位一次，后续只读取播放字段；字符串最多 64 字节，拒绝无效 ID、非有限/越界时间、未知状态及读取过程中变化的曲目标识。模块范围、特征或读取不满足条件时保留现有回退。特征与字段布局参考 Music-DiscordRPC，MIT 版权与许可保留在源码中。

引擎读取不可用时，通过 UI Automation 只读获取 `MM:SS / MM:SS` 或 `MM:SS | MM:SS` 进度及附近的播放/暂停按钮。托管 UIA 读不到进度时，回退到 Windows MSAA（`AccessibleObjectFromWindow` / `AccessibleChildren`）读取 Chromium 的无障碍树，兼容网易云 3.x 的空 UIA 容器和小写 `play/pause` 按钮。MSAA 扫描最多 2000 个节点、32 层，只保留进度与附近状态控件，重扫/切歌释放旧 COM 引用，不调用控件或修改客户端。

切换窗口或标题后等待 1.5 秒再扫描 UI 控件，每 2 秒刷新控件引用；读取前后标题不一致时丢弃该次混合样本。引擎发布 `clockSource: 'native'` 的毫秒样本；MSAA 与 UIA 都发布整数秒的 `clockSource: 'uia'` 样本。辅助进程通过固定命令从 stdin 读取 UTF-8 源码，避免 Windows 命令行长度限制，不落地临时脚本。连续 15 秒无输出会被回收；启动、输入管道失败或退出按 500 / 1000 / 2000 ms 最多重试三次，停用取消全部计时器并结束辅助进程，原生进程句柄随之释放。目标播放窗口消失时也主动释放句柄。

[netease-client-track.js](../../../../src/music/netease-client-track.js) 只读 `%LOCALAPPDATA%/NetEase/CloudMusic/Library/webdb.dat` 的最新 `historyTracks` 记录；数据库缺失或读取失败时尝试旧版 `webdata/file/history`，旧格式文件限 8 MiB。记录的歌名、歌手必须与当前窗口或媒体元数据一致，两边都提供时长时相差不超过 2 秒，才补充数值 `sourceTrackId`；不能把历史记录中的另一首歌当作当前曲目。引擎 ID 与匹配记录的 ID 不一致时，丢弃混合样本并重读，不能用历史 ID 覆盖当前引擎 ID。未找到可信记录时保留窗口/媒体元数据及引擎 ID，稍后重读，不读取客户端凭据。

[netease-client-capture.js](../../../../src/music/netease-client-capture.js) 等待稳定歌名与有效时钟后获取歌词。SMTC 使用时间戳锚点；新标题到达时，若总时长变化或进度回跳超过 1 秒，可确认随标题到达的新曲锚点，不要求客户端再次更新时间戳。SMTC 同源样本仍拒绝倒退时间戳；切换时钟来源时不比较不同来源的时间戳。引擎采样按真实毫秒位置及采样时间外推，暂停与 seek 直接采用读数；与 UIA 一样要求样本不超过 2.5 秒，新标题稳定至少 1.5 秒，播放中连续 2.5 秒无进度变化时等待有效读数，不无限外推。

UIA 将整数秒读数视为一秒时间区间：连续播放、同一时钟且读数未回退时，若上次连续位置加经过时间仍落在该区间内，就保留该估计，避免每次轮询发现新秒数时回拉。首次有效读数、暂停/继续、向后跳转和超出区间的估计仍采用采样锚点。UIA 按钮状态未知时，连续两次正常递增（每次相隔 250–2500 ms、递增不超过 2 秒）才推断播放，单次暂停拖动不触发播放，也不把静音或静止读数当暂停。UIA/MSAA 回退仍依赖可访问的控件；客户端改版后若引擎特征与 UI 都不可读，则显示等待/错误，不沿用上一首歌词。其他版本兼容性及托盘模式需分别验收，不能从普通页面通过推断所有模式均已通过。

### 13.6 外部播放器歌词解析

[external-client-lyrics.js](../../../../src/music/external-client-lyrics.js) 的 `createExternalClientLyricResolver({platform, getRegistry, lyricsService})` 只接受 qq 或 netease，并返回 `resolveLyrics({title, artists?, artist?, durationMs?, sourceTrackId?})`。网易云有可信数值曲目 ID 时直接取该曲歌词；没有 ID 时与 QQ 一样，在本平台按歌名、歌手搜索最多 20 个候选。候选必须属于本平台，且完整歌名规范化后相同，保留 Live、DJ 等版本信息；已知歌手时，按 `/` 拆分并排序后的完整歌手列表也必须相同。歌名与歌手均执行 NFKC 规范化、合并空白、去除首尾空白及忽略大小写。双方时长已知时相差不得超过 5 秒，合格候选按时长距离择近；没有准确候选则返回空，不跨平台兜底。歌词响应声明了其他平台或没有有效行时也返回空；请求失败交给采集器显示错误。

外部 QQ 始终查询 QQ，外部网易云始终查询网易云，取得的是对应平台的在线歌词，不是直接复制客户端当前渲染的歌词缓存；翻译和版本匹配取决于该平台返回内容。网易云优先真实 YRC，只有 LRC 时补估算逐字时间（§14.7），QQ 保持平台逐字数据。`weSingLyricSource / weSingSmartLyricMatch` 仅属于 [WeSing 在线兜底](wesing.md#8-在线兜底wesing-online-lyricsjs)，不参与这里的选择。智能播放只决定跟随哪个播放器，智能选词只为全民 K 歌本地 QRC 不可用时选择在线歌词。

## 14. 歌词解析器(src/music/lyric-parser.js)

`lyric-parser.js` 是 QQ 音乐与网易云音乐**共用**的歌词行模型实现。导出 `parseLyricResult`、`parseLrc`、`parseWordLyric`、`findCurrentLyricLine` 及仅由网易云调用的 `estimateWordTimings`([lyric-parser.js](../../../../src/music/lyric-parser.js))。

### 14.1 parseLyricResult(rawLyric, rawTranslation, rawWordLyric, rawRoma)([lyric-parser.js:45-75](../../../../src/music/lyric-parser.js#L45-L75))

组合四路原始文本，产出完整行数组：

1. `parseWordLyric(rawWordLyric)` → 逐字行；`parseLrc(rawLyric)` → LRC 行
2. **LRC 非空取 LRC，空则降级为逐字行**（无词版行，`{startMs, endMs, text}`）([lyric-parser.js:48-50](../../../../src/music/lyric-parser.js#L48-L50))
3. 翻译/罗马音各经 `parseTimedText`（先 LRC 后逐字）解析，并构造各自的 `createTimedTextResolver`
4. 每行输出 `{ startMs, endMs, text, translation, roma, words[] }`：
   - `endMs` 缺失时取下一行 `startMs`([lyric-parser.js:69](../../../../src/music/lyric-parser.js#L69))
   - `roma` = API 罗马音优先；空则取 `[kana:…]` 假名注音（§14.5）
   - `words` = 逐字行按 `startMs` 精确对齐([lyric-parser.js:72](../../../../src/music/lyric-parser.js#L72))

### 14.2 parseLrc(rawText)([lyric-parser.js:113-137](../../../../src/music/lyric-parser.js#L113-L137))

| 事实         | 值                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| 行正则       | `/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g` — 支持 `[mm:ss]`、`[mm:ss.xxx]`、`[mm:ss:xxx]`           |
| 同行多时间戳 | 生成多条记录（卡拉 OK 重复行）                                                                          |
| 空文本行     | 跳过（`if (!lyricText) continue`）                                                                      |
| 分数位处理   | 3 位直接毫秒；不足 3 位 `padEnd(3,'0')`([lyric-parser.js:143-146](../../../../src/music/lyric-parser.js#L143-L146)) |
| 排序         | `startMs` 升序，同值按文本字典序                                                                        |

### 14.3 parseWordLyric(rawText)([lyric-parser.js:149-202](../../../../src/music/lyric-parser.js#L149-L202))

逐字歌词（QQ 音乐 QRC 解密产物 / 网易云 YRC）的行与词提取：

| 层级                 | 正则                             | 说明                        |
| -------------------- | -------------------------------- | --------------------------- |
| 行                   | `/\[(\d+),(\d+)\]([/s/S]*)/`     | `[startMs,durationMs,body]` |
| 前缀词（优先）       | `/\((\d+),(\d+),\d*\)([^()]+)/g` | `(start,duration,?)text`    |
| 后缀词（仅无前缀时） | `/([^()]*)\((\d+),(\d+)\)/g`     | `text(start,duration)`      |

每词输出 `{ startMs, endMs: startMs + max(0, durationMs), text }`，保留有效词文本中的空格，避免 YRC 英文词连写；无词的行整体丢弃；行 `text` = 所有词文本拼接后 `trim()`。

### 14.4 createTimedTextResolver(lines, toleranceMs=100)([lyric-parser.js:86-111](../../../../src/music/lyric-parser.js#L86-L111))

用于翻译/罗马音行的时间容差匹配（QQ 音乐翻译行常有毫秒级偏移）：

1. 过滤非有限 `startMs` → 升序排序 → `exact = Map(startMs → text)`
2. 查询：`exact.has(startMs)` 直中；否则二分查找最近邻，`|Δ| ≤ 100ms` 才命中，否则返回 `''`

### 14.5 假名注音([lyric-parser.js:11-43](../../../../src/music/lyric-parser.js#L11-L43))

QQ 音乐 LRC 主歌词里可能携带 `[kana:…]` 标签存日语假名读音：

- `extractKanaReadings`：`/\[kana:([^\]]+)\]/` 匹配后，按数字分隔符切分为读音数组
- `mapKanaToLines`：遍历歌词行，按 CJK 字符（U+4E00-9FFF / U+3400-4DBF / U+F900-FAFF）消费读音，每行读音空格连接存入 `Map(startMs → kanaText)`；读音不足时已有读音的字就不再消费后续

CJK 判定三范围：`0x4E00-0x9FFF`（基本汉字）、`0x3400-0x4DBF`（扩展 A）、`0xF900-0xFAFF`（兼容汉字）([lyric-parser.js:4-8](../../../../src/music/lyric-parser.js#L4-L8))。

### 14.6 findCurrentLyricLine(lines, currentMs)([lyric-parser.js:204-223](../../../../src/music/lyric-parser.js#L204-L223))

二分查找**最后一个 `startMs ≤ currentMs` 的行**；`lines` 为空或 `currentMs` 非数字时返回 `null`。是播放页、WeSing 采集与歌词窗口的唯一当前行定位入口。

### 14.7 estimateWordTimings(lines, durationMs)

仅网易云 Provider 在解析后调用：已有 `words` 的行原样保留；LRC 行按 Unicode 字素切分，连续拉丁字母/数字合为词，标点和空白附到相邻字词以保留原文。每个字权重为 1，拉丁词按长度 / 3 计算且至少为 1，在行的起止时间间按权重连续分配毫秒。末句缺少结束时间时使用曲目时长；曲目时长也缺失时按每权重 300 ms 估算，限制在 1–8 秒。没有正时长或有效字词的行不生成时间。

这是显示用的估算，不分析音频或承诺演唱级对齐；长间奏、拖腔可能有偏差。真实 YRC 不经过重分配。内置音频和外部真实采样仍各自拥有播放时钟，估算只补行内 `words`。

## 15. 跨 Provider 的规范形状(Track / Playlist)

两个 Provider 的映射函数(`mapQQSong` / `mapNeteaseSong`,详情见各自文档 §8)产出**同一形状**,是歌词服务、播放器、歌单写入门面与 WS 载荷的公共契约:

| 字段                            | 说明                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`                            | `qq:<mid>` 或 `netease:<数字id>`(前端展示与去重主键)                                                                 |
| `source`                        | `'qq'` / `'netease'`                                                                                                 |
| `sourceTrackId`                 | QQ 为 mid(写入/流解析用),网易云为数字 id                                                                             |
| `sourceMediaId`                 | QQ 音频文件 media mid,缺失回退 track mid;网易云缺省空串                                                              |
| `sourceSongId`                  | **仅 QQ 有意义**:数值 songId(歌词新版接口与歌单写入必填);网易云恒缺省 0                                              |
| `sourceSongType`                | **仅 QQ 有意义**:上游 song type,用于付费音质 vkey 请求;缺失或非法为 0                                                |
| `sourceAlbumId`                 | 专辑 mid/id,缺失空串                                                                                                 |
| `title` / `artists[]` / `album` | 清洗后的文本;artists 由 track-contract 限 8 个                                                                       |
| `durationMs`                    | 毫秒,≥ 0(QQ 来自秒字段 ×1000)                                                                                        |
| `coverUrl`                      | 直链或构造 URL(QQ 见 [qq-provider.md](qq-provider.md) §8.4,网易云见 [netease-provider.md](netease-provider.md) §8.1) |
| `playable` / `vip`              | 平台可用性/付费标记(QQ 恒 `playable: true`)                                                                          |

Playlist 形状:`{ id, source, title, description, coverUrl, trackCount, playCount, creatorUserId, dirId?, tid? }`——`dirId`/`tid` 仅 QQ 有(写入目标与"我喜欢"识别,见 [qq-provider.md](qq-provider.md) §7.12);推荐卡片(`mapRecommendCard`)无 dirId/tid,不可直接写入。
