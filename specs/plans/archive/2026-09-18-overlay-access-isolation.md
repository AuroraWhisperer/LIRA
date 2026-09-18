# Overlay Access Isolation Implementation Plan

状态：Completed（2026-09-18）。本阶段权限修复、相关验证和独立复核完成；完整仓库门禁的实际结果及并行失败见末尾，不宣称其他并行功能已通过。

**Goal:** 管理身份与每个 OBS/展示页面的能力分离，匿名页面拿不到管理凭据，跨页面能力默认拒绝，各页展示与既有游戏/转盘互动可用。

**Architecture:** 保留现有 Electron + Node 模块化单体。HTTP/WS 共用服务端 principal 解析和明确的 scope 合同；纯投影模块只输出消费者需要的字段；Electron main 独占管理凭据。展示页面 sandbox 与最小 CORS 配合阻止同源父 frame 借权。

**Tech Stack:** Electron 43.2、Node.js 24、内置 crypto/http、现有 WebSocket 实现、Vanilla ES modules、node:test；不新增运行时依赖、进程或监听端口。

## Requirements / Compatibility

- 来源：[已接受的权限决策](../2026-09-18-overlay-access-decision.md) 和审计 R4-HTML-TOKEN；用户明确各页面权限独立。
- 保留 overlay 正式 URL、各页展示及游戏落子/画笔/停止/重开和转盘抽取；仅管理端可编辑游戏/转盘配置、改设置、导入/清空/退出。
- 管理 token 不进入 HTML、renderer、URL、日志或其他窗口；保留 Electron context isolation、safeStorage、session partitions、IPC 来源检查和 local-media origin 检查。
- 精确 Host 和普通 Origin 检查不变；仅已认证 overlay 能以 opaque Origin 调用其允许的 API/WS。OPTIONS 仅描述可公开的 overlay 路径/方法，实际请求仍验证凭据。
- 不改持久化 schema；不使用真实用户数据库、凭据或上游服务。保留现有粉丝资料、礼物、签到等并行工作，不提交/建分支/发布。

## Current Behavior / Ownership

`http-utils.servePageOrAsset` 给任意 HTML 注入管理 token；`api-routes` 和 `ws` 只验证这一个 token；管理预览 iframe 与管理页同源。匿名歌词页获得的 token 能读取完整 `/api/state`。

| Owner | 文件及职责 |
|---|---|
| 主代理：HTTP/页面权限 | 新 `src/server/access-policy.js`（签发、principal、精确路径方法权限）；新 `overlay-http.js`（受限读取/操作适配）；`api-routes.js`、`http-utils.js`、`runtime-transport.js`（接线和页面引导）；相关真实 HTTP 测试 |
| song_import_cap：投影 | 新 `src/server/overlay-projection.js` 及必要的纯 DTO helper，完整消费者盘点和字段泄漏测试；不持有权限或运行状态 |
| playback_ordering：WS | `src/server/ws.js` 握手持有已验证 principal，所有 JSON 出口统一投影、过滤，拒绝 overlay 业务入站帧；真实 socket 回归 |
| license_safety：Electron | 新 `desktop-request-auth.js`，现有唯一 media request listener、main/desktop-runtime 接线；管理预览 iframe/postMessage；安全和真实隐藏 Electron 探针 |

源事实与边界文档：`docs/architecture/backend/{server-core,api,ws}.md`、`desktop/{auth,main}.md`、`frontend/overlays.md`。现有 scoped AGENTS 在对应 owner 编辑前读取。

## Public / Internal Contracts

```js
createOverlayToken(sessionToken, scope); // 本次运行有效的独立页面凭据
resolveRequestPrincipal(context, req, requestUrl);
// => Object.freeze({ type: 'admin' }) | Object.freeze({ type: 'overlay', scope }) | null
projectOverlayState(scope, state);
projectOverlayResponse(scope, pathName, data);
projectWebSocketPayload(principal, payload); // null = 不发送
```

- Scope 固定为 `queue`、`songlist`、`blindbox`、`overtime`、`gift-effects`、`gift-feed`、`gift-export`、`lyrics`、`games`、`danmaku`、`wheel`、`opening`、`clock`，规范 URL 与实际 raw HTML 解析到相同 scope。
- Token 为版本化 scope + HMAC；签发只接受白名单 scope，验证采用恒定时间比较。无密钥的 context 不可隐式授权。
- 管理请求优先读取显式 Bearer，已有 API query token 仅作自持凭据接口兼容；不在管理 HTML 生成任何 token。overlay 的 query token 只用于图片/WS 等不能设置 header 的请求。
- `GET /api/state` 对 overlay 返回本 scope 投影；专用 REST 同样投影。词库、隐藏答案、后台指标、数据操作和其他 scope 的端点不可达。
- 游戏 `POST /api/games/session` 仅允许 `action: stop|restart`；开始/配置不属于 overlay 能力。落子、绘画和转盘抽取按精确路由授权。
- WS 在校验真实凭据后才处理 Origin 与 topic；初始 snapshot、合并广播、专用事件、shutdown 和兼容出口均按 principal 处理。overlay text/binary 业务帧 close 1008，ping/pong/close 正常。
- 页面服务只给解析后的 overlay HTML 注入本页 token、sandbox 和恢复引导；静态脚本/样式/字体可跨 opaque origin 加载，HTML 不开放跨域读取。管理组合页与 raw 管理片段需要管理身份。

## Milestones / Checks

- [x] **1. 权限模型与页面引导**：先用真实 HTTP 复现匿名 HTML 含管理 token；实现 13 scope 签发/验证与路径方法表。测试 forged scope、过期运行密钥、错误 Bearer/query 优先级、raw aliases、匿名管理 HTML、HEAD 和目录穿越。
- [x] **2. HTTP 与字段投影**：按实际消费者 allowlist 实现 overlay handler；每个 scope 植入跨域秘密 sentinel，证明返回中没有管理字段/路径/未公开答案。有效本页读取/动作成功，跨页/管理写入拒绝；BODY 上限、CORS preflight 和 Origin:null 拒绝管理凭据均保留。
- [x] **3. WS 隔离**：真实网络验证每种 scope 的 initial/snapshot/event/inbound；伪造 query scope 无效，未知消息不发送，恢复和 shutdown 正常。
- [x] **4. Electron 可信引导与预览**：验证 main 初次空 frame URL 仅可导航管理 HTML；XHR/WS/beacon、许可恢复、reload 正常；其他窗口/子 frame/worker/detached/redirect 不获凭据。隐藏窗口临时 profile 实测父子 frame 隔离、opaque module/CORS 和展示配置消息。
- [x] **5. 集成与独立复核**：代理交叉审查鉴权/投影/生命周期，复现全部发现并闭环。更新单一事实源，执行聚焦测试、`npm run verify:contracts`、`npm run verify:quick`、`npm test`；最终 diff/status 检查与证据记录。

## Rollback / Failure Handling

仓库外 `D:/Work/lira-audit/current-review-2026-09-18/overlay-access-implementation` 保存源文件基线、状态、日志和消费者矩阵。失败保留现场，仅回退本任务的精确增量；禁止 reset、整文件 checkout 或删除并行文件。任何验证均不读取真实 profile/token，不调用上游服务。

## Done When

所有展示 HTML 无管理凭据；跨 scope 和后台访问由 HTTP/WS 服务端拒绝；桌面、预览及每页展示/既有互动经过匹配测试；sandbox 无父 frame 借权；重启旧凭据恢复、playback flush 和登录分区保持正确；本阶段合同与验证通过，完整仓库门禁结果、并行失败归属及平台实测局限明确记录，最终差异审查完成。

## Execution Record

- 已核实 current workspace 有其他并行任务；保留现有修改。三个既有 Astra 最高推理代理分别负责 Electron、projection、WS。
- 真实 Electron 43.2 临时隐藏窗口确认首次导航 frame URL 为空，但 frameToken/processId 可匹配；XHR、WS、beacon 与子 frame 可区分。
- 发现单靠 frame header 策略仍可能被同源 overlay 调用 parent.fetch，设计已加入所有 overlay 响应 CSP sandbox 和按凭据限制的 opaque-origin 访问。

- 独立真实 Electron 复核发现 dedicated/blob worker 的请求会被归到 admin mainFrame；仓库没有 Worker/Worklet 消费者，因此管理 HTML 增加 `worker-src 'none'`。不把 frame:null 桩测试当作所有 worker 的证明，真实探针补四类 worker 的 CSP 拒绝与零网络请求断言。

- HTTP 真实网络覆盖 13 个页面的规范/raw 路径、后台 HTML 拒绝、HEAD 不分配播放代次、失效密钥、跨页/管理接口拒绝、opaque CORS、参数范围和正文上限；对未知字段植入 sentinel 并核对 DTO 无泄漏。游戏 move 对象可以进入主持控制，已限制为既有数值/坐标字符串并回归 403。
- Windows NTFS `::$DATA` 可读取 HTML 却被错误分成普通资源，已拒绝含冒号的静态资源路径；真实 HTTP 回归通过。未证明该别名曾提供管理凭据或可执行脚本。
- WS 真实匿名 HTML → scoped token → socket 流程通过，initial/合并快照/专用事件/shutdown/兼容出口同权；通道订阅和客户端输入不授予权限。
- 投影测试连接真实游戏 owner 和共享礼物 banner 消费者。HTTP 恢复测试用临时数据库完成服务重启/换钥匙/页面重新连接；管理 HTML 无 token，正常 API 下载仍以管理请求头访问。
- 真实 Electron 43.2、临时 profile、本机合成服务：管理 main 的 sandbox:false 与导出窗口的 sandbox:true/offscreen 均对齐生产；精确 frame/session、初载/重载/许可页面切换、XHR/WS/beacon、外部重定向、父子隔离、四类 worker CSP 拒绝均通过。真实时钟模块/预览消息、开播音频解码、礼物头像与 artwork 解码和 capturePage 非空也通过。
- 该 Electron 探针没有启动完整 main.js 或真实许可服务；启动/退出接线另由测试桩和独立代码审查覆盖。未运行真实 OBS 客户端。没有使用真实用户 profile、上游账户、数据库或凭据。
- 三个 Astra 代理完成独立职责及交叉复核；move 对象、ADS、主页面 worker 继承三个发现均闭环。最后 worker 禁用由另一代理独立实测确认，未把管理页 worker 的继承权限误报为已证明的 overlay 提权。
- 聚焦 HTTP/WS/投影/恢复/启动退出/页面消费者检查均通过；主要真实 Electron 及相邻测试集合 72/72。完整语法扫描通过 891 个 JS，固定 Server revision `5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577` 的 5 个合同 fixture 通过，文档门禁 5/5。
- 共享工作区持续有签到、粉丝资料和礼物 UI 并行编辑。初次广测的旧 fixture/依赖桩/规格索引/文件大小失败已分清归属；只调整与本次鉴权或 main 集成相关的旧测试。一次完整运行遇到并行改造中的 UI helper 独立测试进程不退出，确认属于本任务的子进程后停止；helper 更新后单独通过，随后重跑当前完整门禁。不放宽限额，不回退并行内容。

## Final Verification / Remaining Boundary

- `LIRA_SERVER_ROOT=D:/Work/lira-audit/current-review-2026-09-18/remediation-2026-09-18/server-contract-fixture npm run verify:contracts`：通过，锁定 revision 的 5 个 fixture。
- `npm run verify:quick`：通过；文档 5/5、893 个 JavaScript 语法检查、架构 22/22。没有放宽门禁记录。
- 带相同 `LIRA_SERVER_ROOT` 的最新 `npm test`：2428 项，2423 pass、4 skipped、1 fail。本次权限相关用例通过。唯一失败来自并行新增 `test/daily-bot-frontend.test.js:49` 的接管确认流程：`#dailyBotOwnership` 不可见导致 Playwright 30 秒 check 超时（当次栈位置 84）。该 fixture 直接解析 `readAdminHtml()`、注入 mock bridge，未调用本次 HTTP/WS 鉴权，未为此修改签到业务或测试。
- 不能将上述完整测试记录描述为全仓绿色；相关单独集合、真实 Electron 二次独立验证、合同及 quick 均已通过。完整日志在仓库外 `overlay-access-implementation/full-tests-verified.log` 与 `quick-current.log`。
- 最终源代码/文档与测试 diff 已检查；`git diff --check` 通过，`git status --short` 保存为仓库外 `after-status.txt`，暂存区为空。本次没有提交、发布、改运行数据或覆盖并行修改。
