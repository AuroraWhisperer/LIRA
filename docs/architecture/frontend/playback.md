# 播放引擎(playback/)

> 涉及文件:[js/playback.js](../../../public/js/playback.js)、[js/playback/index.js](../../../public/js/playback/index.js)、[js/playback/controller.js](../../../public/js/playback/controller.js)、[js/playback/core/](../../../public/js/playback/core/)、[js/playback/state/](../../../public/js/playback/state/)、[js/playback/provider/](../../../public/js/playback/provider/)、[js/playback/queue/](../../../public/js/playback/queue/)、[js/playback/services/](../../../public/js/playback/services/)、[js/playback/features/](../../../public/js/playback/features/)、[js/playback/operations/](../../../public/js/playback/operations/)、[js/playback/ui/](../../../public/js/playback/ui/)、[js/playback/content/](../../../public/js/playback/content/)、[js/playback/local/](../../../public/js/playback/local/)、[js/playback/cache/](../../../public/js/playback/cache/)、[js/playback/config.js](../../../public/js/playback/config.js)、[js/playback/utils.js](../../../public/js/playback/utils.js)、[js/admin/app.js](../../../public/js/admin/app.js)

本文档描述播放引擎(播放助手页,`/admin#playback`)的模块结构与核心流程。音乐平台 Provider 服务端实现见 [qq-music-provider.md](../backend/music/qq-provider.md)/[netease-music-provider.md](../backend/music/netease-provider.md) 与 [api.md](../backend/api.md);播放数据落库见 [storage.md](../backend/storage.md) §3.4;歌词上报的 WS 契约见 [ws.md](../backend/ws.md) §3;IPC 通道见 [desktop/preload.md](../desktop/preload.md)。

## 1. 入口与模块树

```
js/playback.js          兼容层,仅 import playback/index.js
└── playback/index.js   挂 window.AdminApp.playback.initPlaybackAssistant,
                        派发 'playback-module-loaded' 事件(admin app.js 监听)
    └── controller.js   编排层 createPlaybackController():创建全部管理器/服务/功能模块并接线
```

模块树([controller.js:5-51](../../../public/js/playback/controller.js#L5-L51)):

| 目录          | 模块                                                                                                                                                                   | 职责                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`       | initializer / renderer / event-handlers / queue-coordinator / action-adapters                                                                                          | 初始化时序、渲染与 DOM 事件；队列/播放委托接线；把控制器依赖收窄为各功能实际需要的动作适配器                                                        |
| `state/`      | manager / storage                                                                                                                                                      | `StateManager` 响应式状态(createInitialState/validateState/normalizeState);`StorageManager` 状态恢复(服务端优先→localStorage v2→v1 迁移)            |
| `provider/`   | manager                                                                                                                                                                | 平台选择(QQ/网易云/WeSing)、健康检查、登录态;桌面走 IPC、Web 回退 HTTP(见 [comms.md](comms.md) §4)                                                  |
| `queue/`      | manager                                                                                                                                                                | `QueueManager`:普通/电台/歌单三种队列、shuffle 顺序、电台自动补量                                                                                   |
| `services/`   | search / stream / lyric / match / import / home / wesing                                                                                                               | 业务服务(§4)                                                                                                                                        |
| `features/`   | search-handler / match-handler / stream-handler / queue-operations / playback-controls / lyric-controls / radio-mode / home-handler / import-handler / pending-handler | UI 操作处理器,注入渲染回调与队列回调                                                                                                                |
| `operations/` | provider-operations / state-persistence / playlist-operations / cache-operations                                                                                       | 横切操作:登录登出、状态持久化、收藏/歌单、缓存统计                                                                                                  |
| `ui/`         | index / components / playback-bar / queue-popup / drawer / fullscreen                                                                                                  | `UIRenderer` + 各 UI 组件(DOM 渲染主控)                                                                                                             |
| `content/`    | loader                                                                                                                                                                 | 首页/推荐/每日/电台/歌单内容加载(内存→localStorage 缓存命中先渲染,后台刷新后回调 `homeService._applyBackgroundUpdate` 更新并 toast)                 |
| `local/`      | manager                                                                                                                                                                | 本地音频文件(选择/最近历史/URL 解析)                                                                                                                |
| `cache/`      | manager                                                                                                                                                                | "我喜欢"/歌单 24h localStorage 缓存(`playbackCache:` 前缀,内存→localStorage 两级,过期失效,登录态变化清缓存)                                         |
| —             | config.js / utils.js                                                                                                                                                   | 配置常量(§2);工具(轨道归一化/序列化/洗牌/本地判定/URL 可用性/时长与元数据格式化/封面渲染/背景主题选取 `pickBackgroundTheme`)                        |

**依赖注入方式**:`controller.js` 是播放域的组合根,功能模块通过 `create*(deps)` 工厂只接收自身实际使用的字段。`queue-coordinator.js` 集中建立队列/播放/电台间的命名委托，`action-adapters.js` 把控制器能力裁剪为各功能所需动作；两者不持有 DOM 或业务状态。播放、渲染和电台之间的初始化顺序由命名委托函数延迟绑定,不使用可变前向声明或通用 `sharedDeps` 依赖包;工厂参数因此可以从源码直接审计。

## 2. 播放主流程

```
搜索/点歌匹配/歌单/电台 ──→ queueManager 入队(startCollection/insertTracksNext/appendTracks)
        │
        ▼
playbackControls.playPlaybackTrack(track,{origin})
        │
        ├─ 本地曲目:musicAPI.resolveLocalMediaUrls(filePath) → local-media:// 或 objectUrl
        └─ 在线曲目:StreamService.getTrackUrl(track)
                └─ hasUsableUrl? 直接复用 : POST /api/music/resolve-stream
                    (服务端解析直链并带 expireAt;前端在过期前 30 秒
                     STREAM_REFRESH_MARGIN_MS 强制刷新;失败重试 STREAM_MAX_RETRIES=1 次)
        │
        ▼
playbackControls → audio.load()/play()
        │
        ├─ timeupdate → renderPlaybackProgress + savePlaybackState + syncPlaybackLyricWindow
        ├─ ended → playbackNext(true)(单曲循环/下一首/列表循环回绕;电台队列自动补量)
        └─ error → streamHandler.handlePlaybackError(刷新 URL 重试,仍失败跳过)
```

关键常量([config.js](../../../public/js/playback/config.js)):`STREAM_REFRESH_MARGIN_MS=30s`、`STREAM_MAX_RETRIES=1`、`RADIO_REFILL_THRESHOLD=3`、`RADIO_REFILL_BATCH_SIZE=10`、`HISTORY_MAX_SIZE=50`、`DISPLAY_HISTORY_MAX_SIZE=200`、`FULLSCREEN_BG_THEME_COUNT=30`。

**唯一播放实现**：[features/playback-controls.js](../../../public/js/playback/features/playback-controls.js) 处理实际播放命令；旧的重复播放器类和仅用于 `setAudio` 的组合接线已移除。

| 操作 | 行为 |
| ---- | ---- |
| `playPlaybackTrack` | 解析音源并以播放代际保护迟到结果，更新当前曲目和历史后驱动 audio |
| `togglePlayback` | 无当前曲目时取下一首，否则在有效音源上切换播放/暂停 |
| `playbackPrevious` | 当前进度超过 5 秒先回到开头，否则读取播放历史 |
| `playbackNext` | 保留单曲循环、队列推进、列表回绕及电台补量语义 |
| `changePlaybackQuality` | 保存音质选择并重新解析当前流，恢复切换前进度 |

播放与持久化共同读取 `PlaybackConfig` 中的历史上限，不再分别硬编码限制。

**播放历史**:前端不直接写 `play_history` 表——每次状态落盘时把 `history/displayHistory`(各 50/200 条上限)放进 queue-state 载荷,服务端 `playback-store.recordPlay` 按 `(client_id, track_key)` 幂等累加 `play_count`(见 [storage.md](../backend/storage.md) §3.4)。

## 3. 歌词链路

| 环节             | 实现                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 获取             | `LyricService.loadLyrics(track)` → `POST /api/music/lyrics`(按 source 走 QQ/网易云解析,本地与已缓存跳过)                                                                                                                                                                                                                                                           |
| 行定位           | `findLyricLine` 对 `lines[]` 做二分查找([lyric-service.js:62-88](../../../public/js/playback/services/lyric-service.js#L62-L88))                                                                                                                                                                                                                                   |
| 逐字进度         | `shared/lyric-clock.js` 按 `performance.now()` 计算本地位置;`LyricWordRenderer` 使用 `LyricFrameScheduler` 的 rAF+33.3ms 门控;当前行 `LyricWordAnimator` 优先 WAAPI reveal,按性能档位回退到 30fps 手动 reveal/静态高亮                                                                                                                                             |
| **上报**         | `publishBrowserState`:`POST /api/playback/lyric-state`(100ms 取整 + 180ms 节流 + latest-wins 队列);每条状态兼容携带 `generation`/`sequence`,切歌/seek/时间线变化切 generation;`publishBrowserTimeline`:`POST /api/playback/lyric-timeline`(trackKey+歌词引用去重,只发一次)——服务端收到后转 WS 广播 `lyric-state`/`lyric-timeline`(见 [ws.md](../backend/ws.md) §3) |
| 桌面歌词浏览器源 | `syncWindow` 仅通过 HTTP 发布状态与完整时间轴;`/lyrics` 经 WebSocket 消费 `lyric-state`/`lyric-timeline`并复用管理页实时预览渲染                                                                                                                                                                                                                                   |

## 4. 服务层(services/)

| 服务           | 职责与端点(定义见 [api.md](../backend/api.md))                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| search-service | 在线搜索 `POST /api/music/search`(platform/keyword/limit,默认 9 条),`searchGeneration` 防串号(旧请求结果丢弃)                                                                                                                                    |
| stream-service | 播放流解析 `POST /api/music/resolve-stream`(`forceRefresh` + `quality`),URL 缓存 + 30s 刷新边距 + 1 次重试;Provider 返回的实际 `quality` 回写 track,用于展示权益降级                                                                             |
| lyric-service  | 歌词加载、行定位、浏览器端 lyric-state/timeline 上报(§3)                                                                                                                                                                                         |
| match-service  | 点歌匹配:`/api/music/search` 候选 → `POST /api/music/match-track` 匹配,未匹配进入 `pendingRequests` 待确认(弹确认弹窗)                                                                                                                           |
| import-service | 点歌队列导入:读 `/api/state` 的 queue 快照 → 按 track 结构转换后插入播放队列                                                                                                                                                                     |
| home-service   | 首页内容 `POST /api/music/home`(action: 推荐/每日/电台/歌单…),`ContentLoader` 提供缓存 + 后台刷新(首页命中缓存先渲染,后台更新后 toast"已自动更新")                                                                                               |
| wesing-service | 全民 K 歌适配层:`/api/music/wesing/*`(active/refresh/configure/offset)+ WS `wesing-state` 实时状态 + `LyricWordRenderer` 逐字现场(详见 [backend/music/wesing.md](../backend/music/wesing.md));源切换用 `activationQueue` 串行化,避免后端状态错乱 |

首页请求在开始时固定平台、action、歌单 ID 和缓存键。HomeService 的代际决定页面是否接受结果，ContentLoader 的每键请求代际决定缓存是否接受写入：切换分类、最近历史、音源或返回历史后，旧成功和旧失败均不能覆盖新页面。后台刷新使用局部结果，不把页面状态当临时工作区；重复缓存读取可复用在途刷新，同键较新的实际请求优先，完成后清理请求记录。可缓存 action 只由 ContentLoader 的 `CACHEABLE_ACTIONS` 定义，HomeService 复用该集合。

## 5. 队列、电台与歌单

- **三种队列形态**:`normalQueue`(点歌队列/歌单播放)、`radioQueue`(电台)、`normalQueueTracks`(歌单全量,`playlistIndex` 游标);`queueType` ∈ queue/playlist/radio;`requestedQueue` 承载观众点歌待确认项。`insertTracksNext` 在 playlist 模式从 `playlistIndex+1` 处插入,`removeTrack` 同步从全量列表剔除;`clearQueue` 复位全部队列与 shuffle 游标([queue/manager.js:83-95](../../../public/js/playback/queue/manager.js#L83-L95))。
- **播放模式**:`mode` ∈ sequence/loop/single/shuffle,`cycleMode()` 轮换;shuffle 用 `shuffleOrder` 索引数组 + `shuffleCursor` 游标(`rebuildShuffleOrder` Fisher–Yates,游标越界回退顺序取队首)。
- **电台补量**:`ensureRadioQueueFilled` 在电台队列 ≤3 首时按 10 首一批 `POST /api/music/home`(action=radio),过滤最近 30 首历史与队列内重复([queue/manager.js:244-290](../../../public/js/playback/queue/manager.js#L244-L290))。
- **收藏/歌单**:`playlist-operations.js` 走 `/api/music/playlists/tracks/add|remove`、`/api/music/home`(歌单列表)与 `POST /api/playback/favorites` 系列;收藏/歌单数据经 `CacheManager` 24h 缓存跨启动保留。
- **缓存统计**:`cache-operations.js` 展示 `GET /api/music/cache` 并支持 `/api/music/cache/clear`。

## 6. 状态持久化(play_queue_state)

| 通道                                  | 触发点                                                                       | 说明                                                                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP `POST /api/playback/queue-state` | 常规保存(1500ms 防抖)、卸载 `sendBeacon`(带 token)、关机前 `keepalive` fetch | 服务端写 `musicDb.play_queue_state`(client_id PK,见 [storage.md](../backend/storage.md) §3.4)                                                                                                                                        |
| IPC `musicAPI.savePlaybackState`      | 卸载/关机刷新(桌面优先,IPC 失败回退 HTTP)                                    | 通道见 [desktop/preload.md](../desktop/preload.md);Electron 关机钩子 `onPrepareShutdown → flushPlaybackStateForShutdown → confirmShutdownFlush`([initializer.js:117-129](../../../public/js/playback/core/initializer.js#L117-L129)) |
| localStorage `playbackState:v2`       | `StorageManager._doSave` 防抖 1500ms                                         | 仅作本地镜像与 v1(`songAssistantPlaybackState:v1`)迁移源                                                                                                                                                                             |

**恢复顺序**:`restoreState()` 优先 `GET /api/playback/queue-state?clientId=default` → localStorage v2 → v1 迁移([state/storage.js:97-120](../../../public/js/playback/state/storage.js#L97-L120))。`currentTime` 恢复为 `restoredTime`(不保存播放位置,见 [state/storage.js:81](../../../public/js/playback/state/storage.js#L81))。恢复的本地曲目经 `restoreLocalFileUrls()` 用 `musicAPI.resolveLocalMediaUrls(paths)` 批量解析成 `local-media://` URL,失败标记 `fileMissing`。

QQ 轨道持久化保留 `sourceMediaId`、`sourceSongId`、`sourceSongType`;最后一项必须跨重启送回 Provider,否则 HAR 中 `songtype: 1` 的付费歌曲会被错误降为类型 `0`。`qualityPreferences` 按 Provider 保存:QQ 为 `standard/high/lossless/premium/immersive`,网易云为 `standard/higher/exhigh/lossless/hires`;后两项通过本地 QMC2 Range 代理，不能承诺 QQ 客户端的 Dolby/空间 DSP 效果。

## 7. 本地文件与桌面集成

- 选择文件:`LocalFileManager.selectLocalFiles()` 走 `musicAPI.selectLocalFiles`(桌面文件对话框,取消返回空);最近历史 `musicAPI.getRecentLocalFiles`。
- 播放:`local-media://media/<base64url-encoded-path>` 协议由 Electron main 注册与鉴权(`local-media-allowlist.json` 允许清单,见 [desktop/main.md](../desktop/main.md));恢复的 objectUrl 仅会话内有效,重启后需重新解析。
- 桌面检测:统一约定 `window.musicAPI` 是否存在及其方法是否为 function;播放页在浏览器直开时本地文件与歌词窗口功能自动降级隐藏([comms.md](comms.md) §4)。

## 8. UI 与事件

- `ui/index.js` `UIRenderer` 渲染整页;`ui/playback-bar.js` 底部控制栏(进度/播放暂停/上下首/音量/模式/队列弹出/歌词);`ui/fullscreen.js` 全屏播放器(点击面板切换,ESC 退出,空格播放暂停,封面背景按 `pickBackgroundTheme` 30 套轮换,[forms.js:74-92](../../../public/js/admin/forms.js#L74-L92));`ui/drawer.js` 首页抽屉(歌单内页与返回栈);`ui/queue-popup.js` 队列弹出窗(收起播放器时联动关闭)。
- **音质菜单**:`ui/playback-bar.js` 对 QQ 显示标准(128kbps)/HQ(最高 320kbps)/SQ(FLAC)/臻品(Q0 本地解密)/全景声(O8 本地解密),对网易云显示五档;`features/playback-controls.js:changePlaybackQuality` 保存默认档位、强制刷新当前流并在 `loadedmetadata` 后恢复切换前进度。服务端若降级,按钮显示实际档位并 toast 提示。Q0/O8 不承诺 QQ 客户端专属杜比或空间 DSP 效果,边界见 [qq-provider.md](../backend/music/qq-provider.md) §7.2。
- **工作区集成**:播放器 dock 默认收起(`player-dock-collapsed`,避免遮挡点歌工作区),由 `forms.js` 的 `setPlayerDockCollapsed` 统一管理,收起时联动关闭全屏播放器/队列弹窗/音量面板([forms.js:133-169](../../../public/js/admin/forms.js#L133-L169))。
- `core/event-handlers.js` 绑定播放页 DOM 事件(搜索框、队列操作、抽屉、全屏按钮、媒体会话按键),控制器显式注入其所需回调;`core/renderer.js` 输出渲染函数(进度/全屏/待确认弹窗/搜索结果/首页结果/匹配结果)供控制器组合。
- 播放器状态变化统一走 `onStateChange → renderPlayback() + savePlaybackState()`;MediaSession(系统媒体控制)由 `updatePlaybackMediaSession(togglePlayback, playbackPrevious, playbackNext)` 更新([controller.js:531-533](../../../public/js/playback/controller.js#L531-L533))。
- 音频事件链([initializer.js:67-113](../../../public/js/playback/core/initializer.js#L67-L113)):`loadedmetadata` 回写 `durationMs` → `timeupdate` 推进进度条并落盘 → `play/pause` 同步 MediaSession 与歌词窗口 → `seeking/seeked` 强刷歌词与状态 → `ended` 触发 `playbackNext(true)` → `error` 走流刷新重试;`pagehide` 时 `flushPlaybackStateOnUnload`(sendBeacon/IPC 双通道,见 §6)。

### 8.1 歌词动画性能边界

- WAAPI 只代表动画调度方式，不保证 reveal 属性由 GPU 合成；运行时以 `LyricPerformanceProfile` 记录长帧，必要时按 WAAPI → 30fps 手动 reveal → 静态高亮降级。
- 正常播放期间不在 30fps tick 写 `animation.currentTime`;tick 只读取 `LyricClock` 并检测 drift。仅 pause/resume、seek、切歌/时间线变化、明显回跳或超阈值 drift 允许重锚。
- 调度器只使用 `requestAnimationFrame` + 约 33.3ms 时间门控，不使用 `setInterval`；页面隐藏、暂停或 reduced-motion 时停止/暂停循环。

## 9. 与点歌业务的关系

- 点歌队列导入:播放页"导入点歌队列"把 `/api/state` 的 `queue` 快照转成播放队列(import-service),不经过 match。
- 点歌匹配诊断:管理页"点歌匹配诊断"区(match-handler)把当前队列条目与在线搜索/匹配结果对照,定位匹配失败原因。
- 曲库互操作:`initPlaybackAssistant` 注入 `getSongs/reloadSongs`,播放页可用歌库曲目一键入队(来源 `admin`)。
