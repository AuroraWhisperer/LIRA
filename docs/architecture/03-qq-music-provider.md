# QQ音乐 Provider — 完整 API 逆向工程文档

> 源码：[src/music/providers/qq-provider.js](src/music/providers/qq-provider.js)
> 依赖：`@jixun/qmweb-sign` (zzcSign 签名), `qrc-decoder` (QRC 加密歌词解密)

---

## 涉及的域名与端口

| 域名 | 用途 | 端口 |
|------|------|------|
| `c.y.qq.com` | 搜索、歌词（旧版）、歌单详情、创建歌单、收藏资产 | HTTPS 443 |
| `u.y.qq.com` | musicu.fcg（新版歌词、播放URL、推荐Feed、电台、播放历史） | HTTPS 443 |
| `u6.y.qq.com` | musics.fcg（客户端API：我的歌单、收藏歌单、歌单歌曲、歌单写入） | HTTPS 443 |
| `y.gtimg.cn` | 专辑封面图片 CDN | HTTPS 443 |
| `isure.stream.qqmusic.qq.com` | 音频流 CDN（默认，可能变） | HTTPS 443 |
| `i2.y.qq.com` | 歌单写入 Origin（zzcSign 签名时用） | HTTPS 443 |

---

## 请求头（所有接口）

```javascript
// buildHeaders() 构造的请求头
{
  "Accept": "application/json,text/plain,*/*",
  "Origin": "https://y.qq.com",
  "Referer": "https://y.qq.com/",
  "User-Agent": "Mozilla/5.0 SongAssistant/1.0",
  "Cookie": "<从 Electron Chromium 分区读取的 Cookie 字符串>"
}

// 歌单写入特殊请求头（zzcSign POST）
{
  "Content-Type": "application/x-www-form-urlencoded",
  "Origin": "https://i2.y.qq.com",       // 注意：写入时 Origin 变了
  "Referer": "https://i2.y.qq.com/",
  "Cookie": "..."
}
```

---

## Cookie 分析

### 登录凭证 Cookie（按优先级）

| Cookie 名 | 用途 | 必需性 |
|-----------|------|--------|
| `qqmusic_key` | 新版登录凭证（`authst` 字段来源，优先使用） | 登录操作必需 |
| `qm_keyst` | 旧版登录凭证（`qqmusic_key` 的替代，回退使用） | 登录操作必需 |
| `p_skey` | QQ 互联 skey（GTK 计算源，优先级高于 skey） | GTK 签名必需 |
| `skey` | QQ 旧版 skey（GTK 计算源，回退使用） | GTK 签名必需 |

### QQ号提取 Cookie（按匹配优先级）

```
1. qqmusic_uin / uin / o_cookie → 值格式: o<QQ号> 或 <QQ号>
2. wxuin → 微信登录的 QQ 号
3. 所有 *_uin 结尾的 Cookie → 泛化回退匹配
4. ptnick_<QQ号> → 最后兜底
```

### GTK 计算源 Cookie（按优先级）

```
1. qqmusic_key → 最先尝试
2. qm_keyst → 其次
3. p_skey → QQ 互联
4. skey → QQ 旧版
```

### 客户端 API 额外 Cookie

```javascript
// requestMusicsClient() 中从 Cookie 提取的额外字段
{
  authst:          extractCookieValue("qm_keyst") || extractCookieValue("qqmusic_key"),
  guid:            extractCookieValue("qqmusic_guid") || 随机10位数字,
  tmeLoginType:    extractCookieValue("tmeLoginType") || 2,
  psrf_access_token_expiresAt,
  psrf_qqaccess_token,
  psrf_qqopenid,
  psrf_qqunionid   // 回退: extractCookieValue("wxunionid")
}
```

---

## GTK 签名算法

```javascript
// 经典 QQ GTK 散列 (calcQQGtk)
function calcQQGtk(source) {
  let hash = 5381;
  for (let i = 0; i < source.length; i++) {
    hash += (hash << 5) + source.charCodeAt(i);
  }
  return hash & 0x7fffffff;  // 保留 31 位正数
}

// 提取源值 (extractQQGtkSource)
// 从 Cookie 中按顺序取第一个存在的: qqmusic_key > qm_keyst > p_skey > skey
// 返回完整的 Cookie value 作为散列源
```

---

## zzcSign 签名（歌单写入用）

```javascript
// 来自 @jixun/qmweb-sign 包
// 仅用于 musics.fcg POST 写入操作（addTracksToPlaylist / removeTracksFromPlaylist）
const { zzcSign } = require('@jixun/qmweb-sign');

// 使用方式:
url.searchParams.set('sign', zzcSign(body));
// body 是完整的 JSON.stringify 后的请求体
```

---

## 请求方法

### GET 请求 (requestJson)

```
通用流程:
  1. new URL(rawUrl) + searchParams.set(key, value) 逐个设置参数
  2. fetch(url, { method: 'GET', headers: buildHeaders(), redirect: 'follow', signal: AbortSignal.timeout(10000) })
  3. response.text() → JSON.parse(stripJsonp(text))
     stripJsonp: 去除 JSONP 包裹，如 callback({...}) → {...}
```

### POST 请求 (requestMusicuPost)

```
musicu.fcg POST:
  1. headers['Content-Type'] = 'application/json'
  2. body = JSON.stringify({ ...modules, comm })
  3. fetch → response.text() → JSON.parse(stripJsonp(text))
```

### 客户端 POST 请求 (requestMusicsClient)

```
musics.fcg POST:
  1. headers['Content-Type'] = 'application/x-www-form-urlencoded'
  2. body = JSON.stringify({ comm: {...clientAuthFields}, ...modules })
  3. url.searchParams.set('pcachetime', Math.floor(Date.now()/1000))
  4. fetch → response.text() → JSON.parse(stripJsonp(text))
```

---

## API 端点详解

### 1. 搜索歌曲

```
GET https://c.y.qq.com/soso/fcgi-bin/client_search_cp

参数:
  new_json:  "1"              # 启用新版 JSON 响应格式
  t:         "0"              # 搜索类型 0=单曲
  aggr:      "1"              # 聚合结果
  cr:        "1"              # 纠错
  catZhida:  "1"              # 直达区
  lossless:  "0"              # 不要求无损
  p:         "{page}"         # 页码 (1-50, 默认1)
  n:         "{limit}"        # 每页数量 (1-30, 默认20)
  w:         "{keyword}"      # 搜索关键词 (必需, 不能为空)
  format:    "json"
  inCharset: "utf8"
  outCharset:"utf-8"
  platform:  "yqq.json"
  needNewCode:"0"

响应 JSON 路径:
  data.data.song.list[]  # 歌曲数组

mapQQSong 映射:
  sourceTrackId ← song.mid || song.songmid || song.song_mid || song.SongMid || song.songMid
  title         ← song.title || song.name || song.songname || song.SongName || song.SongTitle
  artists       ← song.singer[].name 或 song.singers[].name 或 song.SingerName
  album         ← song.album.title || song.album.name || song.albumname || albumdesc || AlbumName
  durationMs    ← song.interval * 1000    (秒转毫秒)
  coverUrl      ← song.coverUrl/cover/picurl/imgurl/albumcover 直接 URL 或
                   "https://y.gtimg.cn/music/photo_new/T002R300x300M000{albumMid}.jpg"
  vip           ← song.pay.pay_play > 0 || song.Vip > 0
  sourceSongId  ← song.id || song.songid || song.songId || song.song_id || SongId || SongID

返回格式:
  { id: "qq:{mid}", source: "qq", sourceTrackId, sourceSongId, sourceAlbumId,
    title, artists: [...], album, durationMs, coverUrl, playable: true, vip }
```

### 2. 播放 URL 解析

```
GET/POST https://u.y.qq.com/cgi-bin/musicu.fcg

非登录模式 (requestJson GET):
  data = JSON.stringify({
    req: {
      module: "CDN.SrfCdnDispatchServer",
      method: "GetCdnDispatch",
      param: { guid, calltype: 0, userip: "" }
    },
    req_0: {
      module: "vkey.GetVkeyServer",
      method: "CgiGetVkey",
      param: {
        guid: "<10位随机数字>",
        songmid: ["<sourceTrackId>"],
        songtype: [0],
        uin: "<QQ号或0>",
        loginflag: cookieHeader ? 1 : 0,  // 有 Cookie=1, 无=0
        platform: "20"
      }
    },
    comm: { uin, format: "json", ct: 24, cv: 0 }
  })

响应路径:
  data.req_0.data.midurlinfo[0].purl    → 播放路径片段 (如 "C400001XGaKO2YhgVo.m4a")
  data.req_0.data.sip[]                 → CDN 前缀列表

URL 拼接:
  baseUrl = sip.find(Boolean) || "https://isure.stream.qqmusic.qq.com/"
  最终 URL = baseUrl + purl
  TTL = 5分钟

失败: purl 为空 → "当前 QQ 音乐账号无法播放该歌曲"
```

### 3. 歌词获取（双路径）

#### 3a. 新版歌词（优先）：PlayLyricInfo API

```
POST https://u.y.qq.com/cgi-bin/musicu.fcg

JSON Body:
{
  req_0: {
    module: "music.musichallSong.PlayLyricInfo",
    method: "GetPlayLyricInfo",
    param: {
      songID: <数值型 songId>,     // 必须 > 0 才会走新路径
      songMID: "<sourceTrackId>",
      songType: 0,
      qrc: 1,                     // 请求 QRC 加密歌词
      trans: 1,                   // 请求翻译
      roma: 1,                    // 请求罗马音
      crypt: 1                    // 启用加密传输
    }
  }
}

响应解析:
  data.req_0.data.crypt → 是否加密 (1=是)
  data.req_0.data.lyric → 加密的歌词 hex 字符串
  data.req_0.data.trans → 加密的翻译
  data.req_0.data.roma  → 加密的罗马音

QRC 解密流程:
  1. 检查 hex 字符串: text.length % 16 === 0 && 仅含 [0-9a-f]
  2. decryptQrc(text) — 使用 qrc-decoder 包解密
  3. extractQrcLyricContent() — 从 QRC XML 提取纯文本:
     <Lyric_1 LyricContent="..." /> → 提取 LyricContent 属性
     无 XML 包裹 → 直接使用原文
  4. decodeXmlEntities() — HTML 实体解码 (&#x, &#, &quot;, &apos;, &lt;, &gt;, &amp;)
  5. parseLyricResult() → [{ time, text, translation, roma }]
```

#### 3b. 旧版歌词（回退）：Legacy Lyric API

```
GET https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg

参数:
  songmid:    "<sourceTrackId>"
  pcachetime: String(Date.now())
  g_tk:       "<GTK>"            # 需要 GTK 签名
  loginUin:   "<QQ号>"
  hostUin:    "0"
  format:     "json"
  inCharset:  "utf8"
  outCharset: "utf-8"
  notice:     "0"
  platform:   "yqq.json"
  needNewCode:"0"

响应解析:
  data.lyric    → Base64 编码的歌词 → Buffer.from(x, 'base64').toString('utf8')
  data.trans    → Base64 编码的翻译
  data.romalrc  → Base64 编码的罗马音
  → parseLyricResult()
```

### 4. 推荐歌单（首页推荐）

```
POST https://u.y.qq.com/cgi-bin/musicu.fcg

JSON Body:
{
  req_1: {
    module: "music.recommend.RecommendFeed",
    method: "get_recommend_feed",
    param: {
      direction: 1,
      page: <页码 1-50>,
      v_cache: [],
      v_uniq: [],         // 去重用，传入已展示的 card.id 列表避重
      s_num: 4
    }
  }
}

comm (POST参数):
  { format: "json", ct: 20, cv: 2241, platform: "wk_v17",
    guid: "<10位随机数字>", uin: "<QQ号>",
    inCharset: "utf-8", outCharset: "utf-8", notice: 0, needNewCode: 1 }

响应路径:
  data.req_1.data.v_shelf[].v_niche[].v_card[]
  只取 card.type === 500 的卡片（歌单卡片）→ mapRecommendCard()

mapRecommendCard:
  id:          card.id
  title:       card.title
  description: card.subtitle
  coverUrl:    card.cover
  playCount:   card.cnt
```

### 5. 每日推荐

```
两步流程：
Step 1: get_recommend_feed (同上推荐歌单接口)
  → 从所有 shelf 的 v_niche.v_card[] 收集 type === 200 的卡片（单曲卡片）
  → 提取 card.id (数值 songId)
  → 最多翻 5 页，凑够 limit 首

Step 2: CgiGetTrackInfo (批量拉完整歌曲信息)

POST https://u.y.qq.com/cgi-bin/musicu.fcg

JSON Body:
{
  req_1: {
    module: "music.trackInfo.UniformRuleCtrl",
    method: "CgiGetTrackInfo",
    param: {
      ids: [123, 456, ...],          // 数值 songId 列表
      types: [200, 200, ...],         // 与 ids 一一对应，固定 200
      source: "AiNoFree"
    }
  }
}

响应路径:
  data.req_1.data.tracks[] → mapQQSong()

回退: Feed 无单曲卡片 → 走 getRadioTracks()
```

### 6. 电台

```
GET https://u.y.qq.com/cgi-bin/musicu.fcg

参数 (data=JSON.stringify):
{
  songlist: {
    module: "mb_track_radio_svr",
    method: "get_radio_track",
    param: {
      id: <radioId>,          // 电台ID, 默认101
      firstplay: 1或0,        // 第一轮=1, 后续=0 (控制换歌)
      num: <limit>
    }
  }
}

响应路径:
  data.songlist.data.tracks[] 或 track_list[] 或 songlist[]
  → mapQQSong()

策略: 电台每次只返回约5首，需要多轮轮询 + 换 guid 来凑够 limit
      最多 12 轮，每轮去重（seen Set）
```

### 7. 我喜欢

```
完整流程:
  1. requireLogin("QQ音乐我喜欢需要先登录")  → 检查 cookieHeader 中是否有 qqmusic_key/qm_keyst
  2. getCreatedPlaylists({ limit: 50, includeLiked: true })
     → 在返回的歌单中找 dirId === "201" 或 title 包含 "我喜欢"/"喜欢"
  3. getPlaylistTracks(liked.id, { limit, offset })
     → 返回歌曲列表

如果没有找到 → "没有从QQ音乐读取到'我喜欢'，当前登录凭证不完整或已失效"
```

### 8. 我的歌单（我创建的）

```
双路径策略:

路径A（优先）: 客户端 API — requestMusicsClient()

POST https://u6.y.qq.com/cgi-bin/musics.fcg
?pcachetime={时间戳}

Body (JSON):
{
  comm: {
    _channelid: "20",
    _os_version: "6.2.9200-2",
    authst: "<qm_keyst 或 qqmusic_key 的 Cookie 值>",
    ct: "19",
    cv: "2241",
    guid: "<qqmusic_guid Cookie 值或随机10位>",
    patch: "118",
    tmeAppID: "qqmusic",
    tmeLoginType: <tmeLoginType Cookie 值或2>,
    uin: "<QQ号>",
    psrf_access_token_expiresAt: "...",  // 可选, 从 Cookie 提取
    psrf_qqaccess_token: "...",          // 可选
    psrf_qqopenid: "...",                // 可选
    psrf_qqunionid: "..."                // 可选, 回退 wxunionid
  },
  "music.musicasset.PlaylistBaseRead.GetPlaylistByUin": {
    module: "music.musicasset.PlaylistBaseRead",
    method: "GetPlaylistByUin",
    param: { uin: "<QQ号>" }
  }
}

响应路径:
  data["music.musicasset.PlaylistBaseRead.GetPlaylistByUin"].data.v_playlist[]

需要 Cookie: qqmusic_key/qm_keyst + uin

路径B（回退）: 旧版 Web API — requestJson()

GET https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss

参数:
  hostUin: "0"
  hostuin: "<QQ号>"
  sin: "0"
  size: "<limit>"
  g_tk: "<GTK>"
  loginUin: "<QQ号>"
  format: "json"
  inCharset: "utf8"
  outCharset: "utf-8"
  notice: "0"
  platform: "yqq.json"
  needNewCode: "0"

响应路径:
  data.data.disslist[]

mapQQPlaylist:
  id:          playlist.content_id || dissid || tid || id
  title:       playlist.title || dissname || diss_name || name || dirName
  description: playlist.desc || subtitle || rcmdcontent
  coverUrl:    playlist.cover || picurl || imgurl || logo || diss_cover || picUrl || bigpicUrl
  trackCount:  playlist.song_cnt || songnum || songNum || total_song_num || count
  playCount:   playlist.listen_num || listennum || playcnt || play_cnt || access_num
  creatorUserId: playlist.uin || hostuin
  dirId:       playlist.dirid || dirId
  tid:         playlist.tid || content_id || dissid || id
```

### 9. 收藏歌单

```
双路径策略:

路径A（优先）: 客户端 API
POST https://u6.y.qq.com/cgi-bin/musics.fcg
Body:
{
  comm: { ...同上 },
  "music.musicasset.PlaylistFavRead": {
    module: "music.musicasset.PlaylistFavRead",
    method: "GetPlaylistFavInfo",
    param: { uin: "<QQ号>" }
  }
}
响应: data["music.musicasset.PlaylistFavRead"].data.v_list[]

路径B（回退）: 旧版 API
GET https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg
参数:
  ct: "20"
  cid: "205360956"
  userid: "<QQ号>"
  reqtype: "3"           # 3=收藏歌单
  sin: "0"
  ein: "<limit>"
  g_tk: "<GTK>"
  loginUin: "<QQ号>"
  format: "json"
  inCharset: "utf8"
  outCharset: "utf-8"
  platform: "yqq.json"
  needNewCode: "0"
响应: data.data.cdlist[]
```

### 10. 歌单详情（歌曲列表）

```
三路径策略 (按优先级尝试):

路径A: 客户端 API (需要登录 Cookie)
POST https://u6.y.qq.com/cgi-bin/musics.fcg
Body:
{
  comm: { ...同上 },
  "music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo": {
    module: "music.srfDissInfo.DissInfoForPc",
    method: "uniform_get_Dissinfo",
    param: {
      disstid: Number(id),
      host_uin: Number(uin),
      login_uin: Number(uin)
    }
  }
}
响应: data[...].data.songlist[]

路径B: 公开 API (不需要客户端 Cookie)
GET https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg
参数:
  type: "1"
  json: "1"
  utf8: "1"
  onlysong: "0"
  disstid: "<歌单ID>"
  format: "json"
  g_tk: "<GTK>"
  loginUin: "<QQ号>"
  hostUin: "0"
  inCharset: "utf8"
  outCharset: "utf-8"
  notice: "0"
  platform: "yqq"
  needNewCode: "0"
  song_begin: "<offset>"    // limit>100或offset>0时才加
  song_num: "<limit>"
响应: data.cdlist[0].songlist[]
      无分页参数时返回全部歌曲 (最多 limit 首)
```

### 11. 最近播放

```
双路径策略:

路径A（优先）: musicu API
GET/POST https://u.y.qq.com/cgi-bin/musicu.fcg
{
  req_0: {
    module: "music.globalchannel.GlobalChannelSvr",
    method: "GetPlayHistory",
    param: { uin: "<QQ号>", start: 0, num: <limit> }
  }
}
响应: req_0.data.result_song_list[].songInfo → mapQQSong()

路径B（回退）: 旧版 API (reqtype: "4")
GET https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg
参数:
  ct: "20"
  cid: "205360956"
  userid: "<QQ号>"
  reqtype: "4"           # 4=最近播放
  sin: "0"
  ein: "<limit>"
  g_tk: "<GTK>"
  loginUin: "<QQ号>"
  ...
响应: data.data.songlist[] 或 song_list[]

失败兜底: 返回诊断信息 [musicu debug] + [legacy keys]
```

### 12. 歌单写入（添加/删除歌曲）

```
POST https://u6.y.qq.com/cgi-bin/musics.fcg
?_={Date.now()}
&sign={zzcSign(body)}    # ← @jixun/qmweb-sign 计算

Headers:
  Content-Type: application/x-www-form-urlencoded
  Origin: https://i2.y.qq.com
  Referer: https://i2.y.qq.com/

Body (JSON 字符串):
{
  comm: {
    format: "json",
    ct: 20,
    cv: 2241,
    platform: "wk_v20",
    uid: "<QQ号>",
    guid: "<qqmusic_guid Cookie值 或 随机10位>",
    uin: "<QQ号>",
    g_tk_new_20200303: <GTK>,
    g_tk: <GTK>,
    inCharset: "utf-8",
    outCharset: "utf-8",
    notice: 0,
    needNewCode: 1
  },
  "music.musicasset.PlaylistDetailWrite.{method}": {
    module: "music.musicasset.PlaylistDetailWrite",
    method: "AddSonglist" 或 "DelSonglist",
    param: {
      bFmtUtf8: true,
      dirId: <歌单 dirId>,
      dirName: "<歌单名称>",
      tid: <歌单 tid>,
      v_songInfo: [{ songId: <数值songId>, songType: 0 }, ...]
    }
  }
}

需要: uin (QQ号) + gtkSource (qqmusic_key/qm_keyst/p_skey/skey)
      zzcSign 签名 (使用 @jixun/qmweb-sign)
      songId 必须是数值型 (sourceSongId/songId)，不能是 mid

添加成功: retCode === 0
code 502 (添加时): 歌曲可能已存在 → { existed: 1 } 标记
```

### 13. 健康检查

```
healthCheck():
  1. getSafeAuthState() → 读取登录态
  2. searchTracks('晴天', { limit: 1 })
  3. 成功 + 有 Cookie → status: "logged-in"
     成功 + 无 Cookie → status: "public-ok"
     失败 → status: "api-error"
```

---

## GUID 生成

```javascript
function buildGuid() {
  return String(Math.floor(1000000000 + Math.random() * 9000000000));
  // 返回 10 位随机数字字符串
}
```

## Uin 提取算法 (extractUin)

```javascript
// 从 Cookie 字符串中提取 QQ 号
// 优先级：
// 1. 精确匹配: /(?:^|;\s*)(qqmusic_uin|uin|o_cookie)=o?(\d{5,15})/i
//    值格式: "o123456789" (o 前缀去掉了) 或 "123456789"
// 2. 微信匹配: /(?:^|;\s*)wxuin=o?(\d{5,15})/i
// 3. 泛化匹配: /(?:^|;\s*)([\w-]*uin)=o?(\d{5,15})/i
//    匹配所有 *_uin 结尾的 Cookie (qm_hideuin, p_uin 等)
// 4. 昵称匹配: /(?:^|;\s*)ptnick_(\d{5,15})=/
//    匹配 ptnick_<QQ号> 格式
// 所有匹配返回空: ""
```

## 歌曲封面 URL

```javascript
// 优先使用响应中的直接 URL：
//   song.coverUrl || song.cover || song.picurl || song.imgurl 
//   || song.albumcover || song.strMediaMid || song.AlbumPic 
//   || song.AlbumPic150X150 || song.AlbumPic300X300 || song.AlbumPic500X500
//   || song.SingerPic || song.SingerPic300X300
//   || album.picUrl || album.picurl || album.imgurl
//
// 如果以上都不是完整 http(s) URL，则使用构建 URL:
//   "https://y.gtimg.cn/music/photo_new/T002R300x300M000{albumMid}.jpg"
//   专辑 mid 来源: album.mid || album.pmid || song.albummid || song.AlbumMid
```

## JSONP 解包

```javascript
function stripJsonp(text) {
  // 去除 JSONP callback 包裹，如: "callback({...});" → "{...}"
  const match = text.match(/^[^(]*\(([\s\S]*)\)\s*;?$/);
  return match ? match[1] : text;
}
```

## 请求超时

所有请求统一 `AbortSignal.timeout(10000)` — 10 秒超时。
