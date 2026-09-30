# 后端 WebSocket 传输与快照契约

> 涉及文件:[src/server/ws.js](../../../src/server/ws.js)、[src/server.js](../../../src/server.js)(getState/广播点)

本文档是 WebSocket 的**唯一事实源**:传输层实现、快照 17 字段、全部消息类型与广播原因只在此成表。客户端消费语义见 [frontend/comms.md](../frontend/comms.md),各字段的领域细节链接到对应行为文档。

## 1. 传输层(手写 RFC 6455)

Admin 完整消息的礼物身份扩展沿用既有封套；overlay 仅接收下文允许的展示字段。`state.overtime.rules` 和加班机更新中的完整规则携带 `giftIdentity`、`bindingStatus`；目录更新携带完整身份及 schema 3 关系。最近礼物原始行保留 `gift_variant_id` / `blind_box_variant_id`，供界面取对应图片，不通过当前 ID 回填历史。字段与迁移语义见 [加班机契约](overtime.md) 及 [礼物身份规范](../../../specs/gift-identity-overtime.md)。

零依赖实现,[src/server/ws.js](../../../src/server/ws.js) 的 `createWebSocketHub()`。

| 事实                 | 值                                                                                                                                                                                     | 出处                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 连接路径             | `/ws`,升级请求经 `server.on('upgrade')` 分发(其他路径直接 destroy)；固定弹幕层额外传 `topic=danmaku`                                                                                   | [server.js:285-292](../../../src/server.js#L285-L292) |
| 握手                 | `Sec-WebSocket-Key` + 魔数 `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` 做 SHA1 → Base64 `Sec-WebSocket-Accept`                                                                              | [ws.js:38-48](../../../src/server/ws.js#L38-L48)      |
| **Origin 验证**(H06) | 先验证凭据，再检查 Origin。普通 Origin 必须精确匹配 `context.allowedOrigins`；只有已验证 overlay 额外允许沙箱页面的字面 `null`，Admin 明确拒绝 `null`。已认证的无 Origin 非浏览器客户端保留支持；不匹配返回 403 后销毁连接 | [ws.js](../../../src/server/ws.js) |
| 鉴权 | 与 HTTP 共用 `resolveRequestPrincipal(context, req, requestUrl)`：Bearer 优先于 `?token=`，显式无效 Authorization 不回退。运行时管理凭据解析为 Admin，服务器签名的页面凭据解析为 overlay(scope)；空运行时密钥或无效凭据返回 401 | [access-policy.js](../../../src/server/access-policy.js) |
| 帧上限               | 单帧 `MAX_FRAME_BYTES = 256 KB`,跨分片消息 `MAX_MESSAGE_BYTES = 256 KB`,超限回 close code 1009                                                                                         | [ws.js:8-9](../../../src/server/ws.js#L8-L9)          |
| 待发送上限           | 每个 socket 的 Node 待发送字节数 + 新帧不得超过 `MAX_PENDING_BYTES = 2 MB`；超过时立即销毁并清理该慢客户端，由客户端重连后通过 snapshot 恢复                                           | [ws.js](../../../src/server/ws.js)                    |
| 心跳                 | 每 `HEARTBEAT_INTERVAL_MS = 30000` 发一次 ping;以 `performance.now()` 单调历时判断，超过 `SOCKET_TIMEOUT_MS = 90000` 未收到 pong 则销毁连接;心跳定时器 `unref()` | [ws.js](../../../src/server/ws.js) |
| 客户端消息 | 服务端不执行业务客户端消息。Admin 文本/二进制消息校验重组后丢弃；overlay 业务数据帧（包括 clear-history、控制消息和分片起始帧）使用 Close(1008) 拒绝。两类连接均允许协议 ping/pong/close | [ws.js](../../../src/server/ws.js) |
| 发送 | 服务端业务消息为 JSON 文本帧；连接初始、合并快照、普通/主题广播、shutdown 和兼容导出均经统一 `sendWebSocket` 按 socket principal 投影。被 scope 禁止的消息跳过；topic 只增加订阅条件，不扩大权限 | [ws.js](../../../src/server/ws.js)、[overlay-projection.js](../../../src/server/overlay-projection.js) |
| 停止                 | `webSocketHub.stop({shutdownPayload})` 首次调用停止新升级和心跳，依次发送 shutdown、Close(1001)、FIN；仍未物理关闭的 socket 在 1 秒期限后销毁，重复 stop 不续期或重复发送 | [ws.js](../../../src/server/ws.js) |

入站帧按 [RFC 6455 §5](https://www.rfc-editor.org/rfc/rfc6455.html#section-5) 校验：客户端必须掩码，未协商扩展时 RSV 必须为零；保留 opcode、非最短长度编码、非法分片顺序、被分片或超过 125 字节的控制帧以 1002 关闭。Admin 分片文本使用严格增量 UTF-8 校验（允许字符跨分片，并在 FIN 检查未完成字符），不保留已校验的消息正文；非法文本或两类连接的 close reason 使用 1007；帧/消息超限使用 1009。合法 Close 载荷回显，非法/保留状态码不回显。服务端仍不执行业务客户端消息。

HTTP upgrade 的 `head` 在鉴权及握手成功后进入同一帧解析器，恰好处理一次。TCP 未完整帧的缓冲按几何容量增长，已消费的前缀在需要追加时压实；单字节网络分块和 WebSocket continuation 不再重复拷贝整个累积正文。回归和加速生命周期证据见 `test/transport/websocket-upgrade-head.test.js`、`test/transport/websocket-resource-bounds.test.js`。

所有 Close 路径立即移出广播集合并释放输入缓冲，但 hub 保留关闭期限直到物理 `close`；正常关闭取消计时器，超时销毁，写入失败/背压则立即销毁。`closeAllConnections()` 不拥有 HTTP 升级后的连接，不能代替这项回收责任。关闭期限不延长 Electron 的总退出期限；测试可用 `closeTimeoutMs` 缩短等待。

文件底部另有一套模块级兼容导出(`handleWebSocketUpgrade`/`broadcastSnapshot` 走模块级 `compatibilityHub`),运行时不使用。

**WebSocket Context**:升级时传入的 `context` 对象包含 `getState`、`sessionToken` 和 **`allowedOrigins`**(当前仅运行时 baseUrl)。`getWebSocketContext()` 在 [runtime-transport.js](../../../src/server/runtime-transport.js) 中构造。每个已升级 socket 保存服务器验证并冻结的 `_wsPrincipal`，关闭清理时移除；客户端 query、消息体或 topic 不能声明或替换身份。

升级入口的 Host 校验由 [http-server.js](../../../src/server/http-server.js) 拥有：ready 阶段必须精确匹配运行时绑定的 host:port，否则在进入 hub 前返回 400。正确 Host 不豁免许可、Origin 或 token 校验；缺少 Origin 的非浏览器客户端也必须匹配 Host。starting/quiescing 阶段仍返回 503。

尚未交给 hub 的拒绝升级由 HTTP 入口收尾：400/423/503 响应写出后销毁 socket，不等待对方回 FIN。它们不属于 hub 的升级连接集合，不能依赖 hub.stop() 兜底。

## 2. 快照(Snapshot)17 字段

每次连接建立时发送 `{type:'snapshot', reason:'connect', state}`，之后快照域的业务变更触发当前 principal 的完整投影重推；游戏、转盘等独立状态沿 §3 的专用消息与 HTTP 恢复接口传输。Admin 的 `state` 由 [server.js](../../../src/server.js) 的 `getState()` 组装，共 **17 个字段**；overlay 不接收这个完整对象：

`topic=danmaku` 仅选择高频 `danmaku:message` 增量，不改变同一 principal 的 snapshot 投影，也不是权限凭据。Admin 与 danmaku scope 可订阅该增量；其他 overlay 即使带该 topic 也不能接收。所有 scope 均接收初始及后续最小 snapshot 封套，无全局快照字段需求的页面收到空 `state`。真实连接契约见 `test/transport/websocket-snapshot-contract.test.js` 和 `test/transport/websocket-access-policy.test.js`。

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

### 2.1 Overlay scope 投影

页面凭据由运行时密钥和固定 scope 签名派生；修改 scope 或更换运行时密钥后无法验证。匿名页面 HTML 仅获得该页的凭据，不能获得管理令牌。所有嵌套 DTO 与设置键使用 [overlay-projection.js](../../../src/server/overlay-projection.js) 的显式白名单，不展开整个设置对象或未来新增字段。REST 页面权限见 [API 契约](api.md)。

| Scope | snapshot 展示字段 | 允许的专用增量 |
| --- | --- | --- |
| `queue` | 展示设置、队列歌曲/点歌者展示字段、SC 文本和价格 | 无 |
| `songlist`、`blindbox` | 各自展示设置 | 无 |
| `overtime` | 倒计时、背景与展示规则 | `overtime:update` |
| `gift-effects` | 礼物特效/边框展示设置 | `gift:frame`、`gift:effect` |
| `gift-feed` | `gifts.viewRevision` | `gift-catalog:update` 仅保留 type，作为刷新通知 |
| `gift-wishes` | `gifts.viewRevision` | 无专用事件；`gift:wishes` 快照 reason 通知重新读取整数进度 |
| `lyrics` | 歌词展示设置、`lyricState`、`lyricTimeline` | `lyric-state`、`lyric-timeline` |
| `danmaku` | 弹幕展示设置、公开直播连接状态、`danmakuFeed` | `danmaku:message`，另需 topic 订阅 |
| `games` | 当前全局快照无游戏字段；兼容专用 `games` 字段时仍投影公开会话 | `game:update`、`game:patch`、`game:draw`；不含未公布答案 |
| `wheel` | 空 state | `wheel:update` |
| `clock` | 八个 `clock*` 展示设置键；不含其他业务字段 | 无；通过 settings 快照更新 |
| `gift-export`、`opening` | 空 state | 无 |

全部已知 overlay scope 允许 `{type:'shutdown', reason}`；未列出的专用消息默认不投递。Admin 保持完整消息能力，包括 `wesing-state` 和完整目录更新。scope 对初始与后续广播始终相同，不能通过连接重建、topic、兼容发送函数或伪造业务入站消息升级。

## 3. 消息类型全集(唯一成表处)

| 类型                  | 载荷                                                                                                                 | 触发点                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `snapshot`            | `{type, reason, state}`（Admin 完整状态；overlay 按 §2.1 投影）                                                                                 | 连接建立(`reason:'connect'`);业务变更广播                                                                                                                                                                                                                                                                                                                          |
| `danmaku:message`     | `{type:'danmaku:message', item}`                                                                                     | 实时 B 站弹幕及已结算的礼物提示（公开字段见 [bilibili/danmaku.md](bilibili/danmaku.md) §4.1）；仅投递给订阅 `topic=danmaku` 的 Admin 或 danmaku scope，重连后由 snapshot 中的 `danmakuFeed` 恢复                                                                                                                                                                                                                      |
| `gift:frame` | `{type,eventId,giftEventId,giftId,giftName,num,totalPriceCents,userName,themeId}`；预览另含 `preview/previewSessionId/motionMode` | final 礼物达到边框配置阈值时广播，或管理页显式预览；由 `gift/frame-config.js` 生成，金额单位为人民币分 |
| `gift:effect` | `{type,source,eventId,giftId,effect}`；effect 为播放素材和布局展示 DTO | 礼物特效发布；仅 Admin 与 gift-effects scope 接收 |
| `lyric-state`         | `{type:'lyric-state', state}`;state 兼容携带单调 `generation`/`sequence`                                             | 播放页歌词上报([server.js:348](../../../src/server.js#L348))、WeSing 采集状态变化([server.js:187](../../../src/server.js#L187))                                                                                                                                                                                                                                    |
| `lyric-timeline`      | `{type:'lyric-timeline', timeline}`                                                                                  | 播放页歌词时间轴上报、WeSing 时间轴([server.js:163](../../../src/server.js#L163))                                                                                                                                                                                                                                                                                  |
| `wesing-state`        | `{type:'wesing-state', state}`                                                                                       | WeSing 采集状态变化([server.js:184](../../../src/server.js#L184))                                                                                                                                                                                                                                                                                                  |
| `overtime:update`     | `{type, reason, state, adjustment?}`                                                                                 | 加班机状态变更([server.js:148-153](../../../src/server.js#L148-L153)),`adjustment` 仅礼物结算时携带                                                                                                                                                                                                                                                                |
| `gift-catalog:update` | `{type:'gift-catalog:update', snapshot}`；`snapshot` 包含付费全局目录、`version`、`stale`、来源时间、本地 `imagePath` 及 `assetsUpdatedAt`（ISO 字符串或空） | 本地图片扫描完成后广播；目录元数据变化及同版本缺图修复均可触发。Admin 去重包含图片 ID/路径和资源时间，按 ID 更新图片，不替换当前直播间成员，不改变礼物事件或规则结算 |
| `shutdown`            | `{type:'shutdown', reason:'manual'}`                                                                                 | 服务关闭前(`webSocketHub.stop` 的 `shutdownPayload`,见 §1)                                                                                                                                                                                                                                                                                                         |
| `game:update` | `{type:'game:update', session}` | 开局、换回合和非画猜游戏变化的完整公开会话；停止时 session=null。会话增加 sessionId/eventRevision；画猜包含完整画布和最近 500 条弹幕，答案公布前 revealedAnswer 为空。 |
| `game:draw` | `{type:'game:draw', sessionId, eventRevision, round, operation, revision}` | 沿用画笔/清空/撤销操作及其 canvas revision；eventRevision 是所有游戏事件共用的会话顺序。绘图请求附带 sessionId/round，过期回合拒绝；自有乐观回声通常跳过，快照后重放正常应用。 |
| `game:patch` | `{type:'game:patch', sessionId, eventRevision, round, item?, avatar?, state?, restartBlocked?}` | 普通弹幕仅 item；头像后补仅 avatar={uid,avatarUrl}；答对/回合状态/可用性变化发送不含 canvas 的公开 state。省略字段保留现值，不重传聊天历史。Admin 消费 state，games overlay 消费全部增量。 |
| `wheel:update`        | `{type:'wheel:update', state}`                                                                                       | 独立转盘配置或抽取状态变更；管理页与 `/wheel` 透明浏览器源消费，不受 `game:update` 会话互斥影响                                                                                                                                                                                                                                                                    |

### 3.1 `snapshot` 的 reason 枚举

以下是运行时实际发布的字面量及受领域 action 限制的模式。成功提交或状态更新后才请求广播；reason 描述触发原因，不包含业务数据，也不是可重放事件日志。

| reason | 触发提交点 / owner | Admin 额外副作用 |
| --- | --- | --- |
| `connect` | [ws.js](../../../src/server/ws.js) 握手成功后的初始快照 | `applySnapshot` 强制初始化；连接恢复流程仍独立重载 HTTP |
| `settings` | 设置 patch、礼物显示设置、开播媒体选择/清除成功；[settings-routes.js](../../../src/server/routes/settings-routes.js)、[gift-routes.js](../../../src/server/routes/gift-routes.js)、[opening-routes.js](../../../src/server/routes/opening-routes.js) | 仅状态应用 |
| `theme:preset-applied` | [theme-routes.js](../../../src/server/routes/theme-routes.js) 预设应用后 | 仅状态应用 |
| `songs:save`、`songs:delete`、`songs:toggle`、`songs:import`、`songs:import-xlsx` | [song-routes.js](../../../src/server/routes/song-routes.js) mutation 成功；CSV/兼容导入复用 import | 合并调度歌库重载 |
| `cloud:songs` / `cloud:settings` | [server.js](../../../src/server.js) 远端快照写入本地 owner 后 | songs 调度歌库重载；settings 仅状态应用 |
| `queue:add` | [queue-routes.js](../../../src/server/routes/queue-routes.js) 手动/随机点歌成功 | 仅状态应用 |
| `queue:${action}` | 同路由 handleAction 返回后；action 仅 `next/clear/pin/unpin/delete/done/skip`，校验 owner 为 [queue-service.js](../../../src/music/queue-service.js) | 仅状态应用 |
| `superchat:${action}` | [superchat-routes.js](../../../src/server/routes/superchat-routes.js) 成功后；仅 `assist/unassist/delete`，owner 为 [superchat-service.js](../../../src/bilibili/superchat-service.js) | 仅状态应用 |
| `bilibili:danmaku` / `bilibili:superchat` | [bilibili-client.js](../../../src/server/bilibili-client.js) 本地消息被接受或 SC 入账后 | 仅状态应用；overlay 自有 reason 筛选见 [overlays.md](../frontend/overlays.md) |
| `bilibili:gift` | [runtime-transport.js](../../../src/server/runtime-transport.js) `publishGiftFlushed`；另独立广播礼物边框和弹幕提示 | 发出 `Events.GIFT_RECEIVED` |
| `live:status` | [bilibili-runtime.js](../../../src/server/bilibili-runtime.js) 更新直播状态后 | 仅状态应用 |
| `gift:source` | [gift-export-runtime.js](../../../src/server/gift-export-runtime.js) 来源 viewEpoch 变化，或退出 SOURCE_SWITCHING | 仅状态应用，不自动伪造礼物收到通知 |
| `gift:wishes` | [gift-wish-routes.js](../../../src/server/routes/gift-wish-routes.js) 非 getSnapshot 动作成功 | 仅状态应用 |
| `gift:sprint:reset` | gift-routes 重置冲刺后 | 仅状态应用 |
| `gift:clear-recent` | gift-routes 清除最近显示后 | 发出 `Events.GIFT_RECEIVED` |
| `database:clear`、`database:clear-superchats`、`database:clear-playback` | [data-routes.js](../../../src/server/routes/data-routes.js) 的 `clearRoute` 成功；各常量固定映射歌库/SC/播放器清理，不是任意动态后缀 | 仅状态应用；clear 路由另请求 songs 云同步 |
| `database:clear-gifts` / `database:clear-all` | data-routes 对应清理成功路径；失败不伪造成功广播 | 发出 `Events.GIFT_RECEIVED` |
| `database:retention` | data-routes 保留策略执行完成且非 dryRun | 仅状态应用 |

[StateService](../../../public/js/admin/state.js) 对所有合法 snapshot 应用状态并更新各字段实时版本；`isSongsSnapshotReason` 实际接受 `songs:` 前缀和 `cloud:songs`，但生产者合法后缀仍以上表为准。`isGiftSnapshotReason` 只包含表中四个明确标注的值。其余 reason 不触发这两类额外副作用；视图由 changedKeys 渲染，不能把事件回调与完整重渲染等同。

`createWebSocketHub.broadcastSnapshot` 在同一 microtask 窗口覆盖 `pendingSnapshot`，flush 时读取最新 `getState()`，**只保留最后一个 reason**，不保存 reason 数组。连接初始快照直接发送；兼容层导出的广播函数不经此合并。消费者不能假定每次业务操作都有一条 reason，也不能据此补造事件。相关证据：[websocket-snapshot-contract.test.js](../../../test/transport/websocket-snapshot-contract.test.js)、[admin-state-ordering.test.js](../../../test/admin/admin-state-ordering.test.js)、[runtime-event-publication.test.js](../../../test/server/runtime-event-publication.test.js)。

### 3.2 `overtime:update` 的 reason 枚举

`quantity-limit` 表示完整礼物因自动随机次数超限保留为待结算。此通知的 state 附带 `pendingCount` 与 `quantityLimitedCount`，不改变 revision/倒计时、不携带成功 adjustment；Admin 实时显示尚未结算。

| reason     | 含义                                   | 出处                                                                      |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `gift`     | 礼物结算推时                           | [overtime-service.js:187](../../../src/overtime/overtime-service.js#L187) |
| `manual`   | 手动操作(开始/暂停/重置/加减时间/开关) | overtime-service.js `commit('manual')` 多处                               |
| `config`   | 背景等配置变更                         | overtime-service.js:134                                                   |
| `rules`    | 规则集替换                             | overtime-service.js:142                                                   |
| `finished` | 倒计时归零                             | overtime-service.js:377                                                   |

详见 [overtime.md](overtime.md)。


## 类别 3 互动结果

`interaction:update` 使用 `{type:'interaction:update',state:{runtimeId,revision,session}}`，仅管理端及 interactions scope 可见；HTTP 与 WS 使用同一公开状态。revision 在同一 runtime 内跨场次递增；clear 保留 envelope 并令 session=null。投票计数立即落内存，推送约 200ms 合并；finish/clear 取消合并任务并立即推送。评分收集中不推送分数变化，主持界面可见时每秒读取 host-state 人数。

`public/js/shared/interaction-client.js` 用连接代次、请求代次和 runtimeId/revision 丢弃迟到响应；每个重连从专用 GET 建立新 runtime。全局 snapshot 不含 interactions，字段缺失不代表清空；game:update 不影响本类。跨类收集资格变化同时刷新游戏的 restartBlocked（你画我猜通过 game:patch，其他游戏通过 game:update），转盘独立。

## 游戏增量恢复

连接/重连使用 GET /api/games/session 建立完整基线。[games-session.js](../../../public/js/overlays/games-session.js) 在读取期间缓存最多 512 条增量，完成后只重放同 sessionId 且大于快照 eventRevision 的连续事件；重复事件忽略，缺口或缓冲溢出重新读取。新的 game:update 使旧 HTTP 响应失效。普通聊天只追加消息，状态 patch 不触发画布重绘；在恢复前完成本页待提交画笔，恢复期间暂停新作画。公开 scope 投影独立选择各字段，仍禁止未公布答案。请求失败以最多 5 秒间隔重试，卸载清理计时器。
