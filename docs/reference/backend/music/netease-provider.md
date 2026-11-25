# 网易云音乐 Provider — 上游 API 逆向工程

> 涉及文件:[netease-provider.js](../../../../src/music/providers/netease-provider.js)、[netease-weapi.js](../../../../src/music/providers/netease-weapi.js)、[netease-mappers.js](../../../../src/music/providers/netease-mappers.js)、[lyric-parser.js](../../../../src/music/lyric-parser.js)(歌词解析器)、[stream-resolver.js](../../../../src/music/stream-resolver.js)(流解析编排)、[track-contract.js](../../../../src/music/track-contract.js)

本文档是网易云音乐**上游接口**（`music.163.com`）逆向实现的单一事实来源，涵盖 weapi 加密算法、Cookie 语义及 12 个上游端点。Cookie 持久化（登录分区、快照加密）见 [auth.md](../../desktop/auth.md)；本地 `/api/music/*` 端点清单见 [api.md](../api.md) 的 music-routes 节；QQ 侧见 [qq-provider.md](qq-provider.md)；Provider 注册、共享歌词解析与跨平台流解析编排见 [services.md](services.md)（§3 / §4 / §14）。

**内部模块边界：** `netease-provider.js` 负责对外接口契约、Cookie/端点请求与流程编排；`netease-weapi.js` 是无状态的 weapi 加密工具；`netease-mappers.js` 仅负责将上游响应映射为内部曲目/歌单结构。加密与映射模块不得反向引用 Provider 实例或发起网络请求。

## 1. 上游域名

| 域名            | 用途                                                | 出处                                                                            |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `music.163.com` | 全部 API 的基础域名(明文接口 + `/weapi/*` 加密接口) | [netease-provider.js](../../../../src/music/providers/netease-provider.js) |

所有请求 `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`,`REQUEST_TIMEOUT_MS = 10000`([netease-provider.js](../../../../src/music/providers/netease-provider.js));流 URL TTL `STREAM_TTL_MS = 5 * 60 * 1000`([netease-provider.js](../../../../src/music/providers/netease-provider.js))。

## 2. weapi 加密常量

| 常量               | 值                                                                                                                                                                                                                                                                                                    | 出处                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `WEAPI_NONCE`      | `'0CoJUm6Qyw8W8jud'`(内层 AES 固定 key)                                                                                                                                                                                                                                                               | [netease-weapi.js](../../../../src/music/providers/netease-weapi.js)   |
| `WEAPI_IV`         | `'0102030405060708'`(两层 AES 共用 16 字节 IV)                                                                                                                                                                                                                                                        | [netease-weapi.js](../../../../src/music/providers/netease-weapi.js) |
| `WEAPI_PUBLIC_KEY` | `'010001'`(RSA 公钥指数 e = 65537)                                                                                                                                                                                                                                                                    | [netease-weapi.js](../../../../src/music/providers/netease-weapi.js) |
| `WEAPI_MODULUS`    | `'00e0b509f6259df8642dbc35662901477df22677ec152b5f5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741ad8f16f4353b8b1cb4d20a7e1cdde46f'(257 hex 字符,含前导 00,1024-bit) | [netease-weapi.js](../../../../src/music/providers/netease-weapi.js) |

## 3. weapi 加密算法(逐步)

入口 `encryptNeteaseWeapiPayload(payload)`([netease-weapi.js](../../../../src/music/providers/netease-weapi.js)):

```
Step 1 生成随机 key
  secretKey = crypto.randomBytes(16).toString('hex').slice(0, 16)
  // 16 随机字节 → 32 hex 字符 → 截前 16 字符作为 16 字节 ASCII key

Step 2 内层 AES-128-CBC
  inner = aesEncrypt(JSON.stringify(payload), WEAPI_NONCE)
  // key = '0CoJUm6Qyw8W8jud', iv = '0102030405060708', 输出 base64

Step 3 外层 AES-128-CBC(输出即 params 字段)
  params = aesEncrypt(inner, secretKey)
  // 明文是 Step 2 的 base64 字符串

Step 4 RSA 生成 encSecKey
  4a  reversedHex = Buffer.from(secretKey).reverse().toString('hex')   // 字节序反转
  4b  enc = modularPower(BigInt('0x' + reversedHex), BigInt('0x' + WEAPI_PUBLIC_KEY),
                          BigInt('0x' + WEAPI_MODULUS))                // c = m^e mod n
  4c  encSecKey = enc.toString(16).padStart(256, '0')                  // 定长 256 hex 字符

POST body(application/x-www-form-urlencoded):
  params=<step3>&encSecKey=<step4>
```

`aesEncrypt(text, key)`([netease-weapi.js](../../../../src/music/providers/netease-weapi.js)):标准 `crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(WEAPI_IV))`,无 padding 参数(默认 PKCS7),`cipher.update` + `cipher.final` 后 base64。

`modularPower(base, exponent, modulus)`([netease-weapi.js](../../../../src/music/providers/netease-weapi.js)):BigInt 平方乘算法(square-and-multiply),`result` 从 `1n` 起,按 exponent 位逐位累乘。

## 4. 请求头与 CSRF

**GET 请求**([netease-provider.js](../../../../src/music/providers/netease-provider.js)):

```
Accept: application/json,text/plain,*/*
Referer: https://music.163.com/
User-Agent: Mozilla/5.0 SongAssistant/1.0
Cookie: <整串>      # getSafeCookieHeader() 非空才设置
```

**weapi POST**([netease-provider.js](../../../../src/music/providers/netease-provider.js)):

```
Accept: application/json,text/plain,*/*
Content-Type: application/x-www-form-urlencoded
Cookie: <整串>                    # 始终设置
Origin: https://music.163.com
Referer: https://music.163.com/
User-Agent: Mozilla/5.0 SongAssistant/1.0
```

## 5. Cookie 分析

| Cookie    | 用途          | Provider 角色                                                                                                                                                                                                                                                                      |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MUSIC_U` | 用户会话令牌  | **透传**:跟随 Cookie 头,Provider 不解析;`auth.loggedIn` 由外部认证状态提供                                                                                                                                                                                                         |
| `__csrf`  | CSRF 防护令牌 | **主动提取**([netease-provider.js](../../../../src/music/providers/netease-provider.js)),同时注入两处:加密前 payload 的 `csrf_token` 字段 + URL 查询参数 `?csrf_token=<值>`([netease-provider.js](../../../../src/music/providers/netease-provider.js)) |

`extractCookieValue(cookieHeader, '__csrf')`([netease-mappers.js](../../../../src/music/providers/netease-mappers.js)):按 `;` 分割后 `startsWith('__csrf=')` 匹配。登录分区与快照持久化见 [auth.md](../../desktop/auth.md)。

## 6. 请求方法

所有 JSON 响应均通过[共享响应体读取器](../../../../src/shared/response-body.js)限制为 16 MiB；超限时立即中止上游读取，错误信息不拼接原始大正文。

| 方法                                  | 用途                | 要点                                                                                                                                                                                      |
| ------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestJson(pathname, params, expectedCookie?, cookieHeader?)` | GET 明文接口 | 每日推荐及资料查询可使用本次登录判断取得的请求头。后续分页或等待并发槽位后重新读取。传入账号约束时发送前核对，资料返回后也核对当前账号。空响应体返回 `{}`。[实现](../../../../src/music/providers/netease-provider.js) |
| `requestWeapiJson(pathname, payload)` | POST weapi 加密接口 | payload 注入 `csrf_token` 后走 §3 加密，`URLSearchParams` 编码，URL 附 `csrf_token` 查询参数（[netease-provider.js](../../../../src/music/providers/netease-provider.js)）  |

## 7. 上游端点详解(12 个)

| #   | 端点                | 路径                                | 登录     | 文档节 |
| --- | ------------------- | ----------------------------------- | -------- | ------ |
| 1   | 搜索                | `/api/search/get/web`               | 否       | §7.1   |
| 2   | 播放 URL 解析       | `/api/song/enhance/player/url/v1`（按账号权益返回）                | 否       | §7.2   |
| 3   | 歌词                | `/api/song/lyric/v1`                | 否       | §7.3   |
| 4   | 推荐歌单            | `/api/personalized/playlist`        | 否       | §7.4   |
| 5   | 每日推荐            | `/api/v1/discovery/recommend/songs` | **是**   | §7.5   |
| 6   | 新歌(电台)          | `/api/personalized/newsong`         | 否       | §7.6   |
| 7   | 我喜欢              | 组合:用户资料 + 用户歌单 + 歌单详情 | **是**   | §7.7   |
| 8   | 我的歌单 / 收藏歌单 | `/api/user/playlist`                | **是**   | §7.8   |
| 9   | 歌单详情            | `/api/v6/playlist/detail`           | 否(公开) | §7.9   |
| 10  | 最近播放            | `/api/play-record`                  | **是**   | §7.10  |
| 11  | 歌单写入            | `/weapi/playlist/manipulate/tracks` | **是**   | §7.11  |
| 12  | 用户资料            | `/api/nuser/account/get`            | **是**   | §7.12  |

### 7.1 搜索([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
GET https://music.163.com/api/search/get/web?s=<关键词>&type=1&limit=<1-30 默认20>&offset=<0-300 默认0>
```

- `s` 必填(空抛"缺少搜索关键词");`limit`/`offset` 由 `clampInteger` 限制
- 搜索与健康检查共用 `readSearchSongs` 校验：仅当上游业务 `code=200` 且返回 `result.songs[]` 或明确 `result.songCount=0` 时视为成功；业务报错保留错误码与上游 `message`/`msg`，缺少结果结构时直接报错（不视为空结果）。本地持有登录 Cookie 不代表搜索接口可用。
- 响应 `data.result.songs[]` → `mapTracksWithArtwork` → `mapNeteaseSong`(见 §8.1)；缺少专辑封面的歌曲按去重 ID 每批最多 100 首请求 `/api/song/detail` 补全，失败保留原列表并沿用歌手图片回退（[netease-provider.js](../../../../src/music/providers/netease-provider.js)）。
- 全民 K 歌只为匹配歌词搜索时传入 `includeCovers: false`，直接使用搜索响应里的曲目信息。
- 健康检查复用:`s=晴天, type=1, limit=1`([netease-provider.js](../../../../src/music/providers/netease-provider.js))

### 7.2 播放 URL 解析([netease-provider.js](../../../../src/music/providers/netease-provider.js))

`resolvePlayableUrl` 校验数字歌曲 ID 后请求 `GET /api/song/enhance/player/url/v1`，参数为 `ids`、`level` 和 `encodeType`。支持 standard/higher/exhigh/lossless/hires，后两档请求 FLAC，其余 MP3。

- 以当前账号获得的上游结果决定播放/试听权益；无 URL 直接失败，返回地址必须是 HTTP(S)。
- 有效期使用上游正数 `expi` 秒；缺失或无效才回退 5 分钟，`expireAt/playUrlExpireAt` 同值。
- 返回 `trial/trialStartMs/trialEndMs`、请求和实际品质等信息，试听边界由上游 `freeTrialInfo` 转为毫秒。
- 此方法每次执行请求；外层缓存和刷新编排见 [services.md](services.md)。

### 7.3 歌词([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
GET https://music.163.com/api/song/lyric/v1?id=<歌曲ID>&cp=false&lv=0&kv=0&tv=0&rv=0&yv=0&ytv=0&yrv=0
```

接口同时请求普通歌词（LRC）、YRC 逐字歌词及对应的翻译和罗马音。存在有效 `yrc.lyric` 时优先按 YRC 行时间构建歌词，翻译依次取 `ytlrc.lyric` / `tlyric.lyric`，罗马音依次取 `yromalrc.lyric` / `romalrc.lyric`。即使 LRC 与 YRC 行时间不一致，也保留 YRC 逐字时间；相邻词时间标记之间的原文（含空格与括号内容）完整归入该词。

没有有效 YRC 时解析 `lrc.lyric` 及普通翻译、罗马音，再调用 `estimateWordTimings(lines, track.durationMs)` 生成估算逐字时间，供内置和外部播放器共用；具体解析与估算规则见 [音乐服务 §14](services.md#14-歌词解析器srcmusiclyric-parserjs)。

### 7.4 推荐歌单([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
GET https://music.163.com/api/personalized/playlist?limit=<1-30 默认9>
```

响应 `data.result[]` → `mapNeteasePlaylist`(见 §8.2)。无需登录。

### 7.5 每日推荐([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
GET https://music.163.com/api/v1/discovery/recommend/songs      # 无查询参数
```

- `requireLogin('每日推荐需要先登录网易云音乐。')`
- 服务端返回**当天固定一份**歌单,不分页;客户端用 `sliceByPage(songs, limit, page)` 开窗口翻页
- `sliceByPage`([netease-mappers.js](../../../../src/music/providers/netease-mappers.js)):`start = ((page-1)*limit) % items.length`,窗口不足从开头补齐——**取完绕回开头**,同一天内换页不会出现新歌
- `limit` clamp 1-100 默认 30;`page` clamp 1-50

### 7.6 新歌(电台)([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
GET https://music.163.com/api/personalized/newsong?limit=100
```

- `limit` **硬编码 `'100'`**(接口忽略 offset,注释:一次多拿再按 page 切窗口)
- 响应 `data.result[]`,每项取 `item.song || item` → `sliceByPage` → `mapNeteaseSong`
- 无需登录

### 7.7 我喜欢([netease-provider.js](../../../../src/music/providers/netease-provider.js))

分页加载可使用[音乐服务的加载会话](services.md#62-首页内容getmusichomecontentmusic-catalog-servicejs)复用本次喜欢歌单定位及完整曲目 ID 快照，在 Provider 内按 `offset/limit` 切片后拉取详情，不依赖歌单详情接口的 `s` 参数分页。

组合流程：

1. 读取当前完整 Cookie 定位加载会话，再通过 `getLoginCookieHeader` 校验登录态和起始凭据。即使省略 `loadingSession`，检测到 Cookie 变化也会清除旧账号的分页快照。
2. `getLikedPlaylistId()` 使用起始凭据，先经 `getUserProfile()`（§7.12）拿到 `userId`，再调 `getUserPlaylists(userId, { limit: 50 })` 定位标题含「喜欢」的歌单；未找到则提示重新登录。
3. 随后沿用同一起始凭据调用 `getPlaylistTracks` 拉取索引、分页详情和缺失封面；凭据一致性校验与换号丢弃规则见 §7.9。

`limit` clamp 1-5000 默认 200;`offset` clamp 0-200000。

修改歌单时，前端已有的特殊目标 `playlist.id = 'liked'` 在登录校验后复用上述用户范围的解析；`writePlaylistTracks` 只把解析出的数字 ID 发给上游。普通数字歌单 ID 和 QQ Provider 的行为不变。

删除成功的回执包含实体 `playlistId`。可确认喜爱歌单身份时，回执还包含布尔值 `isLikedPlaylist`。读取用户歌单时，Provider 在按所有者筛选前核对上游前 50 个位置，在内存中按账号凭据摘要保留结果 5 分钟。此期间删除数字 ID 歌单可直接复用该结果。冷启动或过期时，数字 ID 删除成功后才按当前账号解析别名。若这次读取失败，回执仍确认实体 ID，省略 `isLikedPlaylist`。

### 7.8 我的歌单 / 收藏歌单([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
GET https://music.163.com/api/user/playlist?uid=<userId>&limit=<1-500 默认200>&offset=0
```

两个方法共享 `getUserPlaylists(userId, {limit})`([netease-provider.js](../../../../src/music/providers/netease-provider.js)),然后按 `creatorUserId` 与自己的 userId 是否相等分流:

| 方法                    | 过滤                                 |
| ----------------------- | ------------------------------------ |
| `getCreatedPlaylists`   | `creatorUserId === userId`(我创建的) |
| `getCollectedPlaylists` | `creatorUserId !== userId`(我收藏的) |

均需 `requireLogin`。

### 7.9 歌单详情([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
GET https://music.163.com/api/v6/playlist/detail?id=<歌单ID>&n=0&s=0
GET https://music.163.com/api/song/detail?ids=<当前页曲目ID JSON数组，每批最多100个>
```

- 播放器打开普通歌单时，以 `action=playlist-tracks` 向 `POST /api/music/home` 请求最多 5000 首。Provider 按 `trackIds[]` 的顺序切片，`limit` 为 1–5000（默认 1000），`offset` 为 0–200000。公开歌单支持匿名读取。
- 每 100 个不同 ID 读取一批 `/api/song/detail`，末批可少于 100 个。详情只在这次读取中复用，输出恢复原索引顺序和重复位置。有索引时，同一响应内附的 `tracks[]` 可能只是摘要。歌曲名称、可播放状态、VIP 标记和封面取自详情，封面仍按专辑图、歌手图的顺序回退。
- 单个普通歌单最多并发请求 2 批详情（仅在有空闲名额时启动第 2 批）；单个 Provider 实例内，歌单索引、详情和无索引封面补查共享 6 个并发名额（与目录服务成员检测并发数一致）。「我喜欢」已缓存完整曲目与封面时直接命中返回，未命中分页及成员检测回退均按单批串行拉取。每批完成后校验 ID 完整度并立即释放名额；任一批失败或缺歌时，等待另一批在途请求结束后整体报错。
- **Cookie 一致性校验**：普通歌单在确定 ID 后记录当前完整 Cookie，「我喜欢」沿用 §7.7 起始 Cookie。索引、详情和补图请求在获得名额后、发出前、收到响应后及交付缓存页前均复核凭据一致性；一旦检测到 Cookie 变化（含换号或退出，即使同账号刷新或随后恢复原 Cookie），旧调用立即终止并丢弃迟到结果，提示重新打开歌单。
- 响应不含 `trackIds[]` 时，仅当 `tracks[]` 数量已覆盖声明的总曲目数才允许本地切片；索引不足、ID 无效或所需详情缺失一律报错，不返回不完整的分页。
- **成员检测** `playlistContainsTrack(playlistId, track)`（[netease-provider.js](../../../../src/music/providers/netease-provider.js)）：调用同一端点（`n=0&s=0`）拉取轻量 `data.playlist.trackIds[]`（每项 `item.id || item`）比对 ID。若缺少 `trackIds`，当响应中的 `tracks` 数量已覆盖明确返回的非负总数时，直接在前 5000 首内比对以省去详情和封面请求；总数未知、列表缺失或截断时沿用本次凭据重新完整读取歌单并校验完整性。该结果用于收藏和去重标注。

### 7.10 最近播放([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
GET https://music.163.com/api/play-record?uid=<userId>&type=1
```

- `requireLogin`;`uid` 来自 `getUserProfile()`,`type=1`(歌曲)
- 响应 `data.weekData[]` → 每项 `row.song` → 过滤 → `slice(0, limit)` → `mapNeteaseSong`
- `limit` clamp 1-100 默认 50

### 7.11 歌单写入([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
POST https://music.163.com/weapi/playlist/manipulate/tracks?csrf_token=<csrfToken>
Content-Type: application/x-www-form-urlencoded
```

weapi 加密前 payload:

```json
{
  "op": "add | del",
  "pid": "<歌单ID 纯数字>",
  "trackIds": "[\"123\",\"456\"]",
  "imme": "true",
  "tracks": "[{\"type\":3,\"id\":\"123\"},...]",
  "csrf_token": "<csrfToken>"
}
```

语义要点:

- `pid` 必须纯数字(`/^\d+$/`),否则抛"缺少网易云歌单 ID";曲目 id 必须全是数字(`normalizeNeteasePlaylistTrackIds`,[netease-mappers.js](../../../../src/music/providers/netease-mappers.js)),`tracks` 里 `type: 3`(歌曲类型)
- **成功判定**:`code === 200` → `{ playlistId, songlist: [{songId, existed: 0}] }`
- **`code === 502` 且 op 为 add** → 歌曲已在歌单,返回 `existed: 1` 标记(不抛错)— 这是"重复添加"语义,调用方可据此提示
- 其余 code → 抛"网易云音乐歌单写入失败(code=…,message)"

### 7.12 用户资料([netease-provider.js](../../../../src/music/providers/netease-provider.js))

```
GET https://music.163.com/api/nuser/account/get
```

- 需要登录(`MUSIC_U` Cookie,由认证层保证)
- 响应 `data.profile.userId`(必须非空,否则抛"未能读取网易云用户资料,请重新登录后再试。")/ `profile.nickname`
- 返回值 `{ userId: String, nickname: String }`,是每日推荐之外多个账号操作的公共前置(§7.7/7.8/7.10)
- Provider 按完整 Cookie 的 SHA-256 保存最近一次成功资料，期限 5 分钟。未命中时用本次核对过的 Cookie 发出资料请求，响应后重新读取当前凭据，再发布资料。命中时也读取当前凭据以识别换号。匿名与失败结果允许立即重试。

### 7.13 健康检查([netease-provider.js](../../../../src/music/providers/netease-provider.js))

健康检查读取含备份元数据的状态，用同一次分区读取取得的 Cookie 执行 §7.1 搜索探测（`晴天`，`limit=1`）。`readSearchSongs` 校验业务响应。成功时按登录态返回 `logged-in` 或 `public-ok`，HTTP、业务码或结果结构失败时返回 `api-error`。两种情况下 `auth` 都通过 `sanitizeAuthState` 返回本地状态。

## 8. 映射函数

### 8.1 mapNeteaseSong([netease-mappers.js](../../../../src/music/providers/netease-mappers.js))

| 输出字段               | 取值                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| `id` / `sourceTrackId` | `netease:<song.id>` / `String(song.id)`;**`song.id` 或 `song.name` 缺失整条丢弃** |
| `sourceAlbumId`        | `album.id`(或 `al.id`),无则空串                                                   |
| `title` / `album`      | `song.name` / `album.name`(或 `al.name`),trim                                     |
| `artists`              | `artists[].name` 或 `ar[].name`,过滤空值                                          |
| `durationMs`           | `max(0, song.duration \|\| song.dt)`(毫秒,无需换算)                               |
| `coverUrl`             | 优先 `album.picUrl \|\| album.pic_url`,否则 `artists[0].img1v1Url`(搜索接口回退)  |
| `playable`             | `song.status !== -1`(-1 = 不可用)                                                 |
| `vip`                  | `song.fee === 1 \|\| song.fee === 4`                                              |

### 8.2 mapNeteasePlaylist([netease-mappers.js](../../../../src/music/providers/netease-mappers.js))

`id`/`name` 缺失丢弃;`description` = `copywriter || description`;`coverUrl` = `picUrl || coverImgUrl`;`trackCount`/`playCount` 数值化;`creatorUserId` = `creator.userId`(区分"我的/收藏"的依据)。

### 8.3 其他工具

| 函数                   | 行为                                         | 出处                                                                                         |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `extractSourceTrackId` | 剥 `netease:` 前缀,空抛"缺少网易云歌曲 ID。" | [netease-mappers.js](../../../../src/music/providers/netease-mappers.js) |
| `clampInteger`         | 同 QQ Provider 语义                          | [netease-mappers.js](../../../../src/music/providers/netease-mappers.js) |
| `sliceByPage`          | §7.5 客户端翻页(绕回语义)                    | [netease-mappers.js](../../../../src/music/providers/netease-mappers.js) |

## 9. 歌词解析器

网易云歌词响应交给共享 `lyric-parser.js` 解析。LRC/YRC/QRC 行模型、逐字匹配、翻译/罗马音容差与假名注音统一见 [音乐服务 §14](services.md#14-歌词解析器srcmusiclyric-parserjs)，不在 Provider 文档复制解析规则。

## 10. 流解析契约

网易云 Provider 实现 `getStream`；跨 Provider 的输入规范化、缓存与降级编排统一由 [音乐服务 §4](services.md#4-流解析编排stream-resolverjs--track-contractjs) 维护。上游付费音质限制仍见本文各端点说明。

## 11. 登录校验规则差异

各端点是否要求登录见 §7 汇总表，具体校验机制差异如下：

| 类别 | 校验方式 |
| --- | --- |
| 匿名可调接口（搜索 / 推荐歌单 / 新歌 / 公开歌单详情 / 歌词 / 播放 URL） | 不要求登录；其中播放 URL 实际返回完整或试听权益取决于当前账号登录态（§7.2） |
| 每日推荐 | `getLoginCookieHeader` 要求 `auth.loggedIn`，将当次 Cookie 用于请求 |
| 我喜欢 / 我的歌单 / 收藏歌单 / 最近播放 | 验证登录并通过 `getUserProfile()` 取得当前账号资料（依赖 `MUSIC_U` Cookie） |
| 歌单写入 | 验证登录，从当次 Cookie 提取 weapi 的 `__csrf` |
