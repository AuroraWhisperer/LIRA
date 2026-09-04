# 弹幕监听管线:BilibiliDanmakuClient 与弹幕机器人

> 涉及文件:[danmaku-client.js](../../../../src/bilibili/danmaku-client.js)、[danmaku/message-handlers.js](../../../../src/bilibili/danmaku/message-handlers.js)、[danmaku/feed-buffer.js](../../../../src/bilibili/danmaku/feed-buffer.js)、[danmaku/history-poller.js](../../../../src/bilibili/danmaku/history-poller.js)、[danmaku/online-rank-poller.js](../../../../src/bilibili/danmaku/online-rank-poller.js)、[danmaku/fans-medal-poller.js](../../../../src/bilibili/danmaku/fans-medal-poller.js)、[danmaku/live-status-monitor.js](../../../../src/bilibili/danmaku/live-status-monitor.js)、[danmaku/identity-cache.js](../../../../src/bilibili/danmaku/identity-cache.js)、[users/user-info-service.js](../../../../src/bilibili/users/user-info-service.js)、[users/profile-provider.js](../../../../src/bilibili/users/profile-provider.js)、[danmaku/message-deduplicator.js](../../../../src/bilibili/danmaku/message-deduplicator.js)、[danmaku/sender-service.js](../../../../src/bilibili/danmaku/sender-service.js)、[danmaku/mention-policy.js](../../../../src/bilibili/danmaku/mention-policy.js)、[danmaku/command-text.js](../../../../src/bilibili/danmaku/command-text.js)、[bilibili-message-handler.js](../../../../src/bilibili/bilibili-message-handler.js)、[checkin-service.js](../../../../src/bilibili/checkin-service.js)、[checkin-blessings.js](../../../../src/bilibili/checkin-blessings.js)、[fortune-service.js](../../../../src/bilibili/fortune-service.js)、[custom-reply-service.js](../../../../src/bilibili/custom-reply-service.js)、[diagnostics/message-buffer.js](../../../../src/bilibili/diagnostics/message-buffer.js)、[server.js](../../../../src/server.js) 的装配段、[domain-services.js](../../../../src/server/domain-services.js) 的 messages 段

本文档是 **Bilibili 弹幕监听管线与机器人行为**的唯一事实源:客户端回调契约、轮询器/缓存间隔、命令解析、签到/抽签/自定义回复、弹幕发送与诊断快照只在此成表。**服务端侧**的客户端生命周期(configure/reconnect/_replaceClientChain)归 [server-core.md](../server-core.md) §6 所有,本文只描述客户端内部行为。线协议(HTTP/WBI/WS/解析)见 [protocol.md](protocol.md),礼物入库见 [gift.md](gift.md)。

## 1. 客户端回调契约

`BilibiliDanmakuClient` 通过 handlers 与外部通信([danmaku-client.js:16-67](../../../../src/bilibili/danmaku-client.js#L16-L67)),四个回调由 [server.js:609-712](../../../../src/server.js#L609-L712) 的 `createBilibiliClient` 装配:

| 回调                     | 触发                                                                                  | server.js 消费                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onMessage(danmaku)`     | 每条实时弹幕、SC 命令文本、历史轮询命令                                               | `source:'danmaku'` 的实时消息先发布到有界弹幕流；随后交给 `games.handleDanmaku` 处理活动小游戏（你画我猜在作画阶段按完整答案计分），再进入 `messages.handleDanmaku` 点歌桥接 + 机器人链；点歌链 `accepted` 时 `broadcastSnapshot('bilibili:danmaku'/'bilibili:superchat')`([bilibili-client.js](../../../../src/server/bilibili-client.js)) |
| `UserInfoService` 更新   | 业务明确需要资料时调用 `ensure(uid, { fields })`；头像补全不由 `onMessage` 返回值触发 | 画猜在缺头像时显式调用窄 resolver，再由 `games.updateDanmakuAvatar` 回填；service 负责去重、合并和更新通知                                                                                                                                                                                                                                  |
| `onSuperChat(superChat)` | 每条 SC 到达                                                                          | `superChats.add` 入库,成功则广播 `bilibili:superchat`([server.js:671-690](../../../../src/server.js#L671-L690),入库见 [gift.md](gift.md) §7)                                                                                                                                                                                                |
| `onGift(gift)`           | 解析有效的礼物事件                                                                    | `gifts.add` → 礼物检测管道([server.js:692-700](../../../../src/server.js#L692-L700),见 [gift.md](gift.md) §2)                                                                                                                                                                                                                               |
| `onStatus(liveStatus)`   | 连接状态变化                                                                          | `updateLiveStatus` 写入快照 `liveStatus` 字段([server.js:701](../../../../src/server.js#L701)、[server.js:714-720](../../../../src/server.js#L714-L720))                                                                                                                                                                                    |

客户端构造时还注入 `diagnostics`(§8)、`runtimeGiftCommandPrefixes`(可增补礼物前缀)、`messageBuffer` 与 `isCommandText`([server.js:702-711](../../../../src/server.js#L702-L711))。

## 2. 客户端内部生命周期

> 服务端何时调用 start/restart/stop、`_replaceClientChain` 串行化见 [server-core.md](../server-core.md) §6。此处只描述客户端内部行为。

### 2.1 start / restart / stop

| 方法        | 语义                                                                                                                                | 出处                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `start()`   | `stopped=false`、递增 `connectionGeneration`、重置 `startedAtMs`;**不等待握手**即返回;首连失败 → 启动历史轮询 + `scheduleReconnect` | [danmaku-client.js:69-92](../../../../src/bilibili/danmaku-client.js#L69-L92)     |
| `restart()` | 同 start,但 `connect({waitForOpen: true})` **等待握手完成**才 resolve;失败仍安排重连后 rethrow                                      | [danmaku-client.js:94-120](../../../../src/bilibili/danmaku-client.js#L94-L120)   |
| `stop()`    | `stopped=true`、递增 generation(使在途异步失效)、清重连定时器、关 WS、停全部轮询器、销毁 MessageHandlers                            | [danmaku-client.js:122-134](../../../../src/bilibili/danmaku-client.js#L122-L134) |

`connectionGeneration` 是**代际屏障**:所有异步回调先过 `isConnectionCurrent(generation)`([danmaku-client.js:399-401](../../../../src/bilibili/danmaku-client.js#L399-L401))防止旧连接的消息/回调串扰新连接。

### 2.2 connect 流程

`connect(options, generation)`([danmaku-client.js:150-285](../../../../src/bilibili/danmaku-client.js#L150-L285)):

1. `resolveRoomInfo()`(room_init + master_info,见 [protocol.md](protocol.md) §2) → 记录 `ownerName`,通知 MessageHandlers 主播 uid([danmaku-client.js:162-166](../../../../src/bilibili/danmaku-client.js#L162-L166))。
2. 未开播或 `alwaysHistory` → 启动 HistoryPoller;随后启动 OnlineRankPoller、FansMedalPoller 与 LiveStatusMonitor([danmaku-client.js:168-174](../../../../src/bilibili/danmaku-client.js#L168-L174))。
3. `resolveDanmuInfo()`(WBI 签名)取 host + `wss_port||443` + token,组装 wsUrl 与认证包([danmaku-client.js:174-189](../../../../src/bilibili/danmaku-client.js#L174-L189),见 [protocol.md](protocol.md) §4.1)。
4. `clearHandlers()` 后挂 open/message/close/error 处理器([danmaku-client.js:201-282](../../../../src/bilibili/danmaku-client.js#L201-L282));open 时若直播中停掉历史轮询([danmaku-client.js:213-215](../../../../src/bilibili/danmaku-client.js#L213-L215));close 时重启历史轮询并安排重连([danmaku-client.js:240-263](../../../../src/bilibili/danmaku-client.js#L240-L263))。
5. `wsConnection.connect(wsUrl, authPayload, options)`([danmaku-client.js:284](../../../../src/bilibili/danmaku-client.js#L284))。

### 2.3 断线重连与退避

| 场景                                            | 延迟                                                                        | 出处                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| WS close 时**首次**断开(`reconnecting=false`)   | **0ms 立即重连**                                                            | [danmaku-client.js:250](../../../../src/bilibili/danmaku-client.js#L250)          |
| 后续重连失败 / 已在重连中再断开                 | 固定 **5000ms**(`scheduleReconnect(generation, delayMs)` 默认值)            | [danmaku-client.js:374-397](../../../../src/bilibili/danmaku-client.js#L374-L397) |
| 开播检测触发的重连(`reconnectAfterLiveStarted`) | 取消既有重连定时器、停历史轮询、重置 `startedAtMs` 后**立即**走完整 connect | [danmaku-client.js:331-372](../../../../src/bilibili/danmaku-client.js#L331-L372) |

重连失败路径:报告状态(`connected: historyFallbackActive`)→ 再次 `scheduleReconnect` 无限循环,直到 `stop()`([danmaku-client.js:376-396](../../../../src/bilibili/danmaku-client.js#L376-L396))。

## 3. 轮询器与缓存(全部间隔速查)

| 组件                                    | 间隔/容量                                                                                     | 行为                                                                                                                                                | 出处                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HistoryPoller                           | **2.5s**(首轮立即)                                                                            | 拉 `gethistory`(`data.admin` + `data.room` 按 timeline 排序),只处理命令文本且通过可捕获窗口的消息;产出 `source:'history'`                           | [history-poller.js:26-31](../../../../src/bilibili/danmaku/history-poller.js#L26-L31)、[history-poller.js:42-74](../../../../src/bilibili/danmaku/history-poller.js#L42-L74)                                                                                                                          |
| OnlineRankPoller                        | **60s**,pageSize **50**,最多 **3 页**                                                         | 逐页拉高能榜写入 IdentityCache;停止条件:items 空 / `items.length < pageSize` / `page*pageSize >= onlineNum`;每轮结束 `identityCache.cleanup()`      | [online-rank-poller.js:9-11](../../../../src/bilibili/danmaku/online-rank-poller.js#L9-L11)、[online-rank-poller.js:42-63](../../../../src/bilibili/danmaku/online-rank-poller.js#L42-L63)                                                                                                            |
| FansMedalPoller                         | **5min**,pageSize **30**                                                                      | 逐页拉 `getFansMembersRank` 的全量本房粉丝牌成员(`data.num` 为总数),写入 IdentityCache;最多 10000 页防止异常响应;快照优先级低于点歌弹幕/SC/历史消息 | [fans-medal-poller.js:8-11](../../../../src/bilibili/danmaku/fans-medal-poller.js#L8-L11)、[fans-medal-poller.js:49-75](../../../../src/bilibili/danmaku/fans-medal-poller.js#L49-L75)                                                                                                                |
| LiveStatusMonitor                       | **10min**,`timer.unref()`                                                                     | **仅未开播时**启动;检测到 `live_status` 0→1 触发 `reconnectAfterLiveStarted`;`checkInFlight/reconnectInFlight` 防重入                               | [live-status-monitor.js:5](../../../../src/bilibili/danmaku/live-status-monitor.js#L5)、[live-status-monitor.js:27-37](../../../../src/bilibili/danmaku/live-status-monitor.js#L27-L37)、[live-status-monitor.js:49-93](../../../../src/bilibili/danmaku/live-status-monitor.js#L49-L93)              |
| UserInfoService + IdentityCache adapter | service 内存 TTL **10min**; cache 只保存 service 已合并的最终状态和 audience index            | `DANMU_MSG`/SC/历史消息/礼物/榜单统一提交 `IdentityHint`; service 按字段质量/验证/authority/freshness 合并、投影和订阅；cache 不再决定覆盖策略      | [user-info-service.js](../../../../src/bilibili/users/user-info-service.js)、[identity-cache.js](../../../../src/bilibili/danmaku/identity-cache.js)                                                                                                                                                  |
| MessageDeduplicator                     | key = `uid\|秒桶\|文本`;跨源匹配窗 **1.5s**;过期 **30min**;容量超 **1000** 触发修剪至 **500** | 重复 key 拒绝(记录 rejectedSources 日志);跨源去重(同一人 1.5s 内同文本)拒绝                                                                         | [message-deduplicator.js:8-10](../../../../src/bilibili/danmaku/message-deduplicator.js#L8-L10)、[message-deduplicator.js:18-74](../../../../src/bilibili/danmaku/message-deduplicator.js#L18-L74)、[message-deduplicator.js:76-90](../../../../src/bilibili/danmaku/message-deduplicator.js#L76-L90) |

**消息可捕获窗口** `isCapturableBilibiliTimestamp(ts, startedAtMs)`([helpers.js:41-50](../../../../src/bilibili/helpers.js#L41-L50)):

```
ts >= max(startedAtMs - 5000, now - 30*60*1000)   // 不早于启动前 5s, 不早于 30 分钟前
ts <= now + 5*60*1000                              // 不超过未来 5 分钟 (时钟偏差)
```

该窗口同时约束弹幕、SC 命令与历史轮询三路(见 §4)。

## 4. 消息管道(MessageHandlers)

`handlePackets(buffer)`([message-handlers.js:58-73](../../../../src/bilibili/danmaku/message-handlers.js#L58-L73)):更新 `lastPacketAt` → 逐条 `parseBilibiliPackets` → 按 cmd 分发(DANMU_MSG / SUPER_CHAT_MESSAGE / gift-like,见 [protocol.md](protocol.md) §6)。管线内每路都过**可捕获窗口 → 去重 → 身份解析**三步:

**弹幕**(`handleDanmaku`,[message-handlers.js:75-114](../../../../src/bilibili/danmaku/message-handlers.js#L75-L114)):仅命令文本参与窗口校验与去重;`onMessage` 载荷含 `source:'danmaku'`、归一化 cmd 和发送者 `avatarUrl`。头像优先取该条 `DANMU_MSG` 的用户扩展资料，缺失时按 uid 复用在线榜/历史身份缓存；`DANMU_MSG` 前缀统一为 `DANMU_MSG`([message-handlers.js:242-247](../../../../src/bilibili/danmaku/message-handlers.js#L242-L247))。

**SC**(`handleSuperChat`,[message-handlers.js:115-176](../../../../src/bilibili/danmaku/message-handlers.js#L115-L176)):每条 SC 都先 `onSuperChat`(入库,见 [gift.md](gift.md) §7);若文本是命令,再过窗口 + 去重后二次 `onMessage(source:'superchat', isPinned: price>=2)`,命令拒绝仅发生在 `onMessage` 一路,不影响 SC 入账。

**礼物**(`handleGift`,[message-handlers.js:178-238](../../../../src/bilibili/danmaku/message-handlers.js#L178-L238)):见 [protocol.md](protocol.md) §6.4-6.7,`onGift` 载荷即协议解析结果 + 身份缓存补全的 `uid/userName`([message-handlers.js:229-237](../../../../src/bilibili/danmaku/message-handlers.js#L229-L237))。

### 4.1 实时弹幕流

`createDanmakuFeedBuffer()` 只接收 `source:'danmaku'` 的实时消息，投影为公开字段 `{id,uid,name,message,avatarUrl,guardLevel,medalName,medalLevel,timestamp,emotes}`，内存中最多保留最近 50 条。切换直播间时清空旧房间数据；`getSnapshot()` 返回防御性副本。

每条新消息由 `server.js` 广播 `danmaku:message`，完整有界列表同时进入全量快照的 `danmakuFeed` 字段。头像和表情地址都只保留可信的 B 站 CDN HTTPS 地址，浏览器端统一通过现有 `/api/bilibili/avatar` 本地图片代理加载。

## 5. 命令解析与点歌桥接

### 5.1 命令识别(入口统一)

`isBilibiliCommandText`([command-text.js:9-14](../../../../src/bilibili/danmaku/command-text.js#L9-L14))是 WebSocket / 历史轮询 / SC 二次分发的统一名单:

```
text.startsWith('点歌') || text.startsWith('随机')
|| isCheckinCommand(text)        // 签到
|| isFortuneCommand(text)        // 抽签
|| customMatcher(text)           // 自定义回复规则 (server.js 注入 domainServices.customReplies.isCommandText)
```

### 5.2 parseDanmakuCommand

`parseDanmakuCommand(text, settings)`([bilibili-message-handler.js:105-131](../../../../src/bilibili/bilibili-message-handler.js#L105-L131)):

| 输入                                 | 结果                         |
| ------------------------------------ | ---------------------------- |
| `随机点歌{scope}`                    | `{type:'random', scopeText}` |
| `随机 {scope}`                       | `{type:'random', scopeText}` |
| `随机{scope}`(scope ≠ 空且 ≠ `点歌`) | `{type:'random', scopeText}` |
| `点歌{songName}`                     | `{type:'request', songName}` |
| 其他                                 | `null`(非命令)               |

`normalizeRandomScopeText` 循环剥掉前导 `+ ＋ : ： - —` 字符([bilibili-message-handler.js:135-141](../../../../src/bilibili/bilibili-message-handler.js#L135-L141));`randomSourceValue` 生成 `random:{scope}`/`random` 来源标记([bilibili-message-handler.js:143-146](../../../../src/bilibili/bilibili-message-handler.js#L143-L146))。

### 5.3 handleDanmakuMessage 处理链

`handleDanmakuMessage(context, danmaku)`([bilibili-message-handler.js:11-101](../../../../src/bilibili/bilibili-message-handler.js#L11-L101)):

1. 解析命令 → 非命令 `{accepted:false, reason:'不是点歌指令。'}`
2. `settings.paused === 'true'` → 拒绝
3. 用户冷却:`userCooldownSeconds`(默认见 [storage.md](../storage.md) §7),内存 `cooldownByUser` Map + `cooldownStore.touch` 持久化(DB 失败不阻断本次点歌,[bilibili-message-handler.js:90-99](../../../../src/bilibili/bilibili-message-handler.js#L90-L99))
4. random:`context.pickRandomSong(scopeText)`(歌库随机,scope 匹配标签/分类,见 [services.md](../music/services.md));无歌时若 `enableRandomTagReply==='true'` 生成 autoReply([bilibili-message-handler.js:42-57](../../../../src/bilibili/bilibili-message-handler.js#L42-L57)、[bilibili-message-handler.js:156-173](../../../../src/bilibili/bilibili-message-handler.js#L156-L173))
5. request:`resolveSongRequest(songName)` 唯一名匹配后 `addQueueItem`([bilibili-message-handler.js:72-88](../../../../src/bilibili/bilibili-message-handler.js#L72-L88))
6. 队列项携带 `requesterName/requesterUid/requesterGuardLevel/requesterMedalName/requesterMedalLevel/isPinned/messageTimestamp`(消费方 queue-service 见 [services.md](../music/services.md))

## 6. 弹幕机器人四件套

domain-services 的 messages 域按序组装点歌 → 签到 → 抽签 → 自定义回复([domain-services.js:103-139](../../../../src/server/domain-services.js#L103-L139));机器人产生的 `autoReply` 由 server.js 的 `onMessage` 发送(§7)。开关设置键归属 [storage.md](../storage.md) §7。

### 6.1 签到(checkin-service)

| 事实     | 值                                                                                                              | 出处                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 命令     | 精确 `签到`(`CHECKIN_COMMAND`)                                                                                  | [checkin-service.js:8](../../../../src/bilibili/checkin-service.js#L8)                                                                                  |
| 开关     | `enableCheckinBot === 'true'`,否则 `checkin-disabled`                                                           | [checkin-service.js:30-32](../../../../src/bilibili/checkin-service.js#L30-L32)                                                                         |
| uid 要求 | 缺失或 `'0'` → `missing-uid`                                                                                    | [checkin-service.js:34-37](../../../../src/bilibili/checkin-service.js#L34-L37)                                                                         |
| 日期键   | **北京时间**(UTC+8)日期 `YYYY-MM-DD`(`CHINA_OFFSET_MS = 8h`)                                                    | [checkin-service.js:9](../../../../src/bilibili/checkin-service.js#L9)、[checkin-service.js:69-72](../../../../src/bilibili/checkin-service.js#L69-L72) |
| 累计     | `total_days` 按天累加,同日重复签到不加天数、标记 `alreadyCheckedToday`(库表见 [storage.md](../storage.md) §3.5) | [checkin-store.js:40-41](../../../../src/storage/checkin-store.js#L40-L41)                                                                              |
| 回复     | `今天已经签到过啦，已累计 N 天。` / `已签到 N 天。` + 祝福语                                                    | [checkin-service.js:61-67](../../../../src/bilibili/checkin-service.js#L61-L67)                                                                         |

祝福语池 `CHECKIN_BLESSINGS` 共 **30 句**([checkin-blessings.js:5-36](../../../../src/bilibili/checkin-blessings.js#L5-L36));`checkinBlessings` 设置可覆盖(JSON 数组,无效时回退内置池),每次**随机**取一句([checkin-blessings.js:38-59](../../../../src/bilibili/checkin-blessings.js#L38-L59))。

### 6.2 抽签(fortune-service)

| 事实     | 值                                                                           | 出处                                                                                |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 命令     | 精确 `抽签`(`FORTUNE_COMMAND`)                                               | [fortune-service.js:8](../../../../src/bilibili/fortune-service.js#L8)              |
| 开关     | `enableFortuneBot === 'true'`                                                | [fortune-service.js:46-49](../../../../src/bilibili/fortune-service.js#L46-L49)     |
| 签池     | `FORTUNES` 内置 **20 签**(上上/上吉/中吉/小吉/平)                            | [fortune-service.js:10-31](../../../../src/bilibili/fortune-service.js#L10-L31)     |
| 抽签规则 | **确定性**:FNV-1a 哈希 `dateKey:uid` 对签池取模 —— 同一观众当天同签,跨天变化 | [fortune-service.js:93-106](../../../../src/bilibili/fortune-service.js#L93-L106)   |
| 回复     | `{level}·{name}｜{text}。{advice}。`                                         | [fortune-service.js:108-110](../../../../src/bilibili/fortune-service.js#L108-L110) |

`fortunePool` 设置可覆盖签池(每项须含 level/name/text/advice,[fortune-service.js:73-91](../../../../src/bilibili/fortune-service.js#L73-L91))。

### 6.3 自定义回复(custom-reply-service)

| 事实     | 值                                                                                        | 出处                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 开关     | `enableCustomReplyBot === 'true'`,否则不匹配                                              | [custom-reply-service.js:47](../../../../src/bilibili/custom-reply-service.js#L47)        |
| 匹配     | 消息小写后 `includes(rule.keyword 小写)`,`enabled !== false`;命中即回复(**无需点歌前缀**) | [custom-reply-service.js:45-53](../../../../src/bilibili/custom-reply-service.js#L45-L53) |
| 规则上限 | `MAX_CUSTOM_REPLY_RULES = 30`                                                             | [custom-reply-service.js:7](../../../../src/bilibili/custom-reply-service.js#L7)          |
| 字段上限 | 关键词 `30` 字符、回复 `120` 字符(`truncateText`)                                         | [custom-reply-service.js:8-9](../../../../src/bilibili/custom-reply-service.js#L8-L9)     |

`customReplyRules` 设置为规则数组;`isCommandText(message)` 暴露给入口识别([custom-reply-service.js:39-42](../../../../src/bilibili/custom-reply-service.js#L39-L42)),使自定义关键词也能参与去重窗口。

## 10. 用户信息门面与房间运行边界

`UserInfoService`([user-info-service.js](../../../../src/bilibili/users/user-info-service.js)) 是 Bilibili 用户资料和当前房间身份的唯一 merge policy owner。解析器只产生 `IdentityHint`；`MessageHandlers`、History/OnlineRank/FansMedal poller 通过注入的 `ingestHint`/`replaceOnlineSnapshot` sink 提交，poller 不访问 `IdentityCache`、profile provider 或 Avatar Proxy。

门面公开 `peek`、`ingestHint`、`ensure`、`listRecent`、`listOnline`、`replaceOnlineSnapshot`、`subscribe`、`setRoom`、`beginRoomRun`、`endRoomRun`、`dispose`。`name`/`avatarUrl` 是 UID 全局 profile，`guard`/`fansMedal` 是 `{roomId, ownerUid}` 房间身份；字段投影只返回请求字段和 `uid`，不泄露 evidence、source、generation 或 runToken。粉丝牌非空值必须携带匹配主播 UID，verified absence 与 unknown 分离。

组合根在一次房间 runtime 启动或协调重连时只调用一次 `beginRoomRun()`，把同一个不可变 context 传给三个 poller；单 poller 重启仅使用自己的 local generation。`setRoom()` 递增 room generation 并清除旧 room identity/audience index，A→B→A 的旧 context 仍失效；同房协调重连轮换 runToken 并在下一次在线榜成功前保持空 online snapshot。结束整组 producer 时调用 `endRoomRun()`，共享 service 只在 runtime dispose 时销毁。

头像流程是显式的：消息先 ingest 自带可信头像；画猜等业务在确实需要且缺失时调用 `ensure()`，provider 以 `profile:${uid}` 合并在途请求并对失败做 30 秒负缓存。`onMessage()` 返回值没有头像触发语义，renderer 仍只通过现有 `/api/bilibili/avatar` 代理获取图片。

### 6.4 回复目标(mention-policy + requester-target-store)

- `normalizeMentionTarget(input)`([mention-policy.js:5-10](../../../../src/bilibili/danmaku/mention-policy.js#L5-L10)):uid 须为 1-20 位数字,名字截断 80 字符;`buildMentionedMessage` 拼 `@名字 ` 前缀([mention-policy.js:12-22](../../../../src/bilibili/danmaku/mention-policy.js#L12-L22))。
- 提及目标来源 `requesterTargets.getLatestRandomRequester()`([requester-target-store.js:7-24](../../../../src/music/requester-target-store.js#L7-L24)):取 `requests` 表中最新一条 `random`/`random:%` 来源、有 uid 或名字的记录(requests 行由 queue-service 写入,见 [services.md](../music/services.md));`sendDanmaku` 中的 `reply_mid` 校验复用它([api-client.js:111-113](../../../../src/bilibili/danmaku/api-client.js#L111-L113))。

## 7. danmakuSender 发送服务

`createDanmakuSenderService(dependencies)`([sender-service.js:8-148](../../../../src/bilibili/danmaku/sender-service.js#L8-L148)),server.js 装配时注入 `getMentionTarget = requesterTargets.getLatestRandomRequester` 与四个机器人开关读取([server.js:226-231](../../../../src/server.js#L226-L231))。

| 事实         | 值                                                                                                                                                                  | 出处                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单条弹幕上限 | `DANMAKU_MESSAGE_LIMIT = 40` 字符(按 grapheme 切分)，由 `danmaku/contract.js` 统一提供给发送器与 AI 回复预算                                                        | [contract.js](../../../../src/bilibili/danmaku/contract.js)                                                                                                               |
| 限速         | `minIntervalMs = 1500`(可注入);未到间隔再发:默认抛 `发送过于频繁`;`waitForRateLimit=true` 时等待                                                                    | [sender-service.js:19](../../../../src/bilibili/danmaku/sender-service.js#L19)、[sender-service.js:110-113](../../../../src/bilibili/danmaku/sender-service.js#L110-L113) |
| 切分         | 超长按 40 字符切块;有提及目标时首块预留 `@名字 ` 长度;`mentionEveryChunk` 每块都提及;块间可选 `intervalMs` 间隔;自然断句优先(标点 `。！？!?；;，,、～~` 与括号表情) | [sender-service.js:163-219](../../../../src/bilibili/danmaku/sender-service.js#L163-L219)                                                                                 |
| 显示名缓存   | 账号名/房间名 `DISPLAY_CACHE_TTL_MS = 10min`                                                                                                                        | [sender-service.js:6](../../../../src/bilibili/danmaku/sender-service.js#L6)、[sender-service.js:64-99](../../../../src/bilibili/danmaku/sender-service.js#L64-L99)       |
| 状态         | `getState()` 返回 `loggedIn/accountUid/roomId/roomName/connected/canSend/requester/各机器人开关` 等                                                                 | [sender-service.js:30-53](../../../../src/bilibili/danmaku/sender-service.js#L30-L53)                                                                                     |

**自动回复路径**(server.js `onMessage` 内,全部 `void danmakuSender.send({message, mentionTarget})`):

| 回复                      | 触发                                                   | 出处                                                     |
| ------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `result.autoReply`        | 随机点歌无匹配且 `enableRandomTagReply==='true'`(§5.3) | [server.js:632-639](../../../../src/server.js#L632-L639) |
| `result.checkinReply`     | 签到命令接受后                                         | [server.js:640-647](../../../../src/server.js#L640-L647) |
| `result.fortuneReply`     | 抽签命令接受后                                         | [server.js:648-655](../../../../src/server.js#L648-L655) |
| `result.customReplyReply` | 自定义关键词命中                                       | [server.js:656-663](../../../../src/server.js#L656-L663) |

另有一条独立发送通道:AI 互动助手回复经 `aiAssistant` 走 `danmakuSender.send({waitForRateLimit: true})`([server.js:260-261](../../../../src/server.js#L260-L261)),见 [ai.md](../ai.md)。

## 8. 诊断快照与调试缓冲

- `bilibiliDiagnostics` 对象([danmaku-client.js:408-419](../../../../src/bilibili/danmaku-client.js#L408-L419))由管道各环节填充:`lastPacketAt`(handlePackets)、`lastCommandAt/recentCommands`(`recordBilibiliCommandDiagnostic`,[helpers.js:23-30](../../../../src/bilibili/helpers.js#L23-L30))、`lastGiftAt/parsedGiftCount/unparsedGiftCount/recentGiftLikeCommands`(`recordBilibiliGiftDiagnostic`,[helpers.js:32-37](../../../../src/bilibili/helpers.js#L32-L37));经 WS 快照 `bilibiliDiagnostics` 字段下发(见 [ws.md](../ws.md) §2)。
- 内部礼物诊断环形缓冲 `createMessageBuffer(500)` 由 Bilibili runtime 持有；实现默认容量 300、单条 data 截断 2000 字符([message-buffer.js:8-9](../../../../src/bilibili/diagnostics/message-buffer.js#L8-L9)),分类 `parsed-ok / parse-failed / unrecognized-cmd / raw-packet`。正式运行时不通过 HTTP API 或静态调试页面暴露该原始缓冲。

## 9. 关键常数速查

| 参数                      | 值                               | 出处                                                                                                                                                             |
| ------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 历史轮询间隔              | 2.5s                             | [history-poller.js:30](../../../../src/bilibili/danmaku/history-poller.js#L30)                                                                                   |
| 高能榜轮询                | 60s × 50/页 × 3 页               | [online-rank-poller.js:9-11](../../../../src/bilibili/danmaku/online-rank-poller.js#L9-L11)                                                                      |
| 全量粉丝牌轮询            | 5min × 30/页 × 最多 10000 页     | [fans-medal-poller.js:8-11](../../../../src/bilibili/danmaku/fans-medal-poller.js#L8-L11)                                                                        |
| 开播检测                  | 10min(unref)                     | [live-status-monitor.js:5](../../../../src/bilibili/danmaku/live-status-monitor.js#L5)                                                                           |
| 身份缓存 TTL / 清理       | 10min / 5min                     | [identity-cache.js:7](../../../../src/bilibili/danmaku/identity-cache.js#L7)、[message-handlers.js:31](../../../../src/bilibili/danmaku/message-handlers.js#L31) |
| 去重:跨源窗 / 保留 / 上限 | 1.5s / 30min / 1000→500          | [message-deduplicator.js:8-10](../../../../src/bilibili/danmaku/message-deduplicator.js#L8-L10)                                                                  |
| 重连延迟                  | 首次 0ms,其后 5000ms 固定        | [danmaku-client.js:250](../../../../src/bilibili/danmaku-client.js#L250)、[danmaku-client.js:374](../../../../src/bilibili/danmaku-client.js#L374)               |
| 可捕获窗口                | 启动前 5s ~ 30min 前 ~ 未来 5min | [helpers.js:41-50](../../../../src/bilibili/helpers.js#L41-L50)                                                                                                  |
| 发送限速 / 单条上限       | 1.5s / 40 字符                   | [sender-service.js:19](../../../../src/bilibili/danmaku/sender-service.js#L19)、[sender-service.js:5](../../../../src/bilibili/danmaku/sender-service.js#L5)     |
| 签到/抽签日期             | 北京时间 UTC+8                   | [checkin-service.js:9](../../../../src/bilibili/checkin-service.js#L9)                                                                                           |
| 自定义回复上限            | 30 条 / 关键词 30 / 文本 120     | [custom-reply-service.js:7-9](../../../../src/bilibili/custom-reply-service.js#L7-L9)                                                                            |
