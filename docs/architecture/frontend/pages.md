# 前端页面与入口清单

> 涉及文件:[pages/admin/](../../../public/pages/admin/)、[server/admin-page.js](../../../src/server/admin-page.js)、[admin-page-composition.test.js](../../../test/admin-page-composition.test.js)、[gift-audit.html](../../../public/pages/gift-audit.html)、[overlays/](../../../public/pages/overlays/)、[js/admin/](../../../public/js/admin/)、[js/playback/](../../../public/js/playback/)、[js/overlays/](../../../public/js/overlays/)、[js/shared/](../../../public/js/shared/)、[css/](../../../public/css/)、[img/](../../../public/img/)

本文档是前端**页面清单**的唯一事实源:每个页面是什么、由谁打开、入口 URL 只在此成表。URL → HTML 的映射表(`pageMap`)本身归 [server-core.md](../backend/server-core.md) §4.3 所有,此处只列出面向使用者的入口语义。

管理后台没有单一 `public/pages/admin.html` 文件。HTML 分片位于 [pages/admin/](../../../public/pages/admin/)，由 [server/admin-page.js](../../../src/server/admin-page.js) 组合，顺序由 [admin-page-composition.test.js](../../../test/admin-page-composition.test.js) 保护。

## 1. 技术选型

| 事实     | 说明                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 语言     | 零框架 Vanilla JS(ES Modules + Classic Scripts),无构建工具、无 TypeScript        |
| 样式     | 原生 CSS,按目录拆分,无预处理器                                                   |
| 实时通道 | WebSocket 全量快照(见 [comms.md](comms.md)、[ws.md](../backend/ws.md))           |
| 命令通道 | `fetch('/api/...')`(见 [comms.md](comms.md)、[api.md](../backend/api.md))        |
| 模块形态 | ES Module 带 `.js` 后缀的相对导入;Classic Script 挂载 `window.AdminApp.*` 兼容层 |

### 1.1 桌面 Admin 字体层级

桌面 Admin 的通用字体层级由 [styles-base.css](../../../public/css/styles-base.css) 中的 token 与 [admin/layout.css](../../../public/css/admin/layout.css) 中 `.app-shell` 范围内的语义角色共同持有。`styles-base.css` 只声明 token，不得增加会影响普通 `h1`、`p`、`small` 等元素的裸排版规则；页面和组件通过 `ui-*` 角色或组件自有的等价选择器消费这些值。

| 角色            | 字号 | 常用字重 | 用途                                   |
| --------------- | ---: | -------: | -------------------------------------- |
| display         | 28px |      700 | 少量展示型标题                         |
| page title      | 24px |      700 | 主工作区与百宝箱功能页锚点             |
| section title   | 18px |      700 | 面板、弹窗和主要内容分区               |
| card title      | 15px |      600 | 卡片标题、歌曲名与 Toast 标题          |
| body            | 14px |      400 | 正文、说明和普通状态文案               |
| control label   | 13px |      600 | 表单标签、按钮和导航控件               |
| caption         | 12px |      400 | 元数据、辅助说明和次级状态             |
| micro / eyebrow | 11px |      700 | 短标签、表头、状态徽标和 Latin eyebrow |

普通正文、帮助、错误与可操作说明不得小于 12px；11px 只用于短而有边界的 microcopy。计时器、歌词、硬件数值、图表与其他展示数据可使用组件自有的 metric/presentation 字号，但不能反向覆盖通用正文。常规字重限定为 400/500/600/700。

该契约只拥有 Electron/Admin chrome。`css/overlays/` 中除桌面外壳专用的 `overlays/desktop.css` 外，不消费 `ui-*` 或 `--type-*`；`/queue`、`/songlist` 继续读取持久化的 overlay 字体与字号，`/lyrics` 和 Admin 歌词预览继续读取同一组 `--preview-*` 用户配置。本地字体枚举仍只由桌面歌词设置的 `admin/local-font-library.js` 在用户手势后调用，不是 Admin 核心 UI 的依赖。

## 2. 入口 URL(唯一成表处)

所有页面都由后端 `servePageOrAsset` 提供(`pageMap` 见 [server-core.md](../backend/server-core.md) §4.3),响应 `Cache-Control: no-store`。

| 入口 URL           | 实际 HTML                                                                                                          | 打开者                                                       | 行为说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`           | [pages/admin/](../../../public/pages/admin/) 分片经 [server/admin-page.js](../../../src/server/admin-page.js) 组合 | 浏览器(手动或 `AUTO_OPEN_ADMIN=1` 自动打开)、Electron 主窗口 | 管理后台:点歌/播放/礼物/百宝箱四个主页面;`#playback`/`#gifts`/`#other` hash 直达对应主页面                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/admin?desktop=1` | 同上                                                                                                               | Electron 主窗口([desktop/main.md](../desktop/main.md))       | [shell-start.html](../../../public/pages/admin/shell-start.html) 在 CSS 加载前写入 `html.desktop-shell` 主题类(防粉色闪烁),显示标题栏拖拽区与窗口控制按钮;退出后展示桌面版重启屏                                                                                                                                                                                                                                                                                                                                             |
| `/settings`        | 同上                                                                                                               | 浏览器(旧书签/外部链接)                                      | 历史兼容入口,落到管理后台默认页(点歌)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/songs`           | 同上                                                                                                               | 浏览器                                                       | 同上,兼容入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/queue`           | [overlays/queue.html](../../../public/pages/overlays/queue.html)                                                   | OBS 浏览器源、独立浏览器窗口                                 | 点歌队列叠加层,透明背景                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/songlist`        | [overlays/songs.html](../../../public/pages/overlays/songs.html)                                                   | OBS 浏览器源                                                 | 歌单展示板叠加层,支持 `?category=` 过滤                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/blindbox`        | [overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)                                             | OBS 浏览器源                                                 | 盲盒盈亏投屏,支持 `?top=/winners=/heartBox=/title=` 等参数(礼物页生成带参数链接)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/overtime`        | [overlays/overtime.html](../../../public/pages/overlays/overtime.html)                                             | OBS 浏览器源、管理页预览 `<iframe>`                          | 加班机叠加层,支持 `?quality=low`(降帧/降动画)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/gift-effects`    | [overlays/gift-effects.html](../../../public/pages/overlays/gift-effects.html)                                     | OBS 浏览器源、管理页预览                                     | 礼物特效与四方边框叠加层,平时保持透明并在匹配礼物到达时播放                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/lyrics`          | [overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)                                     | OBS 浏览器源、独立浏览器窗口                                 | 桌面歌词完整时间轴;地址由管理页「复制桌面歌词」提供                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/danmaku`         | [overlays/danmaku.html](../../../public/pages/overlays/danmaku.html)                                               | OBS/直播姬浏览器源、管理页预览 `<iframe>`                    | 固定弹幕姬地址；固定区域样式按顺序显示普通文字、身份信息和 B 站表情，其中透明简约样式不绘制卡片底色或身份装饰，仅在昵称和正文下方显示粉丝牌等级；全屏随机样式只显示发送者与正文并在全画布随机定位，按 `danmakuFullscreenDurationSeconds` 自动消失；身份横卡使用右侧头像、四档身份底色和 384×640 等比缩放设计画布，`?preview=1&style=…` 只用于 Admin 的确定性样本预览                                                                                                                                                                                                                                     |
| `/games`           | [overlays/games.html](../../../public/pages/overlays/games.html)                                                   | OBS 浏览器源、独立浏览器窗口                                 | 直播小游戏浏览器源；管理页先打开固定地址再开始游戏，页面按当前会话自动显示数字炸弹、五子棋或你画我猜；画猜页面使用收窄并居中的 16:9 画布，由主播通过画笔、橡皮擦、直线、矩形、圆形和画布取色器作画，并显示弹幕抢答/总积分；图形仍编码为既有 append 笔画同步，不新增 WebSocket 消息形状。弹幕画廊按消息视觉长度动态调整气泡宽度与高度，展示头像、昵称、消息、大航海与当前房间灯牌，头像统一经带 token 的 `/api/bilibili/avatar` 本地代理加载并补全；题词只在 Admin 私有主持区显示；旧 `?game=` 地址仍可访问但参数不再决定游戏 |
| `/wheel`           | [overlays/wheel.html](../../../public/pages/overlays/wheel.html)                                                   | OBS 浏览器源、独立浏览器窗口                                 | 独立转盘浏览器源；圆形外透明，按主播配置的内容份数绘制多色扇形，抽取时旋转并突出最终结果；不参与 `/games` 会话互斥                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/opening`         | [overlays/opening.html](../../../public/pages/overlays/opening.html)                                               | OBS 浏览器源、管理页预览                                     | 固定开播画面地址,读取已保存的文案、动画、画质与音乐设置                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/clock`           | [overlays/clock.html](../../../public/pages/overlays/clock.html)                                                   | OBS/直播姬浏览器源、管理页预览 `<iframe>`                    | 固定萌时钟地址；默认读取已保存设置，兼容 `style=peach                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | starlight | soda | timeline-horizontal | timeline-vertical`、`date=0 | 1`、`seconds=0 | 1`、`format=12 | 24`、`label=` 逐字段覆盖 |

排查页面(无 URL 映射,只能按文件路径访问):

| 路径                     | 页面                                                     | 打开者          | 说明                                                       |
| ------------------------ | -------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `/pages/gift-audit.html` | [gift-audit.html](../../../public/pages/gift-audit.html) | 开发者/主播排查 | 礼物气泡 × WebSocket 交叉对比审计,详见 [app.md](app.md) §9 |

## 3. 页面清单(每个页面一行)

| 页面           | 文件                                                                                                          | 类型                                     | 内容                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理后台       | [pages/admin/](../../../public/pages/admin/) 分片 + [server/admin-page.js](../../../src/server/admin-page.js) | Classic + ES Module                      | 点歌/播放/礼物/百宝箱四主页面 + 状态条(WS/直播/歌库计数)+ 窗口控件;导入导出页包含云端歌单同步(覆盖前确认 + 云端数量对比 + 本机上次同步记录)与授权后的歌单页背景管理面板 |
| 礼物审计       | [pages/gift-audit.html](../../../public/pages/gift-audit.html)                                                | 内联脚本                                 | 气泡流 vs WS 流交叉对比、事件重放、手动投递                                                                                                                             |
| 队列叠加层     | [pages/overlays/queue.html](../../../public/pages/overlays/queue.html)                                        | Classic(`js/overlays/queue.js`)          | 点歌队列滚动展示,classic/identity 两种风格                                                                                                                              |
| 歌单叠加层     | [pages/overlays/songs.html](../../../public/pages/overlays/songs.html)                                        | ES Module(`js/overlays/songs.js`)        | 可点歌单展示,虚拟滚动 + 按时长/字母分组                                                                                                                                 |
| 盲盒叠加层     | [pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)                                  | Classic(`js/overlays/blindbox.js`)       | 盲盒盈亏汇总 + 排行榜 + 冲刺模式                                                                                                                                        |
| 加班机叠加层   | [pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html)                                  | Classic(`js/overlays/overtime.js`)       | 直播加班倒计时 + 送礼加班表 + 结算动画                                                                                                                                  |
| 礼物特效叠加层 | [pages/overlays/gift-effects.html](../../../public/pages/overlays/gift-effects.html)                          | ES Module(`js/overlays/gift-effects.js`) | 匹配礼物的四方边框、礼物信息和一次性装饰动画；边框 DOM/WAAPI 时间线由 `gift-effects-frame.js` 独立持有                                                                  |
| 桌面歌词页     | [pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)                          | ES Module(`js/overlays/lyric-window.js`) | 复用管理页实时预览的完整时间轴、当前行高亮、逐字进度、翻译/罗马音与自动跟随                                                                                             |
| 弹幕姬叠加层   | [pages/overlays/danmaku.html](../../../public/pages/overlays/danmaku.html)                                    | ES Module(`js/overlays/danmaku.js`)      | `/danmaku` 多样式页面；快照恢复并实时同步 `danmakuOverlayStyle` 与 `danmakuFullscreenDurationSeconds`，固定区域通过 `danmaku:message` 顺序追加消息，全屏随机在边界内定位并按停留时间移除，复用 `danmaku-feed.js` 安全渲染 B 站表情                         |
| 游戏叠加层     | [pages/overlays/games.html](../../../public/pages/overlays/games.html)                                        | ES Module(`js/overlays/games.js`)        | 数字炸弹/五子棋/你画我猜共享会话；你画我猜使用紧凑画布、六种绘画工具，并通过 `danmaku-feed.js` 渲染动态宽高弹幕气泡                                                     |
| 转盘叠加层     | [pages/overlays/wheel.html](../../../public/pages/overlays/wheel.html)                                        | ES Module(`js/overlays/wheel.js`)        | 独立抽奖转盘,按主播配置的选项绘制并突出抽取结果                                                                                                                         |
| 开播画面叠加层 | [pages/overlays/opening.html](../../../public/pages/overlays/opening.html)                                    | ES Module(`js/overlays/opening.js`)      | 固定地址读取已保存的开场文案、动画、画质和音乐设置                                                                                                                      |
| 萌时钟叠加层   | [pages/overlays/clock.html](../../../public/pages/overlays/clock.html)                                        | ES Module(`js/overlays/clock.js`)        | 当前本地时间、日期与星期；固定 URL 读取已保存的三套装饰卡片或横/竖透明时间轴设置，并按样式画布缩放                                                                      |

## 4. JS 模块地图

### 4.1 管理后台 `public/js/admin/`(全部为 Classic Script + 少数 ES Module 混用)

| 文件                                                                 | 职责                                                                                                                                                                                                        | 文档                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `index.js`                                                           | 模块加载入口(import 全部 admin 模块,顺序见 [app.md](app.md) §3)                                                                                                                                             | [app.md](app.md)                          |
| `contextual-help.js`                                                 | 注册 `<lira-help>` 问号说明组件；说明使用顶层 Popover，支持悬浮、键盘和点击。仅承载可选解释，不得隐藏状态、校验、警告或必读操作说明                                                                         | 本文 §5                                   |
| `app.js`                                                             | 应用启动:导航初始化、播放助手桥接、WebSocket 连接                                                                                                                                                           | [app.md](app.md) §3                       |
| `state.js`                                                           | `StateService` 单例:状态快照 + WS 客户端 + `/api/state`/`/api/songs` 加载                                                                                                                                   | [comms.md](comms.md)、[app.md](app.md) §2 |
| `queue.js`                                                           | 点歌队列 / SC 队列渲染与操作                                                                                                                                                                                | [app.md](app.md) §4                       |
| `songs.js`                                                           | 歌库表格、筛选(分类/语言/歌手/标签)、编辑/入队/删除                                                                                                                                                         | [app.md](app.md) §4                       |
| `settings.js`                                                        | 设置表单、Bilibili 登录、清库、盲盒映射、退出/刷新直播；账号中心只读展示当前登录账户、本机设备和凭据保存说明，设备授权由服务器管理员管理                                                                  | [app.md](app.md) §4                       |
| `theme.js`                                                           | 点歌板主题(经典/身份/奶油画框样式、预设卡片、一键美化)                                                                                                                                                      | [app.md](app.md) §4                       |
| `display.js`                                                         | 展示板(歌单板)配置与主题                                                                                                                                                                                    | [app.md](app.md) §4                       |
| `forms.js`                                                           | `FormsService`:range↔number 绑定、选项卡、播放器全屏/收起、表单填充                                                                                                                                         | [app.md](app.md) §2                       |
| `import.js`                                                          | 歌曲批量导入(TSV/CSV/Excel),GB18030 编码回退;授权后的云端歌单同步(`showConfirmationDialog` 覆盖确认、云端数量对比、`localStorage['lira:license:lastCloudSync']` 记录本机上次同步)与歌单页背景查询/上传/删除 | [app.md](app.md) §4                       |
| `metrics.js`                                                         | 系统性能检测(`/api/system/metrics` 5 秒采样)                                                                                                                                                                | [app.md](app.md) §4                       |
| `danmaku-tool.js`                                                    | 弹幕工具:连接状态刷新、固定 `/danmaku` 地址复制/打开、iframe 预览、Admin 内发送弹幕、点歌/固定回复开关；发送功能不另设网页地址                                                                              | [app.md](app.md) §6                       |
| `danmaku-libraries.js`                                               | 签到祝福语/抽签词库/DIY 关键词回复三个编辑器                                                                                                                                                                | [app.md](app.md) §6                       |
| `ai-assistant-settings.js`                                           | AI 互动助手配置:模型拉取、供应商测试、限流参数                                                                                                                                                              | [app.md](app.md) §6                       |
| `overtime.js`                                                        | 加班机控制台:开关/初始时间/礼物规则(固定+时间盲盒)/背景                                                                                                                                                     | [app.md](app.md) §6                       |
| `todo.js`                                                            | 主播工作台:localStorage 场次信息、开场/互动/收尾提词与直播速记                                                                                                                                              | [app.md](app.md) §6                       |
| `other.js`                                                           | 百宝箱侧边导航(功能面板切换,不承载业务)                                                                                                                                                                     | [app.md](app.md) §6                       |
| `desktop-lyric.js`                                                   | 桌面歌词设置表单(自动保存)                                                                                                                                                                                  | [app.md](app.md) §6                       |
| `desktop-lyric-preview.js`                                           | 桌面歌词实时预览(完整时间轴 + 连续/离散逐字高亮 + 弹簧跟随动画)                                                                                                                                             | [app.md](app.md) §6                       |
| `start-animation.js`                                                 | 开播动画编辑、轨道动效选择、固定 Browser Source 地址、人物图/音乐上传与清除、音量控制                                                                                                                       | [app.md](app.md) §6                       |
| `clock-card.js`                                                      | 萌时钟固定地址、持久化设置、五套风格选择与横竖 iframe 实时预览                                                                                                                                              | [app.md](app.md) §6                       |
| `song-category-filter.js`                                            | 分类/标签筛选工具(拆分、选中态读取)                                                                                                                                                                         | [app.md](app.md) §4                       |
| `gifts/index.js`                                                     | 礼物面板统一渲染入口                                                                                                                                                                                        | [app.md](app.md) §5                       |
| `gifts/notification.js` / `detection.js` / `sprint.js` / `recent.js` | 礼物通知 / 检测状态 / 月底冲刺 / 最近礼物                                                                                                                                                                   | [app.md](app.md) §5                       |
| `gifts/blindbox.js` / `blindbox-analysis.js` / `history.js`          | 盲盒映射与统计 / 盲盒分析工作区 / 礼物历史抽屉                                                                                                                                                              | [app.md](app.md) §5                       |

### 4.2 播放助手 `public/js/playback/`(纯 ES Module)

入口链 `js/playback.js`(兼容层)→ `playback/index.js` → `playback/controller.js`(编排层)。模块树:`core/`(initializer/renderer/event-handlers)、`state/`(manager/storage)、`provider/`(manager)、`player/`(controller)、`queue/`(manager)、`services/`(search/stream/lyric/match/import/home/wesing)、`features/`(search/match/stream/queue-operations/playback-controls/lyric-controls/radio-mode/home/import/pending)、`operations/`(provider/state-persistence/playlist/cache)、`ui/`(index/components/playback-bar/queue-popup/drawer/fullscreen)、`content/`(loader)、`local/`(manager)、`cache/`(manager)、`config.js`、`utils.js`。逐模块说明见 [playback.md](playback.md)。

### 4.3 叠加层 `public/js/overlays/`

| 文件                                                                        | 说明                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overlay-utils.js`                                                          | 共享工具(转义/颜色/字体回退/滚动时长换算/低功耗判定),挂 `window.OverlayUtils`                                                                                          |
| `song-virtual-scroller.js`                                                  | 歌单虚拟滚动器(环形 DOM 窗口)                                                                                                                                          |
| `queue.js` / `songs.js` / `blindbox.js` / `overtime.js` / `lyric-window.js` | 各叠加层逻辑,详见 [overlays.md](overlays.md)                                                                                                                           |
| `games.js`                                                                  | 直播小游戏入口与会话渲染；你画我猜在本地预览图形后把直线/矩形/圆形拆为归一化坐标点，取色器只吸附到现有安全色板；通过 `danmaku-feed.js` 的显式 ESM 接口消费你画我猜弹幕 |
| `opening.js`                                                                | 开播动画 Browser Source：读取本地配置与用户上传人物图/音乐，未上传时无人物图且不播放音乐，并驱动人物待机与心形/灯带/流光轨道动画                                          |
| `clock.js`                                                                  | 萌时钟 Browser Source：读取已保存配置并兼容 URL 参数覆盖，按本地秒边界更新时间/日期、切换横竖设计画布并在页面隐藏时暂停调度                                            |
| `danmaku-feed.js`                                                           | 可复用弹幕气泡组件：安全构建身份/消息 DOM，并根据文本视觉长度写入气泡宽高 CSS 变量                                                                                     |

### 4.4 共享与入口 `public/js/`

| 文件                            | 说明                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `shared/utils.js`               | 全局工具 + 兼容层 `window.AdminApp.utils`(见 [comms.md](comms.md) §2)                |
| `shared/event-bus.js`           | `EventBus` 单例 + `Events` 常量(见 [app.md](app.md) §2)                              |
| `shared/logger.js`              | `Logger` 单例(挂 `window.AdminApp.logger`)                                           |
| `shared/theme.js`               | 主题配置加载(`/data/theme-presets.json`)与预设访问器                                 |
| `shared/lyric-word-renderer.js` | 逐字歌词渲染器(rAF 驱动,WeSing 面板/桌面歌词预览/歌词窗口共用)                       |
| `shared/parameter-range.js`     | Admin 参数滑块进度与零点区段同步；扫描显式 `parameter-range` 控件并维护轨道 CSS 变量 |
| `desktop.js`                    | 桌面外壳:更新检查/下载/安装、打开数据目录、`window.songAssistantDesktop` 检测        |
| `playback.js`                   | 播放助手兼容入口(`import './playback/index.js'`)                                     |

## 5. CSS 清单

| 文件                                 | 职责                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `css/styles-base.css`                | 设计系统:CSS 变量、重置、按钮/表单基类、spacing/radius/shadow 令牌                                                                                                                    |
| `css/styles-admin.css`               | 管理后台顶层样式(引用 admin/ 子目录)                                                                                                                                                  |
| `css/styles-playback.css`            | 播放助手顶层样式(引用 playback/ 子目录)                                                                                                                                               |
| `css/components/parameter-range.css` | 可复用参数滑块：`parameter-range` 为克制的天蓝默认款，按语义追加 `--tempo`（圆角方块）/`--scale`（圆环）/`--intensity`（短胶囊）/`--centered`（纵向椭圆）修饰类；不接管播放 seek/音量 |
| `css/components/contextual-help.css` | Admin `<lira-help>` 的统一问号与顶层说明样式；只允许按视口空间切换上下位置，不提供页面级视觉变体                                                                                      |
| `css/admin/*.css`                    | 管理后台分模块:workspace/layout/tabs/toasts/modals/collapsible/gifts/blindbox-analysis/overtime/other-features/song-filters/desktop-lyric-preview/responsive                          |
| `css/playback/*.css`                 | 播放助手分模块:player/layout/panels/header/drawer/fullscreen/dialogs/queue-modal/song-row/desktop-lyric/responsive                                                                    |
| `css/overlays/base.css`              | 叠加层框架(classic/identity 队列主题、滚动动画、歌单板)                                                                                                                               |
| `css/overlays/blindbox.css`          | 盲盒叠加层动画与布局                                                                                                                                                                  |
| `css/overlays/overtime.css`          | 加班机叠加层(cq 单位 + 容器查询,见 [overlays.md](overlays.md) §4)                                                                                                                     |
| `css/overlays/clock.css`             | 萌时钟三套代码原生装饰卡片、横/竖透明时间轴与 reduced-motion 降级                                                                                                                     |
| `css/overlays/desktop.css`           | 桌面外壳主题(`html.desktop-shell`,标题栏拖拽区/窗口控件)                                                                                                                              |

## 6. 静态资源

| 资源                                                                                                                                                         | 说明                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `img/overtime-machine/`                                                                                                                                      | 加班机内置背景:`midnight-grid.svg`、`gift-placeholder.svg`(占位图),选型见 ADR [0005-built-in-overtime-backgrounds](../adr/0005-built-in-overtime-backgrounds.md)                                                                                      |
| `img/admin/gifts/bilibili-guard-*.png`                                                                                                                       | 大航海(总督/提督/舰长)图标,加班机内置三档守护礼物                                                                                                                                                                                                     |
| `img/playback/qqmusic-icon.png` / `img/playback/player-turntable-chassis.png` / `img/admin/gifts/gift-section-icon.png` / `img/shared/live-refresh-icon.png` | 播放器/礼物面板图标                                                                                                                                                                                                                                   |
| `data/theme-presets.json`                                                                                                                                    | 点歌板/歌单板主题预设，字段 schema 见 §6.1                                                                                                                                                                                                            |
| `data/overtime-gift-catalog.json` / `data/overtime-gift-images/` / `data/overtime-gift-assets-state.json`                                                     | 运行时用户数据，不属于 `public/` 静态资源；分别保存服务器付费礼物元数据、首次授权后按精确 ID 准备的图片缓存和版本化扫描完成状态，不进入源码或安装包                           |
| 字体                                                                                                                                                         | **无内置字体文件**(无 `@font-face`):全部走系统字体栈(Bahnschrift SemiCondensed 用于加班机数字,Bahnschrift 用于 LIVE 标签,Microsoft YaHei/PingFang SC 中文字体栈),见 [utils.js:5](../../../public/js/shared/utils.js#L5) 的 `multilingualFontFallback` |

礼物主目录由当前配置直播间的 Bilibili 礼物面板、`giftConfig` 和已配置的在售盲盒展开产生。LIRA Server 全局礼物目录不增加主目录成员；首次授权后，本地运行时保存其金瓜子正价子集并按精确礼物 ID 准备全部图片，供全局本地搜索、盲盒、历史高价值礼物和已保存规则复用。同名不同 ID 保持各自映射。服务器或图片不可用时保留礼物条目并显示 `gift-placeholder.svg`。因此源码和安装包不包含 `img/bilibili-gifts.json`、`img/bilibili-gifts/` 或三份旧礼物 Markdown。

### 6.1 data/theme-presets.json 格式(唯一成文处)

由 `shared/theme.js` 的 `loadThemeConfig()` 在页面启动时加载，结果挂 `window.AdminApp.theme`。

顶层结构：

```json
{
  "version": "1.0.0",
  "default": { <默认值键值对> },
  "presets": {
    "classic":        { <presetKey>: <ThemeSnapshot>, … },
    "classicLabels":  { <presetKey>: "<展示名>" },
    "classicSwatches":{ <presetKey>: ["#bg","#primary","#accent","#text"] },
    "songBoard":        { <presetKey>: <SongBoardSnapshot>, … },
    "songBoardLabels":  { <presetKey>: "<展示名>" },
    "songBoardSwatches":{ <presetKey>: ["#bg","#primary","#accent","#text"] }
  }
}
```

`default` 中的键与 `ThemeSnapshot` 的键一致，作为未配置时的回退值。`classic` 组的预设名（如 `pure`/`cream`/`sky`/`peach`/`mint`/`sakura`/`starry`/`ocean`/`sunset`/`cyber`/`gold`/`lavender`/`emerald`/`rose`）共 14 套；`songBoard` 组共 14 套（名称可能不同）。

`ThemeSnapshot`（点歌板预设）的 37 个键：

| 分组      | 键                                                                                                                                                                   | 类型/值域       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 基色      | `themePrimary` / `themeAccent` / `themeText` / `themeBackground`                                                                                                     | `"#rrggbb"`     |
| 面板      | `themeOpacity`(`"0.00"`–`"1.00"`) / `themeRadius`(px 字符串) / `backdropBlur`(px) / `glowIntensity`(0–?)                                                             | string 数字     |
| 渐变      | `enableGradient`(`"true"`/`"false"`) / `gradientEnd`(`"#rrggbb"`) / `gradientAngle`(度)                                                                              | string          |
| 字体      | `overlayFontFamily`(CSS font-family) / `overlayFontWeight`(`"400"`–`"900"`)                                                                                          | string          |
| 颜色      | `overlaySongColor` / `overlayRequesterColor`                                                                                                                         | `"#rrggbb"`     |
| 字号      | `queueSongFontSize` / `queueTitleFontSize`                                                                                                                           | string 数字(px) |
| 滚动      | `queueScrollSpeed`(像素/秒) / `queueScrollMode`(`"0"`/`"1"`)                                                                                                         | string          |
| 排版      | `lineHeight` / `letterSpacing` / `textShadowIntensity`                                                                                                               | string 数字     |
| 阴影/边框 | `cardShadow`(`"none"`/`"medium"`/`"strong"`) / `cardShadowColor` / `shadowOpacity` / `cardBorderWidth` / `cardBorderColor` / `panelBorderWidth` / `panelBorderColor` | string          |
| 间距      | `itemSpacing` / `rowSpacing` / `panelPadding`                                                                                                                        | string 数字(px) |
| 其他      | `overlayTitle` / `overlayShowIndex`(`"true"`/`"false"`) / `overlayIndexThreshold` / `overlayIndexColor` / `queueFixedSixRows`(`"true"`/`"false"`)                    | string          |

`SongBoardSnapshot` 键与 `ThemeSnapshot` 一一对应，但全部加 `songBoard` 前缀（如 `songBoardThemePrimary`、`songBoardFontFamily`、`songBoardBackdropBlur` 等）。`classicSwatches`/`songBoardSwatches` 每项为 4 元素数组 `["#背景","#主色","#强调色","#文字色"]`，用于预设选择器的色块预览。

## 7. 礼物完整历史页面（Implemented）

礼物主页面提供名称搜索、`7d/30d/90d/all` 范围控制、整数分统计摘要/排行/趋势、复合 keyset 历史翻页，以及同步中/partial/离线/错误/空数据状态。“清理显示”只重置筛选，不删除本地账本。页面只调用当前 source 的本地 `/api/gifts/history` 与 `/api/gifts/statistics`，不接收或提交 `sourceId`、Device token、bootstrap token 或远端 cursor。新增模块使用具名 ESM import/export，不扩大 `window.AdminApp` 兼容层；详细契约见 [gift-ledger-projection-sync_design.md](../../../specs/gift-ledger-projection-sync_design.md)。
