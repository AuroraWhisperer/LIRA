# QQ 音乐 Provider — 上游 API 逆向工程

> 涉及文件:[qq-provider.js](../../../../src/music/providers/qq-provider.js)、[qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js)、[lyric-parser.js](../../../../src/music/lyric-parser.js)(歌词行模型)、[provider-registry.js](../../../../src/music/provider-registry.js)
> 依赖:`@jixun/qmweb-sign`(zzcSign 签名)、`qrc-decoder`(QRC 加密歌词解密)

本文档是 QQ 音乐**上游接口**（`*.qq.com`）逆向实现的单一事实来源，涵盖域名、请求头、Cookie 语义、GTK/zzcSign 签名、13 个上游端点及响应映射。Cookie 持久化（登录分区、快照加密）见 [auth.md](../../desktop/auth.md)；本地 `/api/music/*` 端点清单与行为见 [api.md](../api.md) 的 music-routes 节；网易云侧见 [netease-provider.md](netease-provider.md)；共享歌词行解析算法见 [services.md §14](services.md#14-歌词解析器srcmusiclyric-parserjs)。

**内部模块边界：** `qq-provider.js` 作为对外门面，编排搜索、歌词、推荐、歌单与写操作；`qq-provider-streams.js` 负责搜索、歌词、健康检查及 vkey/播放流选择；`qq-provider-client.js` 负责请求头、Cookie、签名请求与歌单写入传输；`qq-provider-utils.js` 仅包含数据映射与纯函数工具。

## 1. 上游域名与用途

| 域名                          | 用途                                                                                  | 出处                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `c.y.qq.com`                  | 搜索、旧版歌词、公开歌单详情、我创建的歌单(回退)、收藏资产(回退)                      | [qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js)           |
| `u.y.qq.com`                  | `musicu.fcg`:播放 URL(CDN 分发 + vkey)、新版歌词、推荐 Feed、每日推荐、电台、最近播放 | 同上                                                                                   |
| `u6.y.qq.com`                 | `musics.fcg` 客户端 API:我的歌单、收藏歌单、歌单详情、歌单写入(zzcSign)               | 同上                                                                                   |
| `i2.y.qq.com`                 | 歌单写入请求的 `Origin`/`Referer`(zzcSign 场景专属,写接口校验)                        | [qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js)     |
| `y.gtimg.cn`                  | 专辑封面 CDN(`T002R300x300M000{albumMid}.jpg` 构造)                                   | [qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js) |
| `isure.stream.qqmusic.qq.com` | 音频流 CDN 默认前缀(sip 为空时的兜底)                                                 | [qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js)              |

## 2. 请求头

`buildHeaders(cookieHeader?)`（[qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js)）用于构造所有接口的公共请求头。凡请求体或查询参数依赖账号与签名的入口（`requestPlaylistWrite`、`requestMusicsClient`、`requestQQEncryptedVkey`、`requestMusicu`），均基于同一份 Cookie 快照构造身份、签名和请求头，避免单次请求内混用不同会话状态；普通请求未传快照时直接读取当前 Cookie：

```javascript
{
  Accept: 'application/json,text/plain,*/*',
  Origin: 'https://y.qq.com',
  Referer: 'https://y.qq.com/',
  'User-Agent': 'Mozilla/5.0 SongAssistant/1.0',
  // Cookie 仅在 getCookieHeader 返回非空字符串时设置
}
```

歌单写入在公共头上叠加:`Content-Type: application/x-www-form-urlencoded`、`Origin: https://i2.y.qq.com`、`Referer: https://i2.y.qq.com/`([qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js))。

## 3. Cookie 分析

需要登录的请求通过 `getRequestSession` 同时取得登录态和当前 Cookie。业务参数、`comm`、GTK 和请求头共用本次读数。仅有网页凭据时，「我的歌单」和「收藏歌单」直接使用本次凭据访问网页接口。已发出客户端 HTTP 请求后再回退、每日推荐翻页或补歌曲详情时，重新读取凭据并核对原 UIN。同账号续期使用新凭据，换号则中止原账号操作。参见[桌面登录与会话](../../desktop/auth.md)。

### 3.1 登录凭证与 GTK 源

| Cookie        | 用途                                           | 出处                                                                                   |
| ------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `qqmusic_key` | GTK 首选来源；authst 在 qm_keyst 缺失时回退到它                  | [qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js)     |
| `qm_keyst`    | 旧版登录凭证(authst 优先取它,其次 qqmusic_key) | 同上                                                                                   |
| `p_skey`      | QQ 互联 skey(GTK 源,优先级第三)                | [qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js) |
| `skey`        | QQ 旧版 skey(GTK 源,兜底)                      | 同上                                                                                   |

GTK 源提取顺序固定为 `qqmusic_key > qm_keyst > p_skey > skey`(`extractQQGtkSource`)。Provider 内部的兼容性判定 `hasQQMusicAuthCookie` 检查这 4 个 Cookie 任一非空,用于决定是否尝试带登录态的播放/网页回退;它不等同于 Electron 的登录完成判定,`requestMusicsClient` 仍要求 `uin` 与 `qm_keyst`/`qqmusic_key`([qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js))。

### 3.2 QQ 号提取(`extractUin`,[qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js))

按优先级逐级回退,值格式 `o<QQ号>` 或 `<QQ号>`,QQ 号长度 5-15 位:

1. `/(?:^|;\s*)(qqmusic_uin|uin|o_cookie)=o?(\d{5,15})/i` — 精确匹配专用名,避免被 `p_uin`/`pt2gguin` 干扰
2. `/(?:^|;\s*)wxuin=o?(\d{5,15})/i` — 微信登录
3. `/(?:^|;\s*)([\w-]*uin)=o?(\d{5,15})/i` — 泛化回退(`qm_hideuin`、`p_uin` 等)
4. `/(?:^|;\s*)ptnick_(\d{5,15})=/` — 昵称兜底

全部失败时返回空串，内部错误会附带当前存在的 Cookie 键名以便排查；对外 HTTP 响应仅提示重新登录，不暴露 Cookie 键名或上游原始报错。

### 3.3 客户端 API 额外字段(`requestMusicsClient`)

`comm` 除固定字段外,从 Cookie 提取([qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js)):

| 字段                                                                                       | 来源                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `authst`                                                                                   | `qm_keyst` 优先,回退 `qqmusic_key`(**两个都没有则整个请求失败**) |
| `guid`                                                                                     | `qqmusic_guid` Cookie 优先,否则随机 10 位                        |
| `tmeLoginType`                                                                             | `tmeLoginType` Cookie 数值,缺省 2                                |
| `psrf_access_token_expiresAt` / `psrf_qqaccess_token` / `psrf_qqopenid` / `psrf_qqunionid` | 同名 Cookie;`psrf_qqunionid` 缺失时回退 `wxunionid`              |

## 4. GTK 签名算法

经典 QQ GTK 散列(`calcQQGtk`,[qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js)):

```javascript
let hash = 5381;
for (const ch of source) hash += (hash << 5) + ch.charCodeAt(0);
return hash & 0x7fffffff; // 保留 31 位正数
```

源取 §3.1 顺序的第一个存在 Cookie 的**完整值**;无 GTK 源时多处回退 `5381`(空串哈希值),公开接口可用([qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js))。

## 5. zzcSign 签名

仅用于歌单写入:`url.searchParams.set('sign', zzcSign(body))`,`body` 为完整 `JSON.stringify` 后的请求体([qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js)),算法来自 `@jixun/qmweb-sign` 包,不在本仓库实现。

## 6. 请求方法

JSON / JSONP / 文本请求统一超时 `REQUEST_TIMEOUT_MS = 10000`（[qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js)），`redirect: 'follow'`。响应体均经[共享响应体读取器](../../../../src/shared/response-body.js)限制为 16 MiB，超限时立即中止读取且错误信息不拼接原始大正文。

| 方法                  | 形式            | 要点                                                                                                                                                  | 出处                                                                               |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `requestJson`         | GET             | 参数逐个 `searchParams.set`；`stripJsonp` 解包后 `JSON.parse`，非 JSON 抛「返回了非 JSON 响应」                                | [qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js) |
| `requestText`         | GET             | 同 `requestJson` 但返回原始文本（当前无调用点，保留工具）                                                                                                  | [qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js) |
| `requestMusicu`       | GET musicu      | `data=<JSON.stringify({...modules, comm})>` 查询参数;comm 固定 `{uin, format:'json', ct:24, cv:0}`                                                    | [qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js) |
| `requestMusicuPost`   | POST musicu     | `Content-Type: application/json`,body 为 `{...modules, comm}`(comm 由调用方传)                                                                        | [qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js) |
| `requestMusicsClient` | POST musics.fcg | `Content-Type: application/x-www-form-urlencoded`,URL 加 `pcachetime=floor(now/1000)`;**前置要求 `uin` + `authst` 都存在**,否则抛"登录 Cookie 不完整" | [qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js) |
| 歌单写入直发          | POST musics.fcg | URL 加 `_=Date.now()` 与 `sign=zzcSign(body)`;头 `i2.y.qq.com`                                                                                        | [qq-provider-client.js](../../../../src/music/providers/qq-provider-client.js) |

## 7. 上游端点详解(13 个)

| #   | 端点          | 模块                                              | 登录                       | 文档节 |
| --- | ------------- | ------------------------------------------------- | -------------------------- | ------ |
| 1   | 搜索          | `client_search_cp`                                | 否                         | §7.1   |
| 2   | 播放 URL 解析 | `CDN.SrfCdnDispatchServer` + `vkey.GetVkeyServer` | 否(自动带登录态)           | §7.2   |
| 3   | 歌词          | `PlayLyricInfo` / 旧版 `fcg_query_lyric_new`      | 否                         | §7.3   |
| 4   | 推荐歌单      | `music.recommend.RecommendFeed`                   | 否                         | §7.4   |
| 5   | 每日推荐      | `RecommendFeed`(type 200)+ `CgiGetTrackInfo`      | 否                         | §7.5   |
| 6   | 电台          | `mb_track_radio_svr`                              | 否                         | §7.6   |
| 7   | 我喜欢        | 我创建的歌单 + 歌单详情                           | **是**                     | §7.7   |
| 8   | 我的歌单      | `PlaylistBaseRead.GetPlaylistByUin` / 旧版        | **是**                     | §7.8   |
| 9   | 收藏歌单      | `PlaylistFavRead.GetPlaylistFavInfo` / 旧版       | **是**                     | §7.9   |
| 10  | 歌单详情      | `DissInfoForPc.uniform_get_Dissinfo` / 公开接口   | 否(带 Cookie 走客户端路径) | §7.10  |
| 11  | 最近播放      | `GlobalChannelSvr.GetPlayHistory` / 旧版          | **是**                     | §7.11  |
| 12  | 歌单写入      | `PlaylistDetailWrite.AddSonglist/DelSonglist`     | **是**                     | §7.12  |
| 13  | 健康检查      | 搜索探测                                          | 否                         | §7.13  |

### 7.1 搜索

```
GET https://c.y.qq.com/soso/fcgi-bin/client_search_cp
```

| 参数                                                       | 值                                   | 说明                                                                           |
| ---------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| `new_json` `aggr` `cr` `catZhida`                          | `1`                                  | 新版 JSON / 聚合 / 纠错 / 直达区                                               |
| `t`                                                        | `0`                                  | 搜索类型,0 = 单曲                                                              |
| `lossless`                                                 | `0`                                  | 不要求无损                                                                     |
| `p`                                                        | 页码,clamp 1-50 默认 1               | [qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js)        |
| `n`                                                        | 每页,clamp 1-30 默认 20              | [qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js)        |
| `w`                                                        | 关键词(必填,空抛错)                  | [qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js) |
| `format` `inCharset` `outCharset` `platform` `needNewCode` | `json`/`utf8`/`utf-8`/`yqq.json`/`0` | 固定                                                                           |

响应路径 `data.data.song.list[]` → `mapQQSong`(见 §8.1)。关键词长度由 music-catalog-service 层限制(见 [services.md](services.md) §6)。

### 7.2 播放 URL 解析([qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js))

```
GET https://u.y.qq.com/cgi-bin/musicu.fcg?data=<JSON>
```

双模块请求体(SQ 请求示例):

```json
{
  "req": {
    "module": "CDN.SrfCdnDispatchServer",
    "method": "GetCdnDispatch",
    "param": { "guid": "<10位随机>", "calltype": 0, "userip": "" }
  },
  "req_0": {
    "module": "vkey.GetVkeyServer",
    "method": "CgiGetVkey",
    "param": {
      "guid": "<10位随机>",
      "songmid": ["<mid>", "<mid>", "<mid>"],
      "songtype": [1, 1, 1],
      "filename": [
        "F000<mediaMid>.flac",
        "M800<mediaMid>.mp3",
        "M500<mediaMid>.mp3"
      ],
      "uin": "<QQ号或0>",
      "loginflag": 1,
      "platform": "20"
    }
  },
  "comm": { "uin": "<QQ号或0>", "format": "json", "ct": 24, "cv": 0 }
}
```

- 音质档位：`standard=M500/mp3`、`high=M800/mp3`、`lossless=F000/flac`。请求 HQ 时按 `high → standard`、请求 SQ 时按 `lossless → high → standard` 批量请求候选，取首个非空 `purl`
- 文件名优先用 track 的 `sourceMediaId`，缺失回退 `sourceTrackId`；`songtype[]` 使用 track 的 `sourceSongType`，缺失或非法回退 `0`。2026-08-20 桌面客户端 HAR 中目标歌曲的付费请求为 `songtype: 1`，因此该字段必须贯穿搜索映射、播放状态与 Provider 入参
- `loginflag` = Cookie 非空 ? 1 : 0（`getSafeCookieHeader` 忽略读取异常返回 `''` → 0）
- `guid` 每次调用 `buildGuid()` 新生成
- 响应：按候选顺序寻找 `req_0.data.midurlinfo[].purl`（路径片段）+ `req_0.data.sip[]`（CDN 前缀）
- 拼接 `baseUrl = sip.find(Boolean) || 'https://isure.stream.qqmusic.qq.com/'`，最终 `url = baseUrl + purl`
- 全部 `purl` 为空：无登录 Cookie 抛「请先登录 QQ 音乐后再播放该歌曲」；有登录 Cookie 抛「当前 QQ 音乐账号没有该歌曲的完整播放或试听权益」
- 返回 `{ requestedQuality, quality }`；`quality` 按实际文件名前缀识别，使前端能提示 SQ 降级 HQ/标准
- TTL：`STREAM_TTL_MS = 5 * 60 * 1000`（[qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js)），`expireAt`/`playUrlExpireAt` 同值；本方法不额外缓存普通 vkey，外层刷新编排见 [services.md](services.md)

**桌面专属音效与加密流代理：** 同一份 HAR 还出现 `music.vkey.GetEVkey/CgiGetEVkey` 返回的 `Q0...mflac` 与 `O8...mgg`。Provider 对 QQ 登录用户提供实验性的 `premium` / `immersive` 档位：服务端短期保存 EVkey 的 `ekey`，通过本地 Range 代理使用 QMC2 解密后返回普通 FLAC/Ogg，不向渲染进程暴露密钥。Q0 的 `Atmos` 只作为媒体元数据标记，不等于空间渲染；O8、杜比、臻品母带 4.0 和臻品全景声 3.0 仍依赖 QQ 客户端 DSP/空间音频能力，Electron 无法保证效果，解析失败时应回退到浏览器可解码的标准/HQ/SQ。

[加密流代理](../../../../src/music/qq-encrypted-stream.js)通过 Node `pipeline` 流式解密并透传下游背压，客户端中断或响应提前关闭时会中止上游 `fetch`：
- **解密偏移**：按实际响应正文确定解密位置——上游返回完整 200 时从字节 0 开始，206 使用有效 `Content-Range` 的起点再加已接收字节数；206 缺少可用范围时返回 502，不按请求 Range 猜测正文位置。
- **超时与限额**：等待响应头与等待下一块上游数据各有 30 秒超时（仅计主动读取阶段，不计入下游背压），超时即取消上游并断开响应；声明长度与实际累计字节均限制在 64 MiB 以内，超限即断开已开始的响应。无论正常完成、拒绝还是取消，均释放响应体与 QMC2 实例。

### 7.3 歌词获取(双路径,[qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js))

**路径 A(优先):PlayLyricInfo 新版接口**,前提是解析出数值 `sourceSongId > 0`:

- `resolveSourceSongId`([qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js)):track 自带 `sourceSongId` 则直接用;否则用 `title + 第一位歌手` 调搜索(limit 20),按 `sourceTrackId(mid)` 精确匹配反查数值 id;失败返回 0 走旧版
- `POST musicu.fcg`:`req_0 = { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { songID, songMID, songType: 0, qrc: 1, trans: 1, roma: 1, crypt: 1 } }`
- 校验 `response.code === 0 && req_0.code === 0 && req_0.data` 存在,否则抛"未返回完整歌词数据"
- 解密(`decodeQQPlayableLyric`,[qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js)):
  - `data.crypt !== 1` → 直接 Base64 解码
  - `crypt === 1` → 校验 hex 串:长度 `≤ 2*1024*1024`、`% 16 === 0`、仅 `[0-9a-f]`,任一不满足抛"无效的加密歌词";通过则 `decryptQrc(hex)` → `extractQrcLyricContent`(取 `<Lyric_1 LyricContent="..."/>` 属性,无 XML 包裹用原文)→ [qrc-xml-entities.js](../../../../src/music/qrc-xml-entities.js) 的 `decodeXmlEntities`(&#x/&#/&quot;/&apos;/&lt;/&gt;/&amp;)，与全民 K 歌复用同一实体解码顺序。
- 翻译、罗马音和独立的 `qrc` 正文按上述规则解码。`parseLyricResult(lyric, translation, wordLyric, roma)` 优先用独立 QRC 配词，`qrc` 为空或标志 `0`、`1` 时用主歌词。LRC 与 QRC 优先匹配精确起点，同一起点的声部按正文区分。起点有偏差时，须在 100 ms 以内、正文相同，且两行互为唯一最近邻。任一方向有两个不同起点等距，或同刻声部仍有歧义时，该行的 `words` 留空。[提供方](../../../../src/music/providers/qq-provider-streams.js) · [歌词解析](../../../../src/music/lyric-parser.js)
- 解析出的行数 > 0 即返回;否则抛"歌词无法解析"落入回退

**路径 B(回退):旧版 Legacy 接口**([qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js)):

```
GET https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg
  songmid / pcachetime=Date.now() / g_tk / loginUin / hostUin=0 /
  format=json / inCharset=utf8 / outCharset=utf-8 / notice=0 / platform=yqq.json / needNewCode=0
```

响应 `data.lyric` / `data.trans` / `data.romalrc` 均为 Base64 → `decodeQQBase64` 后 `parseLyricResult(lyric, trans, '', romalrc)`。双路径都失败时,报错文案优先取新版路径的错误([qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js))。

### 7.4 推荐歌单([qq-provider.js](../../../../src/music/providers/qq-provider.js))

```
POST https://u.y.qq.com/cgi-bin/musicu.fcg   (requestMusicuPost)
```

`req_1 = { module: 'music.recommend.RecommendFeed', method: 'get_recommend_feed', param: { direction: 1, page, v_cache: [], v_uniq, s_num: 4 } }`,comm 固定 `{ format:'json', ct:20, cv:2241, platform:'wk_v17', guid, uin, inCharset:'utf-8', outCharset:'utf-8', notice:0, needNewCode:1 }`。

- `page` clamp 1-50;`limit` clamp 1-30 默认 9;`vUniq` 透传调用方去重列表(截 200)
- 响应路径 `req_1.data.v_shelf[].v_niche[].v_card[]`,**只取 `card.type === 500`(歌单卡片)** → `mapRecommendCard`(见 §8.3),最后 `slice(0, limit)`

### 7.5 每日推荐([qq-provider.js](../../../../src/music/providers/qq-provider.js))

两步流程,与"为你推荐"同一 Feed 接口:

1. **翻页收集 type 200 卡片**:每页 `get_recommend_feed`(同上 comm),从所有 shelf 的 `v_niche.v_card[]` 收集 `card.type === 200 && card.id` 的数值 songId;最多 `min(5, max(1, ceil(limit/9)))` 页;某页无卡片即 break
2. **批量补全歌曲信息**:`resolveTrackInfoByIds`([qq-provider.js](../../../../src/music/providers/qq-provider.js)) — `POST musicu.fcg`,`req_1 = { module: 'music.trackInfo.UniformRuleCtrl', method: 'CgiGetTrackInfo', param: { ids: <数值id列表>, types: [200,...], source: 'AiNoFree' } }`,响应 `req_1.data.tracks[]` → `mapQQSong`

去重:`seen` Set 同时记 id 与 mid;已见 id 在翻页后也加入,避免下一页重复。`limit` clamp 1-100 默认 30;`page` clamp 1-50。**Feed 无单曲卡片时回退 `getRadioTracks`**(代码注释:已从 HAR 抓包确认客户端真实流程)。

QQ 每日推荐的 `page` 是本批起始 Feed 页。`POST /api/music/home` 随 `tracks` 返回 `nextPage`，指向第一个尚未读完的页码。正常空卡片页算作已读，本批在此结束。详情成功返回时，即使只有部分卡片有歌曲或歌曲列表为空，也算读完该页。Feed 或详情请求失败时，本批立即结束，保留先前页已取得的歌曲，「换一批」从失败页重试。整批尚无歌曲时仍用电台兜底，`firstplay` 取决于本批起始页。第 50 页读完后 `nextPage` 为 `null`，重新打开每日推荐从第 1 页开始。不同 Feed 页仍可能包含相同歌曲。

### 7.6 电台([qq-provider.js](../../../../src/music/providers/qq-provider.js))

```
GET https://u.y.qq.com/cgi-bin/musicu.fcg?data=<JSON>   (requestMusicu)
  songlist: { module: 'mb_track_radio_svr', method: 'get_radio_track',
              param: { id, firstplay, num } }
```

- `id` clamp 1-9999 默认 101;`num = Math.max(15, limit)`(**不是直接传 limit**,服务端一次只回约 5 首)
- `firstplay = (round === 0 && page === 1) ? 1 : 0` — 只有第一轮且第一页才开新一轮,之后用 0 换歌;注释说明每次换新 guid 也能让服务端换一批
- 轮数 `min(12, max(3, ceil(limit/4)))`;每轮 `extractRadioSongs` 按 `tracks` / `track_list` / `songlist` 三路径取,去重后累计;**一轮 0 首新歌即停(防空转)**
- 响应路径 `data.songlist.data.{tracks|track_list|songlist}` → `mapQQSong`

### 7.7 我喜欢([qq-provider.js](../../../../src/music/providers/qq-provider.js))

分页加载可使用[音乐服务的加载会话](services.md#62-首页内容getmusichomecontentmusic-catalog-servicejs)：同次加载仅定位一次喜欢歌单，客户端接口的完整返回在该会话内切片；公开接口仍按上游实际分页。

1. `getLoginCookieHeader` 校验登录，取得本次请求的 Cookie。
2. 使用该 Cookie 调用 `getCreatedPlaylists({ limit: 500, includeLiked: true })`，只选系统目录 `dirId === '201'`。即使自建歌单也叫「我喜欢」，读写别名 `liked` 都只指向系统目录。
3. 定位成功后，读取详情或发出写入请求前重新核对当前 UIN。找不到系统目录则报错，请求在读取曲目或修改歌单前结束。

每批 `limit` 为 1–5000（默认 200），`offset` 为 0–200000。首页服务使用 `getLikedTrackPage` 返回 `{tracks, nextOffset}`。翻页偏移按原始行数推进，缺标题或 mid 的行也占一个位置。抽屉从头分页读取公开接口时，按数值歌曲 ID 去重，缺 ID 时使用 mid。可识别但无法展示的曲目计入覆盖数。直接调用 `getLikedTracks` 仍取得曲目数组。

详情给出总数时，已覆盖该数就结束，即使末页恰好满页。详情省略总数时，满页继续翻。遇到非空短页且已读曲目少于系统目录计数时，再查下一页，其余短页和明确返回的空数组表示读完。若响应缺少曲目列表、仍需翻页却出现重复页或用尽偏移，或读到空页仍未覆盖详情给出的总数，整次读取报错，保留抽屉上次完整缓存。

### 7.8 我的歌单([qq-provider.js](../../../../src/music/providers/qq-provider.js))

**路径 A(优先):客户端 API** — `POST musics.fcg?pcachetime=…`(requestMusicsClient,comm 见 §3.3):

```json
{
  "music.musicasset.PlaylistBaseRead.GetPlaylistByUin": {
    "module": "music.musicasset.PlaylistBaseRead",
    "method": "GetPlaylistByUin",
    "param": { "uin": "<QQ号>" }
  }
}
```

响应 `data[callKey].data.v_playlist[]`;模块级错误(code 非 0)经 `readQQModuleData` 统一抛"读取我的歌单失败"。

**路径 B(回退):旧版 Web API** — `GET c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss`,`hostuin=<QQ号>`、`sin=0`、`size=Math.max(limit, 50)`、`g_tk`、`loginUin` 等,响应 `data.data.disslist[]`。

结果经 `mapQQPlaylist` 映射（见 §8.2）。`includeLiked === false` 时排除系统目录 201，再取前 `limit` 项。`limit` 为 1–500，默认 200。

### 7.9 收藏歌单([qq-provider.js](../../../../src/music/providers/qq-provider.js))

同 §7.8 双路径结构:

- 客户端:`PlaylistFavRead.GetPlaylistFavInfo`,param `{ uin }`,响应 `data[callKey].data.v_list[]`
- 回退:`GET c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg`,`ct=20`、`cid=205360956`、`userid=<QQ号>`、`reqtype=3`(3 = 收藏歌单)、`sin=0`、`ein=<limit>`、`g_tk`;响应 `data.data.cdlist[]`

### 7.10 歌单详情([qq-provider.js](../../../../src/music/providers/qq-provider.js))

**路径 A（客户端 API）**　Cookie 提供 uin 与 `qm_keyst` 或 `qqmusic_key` 时调用 `DissInfoForPc.uniform_get_Dissinfo`。参数为 `{ disstid: Number(id), host_uin: Number(uin), login_uin: Number(uin) }`。上游返回完整的 `data[callKey].data.songlist[]`，Provider 按原始 `offset/limit` 切片。失败时使用路径 B，下个歌单仍可尝试客户端接口。缺少必需凭据时直接使用路径 B。

**路径 B(公开)**:`GET c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg`,参数 `type=1`、`json=1`、`utf8=1`、`onlysong=0`、`disstid=<id>`、`g_tk`、`loginUin`、`hostUin=0`、`platform=yqq`。

- **分页参数添加条件:仅当 `limit <= 100 || offset > 0`** 才附加 `song_begin=<offset>` 与 `song_num=<limit>`([qq-provider.js](../../../../src/music/providers/qq-provider.js))——即 limit > 100 且 offset = 0 时不带分页,服务端返回全部歌曲再本地截断
- 响应 `data.cdlist[0].songlist[]`(**cdlist 在顶层**,不是 `data.data` 下),`slice(0, limit)` 映射

`limit` clamp 1-5000 默认 1000;`offset` clamp 0-200000。

`getPlaylistTracks` 将当前页映射为展示曲目。归属检查 `playlistContainsTrack` 在相同接口返回的前 5000 个原始行中按数值 ID 查找，只有 mid 时按 mid 查找，命中即返回。

### 7.11 最近播放([qq-provider.js](../../../../src/music/providers/qq-provider.js))

**路径 A:musicu** — `req_0 = { module: 'music.globalchannel.GlobalChannelSvr', method: 'GetPlayHistory', param: { uin, start: 0, num: limit } }`,响应 `req_0.data.result_song_list[]` → `mapQQSong(item.songInfo || item)`;有结果即返回。

**路径 B:旧版** — `fcg_get_profile_order_asset.fcg`,`reqtype=4`(4 = 最近播放),响应 `data.data.songlist || song_list`。

双路径都空 → 抛错并附诊断:`[musicu:{code, dataKeys}]` + `[legacy keys:...]`。`limit` clamp 1-100 默认 50。

### 7.12 歌单写入([qq-provider.js](../../../../src/music/providers/qq-provider.js))

`addTracksToPlaylist` → `AddSonglist`,`removeTracksFromPlaylist` → `DelSonglist`;两者汇入 `writePlaylistTracks(method, playlist, tracks)`:

UI 的 `playlist: { id: 'liked' }` 由 Provider 复用 `getLikedPlaylist()`，读取当前账号真实的 `dirId/tid/title` 后再执行正常目标校验；普通歌单继续使用调用方传入的完整目标。未登录、未找到「我喜欢」歌单或缺少数值歌曲 ID 时直接返回明确错误，不自行拼凑上游标识。

```
POST https://u6.y.qq.com/cgi-bin/musics.fcg?_=<Date.now()>&sign=<zzcSign(body)>
```

请求体结构示意（comm + 模块，尖括号为待填占位值）:

```text
{
  "comm": { "format":"json", "ct":20, "cv":2241, "platform":"wk_v20",
            "uid":"<QQ号>", "guid":"<qqmusic_guid 或随机>", "uin":"<QQ号>",
            "g_tk_new_20200303": "<GTK>", "g_tk": "<GTK>",
            "inCharset":"utf-8", "outCharset":"utf-8", "notice":0, "needNewCode":1 },
  "music.musicasset.PlaylistDetailWrite.AddSonglist|DelSonglist": {
    "module": "music.musicasset.PlaylistDetailWrite", "method": "<AddSonglist|DelSonglist>",
    "param": { "bFmtUtf8": true, "dirId": "<歌单dirId>", "dirName": "<歌单名>",
               "tid": "<歌单tid>", "v_songInfo": [{ "songId": <数值id>, "songType": 0 }] } }
}
```

语义要点:

- **前置**:`requireLogin` → Cookie 提取 `uin`(空则抛错附 Cookie 名诊断)→ `extractQQGtkSource`(空则抛"登录 Cookie 不完整")→ `calcQQGtk`
- **写入目标校验** `normalizeQQPlaylistWriteTarget`([qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js)):`dirId`/`tid` 必须为正整数、`dirName` 非空——写入用的是**数值 dirId/tid**,不是歌单字符串 id
- **歌曲必须是数值 songId**(`sourceSongId || songId`),去重、最多 100 首、非数值直接抛"缺少 QQ 音乐数值 songId"([qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js))
- **成功判定**：`data.code === 0 && inner.code === 0 && retCode === 0` 三者均为 `0` 才算成功（[qq-provider.js](../../../../src/music/providers/qq-provider.js)）；**任何非零 code 一律抛错**（含 502——QQ 侧不做「已存在」特殊标记，区别于网易云，见 [netease-provider.md](netease-provider.md) §7.11）。成功返回 `inner.data.result || { dirId, tid, songlist: [] }`。

### 7.13 健康检查([qq-provider-streams.js](../../../../src/music/providers/qq-provider-streams.js))

健康检查读取含备份元数据的状态，用同一次分区读取取得的 Cookie 执行 `searchTracks('晴天', { limit: 1 })`。

| 条件                       | status                 |
| -------------------------- | ---------------------- |
| 搜索成功 + `auth.loggedIn` | `logged-in`            |
| 搜索成功 + 无登录          | `public-ok`            |
| 搜索抛错                   | `api-error`(ok: false) |

`auth` 经 `sanitizeAuthState` 脱敏(仅 loggedIn/cookieCount/keyCookieNames/encryptedSnapshotExists/lastSavedAt)。

## 8. 映射与工具函数

### 8.1 mapQQSong([qq-provider-utils.js:5](../../../../src/music/providers/qq-provider-utils.js#L5))

| 输出字段         | 取值顺序(首个非空)                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `sourceTrackId`  | `mid`/`songmid`/`song_mid`/`SongMid`/`songMid`(**必填**,空则整条丢弃)                              |
| `title`          | `title`/`name`/`songname`/`SongName`/`SongTitle`(必填)                                             |
| `sourceMediaId`  | `file.media_mid`/`file.mediaMid`/`media_mid`/`mediaMid`,回退 `sourceTrackId`;构造标准/HQ/SQ 文件名 |
| `sourceSongId`   | `id`/`songid`/`songId`/`song_id`/`SongId`/`SongID` 数值化,非安全整数或 ≤0 → 0                      |
| `sourceSongType` | `type`/`songtype`/`songType`/`SongType` 数值化,非安全整数或 <0 → 0;播放 vkey 请求原样复用          |
| `sourceAlbumId`  | `album.mid`/`album.id`,回退 `albummid`/`AlbumMid`                                                  |
| `artists`        | `singer[].name` 或 `singers[].name`,拼接 `SingerName`/`SingerTitle`                                |
| `album`          | `album.title`/`album.name`/`albumname`/`albumdesc`/`AlbumName`/`AlbumTitle`                        |
| `durationMs`     | `max(0, Number(interval \|\| SongPlayTime) * 1000)` — 秒转毫秒                                     |
| `coverUrl`       | 见 §8.4                                                                                            |
| `playable`       | `true`，实际播放地址由 §7.2 解析                                                                   |
| `vip`            | `pay.pay_play > 0 \|\| Vip > 0`                                                                    |
| `id`             | `qq:<sourceTrackId>`                                                                               |

点歌匹配使用 `artists` 中的全部署名。请求写作 `Anna / Bill` 时，两位歌手分别列在候选中也能获得歌手加分，顺序不限。见[歌曲匹配规则](services.md#9-歌曲匹配song-matcherjs)。

### 8.2 mapQQPlaylist([qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js))

`id`(content_id/dissid/tid/id)、`title` 必填;`dirId` 与 `tid` 单独透出(写入与"我喜欢"识别用);`trackCount`/`playCount`/`creatorUserId`(uin/hostuin)/`coverUrl` 按多键回退。

### 8.3 mapRecommendCard([qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js))

`{ id, source:'qq', title, description: subtitle, coverUrl: cover, trackCount: 0, playCount: cnt, creatorUserId:'', dirId:'' }` — 推荐卡片无 dirId/tid,不可直接写入。

### 8.4 封面 URL([qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js))

优先响应内直链(`coverUrl`/`cover`/`picurl`/`imgurl`/`albumcover`/`AlbumPic`/`AlbumPic150X150`/`AlbumPic300X300`/`AlbumPic500X500`/`SingerPic`/`SingerPic300X300`/`album.picUrl`/`album.picurl`/`album.imgurl`),命中 `^https?://` 才直接用;否则 `https://y.gtimg.cn/music/photo_new/T002R300x300M000{albumMid}.jpg`。

### 8.5 其他工具

| 函数                               | 行为                                                      | 出处                                                                                   |
| ---------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `stripJsonp`                       | `/^[^(]*\(([\s\S]*)\)\s*;?$/` 剥掉 JSONP 回调壳           | [qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js) |
| `buildGuid`                        | `1000000000 + floor(random()*9000000000)` 的 10 位数字串  | [qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js) |
| `clampInteger`                     | 有限数值截断到 [min,max],否则回退值                       | [qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js) |
| `extractCookieValue` | `(?:^\|;\s*)<name>=([^;]+)` 取单个 Cookie 值 | [qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js) |
| `readQQModuleData`                 | 模块级 code 非 0 抛"<动作>失败(code=…)",返回 `inner.data` | [qq-provider-utils.js](../../../../src/music/providers/qq-provider-utils.js) |

## 9. 登录态要求总表

| 操作                                                                     | 需要登录 | 判定方式                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 搜索 / 歌词 / 播放 URL / 推荐歌单 / 每日推荐 / 电台 / 歌单详情(公开路径) | ❌       | —(播放 URL 按 Cookie 有无自动置 `loginflag`)                                                                                                                                                                                                                             |
| 我喜欢 / 我的歌单 / 收藏歌单 / 最近播放 / 歌单写入                       | ✅       | 先检查当前会话的 `loggedIn`。未登录或读取失败时再按 §3.1 检查兼容性 Cookie。客户端歌单接口另需 `uin` 和 `authst`（§3.3），缺失时按各端点规则回退 Web 接口。 |
| 健康检查                                                                 | ❌       | 状态按 §7.13 区分                                                                                                                                                                                                                                                        |

Provider 工厂与健康聚合见 [services.md](services.md) §3;本地 HTTP 暴露见 [api.md](../api.md) 的 music-routes 节。
