# 网易云音乐 Provider — 上游 API 逆向工程

> 涉及文件:[netease-provider.js](../../../../src/music/providers/netease-provider.js)、[netease-weapi.js](../../../../src/music/providers/netease-weapi.js)、[netease-mappers.js](../../../../src/music/providers/netease-mappers.js)、[lyrics.js](../../../../src/music/lyrics.js)(歌词解析器)、[stream-resolver.js](../../../../src/music/stream-resolver.js)(流解析编排)、[track-contract.js](../../../../src/music/track-contract.js)

本文档是网易云**上游接口**(`music.163.com`)的逆向工程唯一事实源:weapi 加密算法、Cookie 语义、12 个上游端点、歌词解析器与流解析契约只在此成表。Cookie 持久化(登录分区、快照加密)见 [auth.md](../../desktop/auth.md);本地 `/api/music/*` 端点清单见 [api.md](../api.md) 的 music-routes 节。QQ 侧见 [qq-provider.md](qq-provider.md);Provider 注册与缓存编排见 [services.md](services.md)。

**内部模块边界:** `netease-provider.js` 保留 Provider 公共契约、Cookie/端点请求与流程编排；`netease-weapi.js` 是无状态的 weapi 加密边界；`netease-mappers.js` 只把上游响应归一化为内部曲目/歌单模型。加密与映射模块不得反向持有 Provider 实例或发起网络请求。

## 1. 上游域名

| 域名            | 用途                                                | 出处                                                                            |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `music.163.com` | 全部 API 的基础域名(明文接口 + `/weapi/*` 加密接口) | [netease-provider.js:6](../../../../src/music/providers/netease-provider.js#L6) |

所有请求 `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`,`REQUEST_TIMEOUT_MS = 10000`([netease-provider.js:7](../../../../src/music/providers/netease-provider.js#L7));流 URL TTL `STREAM_TTL_MS = 5 * 60 * 1000`([netease-provider.js:8](../../../../src/music/providers/netease-provider.js#L8))。

## 2. weapi 加密常量

| 常量               | 值                                                                                                                                                                                                                                                                                                    | 出处                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `WEAPI_NONCE`      | `'0CoJUm6Qyw8W8jud'`(内层 AES 固定 key)                                                                                                                                                                                                                                                               | [netease-provider.js:9](../../../../src/music/providers/netease-provider.js#L9)   |
| `WEAPI_IV`         | `'0102030405060708'`(两层 AES 共用 16 字节 IV)                                                                                                                                                                                                                                                        | [netease-provider.js:10](../../../../src/music/providers/netease-provider.js#L10) |
| `WEAPI_PUBLIC_KEY` | `'010001'`(RSA 公钥指数 e = 65537)                                                                                                                                                                                                                                                                    | [netease-provider.js:11](../../../../src/music/providers/netease-provider.js#L11) |
| `WEAPI_MODULUS`    | `'00e0b509f6259df8642dbc35662901477df22677ec152b5f5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741ad8f16f4353b8b1cb4d20a7e1cdde46f'(257 hex 字符,含前导 00,1024-bit) | [netease-provider.js:12](../../../../src/music/providers/netease-provider.js#L12) |

## 3. weapi 加密算法(逐步)

入口 `encryptNeteaseWeapiPayload(payload)`([netease-provider.js:446-452](../../../../src/music/providers/netease-provider.js#L446-L452)):

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

`aesEncrypt(text, key)`([netease-provider.js:454-457](../../../../src/music/providers/netease-provider.js#L454-L457)):标准 `crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(WEAPI_IV))`,无 padding 参数(默认 PKCS7),`cipher.update` + `cipher.final` 后 base64。

`modularPower(base, exponent, modulus)`([netease-provider.js:466-476](../../../../src/music/providers/netease-provider.js#L466-L476)):BigInt 平方乘算法(square-and-multiply),`result` 从 `1n` 起,按 exponent 位逐位累乘。

## 4. 请求头与 CSRF

**GET 请求**([netease-provider.js:285-291](../../../../src/music/providers/netease-provider.js#L285-L291)):

```
Accept: application/json,text/plain,*/*
Referer: https://music.163.com/
User-Agent: Mozilla/5.0 SongAssistant/1.0
Cookie: <整串>      # getSafeCookieHeader() 非空才设置
```

**weapi POST**([netease-provider.js:320-328](../../../../src/music/providers/netease-provider.js#L320-L328)):

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
| `__csrf`  | CSRF 防护令牌 | **主动提取**([netease-provider.js:312](../../../../src/music/providers/netease-provider.js#L312)),同时注入两处:加密前 payload 的 `csrf_token` 字段 + URL 查询参数 `?csrf_token=<值>`([netease-provider.js:315-318](../../../../src/music/providers/netease-provider.js#L315-L318)) |

`extractCookieValue(cookieHeader, '__csrf')`([netease-provider.js:438-444](../../../../src/music/providers/netease-provider.js#L438-L444)):按 `;` 分割后 `startsWith('__csrf=')` 匹配。登录分区与快照持久化见 [auth.md](../../desktop/auth.md)。

## 6. 请求方法

| 方法                                  | 用途                | 要点                                                                                                                                                                                      |
| ------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestJson(pathname, params)`       | GET 明文接口        | `new URL(pathname, NETEASE_BASE_URL)` 拼参;空响应体返回 `{}`;非 JSON 抛"返回了非 JSON 响应"([netease-provider.js:279-308](../../../../src/music/providers/netease-provider.js#L279-L308)) |
| `requestWeapiJson(pathname, payload)` | POST weapi 加密接口 | payload 注入 `csrf_token` 后走 §3 加密,`URLSearchParams` 编码,URL 带 `csrf_token` 查询参数([netease-provider.js:310-340](../../../../src/music/providers/netease-provider.js#L310-L340))  |

## 7. 上游端点详解(12 个)

| #   | 端点                | 路径                                | 登录     | 文档节 |
| --- | ------------------- | ----------------------------------- | -------- | ------ |
| 1   | 搜索                | `/api/search/get/web`               | 否       | §7.1   |
| 2   | 播放 URL 解析       | 纯字符串构造(无请求)                | 否       | §7.2   |
| 3   | 歌词                | `/api/song/lyric`                   | 否       | §7.3   |
| 4   | 推荐歌单            | `/api/personalized/playlist`        | 否       | §7.4   |
| 5   | 每日推荐            | `/api/v1/discovery/recommend/songs` | **是**   | §7.5   |
| 6   | 新歌(电台)          | `/api/personalized/newsong`         | 否       | §7.6   |
| 7   | 我喜欢              | 组合:用户资料 + 用户歌单 + 歌单详情 | **是**   | §7.7   |
| 8   | 我的歌单 / 收藏歌单 | `/api/user/playlist`                | **是**   | §7.8   |
| 9   | 歌单详情            | `/api/v6/playlist/detail`           | 否(公开) | §7.9   |
| 10  | 最近播放            | `/api/play-record`                  | **是**   | §7.10  |
| 11  | 歌单写入            | `/weapi/playlist/manipulate/tracks` | **是**   | §7.11  |
| 12  | 用户资料            | `/api/nuser/account/get`            | **是**   | §7.12  |

### 7.1 搜索([netease-provider.js:58-76](../../../../src/music/providers/netease-provider.js#L58-L76))

```
GET https://music.163.com/api/search/get/web?s=<关键词>&type=1&limit=<1-30 默认20>&offset=<0-300 默认0>
```

- `s` 必填(空抛"缺少搜索关键词");`limit`/`offset` 由 `clampInteger` 限制
- 响应 `data.result.songs[]` → `mapNeteaseSong`(见 §8.1);封面回退到 `artists[0].img1v1Url`——搜索接口不返回专辑封面,此回退零额外网络请求([netease-provider.js:73-75](../../../../src/music/providers/netease-provider.js#L73-L75))
- 健康检查复用:`s=晴天, type=1, limit=1`([netease-provider.js:29-34](../../../../src/music/providers/netease-provider.js#L29-L34))

### 7.2 播放 URL 解析([netease-provider.js:267-277](../../../../src/music/providers/netease-provider.js#L267-L277))

**纯字符串构造,零网络请求**:

```javascript
url = `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(sourceTrackId)}.mp3`;
```

- **刻意不调用 `/weapi/song/enhance/player/url`**——公开 `outer/url` 直链对任意 id 可用,免去加密请求与 VIP 校验
- TTL 硬编码 `STREAM_TTL_MS`(5 分钟),`expireAt`/`playUrlExpireAt` 同值;调用方 `forceRefresh` 参数被忽略(缓存层见 [services.md](services.md) §5)
- 无 VIP/权限语义:任何 id 都返回可拼 URL

### 7.3 歌词([netease-provider.js:246-265](../../../../src/music/providers/netease-provider.js#L246-L265))

```
GET https://music.163.com/api/song/lyric?id=<歌曲ID>&lv=-1&kv=-1&tv=-1&ytv=-1
```

四个版本参数全取 `-1`(服务端最新版):`lv` 原始 LRC、`kv` 逐字、`tv` 翻译、`ytv` 罗马音。响应 `data.lrc.lyric` / `data.tlyric.lyric` / `data.yrc.lyric` / `data.romalrc.lyric` 四路缺省为空串,汇入 `parseLyricResult(lrc, tlyric, yrc, romalrc)`(解析器见 §9)。

### 7.4 推荐歌单([netease-provider.js:78-85](../../../../src/music/providers/netease-provider.js#L78-L85))

```
GET https://music.163.com/api/personalized/playlist?limit=<1-30 默认9>
```

响应 `data.result[]` → `mapNeteasePlaylist`(见 §8.2)。无需登录。

### 7.5 每日推荐([netease-provider.js:87-98](../../../../src/music/providers/netease-provider.js#L87-L98))

```
GET https://music.163.com/api/v1/discovery/recommend/songs      # 无查询参数
```

- `requireLogin('每日推荐需要先登录网易云音乐。')`
- 服务端返回**当天固定一份**歌单,不分页;客户端用 `sliceByPage(songs, limit, page)` 开窗口翻页
- `sliceByPage`([netease-provider.js:485-493](../../../../src/music/providers/netease-provider.js#L485-L493)):`start = ((page-1)*limit) % items.length`,窗口不足从开头补齐——**取完绕回开头**,同一天内换页不会出现新歌
- `limit` clamp 1-100 默认 30;`page` clamp 1-50

### 7.6 新歌(电台)([netease-provider.js:100-111](../../../../src/music/providers/netease-provider.js#L100-L111))

```
GET https://music.163.com/api/personalized/newsong?limit=100
```

- `limit` **硬编码 `'100'`**(接口忽略 offset,注释:一次多拿再按 page 切窗口)
- 响应 `data.result[]`,每项取 `item.song || item` → `sliceByPage` → `mapNeteaseSong`
- 无需登录

### 7.7 我喜欢([netease-provider.js:113-123](../../../../src/music/providers/netease-provider.js#L113-L123))

组合流程:

1. `requireLogin('我喜欢需要先登录网易云音乐。')`
2. `getUserProfile()`(§7.12)→ userId
3. `getUserPlaylists(userId, { limit: 50 })` → 全量歌单
4. **启发式定位**:`playlists.find(p => /喜欢/.test(p.title)) || playlists[0]` — 标题含"喜欢"优先,否则取第一个歌单
5. 找不到歌单(空数组)返回 `[]`(**不抛错**);否则 `getPlaylistTracks(likedPlaylist.id, { limit, offset })`

`limit` clamp 1-5000 默认 200;`offset` clamp 0-200000。

### 7.8 我的歌单 / 收藏歌单([netease-provider.js:125-141](../../../../src/music/providers/netease-provider.js#L125-L141))

```
GET https://music.163.com/api/user/playlist?uid=<userId>&limit=<1-500 默认200>&offset=0
```

两个方法共享 `getUserPlaylists(userId, {limit})`([netease-provider.js:196-207](../../../../src/music/providers/netease-provider.js#L196-L207)),然后按 `creatorUserId` 与自己的 userId 是否相等分流:

| 方法                    | 过滤                                 |
| ----------------------- | ------------------------------------ |
| `getCreatedPlaylists`   | `creatorUserId === userId`(我创建的) |
| `getCollectedPlaylists` | `creatorUserId !== userId`(我收藏的) |

均需 `requireLogin`。

### 7.9 歌单详情([netease-provider.js:161-194](../../../../src/music/providers/netease-provider.js#L161-L194))

```
GET https://music.163.com/api/v6/playlist/detail?id=<歌单ID>&n=<1-5000 默认1000>&s=<0-200000 默认0>
```

- 响应 `data.playlist.tracks[]` → `mapNeteaseSong`;无需登录(公开歌单)
- **成员检测** `playlistContainsTrack(playlistId, track)`([netease-provider.js:177-194](../../../../src/music/providers/netease-provider.js#L177-L194)):同端点 `n=0&s=0` 拉**轻量列表** `data.playlist.trackIds[]`(每项 `item.id || item`),存在 `trackIds` 数组即线性比较;接口不返回 `trackIds` 时回退全量拉 5000 首再比对——这是"歌单是否已含此歌"的唯一判定点,供收藏/去重标注用

### 7.10 最近播放([netease-provider.js:143-159](../../../../src/music/providers/netease-provider.js#L143-L159))

```
GET https://music.163.com/api/play-record?uid=<userId>&type=1
```

- `requireLogin`;`uid` 来自 `getUserProfile()`,`type=1`(歌曲)
- 响应 `data.weekData[]` → 每项 `row.song` → 过滤 → `slice(0, limit)` → `mapNeteaseSong`
- `limit` clamp 1-100 默认 50

### 7.11 歌单写入([netease-provider.js:209-244](../../../../src/music/providers/netease-provider.js#L209-L244))

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

- `pid` 必须纯数字(`/^\d+$/`),否则抛"缺少网易云歌单 ID";曲目 id 必须全是数字(`normalizeNeteasePlaylistTrackIds`,[netease-provider.js:431-436](../../../../src/music/providers/netease-provider.js#L431-L436)),`tracks` 里 `type: 3`(歌曲类型)
- **成功判定**:`code === 200` → `{ playlistId, songlist: [{songId, existed: 0}] }`
- **`code === 502` 且 op 为 add** → 歌曲已在歌单,返回 `existed: 1` 标记(不抛错)— 这是"重复添加"语义,调用方可据此提示
- 其余 code → 抛"网易云音乐歌单写入失败(code=…,message)"

### 7.12 用户资料([netease-provider.js:366-375](../../../../src/music/providers/netease-provider.js#L366-L375))

```
GET https://music.163.com/api/nuser/account/get
```

- 需要登录(`MUSIC_U` Cookie,由认证层保证)
- 响应 `data.profile.userId`(必须非空,否则抛"未能读取网易云用户资料,请重新登录后再试。")/ `profile.nickname`
- 返回值 `{ userId: String, nickname: String }`,是每日推荐之外多个账号操作的公共前置(§7.7/7.8/7.10)

### 7.13 健康检查([netease-provider.js:26-56](../../../../src/music/providers/netease-provider.js#L26-L56))

不是独立端点,复用 §7.1 搜索探测:`getSafeAuthState()` → `requestJson('/api/search/get/web', {s:'晴天', type:'1', limit:'1', offset:'0'})`:成功 + `auth.loggedIn` → `logged-in`;成功无登录 → `public-ok`;失败 → `api-error`。`auth` 经 `sanitizeAuthState` 脱敏。

## 8. 映射函数

### 8.1 mapNeteaseSong([netease-provider.js:378-407](../../../../src/music/providers/netease-provider.js#L378-L407))

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

### 8.2 mapNeteasePlaylist([netease-provider.js:409-421](../../../../src/music/providers/netease-provider.js#L409-L421))

`id`/`name` 缺失丢弃;`description` = `copywriter || description`;`coverUrl` = `picUrl || coverImgUrl`;`trackCount`/`playCount` 数值化;`creatorUserId` = `creator.userId`(区分"我的/收藏"的依据)。

### 8.3 其他工具

| 函数                   | 行为                                         | 出处                                                                                         |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `extractSourceTrackId` | 剥 `netease:` 前缀,空抛"缺少网易云歌曲 ID。" | [netease-provider.js:423-429](../../../../src/music/providers/netease-provider.js#L423-L429) |
| `clampInteger`         | 同 QQ Provider 语义                          | [netease-provider.js:478-482](../../../../src/music/providers/netease-provider.js#L478-L482) |
| `sliceByPage`          | §7.5 客户端翻页(绕回语义)                    | [netease-provider.js:485-493](../../../../src/music/providers/netease-provider.js#L485-L493) |

## 9. 歌词解析器(src/music/lyrics.js)

**唯一歌词行模型实现**,QQ 与网易云共用(QQ 的 QRC 解密产物也喂给它,见 [qq-provider.md](qq-provider.md) §7.3)。模块只导出 4 个函数([lyrics.js:225-230](../../../../src/music/lyrics.js#L225-L230));其余为内部函数。

### 9.1 parseLyricResult(rawLyric, rawTranslation, rawWordLyric, rawRoma)

1. `parseWordLyric(rawWordLyric)` → 逐字行;`parseLrc(rawLyric)` → LRC 行
2. **LRC 非空取 LRC,空则用逐字行降级**:`lines = wordLines.map(line => ({startMs, endMs, text}))`([lyrics.js:48-50](../../../../src/music/lyrics.js#L48-L50))
3. 翻译/罗马音经 `parseTimedText`(先 LRC 后逐字)解析,各建一个 `createTimedTextResolver` 按时间戳匹配
4. 每行输出 `{ startMs, endMs, text, translation, roma, words }`:
   - `endMs` 缺失时取下一行 `startMs`([lyrics.js:69](../../../../src/music/lyrics.js#L69))
   - `roma` = API 罗马音优先,空则取 `[kana:…]` 假名注音(§9.5)
   - `words` = 逐字行按 `startMs` 精确对齐([lyrics.js:72](../../../../src/music/lyrics.js#L72))

### 9.2 parseLrc(LRC 解析,[lyrics.js:113-137](../../../../src/music/lyrics.js#L113-L137))

- 行正则 `/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g` — 支持 `[mm:ss]`、`[mm:ss.xxx]`、`[mm:ss:xxx]`
- **同一行多个时间标签 → 生成多条记录**(卡拉 OK 重复行);无时间戳的行跳过
- `toStartMs`([lyrics.js:139-147](../../../../src/music/lyrics.js#L139-L147)):小数位 3 位按毫秒直用,不足 3 位 `padEnd(3,'0')`
- 过滤负数/NaN,排序 `startMs` 升序、同值按文本字典序

### 9.3 parseWordLyric(逐字歌词,[lyrics.js:149-202](../../../../src/music/lyrics.js#L149-L202))

- 行正则 `/\[(\d+),(\d+)\]([\s\S]*)/` → `[startMs,durationMs,body]`
- **前缀词**优先:`/\((\d+),(\d+),\d*\)([^()]+)/g` → `(start,duration,?)text`
- **后缀词**仅当前缀无命中时使用:`/([^()]*)\((\d+),(\d+)\)/g` → `text(start,duration)`
- 无词的行丢弃;`text` = 词文本拼接,`endMs = startMs + max(0, durationMs)`;排序按 startMs

### 9.4 createTimedTextResolver(时间容差匹配,[lyrics.js:86-111](../../../../src/music/lyrics.js#L86-L111))

- 构造:过滤非有限 startMs → 排序 → `exact = Map(startMs → text)`
- 查询:`exact.has(startMs)` 直中;否则**二分查找**(找最后一个 `startMs < 目标` 的位置)取邻近两候选,按距离取最近,`|Δ| ≤ toleranceMs(默认 100ms)` 才命中
- 存在的理由:QQ 音乐翻译/罗马音行与原歌词有毫秒级偏移,见 [qq-provider.md](qq-provider.md) §7.3

### 9.5 假名注音与当前行

| 函数                                     | 行为                                                                                                      | 出处                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `extractKanaReadings(rawLyric)`          | 匹配 `/\[kana:([^\]]+)\]/`,`1読1み2方` 按数字切分 → `['読','み','方']`                                    | [lyrics.js:11-17](../../../../src/music/lyrics.js#L11-L17)     |
| `mapKanaToLines`                         | 逐行消费 CJK 字符(范围 U+4E00-9FFF / U+3400-4DBF / U+F900-FAFF),每字一个读音,空格连接,按 `startMs` 建 Map | [lyrics.js:19-43](../../../../src/music/lyrics.js#L19-L43)     |
| `findCurrentLyricLine(lines, currentMs)` | **二分查找最后一个 `startMs ≤ currentMs` 的行**;空数组返回 null                                           | [lyrics.js:204-223](../../../../src/music/lyrics.js#L204-L223) |

## 10. 流解析契约(stream-resolver)

`resolveMusicStream(registry, track, options)`([stream-resolver.js:7-13](../../../../src/music/stream-resolver.js#L7-L13))是播放 URL 的唯一入口,三步:

1. `normalizeMusicTrackForProvider(track)`([track-contract.js:6-37](../../../../src/music/track-contract.js#L6-L37)):校验 `id`/`sourceTrackId`/`title` 非空、`source ∈ {qq, netease}`;**artists 最多保留 8 位**(`slice(0, 8)`);归一 `sourceSongId`(≤0 置 0)、`playable`(仅显式 false 置 false)、`vip`(仅显式 true)
2. `registry.get(source)` 按平台取 Provider(注册表见 [services.md](services.md) §3)
3. `provider.resolvePlayableUrl(normalizedTrack, { forceRefresh })` — 各 Provider 的 `forceRefresh` 目前均忽略(缓存与 TTL 的编排语义见 [services.md](services.md) §5)

## 11. 登录态要求总表

| 操作                                                | 需要登录 | 判定方式                                                                                                                                                                                                 |
| --------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 搜索 / 推荐歌单 / 新歌 / 歌单详情 / 歌词 / 播放 URL | ❌       | —(播放 URL 是公开直链)                                                                                                                                                                                   |
| 每日推荐                                            | ✅       | `requireLogin('每日推荐需要先登录网易云音乐。')`([netease-provider.js:358-364](../../../../src/music/providers/netease-provider.js#L358-L364)):仅 `auth.loggedIn` 有效(**与 QQ 不同,Cookie 存在不兜底**) |
| 我喜欢 / 我的歌单 / 收藏歌单 / 最近播放             | ✅       | `requireLogin` + `getUserProfile()`                                                                                                                                                                      |
| 歌单写入                                            | ✅       | `requireLogin` + `__csrf` Cookie(weapi 加密必需)                                                                                                                                                         |
| 用户资料                                            | ✅       | 依赖 `MUSIC_U` Cookie                                                                                                                                                                                    |
