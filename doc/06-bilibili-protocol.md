# Bilibili 直播协议 — 完整逆向工程文档

> 涉及目录：[src/bilibili/](src/bilibili/) (23 个文件)
> 核心：WebSocket 弹幕长连接、Protobuf 解码、Brotli 解压、WBI 签名

---

## 架构总览

```
BilibiliDanmakuClient (顶层编排, 重连逻辑)
├─ BilibiliApiClient       HTTP API 层 (6个端点)
├─ WebSocketConnection     二进制帧封装 + 心跳 (30s)
├─ MessageHandlers         消息分发: 弹幕/SC/礼物
├─ HistoryPoller           降级轮询: gethistory, 2.5s间隔
├─ OnlineRankPoller        身份补全: 高能榜, 60s间隔, 最多3页×50
├─ LiveStatusMonitor       开播检测: room_init, 10min间隔
├─ IdentityCache           用户身份缓存: TTL 10min
└─ MessageDeduplicator     去重: uid+1s桶+文本, 容量1000
```

---

## HTTP API 端点

### 通用请求头

```http
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36
Accept: application/json, text/plain, */*
Accept-Language: zh-CN,zh;q=0.9,en;q=0.8
Origin: https://live.bilibili.com
Referer: https://live.bilibili.com/{roomId}
Cookie: {cookieHeader}   ← 可选, 有则防 -352 风控
```

### 错误码速查

| code | 含义 |
|------|------|
| 0 | 成功 |
| -352 | 风控/校验失败 (WBI 签名/Cookie/设备标识/网络IP) |
| -400 | 请求参数错误 |
| -412 | 请求被风控拦截 |
| 60004 | 直播间不存在 |

---

### 1. room_init — 解析房间信息

```
GET https://api.live.bilibili.com/room/v1/Room/room_init?id={encodeURIComponent(roomId)}

输入: 任意房间号 (短号/长号/URL)
响应:
  data.room_id     → 标准长房间号 (必需)
  data.short_id    → 短号
  data.uid         → 主播 UID
  data.live_status → 直播状态 (1=开播, 0/2=未开播)
```

### 2. master_info — 主播名称

```
GET https://api.live.bilibili.com/live_user/v1/Master/info?uid={uid}

响应:
  data.info.uname → 主播名称
```

### 3. getDanmuInfo — 弹幕服务器 (WBI 签名)

```
GET https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?{WBI签名参数}

输入 (签名前):
  { id: roomId, type: 0 }

WBI 签名后附加:
  wts={Unix秒时间戳}&w_rid={MD5}

响应:
  data.host_list[0].host     → WebSocket 服务器 IP
  data.host_list[0].wss_port → WebSocket 端口 (默认 443)
  data.token                 → 连接认证 token
```

### 4. gethistory — 历史弹幕 (降级)

```
GET https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid={roomId}

响应:
  data.admin[] → 管理员消息
  data.room[]  → 普通消息

每条消息:
  uid, nickname (或 uname), text, timeline (时间戳字符串)
  medal / fans_medal / medal_info → 粉丝牌
  guard_level / guard_level_v2    → 大航海等级
```

### 5. online_gold_rank — 高能榜

```
GET https://api.live.bilibili.com/xlive/general-interface/v1/rank/getOnlineGoldRank
  ?roomId={roomId}&ruid={ownerUid}&page={1-3}&pageSize={50}

间隔: 60s, pageSize 固定 50, 最多 3 页

停止条件:
  - items 数组为空
  - items.length < pageSize
  - page * pageSize >= onlineNum

响应 item 字段:
  uid/mid, name/uname/nickname
  medalInfo/medal_info/medal/fans_medal/uinfo_medal
  guard_level/guardLevel
```

---

## WBI 签名算法

### Mixin Key 推导

```
1. GET https://api.bilibili.com/x/web-interface/nav (同浏览器请求头)

2. extractBilibiliWbiKey(img_url) → 取 URL 路径最后一段, 按 '.' 分割取第一部分
   extractBilibiliWbiKey(sub_url) → 同上
   // img_url 例: https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png
   // 提取: '7cd084941338484aae1ad9425b84077c'

3. rawKey = imgKey + subKey  (拼接两个32字符的hex字符串)

4. mixinKey = WBI_MIXIN_KEY_ENC_TAB
     .map(i => rawKey[i])   // 64字符置换表
     .join('')
     .slice(0, 32)          // 截取前32字符

5. 缓存 10 分钟
```

### 置换表 (64 个下标)

```
[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,
 27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
 37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,
 22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
```

### 请求签名

```
signBilibiliWbiParams(params, headers):
  1. params.wts = Math.floor(Date.now()/1000)
  2. params 的 key 按字母排序
  3. 每个 key: value 先去掉 [!''()*], 再 encodeURIComponent
  4. query = "key1=val1&key2=val2&..."
  5. w_rid = md5(query + mixinKey) (32位小写hex)
  6. 返回: query + "&w_rid=" + w_rid
```

---

## WebSocket 协议

### 连接

```
URL: wss://{host}:{wss_port || 443}/sub
binaryType: 'arraybuffer'
```

### 认证包 (op 7, 连接后立即发送)

```json
{
  "uid": {uid || 0},
  "roomid": {canonicalRoomId},
  "protover": 3,       // 请求 Brotli 压缩
  "platform": "web",
  "type": 2,
  "key": "{token}"     // 仅 token 非空时
}
```

### 心跳 (op 2)

```
间隔: 30000ms
内容: {}
```

### 二进制帧格式 (大端)

```
[packetLength] [headerLength] [protoVer] [operation] [sequence]
    u32 BE         u16 BE       u16 BE     u32 BE      u32 BE
    4 bytes        2 bytes      2 bytes    4 bytes     4 bytes

packetLength: 16 + body.length
headerLength: 固定 16
```

### Operation 码

| Op | 方向 | 含义 |
|----|------|------|
| 2 | C→S | 心跳 |
| 3 | S→C | 心跳回包 (忽略) |
| 5 | S→C | 推送消息 (唯一处理) |
| 7 | C→S | 认证 |
| 8 | S→C | 认证回包 (忽略) |

---

## 数据包解码

### 帧解析 (parseBilibiliPackets)

```
while (offset + 16 <= buffer.length):
  读取 header → packetLength, headerLength, protoVer, operation, seq
  跳过 operation ≠ 5 的包

  按 protoVer 解码 body:
    protoVer 3 → zlib.brotliDecompressSync(body)
                → 递归 parseBilibiliPackets (解压后是嵌套帧)
    protoVer 2 → zlib.inflateSync(body) (raw deflate)
                → 递归 parseBilibiliPackets
    protoVer 0/1 → body.toString('utf8').trim()
                  → splitJsonObjects 分割多个 JSON 对象
                  → JSON.parse 每个对象

  offset += packetLength > 0 ? packetLength : buffer.length
```

### JSON 对象分割 (splitJsonObjects)

```
逐字符扫描, 跟踪 '{}' 嵌套深度 + 字符串/转义状态
深度回到 0 时切分一个 JSON 块
解析失败 → 跳过
```

---

## 消息分发

```
每个解析后的 JSON 对象 → 按 cmd 字段分发:

  cmd.startsWith('DANMU_MSG')            → 弹幕 → onMessage
  cmd.startsWith('SUPER_CHAT_MESSAGE')   → SC   → onSuperChat + onMessage
  cmd startsWith 或包含 GIFT/COMBO/GUARD → 礼物 → onGift
  其他                                   → 记录诊断, 跳过
```

---

## 弹幕解析 (DANMU_MSG)

### JSON 结构

```javascript
{
  cmd: "DANMU_MSG",
  info: [
    [],              // [0]: 元数据 [4]=timeline, [5]=timeline, [6]=timeline
    "弹幕文本",       // [1]: message
    [uid, userName], // [2]: 用户 [0]=uid, [1]=userName
    [medalLevel, medalName, ...], // [3]: 粉丝牌
    ...,             // [4-6]: 其他
    guardLevel,      // [7]: 大航海等级 (备用)
    ...,             // [8]
    { guard_level }  // [9]: 大航海等级 (优先)
  ]
}
```

### 提取逻辑

```javascript
timestamp = info[0][4] || info[0][5] || info[0][6]
  验证: Math.abs(ts - Date.now()) < 30天 → 有效, 否则 Date.now()

message = info[1]
uid = info[2][0]
userName = info[2][1]
medalLevel = info[3][0]
medalName = info[3][1]
guardLevel = info[9].guard_level || info[7] || 0
  → normalizeGuardLevel: 只接受 1/2/3
```

### 命令文本过滤

```
只有以 "点歌" 或 "随机" 开头的文本才是可捕获的点歌指令
非命令弹幕不进入去重/冷却/队列流程
```

---

## SC 解析 (SUPER_CHAT_MESSAGE)

### JSON 结构

```javascript
{
  cmd: "SUPER_CHAT_MESSAGE",
  data: {
    id,              // platform ID
    message,         // SC 文本
    price,           // 金额 (RMB)
    uid / mid,       // 用户 ID
    user_info: { uid, uname, guard_level, medal_info },
    start_time       // 时间戳
  }
}
```

### 提取逻辑 (多字段回退)

```javascript
id        = data.id || data.message_id || data.token
price     = Number(data.price) || parseFloat(data.price_text) || parseFirstNumber(data.rmb)
uid       = data.uid || data.mid || data.user_info.uid
userName  = data.user_info.uname || data.uname || '观众'
guardLevel = data.medal_info.guard_level || data.user_info.guard_level || data.guard_level
medalInfo = data.medal_info || data.user_info.medal_info
  → readMedalName: 数组[1] 或对象.medal_name
  → readMedalLevel: 数组[0] 或对象.medal_level
timestamp = data.start_time || data.ts || Date.now()

isPinned = price >= 2  ← SC_PIN_THRESHOLD
```

### SC 二次分发

```
SC 文本如果是命令 → 同时触发 onMessage (source: 'superchat')
去重 key: uid || id
```

---

## 礼物解析 — 5 条路径

### 分发逻辑

```
extractBilibiliGiftMessage(packet):
  cmd.startsWith('LIVE_OPEN_PLATFORM_SEND_GIFT') → 开放平台礼物
  cmd.startsWith('LIVE_OPEN_PLATFORM_GUARD')     → 开放平台大航海
  cmd.startsWith('GUARD_BUY') || 'USER_TOAST_MSG'→ Web 大航海
  cmd.startsWith('SEND_GIFT_V2') && data.pb      → Protobuf 路径
  其他                                          → Web 通用路径
```

### 统一输出格式

```javascript
{
  platformId       // 去重 ID
  cmd              // 原始命令
  giftId, giftName // 礼物标识
  uid, userName    // 送礼者
  num              // 数量 (默认 1)
  unitPrice        // 单价 (RMB, paid 时计算)
  totalPrice       // 总价 (RMB, paid 时计算)
  coinType         // 'gold' | 'silver' | 'free' | 'guard'
  isBlindBox       // 是否盲盒
  blindBoxName     // 盲盒名称
  blindBoxPrice    // 盲盒原价 (RMB)
  rawJson          // 原始 JSON (调试)
  messageTimestamp // 毫秒时间戳
}
```

金瓜子换算: `RMB = 金瓜子数 / 1000`

### Platform ID 回退

```
优先:
  data.msg_id || msgId || tid || gift_tid || rnd || batch_combo_id || combo_id

都为空时:
  SHA1("{cmd}|{uid}|{giftName}|{price}|{timestamp}") → hex

作用: 数据库去重 (platform_id 唯一)
```

### SEND_GIFT_V2 Protobuf 路径

```
data.pb → Base64 解码 → decodeBilibiliProtoFields

Root 消息字段:
  field 1  → uid
  field 2  → userName
  field 10 → giftInfo (嵌套消息)

giftInfo 嵌套字段:
  field 1  → giftId
  field 2  → giftName
  field 3  → num (取 field 3/4 的最大值)
  field 4  → num
  field 5  → unitCoin
  field 6  → unitCoin
  field 7  → totalCoin (优先于 field 14)
  field 8  → coinType
  field 9  → tid (去重用)
  field 10 → timestamp
  field 12 → comboId (去重备用)
  field 14 → totalCoin
```

### 盲盒检测

```javascript
isBlindBox = cmd.startsWith('BLIND_GIFT')
  || blindInfo 对象非空
  || data.blind_gift_id || blindGiftId || blind_box_id || blindBoxId

blindInfo = data.blind_gift || blindGift || blind_box || blindBox
           || data.origin_info || originInfo

blindBoxCoin = blindInfo.original_gift_price || blindInfo.price
              || data.blind_original_gift_price || data.blind_price
              || data.original_gift_price || data.original_price

blindBoxPrice = blindBoxCoin * num / 1000  (RMB, null if 0)
```

### 大航海价格硬编码

```
总督 (level 1): 19998 RMB
提督 (level 2):  1998 RMB
舰长 (level 3):   198 RMB

detectGuardLevelFromName:
  总督/viceroy     → 1
  提督/admiral     → 2
  舰长/captain     → 3
  "1"/"2"/"3"      → 对应数字
```

---

## Gift 识别命令

```javascript
isBilibiliGiftCommand(cmd, runtimePrefixes):
  精确匹配 runtimePrefixes 中的某个前缀
  || cmd.startsWith(prefix + '_')
  || cmd.startsWith('SEND_GIFT')
  || cmd.startsWith('BLIND_GIFT')
  || cmd.startsWith('COMBO_SEND')
  || cmd.startsWith('GUARD_BUY')
  || cmd.startsWith('USER_TOAST_MSG')
  || cmd.startsWith('LIVE_OPEN_PLATFORM_SEND_GIFT')
  || cmd.startsWith('LIVE_OPEN_PLATFORM_GUARD')

isBilibiliGiftLikeCommand: 以上 || cmd 含 'GIFT'/'COMBO'/'GUARD' 子串
```

---

## Protobuf 解码器 (自实现)

### Varint 解码

```javascript
readBilibiliProtoVarint(buffer, offset) → { value: BigInt, offset }
  LEB128 unsigned, BigInt, 64-bit 上限
  byte & 0x7F → 7 bits of value
  byte & 0x80 → continue flag
  shift 每轮 +7
  overflow/null → return null
```

### 字段解码

```javascript
decodeBilibiliProtoFields(buffer, depth=0) → { [field]: [...] }
  key = varint → field = floor(key/8), wireType = key%8
  禁止 field 0, 只接受 wireType 0/1/2/5

  wireType 0 (varint):
    超过 Number.MAX_SAFE_INTEGER → 十进制字符串
  wireType 1 (64-bit):
    保留 8 字节 Buffer
  wireType 5 (32-bit):
    保留 4 字节 Buffer
  wireType 2 (length-delimited):
    读取长度 → 截取 chunk
    depth < 5 → 递归解码
    递归后无字段 或 depth >= 5 → chunk.toString('utf8')

  值追加到 fields[field] 数组 (支持 repeated)
```

---

## 历史弹幕轮询 (降级方案)

```
当 WebSocket 断连或房间未开播时启用

端点: gethistory (见上)
间隔: 2500ms (第一次立即执行)
过滤:
  text 非空 && 以 "点歌"/"随机" 开头
  timestamp 通过 isCapturable 验证

isCapturable 条件:
  ts >= max(startedAtMs - 5000, now - 1800000)  // 不早于启动前5s, 不早于30分钟前
  ts <= now + 300000                              // 不超过未来5分钟 (时钟偏差)

WS open 且直播中 → 停止轮询
WS close → 重启轮询
```

---

## 消息去重

```
buildBilibiliCommandKey(uid, message, timestampMs):
  cleanText(uid) + '|' + floor(tsMs/1000) + '|' + cleanText(message)
  → uid + 1秒时间桶 + 精确文本

remember(key) → false (重复) / true (新消息)
  存储 seenAt = Date.now()
  容量 > 1000 → 清理 30分钟前的条目, 直到 size ≤ 500
```

---

## 身份缓存

```
identityByUid → Map<uid, identity>
identityByName → Map<lowercaseName, identity>
TTL: 10 分钟

resolve({ uid, userName, guardLevel, medalName, medalLevel }):
  1. 先按 uid 查, 再按 name 查
  2. 合并缓存身份 (first non-empty wins)
  3. 名字是掩码名 (含 **) → 优先用缓存的完整名字
  4. remember 合并结果
  5. cleanup: 每 5 分钟清理过期条目

数据源:
  - 在线高能榜 (60s 轮询, 批量写入)
  - 弹幕/SC 中的身份信息 (实时)
```

---

## 开播检测

```
仅当房间未开播时启用
间隔: 10 分钟 (timer.unref())

检测到 liveStatus 从 0 → 1:
  1. 设置 reconnectInFlight 标志
  2. 停止轮询器
  3. 广播状态: "已开播，正在重连礼物监听"
  4. 调用 danmaku-client.reconnectAfterLiveStarted()
     → 取消重连定时器
     → 停止 history poller
     → 重置 startedAtMs
     → 重新执行完整 connect() 流程
```

---

## 重连机制

```
scheduleReconnect():
  固定 5000ms 延迟
  → connect()
  → 失败 → 报告状态 + 再次 scheduleReconnect()
  → 无限循环直到 stop()

stop():
  清除 reconnect timer
  关闭 WebSocket
  停止所有 3 个轮询器
  销毁 MessageHandlers
```

---

## 礼物服务 (gift-service.js)

### 连击缓冲

```
extractComboRootKey(platformId):
  platformId 含 'combo'/'batch'
  且最后一段是 \d{10,} 格式的时间戳
  → 去掉时间戳的根 key

SEND_GIFT 事件 → 缓冲到 giftComboPending Map (TTL 10秒)
COMBO_SEND 事件 → 合并缓冲数据 (Math.max, 不累加)
过期缓冲 → 直接写入 DB (skipComboBuffer=true)
```

### 盲盒配置

```json
{
  "name": "星际宝盒",
  "price": 100,
  "outputs": [
    { "name": "小心心", "price": 1 },
    { "name": "大炮", "price": 1000 }
  ]
}
→ 协议中的盲盒礼物被重命名为配置名称
→ price 覆盖为配置的真实价值
→ blindProfit = totalPrice - blindBoxPrice
```

### 数据库

```
gift_events 表:
  platform_id (去重), cmd, gift_id, gift_name,
  uid, user_name, num, unit_price, total_price, coin_type,
  is_blind_box, blind_box_name, blind_box_price, blind_profit,
  counted_in_sprint, status, raw_json, created_at, updated_at

免费礼物 (totalPrice <= 0): 不存储
付费礼物: counted_in_sprint = 1

启动修复: repairGiftV2Events
  → 重解析 SEND_GIFT_V2% 且 total_price <= 0 的行
  → 从 raw_json 重新提取 totalPrice
```

### 礼物冲刺

```
giftSprintTargetRmb: 目标金额
receivedRmb = SUM(counted_in_sprint=1 的 total_price)
crystalBallValueRmb = 100 (每个水晶球价值)
remainingCrystalBalls = floor(remainingRmb / 100)
```

---

## SC 服务 (superchat-service.js)

```
SUPER_CHAT_PIN_THRESHOLD = 2 (RMB)
SUPER_CHAT_DISPLAY_THRESHOLD = 2 (RMB)

addSuperChatItem:
  价格 < 2 RMB → 拒绝
  platform_id 去重
  插入 super_chats 表

handleSuperChatAction:
  delete → status = 'deleted'
  assist → status = 'assisted'
  unassist → status = 'active'

getSuperChatSnapshot:
  status IN ('active','assisted')
  ORDER BY price DESC, created_at ASC, id ASC
```

---

## 点歌命令解析 (bilibili-message-handler.js)

```
parseDanmakuCommand(text, settings):

  "随机点歌{scope}"  → { type: 'random', scopeText }
  "随机 {scope}"     → { type: 'random', scopeText }
  "随机{scope}"      → { type: 'random', scopeText } (scope ≠ '点歌' && ≠ 空)
  "点歌{songName}"   → { type: 'request', songName }
  其他               → null (不是命令)

normalizeRandomScopeText:
  去掉前导字符: + ＋ : ： - — (循环直到干净)

处理流程:
  1. 解析命令 → 非命令 reject
  2. settings.paused → reject
  3. 用户冷却 (uid → cooldownSeconds) → reject
  4. random: pickRandomSong(scope) → find + addQueueItem
  5. request: addQueueItem({ songName, requesterName, uid, ... })
  6. 更新冷却 (内存 + DB)
```

---

## 关键常数速查

| 参数 | 值 | 说明 |
|------|-----|------|
| WS 心跳间隔 | 30s | |
| 历史轮询间隔 | 2.5s | |
| 高能榜轮询间隔 | 60s | |
| 开播检测间隔 | 10min | |
| 身份缓存 TTL | 10min | |
| 去重桶大小 | 1s bucket | |
| 去重容量 | 1000 → 修剪至 500 | |
| 去重保留时间 | 30min | |
| 重连延迟 | 5s 固定 | |
| WBI 缓存 | 10min | |
| 消息可捕获窗口 | 启动前5s ~ 30min前 ~ 未来5min | |
| SC 置顶阈值 | ≥ 2 RMB | |
| 大航海价格 | 198 / 1998 / 19998 RMB | |
| 礼物连击缓冲 TTL | 10s | |
| 礼物机器人缓冲 TTL | 15s | |
