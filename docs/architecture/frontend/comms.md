# 前端通信:Token、HTTP、WebSocket 与桌面桥

> 涉及文件:[shared/utils.js](../../../public/js/shared/utils.js)、[shared/event-bus.js](../../../public/js/shared/event-bus.js)、[admin/state.js](../../../public/js/admin/state.js)、[admin/overtime.js](../../../public/js/admin/overtime.js)、[desktop.js](../../../public/js/desktop.js)、[overlays/queue.js](../../../public/js/overlays/queue.js)、[src/server/http-utils.js](../../../src/server/http-utils.js)

本文档描述前端与后端/桌面层的**通信客户端行为**。传输层实现、快照 16 字段、消息类型全集归 [ws.md](../backend/ws.md) 所有;端点清单归 [api.md](../backend/api.md) 所有;IPC 通道注册表归 [desktop/preload.md](../desktop/preload.md) 所有。

## 1. Token 获取与服务端注入

服务端在每次返回 HTML 时向 `</head>` 前注入一段脚本([http-utils.js:108-137](../../../src/server/http-utils.js#L108-L137),机制归 [server-core.md](../backend/server-core.md) §4.3),客户端侧表现为:

| 事实           | 客户端行为                                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全局令牌       | 注入脚本写 `window.__API_TOKEN__ = <uuid>`;页面其余脚本直接读取,无需自己请求                                                                                                                                                |
| fetch 补丁     | 注入脚本包装 `window.fetch`:对以 `/api/` 开头(除 `/api/health`)且未带 Authorization 的请求自动附加 `Authorization: Bearer <token>`                                                                                          |
| WebSocket 补丁 | 包装 `window.WebSocket`:URL 含 `/ws` 且无 `?token=` 时自动追加 `token=`(encodeURIComponent 编码)                                                                                                                            |
| 原生链接补丁   | 对同源 `/api/` 的 `<a href>` 补 `?token=`(原生导航带不了 Header)                                                                                                                                                            |
| 兜底           | 显式使用 token 的代码仍是合法模式:`utils.api()` 手动加 Bearer([utils.js:156](../../../public/js/shared/utils.js#L156))、`state.js` 拼接 `ws://host/ws?token=…`([state.js:31-32](../../../public/js/admin/state.js#L31-L32)) |

**Token 生命周期**:随服务启动生成、关闭删除(见 [server-core.md](../backend/server-core.md) §7)。页面缓存被禁止(`Cache-Control: no-store`),每次刷新都能拿到新注入的 token。

## 2. HTTP 模式(fetch + `{ok}` 信封)

### 2.1 工具函数([shared/utils.js](../../../public/js/shared/utils.js))

| 函数                                                                                              | 用途                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `api(url, body)`                                                                                  | POST JSON 便捷封装:自动 `Content-Type: application/json` + Bearer 头;解析信封后 `!payload.ok` 抛错;出错先 `showError` 再抛 |
| `readJsonResponse(response, fallbackMessage)`                                                     | 统一响应解析:空响应→`{}`;非 JSON→带 HTTP 状态码与内容预览的报错;正常→`JSON.parse`                                          |
| `showError(error)` / `toast(message)` / `showStackedToast(options)`                               | 错误与提示:全局 `#toast` 容器,支持 key 去重、点击回调、礼物通知最多 6 条上限                                               |
| `escapeHtml` / `escapeAttr`                                                                       | 渲染前转义(所有模板插值必须经此)                                                                                           |
| `formatBytes` / `formatMoney` / `formatCompactNumber` / `formatDuration` / `formatSuperChatPrice` | 展示格式化                                                                                                                 |
| `debounce` / `normalizeRangeValue`                                                                | 输入防抖与滑块数值归一                                                                                                     |
| `dangerConfirm` / `logoutConfirm`                                                                 | 危险操作 / 退出登录的自绘确认弹窗(替代原生 confirm)                                                                        |
| `localOverlayOrigin(locationLike)`                                                                | 以 `127.0.0.1` 规范化叠加层 URL(供管理页生成 OBS 地址)                                                                     |
| `withMultilingualFallback(fontFamily)`                                                            | 字体栈追加多语言回退                                                                                                       |

### 2.2 响应信封约定

- 所有 `/api/*` 成功返回 `{ok:true, data:…}`,失败返回 `{ok:false, error:…}`,统一由 `sendJson` 包装(见 [server-core.md](../backend/server-core.md) §4.3)。
- 前端错误呈现:普通失败 `toast(错误信息)`;表单提交失败走 `showError`;直播刷新失败走 `forms.reconnectErrorMessage()` 把网络类错误翻译成可操作文案([forms.js:316-325](../../../public/js/admin/forms.js#L316-L325))。
- 404/501 探测:`ProviderManager` 把 `auth-state` 类可选接口的 404/501 标记为"不可用",避免重复请求([provider/manager.js:86-100](../../../public/js/playback/provider/manager.js#L86-L100))。

### 2.3 状态获取与乐观更新

- 全量状态:`GET /api/state`(快照 16 字段,见 [ws.md](../backend/ws.md) §2),管理页 `StateService.reloadState()`、叠加层 `loadState()` 首屏都用它兜底(WS 未连上时保证可渲染)。
- 歌库:`GET /api/songs?query=&category=&language=&artist=&tag=&enabledOnly=`([state.js:128-155](../../../public/js/admin/state.js#L128-L155))。
- **乐观 UI**:管理页所有变更操作(POST 后)立即调用 `reloadState()/reloadAll()` 重取,不等待 WS 广播;快照到达后对歌库相关变更做 **240ms 防抖**重载(`scheduleSongReload`,合并短时间内多次快照,[state.js:160-165](../../../public/js/admin/state.js#L160-L165));播放页则是本地状态先行 + `savePlaybackState()` 落盘(见 [playback.md](playback.md) §6)。
- **错误呈现分工**:表单/操作类错误 → `showError`(toast);`reconnectBilibili` 等直接 fetch 的调用自己解析 `{ok}` 信封并处理 404/网络类错误;静默上报类(歌词状态、队列状态落盘)失败只丢弃不打扰用户。

## 3. WebSocket 客户端

### 3.1 连接与快照处理

| 事实       | 行为                                                                                                                                                                                                                                                        | 出处                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 连接 URL   | `(wss\|ws)://<host>/ws?token=<token>`(token 自动追加或手动拼)；固定 `/danmaku` 追加 `topic=danmaku` 订阅高频弹幕事件                                                                                                                                        | [state.js:30-33](../../../public/js/admin/state.js#L30-L33)、[overlays/danmaku.js](../../../public/js/overlays/danmaku.js) |
| 首帧       | 连接建立即收 `{type:'snapshot', reason:'connect', state}` 全量快照(契约见 [ws.md](../backend/ws.md) §2)                                                                                                                                                     | [ws.md](../backend/ws.md) §2                                                                                               |
| 协议选择   | `location.protocol === 'https:' ? 'wss:' : 'ws:'`,与页面同源(`location.host`)                                                                                                                                                                               | [state.js:30](../../../public/js/admin/state.js#L30)                                                                       |
| 只读客户端 | 前端**不发送任何业务消息**给服务端;`shutdown` 消息到达后停止重连                                                                                                                                                                                            | [ws.md](../backend/ws.md) §1                                                                                               |
| 全量替换   | 每次 snapshot 用 `payload.state` **整体替换**本地状态再重渲染,不做增量合并                                                                                                                                                                                  | [state.js:44-58](../../../public/js/admin/state.js#L44-L58)                                                                |
| 局部消息   | `overtime:update`/`wesing-state`/`lyric-state`/`lyric-timeline` 只更新对应字段并派发 CustomEvent(`app:overtime`、`app:wesing-state`、`app:lyric-state`、`app:lyric-timeline`)；`gift-catalog:update` 不写入全量 state，只派发 `Events.GIFT_CATALOG_UPDATED` | [state.js:59-86](../../../public/js/admin/state.js#L59-L86)                                                                |
| 礼物触发   | reason ∈ {`bilibili:gift`,`gift:clear-recent`,`database:clear-gifts`,`database:clear-all`} 时额外发 `gift:received` 事件                                                                                                                                    | [state.js:215-220](../../../public/js/admin/state.js#L215-L220)                                                            |

### 3.2 指纹去重(叠加层)

叠加层不重渲染"内容没变"的快照:

- **队列层**:`computeStateKey()` 把当前歌曲 + 等待队列 + SC + 全部主题键拼成 JSON 指纹;指纹相同→只更新内存 state,跳过渲染([overlays/queue.js:112-139](../../../public/js/overlays/queue.js#L112-L139))。
- **歌单层**:`orderKey = songsRevision:sortMode`、`layoutKey`(字体族/字号组)、`motionKey`(滚动速度)三段指纹分别决定是否重建记录/重排/调速([overlays/songs.js:116-160](../../../public/js/overlays/songs.js#L116-L160))。
- **加班机层**:`revision` 单调比较,`overtime:update` 的 revision ≤ 当前值直接丢弃；运行中按当前显示精度的下一秒/分钟/小时边界单次调度时钟，暂停、结束或页面隐藏时不保留时钟定时器([overlays/overtime.js](../../../public/js/overlays/overtime.js))。
- **管理页**:同样做 `overtime.revision` 单调校验([state.js:59-65](../../../public/js/admin/state.js#L59-L65))。

### 3.3 断线重连与退避

| 客户端                        | 策略                                                                                      | 出处                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 管理页 `StateService`         | close 后固定 **1600ms** 重连;`setShuttingDown(true)` 时改显示"程序已退出"并停止重连       | [state.js:81-92](../../../public/js/admin/state.js#L81-L92)             |
| 叠加层(队列/歌单/盲盒/加班机) | 指数退避 `min(30000, 800 × 2^min(attempts,6))`,重连前先 `loadState()` 拿快照兜底          | [overlays/queue.js:86-93](../../../public/js/overlays/queue.js#L86-L93) |
| 桌面歌词浏览器源              | `min(15000, 1000 × 2^min(attempts-1,4))`,连接恢复后继续接收状态与时间轴                   | [overlays/lyric-window.js](../../../public/js/overlays/lyric-window.js) |
| shutdown                      | 服务关闭前广播 `shutdown`(见 [ws.md](../backend/ws.md) §3),管理页据此进入"程序已退出"状态 | [ws.md](../backend/ws.md) §3                                            |

### 3.4 客户端消费的消息类型(全集在 [ws.md](../backend/ws.md) §3)

`snapshot`(所有页面)、`overtime:update`(管理页 + 加班机层,revision 去重)、`gift-catalog:update`(管理页加班机选择器,version 去重)、`wesing-state`(管理页 WeSing 面板)、`lyric-state`/`lyric-timeline`(管理页歌词预览、歌词窗口)、`shutdown`(管理页)。所有页面都不向服务端发送业务消息(服务端丢弃客户端帧,见 [ws.md](../backend/ws.md) §1)。

## 4. 桌面桥(preload 暴露的三个命名空间)

桌面渲染进程通过 preload 的 `contextBridge` 获得三个命名空间(通道注册表见 [desktop/preload.md](../desktop/preload.md)),浏览器环境**不注入**,前端一律先做特性检测:

| 桥                            | 典型用法                                                                                                                                                                                                                                                                      | 检测方式                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `window.songAssistantDesktop` | 窗口控制 `minimizeWindow/maximizeWindow/closeWindow/restart`、`onWindowMaximized` 图标切换、更新流程 `checkForUpdates/downloadUpdate/installUpdate`、`openDataDir/openLogDir/openGithub`、`setAutoUpdate`                                                                     | `if (window.songAssistantDesktop)`([settings.js:327](../../../public/js/admin/settings.js#L327)) |
| `window.musicAPI`             | 播放器域:登录态/健康 `getAuthState/providerHealth`、播放状态落盘 `savePlaybackState`(卸载/关机前刷新)、本地文件 `selectLocalFiles/getRecentLocalFiles/resolveLocalMediaUrls`、WeSing 目录选择 `selectWeSingCacheDirectory`、关机钩子 `onPrepareShutdown/confirmShutdownFlush` | `typeof window.musicAPI?.xxx === 'function'`                                                     |
| `window.bilibiliAuth`         | Bilibili 扫码登录 `login/logout/getAuthState`;Web 模式禁用并显示"Web 模式(不可用)"                                                                                                                                                                                            | `!!window.bilibiliAuth`([settings.js:23-30](../../../public/js/admin/settings.js#L23-L30))       |

**降级路径**:同一功能先走 IPC、后端不可用再回退 HTTP(如 `ProviderManager.refreshProviderState` 先 `musicAPI.providerHealth(source)`,浏览器回退 `GET /api/music/health`([provider/manager.js:42-64](../../../public/js/playback/provider/manager.js#L42-L64)));登录态接口 404/501 时标记不可用并静默返回空态。

**桌面外壳启动**:`desktop.js` 的 `initDesktopShell()` 检测到 `window.songAssistantDesktop` 后给 `body` 加 `desktop-shell` 类并显示 `.desktop-only` 元素、绑定窗口控制与更新按钮、订阅 `onUpdateState`/`onShowUpdatePage` 回调、`getInfo()` 填充版本徽章([desktop.js:10-94](../../../public/js/desktop.js#L10-L94));`settings.js` 为 `#winMinBtn/#winMaxBtn/#winCloseBtn` 绑定窗口操作并随 `onWindowMaximized` 切换最大化/还原图标([settings.js:327-351](../../../public/js/admin/settings.js#L327-L351))。

## 5. 状态流总结

```
服务端业务变更 ──→ WS 全量 snapshot ──→ 各页面整体替换本地 state ──→ 指纹去重后重渲染
       ↑                                                    │
       └────── fetch POST /api/*(命令) ◀── 用户操作/乐观刷新 ◀─┘
       播放页:本地 StateManager 先行,state-persistence 防抖落盘(HTTP + IPC 双通道)
```

快照是**唯一实时真相源**;HTTP 用于命令与冷启动兜底;两路数据最终都要过 `{ok}` 信封与上述去重/退避约定。
