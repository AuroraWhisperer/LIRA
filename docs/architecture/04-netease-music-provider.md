# 网易云音乐 Provider — 完整 API 逆向工程文档

> 源码：[src/music/providers/netease-provider.js](src/music/providers/netease-provider.js)
> 歌词解析：[src/music/lyrics.js](src/music/lyrics.js)
> 播放流解析：[src/music/stream-resolver.js](src/music/stream-resolver.js)

---

## 涉及的域名

| 域名 | 用途 | 端口 |
|------|------|------|
| `music.163.com` | 所有 API 请求的基础域名 | HTTPS 443 |

---

## 加密常量 (weapi)

```javascript
WEAPI_NONCE    = '0CoJUm6Qyw8W8jud'  // 第一次 AES 加密的固定 key
WEAPI_IV       = '0102030405060708'  // 两次 AES 加密的固定 IV (128-bit)
WEAPI_PUBLIC_KEY = '010001'          // RSA 公钥指数 e = 65537
WEAPI_MODULUS  = '00e0b509f6259df8642dbc35662901477df22677ec152b5f5ff68ace615bb7b7...'
                 // RSA 1024-bit 模数 n (257个hex字符, 含前导00)
```

---

## weapi 加密算法（逐步骤）

```
输入: 纯 JSON payload 对象 (已注入 csrf_token)

Step 1: 生成随机 16 字符 key
  crypto.randomBytes(16).toString('hex').slice(0, 16)
  // 16 随机字节 → 32 hex 字符 → 取前 16 字符
  // 例: "a3F8cD1eB6fA9gH2"

Step 2: 第一次 AES-128-CBC 加密 (内层)
  aesEncrypt(JSON.stringify(payload), WEAPI_NONCE)
  // plaintext:  JSON 序列化的 payload
  // key:        "0CoJUm6Qyw8W8jud" (16字节 ASCII)
  // iv:         "0102030405060708" (16字节 ASCII)
  // cipher:     aes-128-cbc
  // output:     base64 编码

Step 3: 第二次 AES-128-CBC 加密 (外层)
  aesEncrypt(step2_base64_output, secretKey)
  // plaintext:  step2 的 base64 输出字符串
  // key:        随机16字符 secretKey
  // iv:         同上 "0102030405060708"
  // output:     base64 编码
  // 这就是最终的 params 字段

Step 4: RSA 加密生成 encSecKey
  4a. reversedHex = Buffer.from(secretKey).reverse().toString('hex')
      // 将 secretKey 的字节顺序反转 → hex 编码
      // 例: "a3F8cD1e" → 字节反转 → hex
  4b. modularPower(BigInt('0x'+reversedHex), 65537n, modulus_n)
      // 标准 RSA: c = m^e mod n
      // 使用平方乘算法 (square-and-multiply)
  4c. result.toString(16).padStart(256, '0')
      // 固定 256 hex 字符 (128 bytes, 1024 bits)

最终 POST body (application/x-www-form-urlencoded):
  params=<step3_base64>&encSecKey=<step4_256hex>
```

### aesEncrypt 实现

```javascript
function aesEncrypt(text, key) {
  const cipher = crypto.createCipheriv(
    'aes-128-cbc',
    Buffer.from(key),           // 16 字节 key
    Buffer.from(WEAPI_IV)       // 16 字节 IV
  );
  return Buffer.concat([
    cipher.update(String(text), 'utf8'),
    cipher.final()
  ]).toString('base64');
}
```

### RSA 模幂实现 (modularPower)

```javascript
function modularPower(base, exponent, modulus) {
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}
```

---

## 请求头

### GET 请求头

```
Accept: application/json,text/plain,*/*
Referer: https://music.163.com/
User-Agent: Mozilla/5.0 SongAssistant/1.0
Cookie: <raw cookie header string>  (非空时才设置)
```

### POST weapi 请求头

```
Accept: application/json,text/plain,*/*
Content-Type: application/x-www-form-urlencoded
Cookie: <raw cookie header>         (始终设置)
Origin: https://music.163.com
Referer: https://music.163.com/
User-Agent: Mozilla/5.0 SongAssistant/1.0
```

---

## Cookie 分析

### 关键 Cookie

| Cookie 名 | 用途 | 登录必需 |
|-----------|------|----------|
| `MUSIC_U` | 用户会话令牌 (session token) | ✅ 是 |
| `__csrf` | CSRF 防护令牌 (用于 weapi POST) | ✅ 是 |

> 注意: Provider 本身只提取 `__csrf` Cookie (用于 weapi 加密和 URL 参数)。`MUSIC_U` 跟随 Cookie header 透传，Provider 不解析它。

### CSRF Token 提取

```javascript
extractCookieValue(cookieHeader, '__csrf')
// 从 Cookie 字符串中按 ; 分割，匹配 __csrf= 前缀，返回 = 后的值
// 在 weapi POST 中同时出现在:
//   1. 加密 body 内的 payload.csrf_token
//   2. URL query parameter: ?csrf_token=<value>
```

### 登录态 Cookie 策略 (auth-manager.js)

```
分区:      persist:music-netease
登录 URL:  https://music.163.com/
允许域名:  music.163.com, interface.music.163.com, interface3.music.163.com,
          passport.163.com, reg.163.com, 163.com
Cookie域:  .163.com, .music.163.com, music.163.com
关键Cookie: ['MUSIC_U', '__csrf']
存储文件:  data/music-auth/netease.cookies.enc (Electron safeStorage 加密)
```

---

## API 端点详解

### 1. 搜索歌曲

```
GET https://music.163.com/api/search/get/web

Query 参数:
  s:     "<搜索关键词>"      # 必需, 非空
  type:  "1"               # 1 = 单曲
  limit: "<1-30>"          # 默认 20
  offset:"<0-300>"         # 默认 0

无需登录。healthCheck 也用它探测: s=晴天, limit=1

响应 JSON 路径:
  data.result.songs[] → mapNeteaseSong()

mapNeteaseSong(song):
  id:           `netease:${song.id}`
  source:       'netease'
  sourceTrackId: String(song.id)
  sourceAlbumId: album.id 或 al.id → String, 无则为 ''
  title:        song.name.trim()
  artists:      song.artists[].name 或 song.ar[].name, 过滤空值
  album:        album.name 或 al.name.trim()
  durationMs:   song.duration || song.dt, 最小 0
  coverUrl:     优先 album.picUrl || album.pic_url
                回退 artists[0].img1v1Url  (搜索 API 不返回专辑封面, 此回退零网络请求)
  playable:     song.status !== -1   (-1 = 不可用)
  vip:          song.fee === 1 || song.fee === 4

返回 null 的条件: song.id 或 song.name 缺失
```

### 2. 播放 URL 解析

```
resolvePlayableUrl(track) — 纯字符串构造, 无网络请求

构造 URL:
  https://music.163.com/song/media/outer/url?id={encodeURIComponent(sourceTrackId)}.mp3

返回:
  {
    source: 'netease',
    sourceTrackId,
    url: "<构造的URL>",
    expireAt: Date.now() + 5分钟,
    playUrlExpireAt: Date.now() + 5分钟
  }

注意: 不调用 /weapi/song/enhance/player/url
      TTL 是硬编码的 5 分钟, forceRefresh 参数被忽略
```

### 3. 歌词

```
GET https://music.163.com/api/song/lyric

Query 参数:
  id:  "<歌曲ID>"     # 必需
  lv:  "-1"          # 原始歌词版本 (-1=最新)
  kv:  "-1"          # 逐字歌词版本
  tv:  "-1"          # 翻译版本
  ytv: "-1"          # 罗马音版本

响应路径:
  data.lrc.lyric     → LRC 格式原始歌词
  data.tlyric.lyric  → LRC 格式翻译
  data.yrc.lyric     → 逐字歌词 (word-synced)
  data.romalrc.lyric → 罗马音/拼音

解析: parseLyricResult(lrc.lyric, tlyric.lyric, yrc.lyric, romalrc.lyric)
```

### 4. 推荐歌单

```
GET https://music.163.com/api/personalized/playlist

Query 参数:
  limit: "<1-30>"   # 默认 9

无需登录。

响应路径:
  data.result[] → mapNeteasePlaylist()

mapNeteasePlaylist(playlist):
  id:            String(playlist.id)
  source:        'netease'
  title:         playlist.name.trim()
  description:   playlist.copywriter || playlist.description
  coverUrl:      playlist.picUrl || playlist.coverImgUrl
  trackCount:    playlist.trackCount
  playCount:     playlist.playCount
  creatorUserId: String(playlist.creator.userId)
```

### 5. 每日推荐

```
GET https://music.163.com/api/v1/discovery/recommend/songs

需要登录。无查询参数。

响应路径:
  data.recommend[] → mapNeteaseSong()

注意: 服务端返回固定一份每日歌单, 不分页。
      前端通过 sliceByPage() 做客户端窗口翻页,
      超出末尾自动绕回开头 (保证永不空返回)。

sliceByPage(list, limit, page):
  items.length <= limit → 返回前 limit 首
  start = ((page-1)*limit) % items.length
  window = items.slice(start, start+limit)
  window 不够 → 从开头补齐
```

### 6. 电台 (新歌推荐)

```
GET https://music.163.com/api/personalized/newsong

Query 参数:
  limit: "100"     # 硬编码 100 (接口忽略 offset)

无需登录。

响应路径:
  data.result[].song 或 data.result[] → mapNeteaseSong()
  → sliceByPage() 客户端分页
```

### 7. 我喜欢 (红心歌曲)

```
多步骤流程:

Step 1: requireLogin("我喜欢需要先登录网易云音乐。")
        检查 auth.loggedIn

Step 2: GET /api/nuser/account/get → getUserProfile()
        提取 profile.userId, profile.nickname
        失败 → "未能读取网易云用户资料"

Step 3: GET /api/user/playlist?uid=<userId>&limit=50&offset=0
        获取用户所有歌单 → mapNeteasePlaylist()

Step 4: 启发式查找"我喜欢"歌单:
        playlists.find(p => /喜欢/.test(p.title)) || playlists[0]
        ← 找标题含"喜欢"的歌单, 找不到就用第一个歌单

Step 5: getPlaylistTracks(likedPlaylist.id, { limit, offset })
```

### 8. 用户歌单 (我的 + 收藏)

```
Step 1: getUserProfile() → userId

Step 2: GET /api/user/playlist
        ?uid=<userId>&limit=<1-500>&offset=0
        响应: data.playlist[]

Step 3: 筛选:
        created = playlists.filter(p => p.creatorUserId === userId)
        collected = playlists.filter(p => p.creatorUserId !== userId)
        // 创建者ID匹配=自己创建的, 不匹配=收藏的
```

### 9. 歌单详情 (歌曲列表)

```
GET https://music.163.com/api/v6/playlist/detail

Query 参数:
  id: "<歌单ID>"     # 必需
  n:  "<limit>"     # 1-5000, 默认 1000
  s:  "<offset>"    # 0-200000, 默认 0

响应路径:
  data.playlist.tracks[] → mapNeteaseSong()

判断歌曲是否已在歌单中:
  GET 同一端点, n=0&s=0
  → 读 data.playlist.trackIds[] (轻量列表)
  → 检查 item.id || item === trackId
```

### 10. 最近播放

```
GET https://music.163.com/api/play-record

Query 参数:
  uid:  "<userId>"      # 从 getUserProfile() 获取
  type: "1"             # 1 = 歌曲

需要登录。

响应路径:
  data.weekData[].song → mapNeteaseSong()
  截取前 limit 首
```

### 11. 歌单写入 (添加/删除歌曲) — weapi POST

```
POST https://music.163.com/weapi/playlist/manipulate/tracks
?csrf_token=<csrfToken>

Headers:
  Content-Type: application/x-www-form-urlencoded
  Cookie: <raw cookie>

weapi 加密前 payload:
{
  op: "add" 或 "del",
  pid: "<歌单ID>",                          // 必须是纯数字
  trackIds: JSON.stringify(["123", "456"]), // 歌曲ID数组
  imme: "true",
  tracks: JSON.stringify([{ type: 3, id: "123" }, ...]),
  csrf_token: "<csrfToken>"                 // 注入的 CSRF token
}

加密后 body:
  params=<双层AES base64>&encSecKey=<256hex RSA密文>

响应处理:
  code === 200 → 成功 { playlistId, songlist: [{ songId, existed: 0 }] }
  code === 502 (添加时) → 歌曲已在歌单 { existed: 1 }
  其他 code → 抛出错误
```

### 12. 用户资料

```
GET https://music.163.com/api/nuser/account/get

需要登录 (有 MUSIC_U Cookie)

响应路径:
  data.profile.userId   → String
  data.profile.nickname → 昵称

失败: userId 缺失 → "未能读取网易云用户资料"
```

---

## 完整歌词解析器 (src/music/lyrics.js)

### parseLyricResult(rawLyric, rawTranslation, rawWordLyric, rawRoma)

```
1. parseWordLyric(rawWordLyric) → 逐字歌词行
2. parseLrc(rawLyric) → LRC 时间轴行
   优先 LRC, LRC 为空则用逐字歌词转 LRC 格式
3. parseTimedText(rawTranslation) → 翻译行 (100ms 容差匹配)
4. parseTimedText(rawRoma) → 罗马音行 (100ms 容差匹配)
5. 每行输出: { startMs, endMs, text, translation, roma, words[] }
```

### LRC 解析 (parseLrc)

```
正则: /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
支持格式: [mm:ss], [mm:ss.xxx], [mm:ss:xxx]

同一行多个时间标签 → 生成多条记录 (卡拉OK重复行)
时间戳过滤: 负数/NaN → 跳过
排序: startMs 升序, 相同按 text 字典序
```

### 逐字歌词解析 (parseWordLyric)

```
行正则: /\[(\d+),(\d+)\]([\s\S]*)/ → [startMs, durationMs, body]

前缀词格式: /\((\d+),(\d+),\d*\)([^()]+)/g
  → (start,duration,?)text → { startMs, endMs, text }

后缀词格式: (仅无前缀词时使用)
  /\(([^()]*)\((\d+),(\d+)\)/ → text(start,duration)

输出: { startMs, endMs: start+duration, text, words[] }
```

### 翻译/罗马音匹配

```
createTimedTextResolver(lines, toleranceMs = 100):
  1. 构建 startMs → line Map
  2. 精确查找: startMs 完全匹配
  3. 二分查找: 找最近的 startMs, Δ ≤ 100ms 容差 → 匹配
     原因: QQ音乐翻译行与原歌词有微小时间偏移
```

### 假名注音 (QQ [kana:…] 标签)

```
extractKanaReadings(text):
  匹配 /\[kana:([^\]]+)\]/
  按数字分隔符切分: "1読1み2方" → ["読", "み", "方"]

mapKanaToLines(lines, kanaReadings):
  遍历歌词行, 每个 CJK 字符消费一个假名读音
  CJK 范围: U+4E00-9FFF, U+3400-4DBF, U+F900-FAFF
```

### 当前行查找 (findCurrentLyricLine)

```
二分查找: 最后一个 startMs ≤ currentMs 的行
空数组 → null
```

---

## 播放流解析器 (src/music/stream-resolver.js)

```javascript
resolveMusicStream(registry, track, options):
  1. normalizeMusicTrackForProvider(track)
     // 清洗 + 验证: id, sourceTrackId, title 不能为空
     // artists 最多保留 8 位
  2. registry.get(track.source)  // 'qq' 或 'netease'
  3. provider.resolvePlayableUrl(normalizedTrack)
```

---

## 登录态判断

| 操作 | 需要登录? | 判断方式 |
|------|-----------|----------|
| 搜索 | ❌ | — |
| 推荐歌单 | ❌ | — |
| 新歌/电台 | ❌ | — |
| 歌单详情 | ❌ | 公开即可 |
| 歌词 | ❌ | 公开即可 |
| 播放URL | ❌ | 公开直链 |
| 每日推荐 | ✅ | requireLogin() → auth.loggedIn |
| 我喜欢 | ✅ | requireLogin() |
| 我的歌单 | ✅ | requireLogin() |
| 收藏歌单 | ✅ | requireLogin() |
| 最近播放 | ✅ | requireLogin() |
| 歌单写入 | ✅ | 需要 CSRF token + 登录 Cookie |
| 用户资料 | ✅ | 需要 MUSIC_U Cookie |
