# 后端核心:HTTP 服务与进程生命周期

> 涉及文件:[src/server.js](../../../src/server.js)、[src/server/api-context.js](../../../src/server/api-context.js)、[src/server/inflight-tracker.js](../../../src/server/inflight-tracker.js)、[src/server/music-runtime.js](../../../src/server/music-runtime.js)、[src/server/ai-runtime.js](../../../src/server/ai-runtime.js)、[src/server/bilibili-runtime.js](../../../src/server/bilibili-runtime.js)、[src/server/lifecycle.js](../../../src/server/lifecycle.js)、[src/server/http-utils.js](../../../src/server/http-utils.js)、[src/server/api-routes.js](../../../src/server/api-routes.js)、[src/server/system-metrics.js](../../../src/server/system-metrics.js)、[src/server/domain-services.js](../../../src/server/domain-services.js)

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

核心入口是工厂函数 `createServerRuntime(runtimeOptions)`([server.js:43](../../../src/server.js#L43)),返回 `{ start, stop, setPreShutdownHook, persistPlaybackSnapshot, getApiToken, getSetting }`。文件底部另有一套兼容层单例,由 [compatibility-runtime.js](../../../src/server/compatibility-runtime.js) 适配旧调用方 `startServer()`/`shutdownApplication()` 等顶层导出。

## 2. 端口与监听

| 事实 | 值 | 出处 |
|---|---|---|
| 默认端口 | `START_PORT = 3000` | [server.js:32](../../../src/server.js#L32) |
| 默认主机 | `127.0.0.1`(`localhost` 归一化为 `127.0.0.1`,见 `normalizeServerHost`) | [server.js:38-40](../../../src/server.js#L38-L40) |
| **主机验证** | **仅接受 `127.0.0.1` 或 `localhost`;拒绝 `0.0.0.0`、LAN 地址、任意主机名**(见 `validateServerHost`) | [server.js:42-49](../../../src/server.js#L42-L49) |
| 监听方式 | `lifecycle.listenExactly` — **精确端口,失败即报错**(不做回退) | [lifecycle.js:31-47](../../../src/server/lifecycle.js#L31-L47) |
| 回退辅助 | `listenWithFallback` 扫描 `startPort..startPort+19`,仅独立/兼容模式可用 | [lifecycle.js:13-29](../../../src/server/lifecycle.js#L13-L29) |
| 端口冲突处理 | 启动前 `cleanupOwnPortOccupant`:识别并关闭**上一个本服务实例**(同数据目录/SERVICE_ID/可执行路径),再绑定 | [lifecycle.js:65-111](../../../src/server/lifecycle.js#L65-L111) |

`SERVICE_ID = 'lira'`([lifecycle.js:11](../../../src/server/lifecycle.js#L11)),用于 `/api/health` 应答与旧实例识别。旧实例清理顺序:读 `.server-runtime.json` → GET `/api/health` 验证身份 → POST `/api/system/shutdown` 请求退出 → 轮询端口释放(7.5s 超时/120ms 间隔)→ 仍占用则 `SIGTERM` 杀进程。等待预算覆盖 Electron 的 2 秒 renderer flush 和正常退出余量，避免健康旧实例仍在写库时被过早终止。

**安全边界(H06 Browser Origin Boundary)**:主机验证在 `createServerRuntime()` 构造时执行，**先于任何文件系统或数据库副作用**。非环回地址被拒时抛出错误，阻止服务启动。这确保服务仅监听本地环回接口，防止 LAN/WAN 暴露。

## 3. 环境变量(唯一成表处)

| 变量 | 默认 | 作用 |
|---|---|---|
| `HOST` | `127.0.0.1` | 服务绑定主机(`localhost` 归一化) |
| `PORT` | `3000` | 独立启动模式端口(兼容层读取) |
| `SONG_PLUGIN_DATA_DIR` | 仓库根 `data/` | 数据目录(数据库、token、缓存),见 [storage.md](storage.md) |
| `ELECTRON_DESKTOP` | 未设 | `'1'` 表示运行在 Electron 桌面模式,`/api/health` 的 `desktop` 字段据此报告 |
| `AUTO_OPEN_ADMIN` | 未设 | `'1'` 时启动后自动用浏览器打开 `/admin`(`openAdminPageIfNeeded`,Windows 走 `cmd /c start`) |

## 4. 请求管线

[server.js](../../../src/server.js) 的 `http.createServer` 回调先检查 runtime phase，再按序分发:

1. phase 非 `ready` 时，仅 `/api/health` 返回最小进程身份与 phase；其他 HTTP 请求稳定返回 503，WebSocket upgrade 同样拒绝。
2. **Host 头验证**(H06):检查 `req.headers.host` 是否与运行时 baseUrl 匹配，不匹配返回 400。
3. **Origin 验证**(H06):对状态变更请求(`POST`/`PUT`/`DELETE`/`PATCH`)，检查 `req.headers.origin` 是否在允许列表内(当前仅运行时 baseUrl)。无 Origin 头的请求(非浏览器客户端，如 curl)放行。不匹配返回 403。
4. `pathname === '/ws'` → 直接 400(提示用 WebSocket 客户端;升级请求走 `server.on('upgrade')`)
5. `pathname.startsWith('/api/')` → 经 [inflight-tracker.js](../../../src/server/inflight-tracker.js) 接纳并跟踪，再调用 [api-routes.js](../../../src/server/api-routes.js) 的 `handleApi(createApiContext(), req, res, requestUrl)`。
6. 其余 → `httpUtils.servePageOrAsset(PUBLIC_DIR, …)` 静态页面/资源。

phase 为 `ready` 时，`server.on('upgrade')` 仅把 `/ws` 交给 `webSocketHub.handleUpgrade`;starting/quiescing 阶段返回 503。`inflight-tracker` 只统计 quiesce 前已接纳的 API handler，quiesce 后的 health/503 不进入 drain 集合。

**Host/Origin 验证辅助函数**(`http-utils.js`):
- `validateRequestHost(req, runtimeBaseUrl)`:提取 `req.headers.host` 与运行时 baseUrl 的 host:port 比较,确保请求目标与服务实际绑定地址一致。
- `validateOrigin(req, allowedOrigins)`:检查 `req.headers.origin` 是否在白名单内。无 Origin 头时返回 `true`(允许非浏览器客户端)。
- `addFrameProtectionHeaders(res, pathname)`:为管理页面(`/admin`/`/settings`/`/songs`/`/`)添加 `Content-Security-Policy: frame-ancestors 'none'` 与 `X-Frame-Options: DENY`;排除 overlay 页面(`/queue`/`/songlist`/`/blindbox`/`/overtime`/`/gift-effects`/`/lyrics`)，这些页面需要被 OBS 嵌入。

### 4.1 API 路由分发

[src/server/api-routes.js](../../../src/server/api-routes.js) 无状态:业务状态全部通过 context 注入。

- **15 个路由模块**按 `ROUTE_MODULES` 数组顺序前缀匹配(完整端点清单见 [api.md](api.md))。
- **Token 校验**:除 `PUBLIC_API_PATHS = {'/api/health'}` 外全部要求 Bearer 头或 `?token=` 查询参数,失败回 401(`verifyToken`,[http-utils.js:46-54](../../../src/server/http-utils.js#L46-L54))。
- **405 与 404 区分**:`findRoute` 在模块前缀命中但方法不匹配时标记 `pathExists` → 405;否则 404。
- **请求体惰性读取**:`createBodyReader` 只在 handler 真正调用时读一次 JSON([api-routes.js:42-47](../../../src/server/api-routes.js#L42-L47)),上限 `MAX_BODY_BYTES = 16 MB`([server.js:35](../../../src/server.js#L35)),超限/非法 JSON 在 `readJsonBody` 中拒绝。
- 顶层异常兜底:500 + `{ok:false, error}`。

### 4.2 API Context 注入

`server.js` 内的轻量适配函数 `createApiContext()`([server.js:201](../../../src/server.js#L201))只收集当前运行时依赖,实际的 Context 结构由 [api-context.js:7](../../../src/server/api-context.js#L7) 统一构建。Context **按领域分组**注入,避免退化成平铺 Fat Context:`songs / queue / superChat / gifts / overtime / debug / data / playback / playbackLyrics / weSing / theme / bilibili / ai / settings / system / music` 共 16 组,外加 `maxBodyBytes`、`sessionToken`、`broadcastSnapshot`。各组内部函数来自领域服务或显式注入的运行时组件。

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

`createDomainServices({ db, settingsStore, giftEffectResolver, onGiftFlushed, onOvertimeUpdate })`([domain-services.js:22](../../../src/server/domain-services.js#L22))是唯一领域服务组装点,产出:

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

**启动时数据修复链**仅在精确端口绑定成功后执行:`createDatabases`/schema migration → `settingsBootstrap` 设置迁移 → runtime 装配 → `giftEffectResolver` 预热 → `repairGiftV2Events` → `ensureCategory('默认')` → `queue.clearOnStartup()` → `runStartupRetention()`(仅在 `autoRetentionOnStartup==='true'` 时,失败不阻断启动)。

**运行时组件装配**:音乐 Provider Registry、歌词服务、歌词状态与 WeSing 捕获由 `buildMusicRuntime()` 拥有;AI 配置、配额、DeepSeek 客户端、工具、投递校验与请求日志由 `buildAiRuntime()` 拥有;Bilibili 登录缓存、客户端替换串行化、liveStatus、诊断缓冲和弹幕发送器由 `createBilibiliRuntime()` 拥有。`server.js` 作为 composition root 只创建这些 runtime、连接广播/领域回调并控制启动与逆序关闭。

## 6. 启动与关闭时序(服务端唯一成文处)

### 6.1 启动(startServer)

1. 无 I/O 校验端口参数；`createServerRuntime()` 本身只保存配置并创建未监听的 HTTP server，不创建数据目录、数据库、token 或日志。
2. `cleanupOwnPortOccupant` 请求可信旧实例关闭并等待端口释放。
3. `listenExactly` 绑定精确端口，phase 进入 `starting`;此时仅最小 `/api/health` 可用，其余请求返回 503。
4. 打开/迁移数据库，装配 domain/music/Bilibili/AI runtimes，执行数据修复、默认分类、队列清理和 retention。
5. 生成 `sessionToken`,写入 `.session-token` 与 `.server-runtime.json`，原子切换 phase 为 `ready`。
6. `AUTO_OPEN_ADMIN=1` 时打开管理页；最后调用 `bilibiliRuntime.reconnect()` 开放外部直播入口。

启动失败时按已创建资源逆序停止 runtime、关闭数据库、关闭 listener，再删除本实例拥有的 token/runtime 文件并重抛。`startPromise` 单飞(重复调用返回同一 Promise);`isShuttingDown` 期间拒绝新启动。

### 6.2 关闭(shutdownApplication)

顺序:

1. 同步切换 phase 为 `quiescing` 并让 `inflight-tracker` 停止接纳新 API；listener 继续占用端口，作为数据库独占边界。
2. 等待正在进行的启动结束，停止 Bilibili 与 WebSocket 新入口。
3. `preShutdownHook()` 通过 Electron IPC 刷新 renderer 播放状态，此时数据库仍开放。
4. drain quiesce 前已接纳的 HTTP handlers，再执行 `aiRuntime.shutdown()`：取消网络/工具调用并等待 active generation、delivery、direct provider 操作和日志写入。
5. `gifts.dispose()` 强制结清待决礼物并清 timer，随后 `overtime.dispose()`、`weSingCapture.stop()`。
6. `optimizeDatabases(db)` → `closeDatabases(db)`。
7. 最后 `server.close()` + `closeAllConnections()` 释放端口，再删除本实例拥有的 `.session-token` 与 `.server-runtime.json`。
8. `exitProcess` 时 `process.exit(0)`。

信号处理(独立模式):SIGINT/SIGTERM/SIGHUP → `shutdownApplication()`。`shutdownPromise` 单飞,重复调用返回同一 Promise。

## 7. 会话令牌(Session Token)

- 每次启动随机生成 UUID,落盘 `data/.session-token`(0600);关闭时删除。
- 所有 `/api/*`(除 `/api/health`)与 `/ws` 连接要求该令牌(Bearer 头或 `?token=` 查询参数)。
- 前端页面通过 HTML 注入获得令牌(见 §4.3 与 [frontend/comms.md](../frontend/comms.md))。
- `/api/health` 公开;ready 阶段返回 `serviceId/rootDir/dataDir/5 个数据库路径/schemaVersions/desktop/pid/liveStatus`。starting/quiescing 阶段返回最小 `serviceId/rootDir/dataDir/pid/phase`,供旧实例识别且不触碰未就绪或已关闭的数据库。

## 8. 系统指标

[src/server/system-metrics.js](../../../src/server/system-metrics.js) 的 `getSystemMetrics(rawWindowMs = 5000)`:5 秒采样窗口内的 CPU/内存/GPU(Windows 下 PowerShell 采样 GPU 引擎)指标,由 `/api/system/metrics` 暴露(见 [api.md](api.md))。

同模块的 `getHardwareSummary(includeTemperatures)` 读取 CPU/物理 GPU/内存型号与容量、排除虚拟显示适配器，并在进程内缓存静态结果。只有 `/api/system/hardware?includeTemperatures=true` 明确请求时，才会为 NVIDIA GPU 短暂调用 `nvidia-smi`;不支持的传感器返回不可用状态，不启动常驻监控进程，也不返回序列号。
