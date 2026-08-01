# QQ Music API Capture 分析文档

> **对应抓包文件**: [qq-music-api-capture.har](./qq-music-api-capture.har) (24 MB, 616 条请求)
> **文档版本**: v2.0 | **生成日期**: 2026-08-01

---

## 目录

1. [基本信息](#一基本信息)
2. [数据概览](#二数据概览)
3. [域名体系](#三域名体系)
4. [认证体系](#四认证体系)
5. [API 端点详细清单](#五api-端点详细清单)
   - [5.1 主 API 网关 — u6.y.qq.com](#51-主-api-网关--u6yqqcom)
   - [5.2 用户与内容服务 — c.y.qq.com](#52-用户与内容服务--cyqqcom)
   - [5.3 埋点统计 — stat.y.qq.com](#53-埋点统计--statyqqcom)
   - [5.4 WUP 协议 — wup.browser.qq.com](#54-wup-协议--wupbrowserqqcom)
   - [5.5 客户端 Web 页面 — i2.y.qq.com](#55-客户端-web-页面--i2yqqcom)
   - [5.6 主站配置 — y.qq.com](#56-主站配置--yqqcom)
   - [5.7 媒体资源 URL 模式](#57-媒体资源-url-模式)
   - [5.8 微信小程序运行时](#58-微信小程序运行时)
6. [协议特征总结](#六协议特征总结)
7. [安全机制](#七安全机制)
8. [抓包会话时间线](#八抓包会话时间线)
9. [背景噪声请求](#九背景噪声请求)
10. [抓包局限性](#十抓包局限性)
11. [与项目代码的对照](#十一与项目代码的对照)
12. [术语表](#十二术语表)
13. [数据用途](#十三数据用途)

---

## 一、基本信息

| 项目 | 值 |
|------|-----|
| **文件名** | `qq-music-api-capture.har` |
| **格式** | HTTP Archive (HAR) 1.2 |
| **抓包工具** | Fiddler Classic 5.0.20262.6151 |
| **导出时间** | 2026-08-01 18:33:38 (UTC+8) |
| **会话时长** | ~35 秒 (18:32:48 → 18:33:23) |
| **目标应用** | QQ音乐 PC 客户端 v22 (`cv=2241`) |
| **客户端 UIN** | `2740057397` |
| **客户端 GUID** | `DCC80AEBDF22A78F006244552E3BC900` |
| **服务器区域** | `sh`（上海机房） |
| **客户端出口 IP** | `183.200.11.148` |

---

## 二、数据概览

### 2.1 请求总量

| 类别 | 数量 | 说明 |
|------|------|------|
| **总条目** | 616 | HAR log.entries 总数 |
| **CONNECT 隧道** | 326 | Fiddler 作为 HTTPS 中间人代理时建立的隧道（全部目标端口 :443） |
| **数据请求（去隧道）** | 290 | 可检查 HTTP 内容的实际请求 |
| **QQ音乐域名（含隧道）** | 345 | URL 涉及 qq.com / qqmusic / tencent / gtimg 域名的所有条目 |
| **QQ音乐数据请求（去隧道）** | ~271 | 仅非 CONNECT 的 QQ 音乐域名请求 |
| **唯一域名** | 41 | 所有出现过的唯一 hostname |
| **唯一 API 端点** | 96 | 按 `HTTP方法 + 域名 + 路径` 去重（仅 QQ 相关域名） |

### 2.2 HTTP 方法

| Method | 数量 | 用途 |
|--------|------|------|
| `CONNECT` | 326 | HTTPS 隧道建立（Fiddler 解密代理的基础） |
| `POST` | 187 | API 调用 — 主要为 `musics.fcg`（106 次）、WUP 协议（11 次）、统计上报 |
| `GET` | 102 | 配置 XML/JSON、专辑封面 JPEG、音频 M4A/MFLAC 探测、运营接口 |
| `OPTIONS` | 1 | CORS 预检（B站日志上报） |

### 2.3 状态码

| Status | 数量 | 典型场景 |
|--------|------|----------|
| `200` | 608 | 正常响应 |
| `304` | 3 | 图片 CDN 缓存命中（`y.gtimg.cn`） |
| `206` | 2 | HTTP Range 请求（断点续传） |
| `403` | 2 | 防盗链/鉴权拒绝 |
| `202` | 1 | 请求已接受（异步处理） |

### 2.4 响应内容类型分布

| MIME Type | 数量 | 对应接口/资源 |
|-----------|------|--------------|
| `text/plain; charset=utf-8` | 106 | **`musics.fcg`** — 加密 JSON 响应（Brotli 压缩） |
| `image/jpeg` | 59 | 专辑封面 / 歌单封面 / 歌手头像 / UI 素材 |
| `text/html` | 36 | CGI XML 响应 — 登录认证 / 歌单数据 / 上报确认 |
| `text/html;charset=gb2312` | 12 | 统计接口 — `stat.y.qq.com` |
| `application/octet-stream` | 10 | 闪屏数据 / 二进制埋点 |
| `application/multipart-formdata` | 9 | WUP 二进制协议响应 |
| `audio/mp4` | 7 | M4A 音频流 |
| `application/json;charset=utf-8` | 7 | JSON API — 歌单审查 / 数据上报 / VIP 信息 |
| `video/mp4` | 2 | MV 视频流 |
| `audio/x-ogg` | 2 | OGG 音频流 |
| `application/xml` | 2 | 客户端 XML 配置 |

---

## 三、域名体系

### 3.1 核心 API 域名（按数据请求数排序）

| 域名 | 数据请求 | CONNECT 隧道 | 总计 | 角色 |
|------|----------|-------------|------|------|
| **`u6.y.qq.com`** | 106 | ~40 | **146** | **主 API 网关** — 所有音乐数据查询的统一入口 (`musics.fcg`) |
| **`c.y.qq.com`** | 57 | ~7 | **64** | **用户与内容服务** — 登录/歌单/VIP/监控/运营 |
| **`y.gtimg.cn`** | 51 | ~5 | **56** | **图片 CDN** — 腾讯图片服务 |
| **`stat.y.qq.com`** | 26 | ~4 | **30** | **埋点统计** — 播放行为/数据上报 |
| **`wup.browser.qq.com`** | 11 | ~11 | **22** | **WUP 协议网关** — 腾讯二进制通信协议 |
| **`y.qq.com`** | 3 | ~1 | **4** | **主站配置** — XML 配置文件 / JSON 路由表 |

### 3.2 CDN 域名

| 域名 | 说明 | URL 模式 |
|------|------|----------|
| **`y.gtimg.cn`** | 腾讯图片 CDN（51 次） | `T002R300x300M{hex}_{ver}.jpg` — 专辑封面，支持多种尺寸 |
| **`qpic.y.qq.com`** | 歌单封面（5 次） | `/music_cover/{40位hash}/{size}` |
| **`aqqmusic.tc.qq.com`** | 高品质 M4A 音频（2 次） | `/C200{songMID}.m4a` |
| **`music-file.y.qq.com`** | 歌单封面原图（1 次） | `/songlist/{hash}.jpg` |
| **`mv.music.tc.qq.com`** | MV 视频主节点（1 次） | `/{token}/{guid}/qmmv_{vid}.f0.mp4` |
| **`mv6.music.tc.qq.com`** | MV 视频备用节点（1 次） | 同上 |
| **`ws.stream.qqmusic.qq.com`** | 标准音质音频流（1 次） | `/C200{songMID}.m4a` |
| **`ws6.stream.qqmusic.qq.com`** | 音频流备用节点（1 次） | 同上 |
| **`pic6.y.qq.com`** | 用户头像（1 次） | `/qqmusic/avatar/{hex}-{ts}/{size}` |
| **`dldir1.qq.com`** | 客户端资源下载（1 次） | `/music/clntupate/ios/Lyric_SC2TC_Word.json` |

### 3.3 其他域名

| 域名 | 说明 |
|------|------|
| **`i2.y.qq.com`** | 客户端内嵌 Web 页面 — 皮肤/头像 VAP 动效、歌单详情页 |
| **`open.weixin.qq.com`** | 微信小程序运行时 (Ocean SDK) 上报 |
| **`thirdqq.qlogo.cn`** | QQ 头像 CDN（第三方域名） |

### 3.4 IP 直连 CDN 节点

以下 IP 直接出现在 URL 中（绕过 DNS），均为中国移动/电信边缘 CDN 节点。这些请求全部为 CONNECT 隧道（端口 :443），Fiddler 无法解密其内部 HTTP 内容：

| IP | CONNECT 隧道数 | 推断用途 |
|----|---------------|----------|
| `111.31.240.86` | 105 | 主要音频流 CDN |
| `221.181.98.242` | 50 | 音频流 CDN |
| `183.224.47.137` | 47 | 音频流 CDN |
| `183.194.198.84` | 21 | 音频流 CDN |
| `183.194.204.109` | 7 | 音频流 CDN |
| `117.144.241.215` | 5 | 音频流 CDN |
| `111.6.166.23` | 3 | 音频流 CDN（含 MFLAC 无损） |

> **说明**：部分 IP 直连请求的 URL 中嵌入了实际目标域名（如 `111.6.166.23/amobile.music.tc.qq.com/...`），这是客户端通过 IP 直连 + Host 头指定目标主机的"半直连"模式。其中 `111.6.166.23` 还承载了 MFLAC 无损音频格式的传输。

---

## 四、认证体系

### 4.1 登录凭证链

QQ音乐 PC 客户端使用多层认证体系，启动时通过 `c.y.qq.com` 的单次请求获取所有后续接口所需的凭证：

```
本地存储的 Cookie (QQ 登录态)
    ↓
qm_autologin2.fcg  →  uin, key, guid, gkey, UDP 服务器列表, 心跳间隔...
    ↓
所有后续 API 请求均附带 uin + key + guid + gkey + version + miniversion
```

### 4.2 公共请求参数

几乎所有 `c.y.qq.com` 和 `stat.y.qq.com` 的 CGI 请求都携带以下参数：

| 参数 | 示例值 | 说明 |
|------|--------|------|
| `pcachetime` | `1785580373` | 客户端时间戳（毫秒级 Unix time），用于防缓存 |
| `uin` | `2740057397` | 当前登录的 QQ 号 |
| `key` | `Q_H_L_63k3NFGcY7GgjwHdszLrFKnnHjCkMODs9aujwQm0kjANINlWFNCA4CbDtx4DqZd6ZlKtap2hvjpNBIbSsHVzJ_aIKlxXdZbFOnyFP2e2OBdU9xSYI6fbpvcdrBpMftabf8vbqHjTlNOpXUc5jI` | 登录凭证（动态变化，极长，>200 字符） |
| `guid` | `DCC80AEBDF22A78F006244552E3BC900` | 设备唯一标识（32 位十六进制，与网卡 MAC 相关） |
| `gkey` | `A04D15C58FE6620B1479F9D9930F6366998E67F25F894EE3` | 全局密钥（40 位十六进制） |
| `version` | `22` | 协议主版本号 |
| `miniversion` | `41` | 协议子版本号 |

> ⚠️ **安全提示**：以上示例中的 `uin`、`key`、`guid`、`gkey` 均为真实抓包数据。这些凭证有时效性（通常 2 小时内过期），但在此期间内可被用于 impersonation 攻击。请勿公开分享原始 HAR 文件。

### 4.3 自动登录接口详解 (`qm_autologin2.fcg`)

**请求**：
```
POST https://c.y.qq.com/qqmusic/fcgi-bin/qm_autologin2.fcg?pcachetime=1785580376
```
（无 POST body，认证信息来自客户端本地存储的 Cookie）

**响应**（XML 包裹，单响应含 8+ 个 `<cmd>` 节点）：

```xml
<!--
<command-lable-xwl78-qq-music>

<!-- cmd 1012: 核心认证信息 -->
<cmd value="1012" verson="3">
  <result recode="0" errstring=""/>
  <uin>2740057397</uin>
  <key>17B79816ED827B30468122A4834453AC4697CE0FCAA5CC2DB0DF453863B367F7</key>
  <privatekey>D</privatekey>
  <guid>DCC80AEBDF22A78F006244552E3BC900</guid>
  <gkey>A04D15C58FE6620B1479F9D9930F6366998E67F25F894EE3</gkey>
  <autoupgrade>0</autoupgrade>
  <bgupgrade>0</bgupgrade>
  <digital_album_flag>1</digital_album_flag>
  <cookie>
    <domain>qqmusic.qq.com</domain>
    <domain>music.qq.com</domain>
    <domain>y.qq.com</domain>
  </cookie>
</cmd>

<!-- cmd 1008: 广告展示控制 -->
<cmd value="1008" verson="3">
  <isshow>0</isshow>
</cmd>

<!-- cmd 1051: 会话 ID -->
<cmd value="1051" verson="22">
  <music_sessionid>1785580375</music_sessionid>
</cmd>

<!-- cmd 1009: 心跳/轮询间隔 -->
<cmd value="1009" verson="3">
  <interval>601</interval>                          <!-- 心跳间隔 601 秒 -->
  <inactiveinterval>3600</inactiveinterval>         <!-- 非活跃心跳 3600 秒 -->
  <updatelistinterval>1800</updatelistinterval>     <!-- 歌单更新间隔 1800 秒 -->
  <autouploadlistenmusic>
    <listenmusicinterval>600</listenmusicinterval>   <!-- 听歌上报间隔 600 秒 -->
    <listenmusicmin>1</listenmusicmin>
  </autouploadlistenmusic>
  <isrplstingmus>1</isrplstingmus>
</cmd>

<!-- cmd 1206: 社交限制 -->
<cmd value="1206" verson="3">
  <sharemusicmax>20</sharemusicmax>                 <!-- 单次最多分享 20 首歌 -->
  <attefriendmax>5</attefriendmax>                  <!-- 单次最多 @5 位好友 -->
</cmd>

<!-- cmd 1041: UDP 服务器列表（歌词/上报/P2P） -->
<cmd value="1041" verson="6">
  <helloudpsrv><ip>119.147.10.65</ip><port>8008</port></helloudpsrv>
  <rpthistoryudpsrv><ip>121.14.94.183</ip><port>8000</port></rpthistoryudpsrv>
  <lstmusudpsrv><ip>pclistening.music.qq.com</ip><port>8000</port></lstmusudpsrv>
  <lsturludpsrv><ip>stat.music.qq.com</ip><port>17785</port></lsturludpsrv>
  <lyricudpsrv><ip>58.60.11.12</ip><port>8000</port></lyricudpsrv>
  <nickudpsrv><ip>121.14.94.183</ip><port>8001</port></nickudpsrv>
</cmd>

<!-- cmd 1053: 活动弹窗 -->
<cmd value="1053" verson="7">
  <timetag>25</timetag>
  <content><![CDATA[]]></content>
  <minicontent><![CDATA[]]></minicontent>
  <logo_url><![CDATA[]]></logo_url>
</cmd>

<!-- cmd 1084: 听歌识曲 -->
<cmd value="1084" verson="810">
  <interval>5</interval>
  <listnum>5</listnum>
  <maxsongnum>3000</maxsongnum>
</cmd>

</command-lable-xwl78-qq-music>
-->
```

> **关键发现**：`autologin2` 是一个"全家桶"接口 — 一次请求返回认证凭证 (1012)、广告开关 (1008)、会话 ID (1051)、心跳策略 (1009)、分享限额 (1206)、UDP 服务器地址 (1041)、活动弹窗 (1053) 和听歌识曲配置 (1084)。这种设计减少了启动时的网络往返次数。

---

## 五、API 端点详细清单

> 以下列出 96 个唯一 API 端点中的主要接口，按服务域名分组。频率指本次 35 秒抓包期间的调用次数。

### 5.1 主 API 网关 — `u6.y.qq.com`

#### `POST /cgi-bin/musics.fcg` — 统一音乐数据接口 [106 次，占所有数据请求的 37%]

QQ音乐的**核心 API 网关**。所有音乐数据查询（搜索、推荐、歌单、歌曲信息、歌词、配置）都通过此接口，采用"模块化网关"模式：单一 HTTP 端点 + JSON body 中的模块指令路由。

| 属性 | 值 |
|------|-----|
| 方法 | `POST` |
| 查询参数 | `pcachetime`, `_` (毫秒时间戳), `sign` (请求签名) |
| 响应 Content-Type | `text/plain; charset=utf-8` |
| 响应编码 | **Brotli** (`Content-Encoding: br`) |
| 响应大小范围 | 164 bytes ~ 5.5 MB（中位数 1 KB） |
| 服务器标识 | `Server: qm` |
| 追踪头 | `U-Location: {cdn_node}`, `U-Traceid: {trace_id}` |

**响应头示例**：
```
Server: qm
Date: Sat, 01 Aug 2026 10:32:53 GMT
Content-Type: text/plain; charset=utf-8;
Content-Encoding: br
Content-Length: 2533
U-Location: 513826642_360428163
U-Traceid: 64587bfa7a56f3f8
Area: sh
Vary: Accept-Encoding
```

**响应体结构**（客户端解密/解压后的 JSON）：
```json
{
  "code": 0,
  "ts": 1785580373417,
  "start_ts": 1785580373413,
  "traceid": "64587bfa7a56f3f8",
  "UniteConfig.UniteConfigRead.GetUniteConfig": {
    "code": 0,
    "data": {
      "code": 0,
      "config": "{\"AutoVolum\":{\"downsection\":\"8\",...}}"
    }
  }
}
```

**模块命名规范**：`{ServiceName}.{MethodName}.{ActionName}`，例如 `UniteConfig.UniteConfigRead.GetUniteConfig`。

**已知模块列表**（从响应中提取）：
- `UniteConfig.UniteConfigRead.GetUniteConfig` — 统一配置（音量均衡/P2P/CDN 策略等）
- 响应中还包含 `P2PVersionSwitch`（P2P 下载策略）、`error_matching_rule`（错误处理规则）、`cdn_race_section`（CDN 竞速配置）、`ipv6_strategy`（IPv6 策略）等配置项

> ⚠️ **局限性**：本次抓包中所有 106 条 `musics.fcg` 的 POST body 均未被捕获（为空或未记录）。可能原因：Fiddler 未正确捕获加密/压缩的请求体，或请求参数在自定义 Header 中。在实际 QQ音乐客户端中，请求 body 格式为 `data={JSON}` 的 form-encoded 或直接 JSON。**需要额外的抓包配置来捕获请求 body**（如禁用请求压缩或使用更底层的抓包工具）。

---

### 5.2 用户与内容服务 — `c.y.qq.com`

`c.y.qq.com` 承载 21 个不同的 API 端点，是接口最多的服务域名。按功能分组：

#### 5.2.1 登录认证类 (4 个接口)

| # | 接口 | 方法 | 频率 | 说明 |
|---|------|------|------|------|
| 1 | `/qqmusic/fcgi-bin/qm_autologin2.fcg` | POST | 1 | 自动登录 — 返回 uin/key/guid/gkey + 全部初始化配置 |
| 2 | `/folder/fcgi-bin/fcg_qm_login_stat.fcg` | POST | 1 | 登录状态上报 |
| 3 | `/vipmusic/fcgi-bin/fcg_vip_login.fcg` | GET | 1 | VIP 登录状态 + 购买信息 |
| 4 | `/qqmusic/fcgi-bin/qm_get_vipinfo.fcg` | GET | 1 | VIP 详情（等级/加速/特权/皮肤/年费状态） |

**`/qqmusic/fcgi-bin/qm_get_vipinfo.fcg` 请求参数完整示例**：
```
?version=22
&miniversion=41
&uin=2740057397
&key=Q_H_L_63k3NFGcY7GgjwHdszLrFKnnHjCkMODs9aujwQm0kjANINlWFNCA4CbDtx4DqZd6ZlKtap2hvjpNBIbSsHVzJ_aIKlxXdZbFOnyFP2e2OBdU9xSYI6fbpvcdrBpMftabf8v
&guid=DCC80AEBDF22A78F006244552E3BC900
&gkey=A04D15C58FE6620B1479F9D9930F6366998E67F25F894EE3
&t1=0&t2=0&t3=0
&neednick=1
&pcachetime=1785580376
```

**响应包含**：绿钻等级 (level=6)、加速次数 (speed=7)、年费图标 URL、VIP 成长值 (30911/7)、下一级所需天数 (need_time=60)、皮肤 URL、特权页面入口等。

**`/vipmusic/fcgi-bin/fcg_vip_login.fcg` 响应示例**（JSON 格式）：
```json
{
  "code": 0,
  "msg": "",
  "payblock": 0,
  "qq": 2740057397,
  "ct": 19,
  "cv": 2241,
  "vipinfo": {"viptype": 0},
  "download": {
    "paylimittips": "本月还可以下载300首付费歌曲",
    "vipsongtips": "",
    "vipexpiretips": "",
    "songbuytips": "你已购买此歌曲",
    "button": "",
    "jumpurl": "http%3A%2F%2Fy.qq.com%2Fwkframe%2Fclient%2Fminipay.html%3F..."
  }
}
```

#### 5.2.2 歌单服务类 (3 个接口)

| # | 接口 | 方法 | 频率 | 说明 |
|---|------|------|------|------|
| 5 | `/folder/fcgi-bin/fcg_uniform_playlst_detail_read.fcg` | POST | 15 | **歌单详情** — 获取歌单内全部歌曲列表 |
| 6 | `/folder/fcgi-bin/fcg_uniform_playlst_summary_read.fcg` | POST | 8 | **歌单摘要** — 获取歌单名称/封面/歌曲数 |
| 7 | `/rsc/fcgi-bin/fcg_diss_censor_status.fcg` | GET | 7 | **歌单审查状态** — 检查歌单是否通过内容审核 |

**歌单详情接口 (`9101`) — 响应格式**：

XML 外层 + base64 编码的 zlib 压缩内层：
```xml
<?xml version="1.0" encoding="utf-8"?>
<command-lable-xwl78-qq-music>
<cmd value="9101" version="800">789CB554CD6ED4400C7E165EA0FC...
（base64 + zlib 压缩的二进制数据，解压后为 XML/JSON 歌单+歌曲数据）
</cmd>
</command-lable-xwl78-qq-music>
```

**歌单摘要接口 (`9102`) — 响应格式**：结构同上，`cmd value="9102"`。

**歌单审查状态 — 请求**：
```
?dirid=21&version=22&miniversion=41&uin=2740057397&key=...&guid=...&gkey=...
```

**歌单审查状态 — 响应**（JSON 明文）：
```json
{
  "code": 0,
  "subcode": 0,
  "message": "ok",
  "data": {
    "censor_status": [{
      "diss_name": "猫殿最全歌单",
      "tid": 7527135346,
      "dirid": 21,
      "status": 11,
      "cmtflg": 0,
      "commit_time": 7527135346,
      "status_name": "未查询到状态"
    }]
  }
}
```

**dirid 值含义**（从抓包中观察到）：
| dirid | 推测含义 |
|-------|----------|
| 21 | 自建歌单 |
| 22 | 收藏歌单 |
| 24-26 | 其他歌单分类 |
| 50-52 | 推荐/个性歌单 |
| 201 | "我喜欢" |
| 314 | 热歌榜/分类榜 |

#### 5.2.3 个人主页/收藏类 (2 个接口)

| # | 接口 | 方法 | 频率 | 说明 |
|---|------|------|------|------|
| 8 | `/fav/fcgi-bin/fcg_get_profile_order_asset.fcg` | POST | 1 | 个人主页资产 — 收藏歌单列表 |
| 9 | `/rsc/fcgi-bin/fcg_personality_center.fcg` | POST | 1 | 个性中心 — 当前皮肤/主题信息 |

**`fcg_get_profile_order_asset.fcg` 响应示例**（JSON，28 个歌单）：
```json
{
  "code": 0,
  "subcode": 0,
  "data": {
    "totaldiss": 28,
    "has_more": 0,
    "cdlist": [
      {
        "dissid": 8030253709,
        "dissname": "恋爱微醺女声 | 今日糖分补充到",
        "songnum": 114,
        "listennum": 6740725,
        "logo": "http://qpic.y.qq.com/music_cover/Lf6US6khNuqRzmhzdgqUFWQj36P9icg3QhtHIhAcSXuhd0anZqibQy2A/300?n=1",
        "dirid": 52,
        "dirtype": 2,
        "isshow": 1,
        "uin": 2142492895,
        "encrypt_uin": "ow6Powvqowcq7v**",
        "nickname": "小鲁不一班",
        "createtime": 1623586853,
        "type": 10014
      }
    ]
  }
}
```

> **字段说明**：`encrypt_uin` 是加密+掩码处理后的用户 UIN（`*` 为掩码字符），用于保护歌单创建者隐私。`type: 10014` 表示收藏的歌单。

#### 5.2.4 监控与设备类 (4 个接口)

| # | 接口 | 方法 | 频率 | 说明 |
|---|------|------|------|------|
| 10 | `/monitor/fcgi-bin/fcg_access_moni.fcg` | POST | 5 | 访问监控上报（`<cmd>report success</cmd>`） |
| 11 | `/monitor/fcgi-bin/fcg_init.fcg` | GET | 1 | 监控配置初始化 — 返回加密的 IP/Domain 列表 |
| 12 | `/base/fcgi-bin/wns_device_register.fcg` | POST | 2 | WNS (Wireless Name Service) 设备注册 |
| 13 | `/qqmusic/fcgi-bin/qm_getudpinfo2.fcg` | POST | 1 | **UDP 服务器/P2P 信息** — 返回全部实时通信服务器地址 |

**`qm_getudpinfo2.fcg` — UDP 服务器完整列表**：

| XML 标签 | 地址 | 端口 | 用途 |
|----------|------|------|------|
| `udpsrv` | `pdlmusic.p2p.qq.com` | 8000 | P2P 音乐下载 |
| `tcpsrv` | `pdlmusic.p2p.qq.com` | 8000 | P2P 下载 TCP 备用 |
| `bktcpsrv` | `bk.pdlmusic.p2p.qq.com` | 8000 | P2P 下载 TCP 容灾 |
| `stunsrv` | `stun-a1.qq.com` | 8000 | STUN NAT 穿透 |
| `helloudpsrv` | `119.147.21.110` | 8008 | 心跳/保活 |
| `rpthistoryudpsrv` | `121.14.94.183` | 8000 | 播放历史上报 |
| `lstmusudpsrv` | `pclistening.music.qq.com` | 8000 | 听歌列表同步 |
| `lsturludpsrv` | `stat.music.qq.com` | 17785 | 听歌 URL 统计 |
| `lyricudpsrv` | `58.60.11.12` | 8000 | 歌词获取 |
| `nickudpsrv` | `121.14.94.183` | 8001 | 昵称/用户信息 |
| `pushlistudpsrv` | `info.qqmusic.qq.com` | 8000 | 歌单推送 |
| `loclyricudpsrv` | `info.qqmusic.qq.com` | 19000 | 本地歌词匹配 |
| `chkuserlistupload` | `info.qqmusic.qq.com` | 17783 | 用户列表上传校验 |
| `chkuserlistdownload` | `info.qqmusic.qq.com` | 17783 | 用户列表下载校验 |
| `bottomlistudpsrv` | `58.60.13.216` | 17782 | 底部推荐列表 |
| `localdatarptudpsrv` | `stat.music.qq.com` | 8000 | 本地数据上报 |
| `heartbeatsrv` | `119.147.2.96` | 17784 | 心跳（间隔 2400 秒） |

**P2P 限速策略**（来自同一响应）：
- 启动后 15 秒内：限速 20%
- 首速上限：45056 B/s (44 KB/s)
- 常态上限：18432 B/s (18 KB/s)

#### 5.2.5 运营与配置类 (5 个接口)

| # | 接口 | 方法 | 频率 | 说明 |
|---|------|------|------|------|
| 14 | `/musichall/fcgi-bin/fcg_action_ctrl` | GET | 2 | **歌曲权限/付费控制** — 查询指定歌曲的试听/下载权限 |
| 15 | `/tips/fcgi-bin/fcg_get_advert.fcg` | GET | 2 | 广告/Tips 拉取 |
| 16 | `/musichall/fcgi-bin/3g_get_splash.fcg` | GET | 2 | 启动闪屏（base64 JSON） |
| 17 | `/monitor/fcgi-bin/fcg_music_get_pc_tips.fcg` | GET | 1 | PC 端 Tips（如"无智力"提示） |
| 18 | `/3gmusic/fcgi-bin/3g_action_alter` | GET | 1 | 绿钻到期/续费提醒弹窗 |

**`fcg_action_ctrl` — 歌曲权限查询**：

请求参数：
```
?cid=483
&ct=19
&cv=2241
&cmd=getsonginfo
&qq=2740057397
&songids=200390803,205684555,213533141,219038363,235069670,276964034,297473516,639372917
&songtypes=0
&ctx=1
&pcachetime=1785580377
```

响应（JSON，每个 songid 对应一个权限对象）：
```json
{
  "data": {
    "defaultSwitch": 1049363,
    "200390803": {
      "type": 0,
      "switch": 16897793,
      "icons": 14073854,
      "alert": 21,
      "msgid": 13,
      "payTrackMonth": 1,
      "payTrackPrice": 200,
      "payAlbumPrice": 0,
      "payPlay": 1,
      "payDownload": 1,
      "payStatus": 0,
      "trySize": 1441122,
      "tryBegin": 72447,
      "tryEnd": 100134
    }
  }
}
```

**权限字段解读**：
| 字段 | 值 | 含义 |
|------|-----|------|
| `payTrackPrice` | 200 | 单曲购买价 **2.00 元**（单位：分） |
| `payAlbumPrice` | 0 | 整张专辑购买价 0（不提供整张购买） |
| `payStatus` | 0 | 用户**未购买**此歌曲 |
| `payPlay` | 1 | 需要付费才能播放 |
| `payDownload` | 1 | 需要付费才能下载 |
| `trySize` | 1441122 | 试听片段总大小（bytes） |
| `tryBegin` | 72447 | 试听起始偏移（bytes） |
| `tryEnd` | 100134 | 试听结束偏移（bytes） |
| `alert` | 21 | 弹窗类型（21=付费提示, 41=VIP 提示） |
| `type` | 0 | 歌曲类型（0=普通） |

#### 5.2.6 其他接口 (3 个)

| # | 接口 | 方法 | 频率 | 说明 |
|---|------|------|------|------|
| 19 | `/vipdown/fcgi-bin/fcg_3g_song_list_rover.fcg` | POST | 1 | VIP 下载歌曲列表（本次返回空：`"songlist":[]`） |
| 20 | `/grpc/fcgi-bin/fcg_pc_lyrics_bubble_personal.fcg` | GET | 1 | 歌词气泡主题（返回气泡样式 URL + 文案） |
| 21 | `/qqmusic/fcgi-bin/qm_rpstopmus.fcg` | GET | 2 | 上报当前播放歌曲（`cmd value="1016"`） |

---

### 5.3 埋点统计 — `stat.y.qq.com`

| # | 接口 | 方法 | 频率 | 响应格式 | 说明 |
|---|------|------|------|----------|------|
| 1 | `/pc/fcgi-bin/a_player_stat.fcg` | POST | 12 | `text/html;charset=gb2312` | **播放器行为统计** — 最常见的上报接口 |
| 2 | `/3g/fcgi-bin/imusic_tj` | POST | 8 | `application/octet-stream` | **移动端统计** — 响应为 base64 编码的二进制（35 bytes） |
| 3 | `/pc/fcgi-bin/fcg_datarpt.fcg` | POST | 4 | `application/json;utf-8` | **通用数据上报** — 响应 `{"retcode":0}` |
| 4 | `/pc/fcgi-bin/reportmus.fcg` | POST | 2 | `text/html` | **歌曲播放上报** — 含 cmd 1010 (确认) + 1008 (广告) |

**`a_player_stat.fcg` 响应**（GB2312 编码的 JSON）：
```json
{"retcode":0}
```
（固定 14 bytes，Content-Encoding: gzip）

**`imusic_tj` 响应**（base64 二进制，35 bytes 解码后为 protobuf）：
```
AAAAAAB4AatWSs5PSVWyUjBQ0FHKLU5XslJSqlUAAEfKBdc=
```

**`reportmus.fcg` 响应**（XML，与 autologin2 同格式）：
```xml
<command-lable-xwl78-qq-music>
<cmd value="1010" verson="3">
  <result recode="0" errstring=""/>
  <qq uin="2740057397" />
</cmd>
<cmd value="1008" verson="3">
  <isshow>0</isshow>
</cmd>
</command-lable-xwl78-qq-music>
```

> **服务器特征**：`stat.y.qq.com` 使用腾讯自研的 `QZHTTP-2.38.x` 服务器，区别于 `c.y.qq.com` 使用的 Nginx。

---

### 5.4 WUP 协议 — `wup.browser.qq.com`

| 属性 | 值 |
|------|-----|
| 端点 | `POST /` |
| 协议 | **WUP** (Wup Uniform Protocol) |
| 编码 | **JCE** (Jce Communication Encoder) — 腾讯自有的二进制序列化协议 |
| 请求数 | 11（POST 含 body）+ 11（CONNECT 隧道） |

**请求体结构**（十六进制 + 可读片段）：
```
00 00 00 xx 10 02 2c 3c 4c 56 0b 71 62 63 6c 6f    .....,<LV.qbclo
75 64 63 74 72 6c 66 0c 67 65 74 43 6c 6f 75 64    udctrlf.getCloud
43 74 72 6c 7d 00 01 00 xx 08 00 01 06 03 72 65    Ctrl}.........re
71 18 00 01 06 0f 51 42 2e 43 6c 6f 75 64 43 74    q.....QB.CloudCt
72 6c 52 65 71 1d 00 01 00 ...
```

**可读信息**：
- 服务名：`qbcloudctrlf`（QQ 浏览器云控模块）
- 方法名：`getCloudCtrl`
- 请求类型：`QB.CloudCtrlReq`
- 客户端版本：`3.53.47.400`
- 设备标识：`21a7b212e9af025c5124e04b716d714f`

**响应**：
```json
{"err": 2}
```

> `err=2` 表示认证失败（当前环境非 QQ 浏览器，缺少必要的浏览器 Cookie/Token），但 QQ音乐客户端仍然继续正常运行。这说明 WUP 云控是**可选功能**，失败不阻塞音乐播放。

---

### 5.5 客户端 Web 页面 — `i2.y.qq.com`

| # | 接口 | 方法 | 说明 |
|---|------|------|------|
| 1 | `/n3/wk_v20/entry/index/skin/avatar_vap` | GET | 皮肤/头像 VAP 动效 Web 页面（23 KB HTML） |

QQ音乐 PC 客户端大量使用内嵌 Web 页面（WebView/CEF）。此请求返回一个完整的 HTML 页面，引用了 CDN 上的 CSS/JS 资源，用于渲染头像的 VAP (Video Animation Player) 动效。

---

### 5.6 主站配置 — `y.qq.com`

| # | 接口 | 方法 | 说明 |
|---|------|------|------|
| 1 | `/wkframe/client/config/feedback.xml` | GET | 反馈问题分类配置（XML, 8 KB） |
| 2 | `/wkframe/client/config/jump_webkit.xml` | GET | Webkit 跳转路由表（XML, 14 KB） — ptlogin URL ↔ 内部 CGI 映射 |
| 3 | `/m/client/config/url.pc.json` | GET | **PC 客户端 URL 路由表**（JSON, 11 KB） |

**`url.pc.json` — PC 客户端路由表**（部分）：
```json
{
  "url_key": {
    "theme_v20":         {"url": "https://i2.y.qq.com/n3/wk_v20/entry/index/skin/theme"},
    "voice_v20_url":     {"url": "https://i2.y.qq.com/n3/wk_v20/entry/index/voice"},
    "free_listen_dialog":{"url": "https://i2.y.qq.com/n3/wk_v20/entry/index/frame/free_listen"},
    "wechat_game_login": {"url": "https://i2.y.qq.com/n3/wk_v20/entry/index/frame/wechat_game_login"},
    "medal_collection_singer": {"url": "https://y.qq.com/n3/medal_collection/pages/medal_collection_v3/star_detail.html?...&platform=pc"},
    "playlist_detail_v20_url": {"url": "https://i2.y.qq.com/n3/wk_v20/entry/index/playlist_detail/index"},
    "recommend_v20_url":      {"url": "https://i2.y.qq.com/..."},
    "login_url":        {"url": "https://y.qq.com/wk_v17/common_login.html#/login?QQAppid=100497308&WXAppid=wx48db31d50e334801"},
    "radio_v17_url":    {"url": "https://y.qq.com/wk_v17/radio.html"},
    "listen_together_confirm":    {"url": "https://i2.y.qq.com/n3/wk_v20/entry/index/frame/listen_together/confirm"},
    "listen_together_summary":    {"url": "https://i2.y.qq.com/n3/wk_v20/entry/index/frame/listen_together/summary"},
    "listen_together_invitation": {"url": "https://i2.y.qq.com/n3/wk_v20/entry/index/frame/listen_together/invitation"}
  }
}
```

> 路由表中包含了 QQ 音乐各种功能的 Web 页面地址：登录页、歌单详情、推荐页、电台、一起听、勋章、皮肤等。这些页面的基础路径在 `i2.y.qq.com`，版本路径为 `wk_v20`，同时保留了旧版 `wk_v17` 的兼容路径。

**`jump_webkit.xml` — Webkit 跳转规则**：定义了从 QQ 登录 (ptlogin) URL 到内部 CGI 的映射关系：
```xml
<item>
  <jumpurl>http://ptlogin2.qq.com/qqmusic_8?</jumpurl>
  <targeturl>http://c.y.qq.com/qzone/fcg-bin/qm_autologin.fcg?</targeturl>
</item>
<item>
  <jumpurl>http://ptlogin2.qq.com/qqmusic_185?</jumpurl>
  <targeturl>http://c.y.qq.com/qqmusic/fcgi-bin/qm_getsonginfo.fcg?</targeturl>
</item>
```
（共映射了 20+ 对 ptlogin → CGI 的关系）

---

### 5.7 媒体资源 URL 模式

#### 5.7.1 音频文件

**M4A（AAC 编码，有损）**：
```
http://aqqmusic.tc.qq.com/C200003mAan70zUy5O.m4a
  ?vkey=E0A42A9C9BC7BB1763AE1C538F8707371B957E901B7A149AF85FF92E1B127E6388F6E2E9390B5B67678F4B06DBB761B3F9BAE6A1EB31E8C6__v21ebdd7f1
  &guid=DCC80AEBDF22A78F006244552E3BC900
  &uin=0
  &fromtag=3
```

**URL 结构解析**：
| 部件 | 值 | 说明 |
|------|-----|------|
| 域名 | `aqqmusic.tc.qq.com` | 高品质音频 CDN（A 类节点） |
| 路径 | `/C200{songMID}.m4a` | `C200` = 音频类型前缀，`003mAan70zUy5O` = 歌曲 MID |
| `vkey` | 140 字符 | 临时访问凭证，含 `__v2` 版本标识，有时效性 |
| `guid` | 32 位 hex | 设备 GUID |
| `fromtag` | `3` | 来源标识（3 = PC 客户端播放器） |

**MFLAC（FLAC 无损，加密）**：
```
http://111.6.166.23/amobile.music.tc.qq.com/F0M0002IAbWz0pY7qM.mflac
```
- 路径前缀：`F0M000`（区别于 M4A 的 `C200`）
- 格式：`.mflac` — QQ音乐自有的加密 FLAC 格式（需要解密后才能播放）
- 传输方式：IP 直连 + Host 头指定 `amobile.music.tc.qq.com`

**多级 CDN 回源**（同一首歌 `C200003mAan70zUy5O` 的 3 次请求）：

| 顺序 | CDN 节点 | 类型 |
|------|----------|------|
| 1 | `aqqmusic.tc.qq.com` | 高品质（AAC M4A） |
| 2 | `ws6.stream.qqmusic.qq.com` | 标准音质（备用节点 6） |
| 3 | `ws.stream.qqmusic.qq.com` | 标准音质（主节点兜底） |

> ⚠️ 抓包中所有音频请求的响应体仅 2 bytes (`e30=` = base64 `{}`)，表明这些是 **Range 预检** 或 **HEAD 探测**请求（客户端在检查 CDN 可用性和延迟）。实际的音频流数据通过 CONNECT 隧道传输，未经 Fiddler 解密。

#### 5.7.2 MV 视频 (MP4)

```
http://mv6.music.tc.qq.com/
  {64位hex_token}/
  DCC80AEBDF22A78F006244552E3BC900/
  qmmv_0b53raaakaaavmaatb7marsfjcaaaweaabka.f0.mp4
```

**URL 结构**：
| 路径段 | 含义 |
|--------|------|
| 第 1 段 (64 位 hex) | 用户/设备 token（含 `ZZ` 分隔符） |
| 第 2 段 (32 位 hex) | 设备 GUID |
| 文件名 `qmmv_{vid}.f0.mp4` | `f0` = 视频分片编号（第 0 片） |

**腾讯云 COS 元数据**（响应头）：
```
X-COS-META-VIDEO: appid=60011&bizid=84&bucket=bucket84&filetype=mp4
                  &sha1=445a5c3f08995b318498f546abad1cab96783817
                  &size=14&updatetime=1693191209
```
- `appid=60011` — 腾讯云应用 ID
- `bizid=84` — 业务线编号（QQ音乐视频）
- `sha1` — 文件完整性校验

#### 5.7.3 专辑/歌手封面 (JPEG)

```
https://y.gtimg.cn/music/photo_new/T002R300x300M000004eSusD1skn9s_3.jpg?max_age=2592000
```

**URL 模板**：`/music/photo_new/T{类型}R{宽}x{高}M{8位hex}{序号}_{版本}.jpg`

| 类型代码 | 含义 |
|----------|------|
| `T002` | 专辑封面 |
| `T062` | 歌手头像 |
| `T003` | 其他图片素材 |

| 尺寸示例 | 像素 |
|----------|------|
| `R150x150` | 150×150（列表缩略图） |
| `R300x300` | 300×300（播放器封面） |

**CDN 缓存策略**：`max_age=2592000` = 30 天。`Age` 响应头显示图片已被缓存 42 小时 ~ 14 天不等。

**图片服务器响应头**：
```
Server: ImgHttp3.0.0
X-DataSrc: 9
X-BCheck: 0_1
X-Delay: 5440 us
X-Info: real data
```

#### 5.7.4 歌单封面

```
http://qpic.y.qq.com/music_cover/{40位十六进制hash}/600?n=1
```

尺寸后缀：`/300` (缩略图)、`/600` (详情页)。

#### 5.7.5 用户头像

```
https://pic6.y.qq.com/qqmusic/avatar/{hex_string}-{unix_timestamp}/140
```

---

### 5.8 微信小程序运行时 (Ocean SDK)

QQ音乐 PC 客户端内嵌了**微信小程序运行时**（Ocean SDK），用于支持微信小程序在客户端内运行。

| 接口 | 方法 | 说明 |
|------|------|------|
| `open.weixin.qq.com/wxaruntime/ocean/batchreport` | POST ×2 | Ocean SDK 批量事件上报 |

**请求体**（SDK 环境探测事件）：
```json
{
  "report_list": [{
    "project": "Ocean",
    "host_appid": "wx6b60fbda5d87d519",
    "session_id": "",
    "device_brand": "",
    "device_model": "",
    "device_id": "",
    "count": 0,
    "uin": 0,
    "clientversion": 21,
    "start_time": 1785580373237,
    "end_time": 0,
    "duration": 0,
    "error_code": 0,
    "action": "sdk_support_platform",
    "os_name": "Windows 11 x64",
    "os_version": "10.0.26200",
    "architecture": "x64",
    "process_name": "sdk",
    "context_id": "fca28dcb-8f55-4670-98bc-302addd7c187"
  }]
}
```

**响应**：
```json
{"base_resp": {"ErrCode": 0, "ErrMsg": "ok"}}
```

> `host_appid: wx6b60fbda5d87d519` 是 QQ音乐在微信开放平台的 AppID。Ocean SDK 在客户端启动时进行平台兼容性检测并上报。

---

## 六、协议特征总结

### 6.1 响应格式分类

QQ音乐后台同时使用了**四种**响应格式，体现了系统演进的痕迹：

| 格式 | MIME 类型 | 接口范围 | 特点 |
|------|-----------|----------|------|
| **XML 包裹** | `text/html` | `c.y.qq.com` 大部分 CGI | `<!-- <command-lable-xwl78-qq-music>` 注释包裹，内嵌多个 `<cmd value="XXXX">` 节点 |
| **加密 JSON** | `text/plain; charset=utf-8` | `u6.y.qq.com` 全部请求 | Brotli 压缩 + AES 加密，`Server: qm` |
| **JSON 明文** | `application/json;charset=utf-8` | `c.y.qq.com` 部分新接口 | RESTful 风格，`{"code":0,...}` |
| **二进制** | `application/octet-stream` / `multipart-formdata` | WUP / 埋点 | JCE 编码 / Protobuf |

### 6.2 XML 响应中的 cmd value 对照表

| cmd value | 含义 | 出现接口 |
|-----------|------|----------|
| `1008` | 广告展示控制 | autologin2, reportmus |
| `1009` | 心跳/轮询间隔 | autologin2 |
| `1010` | 上报确认 | reportmus |
| `1012` | 认证信息 | autologin2 |
| `1016` | 歌曲播放上报 | qm_rpstopmus |
| `1041` | UDP 服务器列表 | autologin2 |
| `1047` | VIP 信息 | qm_get_vipinfo |
| `1050` | Webkit 跳转规则 | jump_webkit.xml |
| `1051` | 音乐会话 ID | autologin2 |
| `1053` | 活动弹窗 | autologin2 |
| `1056` | 监控域名配置 | fcg_init |
| `1084` | 听歌识曲配置 | autologin2 |
| `1088` | （未知）| autologin2 |
| `1206` | 社交限额 | autologin2 |
| `4106` | UDP/P2P 信息 | qm_getudpinfo2 |
| `9101` | 歌单详情数据 | fcg_uniform_playlst_detail_read |
| `9102` | 歌单摘要数据 | fcg_uniform_playlst_summary_read |

### 6.3 服务器标识对照

| `Server` 响应头 | 对应服务 | 说明 |
|-----------------|----------|------|
| `qm` | `u6.y.qq.com` | QQ音乐核心后端，Brotli 压缩 |
| `nginx` | `c.y.qq.com` / `i2.y.qq.com` | 通用 CGI 网关 / Web 页面 |
| `QZHTTP-2.38.23` / `2.38.40` | `stat.y.qq.com` | 腾讯自研 HTTP 服务器（QZHTTP） |
| `ImgHttp3.0.0` | `y.gtimg.cn` | 腾讯图片 CDN 服务器 |
| `Lego Server` | `mv.music.tc.qq.com` | MV 视频 CDN（腾讯云 COS 前端） |
| `nws_static_mid` | `y.qq.com` 静态资源 | NWS (Nginx Web Server) 静态文件服务 |

### 6.4 通用响应头

几乎所有非静态资源的响应都包含：
- `Area: sh` — 上海机房（客户端通过此头判断最优接入点）
- `UUID: {10位数字}` — 请求唯一标识
- `Pragma: no-cache` / `Cache-Control: max-age=0` — 禁用缓存（API 响应）

---

## 七、安全机制

### 7.1 传输层安全

| 属性 | 值 |
|------|-----|
| **TLS 版本** | TLS 1.3 |
| **加密套件** | `AES128 128bits` + `SHA256` + `ECDHE` 密钥交换 |
| **证书颁发者** | DigiCert Secure Site OV G2 TLS CN RSA4096 SHA256 2022 CA1 |
| **证书有效期** | 2025-09-28 → 2026-10-28 |
| **SAN 域名** | `y.qq.com`, `*.music.qq.com`, `*.music.tc.qq.com`, `*.y.qq.com`, `*.gtimg.cn`, `*.wesingapp.com`, `*.kg.qq.com`, `*.live.kg.qq.com`, `kg.qq.com`, `kg2.qq.com` ... `kg9.qq.com` |

### 7.2 应用层安全

| 机制 | 实现方式 | 影响 |
|------|----------|------|
| **动态 key** | 127 字符十六进制字符串，每次 `autologin2` 刷新 | 重放攻击防御 |
| **请求签名** | `musics.fcg` 的 `sign` 参数 | 防止参数篡改 |
| **响应加密** | `musics.fcg` 响应体经 AES 加密 | 防止中间人窃听音乐数据 |
| **vkey 临时凭证** | 音频 URL 中的 140 字符 token，有时效性 | 防止音频直链被盗用 |
| **encrypt_uin** | 其他用户 UIN 用掩码（`*`）替代部分字符 | 隐私保护 |
| **证书固定 (Certificate Pinning)** | 客户端可能限制可接受的证书 CA | 增加中间人抓包难度 |

---

## 八、抓包会话时间线

本次抓包会话仅持续约 **35 秒**（18:32:48 → 18:33:23），捕获了 QQ音乐 PC 客户端**冷启动**过程中的完整网络活动。

### 8.1 请求时间分布

按 `startedDateTime` 聚合的请求密度：

| 时间段 (UTC+8) | 事件 |
|---------------|------|
| **18:32:48** | Fiddler 自身更新检查 (`api.getfiddler.com`) |
| **18:32:52** | 大量 CONNECT 隧道开始建立（~100 条/秒） |
| **18:32:52–18:32:54** | **启动爆发期**：autologin2、VIP 查询、闪屏、设备注册、配置拉取集中发起 |
| **18:32:55–18:32:56** | 音频探测期：M4A Range 请求 ×3（不同 CDN）+ MV 视频探测 |
| **18:32:56–18:32:58** | 数据处理期：歌单详情/摘要请求、审查状态查询、个性中心、收藏列表 |
| **18:32:58–18:33:01** | 页面加载期：Web 页面请求、活动弹窗、URL 路由表 |
| **18:33:01–18:33:20** | **稳定播放期**：`musics.fcg` ×60+ 次（拉取歌曲数据）+ 持续统计上报 |
| **18:33:20–18:33:23** | 会话结束：最后几次 `reportmus` + `qm_rpstopmus` 上报 |

### 8.2 用户行为推断

从请求序列可以还原用户操作：

1. **18:32:52** — 用户启动 QQ音乐 PC 客户端
2. **18:32:52–18:32:55** — 客户端自动登录、拉取配置
3. **18:32:55–18:32:56** — 客户端开始预加载音频流（探测 CDN 延迟）
4. **18:32:56–18:32:58** — 用户浏览歌单列表（`playlst_detail_read` ×15, `summary_read` ×8）
5. **18:33:01–18:33:20** — 用户播放了一首歌（`C200003mAan70zUy5O`），客户端通过 `musics.fcg` 拉取歌词/推荐等数据
6. **18:33:20** — 用户切换歌曲或停止播放（`reportmus` 上报）

---

## 九、背景噪声请求

抓包中还包含 19 条与 QQ音乐无关的请求（来自用户机器的其他应用），已在分析中排除：

| 来源应用 | 域名 | 请求数 | 说明 |
|----------|------|--------|------|
| **Fiddler 自身** | `api.getfiddler.com` | 1 | 启动时检查更新 |
| **VS Code** | `main.vscode-cdn.net` | 1 | 扩展市场元数据 |
| **ChatGPT Desktop** | `chatgpt.com` / `ab.chatgpt.com` | 4 | 注册/心跳/任务列表/错误上报 |
| **Bilibili** | `data.bilivideo.com` / `data.bilibili.com` | 2 | 视频日志/Web 日志上报 |
| **未知服务** | `token.6666633.xyz` | 2 | 认证令牌验证+订阅查询 |
| **Microsoft 遥测** | `mobile.events.data.microsoft.com` | 1 | OneCollector 遥测 |
| **音乐直连探测** | `111.6.166.23/amobile.music.tc.qq.com` | 3 | 音频/FLAC 直连（含 MFLAC 无损格式） |

---

## 十、抓包局限性

本文档基于单次 35 秒的抓包分析，存在以下已知局限：

| 局限 | 影响 | 改进建议 |
|------|------|----------|
| **`musics.fcg` 请求 body 未捕获** | 无法分析客户端请求的模块指令和参数结构 | 使用 Wireshark + 解密 keylog，或配置 Fiddler 捕获请求体 |
| **CONNECT 隧道内部流量不可见** | 326 条隧道中的实际 HTTP 请求未知 | 需客户端信任 Fiddler 根证书并启用 HTTPS 解密 |
| **会话时长短（35 秒）** | 只能看到启动流程，缺少搜索/下载/评论等功能的请求 | 延长抓包时间，覆盖更多用户操作场景 |
| **单次抓包** | 无法对比不同版本/不同账号/不同网络环境的行为差异 | 多次抓包，覆盖不同场景 |
| **无 WebSocket 捕获** | 如果有实时推送（如一起听功能），本抓包中未体现 | 检查客户端是否使用 WSS，并在 Fiddler 中启用 WebSocket 捕获 |

---

## 十一、与项目代码的对照

| 抓包中观察到的接口 | 项目中的对应实现 | 文件位置 |
|-------------------|------------------|----------|
| `musics.fcg` — 音乐数据查询 | `QQMusicProvider` — 所有音乐 API 调用的底层 | [src/music/providers/qq-provider.js](../../../src/music/providers/qq-provider.js) |
| `fcg_uniform_playlst_detail_read.fcg` — 歌单详情 | `getPlaylistDetail()` | 同上 |
| `fcg_uniform_playlst_summary_read.fcg` — 歌单摘要 | `getCreatedPlaylists()` / `getCollectedPlaylists()` | 同上 |
| `qm_autologin2.fcg` — 自动登录 | `bilibili-auth.js` — 认证管理 | [src/electron/bilibili-auth.js](../../../src/electron/bilibili-auth.js) |
| `fcg_action_ctrl` — 歌曲权限 | 付费/试听控制逻辑 | [src/music/song-service.js](../../../src/music/song-service.js) |
| 歌单 ID 导出 | `dump-playlists.js` | [../dump-playlists.js](../../dump-playlists.js) |
| 歌词服务 | `lyrics-service.js` — 歌词获取与解析 | [src/music/lyrics-service.js](../../../src/music/lyrics-service.js) |

---

## 十二、术语表

| 缩写/术语 | 全称 | 说明 |
|-----------|------|------|
| **HAR** | HTTP Archive | W3C 标准的 HTTP 事务存档格式 |
| **CGI** / **fcg** | Common Gateway Interface / FastCGI | QQ音乐后端使用 `.fcg` 后缀的端点 |
| **UIN** | User Identification Number | QQ 号（数字 ID） |
| **GUID** | Globally Unique Identifier | 设备唯一标识，32 位十六进制 |
| **gkey** | Global Key | 全局密钥，用于 API 请求签名/加密 |
| **WUP** | Wup Uniform Protocol | 腾讯自有的二进制通信协议 |
| **JCE** | Jce Communication Encoder | WUP 协议使用的序列化编码 |
| **MID** | Music ID | QQ音乐内部歌曲唯一标识（如 `003mAan70zUy5O`） |
| **M4A** | MPEG-4 Audio | AAC 编码的音频容器格式 |
| **MFLAC** | Music FLAC | QQ音乐自有的加密无损音频格式 |
| **Brotli (br)** | — | Google 开发的无损压缩算法，`musics.fcg` 使用 |
| **Ocean SDK** | — | 微信小程序运行时，嵌入在 QQ音乐客户端中 |
| **dirid** | Directory ID | 歌单目录分类 ID |
| **dissid/tid** | Dissertation ID | 歌单唯一 ID |
| **CCD** | Content Caching & Delivery | CDN 节点中的缓存层 |
| **WNS** | Wireless Name Service | 腾讯设备注册/寻址服务 |

---

## 十三、数据用途

此抓包文件的适用场景：

1. **API 逆向工程** — 分析 QQ音乐 PC 客户端与服务端的完整通信协议
2. **歌单接口验证** — 对比 `fcg_uniform_playlst_detail_read.fcg` / `summary_read.fcg` 的实际响应格式与项目 `qq-provider.js` 的实现差异
3. **登录流程研究** — 追踪 Cookie → `autologin2` → key/gkey 的完整认证链路，理解多 cmd 节点的初始化设计
4. **CDN 架构分析** — 了解多级回源策略（M4A 高品质 → 标准音质流 → IP 直连边缘节点 → MFLAC 无损）
5. **加密方案研究** — 分析 `musics.fcg` 的请求 `sign` 签名和 Brotli+AES 加密响应
6. **客户端行为还原** — 通过埋点数据和请求时序还原用户的完整操作路径
7. **新增端点发现** — 与现有代码中已实现的接口清单对比，发现未覆盖的新端点

---

*文档生成于 2026-08-01，基于 Fiddler Classic 对 QQ音乐 PC 客户端 v22 的 35 秒抓包数据。*
*验证状态：所有统计数字已与 HAR 源文件交叉核对 ✓*
