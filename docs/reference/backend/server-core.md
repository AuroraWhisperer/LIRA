# 后端核心：HTTP 服务与进程生命周期

> 涉及文件：[src/server.js](../../../src/server.js)、[src/server/runtime-config.js](../../../src/server/runtime-config.js)、[src/server/runtime-transport.js](../../../src/server/runtime-transport.js)、[src/server/authorized-work.js](../../../src/server/authorized-work.js)、[src/server/http-server.js](../../../src/server/http-server.js)、[src/server/runtime-api-context.js](../../../src/server/runtime-api-context.js)、[src/server/startup-retention.js](../../../src/server/startup-retention.js)、[src/server/admin-launcher.js](../../../src/server/admin-launcher.js)、[src/server/api-context.js](../../../src/server/api-context.js)、[src/server/inflight-tracker.js](../../../src/server/inflight-tracker.js)、[src/server/music-runtime.js](../../../src/server/music-runtime.js)、[src/server/ai-runtime.js](../../../src/server/ai-runtime.js)、[src/server/bilibili-runtime.js](../../../src/server/bilibili-runtime.js)、[src/server/lifecycle.js](../../../src/server/lifecycle.js)、[src/server/http-utils.js](../../../src/server/http-utils.js)、[src/server/api-routes.js](../../../src/server/api-routes.js)、[src/server/system-metrics.js](../../../src/server/system-metrics.js)、[src/server/domain-services.js](../../../src/server/domain-services.js)

本文档是后端服务进程的**单一事实来源**，集中说明端口与监听、环境变量、请求管线、领域装配、启停时序以及会话与访问凭证机制。HTTP 端点全量注册表见 [api.md](api.md)，WebSocket 传输与快照契约见 [ws.md](ws.md)，数据库与存储细节见 [storage.md](storage.md)。

**组合根边界：** `server.js` 作为组合根，只负责运行时生命周期、领域装配与启停顺序，各子职责由独立模块承担：`runtime-config.js` 解析路径与限制，`runtime-transport.js` 装配 WebSocket 与静态资源传输，`authorized-work.js` 管理授权后启动的后台消费者，`http-server.js` 创建监听器并分发请求，`runtime-api-context.js` 组装每次请求的 API 依赖，`startup-retention.js` 负责启动及每小时的数据保留维护，`admin-launcher.js` 负责自动打开管理页。下层模块禁止反向导入 `server.js`，依赖严格自顶向下注入。

[cloud-sync-runtime.js](../../../src/server/cloud-sync-runtime.js) 负责云端设置与歌库快照的本地适配、待上传快照与确认、账号房间准备、盲盒映射状态及同步通知订阅；菜单构造复用 `danmaku-menu.js` 的纯函数，菜单签名与微任务合并也在该模块内维护。初始化完成后记录菜单基准，服务进入关闭阶段后不再触发排队的菜单同步。对外 runtime 门面与 API 调用保持一致，云端修订、串行请求与重试仍由桌面端云同步控制器管理。

`http-server.js` 的异常日志在源头仅记录解析后的 `pathname`（不含 query），并经共享凭据脱敏处理 error 与堆栈后再输出；因此独立 Node 入口也不依赖 Electron 的终端包装器来保护该日志。

## 1. 进程模型与入口

后端是一个**零框架的 Node.js HTTP 服务**：`node:http` + 手写路由，无 Express、无 Koa。同一进程承载：

- HTTP API（`/api/*`）
- 静态前端页面服务（`public/` 目录）
- WebSocket 推送（`/ws`，见 [ws.md](ws.md)）
- Bilibili 弹幕监听客户端（本地持续处理弹幕、点歌、SC、用户信息与小游戏，见 [bilibili/danmaku.md](bilibili/danmaku.md)）
- 本地点歌、播放、互动、加班机等领域服务，以及远端礼物的本地投影处理

礼物原始检测实现已从客户端移除，权威检测与账本归属 LIRA Server；Electron 主进程的 [remote-gift-controller.js](../../../src/electron/remote-gift-controller.js) 接收 SSE 并通过 pull/history 恢复本地投影，详见 [bilibili/gift.md](bilibili/gift.md)。[bilibili-runtime.js](../../../src/server/bilibili-runtime.js) 的 `replaceClient` 继续创建并维护本地 Bilibili 客户端；[domain-services.js](../../../src/server/domain-services.js) 的 `messages.handleDanmaku` 对云端签到/抽签命令返回 `cloud-owned`，不在本地重复执行。

管理页面的正常凭据由 Electron 主进程的 [desktop-request-auth.js](../../../src/electron/desktop-request-auth.js) 注入（详见 [desktop/auth.md](../desktop/auth.md) 与下文 §7）。`?desktop=1` 仅影响页面表现，独立 Node 调试调用方必须显式携带当前运行时的有效 Bearer 令牌，不能通过该参数或 `AUTO_OPEN_ADMIN` 获得授权。登录页与叠加层入口例外见 [页面入口](../frontend/pages.md)。

两种运行形态：

| 形态 | 入口 | 说明 |
| --- | --- | --- |
| 独立服务 | `npm start` → [src/server.js](../../../src/server.js)（`require.main === module` 分支） | 本地调试入口；管理 HTML/API 仍需管理凭据，无 Electron 预加载脚本、分区登录、`safeStorage` 与 Cookie 注入 |
| Electron 内嵌 | `npm run desktop` → [entry.js](../../../src/electron/entry.js) → [main.js](../../../src/electron/main.js) 内 `require('../server')` **同进程**调用 | 桌面模式下服务与 Electron 主进程共享同一进程，见 [desktop/main.md](../desktop/main.md) |

核心入口为 [server.js](../../../src/server.js) 的工厂函数 `createServerRuntime(runtimeOptions)`，返回独立运行时实例（含 `start`、`stop`、`setPreShutdownHook`、`persistPlaybackSnapshot`、`getApiToken` 等生命周期与桌面接入方法）。文件底部由 [compatibility-runtime.js](../../../src/server/compatibility-runtime.js) 适配旧调用方的 `startServer()` / `shutdownApplication()` 等顶层导出，底层仍调用该工厂。

## 2. 端口与监听

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 默认端口 | `START_PORT = 3000` | [server.js](../../../src/server.js) |
| 默认主机 | `127.0.0.1`；`localhost` 经 `normalizeServerHost` 归一化 | [runtime-config.js](../../../src/server/runtime-config.js) |
| **主机验证** | `validateServerHost` 仅接受 `127.0.0.1` 或 `localhost`；拒绝非环回地址及其他主机名 | [runtime-config.js](../../../src/server/runtime-config.js) |
| 监听方式 | `lifecycle.listenExactly` 绑定指定端口，失败即报错；桌面、Node 调试与兼容入口均走此路径 | [server.js](../../../src/server.js)、[lifecycle.js](../../../src/server/lifecycle.js) |
| 端口冲突处理 | 启动前 `cleanupOwnPortOccupant` 验证当前连接归属后请求旧实例关闭，再绑定精确端口 | [lifecycle.js](../../../src/server/lifecycle.js) |

`SERVICE_ID = 'lira'` 仅为公开服务标记，不构成身份证明。旧实例清理由 [lifecycle.js](../../../src/server/lifecycle.js) 编排，[local-instance.js](../../../src/server/local-instance.js) 负责验证与连接：无凭据请求 `GET /api/health` 并附带 32 字节随机挑战；`ready` 实例返回绑定固定域与实际监听端口的 session token HMAC-SHA256。验证通过后，仅同一条 TCP socket 可写入 Bearer 并发送 `POST /api/shutdown`；断开、重连与重定向不转交令牌，响应上限 16 KiB，每次 HTTP 交换总期限 1 秒。

Windows 兼容旧版本的进程归属校验由 [local-process-owner.js](../../../src/server/local-process-owner.js) 负责：在 Windows PowerShell 中调用系统 `netstat.exe -ano -p TCP` 精确匹配本端/对端数字地址、端口与连接状态，仅接受唯一正整数 PID，再通过 `[wmi]` 直接绑定 `Win32_Process.Handle` 并调用 `GetOwnerSid()` 核对当前 Windows 用户 SID（避免 TCP WMI provider 和全量进程枚举耗时）。整个查询超时 5 秒，任何失败或匹配不唯一均拒绝放行，绝不降级信任 `/api/health` 自报的 PID/`dataDir`/`serviceId`。

进程路径归属在 Windows 下统一转小写校验：打包版 exe 须位于当前 `resources/app(.asar)` 安装根下；Node 须直接启动本安装根 `src/server.js` 的绝对路径；Electron 须直接启动本安装根或 `src/electron/main.js`。相对路径、参数中夹带的根路径或同名可执行文件均不足以授权。

发出关闭请求后保留 7.5 秒 / 120 ms 轮询的端口释放等待（覆盖 Electron 渲染进程刷盘）。若端口仍被占用，须重新查询实际监听者，仅当 PID、创建时间与精确归属均与等待前一致才允许发送 `SIGTERM`；`/api/health` 自报的 PID 从不进入终止分支。无 Windows 系统证据时仍可通过挑战完成新版本优雅退出，但不强制终止；无法验证的旧版本或无权限场景保留占用者，随后的精确绑定直接报端口冲突。`.server-runtime.json` 仅用于当前进程跳过自身与清理本实例元数据，不作为网络对端身份证明。

**安全边界（H06 Browser Origin Boundary）**：主机校验在 `createServerRuntime()` 构造时执行，**先于任何文件系统或数据库副作用**。非环回地址被拒时直接抛错阻止启动，确保服务仅监听本地环回接口，防止局域网/公网暴露。

启动配置允许传入 `localhost`，但会统一归一化为 `127.0.0.1`；对外访问地址、Host 与 Origin 均以 `http://127.0.0.1:<实际端口>` 为准。由于浏览器将 `localhost` 与 `127.0.0.1` 视为不同 Origin，服务端不同时放行 `http://localhost:<端口>`，客户端应直接使用启动结果返回的 `baseUrl`，切勿自行替换主机名。

### 客户端外观 HTML 快照

`createServerRuntime({ getClientTheme, getClientFont })` 将主进程提供的只读外观回调传入 [runtime-transport.js](../../../src/server/runtime-transport.js) 与 [page-assets.js](../../../src/server/page-assets.js)。每次生成管理页（`/`、`/admin`、`/settings`、`/songs`）、组件预览（含静态 HTML 别名）或已授权 `/pages/gift-audit.html` 响应时，在 `<html>` 写入经过白名单校验的 `data-client-theme`、`data-client-theme-mode`、`data-client-theme-surface` 和 `data-client-font`，并在 `<head>` 注入 `/js/shared/client-theme-runtime.js` 与 `/js/shared/client-font-runtime.js`。配色随首帧生效，客户端字体在所选字族的本机资源就绪后应用。缺少回调或值非法时，配色使用 `terracotta`（暖陶，浅色实底），字体使用 `system`。模板与管理页片段缓存保持无请求状态，响应维持 `Cache-Control: no-store`。

该属性仅用于外观呈现，不授予权限；原有 `gift-audit` 授权检查保持不变，不注入管理员令牌。不向 `license`、`scene` 或任何叠加层注入主题，也不新增写 API、服务端通知或轮询。同一浏览器会话内已打开的工具分别通过 `BroadcastChannel` 实时接收新的配色与字体选择，其他会话在下次请求页面时读取已保存的外观。主进程存储与生命周期见 [desktop/main.md](../desktop/main.md)。

## 3. 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 服务绑定主机（`localhost` 自动归一化） |
| `PORT` | `3000` | 独立启动模式端口（兼容层读取） |
| `SONG_PLUGIN_DATA_DIR` | 仓库根 `data/` | 数据目录（数据库、token、缓存），见 [storage.md](storage.md) |
| `ELECTRON_DESKTOP` | 未设 | `'1'` 表示运行在 Electron 桌面模式，`/api/health` 的 `desktop` 字段据此报告 |
| `AUTO_OPEN_ADMIN` | 未设 | `'1'` 时尝试用系统浏览器打开 `/admin`；不签发或附带管理凭据，匿名访问仍返回 401 |

## 4. 请求管线

领域事件发布统一由 [runtime-transport.js](../../../src/server/runtime-transport.js) 适配：`publishGiftFlushed` 保持“快照 → 全屏礼物感谢”顺序且不逐条输出成功日志，`publishGiftCatalogUpdate` 发布目录快照，`publishDanmaku` 维护 feed 缓冲及 topic，`publishOvertimeUpdate` 保留可选 `adjustment`。`server.js` 通过读取回调将运行期依赖接入传输层，资源仍按“数据库 → 领域服务 → 音乐/直播/AI → 启动恢复”的顺序创建，在 `initializeApplication` 失败时统一释放；传输模块本身不管理这些资源的生命周期。

[http-server.js](../../../src/server/http-server.js) 的 `createHttpServer` 由组合根装配，HTTP 回调读取当前 `phase` 后按序分发：

1. **Host 头验证**（H06）：所有生命周期阶段先核对 `req.headers.host` 与运行时 `baseUrl`，不匹配返回 400。
2. `phase` 非 `ready` 时，仅 `/api/health` 返回 `{serviceId, phase}`；其他 Host 合法的 HTTP 请求返回 503，WebSocket 升级同样拒绝。
3. **许可门**：未授权时清理预览会话；`/`、`/admin`、`/settings`、`/songs` 重定向到 `/license`，除 health 外的 API 返回 423。
4. **Origin 验证**（H06）：对状态变更请求（`POST`/`PUT`/`DELETE`/`PATCH`），检查 `req.headers.origin` 是否在允许列表内（当前仅运行时 `baseUrl`）。无 Origin 头的非浏览器客户端（如 `curl`）放行；不匹配返回 403。不透明源（`Origin: null`）的 API 请求交由下述 scope 鉴权处理，绝不视为普通受信任来源。
5. `pathname === '/ws'` → 直接返回 400（提示使用 WebSocket 客户端；协议升级走 `server.on('upgrade')`）；升级入口捕获 URL 解析异常，畸形 Host 或请求 URL 返回 400 并关闭连接，不影响服务进程。
6. `pathname.startsWith('/api/')` → 经 [inflight-tracker.js](../../../src/server/inflight-tracker.js) 接纳并跟踪，再调用 [api-routes.js](../../../src/server/api-routes.js) 的 `handleApi`，传入领域 context、预览会话及场景输出的许可/生命周期状态读取回调。
7. 场景文本图片、组件素材/导入网页、开播媒体/人物图及礼物图片缓存由各自 handler 直接读取 `dataDir` 下资源，不经过 `publicDir` 静态文件解析。组件导入网页的 CSP 与资源契约见 [组件样式库](api.md#组件样式库)。
8. 其余路径 → 传输适配器的 `servePageOrAsset`，再交由 [page-assets.js](../../../src/server/page-assets.js) 处理。

`server.on('upgrade')` 复用步骤 1–2 的严格 Host 校验与阶段门禁（`starting`/`quiescing` 返回 503，Host 不匹配返回 400），通过许可门后将 `/ws` 交由 `webSocketHub.handleUpgrade` 继续独立校验 Origin 与凭据；无 Origin 的非浏览器客户端同样必须匹配运行时 Host。`inflight-tracker` 仅统计进入 `quiescing` 前已接纳的 API handler，之后的 health/503 请求不进入排空集合。

桌面 API 写请求在接纳时捕获主进程 `getSceneOwner()` 提供的账号 scope 与授权代次，HTTP context 暴露本次请求的 `authorizeRequest`，常规路由经 `request.authorize()` 复核：JSON 请求体读完后先复核再执行领域逻辑；原始上传复用已有授权回调；设置更新在异步准备完成、写库前复核一次，在捕获器应用完成后、重新配置运行时和广播通知前再复核一次；随机点歌在观众资料解析完成、同步入队前复核；远端礼物清理返回后的本地清理、保留期下一批清理及异步礼物预览发布同样执行请求归属复核。

切换账号、退出重登及 A→B→A 均使旧请求失效，同账号 token 续期保持有效。该复核不会回滚切换前已提交的数据或已完成的外部操作，只阻止旧请求继续写入新账号数据、生成待上传快照或发布后续通知。Node 独立调试模式未注入账号回调时仅执行现有许可门禁，不会伪造桌面账号。专用画布与场景访问凭证继续执行各自的绑定校验。HTTP 错误契约见 [API 通用约定](api.md#0-路由机制与通用约定)；相关测试见 `test/server/http-account-isolation.test.js`、`test/settings/settings-service.test.js`、`test/songs/queue-random-request.test.js`。

**Host/Origin 与防嵌入辅助函数**（`http-utils.js`）：

- `validateRequestHost(req, runtimeBaseUrl)`：比对 `req.headers.host` 与运行时 `baseUrl` 的 `host:port`，确保请求目标与实际绑定地址一致。
- `validateOrigin(req, allowedOrigins)`：检查 `req.headers.origin` 是否在白名单内；无 Origin 头时返回 `true`（放行非浏览器客户端）。
- `addFrameProtectionHeaders(res, pathname)`：管理 HTML 禁止嵌入与启动 worker；overlay HTML 设置 `sandbox allow-scripts`，允许嵌入但不具备父 frame 同源权限；规范 URL 与原始 HTML 文件别名遵循同一规则。

### 4.1 API 路由分发

请求体累计超过预算后，读取器清除缓冲并丢弃后续数据，避免 Windows 关闭仍有未读数据的连接时重置错误响应；413 响应携带 `Connection: close` 与准确的 `Content-Length`，先写出完整错误响应再等待请求读完后结束连接；未完成的上传另有 1 秒强制回收上界（覆盖超量、大块缓冲、未发完及持续发送等真实 TCP 场景）。

稳定错误映射优先识别固定错误码，再接受归属模块明确设置的 `statusCode` 与 `publicMessage`（可公开业务提示由 [public-error.js](../../../src/shared/public-error.js) 构造）。仅有 `statusCode: 400` 的既有参数错误返回固定提示。加班机、播放存储、游戏、互动及音乐路由不再直接回传任意 `error.message`；未分类异常由 HTTP 入口记录脱敏诊断并固定返回 500 `Internal server error.`。音乐已知业务失败沿用 501，上游原始消息与 Cookie 诊断仅留在内部错误中。

读取器以 `REQUEST_BODY_TOO_LARGE` / `statusCode: 413` 标记限额异常；包裹 body 读取的领域路由必须原样透传该异常及请求归属复核产生的 `REQUEST_AUTHORIZATION_CHANGED`，不得重新归类为参数、导入或上游失败。

[src/server/api-routes.js](../../../src/server/api-routes.js) 保持无状态，业务依赖全部由 context 注入：

- 路由模块按 `ROUTE_MODULES` 数组顺序前缀匹配（完整端点清单见 [api.md](api.md)）。
- **专用访问凭证路由**：组件预览中继、预览素材接口以及场景输出/通知先交由各自 handler 校验管理身份、绑定预览会话或场景访问凭证。这类凭证不进入通用 principal，也不能调用任意领域接口，详见 [API 契约](api.md)。
- **常规领域身份与权限**：[access-policy.js](../../../src/server/access-policy.js) 从 Bearer 或 query 凭据解析冻结的 `admin` 或 `overlay(scope)`（凭据规则见 §7）。显式 `Authorization` 优先，无效头不回退 query；空运行密钥默认拒绝。除 `GET /api/health` 匿名可用外，overlay 先校验精确 method/path，再进入 [overlay-http.js](../../../src/server/overlay-http.js) 的受限参数适配与字段投影；无效凭据返回 401，跨 scope 或调用管理接口返回 403。时钟与开播配置由各自页面访问凭证读取。
- **405 与 404 区分**：`findRoute` 在模块前缀命中但方法不匹配时标记 `pathExists` → 405，否则返回 404。
- **请求体惰性读取**：`createBodyReader` 仅在 handler 实际调用时读取一次 JSON（[api-routes.js:42-47](../../../src/server/api-routes.js#L42-L47)），上限 `MAX_BODY_BYTES = 16 MB`（[server.js:35](../../../src/server.js#L35)），超限或非法 JSON 在 `readJsonBody` 中拒绝。
- **顶层异常兜底**：500 + `{ok:false, error}`。

### 4.2 API Context 注入

`server.js` 注入读取回调，由 [runtime-api-context.js](../../../src/server/runtime-api-context.js) 的 `createRuntimeApiContextFactory` 在每次请求时获取当前运行时依赖，再交 [api-context.js](../../../src/server/api-context.js) 构建 Context。Context 按歌曲、礼物、播放、互动等领域分组，并包含场景、动态抽奖、礼物卡片/心愿等端口；HTTP 入口另注入预览会话与场景可用性读取回调，避免将这些生命周期状态渗入领域服务。

AI 配置写入经 `ai-runtime.js` 的 `updateConfig()` 进入服务，提交成功后调用组合根注入的 `onConfigUpdated`，由 `cloud-sync-runtime.js` 的 `scheduleMenuSync()` 合并通知并比对当前菜单签名（失败不通知，无关配置不额外上传，AI 领域本身不依赖云同步）。`game-runtime.js` 的 `createGameAudience()` 负责在线榜与近期发言者的 UID 合并、名称选择、最近时间排序与当前胜者资料读取，由 `runtime-api-context.js` 显式装配，`api-context.js` 仅做端口映射。

场景输出不直接读取完整的 API Context。`server.js` 在领域服务、小游戏和转盘服务初始化完成后组装一次只读 `displayPorts`，注入 `scene-runtime.js` / `scene-extra-display.js`，仅开放设置读取、数据目录与状态、歌曲列表/版本、礼物版本/历史/盲盒统计、礼物卡片/心愿、小游戏/转盘/互动状态以及全局礼物目录等查询能力。其中 `gifts.getBlindBoxChangeToken` 接入盲盒版本确认，`games.getDisplaySession` 接入已协商调用方的画布与成绩增量读取（未协商调用方继续通过 `getSession` 读取完整状态）；共享外观读取复用 `settings`/`system` 与 runtime 自有云端弹幕读取器，外观写路由仍走独立 `settings` 写入上下文。场景运行时不经 API Context 反向引用自身，也无法获取 `sessionToken`、音乐注册表或停机控制权限。

场景管理的账号校验、修订号、发布与事务由 `scene-service.js` 负责；[scene-output-reader.js](../../../src/scenes/scene-output-reader.js) 负责输出读取、投影凭据与数据版本，异步读取结束后再次复核账号代次与来源凭据。[scene-capability-codec.js](../../../src/scenes/scene-capability-codec.js) 统一管理来源凭据的签发、加密内容校验与 token 比较，供管理与输出两条路径共用。

[scene-room-profile.js](../../../src/server/scene-room-profile.js) 负责场景房主资料的账号/房间缓存、异步读取与公共字段投影，`scene-runtime.js` 负责装配并补入云端快照。缓存键包含账号 scope/epoch、本地配置房号、房间配置代次及云端房号。排队读取启动前与结果回填前均复核绑定。内部 `getRoomProfile({ expectedRoomId })` 通过同一次 `room_init` 的配置输入、标准长号或 `short_id` 核验云端房号，确认不匹配时清空资料。公开投影仅含四个字段，`roomId` 为标准长号。有读取需求且距上次成功满 10 分钟时复查。网络失败保留同一绑定的上次结果，重试间隔从 30 秒倍增至最多 10 分钟。换号、换房和运行时销毁使旧结果失效。已发出的上游请求会自行结束，返回后忽略过期结果。见 [B 站房间解析](bilibili/protocol.md) 和[弹幕房主资料](../frontend/overlays.md)。

### 4.3 静态页面服务与访问凭证

[page-assets.js](../../../src/server/page-assets.js) 的 `servePageOrAsset` 按 [access-policy.js](../../../src/server/access-policy.js) 固定页面表解析 scope：原始 HTML 与规范 URL 同权，路径必须严格留在 `publicDir` 内，禁止包含冒号的文件别名（防止 Windows NTFS `::$DATA` 将 HTML 伪装为普通资源）。

- 管理组合页与原始管理片段要求管理身份，任何 HTML 均不内嵌管理令牌。管理页 CSP 额外设置 `worker-src 'none'`（详见 [desktop/auth.md](../desktop/auth.md)）。Electron 主进程为受信主窗口请求自动附加认证头；独立 Node 调试脚本须自行携带 Bearer 令牌，匿名浏览器无法访问管理入口（总契约见 §7）。
- 仅 `access-policy.js` 登记的 overlay 页面在普通独立来源模式下注入 [overlay-bootstrap.js](../../../src/server/overlay-bootstrap.js) 与该 scope 的访问凭证，`window.__API_TOKEN__` 仅代表本页权限；组件预览子页不注入该凭据。`fetch` 包装保留 `Request`/`Headers` 语义，仅为精确本机 origin 的 API 自动附加认证头；WS 仅向精确本机 `/ws` 附加 query 凭据，外域、异端口与相似路径不携带凭据。
- overlay HTML 返回 `Content-Security-Policy: sandbox allow-scripts`（不含 `allow-same-origin`）。公开静态 JS/CSS/字体等返回 `Access-Control-Allow-Origin: *`，`servePageOrAsset` 返回的 HTML 不开放跨域读取。导入的 `/component-web/` 资源由独立 handler 设置 MIME/CORS，HTML/SVG 响应额外施加 sandbox、禁用 object 与表单提交，不注入 LIRA 凭据。API 的不透明源（`Origin: null`）预检仅描述 overlay 已知路径/方法/头，实际请求仍校验 scope，管理凭据的 `Origin: null` 请求一律拒绝，无 cookie 或 `allow-credentials` 例外。
- 浏览器源会话恢复：本机 WS 断开或 API 返回 401 后，使用旧页面访问凭证探测其最小 `/api/state`，仅再次收到 401 才触发整页刷新（该错误响应可被不透明源页面读取，但不能借此读取业务数据）。探测实行请求合并、5 秒超时，离线/启动中/凭据仍有效时不刷新，`pagehide` 时取消探测。
- 页面响应维持 `Cache-Control: no-store`。仅已认证管理组合页的实际 GET 请求分配 `__PLAYBACK_SNAPSHOT_WRITER__`；HEAD、未授权页面、原始片段与 overlay 均不改变播放代次。该字段仅用于顺序控制，不作为认证凭据。

基础请求/响应读写与 Host/Origin 校验由 `http-utils.js` 负责，页面组装、凭据/主题注入及防嵌入策略由 `page-assets.js` 负责，礼物图片缓存响应由 `gift-image-http.js` 负责；`http-server.js` 直接装配上述处理器，不在通用工具层聚合领域逻辑。

开播音频与人物图的文件流由 [opening-media-http.js](../../../src/server/opening-media-http.js) 负责：GET 在源文件成功打开后发送 200，打开前文件消失返回 404，其他打开错误返回不含内部路径的 500，发送响应头后的读取失败直接终止响应；客户端提前关闭时销毁源流，HEAD 仅返回元信息。该处理覆盖 `stat` 后文件消失的竞态，但不保证并发替换文件时的内容快照一致性（测试见 `test/overlays/opening-media-stream.test.js`）。

公开静态文件通过文件流发送，支持 `HEAD` 和 `If-None-Match`。带有效内容摘要的托管资源允许浏览器长期缓存。未指定内容版本的公开文件按 `ETag` 重验。安装包内的文件按真实 ASAR 的版本和成员路径校验，同一安装包重启后仍可返回 304。包外文件按各自的文件属性校验。HTML、动态字体样式和状态接口使用 `no-store`。

## 5. 领域服务装配

[domain-services.js](../../../src/server/domain-services.js) 的 `createDomainServices` 组合本地领域服务并注入各自存储端口，主要产出：

| 领域 | 组成 | 详情文档 |
| --- | --- | --- |
| `songs` | `song-service` 封装（`save`/`list`/`find`/`pickRandom`/`count`…） | [music/services.md](music/services.md) |
| `queue` | `queue-service`（快照/加歌/动作/启动清理） | [music/services.md](music/services.md) |
| `gifts` | `gift-service` + 消费者注册表（加班机消费者） | [bilibili/gift.md](bilibili/gift.md) |
| `overtime` | `createOvertimeService({store, onUpdate})` | [overtime.md](overtime.md) |
| `superChats` | `superchat-service` | [bilibili/gift.md](bilibili/gift.md) |
| `messages` | [message-application.js](../../../src/server/message-application.js) 负责命令优先级、点歌结果登记与自定义回复选择；签到、抽签命令返回 `cloud-owned` | [bilibili/danmaku.md](bilibili/danmaku.md) |
| `customReplies` / `requesterTargets` | 本地关键词回复与点歌目标识别 | [bilibili/danmaku.md](bilibili/danmaku.md) |
| `dailyBotLegacy` | 旧签到/抽签数据只读导出，供显式迁移；不执行机器人 | [bilibili/danmaku.md](bilibili/danmaku.md) |
| `fans` | 本地粉丝档案与点歌事实处理 | [storage.md](storage.md) |
| `giftWishes` / `heartBoxCollection` / `overtimeGiftCatalog` | 本地礼物许愿、心动盲盒每周收集与共享礼物目录；收集服务复用许愿存储的窗口聚合 | [bilibili/gift.md](bilibili/gift.md)、[overtime.md](overtime.md) |
| `data` | [data-maintenance-runtime.js](../../../src/server/data-maintenance-runtime.js) 负责清库后运行状态恢复、来源选择、保留策略与 schema 版本缓存 | [storage.md](storage.md) |
| `playback` / `theme` / `cooldowns` | `playback-store` / `theme-store` / `cooldown-store` | [storage.md](storage.md) |

**动态抽奖运行时**：由 [dynamic-lottery-runtime.js](../../../src/server/dynamic-lottery-runtime.js) 组装专用账号端口、`lotteryDb` 存储层、串行请求预算与领域服务，`server.js` 仅持有资源句柄并向路由注入精简接口门面。启动或切换账号后，首次处理当前账号的抽奖请求时将中断的采集与开奖恢复为暂停并清理历史场次，不自动请求 B 站；库不可用时仅禁用该功能。关闭数据库前先取消并排空抽奖任务；独立 Node 启动缺少 Electron 专用账号端口，返回桌面版限制提示。认证生命周期的取消信号由专用账号模块提供，runtime 在创建或执行任务前等待已取消的旧任务释放占用并复核操作身份；取消传递到网络请求与退避但不清空请求预算，详见 [动态抽奖专用账号](../desktop/auth.md#14-动态抽奖专用账号)。

**启动时数据修复链**仅在精确端口绑定成功后执行：`createDatabases` / schema migration → `settingsBootstrap` 设置迁移 → runtime 装配 → 旧 `giftEffectResolver` 按显式兼容 API 惰性加载 → `ensureCategory('默认')` → `queue.ensureUnified()` → `startRetentionMaintenance()`。保留期维护启动时立即检查一次，之后每小时检查一次；每次读取最新设置，仅在 `autoRetentionOnStartup === 'true'` 时执行，失败仅记警告，不阻断启动或后续维护。未完成点歌保留数据库中的 ID、置顶与排队顺序，历史 `current` 态归位为 `waiting`；重启不清空队列，完成与清空由显式队列操作控制。旧本地礼物不再重新解析或合并，`/gift-effects` 实时路径不再预热或使用旧媒体映射。

**运行时组件装配**：音乐 Provider 注册表、目录服务、歌词服务、歌词状态与 WeSing 采集由 `buildMusicRuntime()` 负责；AI 配置、配额、统一模型入口、豆包适配器、ChatGPT 会话与客户端、工具、上下文清理、投递校验及请求日志由 `buildAiRuntime()` 负责；Bilibili 登录缓存、客户端替换串行化、`liveStatus`、诊断缓冲和弹幕发送器由 `createBilibiliRuntime()` 负责。`server.js` 作为组合根只创建这些 runtime、连接广播与领域回调并控制启动与逆序关闭。通道启停策略：本地弹幕客户端跟随 `danmakuMonitoringEnabled`（兼容旧数据 `enableBilibili`），云端礼物入口由 `giftMonitoringEnabled` 独立控制（两项默认开启，存储与云同步将旧总开关维护为两项逻辑或并保留旧的显式停用）；服务端仅切换通道时原地更新 `RoomMonitor`，两项均关闭才停止共享连接，已接受礼物继续完成结算（远程礼物协议见 `specs/server-authoritative-gift-detection_design.md`）。

音乐目录与歌词分别经 `music.catalog`、`music.lyrics` 接入 API Context；WeSing 与外部播放器在线补词分别注入 `catalogService` 与 `lyricsService`。匹配路由直接调用 `song-matcher.js`，健康检查直接调用 `music.registry.healthCheck`，详见 [音乐领域服务](music/services.md)。

[gift-sync-runtime.js](../../../src/server/gift-sync-runtime.js) 负责礼物同步和保留存储的创建、就绪状态、历史/实时导入及本地清理顺序；`server.js` 仅注入礼物数据库与两个导入回调，并在关闭时释放引用。来源选择、导出准备与卡片缓存仍由 `gift-export-runtime.js` 负责。

## 6. 启动与关闭时序

`bilibiliRuntime` 的客户端替换按请求串行执行。替换请求、禁用监听、显式断开和关闭会同步递增运行代次并停止当前客户端；排队任务在开始和登录信息读取完成后复核代次，旧代次不再创建客户端、派发业务/状态回调或传播过期重连错误，重新启用后仅运行当前请求。

### 6.1 启动（`startServer`）

1. 无 I/O 校验端口参数；`createServerRuntime()` 仅保存配置并创建未监听的 HTTP server，不创建数据目录、数据库、token 或日志。
2. `cleanupOwnPortOccupant` 请求可信旧实例关闭并等待端口释放。
3. `listenExactly` 绑定精确端口，`phase` 进入 `starting`；此时仅最小 `/api/health` 可用，其余请求返回 503。
4. 打开/迁移数据库，装配 domain/music/Bilibili/AI runtimes，执行数据修复、默认曲风与队列清理。后台保留期维护由 `startBackgroundMaintenance()` 启动（桌面传 `deferMaintenance: true` 等待窗口可用）。礼物专用与通用 `giftDb` 维护共用 `gift-sync-runtime` 入口，关闭时先停止计时器与后续批次。
5. 生成 `sessionToken`，写入 `.session-token` 与 `.server-runtime.json`，原子切换 `phase` 为 `ready`。
6. `AUTO_OPEN_ADMIN=1` 时尝试打开管理页（同步异常和子进程异步 `error` 仅记提示，不中断服务）。最后调用 `bilibiliRuntime.reconnect()` 建立本地 Bilibili 连接（礼物采用 §1 所述远端投影通道，本地消息仅保留非礼物功能与用户身份提示）。

启动失败时先进入 `quiescing`，删除本实例创建的 token/runtime 文件并清空内存 `sessionToken`，随后清理已创建的 runtime、数据库与 listener，再复位启动状态并重抛原始错误。`startPromise` 实行请求合并（并发调用返回同一 Promise）；`isShuttingDown` 期间拒绝新启动。

`disposeApplication` 先撤销保留期维护定时器，再按既定顺序逐步清理各资源，每步独立捕获并记录失败后继续后续步骤（包括数据库关闭）。启动失败清理中的领域异常不会覆盖最初的启动错误，也不会阻止 listener 关闭与 `startPromise` 复位；清理完成后允许重新启动。资源清理采用尽力而为策略：某一步抛错时记录日志并继续释放其余资源，但不保证出错资源自身已完成释放。

`createDomainServices` 在完整返回前负责部分装配回滚，依次释放已取得的 gift runtime、hybrid catalog、本地 catalog 与 overtime；单步清理失败记警告后继续，保留原始装配错误。overtime 恢复中断时取消已创建的归零/重试定时器。hybrid 的终止 `dispose()` 移除本实例的 initializer 监听器并停止自有 remote cache，保留外部借用对象；正常可恢复的 `start()` / `stop()` 契约不变。数据库、`settingsStore` 与 resolver 的关闭仍由外层负责；清理不重置已持久化的倒计时或礼物状态。

### 6.2 关闭（`shutdownApplication`）

按以下顺序执行：

1. 同步切换 `phase` 为 `quiescing`，撤销保留期维护定时器，令 `inflight-tracker` 停止接纳新 API；listener 继续占用端口作为数据库独占边界。
2. 等待正在进行的启动结束，停止 Bilibili 连接与 WebSocket 新入口，并调用 `webSocketHub.stop()` 广播关闭消息与回收已升级连接（超时销毁细节见 [ws.md §1](ws.md#1-传输层手写-rfc-6455)）。
3. `preShutdownHook()` 经 Electron IPC 刷新渲染进程播放状态（此时数据库仍开放）。
4. 排空 `quiescing` 前已接纳的 HTTP handlers，释放 `gameSessionService` 与 `wheelSessionService`，再执行 `aiRuntime.shutdown()`（详见 [ai.md §10](ai.md#10-持久化与故障行为)）。
5. `gifts.dispose()` 清理消费者重试定时器（不收尾 `progress` 礼物），停止 `overtimeGiftCatalog` 刷新定时器，执行 `overtime.dispose()`、`weSingCapture.stop()`。
6. `optimizeDatabases(db)` → `closeDatabases(db)`。
7. 执行 `server.close()` + `closeAllConnections()` 释放端口（须等待 hub 完成已升级连接回收），随后删除本实例创建的 `.session-token` 与 `.server-runtime.json`。
8. 若任一调用传入 `stop({exitProcess: true})`，则在关闭完成后执行 `process.exit(0)`；后续 `false` 不撤销退出要求。

独立模式下 `SIGINT` / `SIGTERM` / `SIGHUP` 均触发 `shutdownApplication()`。`shutdownPromise` 实行并发复用：重复调用共享同一次关闭流程，但不会丢弃后续传入的退出要求——关闭期间到达的退出请求会等待刷盘、在途请求排空与资源释放后再执行；关闭完成后才到达的退出请求则立即退出，全程最多调用一次 `process.exit`。该流程不包含超时强杀，Electron 的 5 秒最终兜底仍由桌面主进程控制。

## 7. 会话凭据与访问凭证

- 每次启动随机生成管理 `sessionToken`，落盘 `data/.session-token`（权限 `0600`），关闭时删除；不传给渲染进程、HTML、URL 或其他 Electron 窗口。管理页面凭据的 Electron 主进程自动注入策略见 [desktop/auth.md](../desktop/auth.md)。
- 每个已登记的 overlay scope 使用 `ov1:<scope>:<HMAC-SHA256>` 格式的专属访问凭证，签名绑定本次运行密钥与固定命名空间，scope 来自服务端白名单。校验采用恒定时间比较，重启后全部旧访问凭证失效；持有某页凭证不能更改 scope 或调用管理接口。
- 本机页面 URL 保持匿名可打开，因此能访问相应页面的客户端可取得该页公开展示/互动权限；该机制仅用于页面级权限隔离，不用于校验操作者是否为主播本人。游戏停止/重开、落子/绘画和转盘抽取继续可用，接口权限清单见 [api.md](api.md)，WS 出口见 [ws.md](ws.md)。
- `GET /api/health` 匿名仅返回 `{serviceId, phase}`；仅有效管理凭据可读取 `ready` 诊断详情，overlay 凭据无权读取。合法 `X-Lira-Instance-Challenge`（64 位小写十六进制）可在 `ready` 阶段取得绑定运行密钥、端口与挑战的 `instanceProof`，但证明本身不能授权 API；`starting` / `quiescing` 阶段不返回证明，也不访问未就绪或已关闭的数据库。

## 8. 系统指标

[src/server/system-metrics.js](../../../src/server/system-metrics.js) 的 `getSystemMetrics(rawWindowMs = 5000)` 采集默认 5 秒窗口内的 CPU、内存与 GPU（Windows 下通过 PowerShell 采样 GPU 引擎）指标，经 `/api/system/metrics` 暴露（见 [api.md](api.md)）。GPU 命令因需启动与枚举计数器，统一由子进程超时限制为“采样时长 + 10 秒”；CPU/内存取样完成后等待 GPU 返回，不提前丢弃有效结果。`windowMs` 用单调时钟记录 CPU/内存的实际采样毫秒数，`sampledAt` 记录该窗口结束时的系统时间，两者均在等待 GPU 结果前取得。GPU 命令超时、计数器不可用或解析失败时返回不可用状态和 `null`，不伪装为零负载。

[hardware-summary.js](../../../src/server/hardware-summary.js) 的 `createHardwareSummaryService()` 负责硬件信息探测与缓存，由 `runtime-api-context` 在运行期装配时创建一次，所有请求复用其 `getHardwareSummary(includeTemperatures)`。它读取操作系统版本、CPU/物理 GPU/内存型号与容量并排除虚拟显示适配器。并发请求共用一次静态查询，成功结果按服务实例缓存。Windows 设备查询失败时，本次返回 Node `os` 基础信息，下次请求重试。显示器列表按需读取，5 秒内复用。Windows 系统名称与主 build 来自 `Win32_OperatingSystem.Caption/BuildNumber`，功能版本与补丁修订号来自 `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion` 的 `DisplayVersion`（缺失时取 `ReleaseId`）和 `UBR`；查询失败时保留 Node `os.version()` 的名称与 Windows `os.release()` 的主 build，不根据 `10.0` 内核版本推断为 Windows 10，也不为缺失的修订号伪造 `.0`，且系统资料查询失败不影响同次硬件读取。返回字段见 [系统域 API](api.md#1-系统域system)。仅在 `/api/system/hardware?includeTemperatures=true` 显式请求时为 NVIDIA GPU 短暂调用 `nvidia-smi`。按型号匹配温度，忽略大小写。只有设备清单与温度输出两边都唯一匹配且读数有效时才返回摄氏度，其余返回 `temperatureCelsius: null`。不启动常驻监控进程，也不返回序列号。

GPU 的 `videoMemoryBytes` 为驱动报告的专用或预留显存，不含核显动态共享的系统内存。Windows 静态查询按显卡对应的驱动注册表项读取 64 位 `HardwareInformation.qwMemorySize`；缺失时仅采信低于 4095 MiB 的 `Win32_VideoController.AdapterRAM`（旧字段为 32 位，4095 MiB 及以上可能已饱和），无可靠容量时返回 `null`，避免将 8 GB 等显卡误报为 4 GB。
