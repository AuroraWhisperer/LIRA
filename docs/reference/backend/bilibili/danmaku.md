# 弹幕监听管线:BilibiliDanmakuClient 与弹幕机器人

> 涉及文件:[danmaku-client.js](../../../../src/bilibili/danmaku-client.js)、[danmaku/message-handlers.js](../../../../src/bilibili/danmaku/message-handlers.js)、[danmaku/feed-buffer.js](../../../../src/bilibili/danmaku/feed-buffer.js)、[danmaku/history-poller.js](../../../../src/bilibili/danmaku/history-poller.js)、[danmaku/online-rank-poller.js](../../../../src/bilibili/danmaku/online-rank-poller.js)、[danmaku/fans-medal-poller.js](../../../../src/bilibili/danmaku/fans-medal-poller.js)、[danmaku/live-status-monitor.js](../../../../src/bilibili/danmaku/live-status-monitor.js)、[danmaku/identity-cache.js](../../../../src/bilibili/danmaku/identity-cache.js)、[users/user-info-service.js](../../../../src/bilibili/users/user-info-service.js)、[users/profile-provider.js](../../../../src/bilibili/users/profile-provider.js)、[danmaku/message-deduplicator.js](../../../../src/bilibili/danmaku/message-deduplicator.js)、[danmaku/sender-service.js](../../../../src/bilibili/danmaku/sender-service.js)、[danmaku/mention-policy.js](../../../../src/bilibili/danmaku/mention-policy.js)、[danmaku/command-text.js](../../../../src/bilibili/danmaku/command-text.js)、[bilibili-message-handler.js](../../../../src/bilibili/bilibili-message-handler.js)、[custom-reply-service.js](../../../../src/bilibili/custom-reply-service.js)、[server.js](../../../../src/server.js) 的装配段、[domain-services.js](../../../../src/server/domain-services.js) 的 messages 段

本文档是 **Bilibili 弹幕监听管线与机器人行为**的单一事实来源，说明客户端回调契约、轮询与缓存策略、命令解析、云端签到/抽签边界、自定义回复、弹幕发送及诊断快照；云端业务规则见 [云端签到与抽签规格](../../../../specs/cloud-daily-bots.md)。服务端侧的客户端生命周期编排（`configure` / `reconnect` / `_replaceClientChain`）见 [server-core.md](../server-core.md) §6，本文只描述客户端内部行为。底层传输与解析协议（HTTP/WBI/WS）见 [protocol.md](protocol.md)，礼物入库见 [gift.md](gift.md)。

## 1. 客户端回调契约

`BilibiliDanmakuClient` 通过 handlers 与外部通信，回调由 [bilibili-client.js](../../../../src/server/bilibili-client.js) 的 `createBilibiliClient` 装配：

| 回调 | 触发 | 运行时处理 |
| --- | --- | --- |
| `onMessage(danmaku)` | 每条实时弹幕、SC 命令文本、历史轮询命令 | `source:'danmaku'` 的实时消息先发布到有界弹幕流；随后交给 `games.handleDanmaku` 处理活动小游戏（你画我猜在作画阶段按完整答案计分），再进入 `messages.handleDanmaku` 点歌桥接 + 机器人链；点歌链 `accepted` 时 `broadcastSnapshot('bilibili:danmaku'/'bilibili:superchat')`（[bilibili-client.js](../../../../src/server/bilibili-client.js)） |
| `UserInfoService` 更新 | 业务缺资料时显式调用 `ensure(uid, { fields })` | 你画我猜等业务缺头像时显式调用专用头像解析入口，再通过 `games.updateDanmakuAvatar` 回填；头像补全不由 `onMessage` 返回值触发（合并与缓存策略见 §10） |
| `onSuperChat(superChat)` | 新增 SC 到达 | 先 `publishDanmaku` 发布到公开弹幕流，再经 `superChats.add` 入库，成功则广播 `bilibili:superchat`（完整流转见 §4.1 与 [gift.md §7](gift.md#7-醒目留言服务superchat-service)） |
| `onSuperChatDelete(platformIds)` | SC 平台下线 | 先从公开弹幕流撤回，再经 `superChats.retract` 删除正文并保留最小防重 ID，不触发新增或点歌命令（详见 §4.1 与 [gift.md §7](gift.md#7-醒目留言服务superchat-service)） |
| `onLiveLottery(event)` | 已鉴权长连接收到红包 / 天选消息 | 独立交给运行时活动订阅者；字段见 [protocol.md §6.6](protocol.md#66-直播红包与天选事件)，订阅语义见 §4.3 |
| `onStatus(liveStatus)` | 连接状态变化 | `updateLiveStatus` 写入快照 `liveStatus` 字段（[bilibili-client.js](../../../../src/server/bilibili-client.js) 接收回调，[bilibili-runtime.js](../../../../src/server/bilibili-runtime.js) 更新状态） |

客户端构造时还注入 `diagnostics`（§8）与 `isCommandText`；礼物检测回调、动态命令前缀和原始礼物调试缓冲已删除。

命令结果不是 `cloud-owned` 时，`onMessage` 会把消息继续交给 AI 服务，并透传房间、正文、发送者以及 `source` / `messageTimestamp` / `sessionKey` / `isSessionCurrent` / `autoReplyExcluded` / `captureReplySession`。其中 `autoReplyExcluded` 用于标记已被命令、小游戏或其他回复处理的消息，避免再次成为自动闲聊候选；定向关键词问答仍按自身规则准入。`getReplySessionKey` 只读取监听、房间和账号修订号等轻量状态，不在每条消息上读取凭据，待确定候选后再捕获完整发送会话。普通弹幕仍可能重复到达，由 AI 服务自行做有界去重，不额外建立弹幕订阅。自动接话的筛选、时效、模型与发送策略见 [AI 领域](../ai.md#34-自动接话)；该入口不扩展平台 `@` 目标 UID 或普通弹幕撤回逻辑。

点歌回复与关键词回复统一经 [live-reply-sender.js](../../../../src/bilibili/danmaku/live-reply-sender.js) 发送，仅在确认处于直播状态时受理。每次分段发送除核对账号与房间会话外，还会校验当前场次令牌；下播、连接重建、停止监听或状态未知都会令旧场次令牌失效，避免旧回复在下一场继续发出。开播状态通过内部回调 `onLiveStatus(boolean)` 同步，仅以房间 REST 初始化/轮询结果以及已鉴权连接收到的 `LIVE` / `PREPARING` 事件为准，不根据连接状态文案推测，也不新增公开快照字段。手动发弹幕、AI 回复与点歌入队仍按各自原有链路处理。

## 2. 客户端内部生命周期

> 服务端何时调用 `start` / `restart` / `stop` 及 `_replaceClientChain` 串行化见 [server-core.md](../server-core.md) §6。此处只描述客户端内部行为。

### 2.1 start / restart / stop

| 方法 | 语义 | 出处 |
| --- | --- | --- |
| `start()` | `stopped=false`、递增 `connectionGeneration`、重置 `startedAtMs`；**不等待握手**即返回；首连失败 → 启动历史轮询 + `scheduleReconnect` | [danmaku-client.js:69-92](../../../../src/bilibili/danmaku-client.js#L69-L92) |
| `restart()` | 重建连接并等待 B 站鉴权通过。失败时安排重连，再向调用方返回错误 | [danmaku-client.js](../../../../src/bilibili/danmaku-client.js) |
| `stop()` | `stopped=true`、递增 `connectionGeneration`（使在途异步失效）、清重连定时器、关 WS、停全部轮询器、销毁 `MessageHandlers` | [danmaku-client.js:122-134](../../../../src/bilibili/danmaku-client.js#L122-L134) |

`connectionGeneration` 是 `start` / `restart` / `stop` 周期的**代次防护校验**，同一代次内再用 `connectionAttempt` 区分各次连接尝试。所有 HTTP 返回、socket 状态与消息事件以及失败回调都会同时核对 `generation` 和 `attempt`，被后续尝试取代的回调不得覆盖当前状态、替换新连接或安排重连（[danmaku-client.js](../../../../src/bilibili/danmaku-client.js)）。

### 2.2 connect 流程

`connect(options, generation)`([danmaku-client.js:150-285](../../../../src/bilibili/danmaku-client.js#L150-L285)):

1. `resolveRoomInfo()`(room_init + master_info,见 [protocol.md](protocol.md) §2) → 记录 `ownerName`,通知 MessageHandlers 主播 uid([danmaku-client.js:162-166](../../../../src/bilibili/danmaku-client.js#L162-L166))。
2. 未开播或启用 `alwaysHistory` 时启动 HistoryPoller。启动 OnlineRankPoller、FansMedalPoller 和 LiveStatusMonitor。
3. `resolveDanmuInfo()` 经 WBI 签名读取候选 `host_list` 和 token，按连接尝试序号轮换有效候选，使用该地址的 `wss_port`（缺省为 443）。轮换独立于退避计数，退避封顶后仍会切换地址。认证包见 [协议 §4.1](protocol.md#41-连接与认证包op-7)。
4. `clearHandlers()` 后注册 open、authenticated、message、close 和 error 处理器。直播中按需保留已有的历史轮询，直到 B 站鉴权通过。断开时启动历史轮询并安排重连。
5. `wsConnection.connect(wsUrl, authPayload, { waitForAuthentication: true })` 在 8 秒内等待 WebSocket 打开，再等最多 10 秒接收 B 站认证回包。超时、拒绝或无效回包会关闭当前连接并进入退避。`start()` 立即返回。实现见 [WebSocket 连接模块](../../../../src/bilibili/danmaku/websocket-connection.js)。

### 2.3 断线重连与退避

| 场景                                            | 延迟                                                                        | 出处                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| WS close 或连接失败后自动恢复                 | **1/2/4/8/16/30 秒**指数退避，达到 30 秒后封顶；同一次失败只保留首个重连 timer | [danmaku-client.js](../../../../src/bilibili/danmaku-client.js) |
| 退避清零                                     | 显式调用 `start` / `restart`；或断线前已持续连接至少 60 秒，且完成过认证并收到过心跳回包（仅建立 `open` 不清零） | [danmaku-client.js](../../../../src/bilibili/danmaku-client.js) |
| 开播检测触发的重连（`reconnectAfterLiveStarted`） | 取消既有重连定时器，重置 `startedAtMs` 并立即走完整连接流程。保留历史轮询直至通过鉴权 | [danmaku-client.js](../../../../src/bilibili/danmaku-client.js) |

定时重连失败时，当前连接尝试若已取得房间上下文，就启动或沿用该房间的历史轮询，再按轮询状态报告 `connected` 并安排下次重连。首次查房失败后，后续尝试也可以补上兜底。见[弹幕连接控制器](../../../../src/bilibili/danmaku-client.js)。

自动尝试次数不设总上限，但请求频率受上述退避上限约束；历史消息回退在等待期间继续工作。`start` / `restart` 取消旧恢复定时器；`stop` 取消定时器并递增 `connectionGeneration`，旧回调不得重新安排任务。连接尝试序号同时用于诊断和同代次尝试归属校验，与退避失败计数分开。

## 3. 轮询器与缓存(全部间隔速查)

| 组件                                    | 间隔/容量                                                                                     | 行为                                                                                                                                                | 出处                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HistoryPoller | 首轮立即，成功后 **2.5 秒**，连续失败按 **5/10/20/40/60 秒**退避 | 离线或断线时拉 `gethistory`，按时间合并 `data.admin` 和 `data.room`，仅发布可捕获窗口内的命令。已认证连接收到 `LIVE` 后停止历史请求，`PREPARING` 恢复请求。`alwaysHistory` 使直播期间也保留补偿。 | [history-poller.js](../../../../src/bilibili/danmaku/history-poller.js)、[danmaku-client.js](../../../../src/bilibili/danmaku-client.js) |
| OnlineRankPoller | **60s**，两种在线榜排序各 **100 人** | `queryContributionRank` 的 `type=online_rank`，并行读取 `switch=contribution_rank` / `entry_time_rank`，均使用 `page=1&page_size=100&platform=web&web_location=444.8`。按 `data.item[].uid` 合并去重，最多 200 人，同 UID 优先贡献值排序的身份线索。后续页重复名单，不按总人数翻页，进房时间排序实测 `data.count=0` 仍有名单。通过 `UserInfoService.ingestHint` 提交线索，再 `replaceOnlineSnapshot` 替换 UID 集合。手动刷新共享在途任务，每轮最多两次上游请求。一路失败采用成功名单，两路均失败保留旧快照，成功空名单清空。API 成功且 `count=0,item=null` 时按空列表处理，非零业务码或缺失/矛盾结构仍报错。同一房间运行上下文内自动重连沿用在途任务及原轮询时刻，停止或换到新的运行上下文会丢弃迟到结果。 | [online-rank-poller.js](../../../../src/bilibili/danmaku/online-rank-poller.js) |
| FansMedalPoller | 完整刷新目标 **5 分钟**，每页 **30 条** | 同一房间 / `generation` / `runToken` 下重复 `start` 幂等；每批最多拉 30 页或连续运行 10 秒后暂停 1 秒再继续。失败按 5/10/20/30 分钟退避（附带最多 10% 随机抖动，总等待上限仍为 30 分钟），跑完一轮全量后恢复 5 分钟周期；单轮超过 10000 页视为异常并报错。拉取结果写入 `UserInfoService`，但不续期已过期资料的有效期；切房或停止时丢弃在途结果。每轮完成后记录页数、条数和耗时。 | [fans-medal-poller.js](../../../../src/bilibili/danmaku/fans-medal-poller.js) |
| LiveStatusMonitor | **10 分钟**，`timer.unref()` | 开播和下播都查询 `room_init`，缺主播名时补查 `master_info`。REST 检出开播触发 `reconnectAfterLiveStarted`，实时 `LIVE/PREPARING` 使迟到的 REST 结果失效。在途检查和重连互斥。 | [live-status-monitor.js](../../../../src/bilibili/danmaku/live-status-monitor.js) |
| UserInfoService | 内存 TTL **10 分钟** | 单 UID 读取与线索合并按需清理，整批扫描间隔至少 30 秒。最近和在线名单在读取时清理。身份归属与头像补全见 §10。 | [user-info-service.js](../../../../src/bilibili/users/user-info-service.js) |
| MessageDeduplicator                     | 精确键含发送者线索、秒桶与清洗文本；跨源匹配窗 **1.5s**，候选保留 **30 分钟**，最多 **500** 条；精确键超 **1000** 时修剪至最多 **500** | 同源重放只记录一次拒绝日志。跨源只查同文本候选，每条消息与每个来源最多配对一次，精确命中也占用这次配对。年龄清理根据已知最早接收时间跳过尚不可能过期的扫描，超容量按插入顺序淘汰并同步文本索引。 | [message-deduplicator.js](../../../../src/bilibili/danmaku/message-deduplicator.js) |

**精确键。** 有可靠 UID 时按 UID 去重，改昵称仍使用同一键。UID 缺失、为 `0` 或 `'0'` 时，使用平台传入的原样昵称，保留大小写和掩码中的每个字符。空白昵称和占位名 `观众` 都按空昵称处理。同源同秒同文的 `Alpha` 和 `alpha` 各派发一次，各自原包重放时均被过滤。`has(uid, message, timestampMs, { userName })` 与 `remember()` 使用同一精确键，缺少可靠 UID 且省略昵称时查询空昵称的记录。

**跨源匹配。** 双方都有可靠 UID 时只比较 UID。任一方缺少 UID 时，先清洗昵称并转为小写，再比较全名或掩码两端的可见字符。缺少可用昵称时沿用窗口内的一对一匿名匹配。昵称仅用于去重，点歌权限、冷却和队列归属仍按各自的身份规则判定。

**消息可捕获窗口** `isCapturableBilibiliTimestamp(ts, startedAtMs)`([helpers.js:41-50](../../../../src/bilibili/helpers.js#L41-L50)):

```
ts >= max(startedAtMs - 5000, now - 30*60*1000)   // 不早于启动前 5s, 不早于 30 分钟前
ts <= now + 5*60*1000                              // 不超过未来 5 分钟 (时钟偏差)
```

该窗口同时约束弹幕、SC 命令与历史轮询三路(见 §4)。

## 4. 消息管道(MessageHandlers)

`handlePackets(buffer)` 更新 `lastPacketAt` → 逐条 `parseBilibiliPackets` → 按命令分发弹幕、SC 新增/下线、礼物身份、点赞状态或红包/天选事件；精确命令与冒号后缀规则见 [protocol.md](protocol.md) §6。命令处理使用可捕获窗口和去重，具体路径如下：

**弹幕**（`handleDanmaku`，[message-handlers.js:75-114](../../../../src/bilibili/danmaku/message-handlers.js#L75-L114)）：仅命令文本参与窗口校验与去重；`onMessage` 载荷含 `source:'danmaku'`、归一化 cmd 和发送者 `avatarUrl`。头像优先取该条 `DANMU_MSG` 的用户扩展资料，缺失时按 uid 复用在线榜/历史身份缓存；`DANMU_MSG` 前缀统一为 `DANMU_MSG`（[message-handlers.js:242-247](../../../../src/bilibili/danmaku/message-handlers.js#L242-L247)）。实时弹幕和历史回补命令的发送者 UID 等于当前房主 UID 时，`onMessage` 均携带 `isStreamer: true`。

**SC**（`handleSuperChat`，[message-handlers.js:115-176](../../../../src/bilibili/danmaku/message-handlers.js#L115-L176)）：每条 SC 先走 `onSuperChat`（发布弹幕流并入库，见 [gift.md §7](gift.md#7-醒目留言服务superchat-service)）；若正文为命令，再过窗口与去重后二次触发 `onMessage(source:'superchat', isPinned: price>=2)`，命令拒绝仅影响 `onMessage`，不影响 SC 入账。

**SC 下线**：`SUPER_CHAT_MESSAGE_DELETE` 直接调用独立 `onSuperChatDelete`，不做新增 SC 或命令文本二次分发。重复下线和未找到平台 ID 不产生新记录；存储与防重规则见 [gift.md §7](gift.md#7-醒目留言服务superchat-service)。

**礼物类消息身份**：`handleIdentityMessage` 仅提取发送者 UID、昵称、头像及大航海提示并交给 `UserInfoService`，不生成礼物记录；解析边界见 [protocol.md](protocol.md) §6.4，服务器投影见 [gift.md](gift.md) §2。

### 4.1 实时弹幕流

`createDanmakuFeedBuffer().push()` 接收 `source:'danmaku'` 的实时消息，投影为公开字段 `{id,uid,name,message,avatarUrl,guardLevel,medalName,medalLevel,timestamp,emotes}`，并保留明确的 `isStreamer`。`source:'superchat'` 的 SC 也经 `push()` 发布，要求非空正文和正有限 `price`，额外输出 `kind:'superchat'`、实际 `price` 及可选 `messageId`（由平台 ID 映射），不重复进入点歌命令链。

旧本机 `/danmaku` 的本房身份由弹幕缓冲投影。`requesterGuardVerified === true` 时从 `requesterGuardLevel` 生成 `roomGuardLevel`，其中 `0` 表示已核验为非大航海。`requesterMedalVerified === true` 且 `requesterMedalName` 非空、`requesterMedalLevel` 为正时生成 `roomMedal: {name, level}`。在直播画面中，仅 `danmaku` scope 的消息增量和快照公开这两个可选字段。

旧版本机弹幕源在分配显示编号前，按当前房间最近 200 个非空 SC 平台 ID 去重。普通包和日文包携带同一 ID 时只发布一条。换房或清空缓冲会清除这组 ID。无 ID 的有效 SC 仍按次发布，低于入库门槛的留言也可显示。[弹幕流缓冲](../../../../src/bilibili/danmaku/feed-buffer.js)

`pushGift()` 接收已定稿（`detection_status:'final'`）的礼物记录，补充 `kind:'gift'`、`giftName`、`giftCount` 及兼容文案 `送出 礼物名 × 数量`。有效的非负 `total_price` 原样输出到 `giftTotalPrice`（单位人民币元，本身已是整组总价，不再乘数量），缺失或非法时省略。可选字段包括：`avatarUrl`（送礼人头像）、`giftGuardLevel`（本次购买的大航海等级，非当前房间身份）和 `giftImageUrl`（按礼物 ID 与 `gift_variant_id` 从礼物目录解析，仅保留合法 B 站 CDN HTTPS 地址或本地 `/overtime-gift-images/` 路径）。礼物数量须为正安全整数，头像和身份缺失时置空。

弹幕、SC、礼物三类消息共用连续递增编号与最近 50 条的容量上限，均不暴露原始载荷、单价及其他内部账本字段；切换直播间时清空缓冲，`getSnapshot()` 返回副本。

每条新消息由 `runtime-transport.js` 广播 `danmaku:message`，完整有界列表同时进入全量快照的 `danmakuFeed` 字段。礼物由既有 `final` 回调在快照发布前加入缓冲区，再向 `topic=danmaku` 发布同一消息；沿用礼物投影层的单次 `final` 交付，不依赖礼物特效框开关或金额门槛。SC 新增先经 `superChats.isDeleted` 检查删除收据，命中则不发布迟到或重放消息；未命中时仍在入库前发布，公开显示不受 SC 列表的记录价格门槛限制。`server.js` 将 `publishSuperChatDelete` 接到 B 站客户端：`removeSuperChats(messageIds)` 从实时缓冲与后续快照移除匹配 `messageId` 的 SC，仅实际删除公开项时向同一 topic 广播 `{type:'danmaku:superchat-delete',messageIds}`，随后持久化撤回仍由 SC 服务负责（仅实际删除显示项时广播 `bilibili:superchat`）。头像和表情地址均经 B 站头像/CDN 白名单校验（见 [protocol.md](protocol.md) §2.3）；头像可由浏览器直接加载，表情继续通过 `/api/bilibili/avatar` 本地图片代理加载。

### 4.2 直播间点赞状态

点赞总数快照的解析与清零时机归 `MessageHandlers`（见 [protocol.md §6.5](protocol.md#65-直播间累计点赞)）。`BilibiliDanmakuClient.getLikeState()` 返回 `{roomId,count,updatedAt,connected}`：`roomId` 优先取解析后的长房号；`connected` 仅表示当前 WebSocket 已打开且平台鉴权通过（历史弹幕轮询不算已连接）。未连接或已停止时隐藏数值和时间；连接正常但尚未收到有效推送时二者也为 `null`（未知不等于 0）。

本机 `bilibili-runtime.getLikeState()` 只读取当前配置房间的客户端；换房或无客户端时返回配置房号、两个 `null` 和 `connected:false`。该状态仅存于客户端内存，经管理接口 `GET /api/bilibili/likes/state` 透传（不发上游请求，响应见 [api.md §14](../api.md#14-bilibili-域bilibili)）。

### 4.3 直播红包与天选订阅

[bilibili-runtime.js](../../../../src/server/bilibili-runtime.js) 提供 `subscribeLiveLottery(listener)` 并返回取消订阅函数，复用当前配置房间的弹幕监听开关、登录态及已鉴权 WebSocket，不新增连接或轮询。`BilibiliDanmakuClient` 的直接调用方也可传入 `handlers.onLiveLottery`；重放或其他模块可直接调用[纯解析函数](../../../../src/bilibili/parsers/live-lottery-parser.js)，输入及字段契约见 [protocol.md §6.6](protocol.md#66-直播红包与天选事件)。

```js
const unsubscribe = bilibiliRuntime.subscribeLiveLottery((event) => {
  // 处理器由订阅方实现；跨房公告可按 event.roomId/sourceRoomId 过滤。
  if (event.kind === 'anchor-lottery') handleAnchorLottery(event);
  else handleRedPocket(event);
});

// 订阅方销毁时取消订阅。
unsubscribe();
```

运行时订阅在客户端重连期间保持有效，取消订阅后停止投递，运行时停止时清空。旧客户端、账号切换前的客户端、已关闭监听及与当前配置不符的房间不能继续发布。每个订阅方收到独立深拷贝；同步异常和异步拒绝只记录不含载荷的告警，不阻断其他订阅方或后续消息。

该订阅只推送当前连接期间收到的新事件，不提供活动状态查询、建连前补齐、断线补发或消息去重；`new`、`start`、`end` 和 `award` 作为独立事件派发，业务幂等由订阅方自行保证。事件仅在进程内分发，不接入点歌、礼物记账、SC 或公开弹幕流，也不对外暴露 HTTP/WS/IPC、持久化或自动参与功能（协议核对说明见 [protocol.md §6.6](protocol.md#66-直播红包与天选事件)）。

### 4.4 房间舰徽人数

房间大航海总人数由运行时独立管理的 `src/bilibili/room-guard-service.js` 拉取：按当前配置房间调用 `fetchRoomGuardCount`，单次完成后间隔 60 秒再拉取，同一时间最多保留一个在途请求，且不依赖本地弹幕监听开关。换房时立即发布 `{ roomId, count: null }`、中止旧请求并丢弃迟到响应；拉取失败时回退为 `null`，停止服务时同步取消请求与定时器。状态通过 `bilibili-runtime.getRoomGuardState()` 暴露，快照变更事件为 `bilibili:room-guard`，不落盘到设置或礼物账本。

## 5. 命令解析与点歌桥接

### 5.1 命令识别(入口统一)

文字判定使用 [chinese-text.js](../../../../src/shared/chinese-text.js) 的 `toSimplifiedChinese`，对输入与配置关键词做简繁字形等价比较；字表固定为 OpenCC 1.1.9 的 TSCharacters 首选映射并展平连续映射，随客户端内置，无联网转换或新增运行依赖。该工具只生成比较副本，不改写弹幕、昵称、歌库字段或身份键，也不扩展地区词汇同义词。

点歌、随机点歌、取消点歌、签到、抽签以及云端精确匹配指令均支持繁体输入（如 `點歌 後來`、`隨機點歌 國語＋懷舊`、`取消點歌`、`簽到`、`抽籤`）。实时弹幕、历史轮询与诊断共用同一套判定规则；精确匹配、菜单及礼物类指令仍在对应的 LIRA Server 服务中执行，繁体支持需配套升级服务端（云端签到/抽签边界见 §6）。

`isBilibiliCommandText`([command-text.js:9-14](../../../../src/bilibili/danmaku/command-text.js#L9-L14))是 WebSocket / 历史轮询 / SC 二次分发的统一名单:

```
text.startsWith('点歌') || text.startsWith('随机点歌') || text.startsWith('取消点歌')
|| isCheckinCommand(text)        // 签到
|| isFortuneCommand(text)        // 抽签
|| customMatcher(text)           // 自定义回复规则 (server.js 注入 domainServices.customReplies.isCommandText)
```

### 5.2 parseDanmakuCommand

`parseDanmakuCommand(text, settings)`([bilibili-message-handler.js:105-131](../../../../src/bilibili/bilibili-message-handler.js#L105-L131)):

| 输入                                 | 结果                         |
| ------------------------------------ | ---------------------------- |
| `随机点歌{scope}`                    | `{type:'random', scopeText}` |
| `点歌{songName}`                     | `{type:'request', songName}` |
| `取消点歌` / `取消点歌{songName}`      | `{type:'cancel', songName}`，不带歌名时为空串 |
| 其他                                 | `null`(非命令)               |

随机点歌必须以完整的 `随机点歌` 开头，后面的筛选条件可以直接相连或用空格分隔；`随机`、`随机xx`、`随机 xx` 均不触发点歌、无匹配回复或点歌诊断日志。

`normalizeRandomScopeText` 循环剥掉前导 `+ ＋ : ： - —` 字符；`randomSourceValue` 生成 `random:{scope}`/`random` 来源标记。两者共用 [song-field-utils.js](../../../../src/music/song-field-utils.js) 的实现，桥接层保留同名导出。

### 5.3 handleDanmakuMessage 处理链

`handleDanmakuMessage(context, danmaku)`([bilibili-message-handler.js:11-101](../../../../src/bilibili/bilibili-message-handler.js#L11-L101)):

1. `source === 'superchat'` 且 `scSongRequestEnabled === 'false'` 时在解析前返回 `{accepted:false, reason:'SC 点歌已关闭。'}`，诊断为 `sc-song-requests-disabled`；不生成点歌回复、不写入队列或冷却。SC 留言由独立的 `onSuperChat` 路径照常接收。其他情况解析命令 → 非命令 `{accepted:false, reason:'不是点歌指令。'}`。解析为 `request` 后，若 `songRequestRequireSpace === 'true'`，则归一化文本必须以「点歌 」开头；紧连格式按相同非命令结果忽略，不带 `command`，不产生点歌结果提示、入队或冷却。开关默认关闭，沿用 `cleanText` 空白归一化；随机和取消指令不受此格式限制。
2. `cancel` 先检查 `songRequestCancelEnabled`（默认开启），为 `'false'` 时返回 `{accepted:false, reason:'观众取消点歌已关闭。', command}`，诊断为 `song-request-cancel-disabled`；不删除、不广播、不生成回复、不改变冷却。开启时在暂停、黑名单、资格和冷却检查前调用队列 `cancelQueueItem`，归属、歌名与选择规则见 [services.md](../music/services.md#85-cancelqueueitemcontext-input)。成功返回 `{accepted:true, command, queueItem}` 并沿用现有点歌快照广播；无法匹配本人活跃点歌时返回 `{accepted:false, reason:'没有找到你点的待处理歌曲。', command}`，不广播、不生成自动回复、不写入或重置冷却。命令识别沿用实时/历史统一的过期检查和去重，避免一条取消弹幕被重复执行。
   历史回补保留平台 `timeline` 的精度。整秒时间覆盖该秒，毫秒时间戳和带 `.000` 的时间精确到毫秒。点歌与取消的时间范围重叠时，使用同一观众在同一份历史列表里的原始指令和排列顺序。已经实时入队、在历史轮询中被去重的指令仍可用于判断先后。`admin` 和 `room` 各自提供列表内的顺序。重复指令无法唯一对应、两份列表顺序矛盾，或仍有可能是目标的队列项无法确定先后时，保留队列，等待观众再次取消。
   其余命令 `settings.paused === 'true'` → 拒绝
   普通 request 随后对 `songRequestBlacklist` 每行应用 `cleanText`，与解析后的 `songName` 在简繁等价后区分大小写完整比较；命中返回 `点歌内容命中黑名单。`，不进入冷却、歌库自动补全或入队。`78` 拦截 `点歌78` / `点歌 78`，不拦截 `点歌78号公路`。空名单不拦截；随机指令、手动入队及已有队列不受影响。
3. 用户冷却：按本直播间已核验大航海选择对应身份间隔，空串或 0 均不限，各身份互不沿用；非大航海使用 `userCooldownSeconds`；UI 明确为「非大航海点歌间隔」，所有身份均按每位观众分别计时。`src/music/user-request-cooldown.js` 由 `domainServices` 创建并持有，集中管理内存记录、24 小时过期清理、启动恢复及成功接纳后的 `cooldownStore.touch` 持久化（DB 失败保留内存记录并告警，不阻断本次点歌）；Bilibili 重连不重建冷却。消息处理器以 `v2:` + JSON `[fanScope || null, identity.type, identity.uid]` 构键，UID 与 `open_id`、不同主播作用域均独立；只有冷却大于 0 且稳定身份存在的成功接纳才写入，0 秒或无身份请求不生成昵称/匿名键。旧裸 UID、`open_id:` 或昵称记录不映射到新键、不对任何租户生效，保留至正常清理。启用间隔但缺少稳定身份时拒绝。完整清库在数据库全部提交成功后，依原运行状态重置顺序清空内存；数据库阶段部分失败不重置。
4. `enableRandomTagReply` 保留原设置键，对应 UI“点歌回复”；单曲和随机的歌曲冷却、配额、用户黑名单及身份资格拒绝转为未接受结果及自动 @ 回复（开关关闭则无回复），不推进观众冷却。内容由系统生成，无需词库；发送仍由客户端执行。队列已满、非歌库歌曲、重复歌曲、个人配额及身份确认的直播措辞在桥接层按错误码映射，不改变 `result.reason`、HTTP 响应或诊断使用的领域原文。
5. random:`context.pickRandomSong(scopeText, fanScope)`(歌库随机,scope 匹配标签/曲风,见 [services.md](../music/services.md));无歌时若 `enableRandomTagReply==='true'` 生成 autoReply([bilibili-message-handler.js:42-57](../../../../src/bilibili/bilibili-message-handler.js#L42-L57)、[bilibili-message-handler.js:156-173](../../../../src/bilibili/bilibili-message-handler.js#L156-L173))
6. request:`resolveSongRequest(songName)` 唯一名匹配后 `addQueueItem`([bilibili-message-handler.js:72-88](../../../../src/bilibili/bilibili-message-handler.js#L72-L88))
7. 入队输入携带 `requesterName/requesterUid/requesterIdentityType/requesterGuardLevel/requesterMedalName/requesterMedalLevel/isPinned/messageTimestamp`，以及内部 `viewerRequest` 与独立的 `requesterGuardVerified/requesterMedalVerified`。实时弹幕、SC、历史消息及桌面随机入口都转发 user-info 的当前房间证据；未知或外间身份不能满足资格。统一准入、事务配额及默认值见 [services.md](../music/services.md) §8.2 与 [storage.md](../storage.md) §7。

## 6. 弹幕机器人职责

客户端 [domain-services.js](../../../../src/server/domain-services.js) 优先占用精确“签到”和“抽签”命令，返回 `cloud-owned`，不计算、不落库、不回复，也不交给点歌、DIY 或 AI。其余命令沿用本地点歌和自定义回复链。云端执行和验收以 [云端签到与抽签规格](../../../../specs/cloud-daily-bots.md) 为准。

### 6.1 云端签到

Server 的 `monitor-manager → daily-bot-service → daily-bot-store` 在认证后的主播作用域中处理签到。北京时间判日，每个 UID 每天至多累计一次；重复签到读取已保存的当日结果，提交业务记录后再发送回复。客户端控制云端开关、展示状态，并通过受限 IPC 按需编辑云端词库；保存后在直播间发送「签到」查看实际回复，客户端不提供回复预览。

### 6.2 云端抽签与默认词库

Server 按主播保存抽签方式。默认「每日固定」保存每日结果快照，同日重复命令、重启和词库更新均读取该快照；「每次随机」从当前词库重新抽取，允许重复、不限每日次数，不写每日固定表。切回固定模式保留已有日快照。客户端在「抽签机器人 → 设置」中自动保存方式，并编辑词库；旧服务器不支持时禁用方式选择并提示更新。完整协议见 [云端规格](../../../../specs/cloud-daily-bots.md)。客户端 [bot-defaults.js](../../../../src/shared/bot-defaults.js) 保留 30 条祝福和 20 条签文，供设置默认值及旧数据兼容读取使用；本地签到、抽签服务及签到写入 store 已退役。旧库读取边界见 [storage.md](../storage.md)。

### 6.3 自定义回复(custom-reply-service)

| 事实     | 值                                                                                        | 出处                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 开关     | `enableCustomReplyBot === 'true'`,否则不匹配                                              | [custom-reply-service.js](../../../../src/bilibili/custom-reply-service.js)        |
| 匹配     | 消息与启用的关键词按简体、小写做子串匹配，按配置顺序取首条命中(**无需点歌前缀**)。本机跳过已知发送账号自身弹幕的关键词回复，避免回流重发。 | [custom-reply-service.js](../../../../src/bilibili/custom-reply-service.js) |
| 规则上限 | `MAX_CUSTOM_REPLY_RULES = 30`                                                             | [custom-reply-service.js](../../../../src/bilibili/custom-reply-service.js)          |
| 字段上限 | 关键词 `30` 字符、回复 `120` 字符(`truncateText`)                                         | [custom-reply-service.js](../../../../src/bilibili/custom-reply-service.js)     |

`customReplyRules` 以 JSON 字符串保存规则数组；`isCommandText(message)` 暴露给入口识别，使自定义关键词也能参与去重窗口。同一条实时弹幕复用一次命令判定，服务实例按规则字符串复用启用规则的匹配词，仅在字符串变化时重新折叠关键词的简繁和大小写。开关和规则更新在下一次调用立即生效。关键词适配器只投影 `enableCustomReplyBot` 与 `customReplyRules`；普通非点歌弹幕在桥接层取得完整点歌设置前返回，SC 仍先应用原有关闭规则。直接传入数组的调用仍逐次读取，命中规则对外返回副本，调用方修改结果不会影响后续匹配。

### 6.4 云端菜单的桌面命令投影

[danmaku-menu.js](../../../../src/server/danmaku-menu.js) 从当前桌面状态生成可选的 `menuCommands: string[]` 云设置展示字段。弹幕监听关闭时为空；点歌未暂停时列出点歌与随机点歌；有启用的关键词规则时显示关键词回复提示；AI 仅在实际配置就绪时显示触发词；投票、评分和小游戏只在当前会话接受弹幕时列出，并标明「进行中」。菜单不列出没有弹幕命令的切歌、加班或自动播报功能。该字段保留旧客户端的读写兼容；当前云端菜单固定回复“签到、抽签、今日礼物、今日盲盒；礼物特效后接数字ID”，不再消费这组投影。投影不授予执行权限，也不证明客户端仍在线。

[server.js](../../../../src/server.js) 组合根在完整设置快照和待传设置出口合入当前投影，不把菜单、AI 密钥、关键词回复正文或游戏内部状态持久化为同步设置。关键词设置和 AI 可用性/触发词变更沿用现有 settings 同步通知；游戏/互动广播在同轮变更合并后比较菜单，仅有实际变化时请求上传，无新增心跳。服务端返回的菜单字段不回写本地配置。
菜单读取小游戏拥有者的 `getMenuState()` 摘要（类型、阶段、当前回合方及胜负），仍先处理回合到期；不构造用于显示的画布、聊天历史或积分榜。

### 6.5 回复目标(mention-policy + requester-target-store)

- `normalizeMentionTarget(input)`([mention-policy.js](../../../../src/bilibili/danmaku/mention-policy.js)):uid 须为 1-20 位数字,名字截断 80 字符；API 客户端将校验后的目标写入 `reply_mid` / `reply_uname`，不额外拼接文本前缀。发送器的可见提及与拆分规则见下节。
- 提及目标来源 `requesterTargets.getLatestRandomRequester()`（[requester-target-store.js](../../../../src/storage/requester-target-store.js)）：从 `random_request_history` 取最新一条有 uid 或名字的随机点歌记录；该历史与随机入队同事务更新，保留规则见 [存储合同](../storage.md) §3.1。`sendDanmaku` 中的 `reply_mid` 校验复用它（[api-client.js](../../../../src/bilibili/danmaku/api-client.js)）。

## 7. danmakuSender 发送服务

`createDanmakuSenderService(dependencies)` 由 [bilibili-runtime.js](../../../../src/server/bilibili-runtime.js) 装配；认证、房间、请求者与开关通过依赖读取，发送行为由 [sender-service.js](../../../../src/bilibili/danmaku/sender-service.js) 持有。

自动钓鱼/打劫批次绑定状态读取开始时捕获的 `sendSession`，每条 POST 都携带该断言。运行时由账号身份修订、鉴权失败代次、房间修订及停止状态生成会话标识，不含 Cookie 或令牌，也不承担授权。发送器在队列执行、限速等待、身份/提及目标/房间读取以及每段发送前后复核；会话变化抛 `DANMAKU_SESSION_CHANGED`，HTTP 沿用 502 `{ok:false,error,detail}`，人话提示停止旧批次。省略断言的既有手动调用保持原行为；已发出的消息无法撤回。

| 事实         | 值                                                                                                                                                                  | 出处                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单条弹幕上限 | `DANMAKU_MESSAGE_LIMIT = 40` 字符(按 grapheme 切分)，由 `danmaku/contract.js` 统一提供给发送器与 AI 回复预算                                                        | [contract.js](../../../../src/bilibili/danmaku/contract.js)                                                                                                               |
| 限速         | `minIntervalMs = 1500`(可注入);未到间隔再发:默认抛 `发送过于频繁`;`waitForRateLimit=true` 时等待                                                                    | [sender-service.js:19](../../../../src/bilibili/danmaku/sender-service.js#L19)、[sender-service.js:110-113](../../../../src/bilibili/danmaku/sender-service.js#L110-L113) |
| 切分         | 超长按 40 字符切块;有提及目标时首块预留 `@名字 ` 长度;`mentionEveryChunk` 每块都提及;块间可选 `intervalMs` 间隔;自然断句优先(标点 `。！？!?；;，,、～~` 与括号表情) | [sender-service.js:163-219](../../../../src/bilibili/danmaku/sender-service.js#L163-L219)                                                                                 |
| 显示资料缓存 | 账号与房间各自的名称、头像缓存 10 分钟。当前房间的实时昵称和头像齐全时直接显示。实时资料只有一项时，缓存命中沿用原到期时间，到期后的首次读取重新查询房主资料。切换配置房间即清除状态中的旧主播资料，监听关闭时也按新房号取资料。 | [sender-service.js](../../../../src/bilibili/danmaku/sender-service.js)、[bilibili-runtime.js](../../../../src/server/bilibili-runtime.js) |
| 状态         | `getState()` 返回 `loggedIn/accountUid/accountName/accountAvatarUrl/roomId/roomName/roomAvatarUrl/connected/canSend/requester/各机器人开关` 等                     | [sender-service.js:34-62](../../../../src/bilibili/danmaku/sender-service.js#L34-L62)                                                                                     |

**本地自动回复路径**由 [bilibili-client.js](../../../../src/server/bilibili-client.js) 的 `onMessage` 持有：`result.autoReply` 用于随机点歌无匹配及队列 owner 的预期业务拒绝（受既有点歌回复开关控制），`result.customReplyReply` 用于自定义关键词命中。两者调用 `danmakuSender.send({message, mentionTarget, mentionEveryChunk: true})`，每段均通过原生回复 @ 原弹幕发送者并预留完整昵称长度；`mentionEveryChunk` 缺少 UID 或昵称时发送器拒绝发送，不退回普通弹幕，调用方记录发送失败；`cloud-owned` 结果提前返回，不发送签到或抽签回复。云端职责见 §6。

AI 自动接话通过同一 sender 的等待限流、授权与会话断言发送，保留默认全局节流；它的一条正文已由 AI 领域校验预算，面向全场时允许无提及。定向 AI 问答沿用自身发送节奏。发送前过期检查、提交标记和是否重试均由 AI service 持有，不能用 sender 的通用拆分能力绕过自动任务限制，见 [AI 交付契约](../ai.md#9-弹幕交付与送达验证)。

发送器只缓存配置房间到真实房间 ID 的映射，最多五分钟；房间或账号 UID/Cookie 变化立即重新解析，失败不缓存。发送解析调用 `resolveRoomInfo({includeOwner:false})`，无需主播资料请求；监听、开播状态和其他资料读取仍使用新鲜 `resolveRoomInfo()`，不复用动态状态。

`bilibili-runtime` 在凭据读取异常时返回 `BILIBILI_AUTH_UNAVAILABLE`，清掉当前代次的凭据并停止旧监听，不当成主动登出或沿用旧账号 Cookie；真正成功读取的空凭据仍按匿名/未登录语义处理。捕获的 provider 与 session revision 不再当前时，拒绝过期结果且不清新代次缓存。监听重建读取失败后最多按 1、2、4 秒重试三次，成功清零，房间切换、断开和停止使已排队恢复失效；失败的发送不自动重发。连续故障保留明确状态，用户可重新刷新。

## 8. 诊断快照与调试缓冲

- `bilibiliDiagnostics` 继续提供 `lastPacketAt`、`lastCommandAt/recentCommands` 等连接诊断。原有礼物检测字段保留快照形状，但不再记录本地解析计数或未识别礼物；礼物处理结果来自服务器。见 [ws.md](../ws.md) §2。

### 8.1 登录到点歌的本地日志

`src/bilibili/diagnostics.js` 按事件选择安全字段，以 `[Bilibili][Diagnostic]`
输出 INFO。Electron 的 `terminal-log.js` 只额外保存这一前缀的 INFO，继续排除
普通 log/info/debug，沿用 run/seq、单条 2 KiB、文件 10 MiB 的已有容量保护。
`desktop.log` 保留窗口、Cookie 保存失败等原有记录。此增量不改变登录结果、
连接成功判定、重连触发或点歌规则；`socket-open` 不能替代 B 站认证成功。

| 事件 | 排查含义 |
| --- | --- |
| `login-open` / `login-closed` | 登录窗口打开、最终登录状态、关键 Cookie 是否存在、是否自动关闭及快照是否保存；`loggedIn` 只是本地凭据完整性，不等于平台验证有效 |
| `credentials-restore` / `credentials-import-*` / `logout-*` | 启动恢复、云端凭据导入、退出登录的开始/完成/失败；不输出凭据值 |
| `refresh-requested` / `auth-cache-changed` / `auth-read-failed` / `listener-created` | 手动刷新、运行时读取凭据变化或失败、使用这些凭据创建的监听实例；`clientGeneration` 区分实例 |
| `socket-connecting` / `socket-open` / `auth-sent` / `auth-result` | 连接与认证阶段；认证 `code=0/status=accepted` 表示收到成功回包，非零为 rejected，缺少合法整数 code 为 invalid |
| `auth-no-reply` | WebSocket 打开后 10 秒内未收到认证回包。记录事件并关闭当前连接，进入退避重连 |
| `socket-first-packet` / `heartbeat-confirmed` / `danmaku-first-received` | 每条连接首次收到数据、心跳回复、可解析弹幕；帮助区分传输存活和实际收到弹幕，不逐条保存普通聊天 |
| `socket-summary` / `listener-stopped` / `socket-closed` / `socket-error` | 断开/停止时的认证状态、包数、弹幕数、心跳回复数及最后收包时间，或连接错误 |
| `history-start` / `history-stop` / `history-sample` | 历史补偿启停，以及首次成功拉取/有新命令时的总数、过期数、重复数和处理数；空闲轮询不重复写样本 |
| `command-ingress` / `command-received` | 上游点歌进入及通过前置过滤；各自的 `nameMasked` 可比较原始昵称与身份缓存合并后的昵称 |
| `command-filtered` / `command-result` / `queue-broadcast` | 时间或去重过滤、处理结果、入队后的广播调用完成；`queue-broadcast` 不是浏览器源渲染确认 |

拒绝原因代码：`requests-paused` 暂停接收、`user-cooldown` 用户冷却、`song-cooldown` 单首歌曲／随机候选全部冷却、
`song-request-blacklisted` 点歌内容完整命中本机黑名单、
`requester-blacklisted` 用户名单、`requester-identity-required` 缺少身份、`user-queue-full` 个人配额、`requester-medal-required` 粉丝牌门槛、`requester-guard-required` 大航海门槛、
`no-random-candidate` 无符合条件的随机歌曲、`empty-song-name` 缺少歌名、
`queue-full` 队列满、`song-already-queued` 已入队、`song-not-in-library` 不在歌库、
`not-a-song-command` 指令不完整、`stale-timestamp` 超出接收时间窗、
`deduplicated:*` 去重拒绝、`unexpected-error` 未分类异常。失败的 `stage` 区分
请求处理、处理后的附属逻辑和广播，避免把已入队后的异常误读为点歌未入队。

点歌只记录类型、长度、时间、掩码标记、队列 ID 和进程内 HMAC `commandRef`，
不增加正文、用户 UID/昵称、Cookie、token 或原始认证包落盘。
`commandRef` 的随机密钥不保存，跨进程或历史接口时间精度变化时不能据此合并。

现场复现：安装包含此修改的版本，完成重新登录 → 重新连接直播间 → 发送一条歌库内且
尚未入队的点歌，保留发送时间和软件显示结果。即使随后自行恢复，也从
“工具箱 → 桌面更新 → 本地数据 → 日志目录”取对应时间的 `terminal.log`、`desktop.log` 及 `errors/` 中的错误记录，必要时包含 `.1`、`.2` 归档。
日志按[桌面日志策略](../../desktop/main.md#8-日志)分流、轮转并淘汰旧记录；日志缺失不能单独证明平台没有发送，仍无浏览器源回执或自动上报。无需反复重启或手动清理日志来复现。

## 9. 关键常数速查

| 参数                      | 值                               | 出处                                                                                                                                                             |
| ------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 历史轮询间隔 | 成功后 2.5 秒，错误退避见 §3 | [history-poller.js](../../../../src/bilibili/danmaku/history-poller.js) |
| 在线榜轮询                | 60s；两种排序各取前 100 人，去重合并 | [online-rank-poller.js](../../../../src/bilibili/danmaku/online-rank-poller.js) |
| 全量粉丝牌轮询            | 健康刷新目标 5min，每页 30 条；分批预算与失败退避见 §3 | [fans-medal-poller.js](../../../../src/bilibili/danmaku/fans-medal-poller.js)                                                                        |
| 开播检测                  | 10min(unref)                     | [live-status-monitor.js:5](../../../../src/bilibili/danmaku/live-status-monitor.js#L5)                                                                           |
| 身份缓存 TTL / 清理 | 10 分钟，读取与回收时机见 §10 | [user-info-service.js](../../../../src/bilibili/users/user-info-service.js) |
| 去重:跨源窗 / 保留 / 上限 | 1.5s / 30min / 1000→500          | [message-deduplicator.js:8-10](../../../../src/bilibili/danmaku/message-deduplicator.js#L8-L10)                                                                  |
| 重连延迟                  | 1/2/4/8/16/30 秒，有上限；稳定认证连接后清零 | [danmaku-client.js](../../../../src/bilibili/danmaku-client.js) |
| 可捕获窗口                | 启动前 5s ~ 30min 前 ~ 未来 5min | [helpers.js:41-50](../../../../src/bilibili/helpers.js#L41-L50)                                                                                                  |
| 发送限速 / 单条上限       | 1.5s / 40 字符                   | [sender-service.js:19](../../../../src/bilibili/danmaku/sender-service.js#L19)、[sender-service.js:5](../../../../src/bilibili/danmaku/sender-service.js#L5)     |
| 签到/抽签日期             | 北京时间 UTC+8                   | [云端规格](../../../../specs/cloud-daily-bots.md)                                                                                           |
| 自定义回复上限            | 30 条 / 关键词 30 / 文本 120     | [custom-reply-service.js:7-9](../../../../src/bilibili/custom-reply-service.js#L7-L9)                                                                            |

## 10. 用户信息门面与房间运行边界

`UserInfoService`([user-info-service.js](../../../../src/bilibili/users/user-info-service.js)) 是 Bilibili 用户资料和当前房间身份的唯一 merge policy owner。解析器只产生 `IdentityHint`；`MessageHandlers`、History/OnlineRank/FansMedal poller 通过注入的 `ingestHint`/`replaceOnlineSnapshot` sink 提交，poller 不访问 `IdentityCache`、profile provider 或 Avatar Proxy。

默认服务按 UID 保存一份合并资料，最近观众按房间活动时间排序，在线名单来自最近一次有效的榜单快照。补取头像只更新资料。切房时清空两类名单和旧房身份。粉丝牌轮询提交线索后只统计受理数，订阅者仍按字段变化收到通知。

显式注入 `IdentityCache` 时，门面同步维护其兼容投影。`resolve` 读取最终身份，`remember` 拒绝绕过门面写入。独立构造的旧缓存保留两个方法的签名，旧输入复用门面的昵称、头像和房间来源优先级。见[字段证据规则](../../../../src/bilibili/users/user-info-evidence.js)。

门面公开 `peek`、`ingestHint`、`ensure`、`listRecent`、`listOnline`、`replaceOnlineSnapshot`、`subscribe`、`setRoom`、`beginRoomRun`、`endRoomRun`、`dispose`。`name`/`avatarUrl` 是 UID 全局 profile，`guard`/`fansMedal` 是 `{roomId, ownerUid}` 房间身份；字段投影只返回请求字段和 `uid`，不泄露 evidence、source、generation 或 runToken。粉丝牌非空值必须携带匹配主播 UID，verified absence 与 unknown 分离。

组合根在启动一轮房间监听时调用一次 `beginRoomRun()`，把同一个不可变 context 传给三个 poller。该轮内同房间的连接重试复用 context 和在线榜任务。显式结束后重启，即使房间相同也轮换 runToken，等待新一轮在线榜快照。`setRoom()` 递增 room generation 并清除旧 room identity/audience index，A→B→A 的旧 context 仍失效。结束整组 producer 时调用 `endRoomRun()`，共享 service 只在 runtime dispose 时销毁。

头像流程是显式的：消息先 ingest 自带可信头像；画猜、今日礼物卡片等业务在确实需要且缺失时调用 `ensure()`，provider 以 `profile:${uid}` 合并在途请求并对失败或未返回完整资料做 30 秒负缓存，已返回的有效字段继续可用。用户资料请求八秒超时，B 站非零业务返回码按失败处理。`onMessage()` 返回值没有头像触发语义，renderer 仍只通过现有 `/api/bilibili/avatar` 代理获取图片。

单 UID 读取和消息合并最多每 30 秒触发一次全缓存回收，当前 UID 仍逐次检查 10 分钟 TTL，过期资料不会因批量清理尚未到期而返回或续用。最近/在线名单读取仍会先清理过期资料；缓存命中不刷新 `seenAt`，失败冷却与在途请求合并保持独立。

粉丝档案的手动/每日名单同步另由 Electron controller 调用 `BilibiliApiClient.fetchUserProfile(uid, {signal})`，对名单外未归档 UID 档案读取新资料，不使用上述缺失资料缓存。该方法保留 8 秒截止时间，并与可选调用方取消信号组合；已取消时不发请求。归属核验、查询节流和写回事务见[粉丝档案规格](../../../../specs/fan-profiles.md)。

## 类别 3 实时统计入口

`WebSocketConnection` 在帧回调开始记录单调 receivedAt 与 frameSeq，异步二进制读取按帧串行；替换 socket 后丢弃旧回调。`BilibiliDanmakuClient` 在建立连接时固定 accountUid、解析后的 roomId、client/connection/attempt 合成的 connectionKey，随帧传入 `MessageHandlers`。统计钩子位于命令过滤和去重之前，只处理 DANMU_MSG；通过 `bilibili-runtime.subscribeRealtime()` 通知当前场，不复用 onMessage 的第二条路径，也不接受历史/SC/礼物。

`BilibiliDanmakuClient.getRealtimeState()` 仅在当前长连打开并通过鉴权、房间和主播已知时报告就绪。已确认的连接代次和握手账号须与当前连接及 API 账号相符，runtime 还会核对当前授权账号。更换账号后要等对应的新连接确认。服务开始时订阅、结束时退订。断连保留计数与原截止，同房间新连接可续收。更换配置房间或账号后旧场永久 interrupted，投票仍按原截止结束，评分等待手动结算。

平台时间只读取 info[0][4] 的可用秒/毫秒值，缺失为 null，不把 Date.now 回退当平台时间；eventId 当前为 null，尚无经真实受控验证的稳定 ID。评分有可比较时间时拒绝较旧值，时间相同或缺失时按本地帧/包顺序，不使用 UID+文本去重。此降级无法识别所有跨报文重放；按用户 2026-09-20 指示，普通弹幕 UID/时间/事件 ID 的真实直播间复核安排在实现后，当前自动化证据不是该实测结论。
