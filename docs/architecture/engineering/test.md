# 测试策略

> 涉及文件:[package.json](../../../package.json)(测试与验证脚本)、[test/](../../../test/)、[scripts/check-js.js](../../../scripts/check-js.js)、[scripts/inspect-wesing-playback.js](../../../scripts/inspect-wesing-playback.js)、[scripts/capture-bilibili-events.js](../../../scripts/capture-bilibili-events.js)、[scripts/bilibili-capture-electron/](../../../scripts/bilibili-capture-electron/)

本文档是测试的**唯一事实源**:测试框架与命令、全部测试文件的清单与归属、静态检查、专用诊断、辅助捕获脚本均只在此成表。构建/发布相关命令见 [build.md](build.md)。

## 1. 框架与命令

- **框架**:Node 内置 `node:test` + `node:assert/strict`,**零第三方测试依赖**([package.json](../../../package.json));测试文件全部基于 `node:test`。
- **全量运行**:`npm test` = `node --experimental-vm-modules --test --test-concurrency=4` — **并发数 4**。
- **文档门禁**:`npm run verify:docs` 检查治理文件、相对链接、AI 路由表和规格索引。
- **架构门禁**:`npm run verify:architecture` 运行模块边界、遗留债务预算与前端 ESM 边界测试。
- **快速门禁**:`npm run verify:quick` 按文档 → 语法 → 架构顺序运行,用于日常评审前反馈。
- **完整门禁**:`npm run verify` 先运行快速门禁,再运行 `npm test`;全量测试再次发现定向测试属于可接受的有限重复。
- **为什么需要 `--experimental-vm-modules`**:源码以 CJS(`require`)为主,但多个前端测试会通过 `vm.SourceTextModule` 或动态 `import()` 加载 `public/js/` 下的 ESM 模块;去掉该 flag 这些测试会失败。
- **单文件运行**:`node --experimental-vm-modules --test test/xxx.test.js`(flag 必须保留)。
- **测试方式**:以离线单元和集成测试为主,不访问真实外部网络;服务端模块直接 require 真实实现并注入临时 SQLite 目录或 mock,server smoke 类测试会在随机本地端口启动完整服务;浏览器模块用 vm + 假 `window`/`localStorage` 求值。

## 2. 测试清单(唯一成表处,按簇分组)

| 测试文件 | 被测模块 | 覆盖文档 |
|---|---|---|
| **治理与架构** | | [modularity-standard.md](modularity-standard.md) + [ai-workflow.md](ai-workflow.md) |
| [governance-docs.test.js](../../../test/governance-docs.test.js) | 治理文件、路由表、规格索引与范围内 Markdown 链接 | 同上 + [legacy-boundaries.md](legacy-boundaries.md) |
| **AI 助手** | | [backend/ai.md](../backend/ai.md) |
| [ai-api-quota-store.test.js](../../../test/ai-api-quota-store.test.js) | `ai/api-quota-store`(配额存储) | 同上 |
| [ai-config-store.test.js](../../../test/ai-config-store.test.js) | `ai/config-store`(配置存储) | 同上 |
| [ai-danmaku-delivery-verifier.test.js](../../../test/ai-danmaku-delivery-verifier.test.js) | `ai/danmaku-delivery-verifier`(投递校验) | 同上 |
| [ai-provider-adapters.test.js](../../../test/ai-provider-adapters.test.js) | `ai/deepseek-client`(Provider 适配) | 同上 |
| [ai-request-logger.test.js](../../../test/ai-request-logger.test.js) | `ai/request-logger`(请求日志) | 同上 |
| [ai-routes.test.js](../../../test/ai-routes.test.js) | `server/routes/ai-routes`(API 路由) | 同上 + [backend/api.md](../backend/api.md) |
| [ai-safety.test.js](../../../test/ai-safety.test.js) | `ai/safety`(输出安全审查) | 同上 |
| [ai-web-search-tool.test.js](../../../test/ai-web-search-tool.test.js) | `ai/tools/web-search-tool`(联网搜索工具) | 同上 |
| [frontend-admin-ai.test.js](../../../test/frontend-admin-ai.test.js) | Admin 弹幕工具与 AI 互动助手配置 UI | 同上 + [frontend/app.md](../frontend/app.md) |
| [ai-assistant-service.test.js](../../../test/ai-assistant-service.test.js) | `ai/ai-assistant-service`(服务编排) | 同上 |
| **Bilibili 弹幕/协议** | | [backend/bilibili/danmaku.md](../backend/bilibili/danmaku.md) |
| [bilibili-danmaku-send.test.js](../../../test/bilibili-danmaku-send.test.js) | `bilibili/danmaku/api-client`(发弹幕) | 同上 |
| [bilibili-identity-cache.test.js](../../../test/bilibili-identity-cache.test.js) | `bilibili/danmaku/identity-cache`(身份缓存) | 同上 |
| [bilibili-message-log.test.js](../../../test/bilibili-message-log.test.js) | `bilibili/bilibili-message-handler`(消息日志格式) | 同上 |
| [bilibili-runtime.test.js](../../../test/bilibili-runtime.test.js) | `server/bilibili-runtime` 的认证缓存、客户端替换与关闭所有权 | [backend/server-core.md](../backend/server-core.md) |
| [bilibili-user-meta.test.js](../../../test/bilibili-user-meta.test.js) | `bilibili/utils/user-meta-extractor`(用户信息提取) | 同上 |
| [checkin-service.test.js](../../../test/checkin-service.test.js) | `bilibili/checkin-service`(签到) | 同上 |
| [custom-reply-service.test.js](../../../test/custom-reply-service.test.js) | `bilibili/danmaku/command-text`(自定义回复) | 同上 |
| [danmaku-client.test.js](../../../test/danmaku-client.test.js) | `bilibili/danmaku-client`(主客户端) | 同上 |
| [danmaku-sender-service.test.js](../../../test/danmaku-sender-service.test.js) | `bilibili/danmaku/sender-service`(弹幕发送服务) | 同上 |
| [fortune-service.test.js](../../../test/fortune-service.test.js) | `bilibili/fortune-service`(运势) | 同上 |
| [message-deduplicator.test.js](../../../test/message-deduplicator.test.js) | `bilibili/danmaku/message-deduplicator`(去重) | 同上 |
| [packet-decoder.test.js](../../../test/packet-decoder.test.js) | `bilibili/parsers/packet-decoder`(恶意/损坏数据包边界) | [backend/bilibili/protocol.md](../backend/bilibili/protocol.md) |
| [websocket-connection.test.js](../../../test/websocket-connection.test.js) | `bilibili/danmaku/websocket-connection`(WS 连接) | 同上 |
| **礼物** | | [backend/bilibili/gift.md](../backend/bilibili/gift.md) |
| [capture-bilibili-events.test.js](../../../test/capture-bilibili-events.test.js) | `scripts/capture-bilibili-events`(捕获工具,见 §5) | 同上 |
| [gift-analysis-service.test.js](../../../test/gift-analysis-service.test.js) | 盲盒统计、筛选、分页与 V2/V3 数据兼容 | 同上 |
| [gift-audit-page.test.js](../../../test/gift-audit-page.test.js) | 礼物审计页组成与离线分析 | 同上 + [frontend/pages.md](../frontend/pages.md) |
| [gift-capture-service.test.js](../../../test/gift-capture-service.test.js) | 礼物组合进度、定时落库与去重 | 同上 |
| [gift-detection-service.test.js](../../../test/gift-detection-service.test.js) | `bilibili/gift`(礼物检测核心) | 同上 |
| [gift-diagnostics-wiring.test.js](../../../test/gift-diagnostics-wiring.test.js) | `electron/preload`+`main`+`public/js/admin/gifts/notification`(源码装配断言) | 同上 + [desktop/main.md](../desktop/main.md) |
| [gift-effect-config.test.js](../../../test/gift-effect-config.test.js) | 礼物特效配置拉取、缓存、URL 信任边界与事件构造 | 同上 |
| [gift-effects-overlay.test.js](../../../test/gift-effects-overlay.test.js) | 礼物特效 API、管理工具与 OBS 透明叠加层 | 同上 + [frontend/overlays.md](../frontend/overlays.md) |
| [gift-log.test.js](../../../test/gift-log.test.js) | `bilibili/danmaku/message-handlers`(礼物日志) | 同上 |
| [guard-gift.test.js](../../../test/guard-gift.test.js) | `bilibili/packet-parser`(舰队/守护礼物) | 同上 |
| **音乐服务** | | [backend/music/services.md](../backend/music/services.md) |
| [lyrics.test.js](../../../test/lyrics.test.js) | `music/lyrics`(歌词解析) | 同上 |
| [netease-provider.test.js](../../../test/netease-provider.test.js) | `music/providers/netease-provider` | [backend/music/netease.md](../backend/music/netease-provider.md) |
| [qq-provider.test.js](../../../test/qq-provider.test.js) | `music/providers/qq-provider` | [backend/music/qq.md](../backend/music/qq-provider.md) |
| [queue-service.test.js](../../../test/queue-service.test.js) | `music/queue-service`(点歌队列) | 同上(music-services) |
| [random-song-filter.test.js](../../../test/random-song-filter.test.js) | `music/random-song-filter`(随机筛选) | 同上 |
| [song-file-codec.test.js](../../../test/song-file-codec.test.js) | `music/song-file-codec`(文件编码) | 同上 |
| [song-request-autocomplete.test.js](../../../test/song-request-autocomplete.test.js) | `music/song-service`(歌单补全) | 同上 |
| [tag-aliases.test.js](../../../test/tag-aliases.test.js) | `music/tag-aliases`(标签别名) | 同上 |
| **全民 K 歌** | | [backend/music/wesing.md](../backend/music/wesing.md) |
| [wesing-capture.test.js](../../../test/wesing-capture.test.js) | `music/wesing-capture`(窗口采样) | 同上 |
| [wesing-capture-recording-mode.test.js](../../../test/wesing-capture-recording-mode.test.js) | `music/wesing-capture`(录制模式) | 同上 |
| [wesing-online-lyrics.test.js](../../../test/wesing-online-lyrics.test.js) | `music/wesing-online-lyrics`(在线歌词) | 同上 |
| [wesing-playback-diagnostic.test.js](../../../test/wesing-playback-diagnostic.test.js) | `scripts/inspect-wesing-playback`(诊断脚本,见 §4) | 同上 |
| [wesing-routes.test.js](../../../test/wesing-routes.test.js) | `server/routes`(wesing API 路由) | 同上 + [backend/api.md](../backend/api.md) |
| **加班机** | | [backend/overtime.md](../backend/overtime.md) |
| [overtime-service.test.js](../../../test/overtime-service.test.js) | `src/overtime`(加班机服务) | 同上 |
| [overtime-routes.test.js](../../../test/overtime-routes.test.js) | `server/routes`(加班机 API) | 同上 + [backend/api.md](../backend/api.md) |
| [overtime-rule-editor.test.js](../../../test/overtime-rule-editor.test.js) | 加班机礼物规则编辑器模块边界 | 同上 + [frontend/app.md](../frontend/app.md) |
| [overtime-overlay.test.js](../../../test/overtime-overlay.test.js) | `public/pages/overlays/overtime.html`+js/css(叠加层) | 同上 + [frontend/pages.md](../frontend/pages.md) |
| **服务器核心** | | [backend/server-core.md](../backend/server-core.md) |
| [admin-page-composition.test.js](../../../test/admin-page-composition.test.js) | Admin HTML 分片组合顺序、完整性与 token 注入 | 同上 + [frontend/pages.md](../frontend/pages.md) |
| [server-lifecycle.test.js](../../../test/server-lifecycle.test.js) | `server/lifecycle`(端口/生命周期) | 同上 |
| [server-modules.test.js](../../../test/server-modules.test.js) | 服务兼容层与 API Context 模块边界 | 同上 |
| [server-smoke.test.js](../../../test/server-smoke.test.js) | `src/server`(端到端冒烟) | 同上 + [backend/api.md](../backend/api.md) |
| [module-boundaries.test.js](../../../test/module-boundaries.test.js) | 持久化、Admin、播放、组合根和 shared 工具的架构适应度函数 | [modularity-standard.md](modularity-standard.md) |
| [websocket-transport.test.js](../../../test/websocket-transport.test.js) | `server/ws`(WS 传输) | [backend/ws.md](../backend/ws.md) |
| **桌面层** | | 见各列 |
| [bilibili-login-window.test.js](../../../test/bilibili-login-window.test.js) | `electron/bilibili-login-window`(登录窗口) | [desktop/auth.md](../desktop/auth.md) |
| [bilibili-startup-wiring.test.js](../../../test/bilibili-startup-wiring.test.js) | `server.js`+`electron/main.js`(启动装配断言) | [backend/server-core.md](../backend/server-core.md) + [desktop/main.md](../desktop/main.md) |
| [desktop-lyrics.test.js](../../../test/desktop-lyrics.test.js) | `music/lyric-state`(歌词窗口状态) | [frontend/playback.md](../frontend/playback.md) |
| [desktop-state.test.js](../../../test/desktop-state.test.js) | Electron 主进程运行时状态隔离 | [desktop/main.md](../desktop/main.md) |
| [electron-main-modules.test.js](../../../test/electron-main-modules.test.js) | Electron server runtime 适配与 `local-media://` 协议 | [desktop/main.md](../desktop/main.md) |
| [local-media-access.test.js](../../../test/local-media-access.test.js) | `electron/local-media-access`(local-media:// 协议) | [desktop/main.md](../desktop/main.md) |
| [playback-flush.test.js](../../../test/playback-flush.test.js) | `electron/playback-flush`(播放状态落盘) | [backend/storage.md](../backend/storage.md) + [desktop/main.md](../desktop/main.md) |
| [terminal-log.test.js](../../../test/terminal-log.test.js) | `electron/terminal-log`(终端日志) | [desktop/main.md](../desktop/main.md) |
| [update-manager.test.js](../../../test/update-manager.test.js) | `electron/update-manager`(自动更新) | [desktop/update.md](../desktop/update.md) |
| **存储** | | [backend/storage.md](../backend/storage.md) |
| [cooldown-store.test.js](../../../test/cooldown-store.test.js) | 冷却 Map 的过期剪枝 | 同上 |
| [database-maintenance.test.js](../../../test/database-maintenance.test.js) | 全量清理的删除计数与队列处理 | 同上 |
| [playback-store.test.js](../../../test/playback-store.test.js) | `storage/playback-store`(播放状态库) | 同上 |
| [superchat-store.test.js](../../../test/superchat-store.test.js) | `storage/superchat-store` 的 SQLite 映射与领域对象契约 | 同上 |
| **前端** | | 见各列 |
| [esm-module-boundaries.test.js](../../../test/esm-module-boundaries.test.js) | `public/js/` ESM 未声明标识符边界审计 | [frontend/app.md](../frontend/app.md) |
| [frontend-admin-shell.test.js](../../../test/frontend-admin-shell.test.js) | Admin 外壳、工具箱、布局、主题与初始化回归 | [frontend/app.md](../frontend/app.md) |
| [frontend-gifts.test.js](../../../test/frontend-gifts.test.js) | 礼物、盲盒、历史记录与礼物样式回归 | [frontend/app.md](../frontend/app.md) + [frontend/overlays.md](../frontend/overlays.md) |
| [frontend-playback.test.js](../../../test/frontend-playback.test.js) | 全屏歌词、收藏分页与播放搜索竞态 | [frontend/playback.md](../frontend/playback.md) |
| [frontend-queue.test.js](../../../test/frontend-queue.test.js) | 队列叠加层、加班机 UI 和滚动/尺寸边界 | [frontend/overlays.md](../frontend/overlays.md) |
| [frontend-song-board.test.js](../../../test/frontend-song-board.test.js) | 歌单展示板字号、视口与滚动速率 | [frontend/pages.md](../frontend/pages.md) |
| [playback-cache.test.js](../../../test/playback-cache.test.js) | `public/js`(个人歌单缓存 CacheManager) | [frontend/playback.md](../frontend/playback.md) |
| [playback-layering.test.js](../../../test/playback-layering.test.js) | `public/css/playback/*`(播放页 CSS 分层) | 同上 |
| [playback-persistence.test.js](../../../test/playback-persistence.test.js) | 播放队列、进度、Provider 与关闭刷新持久化 | 同上 + [backend/storage.md](../backend/storage.md) |
| [playback-provider-operations.test.js](../../../test/playback-provider-operations.test.js) | Provider 操作的选中音源语义 | 同上 |
| [playback-queue-behavior.test.js](../../../test/playback-queue-behavior.test.js) | 歌单、电台、搜索直播与历史队列行为 | 同上 |
| [playback-track-menu.test.js](../../../test/playback-track-menu.test.js) | `public/js`(播放页曲目菜单) | 同上 |
| [playback-wesing.test.js](../../../test/playback-wesing.test.js) | `public/js`(播放器全民 K 歌集成) | 同上 |
| [provider-manager.test.js](../../../test/provider-manager.test.js) | `public/js`(Provider 状态管理) | [frontend/pages.md](../frontend/pages.md) |
| [queue-overlay-esm.test.js](../../../test/queue-overlay-esm.test.js) | 队列叠加层真实 ESM 依赖图与渲染路径 | [frontend/overlays.md](../frontend/overlays.md) |
| [queue-overlay-responsive.test.js](../../../test/queue-overlay-responsive.test.js) | `public`(队列叠加层响应式) | 同上 |
| [song-library-filter.test.js](../../../test/song-library-filter.test.js) | `public/js` + `storage/database`(歌单筛选) | 同上 + [backend/storage.md](../backend/storage.md) |
| [song-library-filter-menu.test.js](../../../test/song-library-filter-menu.test.js) | `public/js`(筛选菜单) | 同上 |
| [toolbox-sidebar.test.js](../../../test/toolbox-sidebar.test.js) | `public/js`(工具箱侧栏) | 同上 |
| [toolbox-todo.test.js](../../../test/toolbox-todo.test.js) | `public/js`(工具箱待办) | 同上 |

## 3. 静态检查:npm run check

- 命令:`npm run check` → `node scripts/check-js.js`([package.json:12](../../../package.json#L12))。
- 行为:递归收集 `src/`、`public/`、`scripts/`、`test/` 下全部 `.js` 文件([check-js.js:8-25](../../../scripts/check-js.js#L8-L25)),逐个 `node --check` 做**语法校验**([check-js.js:27-32](../../../scripts/check-js.js#L27-L32));任一文件失败立即中止并以对应状态码退出,全部通过时输出文件总数。
- 边界:**仅查语法**,不做类型检查、模块导入一致性或风格检查(旧文档的描述不准确)。
- 日常评审前运行 `npm run verify:quick`;完成前运行 `npm run verify`。

## 4. 专用诊断:diagnose:wesing

- 命令:`npm run diagnose:wesing` → `node scripts/inspect-wesing-playback.js`([package.json:14](../../../package.json#L14));Windows 便捷包装 [scripts/inspect-wesing-playback.cmd](../../../scripts/inspect-wesing-playback.cmd)(chcp 65001、运行后 pause)。
- 用途:现场诊断全民 K 歌播放状态识别问题。同时抓两条数据流 — PowerShell 窗口采样(`createPowerShellWeSingMonitor`:标题/进度/audioActive 等,250ms 轮询)与 WeSingCache 日志 tail(UTF-16LE,轮询最新 .log 的新增字节),并解析 `StartKSong` 行提取 mid/歌名([inspect-wesing-playback.js:154-162](../../../scripts/inspect-wesing-playback.js#L154-L162))。
- 交互:启动后在全民 K 歌执行动作并按键打标 — `1` 点击 K 歌/开始录制、`2` 暂停、`3` 继续、`4` 退出录制、`5` 重新进入同一首歌、`6` 歌词状态不正确;`q`/Ctrl+C 结束。JSONL 落盘 `logs/wesing-playback-diagnostic-{时间戳}.jsonl`(含 diagnostic-start/monitor-sample/wesing-log-line/user-marker/diagnostic-stop 事件)。
- 参数:`--cache <WeSingCache 目录>`(缺省时经 `/api/music/wesing/status` 从运行中的服务读取,[inspect-wesing-playback.js:96-126](../../../scripts/inspect-wesing-playback.js#L96-L126))、`--output <文件>`、`--duration <秒>`(1-3600)、`--help`。
- 配套测试:[wesing-playback-diagnostic.test.js](../../../test/wesing-playback-diagnostic.test.js);数据流细节见 [backend/music/wesing.md](../backend/music/wesing.md)。

## 5. 其他辅助脚本:独立弹幕捕获

- [scripts/capture-bilibili-events.js](../../../scripts/capture-bilibili-events.js):独立捕获工具 — 用生产代码(`BilibiliApiClient` + `WebSocketConnection` + `packet-parser`)直连房间弹幕,解析后的原始消息以 NDJSON 写入 `tmp/bilibili-events-{时间戳}.ndjson`(`meta`/`event`/`summary` 三种行,[capture-bilibili-events.js:155-167](../../../scripts/capture-bilibili-events.js#L155-L167))。
- 参数:`--room <房间号>`(必填)、`--duration <秒>`(默认 300)、`--output <路径>`、`--gift-only`(仅礼物类命令)、`--bilibili-user-data <Electron userData>`;另支持环境变量 `BILIBILI_COOKIE`/`BILIBILI_UID`。
- 登录态捕获:`--bilibili-user-data` 需以 Electron 运行 — 入口 [scripts/bilibili-capture-electron/index.js](../../../scripts/bilibili-capture-electron/index.js)(目录内私有 package.json),复用桌面端保存的 Bilibili 登录注入 Cookie([capture-bilibili-events.js:177-198](../../../scripts/capture-bilibili-events.js#L177-L198))。
- 配套测试:[capture-bilibili-events.test.js](../../../test/capture-bilibili-events.test.js)(参数解析与消息过滤,离线)。

## 6. 测试约定

- **命名与布局**:所有 `*.test.js` 平铺在 `test/` 根目录;`test/helpers/` 仅存放共享测试辅助模块。测试文件使用 `xxx.test.js` 命名,对应 `src/xxx.js`、`public/` 资源或 `scripts/xxx.js` 的行为契约。
- **新增测试**:服务端模块直接 require 真实实现(内存 DB / mock 注入);浏览器模块用 vm 求值,测试间不共享全局状态;新增文件后 `npm run check` 仍须通过(check 覆盖 `test/` 目录)。
- **运行单个文件**:`node --experimental-vm-modules --test test/xxx.test.js`(见 §1)。
