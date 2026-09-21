# Bilibili 直播协议:HTTP API、WBI 签名与 WebSocket 弹幕长连

> 涉及文件:[api-client.js](../../../../src/bilibili/danmaku/api-client.js)、[wbi-signer.js](../../../../src/bilibili/wbi-signer.js)、[websocket-connection.js](../../../../src/bilibili/danmaku/websocket-connection.js)、[packet-decoder.js](../../../../src/bilibili/parsers/packet-decoder.js)、[protobuf-decoder.js](../../../../src/bilibili/protocols/protobuf-decoder.js)、[danmaku-parser.js](../../../../src/bilibili/parsers/danmaku-parser.js)、[superchat-parser.js](../../../../src/bilibili/parsers/superchat-parser.js)、[gift-identity-hints.js](../../../../src/bilibili/users/gift-identity-hints.js)、[gift-command-utils.js](../../../../src/bilibili/parsers/gift-command-utils.js)、[user-meta-extractor.js](../../../../src/bilibili/utils/user-meta-extractor.js)、[helpers.js](../../../../src/bilibili/helpers.js)、[danmaku-client.js](../../../../src/bilibili/danmaku-client.js) 的连接部分、[message-handlers.js](../../../../src/bilibili/danmaku/message-handlers.js) 的分发部分

本文档是 **Bilibili 平台出向协议**的唯一事实源:HTTP 端点、WBI 签名、WebSocket 二进制帧、自实现 Protobuf 解码与消息解析规则只在此成表。平台侧 API 的完整参考(用户/直播间信息、管理、消息流等)见 [`docs/bilibili-live-api/`](../../../bilibili-live-api/info.md) 目录,本文不复述。消息经解析后进入的监听管线见 [danmaku.md](danmaku.md),礼物/SC 的入库与服务层见 [gift.md](gift.md)。

**礼物相关消息边界：** `gift-command-utils.js` 只识别消息命令和重复舰队提示；`users/gift-identity-hints.js` 只读取发送者 UID、昵称、头像及已验证的舰队身份。客户端没有原始礼物解析器，不计算金额、数量、连击、盲盒或订单身份；礼物账本接收服务器确认的结果。

## 1. 架构总览

```
BilibiliDanmakuClient (顶层编排, 见 danmaku.md)
├─ BilibiliApiClient        HTTP API 层 (8 个 JSON/表单端点 + 头像图片读取, 见 §2)
├─ WBI 签名 (wbi-signer)     getDanmuInfo / nav 的签名与密钥缓存
├─ WebSocketConnection       二进制帧封装 + 心跳 (30s, 见 §4)
├─ parseBilibiliPackets      帧解码 + Brotli/zlib 解压 (见 §4.4)
├─ Protobuf 解码器           自实现 LEB128 解码 (见 §5)
└─ MessageHandlers           分发: 弹幕/SC/礼物 (见 §6)
```

## 2. HTTP API(BilibiliApiClient)

`BilibiliApiClient`([api-client.js:9](../../../../src/bilibili/danmaku/api-client.js#L9))封装全部出向 HTTP 调用。**这是平台 API,不是本服务的 `/api/*`**(本服务端点见 [api.md](../api.md))。

### 2.1 通用请求头

统一由 `requestHeaders()`([api-client.js:173-185](../../../../src/bilibili/danmaku/api-client.js#L173-L185)) 生成:

| 头                   | 值                                                                 | 出处                                                                              |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `User-Agent`         | Chrome/126 桌面 UA                                                 | [api-client.js:175](../../../../src/bilibili/danmaku/api-client.js#L175)          |
| `Accept`             | `application/json, text/plain, */*`                                | [api-client.js:176](../../../../src/bilibili/danmaku/api-client.js#L176)          |
| `Accept-Language`    | `zh-CN,zh;q=0.9,en;q=0.8`                                          | [api-client.js:177](../../../../src/bilibili/danmaku/api-client.js#L177)          |
| `Origin` / `Referer` | `https://live.bilibili.com` / `https://live.bilibili.com/{roomId}` | [api-client.js:178-179](../../../../src/bilibili/danmaku/api-client.js#L178-L179) |
| `Cookie`             | 可选,有登录 Cookie 时附加,缓解 -352 风控                           | [api-client.js:181-183](../../../../src/bilibili/danmaku/api-client.js#L181-L183) |

Cookie 的来源与加密存储(login 分区/`bilibili-auth/cookies.enc`)见 [desktop/auth.md](../../desktop/auth.md),此处只消费 `cookieHeader` 字符串。运行中可用 `updateAuth(cookieHeader, uid)` 热更新([api-client.js:17-20](../../../../src/bilibili/danmaku/api-client.js#L17-L20))。

### 2.2 错误码速查

`bilibiliErrorHint(code)`([api-client.js:201-215](../../../../src/bilibili/danmaku/api-client.js#L201-L215))对平台业务码给出中文提示;`formatBilibiliApiError` 统一拼接 `http status + code + message`([api-client.js:193-199](../../../../src/bilibili/danmaku/api-client.js#L193-L199))。`fetchJson` 对非 JSON 响应单独抛错([api-client.js:149-171](../../../../src/bilibili/danmaku/api-client.js#L149-L171)),日志中的 `w_rid` 会被脱敏([api-client.js:217-219](../../../../src/bilibili/danmaku/api-client.js#L217-L219))。

| code    | 含义                                                      | 出处                                                                              |
| ------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `0`     | 成功                                                      | —                                                                                 |
| `-352`  | 风控/校验失败(WBI 签名、请求头、Cookie/设备标识、网络 IP) | [api-client.js:202-204](../../../../src/bilibili/danmaku/api-client.js#L202-L204) |
| `-400`  | 请求参数错误                                              | [api-client.js:208-210](../../../../src/bilibili/danmaku/api-client.js#L208-L210) |
| `-412`  | 请求被风控拦截                                            | [api-client.js:211-213](../../../../src/bilibili/danmaku/api-client.js#L211-L213) |
| `60004` | 直播间不存在                                              | [api-client.js:205-207](../../../../src/bilibili/danmaku/api-client.js#L205-L207) |

### 2.3 端点清单

| 端点                | URL                                                                                                           | 用途与关键响应                                                                                                                                                         | 出处                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `room_init`         | `https://api.live.bilibili.com/room/v1/Room/room_init?id={roomId}`                                            | 解析房间:`data.room_id`(标准长房号,必需)、`short_id`、`uid`(主播)、`live_status`(1=开播);随后拉 `master_info` 补 `ownerName`                                           | [api-client.js:26-29](../../../../src/bilibili/danmaku/api-client.js#L26-L29)、[api-client.js:33-41](../../../../src/bilibili/danmaku/api-client.js#L33-L41) |
| `master_info`       | `https://api.live.bilibili.com/live_user/v1/Master/info?uid={uid}`                                            | `data.info.uname` → 主播名称,失败仅告警不阻断                                                                                                                          | [api-client.js:52-61](../../../../src/bilibili/danmaku/api-client.js#L52-L61)                                                                                |
| `nav`               | `https://api.bilibili.com/x/web-interface/nav`                                                                | 当前登录账号名(`data.uname`),同时是 WBI img/sub 密钥来源(见 §3)                                                                                                        | [api-client.js:63-70](../../../../src/bilibili/danmaku/api-client.js#L63-L70)、[wbi-signer.js:50](../../../../src/bilibili/wbi-signer.js#L50)                |
| `getDanmuInfo`      | `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?{WBI签名}`                                | 参数 `{id: roomId, type: 0}` 经 WBI 签名;返回 `data.host_list[0].host` / `wss_port`(默认 443)/ `data.token`                                                            | [api-client.js:72-82](../../../../src/bilibili/danmaku/api-client.js#L72-L82)                                                                                |
| `gethistory`        | `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid={roomId}`                               | 历史弹幕降级监听:`data.admin[]` + `data.room[]`,每条约 `uid/nickname/text/timeline`;间隔 2.5s 见 [danmaku.md](danmaku.md) §3                                           | [api-client.js:93-102](../../../../src/bilibili/danmaku/api-client.js#L93-L102)                                                                              |
| `online_gold_rank`  | `https://api.live.bilibili.com/xlive/general-interface/v1/rank/getOnlineGoldRank?roomId&ruid&page&pageSize`   | 高能榜身份补全;参数/停止条件见 [danmaku.md](danmaku.md) §3                                                                                                             | [api-client.js:84-91](../../../../src/bilibili/danmaku/api-client.js#L84-L91)                                                                                |
| `fans_members_rank` | `https://api.live.bilibili.com/xlive/general-interface/v1/rank/getFansMembersRank?roomId&ruid&page&page_size` | 全量本房粉丝牌成员快照;响应 `data.item[]`、`data.num`;分页/轮询策略见 [danmaku.md](danmaku.md) §3                                                                      | [api-client.js:93-103](../../../../src/bilibili/danmaku/api-client.js#L93-L103)                                                                              |
| `send_danmaku`      | `POST https://api.live.bilibili.com/msg/send`                                                                 | 机器人回弹幕(见 [danmaku.md](danmaku.md) §7):表单 `msg/csrf/bubble/fontsize/mode/color/rnd/roomid/room_type`;`reply_mid/reply_attr/reply_uname` 仅在回复目标存在时附带 | [api-client.js:104-147](../../../../src/bilibili/danmaku/api-client.js#L104-L147)                                                                            |
| `avatar_image`      | 由已校验的 `https://*.hdslb.com/*` 用户头像 URL 决定                                                          | Node 侧读取 JPEG/PNG/WebP/GIF/AVIF，限制 2 MiB；供本地 `/api/bilibili/avatar` 代理给 Electron/OBS 页面，避免 renderer 直接建立 CDN TLS 连接                            | [api-client.js](../../../../src/bilibili/danmaku/api-client.js)                                                                                              |

`send_danmaku` 细节:`bili_jct` 从 Cookie 提取([api-client.js:107-108](../../../../src/bilibili/danmaku/api-client.js#L107-L108)),消息上限 **1000 字符**([api-client.js:109](../../../../src/bilibili/danmaku/api-client.js#L109)),回复目标经 `normalizeMentionTarget` 校验(见 [danmaku.md](danmaku.md) §6)。

头像资料、身份 hint 和图片代理支持 `//*.hdslb.com/...` 地址并规范化为 HTTPS。图片代理对没有 `@` 缩略参数的 `/bfs/garb/` 收藏集原图追加 `@256w_256h_1c_1s.webp`，避免数 MiB 的原图超过头像大小限制；已有缩略参数及普通头像保持原地址。CDN 请求不携带登录 Cookie，仍校验域名、图片类型和 2 MiB 上限。

## 3. WBI 签名算法

`wbi-signer.js` 为 `getDanmuInfo` 等需要签名的端点生成 `wts` + `w_rid`。平台侧背景见 [`docs/bilibili-live-api/info.md`](../../../bilibili-live-api/info.md)。

### 3.1 Mixin Key 推导

1. `GET https://api.bilibili.com/x/web-interface/nav`(带 §2.1 请求头,[wbi-signer.js:50-52](../../../../src/bilibili/wbi-signer.js#L50-L52));响应须含 `data.wbi_img.img_url/sub_url`,缺失即抛错([wbi-signer.js:62-65](../../../../src/bilibili/wbi-signer.js#L62-L65));code 非 0 但密钥齐全时仍继续([wbi-signer.js:66-68](../../../../src/bilibili/wbi-signer.js#L66-L68))。
2. `extractBilibiliWbiKey(url)`:取 URL pathname 最后一段,按 `.` 分割取第一部分([wbi-signer.js:81-85](../../../../src/bilibili/wbi-signer.js#L81-L85))。例:`…/wbi/7cd084941338484aae1ad9425b84077c.png` → `7cd084941338484aae1ad9425b84077c`。
3. `rawKey = imgKey + subKey`(两个 32 字符 hex 拼接)。
4. `mixinKey = WBI_MIXIN_KEY_ENC_TAB.map(i => rawKey[i]).join('').slice(0, 32)`([wbi-signer.js:70-73](../../../../src/bilibili/wbi-signer.js#L70-L73))。
5. 缓存 10 分钟:`expiresAt = nowMs + 10*60*1000`([wbi-signer.js:74-77](../../../../src/bilibili/wbi-signer.js#L74-L77));缓存未过期直接复用([wbi-signer.js:45-48](../../../../src/bilibili/wbi-signer.js#L45-L48))。

### 3.2 置换表(64 个下标)

`WBI_MIXIN_KEY_ENC_TAB`([wbi-signer.js:7-16](../../../../src/bilibili/wbi-signer.js#L7-L16)):

```
[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,
 27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
 37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,
 22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
```

### 3.3 请求签名

`signBilibiliWbiParams(params, headers)`([wbi-signer.js:87-102](../../../../src/bilibili/wbi-signer.js#L87-L102)):

1. 附加 `wts = Math.floor(Date.now()/1000)`([wbi-signer.js:90-92](../../../../src/bilibili/wbi-signer.js#L90-L92))。
2. 参数 key 按字母排序([wbi-signer.js:93-94](../../../../src/bilibili/wbi-signer.js#L93-L94))。
3. 每个 value 先去掉 `[!'()*]` 再 `encodeURIComponent`([wbi-signer.js:96-97](../../../../src/bilibili/wbi-signer.js#L96-L97))。
4. 拼 `key1=v1&key2=v2…`([wbi-signer.js:99](../../../../src/bilibili/wbi-signer.js#L99))。
5. `w_rid = md5(query + mixinKey)`(32 位小写 hex,[wbi-signer.js:100](../../../../src/bilibili/wbi-signer.js#L100));返回 `query + "&w_rid=" + w_rid`([wbi-signer.js:101](../../../../src/bilibili/wbi-signer.js#L101))。

## 4. WebSocket 弹幕长连

### 4.1 连接与认证包(op 7)

- URL:`wss://{host}:{wss_port || 443}/sub`([danmaku-client.js:181](../../../../src/bilibili/danmaku-client.js#L181)),`binaryType = 'arraybuffer'`([websocket-connection.js:25](../../../../src/bilibili/danmaku/websocket-connection.js#L25))。
- 连接成功(`open`)后立即发送认证包,`sendPacket(7, 1, authPayload)`([websocket-connection.js:28-29](../../../../src/bilibili/danmaku/websocket-connection.js#L28-L29)):

```json
{ "uid": {uid || 0}, "roomid": {标准长房号}, "protover": 3,
  "platform": "web", "type": 2, "key": "{danmuInfo.token}" }
```

组装于 [danmaku-client.js:182-189](../../../../src/bilibili/danmaku-client.js#L182-L189):`protover: 3` 请求 Brotli 压缩;`key` 为 `getDanmuInfo` 返回的 token。

### 4.2 心跳(op 2 / op 3)

- 每 `HEARTBEAT_INTERVAL_MS = 30000` 发送 `sendPacket(2, 1, {})`([websocket-connection.js:5](../../../../src/bilibili/danmaku/websocket-connection.js#L5)、[websocket-connection.js:32-44](../../../../src/bilibili/danmaku/websocket-connection.js#L32-L44))。
- 发送前先置 `awaitingHeartbeatReply = true`;收到含 op3 的包即复位([websocket-connection.js:53-55](../../../../src/bilibili/danmaku/websocket-connection.js#L53-L55)),因此 op3 回包**并非完全忽略**,而是心跳存活信号。
- 若心跳定时器触发时仍无回包 → `failConnection`(置 ws=null 并发 `close` 事件,[websocket-connection.js:33-40](../../../../src/bilibili/danmaku/websocket-connection.js#L33-L40))。
- 连接打开等待超时 **8s**(`waitForSocketOpen`,[websocket-connection.js:138-169](../../../../src/bilibili/danmaku/websocket-connection.js#L138-L169),超时值 [websocket-connection.js:144](../../../../src/bilibili/danmaku/websocket-connection.js#L144))。

### 4.3 二进制帧格式(大端)

`sendPacket(operation, version, body)` 组装发送帧([websocket-connection.js:109-119](../../../../src/bilibili/danmaku/websocket-connection.js#L109-L119));接收方向 `parseBilibiliPackets` 按同样布局读头([packet-decoder.js:49-56](../../../../src/bilibili/parsers/packet-decoder.js#L49-L56)):

```
[packetLength] [headerLength] [protoVer] [operation] [sequence]
    u32 BE         u16 BE       u16 BE     u32 BE      u32 BE
    4 bytes        2 bytes      2 bytes    4 bytes     4 bytes

packetLength: 16 + body.length     (发送帧)
headerLength: 固定 16
sequence:     发送固定 1
```

### 4.4 Operation 码

| Op  | 方向 | 含义     | 处理                                       |
| --- | ---- | -------- | ------------------------------------------ |
| 2   | C→S  | 心跳     | 30s 周期发送                               |
| 3   | S→C  | 心跳回包 | 复位 `awaitingHeartbeatReply`;不做消息解析 |
| 5   | S→C  | 推送消息 | 唯一进入消息解析的操作                     |
| 7   | C→S  | 认证     | 连接后立即发送                             |
| 8   | S→C  | 认证回包 | WebSocketConnection 记录有效整数 code 的成功/拒绝或无效回包；不进入业务消息解析 |

解析器只处理 `operation === 5` 的包,其余跳过([packet-decoder.js:58](../../../../src/bilibili/parsers/packet-decoder.js#L58))。

认证观察不改变现有 open/重连逻辑；首次心跳仍未收到认证回包时，记录一次
`auth-no-reply`，默认 30 秒。诊断字段、落盘与复现方式见 [danmaku.md §8.1](danmaku.md#81-登录到点歌的本地日志)。

### 4.5 帧解析与解压

`parseBilibiliPackets(buffer)`([packet-decoder.js:46-86](../../../../src/bilibili/parsers/packet-decoder.js#L46-L86)):

```
while (offset + 16 <= buffer.length):
  读头 → packetLength / headerLength / protoVer / operation
  仅 operation == 5 继续

  按 protoVer 解码 body:
    protoVer 3 → zlib.brotliDecompressSync(body)
                → 递归 parseBilibiliPackets (解压后是嵌套帧)
    protoVer 2 → zlib.inflateSync(body) (raw deflate)
                → 递归 parseBilibiliPackets
    protoVer 0/1 → body.toString('utf8').trim()
                  → splitJsonObjects 分割多个 JSON 对象
                  → JSON.parse 每个对象 (解析失败跳过)

  offset += packetLength > 0 ? packetLength : buffer.length
```

**部分帧/边界处理**:浏览器 `WebSocket` 保证每次 `message` 事件是一个完整帧,故无跨帧缓冲;单帧内可能含多个包,靠 `offset + 16 <= len` 循环逐个消费。`packetLength` 异常(过小/越过帧尾)由 `containsOperation` 的边界校验兜底([websocket-connection.js:172-181](../../../../src/bilibili/danmaku/websocket-connection.js#L172-L181))。解压失败仅告警并跳过该包([packet-decoder.js:60-64](../../../../src/bilibili/parsers/packet-decoder.js#L60-L64)、[packet-decoder.js:66-70](../../../../src/bilibili/parsers/packet-decoder.js#L66-L70))。

`splitJsonObjects(text)`([packet-decoder.js:9-44](../../../../src/bilibili/parsers/packet-decoder.js#L9-L44)):逐字符扫描,跟踪 `{}` 嵌套深度与字符串/转义状态,深度回到 0 时切分一个 JSON 块。

## 5. 自实现 Protobuf 解码器

零依赖实现([protobuf-decoder.js](../../../../src/bilibili/protocols/protobuf-decoder.js)),仅用于解码 `SEND_GIFT_V2` 的 `data.pb` 字段。

### 5.1 Varint 解码

`readBilibiliProtoVarint(buffer, offset)`([protobuf-decoder.js:18-34](../../../../src/bilibili/protocols/protobuf-decoder.js#L18-L34)):

- LEB128 无符号,**BigInt 运算**,移位上限 63 位([protobuf-decoder.js:23](../../../../src/bilibili/protocols/protobuf-decoder.js#L23));`byte & 0x7f` 取 7 位值,`byte & 0x80` 为续读标志,每轮 `shift += 7`。
- 越界/溢出返回 `null`。

### 5.2 字段解码

`decodeBilibiliProtoFields(buffer, depth = 0)`([protobuf-decoder.js:36-82](../../../../src/bilibili/protocols/protobuf-decoder.js#L36-L82)):

- key 为 varint:`field = floor(key / 8)`,`wireType = key % 8`;**禁止 field 0**,只接受 wireType `0/1/2/5`,非法直接返回 `null`([protobuf-decoder.js:45-48](../../../../src/bilibili/protocols/protobuf-decoder.js#L45-L48))。
- wireType 0(varint):超过 `Number.MAX_SAFE_INTEGER` 转十进制字符串,否则 Number([protobuf-decoder.js:51-55](../../../../src/bilibili/protocols/protobuf-decoder.js#L51-L55))。
- wireType 1(64-bit):保留 8 字节 Buffer([protobuf-decoder.js:56-59](../../../../src/bilibili/protocols/protobuf-decoder.js#L56-L59))。
- wireType 5(32-bit):保留 4 字节 Buffer([protobuf-decoder.js:60-63](../../../../src/bilibili/protocols/protobuf-decoder.js#L60-L63))。
- wireType 2(length-delimited):读长度截取 chunk;**depth < 5 时递归解码**;递归后无字段或已达深度上限 → `chunk.toString('utf8')`([protobuf-decoder.js:64-75](../../../../src/bilibili/protocols/protobuf-decoder.js#L64-L75))。
- 值追加到 `fields[field]` 数组(支持 repeated,[protobuf-decoder.js:77-78](../../../../src/bilibili/protocols/protobuf-decoder.js#L77-L78))。
- 入口:`decodeBilibiliGiftV2Proto(value)` 先 `cleanText` 后 Base64 解码([protobuf-decoder.js:84-93](../../../../src/bilibili/protocols/protobuf-decoder.js#L84-L93))。

### 5.3 SEND_GIFT_V2 身份字段

[gift-identity-hints.js](../../../../src/bilibili/users/gift-identity-hints.js) 使用通用 Protobuf 解码器，仅从根字段 `1` 读取 UID、`2` 读取昵称。它不解释 giftInfo 的金额、数量或连击字段，也不要求这些字段存在。解码失败时继续尝试包中的 JSON 发送者字段；缺少 UID 则忽略。

## 6. 消息解析与分发(协议 → 领域事件)

`MessageHandlers.handlePackets` 对每个解析出的 JSON 对象按 `cmd` 分发([message-handlers.js:58-73](../../../../src/bilibili/danmaku/message-handlers.js#L58-L73)),并逐条记录诊断(见 [danmaku.md](danmaku.md) §8):

| 条件                               | 路由                   | 事件                                                             |
| ---------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| `cmd` 以 `DANMU_MSG` 开头          | 弹幕                   | `onMessage(source:'danmaku')`                                    |
| `cmd` 以 `SUPER_CHAT_MESSAGE` 开头 | SC                     | `onSuperChat` + 命令文本二次分发 `onMessage(source:'superchat')` |
| `isBilibiliGiftLikeCommand(cmd)` | 发送者身份（见 §6.4） | `handleIdentityMessage` → 用户信息服务 |
| 其他                               | —                      | 仅记诊断,跳过                                                    |

### 6.1 弹幕(DANMU_MSG)

`extractBilibiliDanmakuTimestamp(info)`([danmaku-parser.js:9-20](../../../../src/bilibili/parsers/danmaku-parser.js#L9-L20)):时间戳候选 `info[0][4]/[0][5]/[0][6]`,须满足 `|ts - now| < 30 天` 否则回退 `Date.now()`([danmaku-parser.js:11-15](../../../../src/bilibili/parsers/danmaku-parser.js#L11-L15))。

`MessageHandlers.handleDanmaku` 的字段读取([message-handlers.js:75-80](../../../../src/bilibili/danmaku/message-handlers.js#L75-L80)):

```
info[1]           → 弹幕文本
info[2][0]/[2][1] → uid / userName
info[3]           → 粉丝牌数组 (数组或对象)
info[0][13]       → 整条图片表情（对象或 JSON 字符串），正文作为缺失 text 的触发文本
info[0][15]       → danmakuOptions（对象或 JSON 字符串）,可内含 user、emoticon、emots、extra
```

发送者头像由 `danmakuOptions.user.face` 或 `danmakuOptions.user.base.face` 提取，并只接受 HTTPS 的 B 站 `*.hdslb.com` 地址；在线榜和历史消息里的头像字段经 `UserInfoService` 按 uid 合并。解析器只产出 hint，不访问 cache、profile provider 或头像代理。

弹幕表情由 `extractBilibiliDanmakuEmotes(info)` 从 `danmakuOptions` 及其 JSON `extra` 中归一化：`emoticon` 表示整条表情，`emots` 表示正文中的行内表情映射；随后补读 `info[0][13]` 的整条图片表情，即使 `info[0][15]` 缺失也必须保留该图片。输出为 `{text,url,kind,width,height}` 数组，其中 `emots` 固定标记 `kind:inline`，`emoticon` 和 slot 13 固定标记 `kind:sticker`；按来源分类，不按正文是否仅有一个表情或图片像素大小猜测，触发文本去重；同一触发文本在多个来源重复出现时保持既有 `danmakuOptions` / `extra` 的优先级。图片地址只接受 B 站 `*.hdslb.com`，并把可信的 HTTP 地址升级为 HTTPS。两种输入编码、缺少 options、来源重复及非法图片回退由 `test/bilibili-danmaku-parser.test.js` 验证；此输出沿既有弹幕流传递，feed buffer 和公开投影保留可选的 `emotes[].kind`；不增加设置、端点或事件类型。

用户元数据(勋章/大航海)由 `extractBilibiliDanmakuUserMeta`([user-meta-extractor.js:38-60](../../../../src/bilibili/utils/user-meta-extractor.js#L38-L60))提取:

- 勋章:`info[3]` 数组或 `danmakuOptions.user.medal` 对象;`readMedalName` 取数组 `[1]` 或对象 `.medal_name`([user-meta-extractor.js:14-19](../../../../src/bilibili/utils/user-meta-extractor.js#L14-L19)),`readMedalLevel` 取数组 `[0]` 或 `.medal_level`([user-meta-extractor.js:21-26](../../../../src/bilibili/utils/user-meta-extractor.js#L21-L26))。
- 大航海等级:优先 `user.guard.level`,其次当前房间勋章内的 `guard_level` 或数组回退 `info[7]` / `medalInfo[10]`([user-meta-extractor.js:46-56](../../../../src/bilibili/utils/user-meta-extractor.js#L46-L56))。
- **仅当勋章 `target_id`(数组 `[12]`)等于主播 uid 时才计入本房间身份**(`isTargetRoom`,[user-meta-extractor.js:101-112](../../../../src/bilibili/utils/user-meta-extractor.js#L101-L112))。
- 提取器同时保留匹配的 `targetUid` 供门面校验；旧元数据返回对象中的该值为非枚举兼容属性，不改变既有消息字段形状。
- `normalizeGuardLevel` 只接受 `1/2/3`([utils.js:73-76](../../../../src/shared/utils.js#L73-L76))。

弹幕产出的 `onMessage` 载荷(含 `source:'danmaku'`、`messageTimestamp`、`connectionGeneration/connectionAttempt`、归一化 cmd 和可选 `emotes`)见 [message-handlers.js](../../../../src/bilibili/danmaku/message-handlers.js),消费方是 [danmaku.md](danmaku.md) §4 的实时弹幕流及 §5 的点歌/机器人管线。

### 6.2 醒目留言(SUPER_CHAT_MESSAGE)

`extractBilibiliSuperChatMessage(packet)`([superchat-parser.js:16-42](../../../../src/bilibili/parsers/superchat-parser.js#L16-L42)):

| 输出字段               | 提取(多字段回退)                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `data.id \|\| message_id \|\| token`                                                                                          |
| `message`              | `data.message \|\| message_trans`                                                                                             |
| `price`                | `data.price \|\| rmb \|\| price_text`(经 `normalizeSuperChatPrice`,[utils.js:58-63](../../../../src/shared/utils.js#L58-L63)) |
| `uid`                  | `data.uid \|\| mid \|\| user_info.uid`                                                                                        |
| `userName`             | `user_info.uname/name/user_name \|\| data.uname/nickname`,兜底 `'观众'`                                                       |
| `avatarUrl`            | `user_info.face/face_url/faceUrl/avatar/avatar_url`,经 `normalizeBilibiliAvatarUrl` 校验                                      |
| `guardLevel`           | `medal_info.guard_level \|\| user_info.guard_level \|\| data.guard_level`                                                     |
| `medalName/medalLevel` | `medal_info` 数组或对象；匹配当前主播时同时形成 `targetUid` hint                                                              |
| `messageTimestamp`     | `data.start_time \|\| startTime \|\| ts \|\| time \|\| timestamp`,兜底 `Date.now()`                                           |

`isPinned = price >= SUPER_CHAT_PIN_THRESHOLD`(`= 2` RMB,[superchat-service.js:14](../../../../src/bilibili/superchat-service.js#L14)),由分发层计算([message-handlers.js:173](../../../../src/bilibili/danmaku/message-handlers.js#L173))。SC 命令文本会二次触发 `onMessage(source:'superchat')`([message-handlers.js:151-175](../../../../src/bilibili/danmaku/message-handlers.js#L151-L175));入库门槛与状态机见 [gift.md](gift.md) §7。

### 6.3 礼物类命令路由

`USER_TOAST_MSG_V2` 的重复提示判定先读 `option.source`，仅缺失/null 时回退顶层 `data.source`；显式 0 保留，数值或字符串 2 均识别为附带提示。该判定用于身份解析，不构成礼物结算或去重账本变更。

[gift-command-utils.js](../../../../src/bilibili/parsers/gift-command-utils.js) 识别 SEND_GIFT、BLIND_GIFT、COMBO_SEND、GUARD_BUY、USER_TOAST_MSG 和开放平台 SEND_GIFT/GUARD 前缀。`isBilibiliGiftLikeCommand` 也识别含 GIFT/COMBO/GUARD 的命令，排除 COMBO_END、GIFT_STAR_PROCESS、WIDGET_GIFT_STAR_PROCESS。它只用于路由身份提示及显式诊断抓包，不生成礼物记录；已删除动态检测前缀注册。

### 6.4 独立发送者身份读取

`MessageHandlers.handleIdentityMessage` 调用 [extractBilibiliGiftIdentity](../../../../src/bilibili/users/gift-identity-hints.js)，把 `{uid, name, avatarUrl, roomIdentity?}` 交给用户信息服务。JSON 身份读取支持 sender_uinfo/user_info 的 base 与消息根字段；SEND_GIFT_V2 只读取 §5.3 的发送者字段。

仅 USER_TOAST_MSG 的等级或舰队名称可形成已验证的本房间大航海提示。GUARD_BUY 和 USER_TOAST_MSG_V2 的 source=2 附带消息会被忽略；普通送礼包不能据其中的 guard_level 提升房间身份。后续身份合并、头像校验和连接代次隔离仍由用户信息服务负责。

该路径没有礼物数量/金额计算、付费判定、平台 ID 生成、盲盒匹配、礼物日志或 onGift 记账回调。服务器结果经独立投影器导入，见 [gift.md](gift.md) §2/§6.1。

## 7. 关键常数速查

| 参数                  | 值      | 出处                                                                                         |
| --------------------- | ------- | -------------------------------------------------------------------------------------------- |
| WBI 密钥缓存          | 10 min  | [wbi-signer.js:76](../../../../src/bilibili/wbi-signer.js#L76)                               |
| WS 心跳间隔           | 30 s    | [websocket-connection.js:5](../../../../src/bilibili/danmaku/websocket-connection.js#L5)     |
| WS 打开等待超时       | 8 s     | [websocket-connection.js:144](../../../../src/bilibili/danmaku/websocket-connection.js#L144) |
| Protobuf 递归深度上限 | 5       | [protobuf-decoder.js:73](../../../../src/bilibili/protocols/protobuf-decoder.js#L73)         |
| 弹幕时间戳有效窗      | ±30 天  | [danmaku-parser.js:15](../../../../src/bilibili/parsers/danmaku-parser.js#L15)               |
| SC 置顶阈值           | ≥ 2 RMB | [superchat-service.js:14](../../../../src/bilibili/superchat-service.js#L14)                 |
| 弹幕发送字符上限      | 1000    | [api-client.js:109](../../../../src/bilibili/danmaku/api-client.js#L109)                     |
| 大航海等级白名单      | 1/2/3   | [utils.js:73-76](../../../../src/shared/utils.js#L73-L76)                                    |
