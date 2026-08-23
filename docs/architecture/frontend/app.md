# Admin 应用与公共框架

> 涉及文件:[pages/admin/](../../../public/pages/admin/)、[server/admin-page.js](../../../src/server/admin-page.js)、[admin-page-composition.test.js](../../../test/admin-page-composition.test.js)、[js/admin/index.js](../../../public/js/admin/index.js)、[js/admin/app.js](../../../public/js/admin/app.js)、[js/admin/legacy-admin-bridge.js](../../../public/js/admin/legacy-admin-bridge.js)、[js/admin/state.js](../../../public/js/admin/state.js)、[js/admin/forms.js](../../../public/js/admin/forms.js)、[js/shared/](../../../public/js/shared/)、[js/desktop.js](../../../public/js/desktop.js)、[js/admin/gifts/](../../../public/js/admin/gifts/)、[pages/gift-audit.html](../../../public/pages/gift-audit.html)、[pages/debug-gifts.html](../../../public/pages/debug-gifts.html)

本文档描述管理后台(`/admin`)的页面结构、公共框架与各业务模块。通信行为见 [comms.md](comms.md),端点定义见 [api.md](../backend/api.md),快照与消息类型见 [ws.md](../backend/ws.md),IPC 通道见 [desktop/preload.md](../desktop/preload.md)。

## 1. 页面结构

管理页 HTML 分片位于 [pages/admin/](../../../public/pages/admin/)，由
[server/admin-page.js](../../../src/server/admin-page.js) 按固定顺序组合；完整性、顺序和唯一 ID 由
[admin-page-composition.test.js](../../../test/admin-page-composition.test.js) 保护。

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
└── #otherAssistantPage    百宝箱(#other):左侧功能导航 + 面板(弹幕姬/礼物姬/加班机/礼物特效/主播工作台/开播动画/萌时钟/性能检测/使用文档/桌面更新)
```

六个内部 Tab 的内容由 [pages/admin/song/](../../../public/pages/admin/song/) 下的分片组成:

| Tab | 主要内容 |
|---|---|
| 歌库 | 歌曲表格 + 搜索/分类/语言/歌手/标签/启停筛选 + 编辑表单 |
| 设置 | 直播间(roomId/开关)、点歌行为、队列上限/冷却、清库按钮、Bilibili 登录、退出程序 |
| 点歌板 | 经典/身份/奶油画框三种样式切换、预设卡片、规则与置顶文案、主题色/字号/滚动/字体 |
| 展示板 | 歌单板独立主题(可同步主主题)、滚动秒数、字号、预设卡片 |
| 直播画面 | `/queue`、`/songlist`、`/lyrics` OBS 地址 + 盲盒投屏链接生成 |
| 导入导出 | 文本/文件导入、导入结果统计 |
| 桌面歌词设置 | `desktopLyric*` 全套 + 实时预览(弹簧跟随) |

主页面切换由 [app.js](../../../public/js/admin/app.js) 的 `setMainPage` 负责:维护 `VALID_MAIN_PAGES`/`MAIN_PAGE_HASH_MAP`/`MAIN_PAGE_BODY_MAP` 三张表,切换 `body.dataset.mainPage` 并同步 `location.hash`(`#playback`/`#gifts`/`#other` 直达,[app.js:120-167](../../../public/js/admin/app.js#L120-L167))。

**桌面形态**:`/admin?desktop=1` 时由 [shell-start.html](../../../public/pages/admin/shell-start.html) 在 CSS 加载前给 `html` 加 `desktop-shell` 类,加载 `css/overlays/desktop.css` 的暖金主题,顶栏变为 `-webkit-app-region: drag` 拖拽区,`#windowControls` 与 `.desktop-only` 元素显示([desktop.js:14-17](../../../public/js/desktop.js#L14-L17))。

## 2. 公共框架(shared/)

| 模块 | 文件 | 说明 |
|---|---|---|
| EventBus | [shared/event-bus.js](../../../public/js/shared/event-bus.js) | 应用内事件总线(`on/off/once/emit/clear`),单例挂 `window.AdminApp.eventBus`;常用事件常量 `Events`(SONG_ADDED/QUEUE_UPDATED/PLAYBACK_*/GIFT_RECEIVED/OVERTIME_UPDATED/STATE_LOADED/STATE_SAVED 等,[event-bus.js:181-211](../../../public/js/shared/event-bus.js#L181-L211)) |
| Legacy Bridge | [admin/legacy-admin-bridge.js](../../../public/js/admin/legacy-admin-bridge.js) | 迁移期唯一允许访问 `window.AdminApp` 的边界;`app.js` 通过 `getLegacyAdminModules()` 取得窄兼容接口,通过 `publishNavigation()` 发布导航 API |
| StateService | [admin/state.js](../../../public/js/admin/state.js) | 全局状态唯一入口:WS 客户端 + `/api/state` + `/api/songs` 加载,快照经 EventBus 派发 `STATE_LOADED`/`SONG_UPDATED`,同时以 CustomEvent(`app:wesing-state` 等)广播实时状态(详见 [comms.md](comms.md) §3) |
| FormsService | [admin/forms.js](../../../public/js/admin/forms.js) | 表单工具:`bindRangePair`(range↔number 双向)、`initTabs`、`fillForm`(快照设置→表单,正在编辑的输入框不被覆盖,[forms.js:174-179](../../../public/js/admin/forms.js#L174-L179))、播放器全屏/收起、滚动速度与字号归一化 |
| Logger | [shared/logger.js](../../../public/js/shared/logger.js) | 生产自动禁用 debug 日志(仅 localhost/127.0.0.1 或 `AdminApp.debug` 时输出) |
| Theme | [shared/theme.js](../../../public/js/shared/theme.js) | `loadThemeConfig()` 拉取 `/data/theme-presets.json`,提供经典/歌单板预设、色板、标签访问器,兼容层挂 `window.AdminApp.theme` |
| Utils | [shared/utils.js](../../../public/js/shared/utils.js) | `api/readJsonResponse/toast/escapeHtml/formatBytes/dangerConfirm/…`(清单见 [comms.md](comms.md) §2) |
| Desktop | [desktop.js](../../../public/js/desktop.js) | 桌面外壳:更新状态机渲染、`desktop.getInfo()` 版本徽章、`onShowUpdatePage`/`onUpdateState` 回调订阅(详见 [comms.md](comms.md) §4) |

**模块注册惯例**:遗留模块仍可在 IIFE 内把公共函数注册到 `window.AdminApp.<模块名>`,但新 ESM 代码禁止直接访问该全局;所有兼容读取集中在 `legacy-admin-bridge.js`。新模块优先使用具名 import/export 和显式工厂参数;EventBus 只承担一对多通知,不作为隐藏的请求/响应依赖。

**事件流约定**:

| 事件 | 发布方 → 订阅方 | 用途 |
|---|---|---|
| `Events.STATE_LOADED` | app.js(接 stateService)→ queue.renderState | 每次快照/`/api/state` 后重渲染队列、SC、状态条、礼物面板 |
| `Events.SONG_UPDATED` | app.js(接 stateService)→ songs.renderSongs | 歌库列表/筛选器重渲染 |
| `Events.GIFT_RECEIVED` | stateService(礼物类 reason)→ 礼物通知模块 | 新礼物 toast 触发 |
| `Events.OVERTIME_UPDATED` | stateService(overtime:update)→ overtime.js | 加班机面板增量刷新(带 revision 去重) |
| CustomEvent `app:lyric-state` / `app:lyric-timeline` / `app:wesing-state` / `app:settings-state` | stateService → 各页面 `window.addEventListener` | WeSing 面板、桌面歌词预览、设置自动保存就绪信号 |

**迁移期调用示例**:`app.js` 收到 `STATE_LOADED` 后通过 bridge 返回的 `queue.renderState` 渲染;遗留模块内部现有的全局调用保持兼容,新增跨模块调用不得继续扩大该模式。

## 3. 启动时序

### 3.1 模块加载([index.js](../../../public/js/admin/index.js))

[document-end.html](../../../public/pages/admin/document-end.html) 加载 [index.js](../../../public/js/admin/index.js)，入口按序导入共享层与全部 Admin 模块(顺序即依赖顺序):`shared/utils` → `shared/theme` → `desktop.js` → `import` → `queue` → `songs` → `theme` → `display` → `settings` → `gifts/*`(notification/detection/sprint/recent/blindbox/blindbox-analysis/history/index)→ `metrics` → `danmaku-tool` → `ai-assistant-settings` → `todo` → `other` → `overtime` → `gift-effects` → `desktop-lyric-preview` → `desktop-lyric` → `app.js`。同一分片另加载 `<script type="module" src="/js/playback.js">` 播放助手入口。

### 3.2 初始化([app.js:18-99](../../../public/js/admin/app.js#L18-L99))

1. `await Theme.loadThemeConfig()` 预载主题配置
2. `initMainPages()` 绑定主页面 Tab(按 hash 选中初始页)
3. `formsService.initWorkspaceControls()` + `initTabs()`(播放器默认收起、ESC/空格快捷键、快速入队折叠)
4. 监听 `playback-module-loaded` 事件(播放助手模块异步加载完成后)调 `initPlaybackAssistant(options)`,把浏览器基础设施能力注入播放控制器
5. 通过 `legacy-admin-bridge` 取得迁移期模块并逐个初始化(`desktop/queue/songs/settings/theme/display/desktopLyric/metrics/overtime/todo/other/gifts`)
6. `stateService.connectSocket()` + `await stateService.reloadAll()`(先 WS 后 HTTP 兜底)
7. 渲染主题预设卡片

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

- 两者共用 `fillForm` 把预设/快照值写回表单,`input/change` 事件 180ms 防抖自动保存到 `/api/settings`(`theme.js` 的 `collectTheme()` 收集约 40 个键;`display.js` 的 `collectDisplay()` 含 `songBoardSyncTheme` 开关——开启时歌单板跟随主主题)。`local-font-library.js` 统一查询、净化、去重并分发本机字体族;点歌板风格 3–6 与桌面歌词选择器共用一次查询,各自保留内置选项和已保存值。
- 预设卡片点击套用(`classicPresets`/`songBoardPresets`);`quickBeautifyBtn` 一键美化;点歌板样式切换(`overlayQueueStyle`:classic / identity / storybook / neon-vinyl / cherry-ribbon / golden-lily,遗留 festival 归一为 identity,需要重启时提示)。风格 1、2 的选择卡片使用中性底色,风格 3–6 保留素材主题色。管理页复用一组风格 2–6 控件,但通过 `queue-style-settings.js` 只填充并提交当前风格拥有的内容字号与纵向滚动设置;风格 3–6 的字体、字重、自定义正文颜色也分别持久化,切换或自动保存不会覆盖其他风格。风格 2 专属的置顶与规则设置不向插画风格显示或提交。
- `display.initOverlayUrls()` 生成 `/queue`、`/songlist`、`/lyrics` 的 OBS 地址文本(以 `127.0.0.1` 规范化)。

### 4.5 import.js(批量导入)

- 输入源:粘贴文本 或 文件(.tsv/.csv/.xlsx)。文本先解析表格(引号转义、表头别名映射 `歌名/歌手/分类/标签/可点/语言/核对平台/备注`,无表头按列位),`readTextFile` 做 UTF-8→GB18030 编码回退;xlsx 读 base64 提交 `/api/songs/import-xlsx`;结果渲染 `总行数/成功/重复/失败/新增分类`。
- 表头识别:命中任一别名(如 `歌曲名字`/`歌名`/`name`)才按表头解析,否则整表按固定列序([import.js:52-85](../../../public/js/admin/import.js#L52-L85));`可点` 列支持 `是/可点/true/1` 与 `否/停用/false/0` 语义。
- 成功后 `reloadAll()` 使歌库、分类、计数立即生效。

### 4.6 metrics.js(性能检测)

- 手动触发:`/api/system/metrics?windowMs=5000`(系统 + 服务进程 CPU/GPU/内存),5 秒采样,阈值 70%/85% 分 warn/danger 色阶([metrics.js:113-118](../../../public/js/admin/metrics.js#L113-L118))。
- 页面仅保留一个检测按钮；旁侧圆环待机显示 5 秒采样时长，采样期间按秒倒计时并收拢进度环，同时按钮进入 busy 态。结果展示采样窗口/时间/服务 PID/运行时长,不可用指标(如 GPU 缺失)置灰显示。
- 硬件概览在进入性能页时请求 `/api/system/hardware`，显示 CPU/物理 GPU/内存型号与容量并排除虚拟显示适配器；CPU 温度不可用时显示“未知”，内存不显示温度行，GPU 温度只随用户发起的 5 秒检测请求 `includeTemperatures=true`，不设置后台定时器。

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
| [gift-frame.js](../../../public/js/admin/gift-frame.js) | 礼物姬里的四方边框开关、金额阈值、主题/动效、预览和投屏地址 | `/api/settings`、`POST /api/gifts/frame/preview`、`app:settings-state` |

## 6. 百宝箱(otherAssistantPage)

`other.js` 只负责**功能导航**(侧边栏可折叠、方向键/WAI-ARIA tab 模式、localStorage 记住选中项),各面板由独立模块初始化:

| 功能 | 模块 | 内容与数据源 |
|---|---|---|
| 弹幕姬 | [danmaku-tool.js](../../../public/js/admin/danmaku-tool.js) | 面板按连接状态、弹幕姬、发送弹幕、AI 回复和固定回复归类；固定回复组统一放置点歌未匹配、签到、抽签和 DIY 关键词回复开关及词库编辑器。弹幕姬区域提供固定 `/danmaku` 地址的复制/打开按钮、聊天气泡/直播信号带/极简字幕三张可视化主题卡，并用 `/danmaku?preview=1&style=…` iframe 复用同一页面即时预览；选择保存到 `danmakuOverlayStyle`，由后续 snapshot 同步到已打开页面。发送弹幕只保留在 Admin（`/api/bilibili/danmaku/send`,Ctrl+Enter 快捷发送,超长自动拆条并提示条数），不另设网页地址。连接/账号/房间状态来自 `/api/bilibili/danmaku/state`，断开时可一键重连并回读新状态；四个机器人开关为 `enableRandomTagReply/enableCheckinBot/enableFortuneBot/enableCustomReplyBot`，无发送权限时禁用 |
| 弹幕库编辑器 | [danmaku-libraries.js](../../../public/js/admin/danmaku-libraries.js) | 签到祝福语 / 抽签词库 / DIY 关键词回复 三个编辑器的工厂(加载/增删/脏标记/保存到对应 settings 键) |
| AI 互动助手 | [ai-assistant-settings.js](../../../public/js/admin/ai-assistant-settings.js) | 模型服务配置:`/api/ai/config`(PUT 保存)、`/api/ai/status`、`/api/ai/test/<provider>`、`/api/ai/models`；电脑端先选自动识别、DeepSeek、OpenAI、Claude、Gemini 或自定义，官方预设锁定地址/协议，自动与自定义允许编辑；按服务端 `modelEndpoint` 显示协议、联网方式与可用推理控件；密钥字段使用 password + `'********'` 遮罩且提交时过滤遮罩值；700ms 自动保存 + 保存失败重试队列 |
| 礼物姬 · 礼物边框 | [gift-frame.js](../../../public/js/admin/gift-frame.js) | 保存 `giftFrameEnabled`、`giftFrameThresholdRmb`、`giftFrameTheme`、`giftFrameMotionMode`；预览只发 `gift:frame` 事件，不影响实时开关与事件去重 |
| 加班机 | [overtime.js](../../../public/js/admin/overtime.js) + [overtime-rule-editor.js](../../../public/js/admin/overtime-rule-editor.js) | 控制台:启用/开始/暂停/重置(`/api/overtime/action`)、初始时间(`/api/overtime/time`)、礼物规则编辑器(固定时间 / 时间盲盒,`/api/overtime/rules`)、背景(`/api/overtime/config`)、结算流水、内置 `/overtime` 预览 iframe(`?quality=low`);**Round-trip contract**:前端从 `GET /api/overtime` 的 `limits` 字段获取服务端限制(maxSeconds/maxEffectFactor/maxRandomWeight/maxEnabledRules),用于 UI 提示与客户端验证;前端必须保留服务端接受的任何值,即使超出 UI 输入控件范围(如 999h 小时选择器无法编辑 9999 年的值),只读展示 + 隐藏字段保存,最大值验证交给服务端;详见 [overtime.md](../backend/overtime.md) §4 |
| 小游戏直播台 | [games.js](../../../public/js/admin/games.js) | 固定 `/games` 地址 + 数字炸弹/五子棋/你画我猜单会话互斥；第三张画猜卡片向下展开，可设置 1–12 局和每局 15–300 秒，并从 9 类、每类 100 词的固定题库中全选、清空或组合本场分类，未选分类时禁止开局，开局后锁定选择；`GET /api/games/host-state` 私下显示题词并恢复 `categoryIds`，`game:update` 驱动主持状态与 10/7/5/3 积分；画猜控制拆分为结束作画、公布答案、开始下一题，超时后仍捕捉弹幕但不计分；独立 `/wheel` 不参与互斥 |
| 主播工作台 | [todo.js](../../../public/js/admin/todo.js) | **纯 localStorage 工作台**(`admin.streamerWorkbench.v2`):保存下一场直播日期/时间/主题/重点,按开播前/直播中/下播后三阶段管理完成态清单,现场备忘分内容灵感/观众约定/复盘记录并可转为计划;首次启动提供 4 条实用备播/复盘清单,读取旧 `admin.streamerPlanner.v1` 时迁移任务但不删除旧键;不经过后端 |
| 萌时钟 | [clock-card.js](../../../public/js/admin/clock-card.js) | 固定 `/clock` Browser Source 地址与带参数地址生成器；桃桃便签/星夜软糖两套风格、日期/秒数、12/24 小时制和 16 字角标文案都直接写入 URL，并用同页 iframe 实时预览，不持久化设置 |
| 性能检测 | metrics.js(见 §4.6) | |
| 使用文档 / 桌面更新 | [usage-guide.js](../../../public/js/admin/usage-guide.js) / [desktop.js](../../../public/js/desktop.js) | 目录锚点平滑滚动与章节高亮、侧栏收缩时切换双栏目录;更新检查/下载/安装进度条、重启确认弹窗、`desktop-set-auto-update` |
| 首次启动引导 | [onboarding.js](../../../public/js/admin/onboarding.js) / [interactive-tour.js](../../../public/js/admin/interactive-tour.js) | 配置遮罩通过现有认证、设置、AI 接口验证状态，完成标记写入普通 settings；交互式导览只在用户配置首次使用时自动展示一次，并立即写入 `localStorage.liraTourFirstRunShown`，已有任意 `liraTourCompleted` 值也视为展示过，覆盖安装、版本升级和手动重看均不重新启用自动展示 |

桌面歌词设置页(点歌主页面 Tab):[desktop-lyric.js](../../../public/js/admin/desktop-lyric.js) 收集 `desktopLyric*` 12 个键 → `/api/settings`,500ms 自动保存(带"等待自动保存/已保存/失败"状态条);客户端打开设置页时自动通过 Chromium `queryLocalFonts()` 读取、去重字体族名称并追加到主字体下拉框,若 Chromium 首次调用要求瞬时用户激活则在用户首次正常点击/按键时自动重试,不提供单独获取按钮;权限边界与原生确认见 [desktop/main.md](../desktop/main.md) §4;[desktop-lyric-preview.js](../../../public/js/admin/desktop-lyric-preview.js) 用 `LyricWordRenderer` + 弹簧动画控制器(`SPRING_STIFFNESS=170, SPRING_DAMPING=26`,[desktop-lyric-preview.js:26-29](../../../public/js/admin/desktop-lyric-preview.js#L26-L29))渲染完整时间轴预览,滚轮缩放、暂停 6 秒手动跟随。

## 7. 设置持久化流程

```
表单 input/change ──→ debounce(180ms)/autosave ──→ POST /api/settings {key:value,…}
   ↑                                                       │
   │                        settings-store 写库(见 storage.md §7)
   └── WS snapshot(settings 字段)全量回推,fillForm 写回表单(正在编辑的控件除外)
```

- 所有设置键经同一个 `/api/settings` 端点(端点定义见 [api.md](../backend/api.md));DB 持久化与默认键见 [storage.md](../backend/storage.md) §7。
- 前端不维护"已保存"标志:每次快照都回灌表单,保证多窗口/叠加层视觉一致;AI 配置等含密钥的设置**不**走通用 settings(见 [storage.md](../backend/storage.md) §3.1 `ai_configuration`)。
- 各表单的保存节奏不同:点歌板/展示板 **180ms 防抖自动保存**(input/change),设置页**提交时保存**,桌面歌词 **500ms 自动保存**(带"读取设置中→等待→已保存"状态条与失败重试,[desktop-lyric.js:31-90](../../../public/js/admin/desktop-lyric.js#L31-L90)),AI 互动助手 **700ms 自动保存**。
- `fillForm` 的"正在编辑不覆盖"规则([forms.js:174-179](../../../public/js/admin/forms.js#L174-L179)):快照回灌时跳过 `document.activeElement`,避免用户输入被实时快照打断。

## 8. 播放助手页(playbackAssistantPage)

见 [playback.md](playback.md):播放器面板(默认收起 dock)、快捷入口、WeSing 歌词现场面板、在线搜索、点歌匹配诊断区由 `playback/*` 渲染,桥接方式见 [app.md](app.md) §3.2 的 `initPlaybackAssistant` 注入。

## 9. 子页面:gift-audit.html 与 debug-gifts.html

| 页面 | 用途 | 数据源 |
|---|---|---|
| [gift-audit.html](../../../public/pages/gift-audit.html) | **气泡 × WebSocket 交叉对比审计**:左右两栏分别显示直播间气泡流事件与 WS 收到的事件,逐一核对礼物/SC 是否一致、缺失与多出;支持时间范围过滤、事件详情、手动重放投递(测试通知链路) | WS `/ws` + `GET /api/state`(基线) |
| [debug-gifts.html](../../../public/pages/debug-gifts.html) | **礼物消息诊断**:连接状态条、解析统计卡片(最近消息时间/解析计数/心跳)、cmd 分解(按 cmd 统计)、`messageBuffer` 原始报文回放(服务端容量 500,见 [server-core.md](../backend/server-core.md) §5) | WS `/ws`(含 `bilibiliDiagnostics` 快照字段,定义见 [ws.md](../backend/ws.md) §2) |

两页均为独立内联脚本单文件,深色开发者风格,无构建依赖;经 `/pages/*.html` 文件路径直接访问(不在 pageMap 中,见 [pages.md](pages.md) §2)。
