# 播放引擎(playback/)

> 涉及文件:[js/playback.js](../../../public/js/playback.js)、[js/playback/index.js](../../../public/js/playback/index.js)、[js/playback/controller.js](../../../public/js/playback/controller.js)、[js/playback/core/](../../../public/js/playback/core)、[js/playback/state/](../../../public/js/playback/state)、[js/playback/provider/](../../../public/js/playback/provider)、[js/playback/queue/](../../../public/js/playback/queue)、[js/playback/services/](../../../public/js/playback/services)、[js/playback/features/](../../../public/js/playback/features)、[js/playback/operations/](../../../public/js/playback/operations)、[js/playback/ui/](../../../public/js/playback/ui)、[js/playback/content/](../../../public/js/playback/content)、[js/playback/local/](../../../public/js/playback/local)、[js/playback/cache/](../../../public/js/playback/cache)、[js/playback/config.js](../../../public/js/playback/config.js)、[js/playback/utils.js](../../../public/js/playback/utils.js)、[js/admin/app.js](../../../public/js/admin/app.js)

本文档描述播放引擎(播放助手页,`/admin#playback`)的模块结构与核心流程。音乐平台 Provider 服务端实现见 [qq-music-provider.md](../backend/music/qq-provider.md)/[netease-music-provider.md](../backend/music/netease-provider.md) 与 [api.md](../backend/api.md);播放数据落库见 [storage.md](../backend/storage.md) §3.4;歌词上报的 WS 契约见 [ws.md](../backend/ws.md) §3;IPC 通道见 [desktop/preload.md](../desktop/preload.md)。

## 1. 入口与模块树

```
js/playback.js          兼容层,仅 import playback/index.js
└── playback/index.js   发布 window.AdminApp.playback 的 initPlaybackAssistant / closeQueuePopup,
                        派发 'playback-module-loaded' 事件(admin app.js 监听)
    └── controller.js   编排层 createPlaybackController():创建全部管理器/服务/功能模块并接线
```

模块树([controller.js:5-51](../../../public/js/playback/controller.js#L5-L51)):

| 目录          | 模块                                                                                                                                                                   | 职责                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`       | initializer / renderer / event-handlers / queue-coordinator / action-adapters                                                                                          | 初始化时序、渲染与 DOM 事件；队列/播放委托接线；把控制器依赖收窄为各功能实际需要的动作适配器                                                        |
| `state/`      | manager / actions / storage                                                                                                                                                      | 初始状态/校验/恢复与显式状态操作;`StorageManager` 状态恢复(服务端优先→localStorage v2→v1 迁移)            |
| `provider/`   | manager                                                                                                                                                                | 平台选择(QQ/网易云/WeSing)、健康检查、登录态;桌面走 IPC、Web 回退 HTTP(见 [comms.md](comms.md) §4)                                                  |
| `queue/`      | manager                                                                                                                                                                | `QueueManager`:普通/电台/歌单三种队列、shuffle 顺序、电台自动补量                                                                                   |
| `services/`   | search / stream / lyric / match / import / home / wesing                                                                                                               | 业务服务(§4)                                                                                                                                        |
| `features/`   | search-handler / match-handler / stream-handler / queue-operations / playback-controls / lyric-controls / radio-mode / home-handler / import-handler / pending-handler / output-device | UI 操作处理器与本机音频输出,注入渲染回调与队列回调                                                                                                                |
| `operations/` | provider-operations / state-persistence / playlist-operations / cache-operations                                                                                       | 横切操作:登录登出、状态持久化、收藏/歌单、缓存统计                                                                                                  |
| `ui/`         | index / components / playback-bar / queue-popup / drawer / fullscreen                                                                                                  | `UIRenderer` + 各 UI 组件(DOM 渲染主控)                                                                                                             |
| `content/`    | loader                                                                                                                                                                 | 首页/推荐/每日/电台/歌单内容加载(内存→localStorage 缓存命中先渲染,后台刷新后回调 `homeService.applyBackgroundUpdate` 更新并 toast)                 |
| `local/`      | manager                                                                                                                                                                | 本地音频文件(选择/最近历史/URL 解析)                                                                                                                |
| `cache/`      | manager                                                                                                                                                                | "我喜欢"/歌单 24h localStorage 缓存(`playbackCache:` 前缀,内存→localStorage 两级,过期失效,登录态变化清缓存)                                         |
| —             | config.js / utils.js                                                                                                                                                   | 配置常量(§2);工具(轨道归一化/序列化/洗牌/本地判定/URL 可用性/时长与元数据格式化/封面渲染/背景主题选取 `pickBackgroundTheme`)                        |

**依赖注入方式**:`controller.js` 是播放域的组合根,功能模块通过 `create*(deps)` 工厂只接收自身实际使用的字段。`queue-coordinator.js` 集中建立队列/播放/电台间的命名委托，`action-adapters.js` 把控制器能力裁剪为各功能所需动作；两者不持有 DOM 或业务状态。播放、渲染和电台之间的初始化顺序由命名委托函数延迟绑定,不使用可变前向声明或通用 `sharedDeps` 依赖包;工厂参数因此可以从源码直接审计。

`initPlaybackAssistant(options)` 首次创建控制器时固定 `toast`、`showError`、`readJsonResponse`（未提供时使用共享 Utils），在构造子模块之前完成注入；后续初始化不替换依赖。首次提供的 `getWeSingState` 保留为 getter，每次初始化读取当前状态。`closeQueuePopup` 委托既有队列 UI 关闭逻辑，统一更新 DOM、打开状态和焦点；初始化前调用为空操作，供 Admin 收起播放器时晚绑定使用。

## 2. 播放主流程

歌词加载绑定本次播放和歌词请求代次；A→B→A 后旧 A 的失败或成功不能覆盖新 A 的歌词或发布空时间轴。同曲手动刷新也只接受最后一次请求。全民 K 歌偏移编辑使用独立草稿修订，旧保存确认或失败不清除保存期间的新输入；新输入仍需后续 change 提交。

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

电音助手的[内部倍速适配](../../../public/js/playback/features/audio-assistant-speed.js)由 `core/initializer.js` 绑定一次，只消费桌面会话状态。主进程确认当前采集来源属于本实例、且当前歌曲正在处理时，将保存的 0.5–2 倍速应用到现有 audio 的 `playbackRate`，保持 `preservesPitch` 开启；不重复请求音源或对实时采集再变速。原声对比、停止、工作程序退出和页面销毁恢复 1×；换曲的 `loadstart` 立即恢复并请求停止，停止完成前不接受旧运行状态重新加速新曲。`ratechange` 更新系统媒体状态并强制发布歌词状态；歌词位置仍使用歌曲时间，`playbackRate` 单独控制时钟与逐字动画的推进。

| 操作 | 行为 |
| ---- | ---- |
| `playPlaybackTrack` | 解析音源并以播放代际保护迟到结果，更新当前曲目和历史后驱动 audio |
| `togglePlayback` | 无当前曲目时取下一首，否则在有效音源上切换播放/暂停 |
| `playbackPrevious` | 当前进度超过 5 秒先回到开头，否则读取播放历史 |
| `playbackNext` | 自然结束时执行单曲循环并有界跳过不可播曲目；手动下一首与失败跳过推进队列，保留列表回绕及电台补量 |
| `changePlaybackQuality` | 确认目标音质可用后切换并保存选择；不可用时保留原音质与音频。只有请求仍有效时恢复切换前进度，是否继续播放以 URL 返回时的暂停状态为准 |

切歌、音质切换、清空队列与平台退出共用播放控制器拥有的请求代际。队列通过内部 `invalidatePlaybackRequests` 回调使全部在途操作失效；播放页切入全民 K 歌标签也使旧请求失效并暂停本页音频，QQ/网易云标签互切保持原播放行为。Provider 在成功退出后传入平台，仅取消该平台发起的播放请求，包括当前曲目尚属于另一平台的情况。另一个平台的在途请求可继续，保留音频也可继续错误恢复。流解析使用曲目副本，只有当前请求才能合并流元数据、替换音频或恢复进度，迟到成功与失败不能覆盖新状态或在退出后恢复播放。

登录窗口正常结束后，同样取消该平台的在途播放请求，并通过 `forgetProviderStreams` 清除当前曲目、各播放队列、历史与展示历史中的 URL/过期时间；保留正在播放的音频、歌词及其他平台请求。下次选播重新向当前账号申请音源，不能继续复用登录前的试听 URL。登录窗口关闭不等于认证成功，通知仍以重新读取的认证状态为准。

错误重试通过 `createPlaybackRequestGuard` 捕获当前音频的有效代际，经 `stream-handler` 注入 `StreamService`。重试使用曲目副本、原始来源及 `requestedPlaybackQuality`，刷新后复用该品质的结果，避免先降到标准音质再重复解析；入口、URL 解析结果与失败分支均校验播放权，过时任务不能重播、跳过新曲或提示旧错误。全民 K 歌被选中时，保留音频也不能触发在线重试；退出该信源后，显式恢复的音频仍可正常重试。新曲仍在解析时，旧音频新触发的错误也不再拥有播放权；切换失败后，为保留的原音频建立新的有效代际，允许其后续错误恢复，旧任务仍失效。手动切歌无可用 URL 时保留当前曲目、来源与音频，并沿用地址解析服务的不可播放提示。

自然结束后的连播及音频错误恢复后的自动跳歌，在 URL 解析失败或为空时继续取下一首；单曲循环的当前曲目不可播时也可推进。一次自动推进最多检查当时的剩余队列和一轮完整歌单，电台允许再检查一批补歌；同一曲目键只尝试一次，全部不可播时停止音频。每次异步播放尝试完成后复核请求代际，用户切歌、清空队列、切音质或退出平台后，旧推进任务不能继续取歌。

播放与持久化共同读取 `PlaybackConfig` 中的历史上限，不再分别硬编码限制。

**播放历史**:播放器将 `history/displayHistory`（各 50/200 条上限）随 queue-state 快照保存；快照写入不会调用 `recordPlay` 或累加 `play_count`。独立的 `play_history` 表仅由显式 `POST /api/playback/history` 经 `playback-store.recordPlay` 写入，当前播放器没有调用该写接口（见 [storage.md](../backend/storage.md) §3.4）。

## 3. 歌词链路

| 环节             | 实现                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 获取             | `LyricService.loadLyrics(track)` → `POST /api/music/lyrics`(按 source 走 QQ/网易云解析,本地与已缓存跳过)                                                                                                                                                                                                                                                           |
| 行定位           | `findLyricLine` 对 `lines[]` 做二分查找([lyric-service.js:62-88](../../../public/js/playback/services/lyric-service.js#L62-L88))                                                                                                                                                                                                                                   |
| 逐字进度         | `shared/lyric-clock.js` 按 `performance.now()` 计算本地位置;`LyricWordRenderer` 使用 `LyricFrameScheduler` 的 rAF+33.3ms 门控;当前行 `LyricWordAnimator` 优先 WAAPI reveal，卡顿时逐级回退到手动 reveal/静态高亮，持续流畅后逐级恢复；计数与减少动态效果约定由 [overlay 性能策略](overlays.md#7-数据消费一览)维护 |
| **上报**         | `publishBrowserState`:`POST /api/playback/lyric-state`(保留毫秒精度 + 180ms 节流 + latest-wins 队列);每条状态兼容携带 `generation`/`sequence`,切歌/seek/时间线变化切 generation;`publishBrowserTimeline`:`POST /api/playback/lyric-timeline`(trackKey+歌词引用去重,只发一次)——服务端缓存内置候选，仅实际输出来源为 internal 时转 WS 广播(见 [ws.md](../backend/ws.md) §3) |
| 直播歌词浏览器源 | `syncWindow` 仅通过 HTTP 发布状态与完整时间轴;`/lyrics` 经 WebSocket 消费 `lyric-state`/`lyric-timeline`并复用管理页实时预览渲染                                                                                                                                                                                                                                   |

发送者重建时不从零版本持续覆盖服务状态。`lyric-state` HTTP 响应若带 `data.nextGeneration`，表示本次旧版本被拒；发送队列更新代际偏移并至多立即重试一次。偏移在发送时应用于后续排队项，保留切歌/seek 的本地版本顺序；已被成功强制状态超过的旧 pending 直接丢弃，不能因重新升代而回灌。只有有效成功响应才记录发布成功；服务端旧包过滤仍有效，响应恢复信息不进入 WS 状态。

时间轴发布串行执行，最多保留一份最新待发时间轴；失败后解除该曲目去重，下一次同步可重试。等待旧时间轴的状态若已被新 generation 替代则丢弃。时间轴与状态请求使用 10 秒取消期限（状态包括响应体读取），强制状态待发队列最多 64 项；超限完成最旧等待者并保留较新的状态，不改变服务端版本合同。

歌词跟随与播放页选中的音乐平台分别维护。外部歌词正在输出时，内置播放器继续上报自己的状态与时间轴，服务端将其保留为候选，切回时可立即使用；来源变化不会暂停内置音频、取消 URL 请求或阻止自动下一首。播放页显式切入全民 K 歌标签仍会暂停内置音频，并由 `LyricService.suspendWindow()` 清除旧发送队列；暂停后的状态继续作为内置候选上报。服务端统一决定唯一输出，规则见[歌词状态与时间轴](../backend/music/services.md#13-歌词状态与时间轴lyric-statejs--lyric-timelinejs)。

管理页 `lyric-source-controls.js` 在「点歌 → 直播歌词」的「歌词跟随」中提供智能播放及四个来源偏好；单选反映 `selection`，状态文案反映实际 `source`，并分别展示 QQ / 网易云状态和重检按钮。只有一个播放器播放时始终跟随它，多播放器按偏好或当前跟随仲裁；服务重启恢复智能播放。来源与重检请求不触发外观自动保存，旧 HTTP 响应不能覆盖新实时状态，重复初始化不重复注册事件。「全民 K 歌在线歌词」中的首选歌词源和智能匹配歌词只影响 WeSing 本地 QRC 不可用时的在线兜底；外部 QQ / 网易云各用自己的平台歌词。

官方试听音源从片段零点计时，歌词仍使用原曲时间。`utils.getPlaybackLyricOffsetMs` 只在 `playbackTrial === true` 时取有限、非负的 `playbackTrialStartMs`：`LyricService.syncWindow` 将当前时间与可播放结束时间平移到原曲坐标，全屏歌词使用同一起点选择高亮行；点击歌词反向换算为片段时间，超出音频范围的行不触发跳转。完整音源忽略旧的试听起点。音频进度条、暂停和 seek 仍使用原生片段时间。

切音质与错误恢复先保存原曲位置，再按新音源的试听起点换回音频位置，继续使用实际音频时长限制恢复范围；完整音源、试听音源及试听区间改变之间都适用。例如原曲第 30 秒开始的片段播至第 5 秒，换成完整音源后从第 35 秒继续。若原位置早于新的试听起点，则从新片段开头播放。

## 4. 服务层(services/)

点歌匹配诊断与自动导入共用 `MatchService.matchQueueItem` 和 `preferredPlatforms`：优先当前在线歌曲的平台，否则使用所选平台；没有可自动接受的结果则查询另一平台，两边都需确认时保留最高分（同分保留先查平台）。每个平台按歌名/歌手查询最多 10 个候选，再发送候选及可选时长评分；空候选不送去评分。诊断通过可选观察回调收集查询顺序、选中平台的完整评分和失败原因，不改变导入的匹配选择规则。

| 服务           | 职责与端点(定义见 [api.md](../backend/api.md))                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| search-service | 在线搜索 `POST /api/music/search`(platform/keyword/limit,默认 9 条),`searchGeneration` 防串号(旧请求结果丢弃)                                                                                                                                    |
| stream-service | 播放流解析 `POST /api/music/resolve-stream`(`forceRefresh` + `quality`),URL 缓存 + 30s 刷新边距 + 1 次重试;Provider 返回的实际 `quality` 回写 track,用于展示权益降级                                                                             |
| lyric-service  | 歌词加载、行定位、浏览器端 lyric-state/timeline 上报(§3)                                                                                                                                                                                         |
| match-service  | 点歌匹配:`/api/music/search` 候选 → `POST /api/music/match-track` 匹配；未获自动接受的相关候选进入 `pendingRequests` 待确认，无相关候选时继续备用平台，两平台均无匹配则跳过且可重试                                                                                                                           |
| import-service | 点歌队列导入:读 `/api/state` 的 queue 快照，过滤已处理请求后最多匹配 30 条；自动接受结果插入下一首，其余候选进入待确认                                                                                                                                 |
| home-service   | 首页内容 `POST /api/music/home`(action: 推荐/每日/电台/歌单…),`ContentLoader` 提供缓存 + 后台刷新(首页命中缓存先渲染,后台更新后 toast"已自动更新")                                                                                               |
| wesing-service | 全民 K 歌适配层:`/api/music/wesing/*`(active/refresh/configure/offset/diagnose/diagnose/export)+ WS `wesing-state` 实时状态 + `LyricWordRenderer` 逐字现场；`wesing-diagnostics` 管理“重新检测”左侧的“播放诊断”、20 秒采样结果面板及用户主动将 JSON 保存到日志目录（英文用途和本机时间命名，成功显示路径），复用当前采集器，收起后迟到结果不重开面板(详见 [backend/music/wesing.md](../backend/music/wesing.md));源切换用 `activationQueue` 串行化,避免后端状态错乱 |

首页请求在开始时固定平台、action、歌单 ID 和缓存键。HomeService 的代际决定页面是否接受结果，ContentLoader 的每键请求代际决定缓存是否接受写入：切换分类、最近历史、音源或返回历史后，旧成功和旧失败均不能覆盖新页面。后台刷新使用局部结果，不把页面状态当临时工作区；重复缓存读取可复用在途刷新，同键较新的实际请求优先，完成后清理请求记录。可缓存 action 只由 ContentLoader 的 `CACHEABLE_ACTIONS` 定义，HomeService 复用该集合。可修改的歌单详情不再使用服务端第二份内容缓存，后台更新和强制刷新直接读取 Provider 当前结果，空歌单也更新播放器缓存。

「我喜欢」每次加载的分页共用一个 `loadingSession`，让 Provider 复用本次歌单定位和 QQ 全量返回。登录/退出使平台代际失效后，已发出的页面返回即停止后续分页；普通页面导航仍允许同账号后台加载完成并写缓存。

内容抽屉在初始及关闭状态设置 `inert`，打开时恢复键盘操作；关闭时若焦点仍在抽屉内或因遮罩点击回到页面主体，则返回仍有效的原触发控件。

`CacheManager` 内存层最多 64 项，按序列化字符串 UTF-16 长度估算的合计预算为 8 MiB（不是 V8 实际堆大小保证）。读取提升最近使用顺序，写入/回填时回收超过默认 24 小时的内存条目，按最近使用顺序淘汰至预算内。超大单项跳过缓存而不截断歌单数据；localStorage 保留既有 24 小时有效期和浏览器配额。登录/退出还会使对应平台未完成内容请求失去缓存写入权，防止旧账号响应重新填回缓存。

## 5. 队列、电台与歌单

`state/actions.js` 是当前曲目、历史、播放偏好和待确认请求的写入入口；恢复保持原状态对象身份，完成的同步变更通过 `commit()` 按保存、渲染顺序通知。异步流解析和请求代次仍由 playback-controls 拥有，只在接受结果后提交状态。`queue/manager.js` 独占队列转换、歌单游标和随机顺序；`features/queue-operations.js` 编排音频清理与队列操作，不再维护第二套队列算法。原先未被实际使用的 StateManager 订阅包装已移除，初始状态、规范化及校验仍在 `state/manager.js`。

- **三种队列形态**:`normalQueue`(点歌队列/歌单播放)、`radioQueue`(电台)、`normalQueueTracks`(歌单全量,`playlistIndex` 游标);`queueType` ∈ queue/playlist/radio。待确认请求由 `pendingRequests` 保存，旧 `requestedQueue` 仅兼容读取。`insertTracksNext` 在 playlist 模式从 `playlistIndex+1` 处插入，保留当前曲目、音频和游标；`removeTrack` 同步从全量列表剔除；`clearQueue` 复位全部队列与 shuffle 游标。待确认通知的「下一首播放」使用同一插入操作，空闲时等用户按播放开始。
- **播放模式**:UI 经 `getNextMode()` 在 sequence/shuffle/repeat-one 间轮换；服务端快照和本地 v2/v1 恢复均接受 repeat-one，旧值 single 归一化为 repeat-one，保留旧值 loop 的兼容接纳。shuffle 用 `shuffleOrder` 曲目键数组 + `shuffleCursor` 游标(`rebuildShuffleOrder` Fisher–Yates,游标越界回退顺序取队首)。普通曲目沿用 ID，导入请求使用 `request:<songRequestKey>`，区分同曲的不同请求。歌单游标按实际取出曲目对齐；相邻曲目键相同时保留顺序位置，避免切回顺序播放后仍高亮随机播放时的位置。明确插入下一首时，活动队列条目标记 `playNext`，快照保留该标记；重新打乱队列后仍先消费这批条目，取出时移除标记，歌单全量副本不保留临时优先级。
- **电台补量**:`features/radio-mode.js` 在电台队列不足 3 首时按 10 首一批 `POST /api/music/home`(action=radio),过滤最近 30 首历史与队列内重复(请求归 radio-mode，去重入队归 QueueManager.refillRadioQueue)。平台由当前电台的 `queueSourceKey` 固定；旧快照缺少来源时优先从当前曲目或电台曲目推断，浏览平台标签不改变补歌平台。每次建立电台的队列数组身份拥有独立请求锁和失败通知状态；旧响应在入队前校验身份，同平台重开也会使旧请求失效，新电台补量不等待旧请求。
- **收藏/歌单**:`playlist-operations.js` 通过 `/api/music/playlists/tracks/add|remove` 修改音乐 Provider 歌单，通过 `/api/music/home` 读取歌单；不调用本地 `/api/playback/favorites`。收藏/歌单展示数据经 `CacheManager` 24h 缓存跨启动保留。
- **缓存统计**:`cache-operations.js` 展示 `GET /api/music/cache` 并支持 `/api/music/cache/clear`。

歌单的「上一首」由 `QueueManager.getPreviousPlaylistIndex` 定位：顺序及单曲循环模式按列表回退，首曲环绕到末曲；随机模式优先使用实际播放历史，无历史时按列表回退。手动上一首不再按已播放 5 秒区分切歌与重置进度。`playback-controls` 接受有效音源后才消费历史，并通过 `jumpToPlaylistTrack` 同步游标、后续队列和随机顺序；失败或过时请求不提交回退状态。普通队列和电台仍回退实际历史，无历史但有当前歌曲时回到本曲开头。歌单高亮核对当前曲目键，游标不匹配时查找实际歌曲；同键重复条目优先保留匹配的游标位置。已播放条目保持正常显示，不作灰显。

## 6. 状态持久化(play_queue_state)

`state-persistence.js` 在任何 await 之前读取管理页 HTML 的启动代次，并为本次 factory 分配页内 senderGeneration；每次保存通知只标记待保存并递增 sequence，完整曲目与队列快照在防抖发送或显式 flush 时捕获最新值。1500ms 防抖时机保持不变，不承诺持续事件期间的最长保存间隔。普通 HTTP 发送在 settle 前保留最新 in-flight payload；若此时 current 为空且没有更新一轮 dirty/pending，卸载/关机显式 flush 仍可直接重发这份快照，不等待原普通请求。定时 HTTP 和卸载 IPC/beacon 携带相同 `snapshotVersion`，卸载直接发出快照，不等待网络握手。失败请求只可保留当前发送端最新序号的 pending，不能在较新保存后重新排入旧快照；旧请求的 settle 只能清理自己的 in-flight 引用。旧发送端不会自动提代夺回写入权；独立调用须显式提供 `deps.snapshotWriter`，缺少启动信息时明确提示重新加载。服务端去重/拒绝及重启语义见 [API 合同](../backend/api.md) §5 和 [存储合同](../backend/storage.md) §3.4。

| 通道                                  | 触发点                                                                       | 说明                                                                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP `POST /api/playback/queue-state` | 常规保存(1500ms 防抖)、卸载 `sendBeacon`(带 token)、关机前 `keepalive` fetch | 服务端写 `musicDb.play_queue_state`(client_id PK,见 [storage.md](../backend/storage.md) §3.4)                                                                                                                                        |
| IPC `musicAPI.savePlaybackState`      | 卸载时与 HTTP 同发；关机刷新优先 IPC、失败回退 HTTP                                    | 通道见 [desktop/preload.md](../desktop/preload.md);Electron 关机钩子 `onPrepareShutdown → flushPlaybackStateForShutdown → confirmShutdownFlush`([initializer.js:117-129](../../../public/js/playback/core/initializer.js#L117-L129)) |
| localStorage `playbackState:v2`       | 读取旧数据；v1 迁移时写入 v2，当前未接入常规保存                                         | 兼容 v1(`songAssistantPlaybackState:v1`)与旧 v2 数据，不能作为持续更新的本地备份承诺                                                                                                                                                    |

当前 [controller.js](../../../public/js/playback/controller.js) 只调用 `StorageManager.restoreState()`，常规保存交给 `createStatePersistence`；`StorageManager.saveState()` 尚无业务调用方。2026-10-11 用户确认测试阶段先保留现有备份/恢复兼容：不删除旧副本，不在本轮接入持续 localStorage 镜像；后续取舍仍见[持久化策略台账](../../../specs/plans/open-items.md#b10-播放状态的本地备份策略)。

**恢复顺序**:`restoreState()` 优先 `GET /api/playback/queue-state?clientId=default` → localStorage v2 → v1 迁移（[state/storage.js](../../../public/js/playback/state/storage.js)）。HTTP/IPC 快照保存音频的 `currentTime`，恢复时归一到 `restoredTime`；只有 `StorageManager._doSave` 的 localStorage 写入把 `restoredTime` 置为 0，不能据此认为服务端快照不保存播放位置。恢复的本地曲目经 `restoreLocalFileUrls()` 用 `musicAPI.resolveLocalMediaUrls(paths)` 批量解析成 `local-media://` URL,失败标记 `fileMissing`。

常规 HTTP 保存失败保留当前发送端的最新待存快照；连续两次失败显示一次「播放队列和进度还没保存成功，先别关闭 LIRA。」，随后成功显示「播放队列和进度已保存。」并重置失败计数。旧序号的晚到结果不能覆盖新保存结果或重复提示。普通请求尚未 settle 时，最新 in-flight 快照也可由显式 flush 复用；卸载时 IPC 与 beacon/keepalive 同时提交同一版本，正常桌面关闭先等待 IPC，失败才回退 keepalive HTTP。

QQ 轨道持久化保留 `sourceMediaId`、`sourceSongId`、`sourceSongType`;最后一项必须跨重启送回 Provider,否则 HAR 中 `songtype: 1` 的付费歌曲会被错误降为类型 `0`。`qualityPreferences` 按 Provider 保存:QQ 为 `standard/high/lossless/premium/immersive`,网易云为 `standard/higher/exhigh/lossless/hires`;后两项通过本地 QMC2 Range 代理，不能承诺 QQ 客户端的 Dolby/空间 DSP 效果。

点歌导入记录 `importedSongRequestKeys`，轨道与待确认条目保留 `songRequestKey`、点歌人。请求键由现有点歌项 `id` 和 `created_at` 组成，避免清理数据后数字 ID 复用误判。记录随现有快照和 localStorage v1/v2 恢复，不新增数据库表或更改接口；旧快照缺省为空，不按歌名推测旧曲目的请求归属。成功读取点歌队列后，只保留仍活跃请求的记录；已经播放、忽略或从播放队列清除的请求在点歌队列仍活跃期间不会再次导入。匹配失败不写处理记录，可重试。仅产生待确认项的导入也保存快照。

`import-handler` 持有导入代次，清空播放队列或开始新歌单/电台集合时使在途导入失效；`import-service` 在读取快照后、每项匹配后及写入待确认前复核，handler 在最终插队、提交处理键和通知前复核。被取消的未完成导入不重新填回队列，之后可重新发起导入。

待确认项发布到状态时，`state/actions.addPending` 同步记录其请求键。即使整批导入尚未结束就清空，已有待确认请求的处理身份仍随清空后的快照保留；尚未发布或匹配失败的项不因此标记完成。

点歌队列旁「导入播放器」和播放弹窗「导入点歌」调用同一入口，并在导入期间或全民 K 歌模式下一起禁用。导入期间显示「导入中…」和 `aria-busy`，结束或失败后恢复原标签；全民 K 歌模式的按钮提示需切换到 QQ 音乐或网易云音乐。读取点歌队列最多等待 10 秒，每个平台的搜索与匹配共用 30 秒超时信号（包括响应体读取），超时后沿用备用平台与失败可重试规则，避免请求无限等待导致按钮持续禁用。切换在线平台不会解除在途锁，空队列只提示一次。播放弹窗在只有 `pendingRequests` 时仍显示待确认区，两处待确认操作统一为「下一首播放 / 跳过」。播放器不会自动完成点歌队列。有可清理内容时，清空播放队列先确认会停止音乐、移除播放队列/待确认/上一首回退记录；空队列直接清理。保留最近播放抽屉（`displayHistory`）、点歌队列及请求处理键，包括已清掉的待确认请求，点歌队列中仍存在的这些请求不会重新导入。内容抽屉保留从选中歌曲开始播放整个列表的行为，在抽屉和播放按钮提示中标明会替换当前播放队列。

## 7. 本地文件与桌面集成

- 选择文件:`LocalFileManager.selectLocalFiles()` 走 `musicAPI.selectLocalFiles`(桌面文件对话框,取消返回空);最近历史 `musicAPI.getRecentLocalFiles`。
- 播放:`local-media://media/<base64url-encoded-path>` 协议由 Electron main 注册与鉴权(`local-media-access.json` 允许清单,见 [desktop/main.md](../desktop/main.md));恢复的 objectUrl 仅会话内有效,重启后需重新解析。
- 桌面检测:统一约定 `window.musicAPI` 是否存在及其方法是否为 function；本地文件选择与路径恢复需要桌面桥。独立歌词页是浏览器来源 `/lyrics`，其入口和权限见 [歌词展示参考](overlays.md#6-直播歌词页lyrics)。

## 8. UI 与事件

搜索结果由搜索完成、清空和切换音源入口更新，不随普通播放状态刷新重复构造。队列弹窗关闭时暂缓列表渲染，打开时读取最新状态；可见时只在实际展示字段变化后重建列表，包含数组或曲目原地修改。

音质菜单仅在所属音源或该音源的偏好音质变化时重建选项；暂停、后台状态等无关更新保留按钮节点、焦点和点击目标。手动切换等待解析时保留原选中项。播放条的音质标签仍独立反映实际音源品质，包括普通播放时服务端降级返回的实际档位。

全民 K 歌的进度、歌词推送由其专属面板更新，不触发整个播放器重绘。只有平台检测、支持情况、缓存就绪、健康状态或提示消息变化时才通知编排层；当前选中全民 K 歌时从已接收的状态同步平台信息，不额外请求音质或播放地址，也不刷新 QQ／网易云播放器。

全屏播放器在音频更新时复用相同标题、歌手、缺省封面与空歌词节点；当前歌词索引不变时跳过整表高亮遍历，重建歌词（含翻译/罗马音切换）后重新应用高亮。歌词获取沿既有状态入口替换行数组，播放器按数组引用检测新版歌词：即使歌曲 id 与行数未变，关闭期间重新获取歌词后再打开也更新文字和点击跳转时间；相同行数组的重复渲染继续复用节点，不逐帧序列化歌词。时间更新、seek、手动浏览、滚动和唱片动画保持原节奏。

- `ui/index.js` `UIRenderer` 渲染整页;`ui/playback-bar.js` 底部控制栏(进度/播放暂停/上下首/音量/模式/队列弹出/歌词);`ui/fullscreen.js` 全屏播放器(点击面板切换,ESC 退出,空格播放暂停,封面背景按 `pickBackgroundTheme` 30 套轮换,[forms.js:74-92](../../../public/js/admin/forms.js#L74-L92));`ui/drawer.js` 首页抽屉(歌单内页与返回栈);`ui/queue-popup.js` 队列弹出窗(收起播放器时联动关闭)。
- **音质菜单**:`ui/playback-bar.js` 对 QQ 显示标准(128kbps)/HQ(最高 320kbps)/SQ(FLAC)/臻品(Q0 本地解密)/全景声(O8 本地解密),对网易云显示五档;选项沿用共享单选样式(`.lira-select-panel` + `.lira-select-option`),当前档位以选中竖条与底色表示,不显示对勾;`features/playback-controls.js:changePlaybackQuality` 强制解析目标档位，返回品质与请求一致时才替换当前流并保存选择，在 `loadedmetadata` 后恢复切换前进度。若返回降级品质，toast 提示目标不可用并保留原音质；降级、空地址或解析失败均不替换原音频，菜单与保存的偏好恢复为原音质，播放进度和暂停状态不变。迟到请求不能回写选择。没有当前在线曲目时仍可直接保存默认档位。Q0/O8 不承诺 QQ 客户端专属杜比或空间 DSP 效果,边界见 [qq-provider.md](../backend/music/qq-provider.md) §7.2。
- **工作区集成**:播放器 dock 默认收起(`player-dock-collapsed`,避免遮挡点歌工作区),由 `forms.js` 的 `setPlayerDockCollapsed` 统一管理,收起时联动关闭全屏播放器/队列弹窗/音量面板([forms.js:133-169](../../../public/js/admin/forms.js#L133-L169))。
- `core/event-handlers.js` 绑定播放页 DOM 事件(搜索框、队列操作、抽屉、全屏按钮、媒体会话按键),控制器显式注入其所需回调;`core/renderer.js` 输出渲染函数(进度/全屏/待确认弹窗/搜索结果/首页结果/匹配结果)供控制器组合。
- 播放器状态变化统一走 `onStateChange → renderPlayback() + savePlaybackState()`;MediaSession(系统媒体控制)由 `updatePlaybackMediaSession(togglePlayback, playbackPrevious, playbackNext)` 更新([controller.js](../../../public/js/playback/controller.js) 的 `updatePlaybackMediaSession`)。
- 音频事件链([initializer.js:67-113](../../../public/js/playback/core/initializer.js#L67-L113)):`loadedmetadata` 回写 `durationMs` → `timeupdate` 推进进度条并落盘 → `play/pause` 同步 MediaSession 与歌词窗口 → `seeking/seeked` 强刷歌词与状态 → `ended` 触发 `playbackNext(true)` → `error` 走流刷新重试;`pagehide` 时 `flushPlaybackStateOnUnload`(sendBeacon/IPC 双通道,见 §6)。

### 8.1 大播放器外观

全屏歌词按已排序时间轴二分定位当前行。重建歌词时保存行节点，进度更新只切换旧/新活动行；换曲、空歌词和译文切换重建时刷新节点缓存，手动浏览及原有跟随逻辑不变。翻译/罗马音是否存在按歌词数组身份复用，进度更新不重复扫描整首歌词；同曲替换歌词或切换到空歌词时重新判断，模式按钮的激活状态仍随操作更新。

「播放」页顶部使用单行分组切换条：左侧「音乐播放」选中时展开 QQ 音乐、网易云音乐、全民 K 歌三个平台，右侧为「播放器外观」；进入外观后左侧显示「音乐播放」，同一组平台文字缩至标题下方，以「·」分隔；返回音乐播放时文字平滑展开为三个选项，切换条高度保持不变。展开/收起和平台滑块使用 420ms 快起慢落过渡，栏宽在 `2fr 2fr` 与 `3fr 1fr` 之间切换，保持轨道总权重不变，使栏宽、文字位移与缩放沿同一进度变化；标题、图标和背景使用 180ms 淡入淡出，外观选中态阴影平滑衔接。减少动态效果时取消位移与缩放过渡并保留短暂淡入淡出。`core/event-handlers.js` 管理分组显隐与焦点，平台标签的方向键和 Home/End 只移动焦点，按 Enter/Space 或点击才激活平台，Tab 可到达外观按钮。平台滑块由 `header.css` 跟随既有 `.source-tab.active` 状态，支持减少动态效果；选中平台复用播放状态中的 `selectedSource` 保存与恢复，首次默认 `qq`，切换外观不修改平台。外观片段为 `public/pages/admin/playback/appearance.html`，`ui/appearance.js` 由 `FullscreenPlayer.init` 初始化一次，负责设置规范化、本机保存、控件和示例预览；`css/playback/appearance.css` 负责设置页与样式变体，字体声明复用 `css/shared/display-fonts.css`。设置区仍由 `FormsService.initTabs` 管理「样式 / 配色 / 歌曲 / 歌词」标签及键盘导航；样式先通过示意图单选经典（左封面、右歌曲与歌词）、黑胶（上封面、下歌曲与歌词）或歌词（只显示歌词）布局。经典和黑胶共用默认唱片机、黑胶唱片、专辑封面和唱臂黑胶四种外观缩略图；歌词布局收起封面控件并保留外观偏好。经典布局的歌曲信息位于右侧，与歌词正文同一条起始线；黑胶布局以封面、歌名、歌手和当前一行歌词共用中轴，封面与下方文字间保留留白，文字区域按内容高度排列。黑胶布局固定居中，设置页对齐控件显示居中并禁用，保留其他布局的对齐偏好；歌名、歌手和歌词均不换行，超宽省略，歌曲信息区域无滚动。无高亮时显示首句，隐藏译文/罗马音副行、切换按钮、手动浏览按钮与歌词行左侧跳转图标；歌词布局隐藏歌名和歌手，保留手动浏览时的「返回当前歌词」按钮及歌词跳转。纯歌词隐藏滚动条而保留滚轮、键盘和点击浏览；首末行留足居中空间，当前句突出、相邻句淡化、上下边缘渐隐，手动浏览或焦点所在句恢复清晰。自动主题背景的模糊装饰层以 18 秒周期缓慢流动；关闭大播放器时暂停，减少动态效果时关闭背景动画及平滑滚动。自定义背景沿用用户配色。经典布局极大字号下歌曲信息区域最多占右栏 45%，可独立滚动，保留歌词空间；`ui/lyric-layout.js` 为实际播放器和预览共用定位：经典布局正常行在上方 1/3 附近，黑胶布局在固定区域显示单行，纯歌词布局位于中部；过高行定位首字，纯歌词首字避开顶部渐隐区域，跳过巨大行高产生的前置空白，并换算预览缩放。预览复用全屏播放器的内容 DOM/CSS，按实际播放器尺寸等比缩小，跟随尺寸和背景主题变化；右侧仅保留示例画面、「长句与译文」开关和「打开大播放器」，不显示预览标题、比例说明或常驻保存文案。预览移除交互与普通 ID，并为 SVG 资源重命名，不建立第二个音频或歌词运行时。「打开大播放器」复用 FormsService 的 dock 展开与全屏焦点管理。排版修改及字体加载完成后，等待现有 300ms 字号过渡结束，再通过 `onTypographyChange` 调用原有歌词跟随定位；保留手动浏览保护，退出页面清理计时器、字体注册、尺寸及背景监听。主题背景使用不透明底色与独立模糊装饰层，避免 100% 不透明度下边缘透底；自定义背景禁用装饰层，颜色 alpha 和整体不透明度仍分别生效。

外观只作用于大播放器；底部播放栏和直播歌词组件保持各自设置。字段保存在当前管理页 origin 的 localStorage `playbackAppearance:v1`，不进入队列快照、数据库或云端同步。每次有效修改即时应用并保存，成功时不显示提示；保存失败保留本次画面效果并在左侧控件下显示未保存提示，下一次成功保存后隐藏。缺失、损坏或不可读的数据使用默认值，不在读取时覆盖存储。「恢复本组默认」仅重置当前分类的字段并保留其他分类；「恢复全部默认」先确认再写入本模块默认值，移除自定义字体、字号与文字颜色变量，让客户端配色重新接管。

| 字段 | 默认值与范围 |
| --- | --- |
| `layout` | `classic`（左封面、右歌曲与歌词）、`vinyl`（上封面、下歌曲与歌词）、`lyrics`（仅歌词）；旧记录缺失时为 `classic` |
| `style` | `turntable`（当前唱片机）、`vinyl`（黑胶）、`cover`（专辑封面）、`vinyl-arm`（唱臂黑胶）；独立于布局保存 |
| `artworkSize` / `rotation` | `100`，60–110%；`true`，播放时旋转；封面样式不旋转，保留旋转偏好供切回唱片时使用 |
| `backgroundMode` | `auto`（沿用原主题背景）、`solid`、`gradient` |
| `backgroundColor` / `gradientColor` / `backgroundOpacity` | `#fff1f4` / `#c9dced` / `100`（0–100）；颜色在自定义背景模式下生效 |
| `fontFamily` / `lyricFontFamily` | 歌名与歌手字体默认 `system`（「使用 LIRA 界面字体」）；歌词默认 `inherit`（「与歌名、歌手一致」），也可选择 `system` 直接使用界面字体或独立选字体。均支持 `system`、`sans`、`serif`、`kai`，兼容旧 `maiyuan`（荆南麦圆）、`kuaile`（站酷快乐体）、`smiley`（得意黑）ID，以及共享字库/本机字体产生的单个双引号转义字体族名 |
| `textAlign` | `left`，另支持 `center`；经典及纯歌词布局使用此偏好，黑胶布局固定居中但不改写偏好 |
| `titleSize` / `artistSize` / `lyricSize` | `42`（8–200px）/ `20`（8–120px）/ `32`（8–160px）；默认值沿用各窗口宽度的字号适配，自定义字号优先；副行随自定义歌词基准字号的 0.5625 倍缩放 |
| `lyricLineHeight` | `1.4`，0.8–4 倍，步长 0.1；默认保留正文 1.4、副行 1.5，自定义值同时作用于正文及副行 |
| `lyricLineGap` / `lyricLetterSpacing` | `28`（0–200px，步长 1），在经典及纯歌词布局作为每句上下 padding 各一半，黑胶单行布局不使用句间距；`0`（−2–24px，步长 0.5），作用于正文与副行 |
| `lyricFontWeight` | `700`，另支持字符串 `400`、`500`、`600`；仅控制主歌词，副行仍为 500 |
| `activeLyricScale` | `112.5`（100–300%，步长 0.5）；默认沿用已有响应式强调比例，自定义值相对于当前窗口实际正文大小，100% 为等大 |
| `textColors` | `theme` 跟随客户端配色；`custom` 使用下面四个颜色 |
| `titleColor` / `artistColor` / `lyricColor` / `activeLyricColor` | `#302a27` / `#665b53` / `#796d63` / `#302a27`；分别控制歌名、歌手、普通歌词、当前歌词 |

规范化仅接受已知字段、枚举、布尔值与六位或八位（含 alpha）十六进制颜色；有限数字按字段步长取整并限制范围，其他类型回退默认。旧偏好缺失的新字段补默认值。字体仅允许内置别名或单个双引号包裹的字体族，转义只接受引号和反斜线，拒绝控制字符、任意 CSS 声明和字体栈。示例内容用于看外观，不代表正在播放的歌曲；实际播放器仍由原渲染链更新歌曲、歌词和播放动画。

大播放器的歌词正文、译文与罗马音在显示时，将两个英文字母之间的弯撇号或全角撇号（`‘`、`’`、`＇`）转为窄撇号 `'`，避免中文字体把 `I’m` 等英文缩写中的撇号排成汉字宽度；不改写原始歌词数据，不处理中文引号或词间空格，输出仍经过 HTML 转义。

两个字体入口共用 `shared/font-catalog.js` 的九款完整字库，由 `shared/font-library.js` 注册。新选项保存带引号的字体族名，旧 `maiyuan`、`kuaile`、`smiley` ID 保留；字体随安装包内置，首次即可离线使用，选择后按需加载，缺字使用系统回退。来源、完整字符覆盖和 OFL 许可见[字体说明](../../../public/fonts/README.md)。两个字体下拉通过共享 `select-menu.js` 的可选搜索与字体预览增强，可按名称筛选，隐藏无匹配的分组；菜单限制高度，搜索框固定在顶部，选项在列表内滚动，字体效果由选项自身及右侧预览展示，控件文案保持客户端字体。歌曲与歌词的字体下拉通过 `shared/local-font-library.js` 与其他设置共用同一次 `queryLocalFonts()` 查询；旧 `admin/local-font-library.js` 是兼容转导出。已保存但本机缺失的字体保留选项并使用系统回退；拒绝字体读取仍可使用内置与常用系统字体。原生授权边界见[主窗口的本机字体权限](../desktop/main.md#4-主窗口)。

排版参数参考 [Better Lyrics](https://github.com/better-lyrics/better-lyrics/blob/master/STYLING.md) 的字体、行高、字重与副行配置，以及 [AMLL](https://amll.dev/en/reference/react/interfacelyricplayerprops.html) 的歌词强调与对齐；本页采用独立选项组合风格，不引入外部播放器运行时。

黑胶选项复用 Grason Chan 的 [Spicetify Turntable](https://github.com/spicetify/spicetify-themes/tree/c432012478e1f2e2ffccca8e943e188af40d6190/Turntable)：使用其 `user.css` 的 `--shine`、`#fad-art::before/after`、封面内阴影和 24 秒转速，将原始封面/唱片/外圈 1 : 1.5 : 1.65 的比例换算为现有播放器容器的百分比。仅适配 LIRA DOM、尺寸和播放状态，不导入 Spotify 页面、脚本、登录或播放逻辑，也不宣称整个播放器页面与上游一致。原始 MIT 声明随 [turntable.LICENSE.txt](../../../public/css/playback/turntable.LICENSE.txt) 分发。默认唱片机与简约封面属于原有视觉及本地样式。唱臂黑胶沿用黑胶封面比例与转速，增加本地唱片纹理和白色唱臂 SVG；复用 `FullscreenPlayer.updateVinylAnimation` 的 `playing` / `paused` 状态驱动落针、抬臂与旋转，不创建额外播放监听器。

### 8.2 歌词动画性能边界

- WAAPI 只代表动画调度方式，不保证 reveal 属性由 GPU 合成；运行时以 `LyricPerformanceProfile` 记录长帧，必要时按 WAAPI → 30fps 手动 reveal → 静态高亮降级。
- 正常播放期间不在 30fps tick 写 `animation.currentTime`;tick 只读取 `LyricClock` 并检测 drift。仅 pause/resume、seek、切歌/时间线变化、明显回跳或超阈值 drift 允许重锚。
- 调度器只使用 `requestAnimationFrame` + 约 33.3ms 时间门控，不使用 `setInterval`；页面隐藏、暂停或 reduced-motion 时停止/暂停循环。

### 8.3 内置播放器输出

「百宝箱 → 设置」的「内置播放器输出」卡片由 `admin/playback-output-settings.js` 展示；`playback/features/output-device.js` 拥有设备枚举、媒体输出切换和本机偏好。设置仅作用于 `#music-player`，不更改 Windows 默认设备或 QQ 音乐、网易云音乐客户端的输出；底部播放器与全屏歌词共用此音频元素。

- 默认与「自动」选项保留 Chromium 输出和旧设备 ID；首次使用原生输出前通过 `HTMLMediaElement.setSinkId` 切换，之后通过同一 Web Audio 图的 `AudioContext.setSinkId` 切换。成功后才保存 `localStorage['playbackOutput:v1']` 的 deviceId/name；新增 backend/endpointId 为设备元数据，旧偏好仍可读取。
- 原生选择来自 `PlaybackOutputs` 的实际枚举：WASAPI 活跃端点、DirectSound 枚举与端点 ID 的交集、WaveOut 的稳定端点映射，以及当前进程架构下已安装的 ASIO 驱动。有对应设备才显示接口默认选项；不按固定数量伪造设备。ASIO 驱动初列为「连接待检查」，显式打开成功后按驱动返回的声道名列相邻输出对；仅剩一个声道时下混为单声道。保存非首对后可在下次启动重新连接验证。麦克风、线路与回送属于助手输入，不混入输出菜单。
- `native-output.js` 仍由 HTMLAudioElement 解码、控制进度/倍速/音量，`output-worklet.js` 送 48 kHz、32 位浮点、双声道 PCM 至受限原生桥。原生模式的工作线程只向本地音频图输出静音，避免同时外放；最多排队 4 包，每包正常 1024 帧。设备开始读取后才完成打开；暂停/跳转清空流，旧流包丢弃，自然结束短暂排空。WASAPI 为共享模式，ASIO 按驱动支持自动适配采样率，不提供独占、原码或任意位深/采样率承诺。
- 开始播放、暂停后继续、音质切换后继续、点击全屏歌词和全屏空格快捷键播放，均等待最新输出选择完成。已保存的设备缺失或无法恢复时暂停并阻止继续播放，保留原选择，不静默回退到系统默认设备。`devicechange` 与手动「刷新设备」更新设备列表；接回设备后恢复通道，不自动开始播放。
- 同源管理窗口通过 `storage` 事件同步，不重复写回。切换请求串行执行，过期结果不覆盖新偏好；媒体元素复用同一个输出控制器，在 `pagehide` 移除设备、存储和电音助手状态监听。
- 电音助手启动先通过 `withPlaybackOutputLocked` 锁住新选择，等已有输出切换完成后才调用桌面启动；启动失败也会释放临时锁。启动、处理内置音乐或仍需恢复内置原声期间，禁止切换输出，并提示先关闭「当前歌曲」或恢复原声；安全延后到下次播放的恢复状态不会锁住选择。若另一窗口的设置同步撞上处理中，先暂停本窗口播放，等待处理结束后应用新通道。
- 切换失败且旧输出已经释放时暂停并阻止继续播放；不静默改用外放。已生效但无法保存时明确提示只对本次有效。此偏好不进入服务器设置、播放队列快照或云端同步。原生桥与媒体解码权限见 [桌面生命周期](../desktop/main.md#内置播放原生输出)。

## 9. 与点歌业务的关系

- 点歌队列导入:播放页「导入点歌队列」读取 `/api/state` 的 `queue` 快照，通过 match-service 搜索和匹配。先按请求键跳过已导入或已进入待确认的请求，再应用每批 30 条限制；不同请求点同一首歌可分别导入。导入期间禁用按钮并合并重复触发，失败后恢复重试。
- 点歌匹配诊断:管理页"点歌匹配诊断"区(match-handler)把当前队列条目与在线搜索/匹配结果对照,定位匹配失败原因。
