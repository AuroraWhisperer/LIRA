# HTTP API 端点注册表

> 涉及文件:[src/server/api-routes.js](../../../src/server/api-routes.js)、[src/server/http-utils.js](../../../src/server/http-utils.js)、[src/server/routes/system-routes.js](../../../src/server/routes/system-routes.js)、[src/server/routes/settings-routes.js](../../../src/server/routes/settings-routes.js)、[src/server/routes/clock-routes.js](../../../src/server/routes/clock-routes.js)、[src/server/routes/opening-routes.js](../../../src/server/routes/opening-routes.js)、[src/server/routes/wesing-routes.js](../../../src/server/routes/wesing-routes.js)、[src/server/routes/music-routes.js](../../../src/server/routes/music-routes.js)、[src/server/routes/playback-routes.js](../../../src/server/routes/playback-routes.js)、[src/server/routes/theme-routes.js](../../../src/server/routes/theme-routes.js)、[src/server/routes/song-routes.js](../../../src/server/routes/song-routes.js)、[src/server/routes/queue-routes.js](../../../src/server/routes/queue-routes.js)、[src/server/routes/superchat-routes.js](../../../src/server/routes/superchat-routes.js)、[src/server/routes/gift-routes.js](../../../src/server/routes/gift-routes.js)、[src/server/routes/overtime-routes.js](../../../src/server/routes/overtime-routes.js)、[src/server/routes/debug-routes.js](../../../src/server/routes/debug-routes.js)、[src/server/routes/data-routes.js](../../../src/server/routes/data-routes.js)、[src/server/routes/ai-routes.js](../../../src/server/routes/ai-routes.js)、[src/server/routes/bilibili-routes.js](../../../src/server/routes/bilibili-routes.js)

本文档是全部 HTTP API 端点的**唯一事实源**:每个端点的方法、路径、请求体、响应形态与错误码只在此成表。其他文档一律链接此处,不自行罗列端点。服务进程的端口、token 机制、请求管线详见 [server-core.md](server-core.md);WebSocket 消息与快照见 [ws.md](ws.md);数据库与设置见 [storage.md](storage.md)。

## 0. 路由机制与通用约定

路由分发在 [api-routes.js](../../../src/server/api-routes.js) 中完成,无状态、无框架(`node:http` 手写路由):

| 事实 | 值 | 出处 |
|---|---|---|
| 模块注册 | `ROUTE_MODULES` 数组按序 require **18 个路由模块**,每个模块导出 `prefixes[]` 与 `routes` 映射(`"METHOD /path"` → handler) | [api-routes.js:8-27](../../../src/server/api-routes.js#L8-L27) |
| 匹配顺序 | 按模块顺序做前缀匹配(`pathName.startsWith(prefix)`);**先注册的模块优先**,因此 `/api/music/wesing/*` 归属 WeSing 模块而非 music 模块 | [api-routes.js:29-39](../../../src/server/api-routes.js#L29-L39) |
| 405 与 404 区分 | 模块前缀命中但路径没有对应方法时,`findRoute` 置 `pathExists` → **405**;任何模块前缀都不命中 → **404** | [api-routes.js:34-38](../../../src/server/api-routes.js#L34-L38) |
| 请求体惰性读取 | `createBodyReader` 只在 handler 真正调用 `request.body()` 时读一次 JSON(GET 请求不读 body) | [api-routes.js:42-48](../../../src/server/api-routes.js#L42-L48) |

**认证**:**除 `/api/health` 与 Browser Source 只读配置 `/api/clock/config`、`/api/opening/config` 外全部端点要求 Bearer 头(`Authorization: Bearer <sessionToken>`)或查询参数 `?token=<sessionToken>`**,校验失败回 401。token 生成/落盘/前端注入的完整机制由 [server-core.md](server-core.md) §4 与 §7 负责,此处只记录契约形态:

- 401:`{ok:false, error:'未授权访问。请在启动日志中查看 session token。'}`
- 405:`{ok:false, error:'请求方法不支持', details:'该接口不支持 <METHOD> 请求'}`
- 404:`{ok:false, error:'API 接口不存在', details:'未找到接口：<pathName>'}`
- 顶层兜底(handler 未捕获异常):**500** `{ok:false, error: <error.message>}`([server.js:279-282](../../../src/server.js#L279-L282));body 超限/非法 JSON 也经此路径返回(`Request body is too large.` / `Invalid JSON body.`)

**请求体**:JSON,上限 `MAX_BODY_BYTES = 16 MB`([server.js:48](../../../src/server.js#L48));空 body 按 `{}` 处理;非法 JSON 或超限由 [http-utils.js:8-35](../../../src/server/http-utils.js#L8-L35) 的 `readJsonBody` 拒绝。

**响应**:除歌库的 CSV/XLSX 下载端点外,全部为 JSON。成功统一 `{ok:true, data:…}`(`sendJson`,[http-utils.js:37-44](../../../src/server/http-utils.js#L37-L44)),错误统一 `{ok:false, error, details?}`。CSV/XLSX 下载走 `sendCsv`/`sendBuffer`,带 `Content-Disposition: attachment` 与 `Cache-Control: no-store`([http-utils.js:56-73](../../../src/server/http-utils.js#L56-L73))。

---

## 1. 系统域(system)

> 模块文件:[src/server/routes/system-routes.js](../../../src/server/routes/system-routes.js)
> 前缀:`/api/health`、`/api/state`、`/api/system/`

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/health` | 无(**免 token 端点之一**；其余为只读 `GET /api/clock/config`、`GET /api/opening/config`，见 `PUBLIC_API_PATHS` [api-routes.js:30](../../../src/server/api-routes.js#L30)) | 健康信息:`serviceId/rootDir/dataDir/各库路径/schemaVersions/desktop/pid/liveStatus`(详见 [server-core.md](server-core.md) §7) | — |
| `GET /api/state` | 无 | 全量状态快照,与 WS 快照 `state` 的 **16 字段一致**(见 [ws.md](ws.md) §2) | — |
| `GET /api/system/metrics` | 查询参数 `windowMs`(可选,默认 5000) | `getSystemMetrics` 采样窗口内 CPU/内存/GPU 指标(见 [server-core.md](server-core.md) §8) | — |
| `GET /api/system/hardware` | 查询参数 `includeTemperatures=true`(可选) | 本机 CPU/物理 GPU/内存型号与容量（排除虚拟显示适配器）；仅显式传 `true` 时读取支持的 GPU 温度，结果不含序列号 | — |
| `POST /api/system/shutdown` | body `{confirm: true}`(必须) | `{shuttingDown: true}`,随后延迟 250ms 关闭服务 | 400 `缺少退出确认。` |

行为文档:[server-core.md](server-core.md) §6(启动/关闭时序)。

## 2. 设置域(settings)

> 模块文件:[src/server/routes/settings-routes.js](../../../src/server/routes/settings-routes.js)
> 前缀:`/api/settings`

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `POST /api/settings` | body:设置键值对(**白名单**:仅 `settings.defaults` 中的键生效,未知键静默忽略;`roomId` 经 `normalizeRoomInput` 规范化,`customReplyRules` 经 `parseCustomReplyRules` 解析后 `JSON.stringify`,`openingTrackMotion`、`clockStyle`、`clockShowDate/Seconds`、`clockHourFormat` 与 `danmakuOverlayStyle` 按各自枚举校验，`clockLabel` 去控制字符、合并空白并截到 16 字，其余值一律 `String()`;每次调用后重建 Bilibili 监听并广播快照 `settings`) | 全量状态快照(`system.getState()`,同 §1 `GET /api/state`) | 枚举值无效为 400;规范化异常走顶层 500 |

行为文档:[storage.md](storage.md) §7(设置键全表)。

## 2.1 开播动画域(opening)

> 模块文件:[src/server/routes/opening-routes.js](../../../src/server/routes/opening-routes.js)
> 前缀:`/api/opening`

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/opening/config` | 无；为 Browser Source 读取当前开播设置，免 session token | 已清洗的文案、画质、开关、音量、轨道动效 `trackMotion`(`heart`/`barber`/`progress`)、当前音频与人物图 URL；未上传时分别使用内置“果实”音乐和默认人物图，非法轨道值回退 `heart` | — |
| `POST /api/opening/music` | `multipart/form-data`，字段 `file`；≤ 64 MB，扩展名限 `.mp3/.flac/.wav/.aac/.ogg/.m4a/.wma` | 保存至 data 目录下 `opening-music/` 并将其设为当前音频 | 400(缺少/不支持音频文件)、413(超限) |
| `DELETE /api/opening/music` | 无 | 清除当前上传音乐，恢复内置音乐 | — |
| `POST /api/opening/character` | `multipart/form-data`，字段 `file`；内容 ≤ 16 MB，扩展名限 `.png/.jpg/.jpeg/.webp` 且必须匹配图片签名 | 保存至 data 目录下 `opening-character/` 并将其设为当前人物图 | 400(缺少、不支持或签名不匹配)、413(请求体超限) |
| `DELETE /api/opening/character` | 无 | 清除当前上传人物图，恢复内置人物图 | — |

上传文件使用随机文件名；音频和人物图分别只允许当前设置指向的文件通过 `/opening-media/` 与 `/opening-character/` 读取，原始文件名仅作为界面显示文本。除 `GET /api/opening/config` 外，本节写接口仍需 session token。

### 2.2 normalizeRoomInput 实现细节([shared/utils.js](../../../src/shared/utils.js))

`roomId` 值经此函数规范化后再写库，规则按优先级：

| 条件 | 结果 |
|---|---|
| 空字符串 / 纯空白 | 返回 `''` |
| 纯数字字符串(`/^\d+$/`) | 原样返回 |
| URL 含 `live.bilibili.com/<数字>` 或 `live.bilibili.com/blanc/<数字>` | 提取路径数字 |
| URL 含 `?room_id=<数字>` 或 `?id=<数字>` | 提取查询参数数字 |
| 其他含 ≥ 3 位连续数字的字符串 | 提取第一组连续数字（松散兜底） |
| 均无匹配 | 返回 `''` |

在精确模式匹配之前先对输入做 `decodeURIComponent`，因此直接粘贴浏览器地址栏的编码 URL 也能正确解析。

### 2.3 parseCustomReplyRules 实现细节([bilibili/custom-reply-service.js](../../../src/bilibili/custom-reply-service.js))

`customReplyRules` 设置值存为 JSON 字符串，写入前经此函数校验并清洗：

1. 输入可以是数组或 JSON 字符串；非法 JSON 静默回退为 `[]`
2. 每条规则经 `normalizeCustomReplyRule` 清洗：`keyword` 截 30 字符、`reply` 截 120 字符，均经 `cleanText` 去控制字符；`enabled` 字段透传（`undefined` 时匹配时视为 `true`）
3. 过滤掉 `keyword` 或 `reply` 为空的条目
4. 截取前 `MAX_CUSTOM_REPLY_RULES = 30` 条

写入时 `JSON.stringify(parseCustomReplyRules(rawValue))` 落库；读取时再次 `parseCustomReplyRules(stored)` 反序列化使用。

## 2.4 萌时钟域(clock)

> 模块文件:[src/server/routes/clock-routes.js](../../../src/server/routes/clock-routes.js)
> 前缀:`/api/clock`

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/clock/config` | 无；为 Browser Source 读取当前萌时钟设置，免 session token | 已清洗的 `style`、`showDate`、`showSeconds`、`hourFormat`、`label`；非法存量值回退原默认配置 | — |

## 3. WeSing 采集域(wesing)

> 模块文件:[src/server/routes/wesing-routes.js](../../../src/server/routes/wesing-routes.js)
> 前缀:`/api/music/wesing/`(注册顺序在 music 模块之前,故该前缀不会落入 §4)

全部端点经 `weSingRoute` 包装:handler 抛错统一回 **400** `{ok:false, error}`。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/music/wesing/status` | 无 | 全民K歌采集状态(WS 快照 `weSing` 字段同源) | 400 |
| `POST /api/music/wesing/configure` | `{cachePath}` | 配置缓存目录(写回设置 `weSingCachePath`) | 400 |
| `POST /api/music/wesing/offset` | `{offsetMs}` | 设置歌词偏移(写回设置 `weSingLyricOffsetMs`) | 400 |
| `POST /api/music/wesing/active` | `{active: boolean}`(必须为布尔) | 开关采集 | 400(非布尔时 `active 必须是布尔值。`) |
| `POST /api/music/wesing/refresh` | 无 | 立即刷新当前歌词 | 400 |

行为文档:[music/wesing.md](music/wesing.md)。

## 4. 在线音源域(music)

> 模块文件:[src/server/routes/music-routes.js](../../../src/server/routes/music-routes.js)
> 前缀:`/api/music/`(不含 `/api/music/wesing/`,见 §3)

Provider 未接入或抛错的端点统一经 `sendProviderResult` 回 **501** `{ok:false, error}`;其余端点错误由对应 handler 处理。注意 `GET /api/music/health` **不是**公开端点,仍要求 token(与 `/api/health` 不同)。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/music/health` | 查询参数 `platform`(可选,空则全部) | 各音源 Provider 健康状态([provider-health.js](../../../src/music/provider-health.js)) | — |
| `GET /api/music/cache` | 无 | 音乐 API/歌词缓存统计 | — |
| `POST /api/music/resolve-stream` | `{track, forceRefresh?}`(`forceRefresh: true` 跳过缓存) | 解析后播放流信息 | 501 |
| `GET /api/music/qq-encrypted-stream` | `id` + session token;支持浏览器 `Range` | 服务端短期 QMC2 解密的 FLAC/Ogg 播放流 | 404/416/502 |
| `POST /api/music/search` | `{platform?`(默认 `netease`), `keyword|query|songName`(必填,截断 120 字符), `limit`(1–30,默认 20)} | `{source, keyword, tracks}` | 501、400(缺关键词) |
| `POST /api/music/home` | `{platform?`, `action?`(`personalized`(默认)/`playlist-tracks`/`daily`/`radio`/`liked`/`created-playlists`/`collected-playlists`/`recent`), `limit`(1–5000,默认 100), `offset`, `page`(1–50), `playlistId?`, `refresh?`, `track?`(仅 `created-playlists` 附带时标注歌单归属)} | 首页/歌单内容(`personalized`/`playlist-tracks` 走 5 分钟 API 缓存,`daily`/`radio` 不缓存) | 501、400 |
| `POST /api/music/playlists/tracks/add` | `{platform|source?`(默认 `qq`), `playlist: {id|tid, dirId?, title|dirName?(截断 200)}`, `tracks[]`(**≤ 100 条**,空数组报错)} | `{source, operation:'add', playlist, result}` | 501、400(`缺少要修改的音乐歌曲。`) |
| `POST /api/music/playlists/tracks/remove` | 同上(`tracks` ≤ 100) | `{source, operation:'remove', playlist, result}` | 501、400 |
| `POST /api/music/lyrics` | `{track}`(经 `normalizeMusicTrackForProvider` 归一化;命中 30 天歌词缓存时附 `cached: true`) | 歌词数据 | 501 |
| `POST /api/music/lyrics/parse` | `{lyric, translation, wordLyric|yrc, roma?}`(每段文本上限 512 KB) | `{lines: 解析后的时间轴行}` | — |
| `POST /api/music/match-track` | `{songName|title`(必填,截断 120), `artist`(截断 80), `durationMs?`, `candidates[]`(≤ 50)} | `{request, threshold: 70, results}` | 400(缺歌名) |
| `POST /api/music/cache/clear` | 无 | 清空音乐 API/歌词缓存结果 | — |

请求体校验与截断规则见 [lyrics-service.js:44-171](../../../src/music/lyrics-service.js#L44-L171)。

行为文档:[music/services.md](music/services.md)(在线音源、播放器领域)。

## 5. 播放器持久化域(playback)

> 模块文件:[src/server/routes/playback-routes.js](../../../src/server/routes/playback-routes.js)
> 前缀:`/api/playback/`

全部端点经 `storeRoute` 包装:store 抛错统一回 **400**。`clientId` 取值优先级:**body.clientId → query `clientId` → `'default'`**(`clientIdOf`,[playback-routes.js:22-24](../../../src/server/routes/playback-routes.js#L22-L24));历史与队列态按 clientId 隔离,收藏与歌单为全局。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `POST /api/playback/lyric-state` | body(歌词行状态,经 `normalizeLyricState`;可选兼容 `generation`/`sequence`) | 归一化并版本化后的 state;同时经 WS 广播 `lyric-state` | 400 |
| `POST /api/playback/lyric-timeline` | body(歌词时间轴,经 `normalizeLyricTimeline`) | 归一化后的 timeline;同时广播 `lyric-timeline` | 400 |
| `GET /api/playback/history` | 查询参数 `clientId?`、`limit?`(默认 500) | `{tracks}` | 400 |
| `POST /api/playback/history` | `{track, clientId?, origin?, requesterName?, playedAt?}` | `recordPlay` 结果 | 400 |
| `POST /api/playback/history/remove` | `{trackKey, clientId?}` | `{removed: boolean}` | 400 |
| `POST /api/playback/history/clear` | `{clientId?}` | 清空结果 | 400 |
| `GET /api/playback/queue-state` | 查询参数 `clientId?` | `{payload, updatedAt}`(无记录时 `{payload: null, updatedAt: ''}`) | 400 |
| `POST /api/playback/queue-state` | `{payload, clientId?}` | 保存队列快照结果 | 400 |
| `POST /api/playback/queue-state/clear` | `{clientId?}` | 清空结果 | 400 |
| `GET /api/playback/favorites` | 无 | `{tracks}` | 400 |
| `POST /api/playback/favorites` | `{track}` | 添加收藏结果 | 400 |
| `POST /api/playback/favorites/remove` | `{trackKey}` | 移除收藏结果 | 400 |
| `GET /api/playback/playlists` | 查询参数 `id?`:带 `id` 返回 `{id, tracks}`;否则 `{playlists}` | 歌单列表/歌单曲目 | 400 |
| `POST /api/playback/playlists` | body(歌单结构,`createPlaylist`) | 新建歌单 | 400 |
| `POST /api/playback/playlists/delete` | `{id}` | 删除歌单 | 400 |
| `POST /api/playback/playlists/tracks` | `{id, tracks[]}`(兼容 `track` 单曲) | 向歌单加曲 | 400 |
| `POST /api/playback/playlists/tracks/remove` | `{id, trackKey}` | 从歌单移除 | 400 |

行为文档:[music/services.md](music/services.md)(播放器持久化、歌词状态)。

## 6. 主题预设域(theme)

> 模块文件:[src/server/routes/theme-routes.js](../../../src/server/routes/theme-routes.js)
> 前缀:`/api/theme/`

全部端点经 `themeRoute` 包装:抛错统一回 **400**。应用预设会写回 settings,故附带快照广播。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/theme/presets` | 无 | `{presets}` | 400 |
| `POST /api/theme/presets` | `{name`(必填,截断 60 字符), `scope?}`;把**当前** settings 外观收成一套预设,同名覆盖 | `{preset}` | 400(`缺少预设名称。`/`内置预设不能覆盖,请换一个名称。`) |
| `POST /api/theme/presets/apply` | `{id}` | `{preset, appliedKeys}`;广播 `theme:preset-applied` | 400(`预设不存在。`) |
| `POST /api/theme/presets/rename` | `{id, name}` | `{preset}` | 400 |
| `POST /api/theme/presets/delete` | `{id}` | `{removed, id, name}` | 400(`内置预设不能删除。`) |

校验规则见 [theme-store.js:79-128](../../../src/storage/theme-store.js#L79-L128)。

行为文档:[storage.md](storage.md) §7(主题设置键)。

## 7. 歌库域(songs)

> 模块文件:[src/server/routes/song-routes.js](../../../src/server/routes/song-routes.js)
> 前缀:`/api/songs`、`/api/categories`

CSV/XLSX 端点走 `sendCsv`/`sendBuffer` 下载(带 BOM / `Content-Disposition`),其余为 JSON。`save/delete/toggle/import/import-xlsx` 未包 try/catch,校验失败经顶层 500 返回。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/categories` | 无 | 分类列表(`sort_order,name COLLATE NOCASE` 排序,`is_enabled` 布尔化) | — |
| `GET /api/songs` | 查询参数:`query?`、`category`(**可重复**,`getAll`)、`language?`、`artist?`、`tag`(**可重复**)/`tags?`、`enabledOnly?`(`'true'` 时只列启用) | `{songs}`(LIKE 模糊检索 name/artist/tags/分类名) | — |
| `GET /api/songs/template.csv` | 无 | CSV 导入模板(UTF-8 BOM,文件名 `song-import-template.csv`) | — |
| `GET /api/songs/template.xlsx` | 无 | XLSX 导入模板(文件名 `song-import-template.xlsx`) | — |
| `GET /api/songs/export.csv` | 无 | 全量曲库 CSV(文件名 `songs-export.csv`) | — |
| `GET /api/songs/export.xlsx` | 无 | 全量曲库 XLSX(文件名 `songs-export.xlsx`) | — |
| `POST /api/songs/save` | `{id?`(有则更新,无则新建), `name|songName`(必填), `artist?`, `categoryName|category?`(默认 `'默认'`,不存在自动建), `isEnabled?`, `note?`, `tags?`, `language?`, `sourcePlatform?`};自动生成拼音/首字母 | 保存结果;广播 `songs:save` | 500(`歌曲名不能为空。`/`歌曲不存在。`) |
| `POST /api/songs/delete` | `{id}` | `{id}`;广播 `songs:delete` | 500 |
| `POST /api/songs/toggle` | `{id}` | `{id}`;广播 `songs:toggle` | **404**(`Song not found.`)、500 |
| `POST /api/songs/import` | `{rows[]}`(歌曲对象数组,结构与 save 一致) | 导入统计 `{total, inserted, duplicate, failed, …}`;广播 `songs:import` | 500 |
| `POST /api/songs/import-xlsx` | `{base64}`(XLSX 文件 Base64) | 同 import(先 `parseSongsFromXlsx`);广播 `songs:import-xlsx` | 500 |

行为文档:[music/services.md](music/services.md)(歌库服务)。

## 8. 播放队列域(queue)

> 模块文件:[src/server/routes/queue-routes.js](../../../src/server/routes/queue-routes.js)
> 前缀:`/api/queue/`

handler 未包 try/catch:校验失败经顶层 **500** 返回 `{ok:false, error}`。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `POST /api/queue/add` | `{songName`(必填), `artist?`, `categoryName?`, `requesterName?`(默认 `'主播'`), `requesterUid?`(默认 `'admin'`), `requesterGuardLevel?`, `requesterMedalName?`, `requesterMedalLevel?`, `source?`(默认 `'admin'`), `message?`(默认 `''`), `isPinned?`};命中曲库时自动补全 artist/category 并关联 `song_id`,同时写点歌流水 `requests` | 新队列项;广播 `queue:add` | 500(`歌曲名不能为空。`/`点歌队列已达到上限。`/`队列里已经有这首歌。`/`歌库里没有这首歌。`) |
| `POST /api/queue/action` | `{action, id?}`:`next`/`clear` 不需要 id;`pin`/`unpin`/`delete`/`done`/`skip` 需要 `id`(取第一首当前歌时置 `done`) | 队列快照 `{current, waiting}`;广播 `queue:<action>` | 500(`缺少队列 ID。`/`未知队列操作。`) |

校验与动作语义见 [queue-service.js:16-170](../../../src/music/queue-service.js#L16-L170)(队列上限取自设置 `queueLimit`,`allowDuplicate`/`onlyFromLibrary` 开关生效)。

行为文档:[music/services.md](music/services.md)(点歌队列)。

## 9. 醒目留言域(superchats)

> 模块文件:[src/server/routes/superchat-routes.js](../../../src/server/routes/superchat-routes.js)
> 前缀:`/api/superchats/`

handler 未包 try/catch:抛错走顶层 **500**。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `POST /api/superchats/action` | `{action, id}`:`delete`(状态 `deleted`)、`assist`(状态 `assisted`)、`unassist`(状态 `active`) | SC 快照(按价格降序);广播 `superchat:<action>` | 500(`未知 SC 操作。`) |

行为文档:[bilibili/gift.md](bilibili/gift.md)(醒目留言)。

## 10. 礼物域(gifts)

> 模块文件:[src/server/routes/gift-routes.js](../../../src/server/routes/gift-routes.js)
> 前缀:`/api/gifts/`

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `POST /api/gifts/sprint/reset` | 无 | 重置礼物冲刺进度;广播 `gift:sprint:reset` | — |
| `GET /api/gifts/history` | 查询参数:`page?`(默认 1)、`limit?`(默认 50)、`sortField?`(默认 `created_at`)、`sortDirection?`(默认 `desc`) | 礼物历史分页 | — |
| `GET /api/gifts/blind-box-stats` | 查询参数 `boxName?` | 盲盒统计 | — |
| `GET /api/gifts/blind-box-analysis` | 查询参数:`viewer?`、`box?`、`view?`(默认 `users`)、`page?`(默认 `1`)、`limit?`(默认 `25`)、`sort?`、`direction?`(默认 `desc`) | 盲盒开盒分析 | — |
| `GET /api/gifts/search` | 查询参数:`from?`、`to?`、`limit?`(**1–500**,默认 100) | 时间范围检索结果 | — |
| `POST /api/gifts/frame/preview` | `{userName?, giftName?, num?, totalPriceRmb, themeId?, motionMode?}` | 广播独立 `gift:frame` 预览事件，不读取实时开关/阈值 | 400(金额、数量、主题或动效模式无效) |
| `POST /api/gifts/clear-recent` | `{confirm: true}`(必须) | 清空最近礼物;广播 `gift:clear-recent` | 400(`缺少清空确认。`) |

行为文档:[bilibili/gift.md](bilibili/gift.md)(礼物事件、检测账本、冲刺)。

## 11. 加班机域(overtime)

> 模块文件:[src/server/routes/overtime-routes.js](../../../src/server/routes/overtime-routes.js)
> 前缀:`/api/overtime`

全部端点经 `overtimeRoute` 包装:抛错统一回 **400** `{ok:false, error}`。校验规则全部来自 [overtime-contract.js](../../../src/overtime/overtime-contract.js),常量:`MAX_OVERTIME_SECONDS = 315_328_464_000`(9,999 年)、`MAX_EFFECT_FACTOR = 1_000`、`MAX_RANDOM_WEIGHT = 100_000`、`MAX_ENABLED_RULES = 8`、`MAX_DISPLAY_TEXT_LENGTH = 6`。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/overtime` | 无 | 加班机总览(`getSnapshot()`:`enabled/status/initialSeconds/effectiveRemainingMs/serverNowMs/revision/background/rules`) + `limits:{maxSeconds, maxEffectFactor, maxRandomWeight, maxEnabledRules, minRandomOutcomes, maxRandomOutcomes, maxDisplayTextLength}` | 400 |
| `GET /api/overtime/gifts` | 无 | 最后一次自动刷新礼物目录快照 | 400 |
| `POST /api/overtime/gifts/refresh` | `{}` | 从当前直播间礼物面板、盲盒映射及已登录账号当前可送背包刷新目录；10 秒内重复请求返回缓存 | 400（未配置有效直播间号或上游返回错误） |
| `POST /api/overtime/gifts/local/search` | `{query}`：字符串，去除首尾空白后 **1–100 字符** | 三份固定 Markdown 中按名称/ID 匹配且本地图片实际存在的礼物，最多 100 个；不修改自动刷新快照 | 400（查询无效或本地目录不可用） |
| `POST /api/overtime/time` | `{initialSeconds?}` 与 `{remainingSeconds?}` **至少一个**,取值范围 **0–315,328,464,000**;`remainingSeconds` 设置后状态置为 `paused`(归零时 `finished`) | 更新后的快照 | 400(`initialSeconds or remainingSeconds is required.`/越界报错) |
| `POST /api/overtime/action` | `{action}` ∈ `start`/`pause`/`reset`/`enable`/`disable` | 更新后的快照 | 400(`action must be start, pause, reset, enable, or disable.`) |
| `POST /api/overtime/config` | `{path?, fit?}`:`fit` ∈ `cover`/`contain`/`fill`(默认 `cover`);`path` 若非空必须是内置图片路径(正则 `/img/overtime-machine/…`,拒绝 `..`/反斜杠/协议头) | 更新后的快照 | 400 |
| `POST /api/overtime/rules` | `{rules: [...]}`(规则数组,整体替换;校验见下) | 更新后的快照 | 400 |

`rules` 元素字段与校验([overtime-contract.js:43-95](../../../src/overtime/overtime-contract.js#L43-L95)):

| 字段 | 规则 |
|---|---|
| `giftId`(必填) | 字符串,≤ 100 字符,**数组内不可重复** |
| `giftName` | ≤ 100 字符 |
| `imagePath` | 非空时必须是 `/img/admin/gifts/`、`/img/bilibili-gifts/` 或 `/img/overtime-machine/` 内置路径 |
| `mode`(必填) | `fixed`、`random` 或 `display` |
| `quantityMode` | `group`(默认,按连击组)或 `item`(按具体数量) |
| `enabled` | 默认 true;**启用的规则 ≤ 8 条** |
| `sortOrder` | 整数 |
| `fixedEffect`(mode=fixed) | `{operation, value}`:operation ∈ `add`/`subtract`/`multiply`/`divide`/`clear`;add/subtract 的 value ∈ **0–315,328,464,000**;multiply/divide 的 value ∈ **2–1,000**;clear 的 value = 0 |
| `outcomes`(mode=random) | **2–10 项**,每项 `{operation, value, weight}`;weight ∈ **1–100,000**;**总权重 ≤ 100,000** |
| `displayText`(mode=display) | 1–6 个 Unicode 字符；不得包含控制字符；收到礼物时只展示文字，不修改剩余时间 |

行为文档:[overtime.md](overtime.md)。

## 12. 调试域(debug)

> 模块文件:[src/server/routes/debug-routes.js](../../../src/server/routes/debug-routes.js)
> 前缀:`/api/debug/`

暴露原始礼物消息缓冲区(容量 500)供问题排查;`context.debug` 不存在时返回空值而非报错。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/debug/gift-messages` | 无 | `{messages, stats}` | — |
| `GET /api/debug/gift-stats` | 无 | `{…统计}` | — |
| `POST /api/debug/gift-messages/clear` | 无 body 要求 | `{cleared: true}` | — |

行为文档:[server-core.md](server-core.md) §5(运行时组件装配:messageBuffer)。

## 13. 数据清理域(data)

> 模块文件:[src/server/routes/data-routes.js](../../../src/server/routes/data-routes.js)
> 前缀:`/api/database/`

清空类端点统一经 `clearRoute` 包装:body 必须 `{confirm: true}`,否则 **400** `缺少清空确认。`;成功后广播对应快照。清库范围见 [storage.md](storage.md) §6。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `POST /api/database/clear` | `{confirm: true}` | 清点歌库(songs/分类/导入批次,保留 settings 与主题);广播 `database:clear` | 400 |
| `POST /api/database/clear-superchats` | `{confirm: true}` | 清 SC 库;广播 `database:clear-superchats` | 400 |
| `POST /api/database/clear-playback` | `{confirm: true}` | 清播放历史与队列态(保留收藏/歌单);广播 `database:clear-playback` | 400 |
| `POST /api/database/clear-gifts` | `{confirm: true}` | 清礼物事件+结算流水(保留加班机状态/规则);广播 `database:clear-gifts` | 400 |
| `POST /api/database/clear-all` | `{confirm: true}` | **清五库全部业务数据**(见 §13.1);调用前静默异步写入器;成功广播 `database:clear-all` | 400、**500**(部分失败,见 §13.1) |
| `GET /api/database/stats` | 无 | `{schemaVersions, tables}`(各库版本 + 保留期统计行数/时间范围/raw_json 字节数) | — |
| `POST /api/database/retention` | `{dryRun?`, `confirm?`, `policy?}`:`dryRun: true` 只统计不删除(**免 confirm**,不广播);否则需 `confirm: true` | 保留策略执行统计;非 dryRun 广播 `database:retention` | 400(`缺少清理确认。`) |

### 13.1 Clear-All 部分失败契约

`POST /api/database/clear-all` 使用两阶段提交,可能返回部分失败状态:

**成功响应(HTTP 200)**:
```json
{
  "ok": true,
  "data": {
    "cleared": true,
    "scope": "all",
    "preserved": ["settings", "ai_configuration", "theme_presets", "overtime_machine_state", "overtime_gift_rules", "favorites", "playlists", "playlist_tracks"],
    "deletedCounts": {
      "songs": 100, "categories": 5, "queue": 10, "requests": 200,
      "importBatches": 3, "userCooldowns": 50, "aiRequestLogs": 1000,
      "aiApiUsage": 12, "aiViewerContext": 5, "aiQueryCache": 20, "aiBlacklist": 2,
      "sc": 30, "gifts": 500, "overtimeSettlements": 10,
      "playHistory": 300, "playQueueState": 1, "checkins": 80
    },
    "totalDeleted": 2328,
    "recreated": ["song_categories", "overtime_machine_state"]
  }
}
```

**部分失败响应(HTTP 500)**:
```json
{
  "ok": false,
  "partial": true,
  "error": "Commit failed at giftDb",
  "data": {
    "ok": false,
    "partial": true,
    "committed": ["songDb", "superChatDb"],
    "failed": ["giftDb"],
    "deletedCounts": { /* 各表统计,包括失败库的预统计 */ },
    "results": [
      {"db": "songDb", "status": "committed"},
      {"db": "superChatDb", "status": "committed"},
      {"db": "giftDb", "status": "failed", "error": "database is locked"}
    ]
  }
}
```

**部分失败处理要求**:
- 前端检测 `response.partial === true` 时**强制刷新页面**并提示用户数据库不一致,需手动检查
- 部分失败后异步写入器(礼物检测/加班机恢复)**不恢复**,避免向不一致数据库写入
- `committed` 数组列出已清空的库,`failed` 列出失败的库
- 数据库处于不一致状态,建议用户手动清理或恢复备份

**静默协调(Quiesce)**:
清空全部前路由调用:
- `context.gifts.pauseDetection()`:暂停礼物检测写入
- `context.overtime.pauseRecovery()`:暂停加班机后台恢复

成功后恢复:
- `context.gifts.resumeDetection()`
- `context.overtime.resumeRecovery()`

行为文档:[server-core.md](server-core.md) §5、[storage.md](storage.md) §6(清空矩阵详细说明)。

## 14. AI 域(ai)

> 模块文件:[src/server/routes/ai-routes.js](../../../src/server/routes/ai-routes.js)
> 前缀:`/api/ai`

`ALLOWED_KEYS`([ai-routes.js:7-15](../../../src/server/routes/ai-routes.js#L7-L15)):`enabled, trigger, modelProvider, deepseekResponsesUrl, modelApiProtocol, deepseekApiKey, model, webSearchEnabled, reasoningEnabled, reasoningEffort, qweatherApiHost, qweatherApiKey, amapApiHost, amapApiKey, weatherEnabled, placesEnabled, routesEnabled, replyMaxChars, generationConcurrency, queueLimit, sendIntervalMs, userCooldownSeconds, roomLimitPerMinute, requestTimeoutMs, maxToolCalls, cacheTtlSeconds, contextTtlSeconds, systemPrompt`;`modelProvider` 固定枚举为 `auto, deepseek, openai, anthropic, gemini, custom`，官方预设的地址与协议由服务端强制；密钥键 `SECRET_KEYS = {deepseekApiKey, qweatherApiKey, amapApiKey}` 与 settings 隔离存 `ai_configuration` 表(见 [storage.md](storage.md) §3.1)。

**密钥字段安全契约**:GET 响应与 PUT 响应均**不回显密钥明文**;GET 返回 `has*ApiKey` 布尔标志(`hasDeepSeekApiKey, hasQWeatherApiKey, hasAmapApiKey`),密钥字段本身**不出现**在响应中;PUT 请求时传 `''` 跳过更新(保留现值)、传非空字符串更新、传 `null` 清空。前端渲染已保存密钥为 `'********'` 遮罩,提交时过滤该遮罩值(等同跳过)。

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/ai/config` | 无 | AI 配置(`getPublicConfig()`):密钥字段不出现；包含 `has*ApiKey` 与无密钥 `modelEndpoint {protocol, provider, webSearchMode, reasoningMode}` | — |
| `PUT /api/ai/config` | body:仅 `ALLOWED_KEYS` 子集生效(其余忽略);密钥键传 `''` 跳过、传 `null` 置空 | 更新后的配置(同 GET,密钥不回显) | 400(`AI 配置无效。`) |
| `GET /api/ai/status` | 无 | AI 运行状态 | — |
| `POST /api/ai/models` | `{apiKey?, apiUrl?, modelProvider?, modelApiProtocol?}`；Key ≤ 512、URL ≤ 2048、两个枚举字段各 ≤ 32 字符 | 当前模型服务的模型列表；官方供应商忽略 `apiUrl`/协议覆盖 | 400(字段、枚举或上游响应无效) |
| `POST /api/ai/test` | 无 | DeepSeek 连通性测试 | **502**(`{ok:false, error}`) |
| `POST /api/ai/test/deepseek` | 无 | 该 Provider 连接测试 | **502** `{ok:false, code(≤80 字符), error}` |
| `POST /api/ai/test/qweather` | 无 | 同上(和风天气) | 502 |
| `POST /api/ai/test/amap` | 无 | 同上(高德地图) | 502 |

行为文档:[ai.md](ai.md)。

## 15. Bilibili 域(bilibili)

> 模块文件:[src/server/routes/bilibili-routes.js](../../../src/server/routes/bilibili-routes.js)
> 前缀:`/api/bilibili/`

| 端点 | 请求 | 响应(data) | 错误码 |
|---|---|---|---|
| `GET /api/bilibili/avatar?url={https图片地址}` | 仅接受 `https://*.hdslb.com/*`，沿用 session token | Node 后端代取头像或弹幕表情并以内联图片返回，浏览器缓存 1 小时；保留既有 `avatar` 路径名以兼容旧消费者 | 400、502 |
| `GET /api/bilibili/auth/state` | 无 | 登录状态 `{loggedIn, uid, message}`;非 Electron 环境返回 `{loggedIn:false, uid:0, message:'Bilibili 登录仅在 Electron 桌面环境中可用。'}` | 500 |
| `POST /api/bilibili/reconnect` | 无 | 手动重连结果;失败时同步更新 `liveStatus` | **500** `{ok:false, error, detail, data:{liveStatus}}` |
| `GET /api/bilibili/danmaku/state` | 无 | 弹幕发送器状态 + 设置 `checkinBlessings/fortunePool/customReplyRules` | 500 |
| `POST /api/bilibili/danmaku/send` | `{message`(**必填**,去空格后非空,否则 400 `弹幕内容不能为空。`), `mentionRequester?`(`true` 时@点歌观众)} | 发送结果 | 400、**502**(`{ok:false, error, detail}`,error 为 `publicDanmakuSendErrorMessage` 的人话文案:频率限制/未登录/房间号不对/风控 code=-352/拦截 code=-412/参数 code=-400/网络异常等) |

行为文档:[bilibili/danmaku.md](bilibili/danmaku.md)。
# 小游戏 API

`GET /api/games/viewers` 先按需触发一次在线榜拉取，再返回当前在线快照中的直播间观众候选；
`GET /api/games/draw-guess/categories` 返回固定题库的分类摘要 `[{id,label,count}]`，不返回具体词条；当前内置 9 类、每类 100 词，共 900 个规范化后不重复的可画词条；
`GET /api/games/session` 返回当前公开游戏状态（数字炸弹不会返回炸弹位置；你画我猜在作画阶段不会返回题词或别名）；胜利后附加临时 `winner:{role:'host'|'viewer',uid,name}`，仅用于胜利展示；
`GET /api/games/host-state` 返回你画我猜主持状态 `{game,word,category,categoryIds,phase,round,totalRounds}`，供 Admin 私下显示题词并恢复本场所选分类；它沿用 session token，但不得由 `/games` 直播画面渲染；
`GET /api/games/winner-profile` 按当前会话的 `winner` 临时查询 Bilibili 头像，返回 `{avatarUrl,name}`，没有胜者或查询失败时字段为空，不写入存储；`/games` 把该地址和你画我猜弹幕头像统一交给 `GET /api/bilibili/avatar` 代取，因此数字炸弹、五子棋结算与画猜消息不直接加载 CDN HTTPS；
`POST /api/games/session` 接受 `{game, mode, targetUid, targetName}` 开始会话；`draw-guess` 还可接受整数 `totalRounds`（1–12）、`roundDurationSeconds`（15–300）和分类 ID 数组 `categoryIds`。轮数与时长缺失或越界时分别回退为 5 和 90；`categoryIds` 缺失时使用全部分类，显式空数组、未知分类或非法 ID 返回 400，重复 ID 会去重，只有所选分类进入本场随机题池。`game` 为 `number-bomb|gomoku|draw-guess`；也接受 `{action:"stop"}` 结束会话，或在数字炸弹/五子棋结算后接受 `{action:"restart"}`，按相同游戏、模式和指定观众原子重开下一局。未结算时重开返回 409；已有会话时普通开始请求返回 **409** `{ok:false,error:'已有游戏正在进行，请先结束当前游戏。'}`，不会覆盖旧会话；
`POST /api/games/session/move` 接受主播的 `{value}` 落子；你画我猜使用 `{value:{action:'finish-round'|'reveal-answer'|'next-round'}}` 结束作画、公布答案或开始下一题。时间到后会进入待公布状态，`reveal-answer` 前公开状态不含答案且弹幕仍会被收集但不计分；
`POST /api/games/session/draw` 接受 `{action:'append',clientId,strokeId,color,width,points:[{x,y}]}`、`{action:'clear',clientId}` 或 `{action:'undo',clientId}`。撤销由服务端按当前最后一笔决定，并在广播中带回被撤销的 `strokeId`；服务端只允许固定颜色/笔宽、1–32 个归一化坐标、最多 160 笔和每局 6000 个坐标，成功返回 `{revision}` 并广播 `game:draw`。没有可撤销笔画时返回稳定的 400 错误。所有端点沿用现有 session token 与 `{ok,data}` 信封。

你画我猜为内存会话，默认五局、每局 90 秒，允许配置 1–12 局和每局 15–300 秒；固定题库由 `src/games/draw-guess-words.js` 拥有，题目可带 `|` 分隔的等价答案，但分类摘要不会暴露这些词条。服务端单计时器到时结束作画并等待主播公布答案。会话公开状态保留本局开始后收到的弹幕（最多 500 条，含 uid、昵称、内容和可选头像地址），直到会话结束；观众弹幕按完整答案匹配，同一 UID 每局只计分一次，第 1/2/3 位分别得 10/7/5 分，其余答对者得 3 分，时间到后不再计分。

## 独立转盘 API

`GET /api/wheel` 返回当前内存中的转盘配置、总份数、最近结果、活动抽取动画和服务端 `limits:{minEntries,maxEntries,maxLabelLength,minWeight,maxWeight,maxTotalWeight}`；`POST /api/wheel/config` 接受 `{entries:[{label,weight}]}`，服务端限制 2–12 个不重复内容、每项 1–100 份、总份数不超过 300；`POST /api/wheel/spin` 按服务端权重抽取并广播 `wheel:update`。转盘 service 与 `/api/games/session` 独立，不参与数字炸弹、五子棋或你画我猜的单会话互斥。所有端点沿用现有 session token 与 `{ok,data}` 信封。
