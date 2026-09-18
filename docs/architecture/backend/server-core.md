# 后端核心:HTTP 服务与进程生命周期

> 涉及文件:[src/server.js](../../../src/server.js)、[src/server/runtime-config.js](../../../src/server/runtime-config.js)、[src/server/runtime-transport.js](../../../src/server/runtime-transport.js)、[src/server/authorized-work.js](../../../src/server/authorized-work.js)、[src/server/http-server.js](../../../src/server/http-server.js)、[src/server/runtime-api-context.js](../../../src/server/runtime-api-context.js)、[src/server/startup-retention.js](../../../src/server/startup-retention.js)、[src/server/admin-launcher.js](../../../src/server/admin-launcher.js)、[src/server/api-context.js](../../../src/server/api-context.js)、[src/server/inflight-tracker.js](../../../src/server/inflight-tracker.js)、[src/server/music-runtime.js](../../../src/server/music-runtime.js)、[src/server/ai-runtime.js](../../../src/server/ai-runtime.js)、[src/server/bilibili-runtime.js](../../../src/server/bilibili-runtime.js)、[src/server/lifecycle.js](../../../src/server/lifecycle.js)、[src/server/http-utils.js](../../../src/server/http-utils.js)、[src/server/api-routes.js](../../../src/server/api-routes.js)、[src/server/system-metrics.js](../../../src/server/system-metrics.js)、[src/server/domain-services.js](../../../src/server/domain-services.js)

本文档是后端服务进程的**唯一事实源**:端口、环境变量、启动/关闭时序、请求管线、身份与凭据机制均只在此成表。HTTP 端点全量注册表见 [api.md](api.md),WebSocket 传输与快照契约见 [ws.md](ws.md),数据库细节见 [storage.md](storage.md)。

**组合根边界:** `server.js` 只保留运行时生命周期、领域装配与启动/关闭次序。`runtime-config.js` 解析路径和限制，`runtime-transport.js` 装配 WebSocket/静态传输，`authorized-work.js` 控制授权后才启动的消费者，`http-server.js` 创建监听器并分发请求，`runtime-api-context.js` 组装每次请求的 API 依赖；启动保留策略和自动打开后台分别由 `startup-retention.js`、`admin-launcher.js` 单独拥有。叶模块不导入 `server.js`，依赖只从组合根向下传递。

`http-server.js` 的异常日志在源头只记录解析后的 pathname（不含 query），并经共享凭据脱敏处理 error/stack 后输出。因此独立 Node 入口也不依赖 Electron 的 terminal wrapper 来保护这条错误日志。

## 1. 进程模型与入口

动态抽奖由 [dynamic-lottery-runtime.js](../../../src/server/dynamic-lottery-runtime.js) 组装专用账号端口、已有 `lotteryDb` store、串行预算与领域服务，server 只保存资源句柄及注入窄 API facade。启动将未结束采集/开奖恢复为暂停，不自动请求 B站；库不可用仅禁用此功能。关闭数据库之前先取消并排空抽奖任务。独立 Node 启动没有专用 Electron 账号端口，返回明确的桌面版限制。原播放快照、礼物及数据库生命周期保持不变。

后端是一个**零框架的 Node.js HTTP 服务**:`node:http` + 手写路由,无 Express、无 Koa。同一个进程承载:

- HTTP API(`/api/*`)
- 静态前端页面服务(`public/` 目录)
- WebSocket 推送(`/ws`,见 [ws.md](ws.md))
- Bilibili 弹幕监听客户端(实现保留；仅本地礼物 detector 暂停，弹幕/点歌/SC/用户信息/小游戏仍处理；见 [bilibili/danmaku.md](bilibili/danmaku.md))
- 全部业务领域服务

两种运行形态:

| 形态          | 入口                                                                                                               | 说明                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 独立服务      | `npm start` → [src/server.js](../../../src/server.js)(`require.main === module` 分支)                              | 纯 Node 进程,无 safeStorage、无 Cookie 注入(降级认证模式)                            |
| Electron 内嵌 | `npm run desktop` → [src/electron/main.js](../../../src/electron/main.js) 内 `require('../server')` **同进程**调用 | 桌面模式下服务与 Electron main 共享一个进程,见 [desktop/main.md](../desktop/main.md) |

核心入口是工厂函数 `createServerRuntime(runtimeOptions)`([server.js:43](../../../src/server.js#L43)),返回 `{ start, stop, setPreShutdownHook, persistPlaybackSnapshot, getApiToken, getSetting }`。文件底部另有一套兼容层单例,由 [compatibility-runtime.js](../../../src/server/compatibility-runtime.js) 适配旧调用方 `startServer()`/`shutdownApplication()` 等顶层导出。

## 2. 端口与监听

| 事实         | 值                                                                                                      | 出处                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 默认端口     | `START_PORT = 3000`                                                                                     | [server.js:32](../../../src/server.js#L32)                       |
| 默认主机     | `127.0.0.1`(`localhost` 归一化为 `127.0.0.1`,见 `normalizeServerHost`)                                  | [server.js:38-40](../../../src/server.js#L38-L40)                |
| **主机验证** | **仅接受 `127.0.0.1` 或 `localhost`;拒绝 `0.0.0.0`、LAN 地址、任意主机名**(见 `validateServerHost`)     | [server.js:42-49](../../../src/server.js#L42-L49)                |
| 监听方式     | `lifecycle.listenExactly` — **精确端口,失败即报错**(不做回退)                                           | [lifecycle.js:31-47](../../../src/server/lifecycle.js#L31-L47)   |
| 回退辅助     | `listenWithFallback` 扫描 `startPort..startPort+19`,仅独立/兼容模式可用                                 | [lifecycle.js:13-29](../../../src/server/lifecycle.js#L13-L29)   |
| 端口冲突处理 | 启动前 `cleanupOwnPortOccupant`:验证当前连接归属后关闭**上一个本服务实例**,再绑定 | [lifecycle.js:65-111](../../../src/server/lifecycle.js#L65-L111) |

`SERVICE_ID = 'lira'` 仅为公开服务标记，不构成身份证明。旧实例清理由 [lifecycle.js](../../../src/server/lifecycle.js) 编排，[local-instance.js](../../../src/server/local-instance.js) 拥有验证与连接：无凭据 GET health，发送 32 字节随机挑战；ready 实例返回 session token 的 HMAC-SHA256，固定域与实际监听端口绑定。客户端验证后，只有同一条 TCP socket 才能写入 Bearer 并 POST shutdown；断开、重连和重定向不转交令牌，响应上限 16 KiB、每次 HTTP 交换总期限 1 秒。

Windows 兼容旧版本：通过系统 TCP 表的精确两端地址/端口查当前连接的进程，再验证进程与当前 Windows 用户 SID 一致及安装或绝对入口，不能根据对端自报的 PID/dataDir/serviceId 放行。查询拥有者是 [local-process-owner.js](../../../src/server/local-process-owner.js)，直接筛选 `root/StandardCimv2` 的 `MSFT_NetTCPConnection`，避免加载 NetTCPIP cmdlet 的额外耗时；最多等待 5 秒，查询失败不降级为信任 health。进程归属对 Windows 路径统一小写；打包 exe 必须属于本 resources/app(.asar) 安装根，Node 必须直接启动本根 src/server.js 的绝对入口，Electron 必须直接启动本根或 src/electron/main.js；相对入口、其他参数中的根路径及同名可执行文件均不足以授权。

发出请求后保留 7.5 秒 / 120ms 端口释放等待，覆盖 Electron 的 renderer flush。若仍占用，必须重新查询实际监听者，PID、创建时间、精确归属与等待前匹配才允许 SIGTERM；health 自报 PID 从不进入终止分支。无 Windows 系统证据时仍可通过挑战完成新版本优雅退出，但不强制终止。无法验证的旧版本或无权限场景保留占用者，精确绑定随后报端口冲突。`.server-runtime.json` 只用于当前进程跳过与本实例元数据清理，不证明网络对端身份。

**安全边界(H06 Browser Origin Boundary)**:主机验证在 `createServerRuntime()` 构造时执行，**先于任何文件系统或数据库副作用**。非环回地址被拒时抛出错误，阻止服务启动。这确保服务仅监听本地环回接口，防止 LAN/WAN 暴露。

`localhost` 是可接受的启动配置输入，会归一化为 `127.0.0.1`；公开访问地址、Host 和 Origin 使用归一化后的 `http://127.0.0.1:<实际端口>`。这不承诺同时接受浏览器的 `http://localhost:<端口>` 别名，二者不是同一个 Origin。客户端应使用启动结果中的 baseUrl，不自行替换主机名。

## 3. 环境变量(唯一成表处)

| 变量                   | 默认           | 作用                                                                                       |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `HOST`                 | `127.0.0.1`    | 服务绑定主机(`localhost` 归一化)                                                           |
| `PORT`                 | `3000`         | 独立启动模式端口(兼容层读取)                                                               |
| `SONG_PLUGIN_DATA_DIR` | 仓库根 `data/` | 数据目录(数据库、token、缓存),见 [storage.md](storage.md)                                  |
| `ELECTRON_DESKTOP`     | 未设           | `'1'` 表示运行在 Electron 桌面模式,`/api/health` 的 `desktop` 字段据此报告                 |
| `AUTO_OPEN_ADMIN`      | 未设           | `'1'` 时启动后自动用浏览器打开 `/admin`(`openAdminPageIfNeeded`,Windows 走 `cmd /c start`) |

## 4. 请求管线

领域事件发布统一由 [runtime-transport.js](../../../src/server/runtime-transport.js) 适配：`publishGiftFlushed` 保持快照→礼物边框顺序且不逐条输出成功日志，`publishGiftCatalogUpdate` 发布目录快照，`publishDanmaku` 保留 feed 缓冲及 topic，`publishOvertimeUpdate` 保留可选 adjustment。server 通过 getter 接线，仍按数据库、领域服务、音乐/直播/AI、启动恢复阶段创建资源，并在 initializeApplication 失败时统一 dispose；传输模块不拥有这些资源。

[server.js](../../../src/server.js) 的 `http.createServer` 回调先检查 runtime phase，再按序分发:

1. **Host 头验证**(H06):所有 HTTP 生命周期阶段先检查 `req.headers.host` 与运行时 baseUrl，不匹配返回 400。
2. phase 非 `ready` 时，仅 `/api/health` 返回 `{serviceId,phase}`；其他正确 Host 的 HTTP 请求返回 503，WebSocket upgrade 同样拒绝。
3. **Origin 验证**(H06):对状态变更请求(`POST`/`PUT`/`DELETE`/`PATCH`)，检查 `req.headers.origin` 是否在允许列表内(当前仅运行时 baseUrl)。无 Origin 头的请求(非浏览器客户端，如 curl)放行。不匹配返回 403。`Origin: null` 的 API 请求交由下述 scope 鉴权处理，绝不作为普通受信任来源。
4. `pathname === '/ws'` → 直接 400(提示用 WebSocket 客户端;升级请求走 `server.on('upgrade')`)；升级入口捕获 URL 解析异常，畸形 Host/请求 URL 返回 400 并关闭该连接，不使服务退出。
5. `pathname.startsWith('/api/')` → 经 [inflight-tracker.js](../../../src/server/inflight-tracker.js) 接纳并跟踪，再调用 [api-routes.js](../../../src/server/api-routes.js) 的 `handleApi(createApiContext(), req, res, requestUrl)`。
6. 其余 → `httpUtils.servePageOrAsset(PUBLIC_DIR, …)` 静态页面/资源。

phase 为 `ready` 时，`server.on('upgrade')` 先复用 HTTP 的严格 Host:port 校验，不匹配返回 400，再把通过许可门的 `/ws` 交给 `webSocketHub.handleUpgrade`，继续独立校验 Origin/token；无 Origin 的非浏览器客户端同样必须匹配运行时 Host。starting/quiescing 阶段返回 503。`inflight-tracker` 只统计 quiesce 前已接纳的 API handler，quiesce 后的 health/503 不进入 drain 集合。

**Host/Origin 验证辅助函数**(`http-utils.js`):

- `validateRequestHost(req, runtimeBaseUrl)`:提取 `req.headers.host` 与运行时 baseUrl 的 host:port 比较,确保请求目标与服务实际绑定地址一致。
- `validateOrigin(req, allowedOrigins)`:检查 `req.headers.origin` 是否在白名单内。无 Origin 头时返回 `true`(允许非浏览器客户端)。
- `addFrameProtectionHeaders(res, pathname)`：管理 HTML 禁止嵌入和启动 worker；overlay HTML 使用 `sandbox allow-scripts`，可嵌入但不具有父 frame 的同源权限。规范 URL 与 raw HTML 文件别名执行同一规则。

### 4.1 API 路由分发

请求体累计超过预算后，读取器清除缓存并暂停读取，保留响应写入机会；413 响应携带 `Connection: close`，未完成的上传另有 1 秒强制回收上界。完整超量、未发完和继续发送的请求均不再通过提前 destroy 丢失错误响应。稳定错误映射识别 owner 标记的 400 参数错误，仍不向客户端暴露内部堆栈。

读取器以 `REQUEST_BODY_TOO_LARGE` / `statusCode: 413` 标记限额异常；包裹 body 读取的领域路由必须透传该异常，交由统一响应处理，不能重新归类为 400、500 或上游 502。

[src/server/api-routes.js](../../../src/server/api-routes.js) 无状态:业务状态全部通过 context 注入。

- **17 个路由模块**按 `ROUTE_MODULES` 数组顺序前缀匹配(完整端点清单见 [api.md](api.md))。
- **身份与权限**：[access-policy.js](../../../src/server/access-policy.js) 由 Bearer/query 凭据解析冻结的 `admin` 或 `overlay(scope)`。显式 Authorization 优先，错误头不能回退 query；空运行密钥拒绝认证。只有 `GET /api/health` 匿名可用；overlay 先检查精确 method/path，再进入 [overlay-http.js](../../../src/server/overlay-http.js) 的受限参数适配与字段投影。无效凭据 401，跨 scope/管理接口 403。时钟和开播配置由各自页面能力读取。
- **405 与 404 区分**:`findRoute` 在模块前缀命中但方法不匹配时标记 `pathExists` → 405;否则 404。
- **请求体惰性读取**:`createBodyReader` 只在 handler 真正调用时读一次 JSON([api-routes.js:42-47](../../../src/server/api-routes.js#L42-L47)),上限 `MAX_BODY_BYTES = 16 MB`([server.js:35](../../../src/server.js#L35)),超限/非法 JSON 在 `readJsonBody` 中拒绝。
- 顶层异常兜底:500 + `{ok:false, error}`。

### 4.2 API Context 注入

`server.js` 内的轻量适配函数 `createApiContext()`([server.js:201](../../../src/server.js#L201))只收集当前运行时依赖,实际的 Context 结构由 [api-context.js:7](../../../src/server/api-context.js#L7) 统一构建。Context **按领域分组**注入,避免退化成平铺 Fat Context:`songs / queue / superChat / gifts / overtime / data / playback / playbackLyrics / weSing / theme / bilibili / ai / settings / system / music / cloudSync / giftSync / games / wheel` 共 19 组,外加 `maxBodyBytes`、`sessionToken`、`broadcastSnapshot`。各组内部函数来自领域服务或显式注入的运行时组件。

### 4.3 静态页面服务与页面能力

[http-utils.js](../../../src/server/http-utils.js) 的 `servePageOrAsset` 按 [access-policy.js](../../../src/server/access-policy.js) 固定页面表解析 scope；raw HTML、规范 URL 同权，大小写与文件路径按实际解析处理，路径必须留在 publicDir 内。禁止冒号文件别名，避免 Windows NTFS `::$DATA` 将 HTML 伪装成普通资源。

- 管理组合页和 raw 管理片段要求管理身份，任何 HTML 都不包含管理 token。管理页 CSP 另设 `worker-src 'none'`：Chromium 可将 dedicated/blob worker 请求归属主 frame，不能只靠请求 frame 元数据排除 worker；当前管理 UI 没有 worker 消费者。Electron main 给受信主窗口请求加头，见 [desktop/auth.md](../desktop/auth.md)；Node 调试脚本须自持 Bearer，匿名浏览器不获得管理入口。
- 只有 13 个已知 overlay 页面注入 [overlay-bootstrap.js](../../../src/server/overlay-bootstrap.js) 与该 scope 的凭据，`window.__API_TOKEN__` 仅表示本页能力。fetch 包装保留 Request/Headers 语义，仅为精确本机 origin 的 API 加头；WS 只向精确本机 `/ws` 添加 query 凭据，外域、异端口和相似路径不带凭据。
- overlay HTML 返回 `Content-Security-Policy: sandbox allow-scripts`，不含 allow-same-origin。公开静态 JS/CSS/字体等返回 `Access-Control-Allow-Origin: *`；HTML 不开放跨域读取。API 的 opaque-origin 预检只描述 overlay 已知路径/方法/头，实际请求仍验证 scope；管理凭据的 `Origin: null` 请求拒绝。没有 cookie 或 allow-credentials 例外。
- OBS 会话恢复：本机 WS 断开或 API 返回 401 后，使用旧页面能力请求其最小 `/api/state`；仅再次 401 才刷新。此错误响应可被 opaque 页面读取，不能借此读取数据。探测单飞、5 秒超时，离线/启动中/凭据有效不刷新，pagehide 取消探测。
- 页面仍为 `Cache-Control: no-store`。只有已认证管理组合页的实际 GET 分配 `__PLAYBACK_SNAPSHOT_WRITER__`；HEAD、未授权页面、raw 片段和 overlay 都不改变播放代次。该字段用于顺序控制，不是认证凭据。

开播音频和人物图的文件流由 `http-utils.js` 负责收尾：GET 在源文件成功打开后发送 200，打开前文件消失返回 404，其他打开错误返回不含内部路径的 500；发送头部后的读取失败终止响应。客户端提前关闭响应时销毁源流，HEAD 保持只返回元信息。该处理覆盖 stat 后文件消失的竞态，不承诺并发替换文件时的内容快照一致性。验证：`test/opening-media-stream.test.js`。

## 5. 领域服务装配

`createDomainServices({ db, settingsStore, giftEffectResolver, onGiftFlushed, onOvertimeUpdate })`([domain-services.js:22](../../../src/server/domain-services.js#L22))是唯一领域服务组装点,产出:

| 领域                                                     | 组成                                                      | 详情文档                                   |
| -------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `songs`                                                  | song-service 封装(save/list/find/pickRandom/count…)       | [music/services.md](music/services.md)     |
| `queue`                                                  | queue-service(快照/加歌/动作/启动清理)                    | [music/services.md](music/services.md)     |
| `gifts`                                                  | gift-service + 消费者注册表(加班机消费者)                 | [bilibili/gift.md](bilibili/gift.md)       |
| `overtime`                                               | `createOvertimeService({giftDb, onUpdate})`               | [overtime.md](overtime.md)                 |
| `superChats`                                             | superchat-service                                         | [bilibili/gift.md](bilibili/gift.md)       |
| `messages`                                               | bilibili-message-handler + checkin/fortune/customReply 链 | [bilibili/danmaku.md](bilibili/danmaku.md) |
| `checkins / fortunes / customReplies / requesterTargets` | 弹幕机器人四件套                                          | [bilibili/danmaku.md](bilibili/danmaku.md) |
| `data`                                                   | 清库/保留策略入口(database + retention)                   | [storage.md](storage.md)                   |
| `playback / theme / cooldowns`                           | playback-store / theme-store / cooldown-store             | [storage.md](storage.md)                   |

**启动时数据修复链**仅在精确端口绑定成功后执行:`createDatabases`/schema migration → `settingsBootstrap` 设置迁移 → runtime 装配 → 旧 `giftEffectResolver` 按显式兼容 API 惰性加载 → `ensureCategory('默认')` → `queue.clearOnStartup()` → `runStartupRetention()`(仅在 `autoRetentionOnStartup==='true'` 时,失败不阻断启动)。客户端原始礼物检测与修复实现已删除，旧本地礼物不再重新解析或合并。`/gift-effects` 的实时路径不再预热或消费旧媒体映射。

**运行时组件装配**:音乐 Provider Registry、歌词服务、歌词状态与 WeSing 捕获由 `buildMusicRuntime()` 拥有;AI 配置、配额、DeepSeek 客户端、工具、投递校验与请求日志由 `buildAiRuntime()` 拥有;Bilibili 登录缓存、客户端替换串行化、liveStatus、诊断缓冲和弹幕发送器由 `createBilibiliRuntime()` 拥有。`server.js` 作为 composition root 只创建这些 runtime、连接广播/领域回调并控制启动与逆序关闭。当前 Bilibili runtime 仍创建并维持 `BilibiliDanmakuClient`，本地 `onGift → gifts.add()` 记账入口已移除；弹幕、点歌/机器人、SC、用户信息和小游戏仍继续处理。服务器权威礼物由 `D:/Work/lira-server` 的每主播 `RoomMonitor` 检测，Electron main 通过 DeviceBearer final cursor/SSE 拉取后调用本地 `importProcessedGiftEvent`;本仓库的 renderer 不直接访问远程接口或凭据。`enableBilibili` 设置和本地客户端实现保持不变，云端仍可据此控制租户 `RoomMonitor`。远程礼物协议、baseline/catch-up 与隐私白名单见 `specs/server-authoritative-gift-detection_design.md`。

## 6. 启动与关闭时序(服务端唯一成文处)

`bilibiliRuntime` 的客户端替换按请求串行执行。替换请求、禁用监听、显式断开和关闭会同步递增运行代次并停止当前客户端；排队任务在开始和登录信息读取完成后检查代次。旧代次不会再创建客户端、派发业务/状态回调或传播过期重连错误，重新启用后只运行当前请求。

### 6.1 启动(startServer)

1. 无 I/O 校验端口参数；`createServerRuntime()` 本身只保存配置并创建未监听的 HTTP server，不创建数据目录、数据库、token 或日志。
2. `cleanupOwnPortOccupant` 请求可信旧实例关闭并等待端口释放。
3. `listenExactly` 绑定精确端口，phase 进入 `starting`;此时仅最小 `/api/health` 可用，其余请求返回 503。
4. 打开/迁移数据库，装配 domain/music/Bilibili/AI runtimes，执行数据修复、默认分类、队列清理和 retention。
5. 生成 `sessionToken`,写入 `.session-token` 与 `.server-runtime.json`，原子切换 phase 为 `ready`。
6. `AUTO_OPEN_ADMIN=1` 时打开管理页；最后仍调用 `bilibiliRuntime.reconnect()`，建立本地 Bilibili 连接并继续处理非礼物功能。礼物服务只创建服务器结果投影器，本地消息不再注册礼物记账回调，仅保留用户身份提示。

启动失败时按已创建资源逆序停止 runtime、关闭数据库、关闭 listener，再删除本实例拥有的 token/runtime 文件并重抛。`startPromise` 单飞(重复调用返回同一 Promise);`isShuttingDown` 期间拒绝新启动。

`disposeApplication` 按既有资源顺序逐步清理，每一步单独捕获并记录失败，后续步骤仍继续，包括数据库关闭。启动失败清理中的领域异常不会覆盖最初的启动错误，也不会阻止 listener 关闭与 `startPromise` 复位；清理完成后允许重新启动。失败的资源关闭为 best-effort，不宣称一个抛错的资源自身已成功释放。

`createDomainServices` 在完整返回前负责部分装配回滚，依次释放已取得的 gift runtime、hybrid catalog、本地 catalog 和 overtime；单步清理失败记录警告后继续，保留原始装配错误。overtime 自身恢复中断时取消已创建的归零/重试计时器。hybrid 的终止 `dispose()` 移除本实例的 initializer 监听器并停止自己创建的 remote cache，保留外部借用对象；正常可恢复的 `start()` / `stop()` 契约不变。数据库、settings store 和 resolver 的关闭责任仍在外层；清理不重置已持久化的倒计时或礼物状态。

### 6.2 关闭(shutdownApplication)

顺序:

1. 同步切换 phase 为 `quiescing` 并让 `inflight-tracker` 停止接纳新 API；listener 继续占用端口，作为数据库独占边界。
2. 等待正在进行的启动结束，停止 Bilibili 与 WebSocket 新入口。WS hub 发送 shutdown、Close(1001) 和 FIN，并保留关闭中升级连接的回收责任：正常关闭释放 timer，1 秒后仍存活则 destroy；重复 stop 不重置期限，见 [WS 关闭契约](ws.md)。
3. `preShutdownHook()` 通过 Electron IPC 刷新 renderer 播放状态，此时数据库仍开放。
4. drain quiesce 前已接纳的 HTTP handlers，释放 `gameSessionService` 与 `wheelSessionService`，再执行 `aiRuntime.shutdown()`：取消网络/工具调用并等待 active generation、delivery、direct provider 操作和日志写入。
5. `gifts.dispose()` 清理消费者重试 timer，不收尾本地或服务器的 progress 礼物，随后停止 `overtimeGiftCatalog` 的刷新 timer，再执行 `overtime.dispose()`、`weSingCapture.stop()`。
6. `optimizeDatabases(db)` → `closeDatabases(db)`。
7. 最后 `server.close()` + `closeAllConnections()` 释放端口；后者不回收已升级 WS，须等待 hub 自有关闭回收完成。之后删除本实例拥有的 `.session-token` 与 `.server-runtime.json`。
8. 任一 `stop({exitProcess:true})` 请求退出时，在关闭完成后 `process.exit(0)`；后续 `false` 不撤销退出请求。

信号处理(独立模式):SIGINT/SIGTERM/SIGHUP → `shutdownApplication()`。`shutdownPromise` 单飞,重复调用返回同一 Promise。

单飞只合并清理工作，不丢弃后来调用的退出要求。关闭过程中到达的退出要求等待 flush/drain 和资源释放；关闭完成后补到的退出要求立即执行，最多调用一次 process.exit。它不是超时强退，Electron 的 5 秒最终兜底仍由桌面拥有。

## 7. 会话凭据与页面能力

- 每次启动随机生成管理 sessionToken，落盘 `data/.session-token`（0600），关闭时删除；不传给 renderer、HTML、URL 或其他 Electron 窗口。
- 13 个页面能力为 `ov1:<scope>:<HMAC-SHA256>`，签名绑定本次运行密钥与固定命名空间，scope 来自服务端白名单。验证采用恒定时间比较，重启后全部旧能力失效。持有某页能力不能更改 scope 或调用管理接口。
- 本机页面 URL 保持匿名可打开，因此能访问相应页面的客户端可取得该页公开展示/互动能力；此机制不声称识别主播本人。游戏停止/重开、落子/绘画和转盘抽取继续可用，权限清单见 [api.md](api.md)，WS 出口见 [ws.md](ws.md)。
- `GET /api/health` 匿名仅返回 `{serviceId,phase}`；仅有效管理凭据可读取 ready 诊断详情，overlay 凭据不行。合法 `X-Lira-Instance-Challenge`（64 位小写十六进制）可在 ready 阶段取得绑定运行密钥/端口/挑战的 `instanceProof`，证明本身不能授权 API。starting/quiescing 不返回证明，不访问未就绪或关闭的数据库。

## 8. 系统指标

[src/server/system-metrics.js](../../../src/server/system-metrics.js) 的 `getSystemMetrics(rawWindowMs = 5000)`:5 秒采样窗口内的 CPU/内存/GPU(Windows 下 PowerShell 采样 GPU 引擎)指标,由 `/api/system/metrics` 暴露(见 [api.md](api.md))。

同模块的 `getHardwareSummary(includeTemperatures)` 读取 CPU/物理 GPU/内存型号与容量、排除虚拟显示适配器，并在进程内缓存静态结果。只有 `/api/system/hardware?includeTemperatures=true` 明确请求时，才会为 NVIDIA GPU 短暂调用 `nvidia-smi`;不支持的传感器返回不可用状态，不启动常驻监控进程，也不返回序列号。
