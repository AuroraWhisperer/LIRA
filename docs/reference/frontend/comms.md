# 前端通信：Token、HTTP、WebSocket 与桌面桥

> 涉及文件：[shared/utils.js](../../../public/js/shared/utils.js)、[shared/event-bus.js](../../../public/js/shared/event-bus.js)、[admin/state.js](../../../public/js/admin/state.js)、[admin/overtime.js](../../../public/js/admin/overtime.js)、[desktop.js](../../../public/js/desktop.js)、[overlays/queue.js](../../../public/js/overlays/queue.js)、[src/server/http-utils.js](../../../src/server/http-utils.js)

本文档描述前端与后端、桌面层之间的**客户端通信行为**。传输层实现、快照字段与消息类型全集归 [ws.md](../backend/ws.md) 维护；端点清单归 [api.md](../backend/api.md) 维护；IPC 通道注册表归 [desktop/preload.md](../desktop/preload.md) 维护。

## 1. 管理身份与展示页访问凭证

管理页面不接收管理 token。Electron 主进程的 [desktop-request-auth.js](../../../src/electron/desktop-request-auth.js) 为受信任主窗口、当前 `mainFrame` 与精确本机目标附加鉴权信息，覆盖 HTTP、下载导航与 WS；渲染进程和预加载脚本不持有凭据，URL 也不自动追加管理 token。其他窗口与子 frame 不能借用该凭据；管理页 CSP 禁止使用 Worker，以免 Chromium 将部分 Worker 请求归入主 frame 从而意外携带管理凭据。具体边界见 [desktop/auth.md](../desktop/auth.md) §11.1。

仅已知的 overlay HTML 会注入各自的 `ov1:<scope>:<signature>` 访问凭证（挂载于 `window.__API_TOKEN__`）供本页使用，不可操作管理接口或其他 scope。规范路径与原始 HTML 别名权限一致，页面均禁用缓存；运行时密钥轮换后，旧访问凭证立即失效。

| 行为 | Overlay 客户端规则 |
| --- | --- |
| fetch | [overlay-bootstrap.js](../../../src/server/overlay-bootstrap.js) 只给精确本机 origin 的 `/api/*`（除 health）添加 Bearer；兼容字符串、Request 和 Headers，保留调用方显式认证 |
| WebSocket | 只向精确本机 host/协议的 `/ws` 添加本页 query 凭据；外域、异端口、相似路径不添加 |
| 图片 | avatar 代理等图片请求使用本页 query 凭据，并受服务端 scope 检查 |
| HTML 隔离 | 通过 `sandbox allow-scripts` 生成不透明源（`Origin: null`），隔离对父管理页的访问；公开静态资源支持 CORS，API 与 WS 仅放行通过校验的本页专属访问令牌 |
| 恢复 | 本机 API 返回 401 或 WS 断开时，先用旧访问凭证探测本页最小 state，确认仍为 401 后才刷新页面；请求合并（同一时间只发一次探测）、5 秒超时并在 `pagehide` 时取消，离线与启动阶段不盲目刷新 |

身份和生命周期归 [server-core.md](../backend/server-core.md) §4/§7；HTTP 权限表归 [api.md](../backend/api.md) §0.0，WS 投影归 [ws.md](../backend/ws.md)。管理页保留完整管理 state，展示页仅读取自身所需字段。没有以匿名 HTML 发放管理身份的后备路径。

---

## 2. HTTP 模式（`fetch` 与 `{ok}` 统一响应格式）

### 2.1 工具函数与兼容入口

[shared/utils.js](../../../public/js/shared/utils.js) 保留以下具名导出，已移除无人使用的聚合对象及全局挂载。转义直接使用 [html-escape.js](../../../public/js/shared/html-escape.js)，格式化直接使用 [display-format.js](../../../public/js/shared/display-format.js)，多语言字体回退直接使用 [font-family.js](../../../public/js/shared/font-family.js)；这些纯函数入口不引入 UI 或网络依赖，`withMultilingualFallback` 仍从 `utils.js` 兼容再导出。通知、确认框与响应解析分别由 `toast.js`、`confirmation-dialog.js`、`json-response.js` 负责。

| 函数 | 用途 |
| --- | --- |
| `api(url, body, {notifyError=true, signal}={})` | POST JSON 便捷封装：设置 `Content-Type: application/json`；仅存在本页 `__API_TOKEN__` 时补 Bearer，Admin 鉴权由主进程加头；HTTP 失败或 `!payload.ok` 抛错；按 `notifyError` 决定是否提示后再抛 |
| `readJsonResponse(response, fallbackMessage)` | 统一响应解析：空响应返回 `{}`；非 JSON 返回带 HTTP 状态码与内容预览的报错；正常返回 `JSON.parse` 结果 |
| `showError(error)` / `toast(message)` / `showStackedToast(options)` | 错误与提示：全局 `#toast` 容器，支持 key 去重、点击回调、礼物通知最多 6 条上限 |
| `escapeHtml` / `escapeAttr` | 渲染前转义（所有模板插值必须经此） |
| `formatBytes` / `formatMoney` / `formatCompactNumber` / `formatDuration` / `formatSuperChatPrice` | 展示格式化 |
| `debounce` / `normalizeRangeValue` | 输入防抖与滑块数值归一 |
| `dangerConfirm` / `logoutConfirm` | 危险操作 / 退出登录的自绘确认弹窗（替代原生 confirm） |
| `localOverlayOrigin(locationLike)` | 以 `127.0.0.1` 规范化叠加层 URL（供管理页生成浏览器源地址） |
| `withMultilingualFallback(fontFamily)` | 字体栈追加多语言回退 |

### 2.2 统一响应格式约定

[json-response.js](../../../public/js/shared/json-response.js) 提供无 UI 依赖的 JSON 解析与 `{ok}` 外层结构校验。`assertApiResponse(response, payload, message)` 统一检查 HTTP 与业务失败，错误对象保留 `status`、`code` 和 `payload`；`readApiResponse` 读取 JSON 后应用同一规则。原 `utils.readJsonResponse` 继续再导出带正文预览的解析器，保持空成功响应返回 `{}` 的兼容语义。场景、组件样式、开播设置、礼物许愿和弹幕工具共用该校验；各调用方自行负责错误提示、取消与超时、鉴权、上传格式、业务错误字段及成功事件，二进制下载由各自业务模块先行处理。

- 普通 JSON `/api/*` 接口通常成功返回 `{ok: true, data: …}`、失败返回 `{ok: false, error: …}`，具体形状由业务处理函数构造，例外以 [API 注册表](../backend/api.md) 为准。`sendJson` 只序列化传入 payload 并设置响应头，不自动添加 `ok` 或 `data`。
- 前端错误呈现：普通失败调用 `toast(错误信息)`；表单提交失败走 `showError`；直播刷新失败由 [settings-operations.js](../../../public/js/admin/settings-operations.js) 内的 `reconnectErrorMessage()` 将网络类错误翻译为可操作文案。

### 2.3 状态获取与乐观更新

Admin 的 HTTP 与 WS 全量快照统一经过 `StateService.applySnapshot`。HTTP 只接受最新发起请求的结果，并保留请求发起之后被实时消息更新的字段；未被实时更新的字段仍可由 HTTP 补齐。全量快照同时遵守歌词 `generation`（代次）/`sequence` 与同一连接内加班机 `revision`（修订号）的排序规则；重连的 `connect` 快照可接纳服务重启后的较低加班机修订号。`STATE_LOADED` 附带变化的顶层字段 `changedKeys`，完全相同的快照不触发视图刷新，设置事件仅在 `settings` 实际变化时派发。传输快照与 HTTP 响应形状不变。

- 全量状态：`GET /api/state`（字段及各 scope 投影见 [ws.md](../backend/ws.md) §2），管理页 `StateService.reloadState()`、叠加层 `loadState()` 首屏均用它兜底（WS 未连上时保证可渲染）。
- 歌库：`GET /api/songs?query=&category=&language=&artist=&tag=&enabledOnly=`（[state.js:128-155](../../../public/js/admin/state.js#L128-L155)）。
- **变更后的刷新**：管理操作按各自归属模块通过 `reloadState()`/`reloadAll()` 或 WS 接收结果，带草稿的表单仍由控制器合并；快照到达后对歌库相关变更做 **240ms 防抖**重载（`scheduleSongReload`，合并短时间内多次快照，[state.js:160-165](../../../public/js/admin/state.js#L160-L165)）；播放页则是本地状态先行 + `savePlaybackState()` 落盘（见 [playback.md](playback.md) §6）。
- **错误呈现分工**：表单/操作类错误走 `showError`（toast）；`reconnectBilibili` 等直接 `fetch` 的调用自行解析 `{ok}` 外层结构并处理 404/网络类错误。歌词状态上报失败保持静默；播放队列保存失败保留最新待存快照，连续两次失败提示暂勿关闭 LIRA，之后保存成功再提示恢复，详见 [播放持久化](playback.md#6-状态持久化play_queue_state)。

**礼物数据边界：**服务端权威礼物由 Electron 主进程的 `remote-gift-controller` 通过独立 DeviceBearer SSE 与终态游标拉取（final cursor pull）接收；主进程完成校验、恢复和幂等投影后，渲染进程仅读取本地 `/api/state`、历史接口与 WebSocket `gift:frame`/snapshot。渲染进程不直接订阅远端礼物流、不持有 Device token；可见身份字段按本地接口的授权投影提供。满足条件的连续 SSE 终态事件（final）已支持与游标原子提交，HTTP 拉取仍负责首次初始化（bootstrap）、断线缺口补齐与周期核对，适用条件及异常处理见 [main.md §2.3](../desktop/main.md#23-服务端权威礼物接收生命周期) 与 [ADR-0021](../../architecture/adr/0021-atomic-live-gift-progress.md)。

## 3. WebSocket 客户端

### 3.1 连接与快照处理

| 事实 | 行为 | 出处 |
| --- | --- | --- |
| 连接 URL | 管理页使用本机 `/ws?snapshot=music-events-v1` 协商音乐事件更新，鉴权由 Electron 主进程加头；overlay 使用本页 query 凭据。`topic=danmaku` 只订阅事件，不扩展 scope | [state.js](../../../public/js/admin/state.js)、[socket-client.js](../../../public/js/overlays/socket-client.js) |
| 首帧 | 连接建立即收 `{type: 'snapshot', reason: 'connect', state}` 全量快照（契约见 [ws.md](../backend/ws.md) §2） | [ws.md](../backend/ws.md) §2 |
| 协议选择 | `location.protocol === 'https:' ? 'wss:' : 'ws:'`，与页面同源（`location.host`） | [state.js:30](../../../public/js/admin/state.js#L30) |
| 只读客户端 | 前端**不发送任何业务消息**给服务端；收到 `shutdown` 后停止重连（见 §3.3、§3.4） | [ws.md](../backend/ws.md) §1 |
| 统一接纳 | HTTP 与 WS 经统一接纳，保留实时更新字段及单调版本；按 `changedKeys` 分域刷新（见 §2.3） | [state.js:44-58](../../../public/js/admin/state.js#L44-L58) |
| 局部消息 | `overtime:update`/`wesing-state`/`lyric-state`/`lyric-timeline` 只更新对应字段并派发 `CustomEvent`（`app:overtime`、`app:wesing-state`、`app:lyric-state`、`app:lyric-timeline`）；`gift-catalog:update` 不写入全量 state，只派发 `Events.GIFT_CATALOG_UPDATED` | [state.js:59-86](../../../public/js/admin/state.js#L59-L86) |
| 礼物触发 | `reason` ∈ {`bilibili:gift`, `gift:clear-recent`, `database:clear-gifts`, `database:clear-all`} 时额外派发 `gift:received` 事件 | [state.js:215-220](../../../public/js/admin/state.js#L215-L220) |

Admin 首次成功连接不重复初始歌库加载；后续每次成功重连通过现有 240ms 合并计时器重新获取 `/api/songs`，使用当前筛选条件并保留最新请求代次检查，以恢复断线期间遗漏的歌曲变更。关闭状态同时取消连接和歌库重载计时器，已排队的旧回调不能发起请求。

协商成功后，管理页按 `snapshot:patch` 实际携带的字段合并状态并记录字段版本，省略的音乐字段由现有专用消息维护；晚到的 HTTP 响应不能覆盖较新的事件。每次连接的 `snapshot` 仍为完整基线；旧服务返回完整快照也能接纳。省略字段及兼容规则由 [WS 契约](../backend/ws.md#2-快照snapshot21-字段) 定义。

### 3.2 指纹去重（叠加层）

叠加层不重渲染内容未变的快照（各页面完整去重字段见 [overlays.md](overlays.md)）：

- **队列层**：`computeStateKey()` 将当前歌曲、等待队列、SC 与全部主题键拼成 JSON 指纹；指纹相同则仅更新内存 state，跳过渲染（[overlays/queue.js:112-139](../../../public/js/overlays/queue.js#L112-L139)）。
- **歌单层**：`orderKey = songsRevision:sortMode`、`layoutKey`（字体族/字号组）、`motionKey`（滚动速度）三段指纹分别决定是否重建记录、重排或调速（[overlays/songs.js:116-160](../../../public/js/overlays/songs.js#L116-L160)）。
- **加班机层**：对 `revision`（修订号）做单调比较，`overtime:update` 的 `revision` ≤ 当前值直接丢弃；运行中按当前显示精度的下一秒/分钟/小时边界单次调度时钟，暂停、结束或页面隐藏时不保留时钟定时器（[overlays/overtime.js](../../../public/js/overlays/overtime.js)）。
- **管理页**：同样做 `overtime.revision` 单调校验（[state.js:59-65](../../../public/js/admin/state.js#L59-L65)）。

### 3.3 断线重连与退避

队列、歌单、盲盒、加班机、弹幕、礼物特效与直播歌词浏览器源以 ESM 共用 [overlays/socket-client.js](../../../public/js/overlays/socket-client.js)，`public/js/overlays` 下不再有自行 `new WebSocket(` 的页面（由 `test/engineering/module-boundaries.test.js` 的目录级用例约束）。连接器只负责 URL 构造（含可选 `topic` 订阅参数）、JSON 解析、连接代次控制、重连定时器、可选 `closeOnError` 以及幂等的 `start`/`connect`/`dispose`；消息筛选、状态替换、断线提示和恢复后的 HTTP 补拉仍由各页面自行负责，退避参数按页面传入。旧连接的回调和销毁后的重连不能影响新连接。该模块属于叠加层传输适配层，不放进仅收录稳定纯工具的 `shared/` 目录。

| 客户端 | 策略 | 出处 |
| --- | --- | --- |
| 管理页 `StateService` | `close` 后固定 **1600ms** 重连；`setShuttingDown(true)` 时改显示「程序已退出」并停止重连 | [state.js:81-92](../../../public/js/admin/state.js#L81-L92) |
| 叠加层（队列/歌单/盲盒/加班机） | 指数退避 `min(30000, 800 × 2^min(attempts,6))`，重连前先 `loadState()` 拿快照兜底 | [overlays/queue.js:86-93](../../../public/js/overlays/queue.js#L86-L93) |
| 弹幕叠加层 | 同上退避；URL 固定带 `topic=danmaku`，断线只更新连接状态文案，`pagehide` 释放连接 | [overlays/danmaku.js](../../../public/js/overlays/danmaku.js) |
| 礼物特效叠加层 | `min(30000, 1000 × 2^min(attempts,5))`；断线停用全屏特效，`pagehide` 释放连接与播放器 | [overlays/gift-effects.js](../../../public/js/overlays/gift-effects.js) |
| 直播歌词浏览器源 | `min(15000, 1000 × 2^min(attempts,4))`；连接器不显式加 token，本页 HTML 的 overlay bootstrap 会为本机 `/ws` 补入 `lyrics` scope 凭据；出错关闭连接走 `close` 路径，断线加 `is-disconnected` 类 | [overlays/lyric-window.js](../../../public/js/overlays/lyric-window.js) |
| `shutdown` | 服务关闭前广播 `shutdown`（见 [ws.md](../backend/ws.md) §3），管理页据此进入「程序已退出」状态 | [ws.md](../backend/ws.md) §3 |

### 3.4 客户端订阅的消息类型（全集见 [ws.md](../backend/ws.md) §3）

客户端按需订阅：`snapshot`（订阅快照的页面；`clock`/`opening` 仅通过 HTTP 获取）、`overtime:update`（管理页 + 加班机层，`revision` 去重）、`gift-catalog:update`（管理页加班机选择器，`version` 去重）、`wesing-state`（管理页 WeSing 面板）、`lyric-state`/`lyric-timeline`（管理页歌词预览、歌词窗口）、`shutdown`（管理页），以及 `gift:frame`、`game:update`/`game:draw`、`wheel:update`、`danmaku:message` 各自的专用订阅方。所有页面均不发送 WS 业务消息：服务端收到 overlay 业务帧后会以状态码 1008 关闭连接，收到管理端业务帧则校验后静默丢弃，仅正常处理协议控制帧（见 [ws.md](../backend/ws.md) §1）。

管理页收到 `shutdown` 即进入关闭终态，清理待执行的歌库刷新和重连定时器，并只发布一次 `app:shutdown`；后续 socket 关闭不安排重连。

## 4. 桌面桥（preload 命名空间）

桌面渲染进程通过预加载脚本的 `contextBridge` 获得受限命名空间，完整名称与通道注册表见 [desktop/preload.md](../desktop/preload.md)。下表仅列举典型通信入口（并非完整桥接清单）；普通浏览器环境**不会注入**这些对象，前端调用前必须先做特性检测：

| 桥 | 典型用法 | 检测方式 |
| --- | --- | --- |
| `window.songAssistantDesktop` | 窗口控制 `minimizeWindow/maximizeWindow/closeWindow/restart`、`onWindowMaximized` 图标切换、更新流程 `checkForUpdates/downloadUpdate/installUpdate`、`openDataDir/openLogDir/openGithub`、`setAutoUpdate` | `if (window.songAssistantDesktop)`（[settings-form.js](../../../public/js/admin/settings-form.js) 的 `initDesktopControls`） |
| `window.musicAPI` | 播放器域：登录态/健康 `getAuthState/providerHealth`、播放状态落盘 `savePlaybackState`（卸载/关机前刷新）、本地文件 `selectLocalFiles/getRecentLocalFiles/resolveLocalMediaUrls`、WeSing 目录选择 `selectWeSingCacheDirectory`、关机钩子 `onPrepareShutdown/confirmShutdownFlush` | `typeof window.musicAPI?.xxx === 'function'` |
| `window.bilibiliAuth` | Bilibili 扫码登录 `login/logout/getAuthState`；Web 模式禁用并显示「Web 模式（不可用）」 | `!!window.bilibiliAuth`（[settings-auth.js](../../../public/js/admin/settings-auth.js) 的 `initBilibiliAuth`） |
| `window.liraLicense` | 设备授权状态、重试、云端歌单与背景、目录初始化进度 | `typeof window.liraLicense?.xxx === 'function'` |

**降级路径**：同一功能优先走 IPC，后端不可用时再回退 HTTP（如 `ProviderManager.refreshProviderState` 先调用 `musicAPI.providerHealth(source)`，浏览器回退 `GET /api/music/health`，见 [provider/manager.js:42-64](../../../public/js/playback/provider/manager.js#L42-L64)）；`ProviderManager` 遇到 `auth-state` 等可选接口返回 404/501 时会标记为不可用并静默返回空态，避免重复请求（[provider/manager.js:86-100](../../../public/js/playback/provider/manager.js#L86-L100)）。

**桌面外壳启动**：`desktop.js` 的 `initDesktopShell()` 检测到 `window.songAssistantDesktop` 后给 `body` 加 `desktop-shell` 类并显示 `.desktop-only` 元素、绑定窗口控制与更新按钮、订阅 `onUpdateState`/`onShowUpdatePage` 回调、`getInfo()` 填充版本徽章（[desktop.js:10-94](../../../public/js/desktop.js#L10-L94)）；`settings-form.js` 的 `initDesktopControls` 为 `#winMinBtn/#winMaxBtn/#winCloseBtn` 绑定窗口操作并随 `onWindowMaximized` 切换最大化/还原图标（[settings-form.js](../../../public/js/admin/settings-form.js) 的 `initDesktopControls`）。

快照 `reason` 的完整触发来源、动态 `action` 及管理端副作用见 [ws.md §3.1](../backend/ws.md#31-snapshot-的-reason-枚举)。运行时合并快照只保留最后一个 `reason`，不能依赖它恢复每次操作；`StateService` 的歌库重载和礼物通知只对所属枚举触发，快照字段仍独立按版本应用。

## 5. 状态流总结

```
服务端业务变更 ──→ WS snapshot / 协商后的 patch ──→ 按字段版本接纳 state ──→ 指纹去重后重渲染
       ↑                                                    │
       └────── fetch POST /api/*（命令）◀── 用户操作/乐观刷新 ◀─┘
       B站礼物: lira-server detector ──→ 主进程 SSE/cursor importer ──→ 本地 gift service ──→ snapshot/WS gift:frame
       播放页: 本地 state/actions 先行，state-persistence 防抖落盘（HTTP + IPC 双通道）
```

管理快照提供完整恢复状态，overlay 快照按已验证 scope 裁剪；游戏画布、转盘、全屏礼物感谢和实时弹幕另有专用消息与恢复语义，见 [ws.md](../backend/ws.md)。HTTP 用于命令提交与状态查询，普通 JSON 响应使用 `{ok}` 统一响应格式；WebSocket 按 `{type, ...}` 分发，音频、图片与其他二进制响应不套用 JSON 外层结构。去重和退避由各订阅方按其契约执行。
