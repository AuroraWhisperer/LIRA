# 前端页面与入口清单

> 涉及文件:[pages/admin/](../../../public/pages/admin/)、[server/admin-page.js](../../../src/server/admin-page.js)、[admin-page-composition.test.js](../../../test/admin-page-composition.test.js)、[gift-audit.html](../../../public/pages/gift-audit.html)、[debug-gifts.html](../../../public/pages/debug-gifts.html)、[overlays/](../../../public/pages/overlays/)、[js/admin/](../../../public/js/admin/)、[js/playback/](../../../public/js/playback/)、[js/overlays/](../../../public/js/overlays/)、[js/shared/](../../../public/js/shared/)、[css/](../../../public/css/)、[img/](../../../public/img/)

本文档是前端**页面清单**的唯一事实源:每个页面是什么、由谁打开、入口 URL 只在此成表。URL → HTML 的映射表(`pageMap`)本身归 [server-core.md](../backend/server-core.md) §4.3 所有,此处只列出面向使用者的入口语义。

管理后台没有单一 `public/pages/admin.html` 文件。HTML 分片位于 [pages/admin/](../../../public/pages/admin/)，由 [server/admin-page.js](../../../src/server/admin-page.js) 组合，顺序由 [admin-page-composition.test.js](../../../test/admin-page-composition.test.js) 保护。

## 1. 技术选型

| 事实 | 说明 |
|---|---|
| 语言 | 零框架 Vanilla JS(ES Modules + Classic Scripts),无构建工具、无 TypeScript |
| 样式 | 原生 CSS,按目录拆分,无预处理器 |
| 实时通道 | WebSocket 全量快照(见 [comms.md](comms.md)、[ws.md](../backend/ws.md)) |
| 命令通道 | `fetch('/api/...')`(见 [comms.md](comms.md)、[api.md](../backend/api.md)) |
| 模块形态 | ES Module 带 `.js` 后缀的相对导入;Classic Script 挂载 `window.AdminApp.*` 兼容层 |

## 2. 入口 URL(唯一成表处)

所有页面都由后端 `servePageOrAsset` 提供(`pageMap` 见 [server-core.md](../backend/server-core.md) §4.3),响应 `Cache-Control: no-store`。

| 入口 URL | 实际 HTML | 打开者 | 行为说明 |
|---|---|---|---|
| `/admin` | [pages/admin/](../../../public/pages/admin/) 分片经 [server/admin-page.js](../../../src/server/admin-page.js) 组合 | 浏览器(手动或 `AUTO_OPEN_ADMIN=1` 自动打开)、Electron 主窗口 | 管理后台:点歌/播放/礼物/百宝箱四个主页面;`#playback`/`#gifts`/`#other` hash 直达对应主页面 |
| `/admin?desktop=1` | 同上 | Electron 主窗口([desktop/main.md](../desktop/main.md)) | [shell-start.html](../../../public/pages/admin/shell-start.html) 在 CSS 加载前写入 `html.desktop-shell` 主题类(防粉色闪烁),显示标题栏拖拽区与窗口控制按钮;退出后展示桌面版重启屏 |
| `/settings` | 同上 | 浏览器(旧书签/外部链接) | 历史兼容入口,落到管理后台默认页(点歌) |
| `/songs` | 同上 | 浏览器 | 同上,兼容入口 |
| `/queue` | [overlays/queue.html](../../../public/pages/overlays/queue.html) | OBS 浏览器源、独立浏览器窗口 | 点歌队列叠加层,透明背景 |
| `/songlist` | [overlays/songs.html](../../../public/pages/overlays/songs.html) | OBS 浏览器源 | 歌单展示板叠加层,支持 `?category=` 过滤 |
| `/blindbox` | [overlays/blindbox.html](../../../public/pages/overlays/blindbox.html) | OBS 浏览器源 | 盲盒盈亏投屏,支持 `?top=/winners=/heartBox=/title=` 等参数(管理页「直播画面」生成链接) |
| `/overtime` | [overlays/overtime.html](../../../public/pages/overlays/overtime.html) | OBS 浏览器源、管理页预览 `<iframe>` | 加班机叠加层,支持 `?quality=low`(降帧/降动画) |
| `/lyrics` | [overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html) | OBS 浏览器源、独立浏览器窗口 | 桌面歌词完整时间轴;地址由管理页「复制桌面歌词」提供 |
| `/danmaku` | [overlays/danmaku.html](../../../public/pages/overlays/danmaku.html) | OBS/直播姬浏览器源、管理页预览 `<iframe>` | 固定弹幕姬地址；按设置自由切换聊天气泡/直播信号带/极简字幕并实时显示普通文字和 B 站表情，`?preview=1&style=…` 只用于 Admin 的确定性样本预览 |
| `/games` | [overlays/games.html](../../../public/pages/overlays/games.html) | OBS 浏览器源、独立浏览器窗口 | 直播小游戏浏览器源；管理页先打开固定地址再开始游戏，页面按当前会话自动显示数字炸弹、五子棋或你画我猜；画猜页面由主播直接作画并显示弹幕抢答/总积分，弹幕画廊按消息视觉长度动态调整气泡宽度与高度，展示头像、昵称、消息、大航海与当前房间灯牌，头像统一经带 token 的 `/api/bilibili/avatar` 本地代理加载并补全；题词只在 Admin 私有主持区显示；旧 `?game=` 地址仍可访问但参数不再决定游戏 |
| `/wheel` | [overlays/wheel.html](../../../public/pages/overlays/wheel.html) | OBS 浏览器源、独立浏览器窗口 | 独立转盘浏览器源；圆形外透明，按主播配置的内容份数绘制多色扇形，抽取时旋转并突出最终结果；不参与 `/games` 会话互斥 |

调试页面(无 URL 映射,只能按文件路径访问):

| 路径 | 页面 | 打开者 | 说明 |
|---|---|---|---|
| `/pages/gift-audit.html` | [gift-audit.html](../../../public/pages/gift-audit.html) | 开发者/主播排查 | 礼物气泡 × WebSocket 交叉对比审计,详见 [app.md](app.md) §9 |
| `/pages/debug-gifts.html` | [debug-gifts.html](../../../public/pages/debug-gifts.html) | 开发者 | 礼物消息诊断(连接状态/解析统计/原始报文缓冲),详见 [app.md](app.md) §9 |

## 3. 页面清单(每个页面一行)

| 页面 | 文件 | 类型 | 内容 |
|---|---|---|---|
| 管理后台 | [pages/admin/](../../../public/pages/admin/) 分片 + [server/admin-page.js](../../../src/server/admin-page.js) | Classic + ES Module | 点歌/播放/礼物/百宝箱四主页面 + 状态条(WS/直播/歌库计数)+ 窗口控件 |
| 礼物审计 | [pages/gift-audit.html](../../../public/pages/gift-audit.html) | 内联脚本 | 气泡流 vs WS 流交叉对比、事件重放、手动投递 |
| 礼物调试 | [pages/debug-gifts.html](../../../public/pages/debug-gifts.html) | 内联脚本 | 礼物解析诊断(统计卡片、cmd 分解、messageBuffer 回放) |
| 队列叠加层 | [pages/overlays/queue.html](../../../public/pages/overlays/queue.html) | Classic(`js/overlays/queue.js`) | 点歌队列滚动展示,classic/identity 两种风格 |
| 歌单叠加层 | [pages/overlays/songs.html](../../../public/pages/overlays/songs.html) | ES Module(`js/overlays/songs.js`) | 可点歌单展示,虚拟滚动 + 按时长/字母分组 |
| 盲盒叠加层 | [pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html) | Classic(`js/overlays/blindbox.js`) | 盲盒盈亏汇总 + 排行榜 + 冲刺模式 |
| 加班机叠加层 | [pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html) | Classic(`js/overlays/overtime.js`) | 直播加班倒计时 + 送礼加班表 + 结算动画 |
| 桌面歌词页 | [pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html) | ES Module(`js/overlays/lyric-window.js`) | 复用管理页实时预览的完整时间轴、当前行高亮、逐字进度、翻译/罗马音与自动跟随 |
| 弹幕姬叠加层 | [pages/overlays/danmaku.html](../../../public/pages/overlays/danmaku.html) | ES Module(`js/overlays/danmaku.js`) | 固定 `/danmaku` 多样式页面；快照恢复并实时同步 `danmakuOverlayStyle`，通过 `danmaku:message` 追加消息，复用 `danmaku-feed.js` 安全渲染 B 站表情 |
| 游戏叠加层 | [pages/overlays/games.html](../../../public/pages/overlays/games.html) | ES Module(`js/overlays/games.js`) | 数字炸弹/五子棋/你画我猜共享会话；你画我猜使用 `danmaku-feed.js` 渲染动态宽高弹幕气泡 |

## 4. JS 模块地图

### 4.1 管理后台 `public/js/admin/`(全部为 Classic Script + 少数 ES Module 混用)

| 文件 | 职责 | 文档 |
|---|---|---|
| `index.js` | 模块加载入口(import 全部 admin 模块,顺序见 [app.md](app.md) §3) | [app.md](app.md) |
| `app.js` | 应用启动:导航初始化、播放助手桥接、WebSocket 连接 | [app.md](app.md) §3 |
| `state.js` | `StateService` 单例:状态快照 + WS 客户端 + `/api/state`/`/api/songs` 加载 | [comms.md](comms.md)、[app.md](app.md) §2 |
| `queue.js` | 点歌队列 / SC 队列渲染与操作 | [app.md](app.md) §4 |
| `songs.js` | 歌库表格、筛选(分类/语言/歌手/标签)、编辑/入队/删除 | [app.md](app.md) §4 |
| `settings.js` | 设置表单、Bilibili 登录、清库、盲盒映射、退出/刷新直播 | [app.md](app.md) §4 |
| `theme.js` | 点歌板主题(经典/身份/奶油画框样式、预设卡片、一键美化) | [app.md](app.md) §4 |
| `display.js` | 展示板(歌单板)配置与主题 | [app.md](app.md) §4 |
| `forms.js` | `FormsService`:range↔number 绑定、选项卡、播放器全屏/收起、表单填充 | [app.md](app.md) §2 |
| `import.js` | 歌曲批量导入(TSV/CSV/Excel),GB18030 编码回退 | [app.md](app.md) §4 |
| `metrics.js` | 系统性能检测(`/api/system/metrics` 5 秒采样) | [app.md](app.md) §4 |
| `danmaku-tool.js` | 弹幕工具:连接状态刷新、固定 `/danmaku` 地址复制/打开、iframe 预览、Admin 内发送弹幕、点歌/固定回复开关；发送功能不另设网页地址 | [app.md](app.md) §6 |
| `danmaku-libraries.js` | 签到祝福语/抽签词库/DIY 关键词回复三个编辑器 | [app.md](app.md) §6 |
| `ai-assistant-settings.js` | AI 互动助手配置:模型拉取、供应商测试、限流参数 | [app.md](app.md) §6 |
| `overtime.js` | 加班机控制台:开关/初始时间/礼物规则(固定+时间盲盒)/背景 | [app.md](app.md) §6 |
| `todo.js` | 主播工作台:localStorage 场次信息、三阶段直播清单与现场备忘 | [app.md](app.md) §6 |
| `other.js` | 百宝箱侧边导航(功能面板切换,不承载业务) | [app.md](app.md) §6 |
| `desktop-lyric.js` | 桌面歌词设置表单(自动保存) | [app.md](app.md) §6 |
| `desktop-lyric-preview.js` | 桌面歌词实时预览(完整时间轴 + 连续/离散逐字高亮 + 弹簧跟随动画) | [app.md](app.md) §6 |
| `start-animation.js` | 开播动画编辑、轨道动效选择、固定 Browser Source 地址、音乐上传与音量控制 | [app.md](app.md) §6 |
| `song-category-filter.js` | 分类/标签筛选工具(拆分、选中态读取) | [app.md](app.md) §4 |
| `gifts/index.js` | 礼物面板统一渲染入口 | [app.md](app.md) §5 |
| `gifts/notification.js` / `detection.js` / `sprint.js` / `recent.js` | 礼物通知 / 检测状态 / 月底冲刺 / 最近礼物 | [app.md](app.md) §5 |
| `gifts/blindbox.js` / `blindbox-analysis.js` / `history.js` | 盲盒映射与统计 / 盲盒分析工作区 / 礼物历史抽屉 | [app.md](app.md) §5 |

### 4.2 播放助手 `public/js/playback/`(纯 ES Module)

入口链 `js/playback.js`(兼容层)→ `playback/index.js` → `playback/controller.js`(编排层)。模块树:`core/`(initializer/renderer/event-handlers)、`state/`(manager/storage)、`provider/`(manager)、`player/`(controller)、`queue/`(manager)、`services/`(search/stream/lyric/match/import/home/wesing)、`features/`(search/match/stream/queue-operations/playback-controls/lyric-controls/radio-mode/home/import/pending)、`operations/`(provider/state-persistence/playlist/cache)、`ui/`(index/components/playback-bar/queue-popup/drawer/fullscreen)、`content/`(loader)、`local/`(manager)、`cache/`(manager)、`config.js`、`utils.js`。逐模块说明见 [playback.md](playback.md)。

### 4.3 叠加层 `public/js/overlays/`

| 文件 | 说明 |
|---|---|
| `overlay-utils.js` | 共享工具(转义/颜色/字体回退/滚动时长换算/低功耗判定),挂 `window.OverlayUtils` |
| `song-virtual-scroller.js` | 歌单虚拟滚动器(环形 DOM 窗口) |
| `queue.js` / `songs.js` / `blindbox.js` / `overtime.js` / `lyric-window.js` | 各叠加层逻辑,详见 [overlays.md](overlays.md) |
| `games.js` | 直播小游戏入口与会话渲染；通过 `danmaku-feed.js` 的显式 ESM 接口消费你画我猜弹幕 |
| `opening.js` | 开播动画 Browser Source：读取本地配置、播放内置/上传音乐，并驱动人物待机与心形/灯带/流光轨道动画 |
| `danmaku-feed.js` | 可复用弹幕气泡组件：安全构建身份/消息 DOM，并根据文本视觉长度写入气泡宽高 CSS 变量 |

### 4.4 共享与入口 `public/js/`

| 文件 | 说明 |
|---|---|
| `shared/utils.js` | 全局工具 + 兼容层 `window.AdminApp.utils`(见 [comms.md](comms.md) §2) |
| `shared/event-bus.js` | `EventBus` 单例 + `Events` 常量(见 [app.md](app.md) §2) |
| `shared/logger.js` | `Logger` 单例(挂 `window.AdminApp.logger`) |
| `shared/theme.js` | 主题配置加载(`/data/theme-presets.json`)与预设访问器 |
| `shared/lyric-word-renderer.js` | 逐字歌词渲染器(rAF 驱动,WeSing 面板/桌面歌词预览/歌词窗口共用) |
| `shared/parameter-range.js` | Admin 参数滑块进度与零点区段同步；扫描显式 `parameter-range` 控件并维护轨道 CSS 变量 |
| `desktop.js` | 桌面外壳:更新检查/下载/安装、打开数据目录、`window.songAssistantDesktop` 检测 |
| `playback.js` | 播放助手兼容入口(`import './playback/index.js'`) |

## 5. CSS 清单

| 文件 | 职责 |
|---|---|
| `css/styles-base.css` | 设计系统:CSS 变量、重置、按钮/表单基类、spacing/radius/shadow 令牌 |
| `css/styles-admin.css` | 管理后台顶层样式(引用 admin/ 子目录) |
| `css/styles-playback.css` | 播放助手顶层样式(引用 playback/ 子目录) |
| `css/components/parameter-range.css` | 可复用参数滑块：`parameter-range` 为克制的天蓝默认款，按语义追加 `--tempo`（圆角方块）/`--scale`（圆环）/`--intensity`（短胶囊）/`--centered`（纵向椭圆）修饰类；不接管播放 seek/音量 |
| `css/admin/*.css` | 管理后台分模块:workspace/layout/tabs/toasts/modals/collapsible/gifts/blindbox-analysis/overtime/other-features/song-filters/desktop-lyric-preview/responsive |
| `css/playback/*.css` | 播放助手分模块:player/layout/panels/header/drawer/fullscreen/dialogs/queue-modal/song-row/desktop-lyric/responsive |
| `css/overlays/base.css` | 叠加层框架(classic/identity 队列主题、滚动动画、歌单板) |
| `css/overlays/blindbox.css` | 盲盒叠加层动画与布局 |
| `css/overlays/overtime.css` | 加班机叠加层(cq 单位 + 容器查询,见 [overlays.md](overlays.md) §4) |
| `css/overlays/desktop.css` | 桌面外壳主题(`html.desktop-shell`,标题栏拖拽区/窗口控件) |

## 6. 静态资源

| 资源 | 说明 |
|---|---|
| `img/bilibili-gifts.json` | 礼物目录，字段 schema 见 §6.1 |
| `img/bilibili-gifts/` | 礼物图标(按价格区间分目录:`0000-under-0100/` ~ `3000-above/`、`blind-box/`、`special/`),映射说明见 `gift-mapping.md` |
| `img/overtime-machine/` | 加班机内置背景:`midnight-grid.svg`、`gift-placeholder.svg`(占位图),选型见 ADR [0005-built-in-overtime-backgrounds](../adr/0005-built-in-overtime-backgrounds.md) |
| `img/admin/gifts/bilibili-guard-*.png` | 大航海(总督/提督/舰长)图标,加班机内置三档守护礼物 |
| `img/playback/qqmusic-icon.png` / `img/playback/player-turntable-chassis.png` / `img/admin/gifts/gift-section-icon.png` / `img/shared/live-refresh-icon.png` | 播放器/礼物面板图标 |
| `data/theme-presets.json` | 点歌板/歌单板主题预设，字段 schema 见 §6.2 |
| 字体 | **无内置字体文件**(无 `@font-face`):全部走系统字体栈(Bahnschrift SemiCondensed 用于加班机数字,Bahnschrift 用于 LIVE 标签,Microsoft YaHei/PingFang SC 中文字体栈),见 [utils.js:5](../../../public/js/shared/utils.js#L5) 的 `multilingualFontFallback` |

### 6.1 img/bilibili-gifts.json 格式(唯一成文处)

由礼物面板(`gifts/index.js`)与加班机礼物规则编辑器(`admin/overtime.js`)在启动时加载。

顶层结构：

```json
{
  "retrievedAt": "<ISO 时间戳>",
  "gifts": [ <GiftEntry>, … ]
}
```

`GiftEntry` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number | 礼物 ID，与 Bilibili 协议层的 `giftId` 对应 |
| `name` | string | 礼物名称 |
| `price` | string | 展示价格文本，如 `"90电池"` |
| `battery` | number | 电池数量（与金瓜子 ×10 对应） |
| `rmb` | number | 等值人民币（`battery / 10`） |
| `image` | string | 本地图标路径，相对于 `public/img/`，如 `"bilibili-gifts/blind-box/35800.webp"` |
| `sourceUrl` | string | 图标来源 CDN URL（用于更新图标） |
| `category` | string | 分类标签：`blind-box`（盲盒）/ `guard`（大航海）/ `special`（特殊）/ 其他值为普通礼物 |

消费方逻辑：加班机礼物规则选择器按 `id` 匹配规则的 `giftId`，并展示 `image`；最近礼物卡片按 `id` 匹配收到的 `gift_id`，为单价至少 1000 元的普通礼物展示 `image`；礼物面板展示 `name`/`rmb`；`category` 用于在 UI 中做分组展示。

### 6.2 data/theme-presets.json 格式(唯一成文处)

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

| 分组 | 键 | 类型/值域 |
|---|---|---|
| 基色 | `themePrimary` / `themeAccent` / `themeText` / `themeBackground` | `"#rrggbb"` |
| 面板 | `themeOpacity`(`"0.00"`–`"1.00"`) / `themeRadius`(px 字符串) / `backdropBlur`(px) / `glowIntensity`(0–?) | string 数字 |
| 渐变 | `enableGradient`(`"true"`/`"false"`) / `gradientEnd`(`"#rrggbb"`) / `gradientAngle`(度) | string |
| 字体 | `overlayFontFamily`(CSS font-family) / `overlayFontWeight`(`"400"`–`"900"`) | string |
| 颜色 | `overlaySongColor` / `overlayRequesterColor` | `"#rrggbb"` |
| 字号 | `queueSongFontSize` / `queueTitleFontSize` | string 数字(px) |
| 滚动 | `queueScrollSpeed`(像素/秒) / `queueScrollMode`(`"0"`/`"1"`) | string |
| 排版 | `lineHeight` / `letterSpacing` / `textShadowIntensity` | string 数字 |
| 阴影/边框 | `cardShadow`(`"none"`/`"medium"`/`"strong"`) / `cardShadowColor` / `shadowOpacity` / `cardBorderWidth` / `cardBorderColor` / `panelBorderWidth` / `panelBorderColor` | string |
| 间距 | `itemSpacing` / `rowSpacing` / `panelPadding` | string 数字(px) |
| 其他 | `overlayTitle` / `overlayShowIndex`(`"true"`/`"false"`) / `overlayIndexThreshold` / `overlayIndexColor` / `queueFixedSixRows`(`"true"`/`"false"`) | string |

`SongBoardSnapshot` 键与 `ThemeSnapshot` 一一对应，但全部加 `songBoard` 前缀（如 `songBoardThemePrimary`、`songBoardFontFamily`、`songBoardBackdropBlur` 等）。`classicSwatches`/`songBoardSwatches` 每项为 4 元素数组 `["#背景","#主色","#强调色","#文字色"]`，用于预设选择器的色块预览。
