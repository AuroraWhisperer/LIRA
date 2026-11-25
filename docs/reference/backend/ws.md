# 后端 WebSocket 传输与快照契约

> 涉及文件：[src/server/ws.js](../../../src/server/ws.js)、[src/server.js](../../../src/server.js)（`getState` / 广播点）

本文档是 WebSocket 的**单一事实来源**，集中说明传输层实现、快照 21 个字段、全部消息类型与广播原因。客户端处理逻辑见 [frontend/comms.md](../frontend/comms.md)，各字段的领域细节见对应行为文档。

## 1. 传输层（手写 RFC 6455）

零依赖实现，位于 [src/server/ws.js](../../../src/server/ws.js) 的 `createWebSocketHub()`。

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 连接路径 | `/ws`，升级请求经 `server.on('upgrade')` 分发（其他路径直接 destroy）；固定弹幕叠加层额外传 `topic=danmaku` | [server.js:285-292](../../../src/server.js#L285-L292) |
| 握手 | `GET`、HTTP ≥1.1、`Upgrade: websocket`、`Connection` 含 `Upgrade`、版本 13、规范 Base64 编码的 16 字节 key 均通过后，以 key + 魔数 `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` 计算 SHA-1 → Base64 `Sec-WebSocket-Accept`；非法握手返回 400 并销毁连接，不登记 socket | [ws.js](../../../src/server/ws.js) |
| **Origin 验证**（H06） | 先验证凭据，再检查 Origin。普通 Origin 必须精确匹配 `context.allowedOrigins`；仅已验证的 overlay 额外允许沙箱页面的不透明源（`Origin: null`），Admin 明确拒绝 `null`。已认证的无 Origin 非浏览器客户端保留支持；不匹配返回 403 并销毁连接 | [ws.js](../../../src/server/ws.js) |
| 鉴权 | 与 HTTP 共用 `resolveRequestPrincipal(context, req, requestUrl)`：Bearer 优先于 `?token=`，显式无效 `Authorization` 不回退。运行时管理凭据解析为 Admin，服务端签名的访问凭证解析为 overlay（`scope`）；空运行时密钥或无效凭据返回 401 | [access-policy.js](../../../src/server/access-policy.js) |
| 帧上限 | 单帧 `MAX_FRAME_BYTES = 256 KB`，跨分片消息 `MAX_MESSAGE_BYTES = 256 KB`，超限回 close code 1009 | [ws.js:8-9](../../../src/server/ws.js#L8-L9) |
| 待发送上限 | 每个 socket 的 Node 待发送字节数 + 新帧不得超过 `MAX_PENDING_BYTES = 2 MB`；超限时立即销毁并清理慢客户端，由客户端重连后通过 snapshot 恢复 | [ws.js](../../../src/server/ws.js) |
| 心跳 | 每 `HEARTBEAT_INTERVAL_MS = 30000` 发一次 ping；以 `performance.now()` 单调时钟计时，超过 `SOCKET_TIMEOUT_MS = 90000` 未收到 pong 则销毁连接；心跳定时器 `unref()` | [ws.js](../../../src/server/ws.js) |
| 客户端消息 | 服务端不执行业务客户端消息。Admin 文本/二进制消息校验重组后丢弃；overlay 业务数据帧（包括 `clear-history`、控制消息和分片起始帧）以 `Close(1008)` 拒绝。两类连接均允许协议 ping/pong/close | [ws.js](../../../src/server/ws.js) |
| 发送 | 服务端业务消息为 JSON 文本帧；连接初始、合并快照、普通/主题广播和 shutdown 均经统一 `sendWebSocket` 按 socket principal 投影。被 scope 禁止的消息跳过；`topic` 仅作为订阅过滤条件，不扩大权限 | [ws.js](../../../src/server/ws.js)、[overlay-projection.js](../../../src/server/overlay-projection.js) |
| 停止 | `webSocketHub.stop({shutdownPayload})` 首次调用即停止新升级和心跳，依次发送 `shutdown`、`Close(1001)`、FIN；仍未物理关闭的 socket 在 1 秒期限后强制销毁，重复调用不续期也不重复发送 | [ws.js](../../../src/server/ws.js) |

入站帧按 [RFC 6455 §5](https://www.rfc-editor.org/rfc/rfc6455.html#section-5) 校验：客户端必须掩码，未协商扩展时 RSV 必须为零；保留 opcode、非最短长度编码、非法分片顺序、被分片或超过 125 字节的控制帧以 1002 关闭。Admin 分片文本使用严格增量 UTF-8 校验（允许字符跨分片，并在 FIN 检查未完成字符），不保留已校验的消息正文；非法文本或两类连接的 close reason 使用 1007；帧/消息超限使用 1009。合法 Close 载荷原样回显，非法或保留状态码不回显。

HTTP upgrade 的 `head` 在鉴权及握手成功后进入同一帧解析器，恰好处理一次。TCP 未完整帧的缓冲按几何容量增长，已读取的前缀在需要追加时压实；单字节网络分块和 WebSocket continuation 不再重复拷贝整个累积正文。回归和加速生命周期测试见 `test/server/http-websocket-boundary.test.js`、`test/transport/websocket-resource-bounds.test.js`。

所有 Close 路径立即将连接移出广播集合并释放输入缓冲，同时保留关闭期限直至物理 `close`：正常关闭则取消计时器，超时强制销毁，写入失败或背压触发时立即销毁。`http.Server.closeAllConnections()` 不会接管已完成协议升级的 WebSocket 连接，因此无法替代 hub 自身的超时回收机制。关闭期限不延长 Electron 的总退出期限；测试可用 `closeTimeoutMs` 缩短等待。

**WebSocket Context**：升级时传入的 `context` 对象包含 `getState`、`sessionToken` 和 **`allowedOrigins`**（当前仅运行时 `baseUrl`），由 [runtime-transport.js](../../../src/server/runtime-transport.js) 的 `getWebSocketContext()` 构造。每个已升级 socket 保存服务端校验并冻结的 `_wsPrincipal`，关闭清理时移除；客户端 query、消息体或 `topic` 均不能声明或替换身份。

升级入口的 Host 校验由 [http-server.js](../../../src/server/http-server.js) 负责：`ready` 阶段必须精确匹配运行时绑定的 `host:port`，否则在进入 hub 前直接返回 400。正确 Host 不豁免许可、Origin 或 token 校验；缺少 Origin 的非浏览器客户端也必须匹配 Host。`starting` / `quiescing` 阶段返回 503。

尚未交给 hub 的拒绝升级由 HTTP 入口收尾：400/423/503 响应写出后直接销毁 socket，不等待对端回 FIN。这类连接不属于 hub 管理的升级集合，不依赖 `hub.stop()` 兜底。

## 2. 快照（Snapshot）21 字段

初连和重连发送 `{type:'snapshot', reason:'connect', state}`，包含当前身份可见的全部快照字段。旧版管理端继续接收完整 `snapshot`。管理页通过 `/ws?snapshot=music-events-v1` 协商后接收 `{type:'snapshot:patch', reason, state}`，只覆盖其中携带的字段。礼物、点歌和醒目留言的高频补丁按变动选择字段，音乐专用消息负责 `lyricState`、`lyricTimeline`、`nowPlaying`、`lyricSource` 和 `weSing`。展示页仅接收其作用域的投影，时钟、歌词、正在播放和歌单可跳过与本页无关的高频批次。游戏、转盘等独立状态使用 §3 的专用消息与 HTTP 恢复接口。以下 **21 个字段** 是管理端的完整 `state`。[状态组装实现](../../../src/server.js)

协商参数不改变身份或权限。仅有已协商 Admin 连接时，增量读取在调用状态 getter 前排除上述五个音乐字段；混有旧版 Admin 或需要音乐字段的 overlay 时仍读取其所需字段，按连接类型分别复用编码帧。同微任务快照合并、投影、背压与重连规则保持不变；新版管理页连接旧版服务仍可兼容完整 `snapshot`。

`topic=danmaku` 订阅高频 `danmaku:message` 与 `danmaku:superchat-delete`。服务端按已验证的 Admin 或 `danmaku` 身份发送增量。旧 `/danmaku` 入口同时携带 `snapshot=danmaku-events-v1` 时，如果单一高频原因只影响该页的 `danmakuFeed`，页面由增量更新，无需再收一帧列表。只带 `topic` 的客户端继续接收原有快照。所有连接在首连和重连时获得作用域基线，换房状态和影响弹幕页的混合批次也用快照对账。连接契约测试见 [WebSocket 权限与分发](../../../test/transport/websocket-access-policy.test.js)。

| 字段 | 生产者 | 内容概述 |
| --- | --- | --- |
| `queue` | `domainServices.queue.getSnapshot()` | 点歌队列快照，单项 `is_live` 为布尔标记，`queue` overlay 白名单保留该字段；排序由后端确定，见 [music/services.md](music/services.md) |
| `superChats` | `domainServices.superChats.getSnapshot()` | SC 列表（按价格降序），见 [bilibili/gift.md](bilibili/gift.md) |
| `gifts` | `domainServices.gifts.getSnapshot()` | 管理端读取 `recent` 近期列表与 `viewRevision` 来源版本。仅有礼物展示页订阅时按需读取版本，来源未就绪时为 `null`。同批有管理端需要列表时共用一次读取。 |
| `giftSprint` | `domainServices.gifts.getSprintSnapshot()` | 礼物冲刺状态 |
| `giftDetection` | `domainServices.gifts.getStatus()` | 礼物检测管道状态（`coreActive` 等），见 [bilibili/gift.md](bilibili/gift.md) |
| `blindBoxMapping` | `blindBoxMappingState` | 当前盲盒映射配置与同步状态 |
| `overtime` | `domainServices.overtime.getSnapshot()` | 加班机状态，见 [overtime.md](overtime.md) |
| `settings` | `settingsStore.getSettings()` | 全部设置键值，见 [storage.md](storage.md) |
| `categories` | `domainServices.songs.getMetadata()` | 曲风 |
| `tags` | `domainServices.songs.getMetadata()` | 歌曲标签 |
| `songCount` | `domainServices.songs.getMetadata()` | 曲库歌曲总数 |
| `roomGuard` | `bilibiliRuntime.getRoomGuardState()` | 当前配置直播间的 `{ roomId, count }`；人数未知为 `null`，变化原因 `bilibili:room-guard` |
| `liveStatus` | `liveStatus` 对象 | 直播间连接状态（`connected` / `enabled` / `roomId` / `mode` / `message` / `updatedAt`） |
| `bilibiliDiagnostics` | `bilibiliDiagnostics` 对象 | Bilibili 诊断信息（最近包/命令/礼物时间戳、解析计数等），见 [bilibili/danmaku.md](bilibili/danmaku.md) |
| `lyricState` | `lyricState` 对象 | 当前歌词行状态（单行），见 [music/services.md](music/services.md) |
| `lyricTimeline` | `lyricTimeline` 对象 | 歌词时间轴（全曲），经 `normalizeLyricTimeline` 归一化 |
| `nowPlaying` | `musicRuntime.getNowPlayingState()` | 与歌词共用来源选择的曲目信息和实际播放状态，见 [正在播放展示数据](music/services.md#正在播放展示数据) |
| `nowPlayingConfig` | `readNowPlayingConfig(settingsStore.getSettings())` | 已保存的本机唱片展示外观，见 [歌曲信息页面](../frontend/overlays.md#歌曲信息now-playing) |
| `lyricSource` | `musicRuntime.getLyricSource()` | 实际输出来源、跟随偏好、正在播放的来源及 QQ / 网易云 / WeSing 采集状态，仅 Admin；见 [音乐服务 §13](music/services.md#13-歌词状态与时间轴lyric-statejs--lyric-timelinejs) |
| `weSing` | `weSingCapture.getStatus()` | 全民 K 歌采集状态，见 [music/wesing.md](music/wesing.md) |
| `danmakuFeed` | `danmakuFeedBuffer.getSnapshot()` | 当前直播间最近 50 条普通弹幕、SC 和已结算礼物提示的公开投影，含可选 B 站表情、SC 金额/撤回 ID 或礼物字段，见 [bilibili/danmaku.md](bilibili/danmaku.md) §4.1 |

快照全量替换语义与客户端指纹去重见 [frontend/comms.md](../frontend/comms.md)。

### 2.1 Overlay scope 投影

页面访问凭证由运行时密钥和固定 `scope` 签名派生，篡改 `scope` 或更换运行时密钥后均无法通过校验。匿名页面 HTML 仅获得本页访问凭证，无法获取管理令牌。所有嵌套 DTO 与设置键均按 [overlay-projection.js](../../../src/server/overlay-projection.js) 的显式白名单投影，不透传整个设置对象或未来新增字段。REST 页面权限见 [API 契约](api.md)。

| Scope | snapshot 展示字段 | 允许的专用增量 |
| --- | --- | --- |
| `queue` | 展示设置、队列歌曲/点歌者展示字段、SC 文本和价格 | 无 |
| `songlist`、`blindbox` | 各自展示设置 | 无 |
| `overtime` | 倒计时、背景与展示规则 | `overtime:update` |
| `gift-effects` | 礼物特效/边框展示设置 | `gift:frame`、`gift:effect`、`gift:guard-thanks` |
| `gift-feed` | `gifts.viewRevision` | `gift-catalog:update` 仅保留 `type`，作为刷新通知 |
| `gift-wishes` | `gifts.viewRevision` | 无专用事件；`gift:wishes` 快照 reason 通知重新读取整数进度 |
| `heart-box-collection` | `gifts.viewRevision` | 无专用事件；快照中的来源版本变化时重新读取每周收集投影，字段与周期见 [礼物 API](api.md#10-礼物域gifts) |
| `gift-sprint` | `giftSprint.targetRmb/remainingCrystalBalls`；复用来源隔离的冲刺统计 | 无专用事件；初始及后续快照更新文字倒计数，不开放修改目标、重置或礼物明细 |
| `lyrics` | 歌词展示设置、`lyricState`、`lyricTimeline` | `lyric-state`、`lyric-timeline` |
| `now-playing` | `nowPlaying` 曲目展示字段及 `nowPlayingConfig` 外观字段白名单 | `now-playing`；不接收歌词、采集诊断或其他设置 |
| `danmaku` | 弹幕展示设置、公开直播连接状态、`danmakuFeed` | `danmaku:message`、`danmaku:superchat-delete`（另需 `topic=danmaku`） |
| `games` | 当前全局快照无游戏字段；兼容专用 `games` 字段时仍投影公开会话 | `game:update`、`game:patch`、`game:draw`；不含未公布答案 |
| `wheel` | 空 `state` | `wheel:update` |
| `interactions` | 本页互动外观设置；全局 snapshot 不含互动 session | `interaction:update`；公开状态与恢复规则见下方“类别 3 互动结果” |
| `clock` | `overlay-projection.js` 的 clock 设置白名单，含 `clockMoonMode`、`clockMoonIntervalSeconds` 和 JSON 字符串 `clockStyleParameters`；不按前缀放行其他设置 | 无；通过 `settings` 快照更新 |
| `gift-export`、`opening` | 空 `state` | 无 |

**房间大航海人数（`roomGuard`）投影**　`queue`、`overtime`、`danmaku`、`gift-feed`、`gift-wishes` 和 `heart-box-collection` 使用同一份房号与人数白名单。正式场景的文字组件也通过 `getDisplayData` 获取这两个字段，经 `component-preview:room-guard` 传至既有 iframe。人数更新仅替换图片。云端弹幕协商 `roomGuard=1` 后接收 Server 快照和人数事件，Electron 校验房号、人数与时间戳后写入现有 display buffer。人数变化保留纪元与游标，换账号或连接重置时清除该状态。

全部已知 overlay scope 均允许 `{type:'shutdown', reason}`，未列出的专用消息默认不投递。Admin 保持完整消息权限，包括 `wesing-state` 和完整目录更新。`scope` 在初始与后续广播中始终保持一致，不能通过连接重建、`topic`、兼容发送函数或伪造入站消息提权。

## 3. 消息类型全集

| 类型 | 载荷 | 触发点 |
| --- | --- | --- |
| `snapshot` | `{type, reason, state}`（Admin 完整状态；overlay 按 §2.1 投影） | 连接建立（`reason:'connect'`）；未协商连接的业务变更广播 |
| `snapshot:patch` | `{type, reason, reasons?, state}`（省略字段见 §2） | 已协商 `snapshot=music-events-v1` 的 Admin 后续业务快照。多个原因合并时携带去重的 `reasons`。首连和重连仍发完整 `snapshot` |
| `danmaku:message` | `{type:'danmaku:message', item}` | 实时 B 站普通弹幕、SC 及已结算礼物提示（公开字段见 [bilibili/danmaku.md](bilibili/danmaku.md) §4.1）；投递给订阅 `topic=danmaku` 的 Admin 或 `danmaku` scope，重连由 `danmakuFeed` 恢复 |
| `danmaku:superchat-delete` | `{type:'danmaku:superchat-delete', messageIds}`（仅含本次实际从公开 feed 删除的 SC 平台消息 ID） | B 站 SC 下线时先从公开缓冲与后续快照撤回，再向订阅 `topic=danmaku` 的 Admin 或 `danmaku` scope 广播；重复或未命中 ID 不发送，持久化撤回顺序见 [bilibili/danmaku.md](bilibili/danmaku.md) §4.1 |
| `gift:frame` | `{type,eventId,giftEventId,giftId,giftName,num,totalPriceCents,userName,avatarUrl,themeId}`（头像缺失为空字符串，预览另含 `preview/previewSessionId`）；原生 `gift-drop` / `gift-swing` 另含 `startedAt/artworkPath/motion:{size,durationSeconds,speed,bounce?,count?,angle?,textMode?}`（兼容旧事件 `quantityMultiplier`，并存时以 `count` 为准）；导入图片/视频样式为 `themeId:'imported'` 并附 `styleIds:[样式 ID]`（仅发往场景窗口）；旧 `motionMode` 不再生成/投影 | `final` 礼物经 frame/motion 适配器按各款独立开关与金额门槛生成（详细触发规则见 [bilibili/gift.md](bilibili/gift.md#1-架构总览)）；`gift-effects` scope 与场景仅接收展示字段 |
| `gift:guard-thanks` | `{type,eventId,giftEventId,tier,userName,months,avatarUrl,textMode,style}`（`style` 为 `aurora` / `classic`，预览另含 `preview`；`gift-effects` scope 保留 `style` 但不含 `giftEventId`） | `final` 大航海礼物按风格独立开关或管理端显式预览生成（旧设置兼容与广播顺序见 [bilibili/gift.md](bilibili/gift.md#1-架构总览)） |
| `gift:effect` | `{type,source,eventId,giftId,effect}`（`effect` 为播放素材和布局展示 DTO） | 礼物特效发布；仅 Admin 与 `gift-effects` scope 接收 |
| `lyric-state` | `{type:'lyric-state', state}`（含 `generation/sequence` 和默认 1 的 `playbackRate`，字段规则见 [歌词状态](music/services.md#13-歌词状态与时间轴lyric-statejs--lyric-timelinejs)） | `music-runtime` 更新实际输出来源（内置、QQ、网易云、WeSing）状态或切换输出来源时广播 |
| `lyric-timeline` | `{type:'lyric-timeline', timeline}` | `music-runtime` 接受当前生产者的完整时间轴时广播 |
| `now-playing` | `{type:'now-playing', state}`（`state` 与快照 `nowPlaying` 相同） | 当前来源、曲目信息、封面或实际播放状态变化时广播；进度采样不重复发送，仅 Admin 与 `now-playing` scope 接收，详见 [展示数据](music/services.md#正在播放展示数据) |
| `lyric-source` | `{type:'lyric-source', state:{source,selection,playingSources,qqClient,neteaseClient,weSing}}` | 跟随偏好、实际来源或采集状态变化；仅 Admin，相同快照去重，重连从 `snapshot.lyricSource` 恢复 |
| `wesing-state` | `{type:'wesing-state', state}` | WeSing 采集状态变化（[server.js:184](../../../src/server.js#L184)） |
| `overtime:update` | `{type, reason, state, adjustment?}` | 加班机状态变更（[server.js:148-153](../../../src/server.js#L148-L153)），`adjustment` 仅礼物结算时携带 |
| `gift-catalog:update` | `{type:'gift-catalog:update', snapshot}`（含付费全局目录、`version`、`stale`、来源时间、本地 `imagePath` 及 `assetsUpdatedAt`） | 本地图片扫描完成后广播；目录元数据变化及同版本缺图修复均可触发。Admin 去重包含图片 ID/路径与资源时间，按 ID 更新图片，不替换房间成员、礼物事件或规则结算 |
| `shutdown` | `{type:'shutdown', reason:'manual'}` | 服务关闭前（`webSocketHub.stop` 的 `shutdownPayload`，见 §1） |
| `game:update` | `{type:'game:update', session}` | 开局、换回合与非画猜游戏变化的完整公开会话；停止时 `session=null`。会话含 `sessionId` / `eventRevision`；画猜含完整画布和最近 500 条弹幕，答案公布前 `revealedAnswer` 为空 |
| `game:draw` | `{type:'game:draw', sessionId, eventRevision, round, operation, revision}` | 画笔/清空/撤销操作及画布修订号；`eventRevision` 为所有游戏事件共用的会话序号。前端绘图请求携带 `sessionId` / `round`，服务端过期校验见 [绘图 API](api.md)；自有乐观回声通常跳过，快照后重放正常应用 |
| `game:patch` | `{type:'game:patch', sessionId, eventRevision, round, item?, avatar?, state?, restartBlocked?}` | 聊天立即发 `item`；头像后补仅发 `avatar={uid,avatarUrl}`；答对比分按 40ms 窗口合并发送不含 `canvas` 的公开 `state`，回合状态/可用性变化立即发送最新 `state` 并取消待发批次。省略字段保留现值，不重传聊天历史。Admin 读取 `state`，`games` overlay 处理全部增量；HTTP 快照不等待比分批次 |
| `wheel:update` | `{type:'wheel:update', state}` | 独立转盘配置或抽取状态变更；管理端与 `/wheel` 透明浏览器源接收，不受 `game:update` 会话互斥影响 |
| `interaction:update` | `{type:'interaction:update', state:{runtimeId, revision, session}}`（仅 Admin 与 `interactions` scope 可见） | 投票/评分的公开状态变化；HTTP 与 WS 使用同一公开状态，合并与恢复规则见下方“类别 3 互动结果” |

**礼物身份扩展字段**：Admin 完整消息的礼物身份扩展沿用现有外层结构，overlay 仍只接收 §2.1 允许的展示字段。`state.overtime.rules` 与 `overtime:update` 中的完整规则携带 `giftIdentity` 与 `bindingStatus`；`gift-catalog:update` 携带完整身份与 schema 3 关系；最近礼物原始行保留 `gift_variant_id` / `blind_box_variant_id` 供界面匹配对应图片，不通过当前 ID 回填历史。字段与迁移语义见 [加班机契约](overtime.md) 及 [礼物身份规范](../../../specs/gift-identity-overtime.md)。

### 3.1 `snapshot` 的 reason 枚举

下表列出运行时实际发布的所有 `reason` 字面量及由领域 action 派生的动态格式（如 `queue:${action}`）。仅在成功提交或状态更新（含临时点歌结果更新）后才请求广播；`reason` 仅标识触发原因，不携带业务数据，也不是可重放事件日志。

| reason | 触发提交点 / 归属模块 | Admin 额外副作用 |
| --- | --- | --- |
| `connect` | [ws.js](../../../src/server/ws.js) 握手成功后的初始快照 | `applySnapshot` 强制初始化；连接恢复流程仍独立重载 HTTP |
| `settings` | 设置 patch、礼物显示设置、开播媒体选择/清除、歌曲信息外观保存成功；[settings-routes.js](../../../src/server/routes/settings-routes.js)、[gift-routes.js](../../../src/server/routes/gift-routes.js)、[opening-routes.js](../../../src/server/routes/opening-routes.js)、[now-playing-routes.js](../../../src/server/routes/now-playing-routes.js) | 仅状态应用 |
| `theme:preset-applied` | [theme-routes.js](../../../src/server/routes/theme-routes.js) 预设应用后 | 仅状态应用 |
| `songs:save`、`songs:delete`、`songs:toggle`、`songs:import`、`songs:import-xlsx` | [song-routes.js](../../../src/server/routes/song-routes.js) 写操作成功；CSV/兼容导入复用 `import` | 合并调度歌库重载 |
| `cloud:songs` / `cloud:settings` | [server.js](../../../src/server.js) 远端快照写入本地后 | `songs` 调度歌库重载；`settings` 仅状态应用 |
| `queue:add` | [queue-routes.js](../../../src/server/routes/queue-routes.js) 手动/随机点歌成功 | 仅状态应用 |
| `queue:request-result` | [queue-routes.js](../../../src/server/routes/queue-routes.js) 或 [bilibili-client.js](../../../src/server/bilibili-client.js) 点歌被预期规则拒绝并记录临时结果后；字段归属见 [点歌队列](music/services.md#81-统一队列语义) | 仅状态应用；点歌板及场景读取最新结果 |
| `queue:${action}` | 同路由 `handleAction` 返回后；`action` 仅 `next/clear/pin/unpin/delete/done/skip/live/unlive`，由 [queue-service.js](../../../src/music/queue-service.js) 校验 | 仅状态应用 |
| `superchat:${action}` | [superchat-routes.js](../../../src/server/routes/superchat-routes.js) 成功后；仅 `assist/unassist/delete/undo`，由 [superchat-service.js](../../../src/bilibili/superchat-service.js) 负责 | 仅状态应用 |
| `bilibili:danmaku` / `bilibili:superchat` | [bilibili-client.js](../../../src/server/bilibili-client.js) 本地消息被接受或 SC 入账后 | 仅状态应用；overlay 自有 reason 筛选见 [overlays.md](../frontend/overlays.md) |
| `bilibili:gift` | [runtime-transport.js](../../../src/server/runtime-transport.js) `publishGiftFlushed`；另独立广播全屏礼物感谢和弹幕提示 | 发出 `Events.GIFT_RECEIVED` |
| `live:status` | [bilibili-runtime.js](../../../src/server/bilibili-runtime.js) 更新直播状态后 | 仅状态应用 |
| `bilibili:room-guard` | [bilibili-runtime.js](../../../src/server/bilibili-runtime.js) 更新房间大航海人数后 | 仅状态应用 |
| `gift:source` | [gift-export-runtime.js](../../../src/server/gift-export-runtime.js) 来源 `viewEpoch` 变化、退出 `SOURCE_SWITCHING`，或历史激活后从 `BOOTSTRAPPING` 进入 `CATCHING_UP` | 仅状态应用，不伪造礼物收到通知 |
| `gift:wishes` | [gift-wish-routes.js](../../../src/server/routes/gift-wish-routes.js) 非 `getSnapshot` 动作成功 | 仅状态应用 |
| `gift:heart-box-collection` | [gift-wish-routes.js](../../../src/server/routes/gift-wish-routes.js) 心动盲盒校准成功 | 状态快照；使心动收集场景投影缓存失效，独立源沿用共享进度轮询 |
| `component:styles` | 添加、安装、移除、配置样式或还原样式库成功后。[样式路由](../../../src/server/routes/component-style-routes.js) | 可见的管理面板重新读取样式列表 |
| `gift:sprint:reset` | `gift-routes` 重置冲刺后 | 仅状态应用 |
| `gift:clear-recent` | `gift-routes` 清除最近显示后 | 发出 `Events.GIFT_RECEIVED` |
| `database:clear`、`database:clear-superchats`、`database:clear-playback` | [data-routes.js](../../../src/server/routes/data-routes.js) 的 `clearRoute` 成功；各常量固定映射歌库/SC/播放器清理，不是任意动态后缀 | 仅状态应用；`clear` 路由另请求 songs 云同步 |
| `database:clear-gifts` / `database:clear-all` | `data-routes` 对应清理成功路径；失败不伪造成功广播 | 发出 `Events.GIFT_RECEIVED` |
| `database:retention` | `data-routes` 保留策略执行完成且非 `dryRun` | 仅状态应用 |

[StateService](../../../public/js/admin/state.js) 对所有合法 snapshot 应用状态并更新各字段实时版本：`isSongsSnapshotReason` 接受 `songs:` 前缀和 `cloud:songs`（生产者合法后缀仍以上表为准）；`isGiftSnapshotReason` 仅包含表中四个明确标注的值。其余 reason 不触发这两类额外副作用；视图按 `changedKeys` 局部渲染，事件回调不等同于整页重绘。

`createWebSocketHub.broadcastSnapshot` 合并同一微任务内的变动。管理端标量 `reason` 保留最后一次调用的原因，协商补丁的客户端根据同批 `reasons` 各刷新一次资源样式、曲库和礼物。只合并 `bilibili:gift`、`bilibili:danmaku`、`bilibili:superchat`、`queue:add`、`queue:request-result` 时，补丁仅读取相应字段的并集。

展示页按字段和实际刷新入口选择接收方。例如礼物到达会唤醒盲盒的统计读取，独立游戏和歌词页跳过该批，手动队列操作仅唤醒点歌板。设置和未知原因沿用该页的范围快照。每页的标量原因来自适用变动，合并批次还可携带本页涉及的公开刷新原因 `reasons`。连接初始快照直接发送，旧版管理端仍使用标量。相关测试见 [websocket-transport.test.js](../../../test/transport/websocket-transport.test.js)、[admin-state-ordering.test.js](../../../test/admin/admin-state-ordering.test.js)、[runtime-event-publication.test.js](../../../test/server/runtime-event-publication.test.js)。

当仅存在 overlay 连接时，服务端根据 [overlay-projection.js](../../../src/server/overlay-projection.js) 的字段白名单合并所需字段，通过 `getState(fields)` 避免计算无关域。Admin 协商后的音乐字段按需排除与混连帧复用规则见 §2。单次广播内按已认证 principal 类型/scope 复用投影、JSON 和帧，缓存不跨广播；每个 socket 独立执行订阅过滤、背压检查与失败清理。连接初始快照也按该连接 scope 选择读取字段，外层结构与投影契约保持不变。

### 3.2 `overtime:update` 的 reason 枚举

| reason | 含义 | 出处 |
| --- | --- | --- |
| `gift` | 礼物结算调整倒计时 | [overtime-service.js:187](../../../src/overtime/overtime-service.js#L187) |
| `manual` | 手动操作（开始/暂停/重置/加减时间/开关） | `overtime-service.js` `commit('manual')` 多处 |
| `config` | 背景等配置变更 | `overtime-service.js:134` |
| `rules` | 规则集替换 | `overtime-service.js:142` |
| `finished` | 倒计时归零 | `overtime-service.js:377` |
| `quantity-limit` | 完整礼物因随机自动执行次数超限保留 `pending`；`state` 附 `pendingCount/quantityLimitedCount`，不改 `revision`/倒计时，不携带成功 `adjustment` | [overtime-service.js](../../../src/overtime/overtime-service.js) 的 `finalizeGift` |

详见 [overtime.md](overtime.md)。

## 类别 3 互动结果

消息与权限见 §3 主表。`revision` 在同一 runtime 内跨场次递增；`clear` 保留外层结构并将 `session` 置为 `null`。投票计数立即落内存，推送约 200ms 合并；`finish` / `clear` 取消合并任务并立即推送。评分收集中不推送分数变化，主持界面可见时每秒读取 `host-state` 人数。

`public/js/shared/interaction-client.js` 使用连接代次、请求代次及 `runtimeId` / `revision` 丢弃迟到响应，每次重连经专用 GET 接口建立新 runtime。主持面板在同一次轮询中合并公开会话与主持状态后刷新一次。全局 snapshot 不包含互动数据，字段缺失不代表已清空；`game:update` 不影响投票/评分会话。跨类收集互斥状态变化时会同步刷新小游戏的 `restartBlocked`（你画我猜经 `game:patch`，其他小游戏经 `game:update`）；独立转盘不受该互斥影响。

## 游戏增量恢复

连接/重连使用 `GET /api/games/session` 建立完整快照基线。[games-session.js](../../../public/js/overlays/games-session.js) 在读取期间缓存最多 512 条增量，完成后仅重放同 `sessionId` 且大于快照 `eventRevision` 的连续事件；重复事件忽略，出现缺口或缓冲溢出时重新读取。新的 `game:update` 使旧 HTTP 响应失效。普通聊天仅追加消息，状态 patch 不触发画布重绘；恢复前先完成本页待提交画笔，恢复期间暂停新作画。公开 scope 投影独立选择各字段，仍屏蔽未公布答案。请求失败按最长 5 秒间隔重试，卸载时清理计时器。
