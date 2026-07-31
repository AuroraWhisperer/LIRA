# 打包与更新说明

当前版本：`1.5.1`

---

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
