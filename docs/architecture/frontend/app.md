# Admin 应用与公共框架

> 涉及文件:[pages/admin.html](../../../public/pages/admin.html)、[js/admin/index.js](../../../public/js/admin/index.js)、[js/admin/app.js](../../../public/js/admin/app.js)、[js/admin/state.js](../../../public/js/admin/state.js)、[js/admin/forms.js](../../../public/js/admin/forms.js)、[js/shared/](../../../public/js/shared/)、[js/desktop.js](../../../public/js/desktop.js)、[js/admin/gifts/](../../../public/js/admin/gifts/)、[pages/gift-audit.html](../../../public/pages/gift-audit.html)、[pages/debug-gifts.html](../../../public/pages/debug-gifts.html)

本文档描述管理后台(`/admin`)的页面结构、公共框架与各业务模块。通信行为见 [comms.md](comms.md),端点定义见 [api.md](../backend/api.md),快照与消息类型见 [ws.md](../backend/ws.md),IPC 通道见 [desktop/preload.md](../desktop/preload.md)。

## 1. 页面结构([admin.html](../../../public/pages/admin.html))

```
topbar: 品牌 Logo + 主页面 Tab(点歌 / 播放 / 礼物 / 百宝箱)
        + 状态条: #wsStatus(WS 连接) #liveStatus(直播连接+主播名/房间号)
                 #reconnectBtn(刷新直播) #songCount(歌库计数) #shutdownBtn(退出)
        + 窗口控件 #windowControls(最小化/最大化/关闭,仅桌面可见)
├── #songAssistantPage     点歌主页面(默认,#hash 无)
│     ├── SC 队列面板 + 点歌队列面板(切歌/清空,带滚轮冒泡控制)
│     ├── 快速入队(折叠面板:手动点歌表单 manualForm)
│     └── 歌曲管理面板(song-management-panel):内部六个 Tab
│           songsPage(歌库) / settingsPage(设置) / themePage(点歌板)
│           displayPage(展示板) / overlayPage(直播画面) / importPage(导入导出)
│           / desktopLyricPage(桌面歌词设置)
├── #playbackAssistantPage 播放助手(#playback)
├── #giftAssistantPage     礼物面板(#gifts):礼物检测/提示/最近/月底冲刺/今日盲盒盈亏/盈亏榜/盲盒映射
└── #otherAssistantPage    百宝箱(#other):左侧功能导航 + 面板(弹幕姬/礼物姬/加班机/主播计划/性能检测/使用文档/桌面更新)
```

六个内部 Tab 的内容([admin.html:150-156](../../../public/pages/admin.html#L150-L156)):

| Tab | 主要内容 |
|---|---|
| 歌库 | 歌曲表格 + 搜索/分类/语言/歌手/标签/启停筛选 + 编辑表单 |
| 设置 | 直播间(roomId/开关)、点歌行为、队列上限/冷却、清库按钮、Bilibili 登录、退出程序 |
| 点歌板 | 经典/身份版样式切换、预设卡片、规则与置顶文案、主题色/字号/滚动/字体 |
| 展示板 | 歌单板独立主题(可同步主主题)、滚动秒数、字号、预设卡片 |
| 直播画面 | `/queue`、`/songlist`、`/lyrics` OBS 地址 + 盲盒投屏链接生成 |
| 导入导出 | 文本/文件导入、导入结果统计 |
| 桌面歌词设置 | `desktopLyric*` 全套 + 实时预览(弹簧跟随) |

主页面切换由 [app.js](../../../public/js/admin/app.js) 的 `setMainPage` 负责:维护 `VALID_MAIN_PAGES`/`MAIN_PAGE_HASH_MAP`/`MAIN_PAGE_BODY_MAP` 三张表,切换 `body.dataset.mainPage` 并同步 `location.hash`(`#playback`/`#gifts`/`#other` 直达,[app.js:120-167](../../../public/js/admin/app.js#L120-L167))。

**桌面形态**:`/admin?desktop=1` 时在 CSS 加载前给 `html` 加 `desktop-shell` 类([admin.html:11](../../../public/pages/admin.html#L11)),加载 `css/overlays/desktop.css` 的暖金主题,顶栏变为 `-webkit-app-region: drag` 拖拽区,`#windowControls` 与 `.desktop-only` 元素显示([desktop.js:14-17](../../../public/js/desktop.js#L14-L17))。

## 2. 公共框架(shared/)

| 模块 | 文件 | 说明 |
|---|---|---|
| EventBus | [shared/event-bus.js](../../../public/js/shared/event-bus.js) | 应用内事件总线(`on/off/once/emit/clear`),单例挂 `window.AdminApp.eventBus`;常用事件常量 `Events`(SONG_ADDED/QUEUE_UPDATED/PLAYBACK_*/GIFT_RECEIVED/OVERTIME_UPDATED/STATE_LOADED/STATE_SAVED 等,[event-bus.js:181-211](../../../public/js/shared/event-bus.js#L181-L211)) |
| DI Container | [shared/container.js](../../../public/js/shared/container.js) | 轻量依赖注入(工厂 + 单例缓存 + 循环依赖检测),单例挂 `window.__DI_CONTAINER__`;app.js 注册 `eventBus/utils/theme/state/forms` 五个服务([app.js:24-29](../../../public/js/admin/app.js#L24-L29)) |
| StateService | [admin/state.js](../../../public/js/admin/state.js) | 全局状态唯一入口:WS 客户端 + `/api/state` + `/api/songs` 加载,快照经 EventBus 派发 `STATE_LOADED`/`SONG_UPDATED`,同时以 CustomEvent(`app:wesing-state` 等)广播实时状态(详见 [comms.md](comms.md) §3) |
| FormsService | [admin/forms.js](../../../public/js/admin/forms.js) | 表单工具:`bindRangePair`(range↔number 双向)、`initTabs`、`fillForm`(快照设置→表单,正在编辑的输入框不被覆盖,[forms.js:174-179](../../../public/js/admin/forms.js#L174-L179))、播放器全屏/收起、滚动速度与字号归一化 |
| Logger | [shared/logger.js](../../../public/js/shared/logger.js) | 生产自动禁用 debug 日志(仅 localhost/127.0.0.1 或 `AdminApp.debug` 时输出) |
| Theme | [shared/theme.js](../../../public/js/shared/theme.js) | `loadThemeConfig()` 拉取 `/data/theme-presets.json`,提供经典/歌单板预设、色板、标签访问器,兼容层挂 `window.AdminApp.theme` |
| Utils | [shared/utils.js](../../../public/js/shared/utils.js) | `api/readJsonResponse/toast/escapeHtml/formatBytes/dangerConfirm/…`(清单见 [comms.md](comms.md) §2) |
| Desktop | [desktop.js](../../../public/js/desktop.js) | 桌面外壳:更新状态机渲染、`desktop.getInfo()` 版本徽章、`onShowUpdatePage`/`onUpdateState` 回调订阅(详见 [comms.md](comms.md) §4) |

**模块注册惯例**:Classic Script 模块在 IIFE 内自执行,把公共函数挂到 `window.AdminApp.<模块名>`;ES Module 模块(如 `forms.js`/`state.js`/`app.js`)导出类 + 单例,同时保留 `window.AdminApp` 兼容层(文件内注释标注"阶段5时删除")。**跨模块调用一律走 `window.AdminApp.*` 或 EventBus,不互相 import**(避免 Classic/ESM 混合依赖)。

**事件流约定**:

| 事件 | 发布方 → 订阅方 | 用途 |
|---|---|---|
| `Events.STATE_LOADED` | app.js(接 stateService)→ queue.renderState | 每次快照/`/api/state` 后重渲染队列、SC、状态条、礼物面板 |
| `Events.SONG_UPDATED` | app.js(接 stateService)→ songs.renderSongs | 歌库列表/筛选器重渲染 |
| `Events.GIFT_RECEIVED` | stateService(礼物类 reason)→ 礼物通知模块 | 新礼物 toast 触发 |
| `Events.OVERTIME_UPDATED` | stateService(overtime:update)→ overtime.js | 加班机面板增量刷新(带 revision 去重) |
| CustomEvent `app:lyric-state` / `app:lyric-timeline` / `app:wesing-state` / `app:settings-state` | stateService → 各页面 `window.addEventListener` | WeSing 面板、桌面歌词预览、设置自动保存就绪信号 |

**模块间直接调用示例**:`queue.renderState` 内调 `forms.fillForm(settings)`、`gifts.renderGiftPanel(...)`、`songs.renderCategoryFilter(...)`([queue.js:92-115](../../../public/js/admin/queue.js#L92-L115))——渲染链从快照事件出发、经 `window.AdminApp.*` 串联,各模块不需要互相 import。

## 3. 启动时序

### 3.1 模块加载([index.js](../../../public/js/admin/index.js))

`admin.html` 按序加载共享层与全部 admin 模块(顺序即依赖顺序):`shared/utils` → `shared/theme` → `desktop.js` → `import` → `queue` → `songs` → `theme` → `display` → `settings` → `gifts/*`(notification/detection/sprint/recent/blindbox/blindbox-analysis/history/index)→ `metrics` → `danmaku-tool` → `xiaomi-ai-settings` → `todo` → `other` → `overtime` → `desktop-lyric-preview` → `desktop-lyric` → `app.js`。另有 `<script type="module" src="/js/playback.js">` 异步加载播放助手。

### 3.2 初始化([app.js:18-99](../../../public/js/admin/app.js#L18-L99))

1. `await Theme.loadThemeConfig()` 预载主题配置
2. DI 注册五个服务
3. `initMainPages()` 绑定主页面 Tab(按 hash 选中初始页)
4. `formsService.initWorkspaceControls()` + `initTabs()`(播放器默认收起、ESC/空格快捷键、快速入队折叠)
5. 监听 `playback-module-loaded` 事件(播放助手模块异步加载完成后)调 `initPlaybackAssistant(options)`,把 `getSongs/reloadSongs/toast/showError/api/readJsonResponse` 注入播放控制器([app.js:104-115](../../../public/js/admin/app.js#L104-L115))
6. `desktop.initDesktopShell()`(仅桌面环境)
7. 逐个初始化各模块表单(`queue/songs/settings/theme/display/desktopLyric/metrics/overtime/todo/other/gifts`)
8. `stateService.connectSocket()` + `await stateService.reloadAll()`(先 WS 后 HTTP 兜底)
9. 渲染主题预设卡片

## 4. 点歌主页面模块

### 4.1 queue.js(队列与 SC)

- 渲染:点歌队列 = `current + waiting` 拼表,置顶📌、序号、来源标签(`admin/danmaku/superchat/random:<scope>`/history)、SC 列表(价格降序、已处理状态);长歌名分级字号(`data-length="long|very-long"`);管理员队列字体预览(`--admin-queue-font-family`,[queue.js:236-243](../../../public/js/admin/queue.js#L236-L243))。
- 操作:`/api/queue/action`(next/clear/pin/unpin/delete)、`/api/superchats/action`(assist/unassist/delete),成功后 `reloadState()` 乐观刷新;清空队列走 `dangerConfirm` 二次确认;首行(当前播放)不显示置顶按钮,置顶按钮行为随 `is_pinned` 切换(↧/↑)。
- 状态条联动:歌库计数 `#songCount`、队列计数 `#queueSize`、`#liveStatus`(连接态/主播名/房间号)都在此渲染;主播名非空且已连接时置顶显示([queue.js:117-136](../../../public/js/admin/queue.js#L117-L136))。
- 滚轮处理:队列内滚动用 wheel 事件归一化(deltaMode 换算),到达边界后放行页面滚动([queue.js:47-74](../../../public/js/admin/queue.js#L47-L74))。

### 4.2 songs.js(歌库)

- 渲染:`/api/songs` 列表(首字母/歌名/歌手/分类/标签/语言/可点状态),行操作:编辑(载入表单)、入队(`/api/queue/add`,source=admin)、删除(`dangerConfirm` + `/api/songs/delete`)。
- 筛选:搜索框 180ms 防抖、分类/标签多选(`details` 下拉 + 点击外部收起,见 [song-category-filter.js](../../../public/js/admin/song-category-filter.js))、语言/歌手下拉、`enabledOnly` 开关——任何变化触发 `reloadSongs()`。

### 4.3 settings.js(设置)

- 表单收集 `roomId/enableBilibili/paused/queueLimit/userCooldownSeconds/onlyFromLibrary/allowDuplicate` → `POST /api/settings`。
- 立即生效开关:礼物检测 `enableGiftSprint`、礼物提示 `enableGiftNotification`(失败回滚 checkbox)。
- Bilibili 扫码登录(仅桌面,`window.bilibiliAuth`,Web 模式禁用);登出走 `logoutConfirm` 弹窗。
- 盲盒映射:表单添加(chip 展示)/高级 JSON 编辑/逐条删除,保存到 `giftBlindBoxConfig` 设置。
- 盲盒投屏:由 `blindboxOverlayTitle/Top/WinnersOnly/HeartBoxOnly` 实时生成 `/blindbox?top=&title=&winners=&heartBox=` URL([settings.js:354-380](../../../public/js/admin/settings.js#L354-L380))。
- 系统操作:清歌库/清 SC/清全部(`dangerConfirm` + `/api/database/*`)、退出(`/api/system/shutdown` 后整页替换为退出屏,桌面版带"重新启动"按钮)、刷新直播(`/api/bilibili/reconnect`)。

### 4.4 theme.js(点歌板)与 display.js(展示板)

- 两者共用 `fillForm` 把预设/快照值写回表单,`input/change` 事件 180ms 防抖自动保存到 `/api/settings`(`theme.js` 的 `collectTheme()` 收集约 40 个键;`display.js` 的 `collectDisplay()` 含 `songBoardSyncTheme` 开关——开启时歌单板跟随主主题)。
- 预设卡片点击套用(`classicPresets`/`songBoardPresets`);`quickBeautifyBtn` 一键美化;点歌板样式切换(`overlayQueueStyle`:classic ↔ identity,需要重启时提示)。
- `display.initOverlayUrls()` 生成 `/queue`、`/songlist`、`/lyrics` 的 OBS 地址文本(以 `127.0.0.1` 规范化)。

### 4.5 import.js(批量导入)

- 输入源:粘贴文本 或 文件(.tsv/.csv/.xlsx)。文本先解析表格(引号转义、表头别名映射 `歌名/歌手/分类/标签/可点/语言/核对平台/备注`,无表头按列位),`readTextFile` 做 UTF-8→GB18030 编码回退;xlsx 读 base64 提交 `/api/songs/import-xlsx`;结果渲染 `总行数/成功/重复/失败/新增分类`。
- 表头识别:命中任一别名(如 `歌曲名字`/`歌名`/`name`)才按表头解析,否则整表按固定列序([import.js:52-85](../../../public/js/admin/import.js#L52-L85));`可点` 列支持 `是/可点/true/1` 与 `否/停用/false/0` 语义。
- 成功后 `reloadAll()` 使歌库、分类、计数立即生效。

### 4.6 metrics.js(性能检测)

- 手动触发:`/api/system/metrics?windowMs=5000`(系统 + 服务进程 CPU/GPU/内存),5 秒采样,阈值 70%/85% 分 warn/danger 色阶([metrics.js:113-118](../../../public/js/admin/metrics.js#L113-L118))。
- 采样期间按钮进入 busy 态(显示"检测 5 秒"),结果展示采样窗口/时间/服务 PID/运行时长,不可用指标(如 GPU 缺失)置灰显示。

## 5. 礼物主页面(gifts/)

渲染入口 `gifts/index.js` 的 `renderGiftPanel(gifts, sprint, live, diagnostics, settings)`,由 queue.js 在每次快照时调用:

| 子模块 | 面板 | 数据源 |
|---|---|---|
| detection.js | 礼物检测状态(toggle + 共享收礼核心状态) | snapshot `giftDetection`/`giftSprint`/`liveStatus` |
| notification.js | 礼物提示(桌面 toast,`gift-notify-toast`,最多 6 条) | snapshot `gifts.recent` 新增比对 |
| sprint.js | 月底冲刺(目标/已收/剩余,水晶球) | snapshot `giftSprint` |
| recent.js | 最近礼物(最多 6 行,高价值礼物专用图标映射) | snapshot `gifts.recent` |
| blindbox.js | 今日盲盒盈亏(汇总/盈亏榜/映射列表) | `GET /api/gifts/blind-box-stats` |
| blindbox-analysis.js | 盲盒分析工作区(观众排行/盲盒汇总/开盒记录三视图,25 条分页,500ms 刷新防抖) | `GET /api/gifts/blind-box-analysis?...` |
| history.js | 礼物历史抽屉(时间范围/平台筛选) | `GET /api/gifts/history`;清最近/清礼物走 `/api/gifts/clear-recent`、`/api/database/clear-gifts` |

## 6. 百宝箱(otherAssistantPage)

`other.js` 只负责**功能导航**(侧边栏可折叠、方向键/WAI-ARIA tab 模式、localStorage 记住选中项),各面板由独立模块初始化:

| 功能 | 模块 | 内容与数据源 |
|---|---|---|
| 弹幕姬 | [danmaku-tool.js](../../../public/js/admin/danmaku-tool.js) | 发送弹幕(`/api/bilibili/danmaku/send`,Ctrl+Enter 快捷发送,超长自动拆条并提示条数)、连接/账号/房间状态(`/api/bilibili/danmaku/state`,断开时可一键重连并回读新状态)、四个机器人开关(`enableRandomTagReply/enableCheckinBot/enableFortuneBot/enableCustomReplyBot`,无发送权限时禁用) |
| 弹幕库编辑器 | [danmaku-libraries.js](../../../public/js/admin/danmaku-libraries.js) | 签到祝福语 / 抽签词库 / DIY 关键词回复 三个编辑器的工厂(加载/增删/脏标记/保存到对应 settings 键) |
| 小爱 AI | [xiaomi-ai-settings.js](../../../public/js/admin/xiaomi-ai-settings.js) | DeepSeek 配置:`/api/ai/config`(PUT 保存)、`/api/ai/status`、`/api/ai/test/<provider>`(deepseek/qweather/amap 三路连通性测试)、`/api/ai/models`(按 apiKey 拉模型列表,支持下拉选择);700ms 自动保存 + 保存失败重试队列 |
| 加班机 | [overtime.js](../../../public/js/admin/overtime.js) | 控制台:启用/开始/暂停/重置(`/api/overtime/action`)、初始时间(`/api/overtime/time`)、礼物规则编辑器(固定时间 / 时间盲盒,权重 1-10000、最多 10 结果、最多 8 条启用规则,`/api/overtime/rules`)、背景(`/api/overtime/config`)、结算流水、内置 `/overtime` 预览 iframe(`?quality=low`) |
| 主播计划 | [todo.js](../../../public/js/admin/todo.js) | **纯 localStorage 规划器**(`admin.streamerPlanner.v1`):今天/本周/本月三栏,学歌/开播准备/内容发布/直播复盘四类,进度 0-100% 五档(学歌类用"还没听熟/能跟伴奏唱/可以上播"文案),首次启动播种 6 条示例任务;模板按钮一键填充表单;不经过后端 |
| 性能检测 | metrics.js(见 §4.6) | |
| 使用文档 / 桌面更新 | — / [desktop.js](../../../public/js/desktop.js) | 文档链接;更新检查/下载/安装进度条、重启确认弹窗、`desktop-set-auto-update` |

桌面歌词设置页(点歌主页面 Tab):[desktop-lyric.js](../../../public/js/admin/desktop-lyric.js) 收集 `desktopLyric*` 12 个键 → `/api/settings`,500ms 自动保存(带"等待自动保存/已保存/失败"状态条);[desktop-lyric-preview.js](../../../public/js/admin/desktop-lyric-preview.js) 用 `LyricWordRenderer` + 弹簧动画控制器(`SPRING_STIFFNESS=170, SPRING_DAMPING=26`,[desktop-lyric-preview.js:26-29](../../../public/js/admin/desktop-lyric-preview.js#L26-L29))渲染完整时间轴预览,滚轮缩放、暂停 6 秒手动跟随。

## 7. 设置持久化流程

```
表单 input/change ──→ debounce(180ms)/autosave ──→ POST /api/settings {key:value,…}
   ↑                                                       │
   │                        settings-store 写库(见 storage.md §7)
   └── WS snapshot(settings 字段)全量回推,fillForm 写回表单(正在编辑的控件除外)
```

- 所有设置键经同一个 `/api/settings` 端点(端点定义见 [api.md](../backend/api.md));DB 持久化与默认键见 [storage.md](../backend/storage.md) §7。
- 前端不维护"已保存"标志:每次快照都回灌表单,保证多窗口/叠加层视觉一致;AI 配置等含密钥的设置**不**走通用 settings(见 [storage.md](../backend/storage.md) §3.1 `ai_configuration`)。
- 各表单的保存节奏不同:点歌板/展示板 **180ms 防抖自动保存**(input/change),设置页**提交时保存**,桌面歌词 **500ms 自动保存**(带"读取设置中→等待→已保存"状态条与失败重试,[desktop-lyric.js:31-90](../../../public/js/admin/desktop-lyric.js#L31-L90)),小爱 AI **700ms 自动保存**。
- `fillForm` 的"正在编辑不覆盖"规则([forms.js:174-179](../../../public/js/admin/forms.js#L174-L179)):快照回灌时跳过 `document.activeElement`,避免用户输入被实时快照打断。

## 8. 播放助手页(playbackAssistantPage)

见 [playback.md](playback.md):播放器面板(默认收起 dock)、快捷入口、WeSing 歌词现场面板、在线搜索、点歌匹配诊断区由 `playback/*` 渲染,桥接方式见 [app.md](app.md) §3.2 的 `initPlaybackAssistant` 注入。

## 9. 子页面:gift-audit.html 与 debug-gifts.html

| 页面 | 用途 | 数据源 |
|---|---|---|
| [gift-audit.html](../../../public/pages/gift-audit.html) | **气泡 × WebSocket 交叉对比审计**:左右两栏分别显示直播间气泡流事件与 WS 收到的事件,逐一核对礼物/SC 是否一致、缺失与多出;支持时间范围过滤、事件详情、手动重放投递(测试通知链路) | WS `/ws` + `GET /api/state`(基线) |
| [debug-gifts.html](../../../public/pages/debug-gifts.html) | **礼物消息诊断**:连接状态条、解析统计卡片(最近消息时间/解析计数/心跳)、cmd 分解(按 cmd 统计)、`messageBuffer` 原始报文回放(服务端容量 500,见 [server-core.md](../backend/server-core.md) §5) | WS `/ws`(含 `bilibiliDiagnostics` 快照字段,定义见 [ws.md](../backend/ws.md) §2) |

两页均为独立内联脚本单文件,深色开发者风格,无构建依赖;经 `/pages/*.html` 文件路径直接访问(不在 pageMap 中,见 [pages.md](pages.md) §2)。
