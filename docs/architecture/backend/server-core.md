# 后端核心:HTTP 服务与进程生命周期

> 涉及文件:[src/server.js](../../../src/server.js)、[src/server/lifecycle.js](../../../src/server/lifecycle.js)、[src/server/http-utils.js](../../../src/server/http-utils.js)、[src/server/api-routes.js](../../../src/server/api-routes.js)、[src/server/system-metrics.js](../../../src/server/system-metrics.js)、[src/server/domain-services.js](../../../src/server/domain-services.js)

本文档是后端服务进程的**唯一事实源**:端口、环境变量、启动/关闭时序、请求管线、token 注入机制均只在此成表。HTTP 端点全量注册表见 [api.md](api.md),WebSocket 传输与快照契约见 [ws.md](ws.md),数据库细节见 [storage.md](storage.md)。

## 1. 进程模型与入口

后端是一个**零框架的 Node.js HTTP 服务**:`node:http` + 手写路由,无 Express、无 Koa。同一个进程承载:

- HTTP API(`/api/*`)
- 静态前端页面服务(`public/` 目录)
- WebSocket 推送(`/ws`,见 [ws.md](ws.md))
- Bilibili 弹幕监听客户端(见 [bilibili/danmaku.md](bilibili/danmaku.md))
- 全部业务领域服务

两种运行形态:

| 形态 | 入口 | 说明 |
|---|---|---|
| 独立服务 | `npm start` → [src/server.js](../../../src/server.js)(`require.main === module` 分支) | 纯 Node 进程,无 safeStorage、无 Cookie 注入(降级认证模式) |
| Electron 内嵌 | `npm run desktop` → [src/electron/main.js](../../../src/electron/main.js) 内 `require('../server')` **同进程**调用 | 桌面模式下服务与 Electron main 共享一个进程,见 [desktop/main.md](../desktop/main.md) |

核心入口是工厂函数 `createServerRuntime(runtimeOptions)`([server.js:56](../../../src/server.js#L56)),返回 `{ start, stop, setPreShutdownHook, persistPlaybackSnapshot, getApiToken, getSetting }`。文件底部另有一套兼容层单例(`getCompatibilityRuntime()`),让旧调用方 `startServer()`/`shutdownApplication()` 等顶层导出仍可用。

## 2. 端口与监听

| 事实 | 值 | 出处 |
|---|---|---|
| 默认端口 | `START_PORT = 3000` | [server.js:45](../../../src/server.js#L45) |
| 默认主机 | `127.0.0.1`(`localhost` 归一化为 `127.0.0.1`,见 `normalizeServerHost`) | [server.js:51-54](../../../src/server.js#L51-L54) |
| 监听方式 | `lifecycle.listenExactly` — **精确端口,失败即报错**(不做回退) | [lifecycle.js:31-47](../../../src/server/lifecycle.js#L31-L47) |
| 回退辅助 | `listenWithFallback` 扫描 `startPort..startPort+19`,仅独立/兼容模式可用 | [lifecycle.js:13-29](../../../src/server/lifecycle.js#L13-L29) |
| 端口冲突处理 | 启动前 `cleanupOwnPortOccupant`:识别并关闭**上一个本服务实例**(同数据目录/SERVICE_ID/可执行路径),再绑定 | [lifecycle.js:65-111](../../../src/server/lifecycle.js#L65-L111) |

`SERVICE_ID = 'bilibili-live-song-plugin'`([lifecycle.js:11](../../../src/server/lifecycle.js#L11)),用于 `/api/health` 应答与旧实例识别。旧实例清理顺序:读 `.server-runtime.json` → GET `/api/health` 验证身份 → POST `/api/system/shutdown` 请求退出 → 轮询端口释放(1.2s 超时/120ms 间隔)→ 仍占用则 `SIGTERM` 杀进程。

## 3. 环境变量(唯一成表处)

| 变量 | 默认 | 作用 |
|---|---|---|
| `HOST` | `127.0.0.1` | 服务绑定主机(`localhost` 归一化) |
| `PORT` | `3000` | 独立启动模式端口(兼容层读取) |
| `SONG_PLUGIN_DATA_DIR` | 仓库根 `data/` | 数据目录(数据库、token、缓存),见 [storage.md](storage.md) |
| `ELECTRON_DESKTOP` | 未设 | `'1'` 表示运行在 Electron 桌面模式,`/api/health` 的 `desktop` 字段据此报告 |
| `AUTO_OPEN_ADMIN` | 未设 | `'1'` 时启动后自动用浏览器打开 `/admin`(`openAdminPageIfNeeded`,Windows 走 `cmd /c start`) |

## 4. 请求管线

[server.js:264-283](../../../src/server.js#L264-L283) 的 `http.createServer` 回调按序分发:

1. `pathname === '/ws'` → 直接 400(提示用 WebSocket 客户端;升级请求走 `server.on('upgrade')`)
2. `pathname.startsWith('/api/')` → [api-routes.js](../../../src/server/api-routes.js) 的 `handleApi(createApiContext(), req, res, requestUrl)`
3. 其余 → `httpUtils.servePageOrAsset(PUBLIC_DIR, …)` 静态页面/资源

`server.on('upgrade')`([server.js:285-292](../../../src/server.js#L285-L292)):仅 `/ws` 路径交给 `webSocketHub.handleUpgrade`,其余直接 `socket.destroy()`。

### 4.1 API 路由分发

[src/server/api-routes.js](../../../src/server/api-routes.js) 无状态:业务状态全部通过 context 注入。

- **15 个路由模块**按 `ROUTE_MODULES` 数组顺序前缀匹配(完整端点清单见 [api.md](api.md))。
- **Token 校验**:除 `PUBLIC_API_PATHS = {'/api/health'}` 外全部要求 Bearer 头或 `?token=` 查询参数,失败回 401(`verifyToken`,[http-utils.js:46-54](../../../src/server/http-utils.js#L46-L54))。
- **405 与 404 区分**:`findRoute` 在模块前缀命中但方法不匹配时标记 `pathExists` → 405;否则 404。
- **请求体惰性读取**:`createBodyReader` 只在 handler 真正调用时读一次 JSON([api-routes.js:42-48](../../../src/server/api-routes.js#L42-L48)),上限 `MAX_BODY_BYTES = 16 MB`([server.js:48](../../../src/server.js#L48)),超限/非法 JSON 在 `readJsonBody` 中拒绝。
- 顶层异常兜底:500 + `{ok:false, error}`。

### 4.2 API Context 注入

`createApiContext()`([server.js:295-410](../../../src/server.js#L295-L410))**按领域分组**注入,避免退化成平铺 Fat Context:`songs / queue / superChat / gifts / overtime / debug / data / playback / playbackLyrics / weSing / theme / bilibili / ai / settings / system / music` 共 16 组,外加 `maxBodyBytes`、`sessionToken`、`broadcastSnapshot`。各组内部函数全部来自领域服务(见 [domain-services.js](../../../src/server/domain-services.js))或运行时组件(weSingCapture、xiaomiAi、danmakuSender、musicRegistry)。

### 4.3 静态页面服务与 Token 注入

`servePageOrAsset`([http-utils.js:75-154](../../../src/server/http-utils.js#L75-L154)):

- **页面映射**(完整入口 URL 清单见 [frontend/pages.md](../frontend/pages.md)):根路径映射到 `public/pages/` 下对应 HTML,其余按文件路径解析,并防目录穿越(`path.resolve` 后必须仍在 `publicDir` 内,否则 403)。
- **Session Token 注入**:每个返回的 HTML 在 `</head>` 前插入一段脚本,写入 `window.__API_TOKEN__`,并自动:
  1. 给指向 `/api/` 的同源 `<a>` 链接补 `?token=`
  2. 包装 `window.fetch`,对 `/api/*`(除 `/api/health`)自动附加 `Authorization: Bearer <token>`
  3. 包装 `window.WebSocket`,对 `/ws` 自动追加 `?token=`
- 响应头:`Cache-Control: no-store`;MIME 映射覆盖 html/css/js/json/svg/png/jpg/jpeg/gif/webp/ico。
- 辅助函数:`readJsonBody`、`sendJson`(统一 `{ok,…}` 包装 + no-store)、`sendCsv`、`sendBuffer`。

## 5. 领域服务装配

`createDomainServices({ db, settingsStore, onGiftFlushed, onOvertimeUpdate })`([domain-services.js:22-188](../../../src/server/domain-services.js#L22-L188))是唯一组装点,产出:

| 领域 | 组成 | 详情文档 |
|---|---|---|
| `songs` | song-service 封装(save/list/find/pickRandom/count…) | [music/services.md](music/services.md) |
| `queue` | queue-service(快照/加歌/动作/启动清理) | [music/services.md](music/services.md) |
| `gifts` | gift-service + 消费者注册表(加班机消费者) | [bilibili/gift.md](bilibili/gift.md) |
| `overtime` | `createOvertimeService({giftDb, onUpdate})` | [overtime.md](overtime.md) |
| `superChats` | superchat-service | [bilibili/gift.md](bilibili/gift.md) |
| `messages` | bilibili-message-handler + checkin/fortune/customReply 链 | [bilibili/danmaku.md](bilibili/danmaku.md) |
| `checkins / fortunes / customReplies / requesterTargets` | 弹幕机器人四件套 | [bilibili/danmaku.md](bilibili/danmaku.md) |
| `data` | 清库/保留策略入口(database + retention) | [storage.md](storage.md) |
| `playback / theme / cooldowns` | playback-store / theme-store / cooldown-store | [storage.md](storage.md) |

**启动时数据修复链**([server.js:113-133](../../../src/server.js#L113-L133)):`repairGiftV2Events` → 4 个 settings 迁移(`migrateQueueScrollSpeedSetting`/`migrateSongScrollSpeedSetting`/`migrateQueueFontSizeSettings`/`migrateSongBoardFontSizeSetting`)→ `clearLegacyIdentityRuleDefaults` → `migrateBlindBoxConfig` → `ensureCategory('默认')` → `queue.clearOnStartup()` → `runStartupRetention()`(仅在 `autoRetentionOnStartup==='true'` 时,失败不阻断启动)。

**运行时组件装配**([server.js:147-262](../../../src/server.js#L147-L262)):WS hub、歌词状态(`lyricState`/`lyricTimeline` + 发布器)、musicRegistry、weSingCapture、danmakuSender、aiConfigStore/apiQuotaStore/deliveryVerifier/requestLogger、xiaomiAi(DeepSeek + 4 工具)、messageBuffer(礼物调试缓冲,容量 500)。Bilibili 客户端在 `startServer` 成功后按设置重建(见 [bilibili/danmaku.md](bilibili/danmaku.md))。

## 6. 启动与关闭时序(服务端唯一成文处)

### 6.1 启动(startServer,[server.js:439-501](../../../src/server.js#L439-L501))

1. 重建 `musicRegistry`(注入 `musicAuth` 适配器)并记录 `bilibiliAuthProvider`
2. `cleanupOwnPortOccupant` 清理旧实例 → `listenExactly` 绑定精确端口
3. 生成会话令牌 `sessionToken = crypto.randomUUID()`,写入 `data/.session-token`(mode 0600)与 `data/.server-runtime.json`(pid/port/host)
4. `AUTO_OPEN_ADMIN=1` 时打开管理页
5. `reconnectBilibiliListener()` 重建 Bilibili 弹幕客户端(失败仅告警并更新 liveStatus,不阻断服务)

启动失败时回滚:删除 token/运行时文件、停客户端、关服务器、重置 `startPromise` 后重抛。`startPromise` 单飞(重复调用返回同一 Promise);`isShuttingDown` 期间拒绝新启动。

### 6.2 关闭(shutdownApplication,[server.js:741-801](../../../src/server.js#L741-L801))

顺序:

1. `xiaomiAi.shutdown()`(停止 AI 内部异步任务)
2. 等待启动完成(若进行中)
3. `preShutdownHook()` — 由 Electron main 注入,用于刷新渲染进程播放状态(见 [desktop/main.md](../desktop/main.md))
4. 删除 `.session-token` 与 `.server-runtime.json`
5. `bilibiliClient.stop()` → `gifts.dispose()`(待决礼物兜底 flush)→ `overtime.dispose()` → `weSingCapture.stop()` → `webSocketHub.stop({shutdownPayload: {type:'shutdown', reason:'manual'}})`
6. `server.close()` + `closeAllConnections()`,1.5s 兜底定时器
7. `optimizeDatabases(db)`(PRAGMA optimize)→ `closeDatabases(db)`
8. `exitProcess` 时 `process.exit(0)`

信号处理(独立模式):SIGINT/SIGTERM/SIGHUP → `shutdownApplication()`。`shutdownPromise` 单飞,重复调用返回同一 Promise。

## 7. 会话令牌(Session Token)

- 每次启动随机生成 UUID,落盘 `data/.session-token`(0600);关闭时删除。
- 所有 `/api/*`(除 `/api/health`)与 `/ws` 连接要求该令牌(Bearer 头或 `?token=` 查询参数)。
- 前端页面通过 HTML 注入获得令牌(见 §4.3 与 [frontend/comms.md](../frontend/comms.md))。
- `/api/health` 公开,返回 `serviceId/rootDir/dataDir/5 个数据库路径/schemaVersions/desktop/pid/liveStatus`,供旧实例识别与健康检查使用。

## 8. 系统指标

[src/server/system-metrics.js](../../../src/server/system-metrics.js) 的 `getSystemMetrics(rawWindowMs = 5000)`:5 秒采样窗口内的 CPU/内存/GPU(Windows 下 PowerShell 采样 GPU 引擎)指标,由 `/api/system/metrics` 暴露(见 [api.md](api.md))。
