# 后端 WebSocket 传输与快照契约

> 涉及文件:[src/server/ws.js](../../../src/server/ws.js)、[src/server.js](../../../src/server.js)(getState/广播点)

本文档是 WebSocket 的**唯一事实源**:传输层实现、快照 17 字段、全部消息类型与广播原因只在此成表。客户端消费语义见 [frontend/comms.md](../frontend/comms.md),各字段的领域细节链接到对应行为文档。

## 1. 传输层(手写 RFC 6455)

礼物身份扩展沿用既有消息封套：`state.overtime.rules` 和加班机更新中的规则携带 `giftIdentity`、`bindingStatus`；目录更新携带完整身份及 schema 3 关系。最近礼物原始行保留 `gift_variant_id` / `blind_box_variant_id`，供界面取对应图片，不通过当前 ID 回填历史。字段与迁移语义见 [加班机契约](overtime.md) 及 [礼物身份规范](../../../specs/gift-identity-overtime.md)。

零依赖实现,[src/server/ws.js](../../../src/server/ws.js) 的 `createWebSocketHub()`。

| 事实                 | 值                                                                                                                                                                                     | 出处                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 连接路径             | `/ws`,升级请求经 `server.on('upgrade')` 分发(其他路径直接 destroy)；固定弹幕层额外传 `topic=danmaku`                                                                                   | [server.js:285-292](../../../src/server.js#L285-L292) |
| 握手                 | `Sec-WebSocket-Key` + 魔数 `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` 做 SHA1 → Base64 `Sec-WebSocket-Accept`                                                                              | [ws.js:38-48](../../../src/server/ws.js#L38-L48)      |
| **Origin 验证**(H06) | **检查 `req.headers.origin` 是否在 `context.allowedOrigins` 白名单内。无 Origin 头(非浏览器客户端)放行。不匹配回写 `403 Forbidden` 后销毁连接**                                        | [ws.js:21-29](../../../src/server/ws.js#L21-L29)      |
| 鉴权                 | `?token=` 查询参数必须等于会话令牌,否则回写 `401 Unauthorized` 后销毁连接                                                                                                              | [ws.js:31-39](../../../src/server/ws.js#L31-L39)      |
| 帧上限               | 单帧 `MAX_FRAME_BYTES = 256 KB`,跨分片消息 `MAX_MESSAGE_BYTES = 256 KB`,超限回 close code 1009                                                                                         | [ws.js:8-9](../../../src/server/ws.js#L8-L9)          |
| 待发送上限           | 每个 socket 的 Node 待发送字节数 + 新帧不得超过 `MAX_PENDING_BYTES = 2 MB`；超过时立即销毁并清理该慢客户端，由客户端重连后通过 snapshot 恢复                                           | [ws.js](../../../src/server/ws.js)                    |
| 心跳                 | 每 `HEARTBEAT_INTERVAL_MS = 30000` 发一次 ping;超过 `SOCKET_TIMEOUT_MS = 90000` 未收到 pong 则销毁连接;心跳定时器 `unref()`                                                            | [ws.js:10-11](../../../src/server/ws.js#L10-L11)      |
| 客户端消息           | **服务端不消费任何客户端消息**:文本/二进制帧与分片会被正确解析/重组(防止内存泄漏)后丢弃;close 帧回显后关闭;ping 回 pong                                                                | [ws.js:143-193](../../../src/server/ws.js#L143-L193)  |
| 发送                 | 服务端→客户端全部为文本帧(JSON),长度按 <126 / <65536 / 64 位三档编码；普通 `broadcast(payload)` 发给全部 socket，`broadcast(payload,{topic})` 只发给握手查询参数订阅该 topic 的 socket | [ws.js](../../../src/server/ws.js)                    |
| 停止                 | `webSocketHub.stop({shutdownPayload})` 首次调用停止新升级和心跳，依次发送 shutdown、Close(1001)、FIN；仍未物理关闭的 socket 在 1 秒期限后销毁，重复 stop 不续期或重复发送 | [ws.js](../../../src/server/ws.js) |

入站帧按 [RFC 6455 §5](https://www.rfc-editor.org/rfc/rfc6455.html#section-5) 校验：客户端必须掩码，未协商扩展时 RSV 必须为零；保留 opcode、非最短长度编码、非法分片顺序、被分片或超过 125 字节的控制帧以 1002 关闭。文本消息在完整重组后验证 UTF-8（允许字符跨分片），非法文本或 close reason 使用 1007；帧/消息超限使用 1009。合法 Close 载荷回显，非法/保留状态码不回显。服务端仍不执行业务客户端消息。

所有 Close 路径立即移出广播集合并释放输入缓冲，但 hub 保留关闭期限直到物理 `close`；正常关闭取消计时器，超时销毁，写入失败/背压则立即销毁。`closeAllConnections()` 不拥有 HTTP 升级后的连接，不能代替这项回收责任。关闭期限不延长 Electron 的总退出期限；测试可用 `closeTimeoutMs` 缩短等待。

文件底部另有一套模块级兼容导出(`handleWebSocketUpgrade`/`broadcastSnapshot` 走模块级 `compatibilityHub`),运行时不使用。

**WebSocket Context**:升级时传入的 `context` 对象包含 `getState`、`sessionToken` 和 **`allowedOrigins`**(当前仅运行时 baseUrl)。`getWebSocketContext()` 在 [server.js](../../../src/server.js) 中构造。

升级入口的 Host 校验由 [http-server.js](../../../src/server/http-server.js) 拥有：ready 阶段必须精确匹配运行时绑定的 host:port，否则在进入 hub 前返回 400。正确 Host 不豁免许可、Origin 或 token 校验；缺少 Origin 的非浏览器客户端也必须匹配 Host。starting/quiescing 阶段仍返回 503。

尚未交给 hub 的拒绝升级由 HTTP 入口收尾：400/423/503 响应写出后销毁 socket，不等待对方回 FIN。它们不属于 hub 的升级连接集合，不能依赖 hub.stop() 兜底。

## 2. 快照(Snapshot)17 字段

每次连接建立时发送 `{type:'snapshot', reason:'connect', state}`,之后快照域的业务变更触发全量快照重推；游戏、转盘等独立状态沿 §3 的专用消息与 HTTP 恢复接口传输。`state` 由 [server.js](../../../src/server.js) 的 `getState()` 组装,共 **17 个字段**:

`topic=danmaku` 仅选择高频 `danmaku:message` 增量，不改变全量 snapshot 的接收范围，也不是权限凭据。普通连接和订阅连接均接收初始及后续快照，以恢复各自消费的队列、设置、直播状态等字段；不能按是否订阅弹幕来过滤通用快照。真实 hub/客户端契约验证见 `test/websocket-snapshot-contract.test.js`。

| 字段                  | 生产者                                     | 内容概述                                                                                                          |
| --------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `queue`               | `domainServices.queue.getSnapshot()`       | 点歌队列快照,见 [music/services.md](music/services.md)                                                            |
| `superChats`          | `domainServices.superChats.getSnapshot()`  | SC 列表(按价格降序),见 [bilibili/gift.md](bilibili/gift.md)                                                       |
| `gifts`               | `domainServices.gifts.getSnapshot()`       | `recent` 近期礼物列表与 `viewRevision` 来源投影版本（未就绪时 null）；版本变化使流水选择与本日展示失效 |
| `giftSprint`          | `domainServices.gifts.getSprintSnapshot()` | 礼物冲刺状态                                                                                                      |
| `giftDetection`       | `domainServices.gifts.getStatus()`         | 礼物检测管道状态(`coreActive` 等),见 [bilibili/gift.md](bilibili/gift.md)                                         |
| `blindBoxMapping` | `blindBoxMappingState` | 当前盲盒映射配置与同步状态 |
| `overtime`            | `domainServices.overtime.getSnapshot()`    | 加班机状态,见 [overtime.md](overtime.md)                                                                          |
| `settings`            | `settingsStore.getSettings()`              | 全部设置键值,见 [storage.md](storage.md)                                                                          |
| `categories`          | `domainServices.songs.listCategories()`    | 歌曲分类                                                                                                          |
| `tags`                | `domainServices.songs.listTags()`          | 歌曲标签                                                                                                          |
| `songCount`           | `domainServices.songs.count()`             | 曲库歌曲总数                                                                                                      |
| `liveStatus`          | `liveStatus` 对象                          | 直播间连接状态(`connected/enabled/roomId/mode/message/updatedAt`)                                                 |
| `bilibiliDiagnostics` | `bilibiliDiagnostics` 对象                 | Bilibili 诊断信息(最近包/命令/礼物时间戳、解析计数等),见 [bilibili/danmaku.md](bilibili/danmaku.md)               |
| `lyricState`          | `lyricState` 对象                          | 当前歌词行状态(单行),见 [music/services.md](music/services.md)                                                    |
| `lyricTimeline`       | `lyricTimeline` 对象                       | 歌词时间轴(全曲),经 `normalizeLyricTimeline` 归一化                                                               |
| `weSing`              | `weSingCapture.getStatus()`                | 全民K歌采集状态,见 [music/wesing.md](music/wesing.md)                                                             |
| `danmakuFeed`         | `danmakuFeedBuffer.getSnapshot()`          | 当前直播间最近 50 条弹幕和已结算礼物提示的公开投影，含可选 B 站表情或礼物字段，见 [bilibili/danmaku.md](bilibili/danmaku.md) §4.1 |

快照全量替换语义与客户端指纹去重见 [frontend/comms.md](../frontend/comms.md)。

## 3. 消息类型全集(唯一成表处)

| 类型                  | 载荷                                                                                                                 | 触发点                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `snapshot`            | `{type, reason, state}`(17 字段全量)                                                                                 | 连接建立(`reason:'connect'`);业务变更广播                                                                                                                                                                                                                                                                                                                          |
| `danmaku:message`     | `{type:'danmaku:message', item}`                                                                                     | 实时 B 站弹幕及已结算的礼物提示（公开字段见 [bilibili/danmaku.md](bilibili/danmaku.md) §4.1）；仅投递给以 `topic=danmaku` 连接的固定 `/danmaku` 浏览器源，重连后由 snapshot 中的 `danmakuFeed` 恢复                                                                                                                                                                                                                      |
| `gift:frame` | `{type,eventId,giftEventId,giftId,giftName,num,totalPriceCents,userName,themeId}`；预览另含 `preview/previewSessionId/motionMode` | final 礼物达到边框配置阈值时广播，或管理页显式预览；由 `gift/frame-config.js` 生成，金额单位为人民币分 |
| `lyric-state`         | `{type:'lyric-state', state}`;state 兼容携带单调 `generation`/`sequence`                                             | 播放页歌词上报([server.js:348](../../../src/server.js#L348))、WeSing 采集状态变化([server.js:187](../../../src/server.js#L187))                                                                                                                                                                                                                                    |
| `lyric-timeline`      | `{type:'lyric-timeline', timeline}`                                                                                  | 播放页歌词时间轴上报、WeSing 时间轴([server.js:163](../../../src/server.js#L163))                                                                                                                                                                                                                                                                                  |
| `wesing-state`        | `{type:'wesing-state', state}`                                                                                       | WeSing 采集状态变化([server.js:184](../../../src/server.js#L184))                                                                                                                                                                                                                                                                                                  |
| `overtime:update`     | `{type, reason, state, adjustment?}`                                                                                 | 加班机状态变更([server.js:148-153](../../../src/server.js#L148-L153)),`adjustment` 仅礼物结算时携带                                                                                                                                                                                                                                                                |
| `gift-catalog:update` | `{type:'gift-catalog:update', snapshot}`；`snapshot` 包含付费全局目录、`version`、`stale`、来源时间、本地 `imagePath` 及 `assetsUpdatedAt`（ISO 字符串或空） | 本地图片扫描完成后广播；目录元数据变化及同版本缺图修复均可触发。Admin 去重包含图片 ID/路径和资源时间，按 ID 更新图片，不替换当前直播间成员，不改变礼物事件或规则结算 |
| `shutdown`            | `{type:'shutdown', reason:'manual'}`                                                                                 | 服务关闭前(`webSocketHub.stop` 的 `shutdownPayload`,见 §1)                                                                                                                                                                                                                                                                                                         |
| `game:update`         | `{type:'game:update', session}`                                                                                      | 小游戏会话开始、停止、落子、弹幕答对或画猜回合变化；Admin 与固定 `/games` 浏览器源消费，浏览器源按 `session.game` 切换画面；画猜公开状态不含题词或别名，且在答案公布前 `revealedAnswer` 为空；活动会话附带本局弹幕流，消息项为有界的 `{uid,name,message,avatarUrl,guardLevel,medalName,medalLevel,timestamp}`，其中大航海等级限定为 `0..3`、灯牌为当前房间公开身份 |
| `game:draw`           | `{type:'game:draw', operation, revision}`                                                                            | 你画我猜已经校验的增量笔画、清空或撤销操作；撤销操作带服务端决定的 `strokeId`。所有 `/games` 实例消费，发起页仅忽略已乐观应用的自有笔画/清空回声；自有撤销仍应用服务端决定的 `strokeId`，刷新/重连通过 `GET /api/games/session` 的完整画布恢复                                                                                                                                                         |
| `wheel:update`        | `{type:'wheel:update', state}`                                                                                       | 独立转盘配置或抽取状态变更；管理页与 `/wheel` 透明浏览器源消费，不受 `game:update` 会话互斥影响                                                                                                                                                                                                                                                                    |

### 3.1 `snapshot` 的 reason 枚举

| reason               | 触发点                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `connect`            | 新连接建立                                                                                   |
| `bilibili:danmaku`   | 弹幕点歌命令被接受([server.js:665](../../../src/server.js#L665))                             |
| `bilibili:superchat` | SC 入账([server.js:686](../../../src/server.js#L686))                                        |
| `bilibili:gift`      | 礼物事件落库 flush(经 `onGiftFlushed`,[server.js:102-105](../../../src/server.js#L102-L105)) |
| `live:status`        | 直播间状态变化(`updateLiveStatus`,[server.js:720](../../../src/server.js#L720))              |

### 3.2 `overtime:update` 的 reason 枚举

| reason     | 含义                                   | 出处                                                                      |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `gift`     | 礼物结算推时                           | [overtime-service.js:187](../../../src/overtime/overtime-service.js#L187) |
| `manual`   | 手动操作(开始/暂停/重置/加减时间/开关) | overtime-service.js `commit('manual')` 多处                               |
| `config`   | 背景等配置变更                         | overtime-service.js:134                                                   |
| `rules`    | 规则集替换                             | overtime-service.js:142                                                   |
| `finished` | 倒计时归零                             | overtime-service.js:377                                                   |

详见 [overtime.md](overtime.md)。
