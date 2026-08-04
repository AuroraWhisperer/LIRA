# 打包与更新说明

当前版本：`3.1.0`

---

## v3.1.0 变更

- 🏗️ **礼物服务模块化拆分**：`src/bilibili/gift-service.js`（859 行）拆分为 `src/bilibili/gift/` 模块目录——`event-service.js`（事件处理）、`normalizer.js`（数据标准化）、`query-service.js`（查询操作）、`blind-box-config.js`（盲盒配置）、`blind-box-analysis.js`（盲盒分析），各模块职责单一、可独立测试。所有导入路径（`server.js`、`domain-services.js`、`gift-routes.js`、测试文件）同步更新至新入口 `src/bilibili/gift`。
- 📊 **盲盒分析独立工作区**：新增 `GET /api/gifts/blind-box-analysis` 端点，支持按观众/盲盒筛选、三种视图模式（按观众看/按盲盒看/开盒记录）、排序、分页。管理后台新增「今日盲盒分析」二级工作区（`blindbox-analysis.js` + `blindbox-analysis.css`），包含汇总统计卡片、筛选工具栏、视图切换标签、分页表格。工作区在收到礼物事件时自动刷新（500ms 防抖），打开「查看全部」按钮或点击首页盲盒汇总行即可进入。
- 🎨 **盲盒盈亏首页改为按观众汇总**：`blindBoxStatsBody` 从逐条开盒记录改为按观众汇总展示（观众/盒数/盒型种类数/总成本/开出价值/观众盈亏），每行可点击跳转至该观众的完整开盒记录。新增「查看全部」按钮直达盲盒分析工作区。
- 🎨 **盲盒投屏面板配置精简**：移除「紧凑模式」「禁止滚动」「低功耗」三个开关；新增「仅显示心动盲盒」开关（汇总和排行只统计心动盲盒）。排行人数范围从 0-50 调整为 -1 至 10（-1=全部，0=仅汇总，1-10=对应人数）。移除「预览」按钮，「打开画面」链接改为动态生成（跟随筛选条件实时更新 URL）。面板 header 文案更新（「直播画面」→「观众画面」，「盲盒盈亏版」→「盲盒盈亏榜」）。
- 🎨 **盲盒投屏叠加层自适应增强**：新增 `SUMMARY_ONLY` 模式（`top=0`），仅显示汇总卡片隐藏排行榜。新增 `heartBox` 参数支持心动盲盒筛选（通过 `boxName` 查询参数传递至 API）。移除 `compact`/`noScroll`/`quality` 旧参数。
- 🎨 **盲盒映射卡片样式独立化**：心动盲盒、幸运盲盒、小熊虫盲盒的 chip 卡片各自拥有独立的边框色、渐变背景、名称和价格样式，视觉区分更明确。
- ⚡ **StateService 礼物事件通知**：`state.js` 新增 `isGiftSnapshotReason()` 判断，礼物相关快照到达时通过 `eventBus` 发送 `GIFT_RECEIVED` 事件，盲盒分析工作区监听此事件实现精准刷新（不再依赖粗粒度的 `STATE_LOADED`）。
- 🧪 **测试大幅扩展**：新增盲盒分析视图切换/筛选/分页/排序安全校验测试、盲盒统计 boxName 过滤测试、盲盒分析工作区 DOM 结构和无障碍属性回归断言、盲盒投屏 top 模式（-1/0/3/25 边界）测试、盲盒投屏面板配置精简回归断言、盲盒映射卡片样式断言、礼物事件通知链路测试、API smoke 测试新增 `/api/gifts/blind-box-analysis` 端点。

## v3.0.14 变更

- 🐛 **护卫礼物价格修正**：`GUARD_BUY` 消息不再被解析为礼物事件（仅携带标价而非实付金额），改为等待 `USER_TOAST_MSG` 获取实际支付总价。移除硬编码护卫价格回退表 `getGuardPriceRmb`，所有护卫价格以 Bilibili API 返回的 `pay_info.price` 为准，不再使用兜底估算。
- 🐛 **护卫订单去重键精确化**：`USER_TOAST_MSG` 护卫礼物优先使用 `payflow_id` 构建 `guard-order:<payflowId>` 格式的 `platformId`，确保同一秒内不同折扣的护卫订单被正确识别为独立记录。
- 🐛 **多月护卫价格展示修正**：多月护卫（如 3 月 / 6 月舰长）的 `num` 记录购买月数，`unitPrice` 不再虚构平均月价（`totalPrice / num`），改为直接等于 `totalPrice`（整单总价）。
- 🎨 **盲盒盈亏投屏面板重构**：盲盒 URL 生成器从礼物统计页的 `<fieldset>` 迁移至独立的 `gift-blindbox-broadcast-panel` section，新增 panel header（含「直播画面」kicker 和「打开画面」直达链接）。Gift workspace grid 从 5 行扩展为 6 行以容纳新面板。
- 🎨 **盲盒投屏画面自适应布局**：盲盒 overlay 全面重写为容器查询（`container-type: inline-size`）驱动。面板固定 420px 初始宽度，首次 viewport resize 后切换为全宽自适应（`calc(100vw - 2 * var(--overlay-edge))`），自动匹配直播姬 / OBS 捕捉窗口尺寸。统计卡片改用 Grid 双列布局（图标 + 数值/标签），盈亏颜色和边框在容器查询断点下自适应调整。header 新增 `BLIND BOX LIVE` eyebrow 标签和渐变色背景。
- 🎨 **最近礼物列表行数限制**：最近礼物面板最多显示 6 行，行数根据 CSS Grid 列数动态计算。新增 `ResizeObserver` 监听面板宽度变化，窗口缩放时自动更新可见卡片数量，超出部分用 `hidden` 属性隐藏。
- ⚡ **Bilibili 桌面认证采集**：`capture-bilibili-events.js` 新增 `--bilibili-user-data` 参数，支持从 Electron 桌面版的 Bilibili 登录态读取 cookie 和 uid 进行认证弹幕采集。新增 `scripts/bilibili-capture-electron/` Electron 入口脚本。元数据记录新增 `authenticated` 和 `uid` 字段。
- 🗑️ **卸载清理增强**：NSIS 卸载脚本新增清理 `%APPDATA%\bilibili-live-song-plugin` 目录，确保卸载时同时移除桌面版用户数据残留。
- 🧪 **测试同步更新**：新增护卫礼物 GUARD_BUY 过滤、多月护卫价格、不同 payflow_id 独立记录、提督/总督等级识别、盲盒投屏面板位置、盲盒 overlay 自适应布局、最近礼物行数限制等回归测试。礼物测试辅助重构为 `withGiftService` 模式减少重复代码。

## v3.0.13 变更

- 🐛 **礼物通知批量检测修复**：通知系统从仅跟踪最新一条礼物改为跟踪全部礼物（`id → key` Map），修复了延迟到达的非首条礼物遗漏通知的问题。
- 🐛 **Combo 缓冲键精确化**：`extractComboRootKey` 不再剥离时间戳后缀，改为使用完整 `platformId` 作为缓冲键，确保不同 combo 批次独立缓冲，避免跨批次错误合并。
- 🐛 **`COMBO_SEND` 精确匹配**：`findRecentComboSendForBuffer` 从 `LIKE` 模糊匹配改为 `=` 精确匹配 `platform_id`，防止不同 combo 批次重复匹配。
- 🐛 **平台事件去重复合身份**：新增 `findGiftByPlatformIdentity()` 函数，按 `(platform_id, uid)` 或 `(platform_id, uid='' + user_name)` 精确识别同一礼物事件。同一 `platformId` 不同 `uid` 的礼物不再被错误去重，正确保留为两条独立记录。
- 🐛 **COMBO_END 防重复**：`COMBO_END` 命令在解析层和检测层全部跳过，不再被误判为有效礼物事件并插入到数据库中，解决了某些 Bilibili 协议场景下 COMBO_END 导致重复记录的问题。
- 🐛 **COMBO_SEND 无 coin_type 付费推断**：`COMBO_SEND` 未带 `coin_type` 字段时，若有有效累计金额（`comboTotalCoin` / `totalCoin` / `unitCoin`），自动推断为付费礼物，不再误判为免费/银瓜子礼物。
- 🐛 **盲盒统计按数量计数**：`getBlindBoxStats` 盲盒盈亏统计从按条数（1 条 = 1 个）改为按 `num` 字段累加计算，`summary.boxCount` 和 `perUser.boxCount` 均反映实际开盒数量。盲盒明细记录新增 `id` 和 `num` 字段。
- 🐛 **礼物 createdAt 回退**：`normalizeGiftInput` 在 `messageTimestamp` 缺失时新增 `input.createdAt` 回退，确保礼物记录时间戳不丢失。
- 🐛 **V2 修复合并已有身份**：`repairGiftV2Events` 修复前先检查是否存在相同 `(platform_id, uid)` 的已有记录，若存在则直接合并至已有记录并删除 V2 行，避免产生重复身份。
- 🗄️ **数据库 v3 迁移**：新增 schema v3 迁移——清理 `gift_events` 表中重复的 `(platform_id, uid)` 对（保留首条、合并最新数据），并创建唯一索引 `idx_gift_events_platform_uid`，从数据库层面杜绝同一用户同一平台事件的重复插入。
- 🧪 **测试大幅扩展**：新增 11 个测试用例——礼物通知延迟记录检测、COMBO_SEND 无 coin_type 付费推断、COMBO_END 防重复、UID 复合去重、Combo 批次独立缓冲、银瓜子/免费礼物付费反推排除、盲盒统计数量与 ID、数据库 v3 迁移去重与唯一约束、V2 修复合并已有身份。

## v3.0.12 变更

- 🐛 **XLSX 导入命名空间兼容性修复**：新增 `createZip` / `readZipFiles` ZIP 工具函数，XLSX 解析器现在正确处理带 `x:` 命名空间前缀的工作表标签（`x:row` / `x:c` / `x:is` / `x:t` / `x:v`），修复部分 Excel 客户端导出的文件导入失败问题。
- 🧪 **测试同步更新**：新增命名空间前缀工作表解析测试。

## v3.0.11 变更

- 🎨 **最近礼物卡片布局重构**：礼物卡片从 absolute 定位图标改为 CSS Grid 双列布局（`minmax(0, 1fr) 52px`）。礼物类型图标从绝对定位改为 `position: static` + Grid 居中。卡片内容统一包裹在 `.gift-card-content` 容器中，元信息改用命名网格区域（`user` / `time` / `amount` / `result`），对齐更规整。用户名和礼物名新增溢出省略保护（`text-overflow: ellipsis`）。移除 `.gift-card.blind-box-card` 特殊布局规则，盲盒卡片与非盲盒卡片共用统一布局。
- ⚡ **Bilibili 启动重连增强**：服务启动时的弹幕长连改为 `reconnectBilibiliListener()`（async），重连失败时更新直播状态显示具体错误信息，不再静默失败。
- 🎨 **默认规则文案更新**：规则 2 默认值从「支持随机点歌」更新为「支持多tag随机点歌」，反映随机点歌已支持多标签组合筛选。
- 🧪 **测试同步更新**：新增礼物卡片命名网格区域和元数据槽位回归断言。

## v3.0.10 变更

- ⚡ **桌面歌词逐帧动画渲染**：歌词窗口从服务器推送的离散快照升级为 `requestAnimationFrame` 驱动的连续播放时钟。播放进度条改用 `transform: scaleX()` GPU 合成动画替代 `width` 过渡，字词高亮在两帧快照之间平滑插值。新增内容签名比较——歌词文本/翻译未变化时跳过 DOM 重建，仅更新逐字进度百分比，布局开销为零。歌词服务同步发布 `durationMs` 支持精确进度估算。
- ⚡ **歌词进度抗抖动**：`smoothCurrentMs()` 在播放中且新旧时间差 ≤600ms 时取二者最大值，防止服务器快照时间和本地时钟轻微差异导致的进度回跳。`prefers-reduced-motion` 时暂停 rAF 循环。
- 🎨 **桌面歌词阴影柔和化**：主歌词行文字阴影从 `0 3px 4px` / `0 8px 22px` 减弱至 `0 1px 2px` / `0 3px 8px`，翻译行和进度条光晕同步减小，视觉更轻盈不喧宾夺主。
- 🐛 **随机点歌分类别名扩展**：新增国际化分类别名——`Pop` → `流行`、`Hip-Hop` / `Rap` → `说唱`、`RNB` → `R&B`、`Folk` → `民谣`、`Dance` → `舞曲`。歌手、语言、分类字段均支持 `/` 分隔的多值拆分匹配（如 `周杰伦 / 阿信` 匹配任一歌手）。
- 🐛 **随机点歌分类匹配精确化**：分类匹配从子串包含（`includes`）改为完整别名匹配，避免输入「行」误命中「流行」等过度宽泛匹配。
- 🎨 **标签别名扩充**：新增 4 组标签别名——`国风` ← `中国风`、`小甜歌` ← `甜歌`、`影视OST` ← `OST/影视原声/原声带`、`K-Pop` ← `KPOP/K POP/韩国流行/韩流`。歌库标签别名映射表从 3 组增至 7 组。
- 🎨 **歌库筛选菜单交互优化**：分类和标签 `<details>` 下拉添加 `name="songLibraryFilter"` 实现手风琴互斥行为；点击菜单外部自动关闭筛选面板。分类选项列表排除「默认」分类。
- 🧪 **测试同步更新**：新增桌面歌词 rAF 渲染和 scaleX 进度条回归断言、播放进度抗抖动逻辑、多值字段拆分匹配测试、分类/语言别名测试、K-Pop 等新标签别名测试、筛选菜单互斥及外部点击关闭测试。

## v3.0.9 变更

- 🎨 **桌面歌词窗口紧凑化与独立缩放**：初始窗口 1000×160 → 840×128，最小尺寸 420×96 → 280×64。移除顶部播放状态/曲目名元信息栏，仅展示当前歌词行和翻译。背景毛玻璃衬底改为高度自适应（`min(78vh, 220px)`）并垂直居中。字号新增 vh 上限（`min(var(--lyric-size), 8.5vw, 34vh)`），极矮窗口（≤96px）自动隐藏翻译行和进度条，完全支持宽度和高度独立拖拽缩放。
- 🎨 **歌库筛选器多选升级**：分类和标签筛选从单选 `<select>` 改为可多选的 `<details>` 下拉面板（checkbox 列表），支持同时筛选多个分类/标签。新增「清除选择」按钮和已选摘要显示。标签筛选逻辑从 LIKE 模糊匹配改为精确 AND 匹配（多标签需全部满足），筛选准确性大幅提升。
- 🎨 **歌库表格新增语言列**：歌曲管理表格新增「语言」列，方便按语言浏览和核对歌库。歌曲分类/标签数据收集移至服务端（`listTags()`）。
- ⚡ **弹幕长连 WebSocket 心跳超时检测**：新增心跳回复追踪（`awaitingHeartbeatReply`），若下一个心跳周期内未收到服务器 op=3 回复，主动关闭连接并重连。连接错误（socket error）时立即关闭半开连接而非等待超时，避免僵死连接。
- ⚡ **弹幕断连重试策略优化**：首次 WebSocket 断开立即重试（0ms 延迟），后续重连失败恢复 5 秒延迟，减少因为临时网络波动导致的不必要等待。新增 `reconnecting` 状态标志区分首次连接和重连阶段。
- 🐛 **随机点歌空格条件支持**：空格分隔的随机点歌条件现在按 AND 逻辑拆分匹配（如「说唱 苦情」→ 同时满足说唱分类和苦情标签），同时保留带空格的完整值优先匹配（如「A1 TRIP」歌手名），无需用 + 号连接。
- 🎨 **管理后台样式微调**：队列面板 header 统一最小高度 60px；点歌队列 header 按钮最小高度 30px；风格 2 徽章字号 60% → 75% 更易阅读。
- 🧪 **测试同步更新**：新增紧凑桌面歌词窗口回归断言、心跳超时/回复保活测试、WebSocket 错误关闭测试、历史恢复用例、空格随机点歌条件测试、歌库多选筛选测试、队列 header 尺寸回归断言。

## v3.0.8 变更

- 🎨 **桌面歌词窗口全面重设计**：CSS 完全重写为自定义属性驱动（`--lyric-*`），支持逐字渐变进度高亮（`lyric-word` + `--word-progress` CSS 渐变）。新增顶部元信息栏（播放状态标签 + 曲目名）、底部进度条（粉色→金色渐变填充 + 发光）。无歌词时显示状态感知的占位文案（断开连接/加载中/无歌词/前奏中/待机），替代旧版硬编码「暂无歌词」。
- ⚡ **桌面歌词 WebSocket 实时同步**：`lyric-window.js` 新增 WebSocket 连接（含指数退避重连），通过服务器 `lyricState` 快照和增量推送接收歌词更新。`lyric-service.js` 新增 `publishBrowserState()` 将歌词状态 POST 至服务器（100ms 精度取整 + 180ms 节流去重），服务器端广播至 WebSocket 并在初始快照中包含 `lyricState`。
- 🐛 **QQ 音乐歌词 sourceSongId 自动补齐**：`qq-provider.js` 新增 `resolveSourceSongId()`——当 track 无 `sourceSongId` 时，自动搜索标题+歌手名定位匹配曲目提取 songId。修复了部分歌单曲目因缺少 songId 无法获取翻译/罗马音歌词的问题。
- 🐛 **歌词服务缓存键版本升级**：`lyrics-v2` → `lyrics-v3`，旧版（可能缺失翻译/罗马音的）不完整缓存条目自动失效，重新拉取完整歌词。
- 🎨 **叠加层队列双宽度模式**：初始渲染使用固定最小宽度（经典 `min(405px, ...)`、风格2 `min(430px, ...)`）和固定高度（235px/364px min）。首次 resize 后触发 `.queue-viewport-resized` 类，自动切换为全宽自适应（`100vw`）和高度 auto，避免初始加载时 OBS 源尺寸未确定导致的布局跳动。
- ⚡ **主题/展示板表单实时自动保存**：`theme.js` 和 `display.js` 表单新增 `input`+`change` 事件监听，任意参数变更 180ms 后自动保存。预设套用和重置按钮改为即时保存（去掉「保存后生效」提示），覆盖手动同步 `autosaveTheme()`/`autosaveDisplay()` 调用点。
- 🎨 **CSS 细节微调**：播放栏首列 190→180px。全屏播放器 z-index 34→32，队列弹窗 z-index 22→33，与歌词窗口分层正确。歌单展示板歌手名移除 `letter-spacing: -0.1em`。
- 🧹 **随机点歌过滤器模块化**：`listRandomSongCandidates` 简化（SQL 只拉全部启用歌曲），跨字段筛选逻辑和语言别名提取至独立 `random-song-filter.js` 纯模块。随机点歌错误提示文案优化。
- 🎵 **播放状态持久化 sourceSongId**：`state-persistence.js` 播放快照新增 `sourceSongId` 字段，确保刷新后歌词窗口可正确关联歌曲。
- 🧪 **测试大幅扩展**：新增主题/展示板自动保存测试（含预设保存断言和「保存后生效」移除断言）、QQ provider songId 补齐测试、歌词缓存键升级测试、播放持久化 sourceSongId 测试、桌面歌词 WebSocket 连接和 snapshot 测试、队列 viewport resize CSS 双模式断言、`/lyrics` 页面 smoke 检查。

## v3.0.7 变更

- 🎨 **叠加层队列自适应视口布局**：经典队列和风格 2 队列彻底重写为视口感知的自动布局。`render` 不再触发全量 DOM 重建——resize 事件改用轻量的 `relayoutQueue()`，仅重算滚动参数不重渲 HTML。队列高度完全基于 `innerHeight`/`getBoundingClientRect`/`--overlay-edge` 动态计算，自动填满可用视口空间。滚动动画在 render 前后捕获并恢复播放位置，消除闪烁。
- 🎨 **叠加层边距 CSS 变量化**：新增 `--overlay-edge: clamp(0px, 2vmin, 16px)` 统一控制面板外边距，经典/风格 2 面板宽度改为 `calc(100vw - (2 * var(--overlay-edge)))`，小窗口下自动收缩边距避免内容溢出。
- 🧹 **「固定 6 行」选项移除**：`queueFixedSixRows` 设置项从数据库默认值、主题持久化、管理后台 UI、叠加层状态键中全部移除。经典队列始终自适应内容高度显示，不再支持固定行数模式。
- 🎨 **队列面板恢复固定 450px 高度**：管理后台双队列行从 v3.0.6 的自适应高度回退至 `flex: 0 0 450px; height: 450px`，SC/点歌独立高度规则一并移除。队列行高微调（84px/88px），卡片高度充足。
- 🎨 **播放栏首列进一步收窄**：播放信息网格首列从 220px 缩至 190px。
- 🐛 **投屏链接统一使用 IPv4 回环地址**：新增 `localOverlayOrigin()` 工具函数始终返回 `http://127.0.0.1:<port>`。`display.js` 和 `settings.js` 的投屏链接、盲盒 URL 全部改用此函数，即使用户通过 `localhost` 访问管理后台，投屏地址也保持 `127.0.0.1`。
- ⚡ **礼物服务全链路诊断日志**：`gift-service.js` 新增 `logGiftServiceDecision()` 为每个礼物事件记录 `[Bilibili][GiftService]` 结构化日志（action + reason + trace），覆盖插入/更新/去重/缓冲/忽略全部决策点。`server.js` 新增 `logGiftDelivery()` 记录礼物广播投递（immediate / combo-flush）。
- ⚡ **礼物通知前端→主进程回传**：新增 `desktop:gift-display` IPC 通道，`notification.js` 显示礼物 Toast 后回传事件信息至 Electron 主进程，写入 `[Bilibili][GiftDisplay] action=toast-requested` 结构化日志。
- 🧪 **测试同步更新**：前端回归测试适配新叠加层布局函数、`localOverlayOrigin` 工具、恢复固定 450px 队列行。新增 `removeQueueLoopClones` 单元测试、`render` vs `relayoutQueue` resize 行为断言、礼物服务诊断日志测试。移除旧的固定行数测试。

## v3.0.6 变更

- 🐛 **服务器主机名统一为 IPv4 回环地址**：新增 `normalizeServerHost()` 函数，`localhost` 启动时自动规范为 `127.0.0.1`。解决了此前代码中混用 `localhost` 和 `127.0.0.1` 导致投屏链接不一致、OBS 跨协议访问失败等问题。WebSocket 地址和文档示例同步更新。
- 🐛 **投屏链接生成移除地址替换 hack**：`display.js` 中 `initOverlayUrls` 删除 `.replace('127.0.0.1', 'localhost')` 手动替换逻辑，直接使用 `location.origin`，不再需要猜测当前主机名。
- 🎨 **管理后台队列面板响应式高度**：双队列行从固定 `450px` 改为自适应高度——SC 队列 `clamp(420px, 60vh, 560px)`（需要更多空间显示详细 SC 消息），点歌队列 `clamp(340px, 48vh, 460px)`。窄屏下队列面板统一 `height: auto` + `min-height: 0` 自然堆叠。
- 🧰 **百宝箱功能入口扩展**：新增「加班机」「每日待做」「使用文档」三个占位面板标签页，均为空 `<section>` 占位，预留给后续功能实现。百宝箱侧边栏入口顺序：加班机 → 每日待做 → 性能检测 → 使用文档 → 桌面更新。
- 📝 **文档更新**：架构部署文档更新 `HOST` 环境变量默认值说明。叠加层 README 示例 URL 改为 `127.0.0.1`。
- 🧪 **测试同步更新**：新增 `localhost` → `127.0.0.1` 规范化测试。前端回归测试适配新队列面板高度规则、百宝箱入口顺序、投屏链接去替换 hack 回归断言。

## v3.0.5 变更

- ⚡ **结构化日志体系全面升级**：所有 Bilibili 日志统一为 `[Bilibili][模块]` 前缀 + `key=value` 结构化格式。弹幕命令日志新增 `connectionGeneration`/`connectionAttempt`/`cmd` trace 字段；礼物日志新增 `status=parsed` 和 `platformId`/`comboId`/`messageTimestamp` trace 字段。醒目留言新增 `formatBilibiliSuperChatLog` 统一日志格式。去重器新增结构化去重日志（`[Bilibili][Command] status=deduplicated` + sources 数组）。未解析的礼物类命令日志移至 `helpers.js` 统一管理。
- ⚡ **连接追踪增强**：`danmaku-client.js` 新增 `connectionAttempt` 单调计数器（每次 `connect()` 递增），与 `connectionGeneration` 一起注入到所有消息处理 trace 中。WebSocket 连接/断开/错误事件记录 `code`/`reason`/`wasClean`/`readyState` 等诊断字段。
- ⚡ **终端日志结构化**：`terminal-log.js` 重构为结构化格式——每行新增 `[run=<uuid> seq=<n> pid=<n> type=<processType>]` 元数据前缀，覆盖 `warn`/`error` 级别。导出 `formatLogLine` 供 desktop 日志共用。
- ⚡ **Electron 主进程日志增强**：应用生命周期事件（START/READY/QUIT_BEGIN/QUIT_TIMEOUT/QUIT_DONE）、窗口创建/关闭、IPC 操作、更新检测事件、播放 flush 结果均写入结构化桌面日志。`writeLog` 使用全局 `logRunId` + 单调 `logSequence`。
- 🧹 **播放 flush 独立模块**：`electron/main.js` 播放 flush Promise 管理分离至独立的 `playback-flush.js` 模块，`requestPlaybackFlush` 内部 await 与超时逻辑封装。
- 🧹 **更新管理器可测试化**：`configureAutoUpdater` 新增 `updater` 参数注入，允许测试时替换 `autoUpdater` 实例。
- 🐛 **登录窗口竞态修复**：`bilibili-login-window.js` 中 `checkLoginComplete` 新增 `loginCheckInFlight` 和 `loginCloseRequested` 防重入旗标，多个 cookie change 事件密集到达时只关闭一次登录窗口。
- 🐛 **WebSocket 事件对象传递**：`WebSocketConnection` 的 `close`/`error` 事件现在转发原生 event 对象（`code`/`reason`/`wasClean`/`message`），不再丢失诊断信息。
- 🔄 **gift-normalizers 职责精简**：`logUnparsedGiftLikeCommand` 移回 `helpers.js`（唯一调用方），`gift-normalizers.js` 只保留纯数据标准化函数。`gift-parser.js` 导入路径同步更新。
- 🧪 **测试大幅扩展**：新增 7 个测试用例——礼物日志 trace 字段、SuperChat 日志格式、未解析礼物日志格式、去重器日志输出（同源+跨源）、登录窗口 cookie 批量到达、终端日志结构化格式含 warn/error。

## v3.0.4 变更

- 🎨 **醒目留言行垂直居中**：`.sc-row` `align-items` 从 `start` 改为 `center`，单行 SC 内容垂直居中显示更整齐。
- 🎨 **队列行高进一步压缩**：点歌队列 `grid-auto-rows` 从 76px → 64px，醒目留言列表从 72px → 65px，配合溢出隐藏使面板更紧凑。
- 🎨 **播放栏首列再收紧**：播放信息网格首列从 240px 收窄至 220px，标题/歌手区域信息密度更高。
- 📝 **README 格式整理**：功能列表各节之间新增空行分隔，提升可读性；新增 `capture-bilibili-events.js` 抓包脚本使用示例。
- 🧪 **测试同步更新**：`frontend-regressions.test.js` 新增醒目留言列表行高和垂直居中回归断言，适配新尺寸值。

## v3.0.3 变更

- 🎨 **风格 2 队列统一滚动**：歌名和点歌人/徽章/勋章合并为单一连续滚动流。`identity-song-wrapper` + `identity-details-wrapper` → 单个 `identity-content-wrapper > identity-content`，歌名、请求者、守卫徽章、粉丝勋章均在同一个 `inline-flex` 中自然排列、一起横向滚动。`scheduleIdentitySongScroll` + `scheduleIdentityDetailsScroll` 合并为 `scheduleIdentityContentScroll`，CSS 移除 52% 最大宽度和 `translateX(-52px)` 偏移 hack，滚动更简洁可靠。
- 🎨 **风格 2 徽章字号缩小**：守卫/勋章徽章字号从 `inherit` 改为 `60%`，徽章在内容流中更低调、不喧宾夺主。
- 🎨 **播放栏首列再收紧**：播放信息网格首列从 280px 进一步收窄至 240px，标题/歌手信息密度更高。
- 🎨 **醒目留言行内边距**：`.sc-row` 新增 `padding-top: 9px; padding-bottom: 9px`，行内间距更舒适。
- 🎨 **队列行高微调**：点歌队列 `grid-auto-rows` 从 88px → 76px；醒目留言列表单独设置 `grid-auto-rows: 72px`，更紧凑统一。
- 🧪 **测试同步更新**：`frontend-regressions.test.js` 适配新 CSS 类名、统一滚动函数、徽章字号和播放栏列宽断言。

## v3.0.2 变更

- 🧹 **礼物机器人功能移除**：`gift-service.js` 移除全部礼物机器人弹幕解析逻辑（~200 行），包括待处理用户别名缓存、礼物报告匹配合并、盈亏回填等链路。`settings-store.js` 移除 3 个礼物机器人默认配置项（`enableGiftBotFallback`、`giftBotNames`、`giftBotAliasMap`）。`domain-services.js` 和 `server.js` 同步清理相关状态 Map 和注释代码。架构文档移除 `bilibili:gift-bot` 事件引用。
- 🐛 **大航海上舰去重修正**：`gift-parser.js` 新增 `buildBilibiliGuardPurchaseId` 生成结构化 `platformId`（`guard:uid:giftId:startTime`），替代旧版随机 ID，确保同一大航海购买事件被正确去重，不再重复记录。
- 🎨 **歌单展示板歌手名简化**：`songs.js` 新增 `primarySongArtist()` 函数，按 `/` 分割取首个歌手名，避免多歌手并列导致视觉拥挤。按歌手分组时也使用首位歌手归类。
- 🎨 **歌单展示板样式收紧**：歌手名字号从 12px 缩至 10.5px，最大宽度从 36%/10em 收紧至 32.4%/9em，新增 `letter-spacing: -0.1em` 压缩间距。面板 header padding 从 10px/18px 缩减至 6px/8px。缓存版本升级至 `20260803-03`。
- 🎨 **管理后台队列行高修正**：`workspace.css` 队列列表新增 `grid-auto-rows: 88px` + `align-content: start` 统一行高靠上排列；队列行局部新增 `min-height: 0` + `overflow: hidden` 防止内容溢出。
- 🎨 **礼物卡片网格调整**：礼物页面卡片最小宽度从 180px 恢复至 270px 保证可读性；近期礼物卡片改为固定 6 列布局（`repeat(6, minmax(0, 1fr))`）。
- 🧪 **测试同步更新**：`frontend-regressions.test.js` 新增队列行高、礼物卡片宽度、歌手名简化、header padding 等回归断言；`gift-service.test.js` 清理礼物机器人状态引用。

## v3.0.1 变更

- 🎨 **播放栏布局微调**：播放信息网格首列从 340px 收窄至 280px，进度条区域左侧内边距从 35px 缩减至 8px，信息密度更紧凑。
- 🎨 **样式版本更新**：`styles-playback.css` 缓存版本升级至 `20260803-01`。
- 🧪 **前端回归测试同步**：`frontend-regressions.test.js` 播放栏布局断言适配新的网格参数。

## v2.2.1 变更

- 🎞️ **播放栏歌名跑马灯滚动**：长歌名和艺术家文本改用 Web Animations API 跑马灯横向滚动（35px/s，两端暂停 1s），替代 CSS `text-overflow: ellipsis` 截断。播放栏网格从自适应改为固定两列（`340px + 520px`），响应式窄屏自动收窄。尊重 `prefers-reduced-motion`，动画元素通过 `ResizeObserver` 自动重算。
- 💾 **播放状态服务端优先恢复**：`StorageManager.restoreState()` 优先 fetch `/api/playback/queue-state` 从 SQLite 队列快照恢复，服务不可用时自动回退 localStorage。`_normalizeRestoredState()` 统一处理 `currentTime` 和旧版 `restoredTime` 字段兼容。
- ⚡ **播放状态持久化重构**：`flushPlaybackStateSave` 改为 async + `takePendingPayload()` 原子取走待保存数据，防止重复发送。新增 `flushPlaybackStateForShutdown()` — Electron 关闭服务前先 `await` IPC 写入 SQLite，失败时回退 `fetch` + `keepalive: true`。
- 🗄️ **播放缓存策略调整**：`CacheManager` TTL 从 4 小时延长至 24 小时；移除 `pagehide` 清空缓存逻辑，改为登录/退出时按平台精确清理（`cacheManager.clearByPrefix(platform)`）。`provider-operations.js` 和 `initializer.js` 适配新策略。
- 🎁 **礼物 Combo 累计字段增强**：`gift-parser.js` 解析层新增 `comboId`/`comboNum`/`comboTotalPrice` 及 `batchComboSend` 提取；`COMBO_SEND` 金额使用 `comboTotalCoin`。`gift-service.js` 合并逻辑增强——有递增 `comboNum` 时用 `Math.max` 防膨胀，否则累加；`extractComboRootKey` 优先使用 `comboId` 去重。
- 🧹 **礼物去重精简**：`findRecentGiftCommandDuplicate` 移除同 CMD 完全重复检查（仅保留跨 CMD 匹配），减少不必要的数据库查询。
- 🎨 **直播刷新 Toast 双行文本**：`showStackedToast` 新增 `title` 字段，Toast 布局改为 `align-content: center` + 标题/副标题双行，标题新增粉色发光 `text-shadow`，整体 padding/font 微调。
- 🎨 **风格 2 叠加层样式微调**：请求者 `.identity-requester` 左移 52px 与歌名拉开间距；空状态和面板标题新增 `font-size: 2.5em` 放大展示。
- 🧪 **测试大幅扩展**：`gift-service.test.js` 新增 Combo 累计/合并 6 个测试用例；`playback-queue.test.js` 新增播放状态服务端恢复和持久化测试；`playback-cache.test.js` 新增缓存管理器单元测试；`frontend-regressions.test.js` 新增跑马灯 DOM 结构、Toast 双行、缓存策略等回归断言。

## v2.2.0 变更

- 🔄 **弹幕消息跨源去重**：`MessageDeduplicator` 新增跨源（弹幕/历史/醒目留言）消息匹配——同一用户 1.5s 内从不同来源（弹幕打码名 + 历史全名）发出的相同内容合并去重；支持打码用户名模糊匹配（`哈***` ↔ `哈极光dd_`），30 分钟以上的旧条目自动清理。`danmaku-client.js` 和 `message-handlers.js` 所有 `remember()` 调用点统一传入 `userName` 和 `source`。
- 🔤 **点歌板风格 2 字号独立控制**：新增 `identityQueueFontSize` 设置项（9-78px，默认 26px），统一控制风格 2 的序号、歌名和点歌人字号；管理后台主题设置区新增「文字设置」区块，range + number 双向绑定。CSS 变量 `--identity-queue-font-size` 驱动，预设切换时同步更新。
- 🎞️ **风格 2 歌名溢出原生滚动**：长歌名改用 Web Animations API 做原生横向滚动（`scheduleIdentitySongScroll`），根据溢出宽度自动计算滚动时长，匀速往返 + 暂停；移除旧版 CSS `@keyframes identity-text-scroll` 无限动画，不再复制歌名文本拼接。
- 🎯 **风格 2 弹跳滚动修复**：`bounceScrollTiming` 在顶部新增暂停段（`topPauseEndPercent`），弹跳节奏改为「顶部暂停 → 向下滚 → 底部暂停 → 向上滚」，经典队列和风格 2 同步修正。`setClassicBounceKeyframes` 和 `setIdentityBounceKeyframes` 签名统一为三阶段百分比。
- 🎨 **直播刷新 Toast 视觉增强**：图标新增 `drop-shadow` 发光和 `live-refresh-glow-pulse` 脉冲动画，hover 时卡片轻微上浮（`translateY(-1px)`），圆角/边框/阴影/字号全面微调，入场动画曲线更自然。
- 🔀 **播放队列与抽屉互斥**：打开播放队列弹窗时自动关闭右侧抽屉，避免两个浮层同时覆盖屏幕。
- 📐 **搜索面板高度扩展**：搜索结果最大高度从 280px 提升至 390px，展示更多搜索结果。
- 🧩 **百宝箱面板布局修复**：`.other-feature-panel-body.stack` 新增 `grid-auto-rows: max-content`，避免内部网格行撑破容器。
- 🧹 **桌面更新面板精简**：移除百宝箱中桌面更新功能的冗余面板标题 header，内容区更紧凑。
- 🧪 **测试覆盖增强**：新增 `message-deduplicator.test.js`（跨源去重、打码名匹配、不同观众独立去重）；`frontend-regressions.test.js` 新增风格 2 字号控制、歌名溢出滚动、弹跳动画顶部暂停等回归断言。

## v2.1.3 变更

- 🎹 **全屏歌词双按钮**：单一切换按钮 `fsLyricToggleBtn` 拆分为独立的「罗」（罗马音）和「译」（中文翻译）两个按钮，各自独立开关，互斥显示；`_cycleLyricMode` 改为 `_toggleLyricMode(mode)`，再次点击当前模式即关闭。
- ⚡ **播放竞态保护**：`playback-controls.js` 新增 `playRequestGeneration` 单调计数器，连续切歌时自动取消过期请求；`AbortError` / interrupted play 错误不再弹错误提示，避免切歌时误报。
- 🎯 **歌单上下文跟踪**：`home-handler.js` 新增 `getHomeCollectionContext` 生成 `queueSourceKey`（如 `qq:playlist:xxx`）；点击当前歌单中已有曲目直接跳转（`jumpToPlaylistTrack`），不重建队列；点击其他歌单曲目则替换队列。点击曲目行空白区域触发 `play-context` 行为。
- 📦 **主题预加载缓存**：`theme.js` 用内存缓存对象替代每次访问 `themeConfig?.presets?.xxx`，`app.js` 初始化前 `await Theme.loadThemeConfig()`，确保主题表单在 preset 数据就绪后才初始化。
- 🧹 **移除「复制全部 overlay 地址」按钮**：`display.js` 删除 `copyOverlayUrls` 处理逻辑；`admin.html` 移除按钮及标题区块；CSS 清理 `.overlay-address-head` 相关样式。
- 🎨 **样式与标记微调**：全屏歌词按钮改为文字图标（`<span>罗</span>`/`<span>译</span>`）；`panels.css` 曲目菜单行 z-index 修正；`base.css` 移除 `--classic-row-height` 残留变量。
- 🧪 **测试大幅扩展**：`frontend-regressions.test.js` 新增主题预加载顺序、歌词双按钮行为、经典队列样式等回归断言；`playback-queue.test.js` 新增歌单上下文跳转、行点击替换队列等测试。

## v2.1.2 变更

- 🧰 **「其他」页面重构为「百宝箱」**：`other.js` 重命名注释和文案，新增 `selectFeatureById` / `isFeatureAvailable` API，按键导航过滤隐藏按钮，自动回退逻辑更稳健。
- 🖥️ **桌面更新迁移至百宝箱**：`desktopUpdatePage` 从歌曲管理标签页的溢出菜单移入百宝箱侧边栏，作为独立功能入口（`otherDesktopUpdateFeature`）；`desktop.js` 通过 `AdminApp.navigation.setMainPage` + `selectFeatureById` 导航，移除旧版手动标签切换逻辑。
- 🧹 **标签页溢出菜单移除**：`tabs.css` 删除 `.tab-overflow` 全部样式；"导入导出""桌面歌词设置"从溢出菜单移入主标签栏；移除性能页面独立标签样式。
- 🎨 **直播刷新 Toast 图标化**：`.admin-live-refresh-toast` 用 `live-refresh-icon.png` 替代纯 CSS 渐变圆形，新增 `live-refresh-icon-in` 入场动画，适配 `prefers-reduced-motion`。
- 🐛 **播放控制器 Auth 修复**：`playback-controls.js` 中 `playbackAuthState` 改为延迟解构，修复未登录状态下误判逻辑。
- 🧪 **测试扩展**：`frontend-regressions.test.js` 新增百宝箱导航、桌面更新入口等回归断言；`playback-queue.test.js` 新增队列相关测试。
- 🎨 **样式清理**：`styles-admin.css` 缓存版本更新为 `20260803-05`；多处 CSS 细微调整。

## v2.1.1 变更

- 🧹 **「其他」页面导航重构**：`other.js` 重写为数据属性驱动的功能导航（`data-other-feature` / `data-other-feature-panel`），切换逻辑不依赖任何具体功能模块，扩展新功能只需声明 HTML 属性。
- 🎚️ **歌单滚动速率范围调整**：`scrollSeconds` 范围从 1-200 收缩为 1-100，默认值从 100 改为 45；新增 `migrateSongScrollSpeedSetting` 迁移逻辑，旧版数值自动按比例映射到新范围。
- 🗑️ **移除性能检测页面**：管理后台移除「性能」标签页及其全部 HTML/CSS（整机 CPU/GPU/内存等指标卡片），简化管理界面。
- 🎨 **管理后台样式微调**：`styles-admin.css` 缓存版本更新为 `20260803-04`；`modals.css`、`display.js`、`forms.js`、`theme.js`、`songs.js` 小幅调整。
- 🧪 **前端回归测试扩展**：`frontend-regressions.test.js` 新增「其他」页面导航、歌单滚动速率等回归断言。

## v2.1.0 变更

- 🏗️ **服务运行时实例化重构**：`server.js` 从全局模块模式重构为 `createServerRuntime(options)` 工厂函数，每个数据目录对应一个独立的服务运行时实例，数据库、HTTP 服务器、WebSocket Hub、Bilibili 客户端均由运行时统一管理生命周期；Electron 主进程通过窄接口调用，保留原有 HTTP/WebSocket/IPC 合约不变。
- 🔌 **WebSocket Hub 实例化**：`ws.js` 重构为 `createWebSocketHub()` 工厂函数，提供 `handleUpgrade` / `broadcastSnapshot` / `stop` 接口，生命周期绑定至运行时实例。
- 🛑 **优雅关闭与资源释放**：新增 `stop()` 方法，关闭时释放所有定时器、监听器和连接资源；`electron/main.js` 适配新运行时接口，应用退出时执行预关闭钩子并停止运行时。
- ⚡ **异步竞态与原子性修复**：Danmaku 客户端新增单调生成计数器，`stop()` 使所有待处理连接失效；歌词服务新增取消令牌机制，防止过期回调提交副作用；队列与点歌请求持久化改为显式 SQLite 事务保证原子写入；临时端口启动正确报告并释放实际监听端口。
- 🎁 **礼物服务 V2 事件修复增强**：`gift-service.js` 礼物事件修复逻辑扩展，覆盖更多边界情况。
- 🔑 **Bilibili 登录窗口**：新增 `src/electron/bilibili-login-window.js`，提供独立的 Bilibili 登录 BrowserWindow，支持 cookie/session 持久化。
- 🎵 **歌曲文件编解码器**：新增 `src/music/song-file-codec.js`，支持歌曲数据的 CSV/XLSX 导入导出；新增 `src/music/song-import-schema.js` 导入校验，`src/music/track-contract.js` 跨平台曲目标识规范化。
- 🎨 **叠加层工具模块抽取**：新增 `public/js/overlays/overlay-utils.js`（`window.OverlayUtils`），提取 `escapeHtml`、`hexToRgb`、`hexToRgba`、`withMultilingualFallback`、`scrollTravelSeconds`、`overlayLowPowerEnabled` 等共享工具函数；`songs.js` 改为通过 `window.OverlayUtils` 调用，减少重复代码。
- 🧪 **测试覆盖大幅增强**：新增 `bilibili-login-window.test.js`、`gift-service.test.js`、`queue-service.test.js`、`song-file-codec.test.js` 4 个测试文件；`danmaku-client.test.js` 新增连接生成计数器测试；`lyrics.test.js` 新增取消令牌测试；`server-smoke.test.js` 新增运行时生命周期测试；`websocket-transport.test.js` 新增 WebSocket Hub 实例化测试；`server-lifecycle.test.js` 新增优雅关闭测试；`frontend-regressions.test.js` 新增叠加层工具函数回归测试。

## v2.0.9 变更

- 🔧 **服务端口固定绑定**：服务器从 `listenWithFallback`（端口扫描回退）改为 `listenExactly`（精确绑定），始终使用配置端口（默认 3000）；端口被占用时立即报错而非静默切换，避免投屏链接端口不一致的问题。
- 🏷️ **服务身份标识**：健康检查端点新增 `serviceId: 'bilibili-live-song-plugin'`，旧实例清理逻辑优先通过服务 ID 识别自身实例（不再仅依赖数据目录路径匹配），即使数据目录不同也能正确识别并清理旧实例。
- 🛡️ **旧实例清理逻辑加固**：`cleanupOwnPortOccupant` 严格按请求端口匹配运行时信息，不同端口的实例互不干扰；非自身服务（不同 `serviceId` 或无服务 ID 的旧版）不会被误杀。
- 🎨 **歌单展示板字号范围恢复**：字号下限从 24 调回 10，允许更小的叠加层文字尺寸。
- 🎨 **歌单展示板滚动速度范围调整**：滚动时长范围从 100-3000s 调整为 2-1000s，滚动更跟手。
- 🎨 **叠加层内容内边距缩放**：`.song-board .overlay-content` 新增 `padding` 按 `--overlay-font-scale` 等比缩放。
- 🧪 **测试覆盖增强**：新增 4 个服务生命周期测试（端口精确绑定拒绝、运行时端口匹配、跨数据目录识别、无关服务保护）；歌单展示板滚动速度边界测试；烟雾测试新增 `serviceId` 断言。

## v2.0.8 变更

- 🧭 **管理后台新增「其他」页面**：新增 `other.js` 模块和「其他」导航标签页，预留扩展功能入口；`app.js` 导航系统重构为声明式注册（`VALID_MAIN_PAGES`/`HASH_MAP`/`BODY_MAP`），新增页面只需加一行配置，显式注释降低后续维护成本。
- 🎨 **歌单展示板字号控件重定位**：`songBoardFontSize` 从主题设置页迁移至投屏设置页，范围从 8-80 调整为 24-80，默认值从 16px 提升至 50px；旧值 16 自动迁移至新默认值 50。
- 🎨 **危险操作确认弹窗视觉增强**：`dangerConfirm` 弹窗新增右上角滑入动画、模糊遮罩层、顶部渐变危险色条、脉冲发光效果，视觉层次更丰富、警示感更强（+193 行 CSS）。
- 🧪 **测试同步更新**：歌单展示板字号测试适配新的控件位置和默认值（50px → display 页面）。

## v2.0.7 变更

- 🧹 **未使用模块清理**：移除 4 个已废弃模块——`admin/main.js`（旧导航入口）、`shared/component-base.js`（未使用的组件基类）、`playback/api/client.js`（已整合的 API 客户端）、`playback/integration/admin-app-bridge.js`（已整合的管理桥接），净减少 387 行代码。
- 🎵 **歌词按钮迁移至管理后台**：播放栏移除桌面歌词开关和锁定按钮，歌词窗口地址改为在管理后台「直播画面」标签页统一管理，职责更清晰。
- 🎨 **歌单展示板字号独立控制**：新增 `songBoardFontSize` 设置项（8-80px），歌单展示板字号可独立调节，通过 CSS 变量 `--overlay-font-scale` 统一缩放标题与内容。
- 🎨 **歌单展示板默认毛玻璃主题**：默认主题改为半透明毛玻璃效果（透明度 0.48、模糊 14px、发光强度 2），OBS 叠加效果更干净。
- 🎨 **CSS 样式精简**：`player.css` 移除歌词/锁定按钮相关样式规则；播放栏间距微调（16px→20px）；叠加层样式新增字号缩放变量支持。
- 📝 **文档清理**：移除 4 份已过期的开发计划文档、`REFACTOR-SUMMARY.md`、礼物模块拆分总结等旧文档。
- 🧪 **测试覆盖增强**：新增歌单展示板字号控制、毛玻璃主题默认值、桌面歌词地址迁移等回归测试断言。

## v2.0.6 变更

- 🖥️ **管理后台区域可见性修复**：歌曲 workspace 队列行从 `flex: 0 1 auto` 改为 `flex: 0 0 450px`（桌面端不压缩），管理面板 tab 页 `overflow` 改为 `visible`，桌面宽屏 `body` 新增 `overflow: hidden`，确保每个歌曲管理区域都能滚动到、不被播放器停靠栏遮挡。
- 📱 **响应式队列布局适配**：窄屏（≤900px）下队列行改为 `flex: 0 0 auto` + `height: auto`，队列面板自然堆叠且全部可达。
- 🎁 **礼物盲盒图标迁移至本地资源**：盲盒图标从独立 PNG 文件迁移到 `public/img/bilibili-gifts/blind-box/` 目录的 WebP 资源，按礼物 ID 映射（心动盲盒 `32251`、幸运盲盒 `35206`、小熊虫盲盒 `35800`），旧 PNG 文件已移除。
- 🗂️ **Bilibili 礼物图片资源库**：新增 `public/img/bilibili-gifts/` 目录，按价格区间（¥0-100、¥100-200 等）组织 200+ 个 Bilibili 直播礼物 WebP 图标，附带 `bilibili-gifts.json` 映射表和 `000-gift-mapping.md` 索引文档。
- 🎨 **最近礼物空状态视觉重设计**：空状态从虚线边框大卡片改为居中的圆形图标 + 文案布局，使用 `gift-section-icon.png` 装饰，色调更柔和内敛。
- 🔧 **队列滚轮事件边界修正**：SC 队列和点歌队列的滚轮事件改为智能边界检测——队列内部可滚动时拦截滚轮，滚动到顶/底后放行页面滚动，不再吞掉所有滚轮事件。
- 🛡️ **清空队列确认升级**：清空全部队列按钮从原生 `confirm()` 改为 `dangerConfirm()` 模态弹窗，显示受影响条目和不可撤销警告，操作更安全。
- 🎨 **CSS 细节修复**：开关控件 input 添加 `width: 1px; height: 1px; min-height: 0` 防止布局偏移；播放器响应式进度条修正 `width: auto` + `padding-left: 0`。
- 📝 **小熊虫 README 更新**：`README-tardigrade.md` 精简为指向新礼物目录的简洁说明。
- 🧪 **测试覆盖增强**：新增队列面板 flex 尺寸、响应式队列高度等前端回归测试断言。

## v2.0.5 变更

- 🐛 **歌曲管理区滚动修复**：歌曲 workspace 从 `min-height` + 隐式滚动改为固定 `height` + `overflow-y: auto`，确保歌曲列表在视口内正确滚动，不再被播放器停靠栏遮挡。
- 🔧 **管理后台初始化时序修正**：`app.js` 在 `document.readyState === 'interactive'` 时等待 `DOMContentLoaded` 再初始化，确保所有同级模块脚本均已注册后再启动，消除模块加载竞态。
- 🔧 **管理后台事件渲染补全**：新增 `STATE_LOADED` 和 `SONG_UPDATED` 事件监听，确保队列空状态和歌曲数据变更时 UI 正确刷新。
- 🐛 **主题对象合并保护**：`theme.js` 挂载到 `window.AdminApp` 时使用 `Object.defineProperties` 合并而非直接替换，保护已有属性（如 `initThemeForm`）不丢失。
- 🧹 **调试日志清理**：移除 `controller.js`、`playback-controls.js`、`search-handler.js` 中的冗余 debug `console.log`，保持控制台输出干净。
- 🔧 **Windows 构建脚本修复**：`dist:win:local` 移除 `cross-env` 依赖，改用 Windows 原生 `set` 设置环境变量。
- 🧪 **测试覆盖增强**：新增歌曲 workspace 滚动、admin 状态事件渲染、初始化时序、主题兼容性等回归测试；`playback-queue.test.js` 存储键名同步迁移至 `playbackState:v2`。

## v2.0.4 变更

- 🎨 **播放器功能模块化深度重构**：controller.js 进一步拆分，新增 home-handler（首页）、import-handler（导入）、lyric-controls（歌词控制）、match-handler（匹配）、pending-handler（待处理）、search-handler（搜索）等独立功能模块，代码净减少 533 行，组织更清晰、可维护性显著提升。
- 🔧 **缓存操作独立化**：新增 playback/operations/cache-operations.js，将缓存相关操作从核心模块中分离，职责更单一。
- 🎨 **管理后台样式优化**：collapsible 和 workspace 样式调整，界面交互更精致。
- 🧪 **测试同步更新**：前端回归测试和播放队列测试同步适配重构后的模块结构，保障代码质量。

## v2.0.3 变更

- 🎨 **播放器操作模块重构**：新增 `playback/operations/` 模块，将播放器控制、队列操作、电台模式、流处理等功能进一步细化拆分，提升代码模块化程度。
- 🔧 **组件基础设施增强**：新增 `shared/component-base.js` 和 `shared/logger.js`，为 UI 组件和日志记录提供统一的基类与工具函数。
- 🧹 **代码清理**：移除重构过程中残留的备份文件（`.backup`），CSS 样式微调与代码整理。

## v2.0.2 变更

- 🎨 **播放器前端全面重构**：`playback.js` 模块化拆分为 controller、core、features、integration 等子模块体系，代码结构更清晰，可维护性显著提升。
- 🔧 **事件总线架构升级**：新增 `event-bus.js` 统一管理全局事件通信，替代分散的事件监听，降低模块耦合度。
- 🎁 **礼物管理模块重构**：`gifts.js` 按功能拆分为多个子模块（gifts/api.js、gifts/display.js、gifts/stats.js 等），代码组织更合理。
- 🧹 **代码质量提升**：清理冗余代码，统一命名规范，改进错误处理，提升整体代码健壮性。

## v2.0.1 变更

- 🎨 **前端样式全面优化**：管理后台、播放器、投屏页面 CSS 细节调整与视觉增强。
- 🧪 **前端回归测试补强**：新增前端关键功能回归测试用例，提升代码质量与稳定性。

## v2.0.0 变更

- 🎨 **点歌板风格 2 全面升级**：醒目留言与点歌队列合并为统一列表，长歌名、醒目留言和规则文字支持横向滚动；纵向滚动改为按实际容器高度和内容长度计算，并新增独立滚动速率设置。
- 🔍 **投屏字号与滚动适配增强**：队列歌曲和标题字号范围扩大一倍，旧设置自动迁移；经典队列、点歌板风格 2 和歌单投屏均按实际字体、视口及内容高度计算滚动距离，窗口尺寸变化后自动重新布局。
- 🧭 **桌面端启动与端口生命周期改进**：记录服务运行时 PID、端口和主机信息，启动时精确识别并清理旧桌面实例；保留 3000 端口优先及占用后的安全回退，投屏链接使用当前实际端口。
- 🧾 **终端与礼物日志优化**：桌面端新增每次启动重置的 `terminal.log`，同步记录常规终端输出；B 站礼物日志统一为单行可读格式，移除重复的持久化日志。
- 🪟 **桌面窗口体验调整**：默认窗口改为 1100×720 并取消启动时强制最大化，保留可调整窗口与最小尺寸限制。
- 🧪 **回归测试补强**：新增投屏滚动、字号迁移、动态端口、旧实例清理、礼物日志和终端日志测试，覆盖本次发布的关键行为。

## v1.7.3 变更

- 🔧 **盲盒配置迁移逻辑重构**：`migrateBlindBoxConfig` 新增 `changed` 标志位精确控制数据库写入，仅在配置实际变更时才执行 UPDATE，避免每次启动都触发不必要的写库操作。旧格式升级逻辑正确嵌套在 `needsUpgrade` 判断内。
- ✨ **盲盒默认配置自动合并**：用户已有盲盒配置但缺少新增默认盲盒条目时，自动从默认配置中补充缺失的盲盒条目，新盲盒无需用户手动添加即可生效。

## v1.7.2 变更

- 📊 **盲盒统计明细改为逐条记录**：盲盒盈亏面板从按用户汇总改为每条开盒记录独立展示（最多500条），新增"时间"列和容器滚动，方便追踪每一笔盲盒盈亏。
- 🧸 **小熊虫盲盒支持**：盲盒配置新增小熊虫盲盒（9元/个，8种开出物），`gift-service.js` 新增 `records` 字段返回每条开盒明细。
- 🎨 **小熊虫盲盒视觉适配**：小熊虫盲盒配色从玫瑰红改为蜜桃粉/暖金/深玫瑰（取自盲盒图标），礼物卡片、盲盒 chip、礼物通知样式同步更新。
- 🎁 **礼物流水盲盒图标**：礼物历史记录中盲盒备注优先显示对应盲盒图标，无图标时回退通用 🎁 emoji。

## v1.7.1 变更

- 🐛 **Bug修复与优化**：代码细节优化、性能改进等常规维护。

## v1.7.0 变更

- 🔐 **Session Token 安全机制**：服务端启动时自动生成随机 UUID session token，写入 `.session-token` 文件。所有 API 请求（`/api/health` 除外）和 WebSocket 连接均需携带 token（Header `Authorization: Bearer <token>` 或 query `?token=`），未授权请求返回 401。前端 HTML 页面自动注入内联脚本，自动为 `fetch`、`WebSocket`、`navigator.sendBeacon` 和同源 API 锚点链接附加 token，无需手动处理。旧版客户端（无 token）向后兼容。
- 🛡️ **本地媒体安全加固**：新增 `src/electron/local-media-access.js` 白名单模块，本地音频文件访问限制在授权路径内，非白名单路径返回 403。`music:resolve-local-media-urls` IPC 新增 `senderFrame.url` 来源校验，拒绝跨站请求。
- 🔌 **WebSocket 协议实现重写**：`src/server/ws.js` 从简易单帧解析升级为完整 RFC 6455 实现——支持分片帧（fragmented frames）重组、最大帧/消息大小限制（256KB）、Ping/Pong 心跳保活（30s 间隔）、90s 超时无响应自动断开、per-socket 缓冲区隔离。解决了旧实现在大消息或网络波动时可能出现的数据错乱和内存泄漏问题。
- 🐛 **弹幕客户端健壮性增强**：`replaceBilibiliClient` 改为 Promise 链序列化执行，防止快速重连时的竞态条件。WebSocket 重连前清理旧事件处理器（`clearHandlers`），避免消息重复处理和心跳定时器泄漏。消息处理异常用 try/catch 包裹，不再导致客户端崩溃。连接成功后检查 `stopped` 状态防止无效操作。新增 `alwaysHistory` 选项支持始终使用历史轮询模式。
- 🗄️ **数据库歌曲去重迁移**：新增 schema v3 迁移——清理 `songs` 表中重复的 `(name, artist)` 记录，自动解除 `queue` 和 `requests` 表的外键引用后删除重复行（保留最新），最后重建唯一索引 `idx_songs_name_artist`。解决了旧库可能因重复数据导致的启动崩溃和编辑冲突问题。
- 🐛 **礼物去重逻辑修正**：同一 `platformId` 下，用户名为「观众」时不再触发用户不匹配的去重冲突，避免不同匿名用户的礼物被错误合并为同一条记录。
- 🐛 **开放平台大航海上舰价格解析修正**：移除 `paid` 字段读取，避免 `paid` 为 0 时覆盖有效的 `price`/`amount` 价格，确保大航海礼物金额计算准确。
- 🎵 **播放队列状态恢复修正**：从持久化快照恢复播放时，将当前歌曲从 `normalQueue` 中移除（`splice`），避免同一首歌在队列中重复出现。
- 🎵 **上一曲逻辑修正**：点击上一曲时从历史记录弹出，不再将当前播放的歌曲错误推回队列，确保历史导航行为正确。
- 🎵 **全屏歌词模式修正**：切歌时按 `track.id` 判断是否为新歌曲，正确重置歌词模式（翻译/罗马音），解决切换歌曲后仍显示上一首翻译的问题。
- 🎵 **推荐内容分页去重**：电台/推荐等多轮拉取时检测页面签名（track source+id+title 指纹），相同页面不再重复请求，修复某些歌单可能无限循环拉取的问题。
- 🎵 **歌单缓存写入防护**：空结果或失败响应不再写入磁盘缓存，防止覆盖已有的有效缓存数据。
- 🔑 **QQ 音乐登录态检测增强**：`hasQQMusicAuthCookie` 新增 `p_skey`、`skey` 检测，更全面判断 QQ 音乐登录状态，减少误判。
- 🖥️ **网易云「我喜欢」本地化回退**：英文等非中文环境下，网易云「我喜欢」歌单标题可能被本地化（如 "Favorites"），新增回退逻辑取第一个歌单作为「我喜欢」。
- 🎵 **歌曲编辑错误处理增强**：编辑不存在的歌曲 ID 时返回明确错误提示；唯一约束冲突（同名同艺术家）时给出友好中文提示。
- 🎵 **队列限制防御性校验**：`queueLimit` 为 0 或非有限数时不再拦截点歌，避免配置异常导致完全无法点歌。
- 🔒 **明文 Cookie 导出改为显式 opt-in**：仅当旧版明文 cookie 文件已存在或设置了 `BILIBILI_PLAINTEXT_COOKIE_EXPORT=1` 环境变量时才导出明文 Cookie 文件，减少登录凭证意外泄露的风险。
- 🔧 **更新管理器回调持久化**：`configureAutoUpdater` 保存 `onStateChange` 回调引用，后续 `setUpdateState` 调用即使未传入回调也能正确通知状态变更。
- 🧪 **测试覆盖大幅增强**：新增播放队列状态恢复测试、session token API 鉴权测试、WebSocket token 校验、HTML 注入脚本验证、pagehide beacon token 编码、网易云本地化回退等测试用例。新增 `test/playback-store.test.js`、`test/server-lifecycle.test.js`、`test/websocket-transport.test.js`、`test/frontend-regressions.test.js`、`test/local-media-access.test.js`。
- 🐛 **发布脚本健壮性**：`extractReleaseNotes` 处理 changelog 中缺失换行符的边界情况。
- 🐛 **前端健壮性修复**：`utils.value()` 对不存在的 DOM 元素安全返回空字符串而非抛异常。`debug-gifts.html` 内联 `onclick` 改为事件委托 + `data-*` 属性，符合 CSP（内容安全策略）要求。
- 🎨 **叠加层滚动优化**：队列叠加层移除 `queue:add` 事件的滚动动画捕获/恢复逻辑，简化渲染流程。
- 🐛 **播放历史 upsert 字段保护**：`ON CONFLICT DO UPDATE` 时使用 `CASE WHEN excluded.field != ''` 保护已有非空字段不被空值覆盖。
- 📝 **新增文档与规格**：`specs/regression-hardening_design.md` 回归加固设计文档、`doc/` 和 `docs/` 目录。

## v1.6.6 变更

- 🔄 **QQ 音乐歌单接口升级**：`getCreatedPlaylists`、`getCollectedPlaylists` 优先使用 QQ 音乐桌面客户端 API（`musics.fcg` / `musicu.fcg`），失败时自动回退到旧版网页 API，提升歌单读取的稳定性和数据完整性。
- 🔐 **QQ 登录态检测增强**：`auth-manager.js` 新增 `qm_keyst` Cookie 识别和 `authCookies` 鉴权 Cookie 列表，登录状态判断更准确，解决部分场景下误判为已登录的问题。
- 🎵 **我喜欢歌单兜底策略调整**：`getLikedSongs` 在找不到「我喜欢」歌单时直接抛出明确错误提示而非静默返回空列表，引导用户重新登录以恢复完整凭证。
- 🎨 **全屏歌词切换按钮合并**：将独立的「翻译」和「罗马音」按钮合并为单一循环按钮（`fsLyricToggleBtn`），点击按 `none → trans → roma → none` 顺序循环切换，界面更简洁。
- 🧪 **QQ 音乐测试更新**：测试用例同步适配新版客户端 API 返回格式，新增收藏歌单和请求签名验证的断言。
- 🎨 **样式微调**：全屏歌词切换按钮和播放页样式细节优化。

## v1.6.5 变更

- 🔐 **QQ 音乐 GTK 动态计算**：所有 QQ 音乐 API 请求的 `g_tk` 参数从硬编码 `5381` 改为从 Cookie 中提取 `skey`/`p_skey` 动态计算，提升请求签名准确性，解决部分接口因 g_tk 不匹配导致的鉴权失败问题。涉及 `getLegacyLyrics`、`getCreatedPlaylists`、`getCollectedPlaylists`、`getSavedAlbumTracks`、`getPlaylistTracks`、`getLikedPlaylistFromProfile` 等全部 API。
- 🔍 **extractUin 优先级匹配**：QQ 号提取从单一泛化正则改为三层优先级匹配——优先精确匹配 `qqmusic_uin`/`uin`/`o_cookie`，其次匹配 `wxuin`（微信登录），最后泛化回退，避免 `p_uin`、`pt2gguin` 等非 QQ 号字段干扰。
- 🎵 **我喜欢歌单回退逻辑**：`getLikedSongs` 在常规歌单列表中找不到「我喜欢」时，新增 `getLikedPlaylistFromProfile` 从用户 Profile 接口获取我喜欢歌单 ID 作为回退，提升边界情况下的鲁棒性。
- 📡 **API 请求参数补全**：`getCollectedPlaylists`、`getSavedAlbumTracks` 等接口新增 `g_tk`、`loginUin`、`format`、`platform`、`needNewCode` 等参数，与 QQ 音乐客户端行为对齐，提升请求成功率。

## v1.6.4 变更

- 🎵 **网易云音乐歌单写入支持**：歌单添加功能从仅 QQ 音乐扩展为支持 QQ 音乐 + 网易云音乐双平台，`addTrackToQqPlaylist` 重构为 `addTrackToPlaylist`，新增 `canAddTrackToPlaylist()` 统一判断各平台可添加性。
- 🎨 **歌单选择器 UI**：用自定义模态弹窗替代 `window.prompt`，展示歌单封面、歌曲已添加状态标记（已添加/可添加/检查失败），支持 ESC 关闭、遮罩点击关闭、移动端底部弹出适配；歌单写入前增加二次确认弹窗。
- 🔍 **歌单预检查**：打开歌单选择器时并发检查每个歌单是否已包含当前歌曲，通过 `annotatePlaylistMembership` + `mapWithConcurrency` 并发控制（6 路），已添加的歌单自动禁用不可重复选择。网易云新增 `playlistContainsTrack` 方法。
- 🔐 **网易云 weapi 加密**：实现网易云音乐 weapi 加密协议（AES-128-CBC + RSA），支持歌单写入操作的加密请求，新增 `requestWeapiJson`、`encryptNeteaseWeapiPayload` 等加密基础设施。
- 🏗️ **ProviderManager 按平台状态隔离**：`authState` / `providerHealth` 从单值改为 `authStateBySource` / `providerHealthBySource` Map 按平台存储，`_authStateApiUnavailable` 改为按平台 Set，新增 `setProviderHealth` / `setAuthState` 辅助方法。`refreshAuthState` / `checkProviderHealth` 等均接受 `{ platform, notify }` 选项，解决切换平台时状态串扰问题。
- 🛡️ **刷新竞态保护**：`refreshSelectedMusicProviderState` 新增 `playbackProviderRefreshId` 递增 ID，`Promise.all` 改为 `Promise.allSettled`，平台不匹配时丢弃过期结果，防止快速切换平台导致的状态错乱。
- 🔧 **QQ Cookie 提取增强**：`extractUin` 改为泛化正则匹配任意 `*uin` 结尾的 Cookie 名，新增 `ptnick_<QQ号>` 格式兜底提取；`keyCookies` 新增 `p_uin`、`pt2gguin`、`superuin`，提升 QQ 登录状态持久化成功率。
- 🎨 **播放器 UI 微调**：歌单按钮图标从音符改为加号圆圈图标，按钮 title 按平台动态显示；进度条列间距收紧；健康状态区域增加 flex 布局和最小高度防止布局抖动。

## v1.6.3 变更

- 🐛 **播放器歌单按钮去重**：移除 `addTrackToQqPlaylist` 中重复的代码块（48 行），消除冗余逻辑，减少潜在冲突。
- 🎨 **播放页面网格布局优化**：将 `grid-template-rows` 从固定 `minmax(240px, 1fr)` 改为 `max-content` 自适应内容高度，添加 `align-content: start` 确保内容靠上对齐，解决小屏幕下内容溢出问题；移除媒体查询中冗余的 `grid-template-rows` 覆盖。

## v1.6.2 变更

- 🎵 **播放器「添加到歌单」按钮**：播放控制栏新增「歌单」按钮，当前播放的 QQ 音乐歌曲可一键添加到自己的 QQ 音乐歌单（支持「我喜欢」等所有已创建歌单），按钮根据歌曲来源和 ID 可用性自动启用/禁用。
- 🎨 **首页推荐卡片视觉重设计**：歌单卡片从左对齐改为居中布局，采用渐变背景（`linear-gradient(135deg, #fff 0%, #fafbfc 100%)`）、音符图标（`♫`）装饰、悬停时渐变色变化（`#fff6fa` → `#fff`）和图标缩放效果，视觉更精致。
- ⚙️ **发布脚本本地 electron 优化**：`publish-release.js` 新增 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 环境变量和 `--config.electronDist=node_modules/electron/dist` 参数，使用本地已安装的 electron 进行构建，跳过网络下载，加速发布流程。
- 🛠️ **新增便捷构建脚本**：`build-local.bat`（使用本地 electron 缓存构建，显示详细步骤和进度）和 `build-debug.bat`（启用 electron-builder 调试输出），简化本地开发调试。
- 📝 **发布指南更新**：`RELEASE_GUIDE.md` 补充本地 electron 使用说明，明确脚本不会重新下载 electron。

## v1.6.1 变更

- 🐛 **Bug 修复与优化**：代码细节优化、测试完善、依赖更新等常规维护。

## v1.6.0 变更

- 🎵 **桌面歌词全面增强**：新增 4 个可配置参数——窗口缩放（0.5-2.0）、行间距（1.0-2.0）、文字阴影强度（0-1.0）、翻译字号比例（0.4-1.0）；管理后台新增「窗口缩放」「阴影与特效」两个设置区块，共 8 个表单控件（range + number 双向绑定）。
- 🖱️ **桌面歌词鼠标滚轮缩放**：歌词窗口支持鼠标滚轮实时调节缩放比例（±0.1/档），锁定状态下禁用缩放，CSS `will-change` + `transform: scale()` 硬件加速，过渡动画 0.15s 响应迅速。
- 🎨 **桌面歌词动态样式**：所有歌词样式通过 JavaScript 动态应用（字体、字重、颜色、描边、阴影、透明度等），设置变更即时生效无需重启窗口；移除 CSS 中硬编码样式，改为 `transition` + `will-change` 优化性能。
- 🎁 **礼物通知视觉升级**：`showStackedToast` 新增 `html` 参数支持直接渲染 HTML；礼物通知按类型分变体——大航海（gift-guard）、盲盒（gift-blind-box）、高级礼物≥100元（gift-premium）、免费/银瓜子（gift-free），每种变体独立样式；新增用户名显示、价格徽章、盲盒开出名称等详细信息。
- 🔐 **退出登录确认弹窗**：新增 `logoutConfirm()` 通用方法，替代原生 `confirm()`，采用卡片式弹窗 + 遮罩层 + ESC 关闭 + 自动聚焦取消按钮，视觉精致、操作安全。
- 📜 **队列滚轮滚动优化**：SC 队列和点歌队列自定义 `wheel` 事件，滚动距离缩小至 30%，滚动更平滑可控。
- ⚡ **叠加层渲染去重**：`overlay-queue.js` 和 `overlay-songs.js` 新增 `computeStateKey()` 状态指纹比较，相同状态跳过 DOM 重渲染，减少不必要的重绘开销，降低 CPU 占用。
- 🔌 **Bilibili 登录自动关闭**：Electron 主进程 Bilibili 登录窗口新增 Cookie 变化即时检测 + 1.5s 轮询双重保障，登录成功后自动关闭窗口；音乐平台登录窗口（QQ/网易云）同步支持。
- 💾 **存储层扩展**：`settings-store.js` 的 `DEFAULT_SETTINGS` 新增 12 个桌面歌词默认参数（字体/字重/颜色/描边/字号/透明度/背景透明度/缩放/行间距/阴影强度/翻译比例），确保数据库初始化时写入默认值。
- 🎨 **CSS 大幅扩展**：`styles-admin.css`（+623/-xxx 行）新增礼物通知变体样式、退出登录弹窗完整样式体系；`styles-playback.css` 清理桌面歌词硬编码样式。

## v1.5.7 变更

- 🎵 **QQ 音乐歌单写入**：新增 QQ 音乐歌单添加/删除歌曲功能（`AddSonglist`/`DelSonglist`），通过 `musics.fcg` 端点 + `zzcSign` 签名实现。播放器搜索和首页结果新增"歌单"按钮，支持选择目标歌单后将歌曲直接加入 QQ 音乐歌单。
- 🔔 **堆叠 Toast 通知**：新增 `showStackedToast` 方法，播放队列为空时显示带渐变背景和操作引导的卡片式 Toast；音乐接口健康检查结果也改用堆叠 Toast（通过/异常两种样式），替代普通 toast。
- 🔒 **Electron 单实例锁修复**：`requestSingleInstanceLock()` 提前至 `--dump-cookies` 分支之前执行，避免 dump 模式绕过单实例检查导致多实例启动。
- 🧹 **清理调试接口**：移除 `GET /api/debug/music-cookie` 调试端点、`server.js` 中 `musicAuthProvider` 引用及 `safeStorage` 依赖，代码更干净。
- 🔧 **QQ 音乐分析器重构**：`run-probe.js` 从 spawn 子进程方式改为直接通过正式 API（`/api/music/playlists/tracks/add|remove`）验证歌单写入；`probe-addsonglist.js` 增加 `CONFIRM_WRITE` 环境变量支持非交互模式、自动恢复删除时检查是否确实新增了歌曲再做回滚，防止误删原有收藏。
- 🎨 **播放器 UI 优化**：搜索默认条数从 12 改为 9；推荐歌单默认数从 12 改为 9；健康检查状态 pill 改为渐变背景 + 描边样式。
- 🐛 **网易云封面回退**：`netease-provider.js` 搜索 API 不返回专辑封面时回退到艺术家头像。
- 📝 **歌词服务增强**：新增 `writeMusicPlaylistTracks`、`normalizeMusicTrackForProvider` 支持 `sourceSongId` 字段。
- 🎨 **CSS 样式扩展**：`styles-admin.css`（+250 行）新增播放队列为空 Toast、接口检查结果 Toast（通过/异常）三种完整卡片样式；`styles-playback.css`（+141/-78 行）健康状态 pill 样式优化。
- 🧪 **新增测试**：`test/qq-provider.test.js` QQ 音乐 Provider 单元测试。

## v1.5.6 变更

- 🧹 **Electron userData 重定向**：Chromium 持久化分区从 `%APPDATA%` 迁移至安装目录下的 `data/`，卸载时所有登录态一并清理，不再残留；新增 `migrateUserDataFromAppData()` 自动迁移旧用户数据，升级不丢失登录状态。
- 🔐 **Cookie 安全存储与诊断**：新增 `--dump-cookies=qq|netease` 命令行参数，从 Electron `safeStorage` 加密快照中提取 Cookie header 到 stdout，供探针脚本使用；包含完整的快照恢复和诊断日志。
- 📦 **NSIS 安装器增强**：新增 `build/installer.nsh` 自定义安装脚本，处理残留注册表清理容错（旧卸载器缺失不阻断安装），卸载时清理 `%APPDATA%` 旧分区数据。
- 🎨 **桌面版防闪烁**：CSS 加载前通过内联脚本设置 `desktop-shell` class，消除启动时的粉色闪烁。
- 🎁 **最近礼物区域视觉优化**：图标从内联 SVG 改为专用 `gift-section-icon.png`；"查看全部"按钮采用箭头 SVG 图标，更精致。
- 🔍 **搜索清除按钮**：在线搜索框新增"清除"按钮，一键清空关键词和搜索结果。
- 🔑 **未登录引导提示**：播放空队列时若未登录，弹出可点击的堆叠 toast 引导登录，文案区分登录状态。
- 🎵 **歌词封面回退**：网易云搜索 API 不返回专辑封面时，自动回退到艺术家头像 `img1v1Url`，零额外网络请求。
- 🔧 **调试接口扩展**：新增 `GET /api/debug/music-cookie`，从 Electron 分区直接读取 Cookie，供探针使用。
- 🎬 **播放器状态恢复优化**：`currentTime` 增加 `readyState` 检查，避免 NaN；`restoredTime` 在 play 后及时清除；播放队列空且未登录时引导登录。
- 🗑️ **QQ 音乐分析器清理**：移除 20 个过时的探针/分析脚本，保留 `dump-playlists.js`、`probe-addsonglist.js`、`run-probe.js` 三个仍在使用的工具。
- 🎨 **CSS 样式扩展**：`styles-admin.css`（+209 行）、`styles-playback.css`（+69 行）、`styles-desktop.css`（+17 行）全面增强。

## v1.5.5 变更

- 🔄 **重启更新弹窗视觉重设计**：确认弹窗图标改为红橙渐变+星芒重启图标，图标标题并排布局，视觉更具冲击力。
- 📝 **自动更新设置区文案精简**：移除冗余描述文字，界面更简洁。
- 🔌 **恢复 `restart()` 方法**：`danmaku-client.js` 重新加回 `restart()` 公开方法，供外部调用方手动触发重连。

## v1.5.4 变更

- 🖥️ **管理后台布局重构**：最近礼物区域升级为可折叠卡片区并前移，盲盒映射后置，信息架构更合理。
- 📊 **礼物流水排序功能**：礼物流水抽屉表头支持点击排序（时间/礼物名/金额/备注），备注列按大航海等级→盲盒盈亏智能排序。
- 📦 **最近礼物折叠**：新增最近礼物卡片区域折叠/展开切换。
- 👤 **直播状态显示主播名**：弹幕客户端新增 `ownerName` 字段，通过 Bilibili Master API 获取主播昵称，管理后台状态栏显示主播名和房间号。
- 💬 **状态消息精简**：弹幕客户端状态消息去冗余，去掉重复房间号和冗长描述。
- 🎬 **播放器 seek 双保险**：新增双层 seek 机制（`loadedmetadata` + `play()` 后），确保 `startAt` 跳转可靠；`restoredTime` 在 seek 确认后清除，避免下次误跳转。
- 📏 **播放器进度条修复**：渲染进度条时传入歌曲时长，修正 restoredTime 显示。
- 🔌 **弹幕客户端重构**：移除不安全的 `restart()` 方法；`connect()` 异常向上抛出由调用方统一处理。
- 🎁 **礼物盲盒匹配增强**：`BLIND_GIFT` 协议标记的礼物也用映射表覆盖价格（协议发的是成本价），匹配时优先用 `blindBoxName` 字段，确保盈亏计算准确。
- 🎨 **CSS 样式扩展**：`styles-admin.css`（+127 行）最近礼物卡片、排序箭头、状态栏主播名等样式增强。
- ⚡ **播放器 UI 优化**：`controller.js`、`components.js`、`fullscreen.js`、`index.js` 细节改进。

## v1.5.3 变更

- 🎰 **盲盒盈亏面板优化**：管理后台盲盒盈亏区域新增折叠/展开功能，改善长页面浏览体验。
- 🧹 **弹幕客户端资源清理**：新增 `MessageHandlers.destroy()` 方法，断开连接时正确清理身份缓存定时器和消息处理器，防止内存泄漏。
- 🔄 **身份缓存定时清理**：`MessageHandlers` 每 5 分钟自动清理过期身份缓存条目，防止无界增长。
- 🎁 **礼物服务精简**：移除已不再需要的 COMBO_SEND 网络乱序处理逻辑（`findRecentComboSendForBuffer`），简化 Combo 缓冲区合并流程。
- ⚙️ **自动更新可控开关**：Electron 主进程新增 `readAutoUpdateSetting()`，从数据库读取 `enableAutoUpdate` 设置项决定是否执行自动更新检查；新增 `desktop:set-auto-update` IPC 通道。
- 🖥️ **管理后台功能增强**：`gifts.js`、`queue.js`、`songs.js` 多项细节优化。
- 🎨 **CSS 样式扩展**：`styles-admin.css`（+219 行）盲盒面板折叠、礼物统计等区域样式增强；`styles-playback.css` 细节调整。
- 🖼️ **盲盒图标资源**：新增 `bilibili-blindbox-heart.png`（爱心盲盒）和 `bilibili-blindbox-lucky.png`（幸运盲盒）图标。
- 📸 **盲盒截图脚本**：新增 `scripts/screenshot-blindbox.mjs`，用于自动截取盲盒面板预览图。
- 💾 **存储层增强**：`settings-store.js` 新增自动更新相关配置项支持。

## v1.5.2 变更

- 📊 **礼物审计页面**：新增 `public/gift-audit.html` 礼物对账/审计页面，支持礼物流水查询、收支核对、异常检测等功能。
- 🛡️ **大航海图标资源**：新增提督/总督/舰长图标（`bilibili-guard-*.png`），提升大航海礼物展示效果。
- 🔌 **Electron 本地媒体协议**：新增 `local-media://` 自定义协议，支持本地音频文件直接播放；新增预关闭 flush 钩子，确保渲染进程播放状态在服务端关闭前持久化。
- 🎁 **礼物服务重大修复**：
  - Combo 缓冲区数值修复：`SEND_GIFT` 合并时改用 `Math.max` 而非累加，避免 Bilibili 发送递增 `combo_num` 时的数值膨胀问题。
  - 网络乱序修复：新增 `findRecentComboSendForBuffer` 处理 `COMBO_SEND` 比 `SEND_GIFT` 先到达 WebSocket 的竞态场景。
- 🎬 **播放器大幅增强**：`playback.js`（+153 行）、`local/manager.js`、`ui/fullscreen.js`（+61 行）、`ui/drawer.js`、`ui/components.js`、`ui/playback-bar.js`、`utils.js` 多处优化和功能增强。
- 🖥️ **管理后台优化**：`admin.html`（+110 行）、`gifts.js`（+296 行）、`main.js`、`queue.js`、`settings.js`、`songs.js` 功能增强。
- 🎨 **CSS 重构**：`styles-admin.css`（+442 行）大幅扩展，`styles-playback.css` 清理冗余。
- ⚡ **Electron 主进程增强**：`main.js`（+148 行）新增本地媒体协议、预关闭钩子等；`preload.js` 增强。
- 🎵 **歌词与歌曲服务优化**：`lyrics.js`（+67 行）、`song-service.js` 改进。
- 🗄️ **存储层优化**：`database.js`、`schema.js`、`settings-store.js`（+61 行）增强。
- 🧹 **清理**：移除过期的 `blivedm-compat.js`、`blivedm-runtime.js` 兼容层。

## v1.5.1 变更

- 🎰 **盲盒盈亏投屏**：新增盲盒盈亏独立投屏页面（`overlay-blindbox.html/js`），支持今日盈亏统计、欧皇排行榜、盈利者筛选、紧凑模式、低功耗模式等参数配置。管理后台「投屏地址」区域新增盲盒盈亏 URL 生成器，可自定义标题、显示人数等参数。
- 🎵 **播放器缓存管理**：新增 `public/js/playback/cache/manager.js` 播放缓存模块，优化播放器性能和资源管理。
- 💽 **唱盘底盘视觉优化**：新增唱盘底盘图片 `player-turntable-chassis.png`，提升播放器视觉效果。
- 🎁 **礼物服务增强**：`gift-service.js` 礼物处理逻辑大幅优化，`gift-parser.js` 和 `gift-routes.js` 细节改进，增强礼物解析和路由稳定性。
- 🖥️ **管理后台优化**：`admin.html` 布局改进（新增盲盒投屏配置区），`display.js`、`gifts.js`、`queue.js`、`settings.js` 多处功能增强和代码优化。
- 🎬 **播放器前端增强**：`playback.js`、`content/loader.js`、`services/home-service.js`、`ui/fullscreen.js` 大量优化，提升播放器交互体验。
- 🎨 **CSS 样式重构**：`styles-admin.css`（+582 行）、`styles-playback.css`（+240 行）大幅增强，配合盲盒投屏和 UI 改进。
- 🔧 **工具函数增强**：`utils.js` 新增多个通用工具函数。
- 🧹 **清理**：移除过期的 `captured-gifts-*.json` 抓包样本文件。

## v1.5.0 变更

- 🎉 **Bilibili 扫码登录支持**（桌面版）：Electron 桌面版新增 Bilibili 账号扫码登录功能，登录后弹幕连接使用账号 Cookie，可在管理后台「账号管理」区域管理登录/退出状态。
  - 新增 `src/electron/bilibili-auth.js`：Bilibili Cookie 管理模块，支持 Cookie 加密持久化存储和恢复。
  - 新增 `src/server/routes/bilibili-routes.js` `/api/bilibili/auth/state` 接口，前端可查询 Bilibili 登录状态。
  - Electron 主进程新增 Bilibili IPC 通道和请求头注入（Referer/Origin）。
  - 服务端重连前自动刷新 Bilibili 登录态缓存，确保弹幕客户端使用最新 Cookie。
- 📋 **歌曲导入导出字段优化**：导出表头更新——「歌手」→「原唱/首发歌手」、「来源平台」→「核对平台」、「备注」→「核对备注」；移除「原始分组」字段；导入别名同步更新以兼容新旧格式。
- 🔧 **礼物抓包脚本大幅增强**：`scripts/capture-gifts.js` 支持 Cookie 文件参数（可登录态抓包）、新增 WebSocket 诊断计数器（帧数、字节数、Brotli/Zlib 解压统计、JSON 解析错误、空闲间隔检测）、实时礼物计数。
- 🎵 音乐服务（song-service、lyrics、网易/QQ 提供商）细节优化。
- 🖥️ 管理后台设置面板新增 Bilibili 登录状态 UI（桌面版）。

---

## v1.4.6 变更

- CSS 样式重构：删除 `styles.css`，样式按组件拆分至 `styles-admin.css`、`styles-playback.css`、`styles-desktop.css`，减少冗余、便于维护。
- 播放助手前端重构：`playback.js` 及子模块（api/client、content/loader、provider/manager、services）大幅优化，提升代码结构和可维护性。
- 礼物诊断与调试功能：新增 debug 路由、礼物消息缓冲区诊断模块、礼物抓取脚本，便于排查 B站 礼物相关问题。
- B站弹幕与礼物模块优化：弹幕消息处理、礼物解析、礼物标准化等模块多处改进，增强稳定性。
- 新增 `captured-gifts-*.json` 礼物抓取样本和 `public/debug-gifts.html` 调试页面。
- 服务端 WebSocket、歌词服务、音乐提供商（网易/QQ）等模块细节优化。

---

## v1.4.5 变更

- 播放助手标签页切换优化和调试功能完善。

---

## v1.4.4 变更

- 播放助手退出登录优化：退出登录后清除前端状态并重新从后端获取最新状态，确保前后端同步，避免状态不一致问题。
- 播放助手退出登录错误处理增强：即使退出登录失败也会尝试刷新状态，提升容错性。
- 音乐首页内容默认数量调整：从 20 条增加到 30 条，提供更丰富的推荐内容。
- 全屏播放器唱针头部金属球样式移除：简化唱针视觉效果，保留唱针臂和针头本体，减少视觉复杂度。

---

## v1.4.3 变更

- 播放助手账号管理布局优化：清理缓存按钮移至账号状态行，与检查接口、登录/退出按钮并排显示，采用单栏布局更紧凑。
- SC 队列文案优化："已辅助"改为"已处理"，"标记辅助/取消辅助"改为"标记已处理/取消处理"，表述更清晰。
- 全屏播放器唱针动画精细化优化：唱针臂更细长（6px 宽，200px 长），金属渐变更精致，阴影层次更丰富，播放状态旋转角度微调（-2deg），暂停抬起角度加大（-26deg），过渡时长延长至 680ms，视觉效果更优雅流畅。
- 全屏播放器唱针头部金属球优化：直径缩小至 32px，径向渐变层次增加，内外阴影更立体，环境反射效果增强。
- 全屏播放器唱针针头优化：宽度减小至 10px，长度增加至 75px，渐变层次更丰富，金属质感更强。
- CSS 资源缓存版本更新：styles-playback.css 更新至 v=20260731-01，playback.js 更新至 v=20260731-03。

---

## v1.4.2 变更

- 播放助手账号管理布局优化：清理缓存按钮移至页头，账号状态与健康检查分行显示，布局更紧凑清晰。
- 播放助手 Provider 状态刷新优化：桌面版优先使用 Electron IPC 获取认证状态和健康状态，提升响应速度。
- 全屏播放器歌词滚动优化：当前歌词定位在屏幕上方 1/3 位置（中间偏上），歌词跟随更符合视觉习惯。
- 全屏播放器歌词滚动修复：移除 smooth 滚动行为，改为直接设置 scrollTop，解决歌词滚动不生效的问题。
- 歌词按钮状态属性统一：从 `windowOpen`/`windowLocked` 改为 `open`/`locked`，代码更简洁。
- 删除过期的 release-notes-1.4.0.md 文件。

---

## v1.4.1 变更

- 版本号更新与小幅修复。

---

## v1.4.0 变更

- 播放助手功能重大升级：新增 QQ 音乐和网易云音乐双平台支持。
- 新增播放助手登录界面：支持 QQ 音乐扫码登录、网易云手机号登录。
- 新增播放助手提供商健康监控：实时检测各平台服务状态，自动切换可用平台。
- 新增播放助手缓存管理：支持清除各平台登录凭证和缓存数据。
- 播放页面重构：账号管理、推荐内容、歌单浏览等功能全面升级。
- 新增全屏播放器：支持唱片旋转动画、歌词滚动、点击跳转播放等交互。
- 新增桌面歌词窗口：独立悬浮窗显示实时歌词。
- 管理后台表单优化：歌曲添加、搜索等功能体验改进。

---

## v1.3.16 变更

- 修复播放助手模块加载时序问题：`playback.js` 改为 ES 模块并在 `main.js` 之后加载，通过自定义事件通知初始化完成，避免模块依赖竞态。
- 移除抽屉/队列弹窗构造函数中的重复事件绑定代码，统一在外部初始化时绑定。
- 更新重启确认弹窗样式：图标改为 SVG 刷新图标，弹窗和遮罩动画优化，采用更现代的卡片样式和配色。
- 修复播放助手模块初始化后 `playbackAuthState` 和 `playbackProviderHealth` 未更新的问题。
- 测试代码重构：支持 ES 模块动态加载，使用 `vm.SourceTextModule` 处理 `playback.js` 及其依赖。

---

## v1.3.15 变更

- 全屏播放器关闭按钮优化：移除背景圆形样式，改为透明圆角矩形，hover 时显示半透明深色背景，图标放大并增加白色投影，提升视觉识别度。
- 全屏播放器交互优化：移除点击背景关闭功能，仅保留关闭按钮和 ESC 键关闭，避免误触。
- 可折叠面板交互优化：SC 队列和快速入队面板的整个 header 区域都可点击展开/收起，提升操作便捷性。
- 弹窗/抽屉/全屏播放器增加 `visibility` 属性切换，配合 `opacity` 和 `transform` 实现更流畅的显示/隐藏过渡效果。

---

## v1.3.14 变更

- 代码重构：admin 相关 JS 文件模块化拆分到 `public/js/admin/` 目录。
- 代码重构：playback 相关 JS 文件模块化拆分到 `public/js/playback/` 目录。
- 代码重构：Bilibili 弹幕客户端代码按功能拆分到 `src/bilibili/danmaku/`、`src/bilibili/parsers/`、`src/bilibili/protocols/`、`src/bilibili/utils/` 目录。

---

## v1.3.13 变更

- 全屏播放器新增唱片机唱针动画：播放时唱针落下，暂停时抬起，支持渐变金属质感渲染。
- 全屏播放器唱片旋转优化：暂停时保留当前角度不归零，恢复播放时从当前位置继续旋转。
- 全屏播放器新增空格键播放/暂停快捷键。
- 全屏播放器打开时禁用标题栏拖拽区域，避免误操作。
- 桌面歌词按钮图标优化：关闭状态显示斜杠禁用图标，开启状态显示高亮圆点，激活态增加粉色描边发光效果。
- 窗口关闭按钮图标从爱心改回叉号（X）。
- 抽屉"换一批"按钮从底部移至头部右侧，仅在推荐/每日/电台内容时显示。
- 播放页面账号状态根据登录态动态切换显示登录/退出按钮。
- 修复 `/lyrics` 路由映射，确保桌面歌词窗口正常访问 `lyric-window.html`。

---

## v1.3.12 变更

- QQ 音乐「为你推荐」「每日推荐」改用真实客户端接口 `RecommendFeed`（推荐 Feed），替代旧的网页抓取 / 热门推荐接口，每日推荐支持批量拉取完整歌曲信息（含 mid）。
- QQ 音乐电台连续多轮拉取并去重，凑够请求数量后再返回，避免一次请求歌曲不够。
- 网易云「每日推荐」「私人电台」支持分页换一批，超出列表末尾自动绕回开头。
- 全屏歌词支持点击任意一行跳转播放（悬浮显示播放按钮）。
- 全屏播放器背景改为直接展示彩色渐变，移除白色遮罩层。
- 全屏播放器新增点击背景关闭、ESC 键关闭，小屏幕下关闭按钮加大。
- 播放首页推荐/每日/电台内容新增"换一批"按钮。
- 新增 `scripts/publish-release.js` 规范发布流程，替代直接调用 `electron-builder --publish always`（见 `RELEASE_GUIDE.md`）。
- `tools/qq-music-analyzer`：HAR 解析支持 BOM 去除、POST body 提取、`musics.fcg` 请求识别；新增若干抓包分析辅助脚本。

---

## v1.3.11 变更

- 歌单模式队列弹窗改为展示完整曲目列表，当前播放行高亮、已播行灰显，可点击任意行直接跳转播放；打开弹窗时自动滚动到当前行。
- 歌单曲目加载上限从 50 提升至 1000，QQ 音乐和网易云同步调整。
- 音乐页账号面板整合入页头：去掉独立的"当前账号"面板，登录状态、登录/退出按钮、缓存管理移至页头右侧紧凑区，音乐页切换为单栏布局。
- 窗口控制按钮图标优化：最小化改为圆角横线，最大化方框加圆角，关闭按钮改为爱心形状；hover/active 颜色改为粉色系，过渡添加 scale 动画。
- 数据库启动优化：新增 `schema_version` 表，迁移操作改为版本号守护，避免重复执行；SQLite pragma 增加 `synchronous=NORMAL`、`cache_size=-8000`、`temp_store=MEMORY` 性能配置；关闭前执行 `PRAGMA optimize`；迁移完成后自动删除遗留 `super_chats` 表。
- `getSettings()` 添加内存缓存，写入时失效，减少重复查库。
- 重构：`deleteSong` / `toggleSong` / `countSongs` 移入 `song-service`，domain-services 不再内联 SQL；Bilibili 消息处理通过 `context.pickRandomSong` 访问歌库，不直接持有 DB 句柄；提取 `replaceBilibiliClient` 消除 configure/reconnect 重复代码。

---

## v1.3.10 变更

- 播放队列类型统一：移除"优先队列"概念，改为直接插入到队列头部。
- 禁用差量更新（delta update），改为全量下发队列快照，解决差量同步偏移问题。

---

## v1.3.9 变更

- 切换为无边框窗口（frameless），自定义标题栏与窗口控制按钮。
- 全局 Emoji 替换为 SVG 图标，界面更现代一致。
- 播放器支持停靠展开（dock expand）模式。
- 新增窗口最小化 / 最大化 / 还原控制按钮。

---

## v1.3.8 变更

- 播放队列改为悬浮弹窗，点击控制栏队列图标展开/关闭，不占用页面空间。
- 歌单播完后自动从头循环（`normalQueueTracks` 备份完整歌单）。
- 新增展示用播放历史：最近 200 首，自动去重、最新置顶，可在抽屉「最近播放」查看及清空。
- 安装更新前弹出自定义确认对话框，替换原生浏览器 `confirm`。
- 队列标题根据当前模式动态显示「歌单队列」/「电台队列」/「播放队列」。

---

## v1.3.7 变更

- 将 `styles.css` 拆分为 `styles-base` / `styles-admin` / `styles-playback` / `styles-desktop` / `styles-overlay` 多文件，按需加载。
- 新增点歌确认悬浮通知弹窗（`pendingConfirmPopup`），弹幕点歌后在管理页实时提示。
- `play-all` / `shuffle-all` 改为立即清空队列并开始播放，不再追加到队列末尾。
- QQ 音乐「最近播放」：优先尝试 `musicu GlobalChannelSvr` 新 API，失败后自动 fallback 旧接口。

---

## v1.3.6 变更

- `admin.js` 重构：代码按功能分区（导入 / 全局状态 / 初始化 / 导航 / 表单）并模块化拆分，引入 `AdminApp` 命名空间。
- 播放队列行样式升级：去硬边框改为阴影卡片，hover 背景变换，正在播放行采用暖色渐变 + 粉色光晕。
- 叠加层 URL 生成修复：将 `127.0.0.1` 自动替换为 `localhost`，解决部分场景无法访问的问题。
- 新增性能监控面板（可切换开关 + 手动刷新）。
- QQ 音乐最近播放接口更新。

---

## v1.3.5 变更

- UI 样式细节优化。
- QQ 音乐平台图标改用 PNG 文件替代内联图形。

---

## v1.3.4 变更

- 播放器 UI 全面图标化：播放/暂停、上下曲、播放模式、桌面歌词、锁定、音量均改用 SVG 图标，视觉更现代。
- 新增右侧滑出抽屉面板：点击为你推荐、每日推荐、我喜欢等卡片时，内容从右侧抽屉滑入展示，替代原来的下方加载方式；支持歌单浏览与返回导航，底部提供播放全部/随机播放快捷操作。
- 播放队列面板自动撑满可用高度，不再出现下方大片空白。
- 进度条和音量条采用渐变填充样式，拖拽手感优化。
- 移动端响应式适配抽屉全宽展示。

---

## v1.3.3 变更

**QQ 音乐 Provider 全面升级**
- 实现所有歌单/推荐接口：个性化推荐、每日推荐、心动电台、我喜欢、我的歌单、收藏歌单、最近播放、歌单详情。
- 新增 `requestMusicu` / `requestText` / `buildHeaders` 等通用请求辅助方法。
- 优化歌曲与歌单字段映射，兼容更多 API 返回格式；改进封面图提取逻辑，支持多种图片来源。
- 统一错误提示文案格式。

**播放页面视觉增强**
- 歌单列表、搜索结果、队列行新增专辑封面缩略图。
- 当前播放封面支持远程图片展示。
- 优化播放页面入口卡片文案。
- 移除本地音频文件上传功能。

**新增 5 套点歌板预设主题**
- 陶土侘寂（terracotta）、珊瑚海礁（coral）、墨香宣纸（ink）、工业灰调（slate）、勃艮第醇（burgundy）。

**界面优化**
- 歌曲表单按钮改为双列布局；新增表单与搜索之间的分隔线。
- 队列「固定 6 首歌高度」设置独立展示。
- 状态栏按钮样式优化；移除动态页面标题。

**问题修复**
- 修复点歌板同步主题开关在首次加载时误读未定义值的问题。
- 修复叠加层 URL 在 127.0.0.1 环境下无法访问的问题。
- 修复服务关闭时 blivedm 兼容性检查回调可能访问已销毁状态的问题。

---

## v1.3.2 变更

- 版本号更新，`package.json` 元数据修正。
- 小幅 `admin.js` 修复。

---

## v1.3.1 变更

- 修复重构后 `desktopActionErrorMessage` 函数缺失导致桌面端页面崩溃的回退问题。
- 重新设计关机/退出页面：卡片布局、状态检查列表、平台适配操作按钮。
- 新增 `desktop:restart` IPC，支持一键重启应用（Electron）。
- 新增 `desktop:close-window` IPC，支持干净关闭窗口（Electron）。
- 更新 CSS/JS 资源缓存版本字符串。

---

## v1.3.0 变更

**架构重构 — 代码模块化**
- 从 monolithic `server.js`（5315 行）和 `electron/main.js`（778 行）中拆出 25+ 独立模块。
- 新增模块：`shared/utils`、`storage/database`、`storage/settings-store`、`music/song-service`、`music/queue-service`、`music/lyrics-service`、`music/music-cache`、`music/stream-resolver`、`music/provider-health`、`bilibili/bilibili-message-handler`、`bilibili/superchat-service`、`bilibili/gift-service`、`bilibili/blivedm-compat`、`bilibili/danmaku-client`、`bilibili/helpers`、`bilibili/wbi-signer`、`bilibili/packet-parser`、`server/api-routes`、`server/http-utils`、`server/ws`。
- Electron 模块：`auth-manager`、`login-window`、`lyric-window`、`update-manager`。
- 前端模块：`public/js/utils`、`public/js/theme`、`public/js/playback`、`public/js/desktop`。
- 重构后：`server.js` 缩减至约 3300 行，`electron/main.js` 缩减至 328 行。
- 所有既有功能零回退保留。

---

## v1.2.4 变更

- 礼物冲刺面板：直播连接但未开播时区分显示状态文案，避免误以为礼物监听正常。
- 修复礼物通知重复：同 ID 不同 num/price 的 combo 阶段不再被误过滤。
- blivedm 兼容检查正则覆盖 `COMBO_SEND` 等非 `GIFT` 前缀命令，避免漏检测。
- 完善开放平台礼物解析：优先使用 `r_price` 作为实际支付价格，兼容打折礼物。
- 完善大航海上舰解析：兼容 `guard_unit` 非标准单位（如 `x3天`）。

---

## v1.2.3 变更

- 修复直播间已连接但点歌来源仍为历史补偿的问题：WebSocket 连接成功后停止历史轮询，仅未开播或断线时启用历史兜底。
- 弹幕长连断开时自动切换历史轮询，不再空等重连。
- 手动刷新直播时若房间已开播则清除历史轮询，确保切回实时弹幕。

---

## v1.2.2 变更

- 启动时自动检查 blivedm 最新礼物协议，未覆盖的 CMD 纳入运行时识别与日志告警。
- 新增 `GUARD_BUY` / `USER_TOAST_MSG` / `LIVE_OPEN_PLATFORM_SEND_GIFT` / `LIVE_OPEN_PLATFORM_GUARD` 等礼物事件解析。
- 礼物事件去重时自动合并 combo 进度（num/total_price 增长时更新记录）。
- 未识别的礼物类 CMD 写入控制台告警，方便后续适配新协议。
- 前端新增 blivedm 协议兼容性状态指示。
- 修复刷新直播后不重绘整个状态页的问题。

---

## v1.2.1 变更

- 优化刷新直播错误提示，连接失败时给出具体原因。
- 礼物冲刺面板联动直播间连接状态，收到新礼物时弹出通知。
- 修复 API 请求在非 JSON 响应时静默失败的问题。
- 手动重连改为异步等待连接结果，超时控制更稳健。

---

## v1.2.0 变更

- 点歌回落（fallback 搜索）不再保存到本地歌库，仅搜索平台并加入播放列表下一首。
- 新增「刷新直播」按钮，强制重连 Bilibili 弹幕服务，不丢失队列数据。
- `configureBilibiliListener` 支持 `force` 参数，区分主动重连与静默跳过逻辑。

---

## v1.1.4 变更

- 队列布局独立控制：新增「固定 6 行高度」开关，点歌板风格 1 可切换固定/自适应高度；滚动模式/速率移入风格 1 专属区。
- 修复弹幕/SC 触发强制刷新时序问题：queue:add / bilibili:danmaku / bilibili:superchat 到达后延迟 80ms reload，避免 WebSocket 快照乱序导致 UI 错乱。
- 更新应用图标。

---

## v1.1.3 变更

- 预设从 11 种扩展至 14 种：新增「纯透极简」「翡翠深林」「丝绒玫瑰」，替换「银霜冰晶」；纯透极简放首位，白色透明背景，零模糊零发光零渐变，最干净 OBS 叠加效果。
- 字体选项从 7 种增加至 14 种：新增思源黑体、幼圆、隶书、Georgia、等宽、琥珀体、手札体。
- 所有预设滚动速率默认值统一为 80，含全局默认和迁移兜底。
- 歌单展示板同步新增对应预设。

---

## v1.1.2 变更

- 管理端点歌队列中，第 1 位未置顶歌曲不再显示"置顶"按钮；如果第 1 位已经置顶，仍显示"取消置顶"。

---

## v1.1.1 变更

- 删除项目内需求路线图文档及 `start.bat` / `stop.bat` 脚本，精简仓库。
- 修复叠加层版本号。

---

## v1.1.0 变更

- 默认启用 Bilibili 监听，点歌冷却时间默认改为 0s。
- 展示板默认启用往返滚动，滚动速率默认值改为 100。
- 点歌板序号/渐变/面板/滚动方式四区对齐修复。
- `festival` → `identity` 全局改名（风格 2 内部标识修正）。
- 规则 2 默认值改为「支持随机点歌」，规则 6 颜色由白色改为橙色 `#f97316`。
- 向后兼容旧 `festival` 设置值。

---

## v1.0.1 变更

- 自动更新相关提示文案更新；GitHub 发布仓库同步为 `AuroraWhisperer/Request-song`。
- 固定 Electron runtime 为 43.2.0，避免版本浮动导致重复下载。
- 改进桌面端更新通知的展示逻辑。

---

## v1.0.0 变更

- 初始发布：Bilibili 直播点歌助手 Electron 桌面应用。
- 支持弹幕点歌（`点歌 xxx` / `随机`）、OBS 叠加层（队列/歌单展示板）、GitHub 自动更新。

---

## 本机打包

```powershell
npm.cmd install
npm.cmd run dist:win
```

生成文件在 `release/`：

```text
bilibili-live-song-plugin-setup-1.3.12.exe
bilibili-live-song-plugin-setup-1.3.12.exe.blockmap
latest.yml
```

## 发布 GitHub 自动更新

GitHub 自动更新依赖 Releases。发布新版本时，先修改 `package.json` 里的 `version`，再运行：

```powershell
npm.cmd run release:win
```

如果手动上传 Release，必须把安装包、同名 `.blockmap` 和 `latest.yml` 一起上传到 `AuroraWhisperer/Request-song` 的同一个 Release。

桌面版"桌面更新"页会读取 `latest.yml`，发现新版本后优先通过 `.blockmap` 差分下载变化部分，并提示应用更新。
