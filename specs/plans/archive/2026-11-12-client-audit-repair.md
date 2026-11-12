# Client Audit Repair Implementation Plan

Status: Completed

**Goal:** 修复 2026-11-12 本轮客户端审计确认的五项产品问题、正式安装脚本被忽略的交付隐患和两项测试维护问题。

**Architecture:** 保留现有 Electron/Node 模块化单体。HTTP 请求复用可信 scene owner 的账号 scope/授权代次，在既有异步提交边界校验；前端状态仍归所属控制器，SC 能力归现有样式注册表。

**Tech Stack:** Node.js 24+、Electron 43、原生 JavaScript ESM/CommonJS、node:test 与现有 Chromium 测试夹具。

## Scope and constraints

- 用户已直接授权修复，沿用三个审计子代理分工实施，主代理整合及最终审查。
- 工作区为 `D:/Work/Live` 的 `main`，已有大量未提交工作；不新建分支、不暂存、提交或发布。
- 每个文件编辑前用 `tmp/client-audit-repair-2026-11-12/capture-before.cjs` 保存本任务起点，保留其他工作改动。临时复现和日志留在该 tmp 目录。
- 不处理审计中排除的猜测，不为文件行数拆模块；图片签名下沉、IPC registrar、scene-cloud DTO 等可选整理不扩入本轮。
- 不改变存储结构、现有成功响应、页面路径和用户操作；过期账号写入应拒绝，正常同账号请求继续工作。
- 安装宏重定义已经由其他工作消除，本轮只保留必要验证；首次迁移 EPERM 根因不明，不增加猜测性重试。

## Current evidence and intended behavior

审计临时报告和复现仅是故障证据。目标行为来自用户本次修复要求及现行 `docs/reference/backend/server-core.md`、`backend/api.md`、`frontend/app.md`、`frontend/overlays.md`、`frontend/playback.md` 和 `engineering/test.md`；不把 tmp 报告当成规范。

1. 已准入的旧 HTTP 写请求不能在账号或授权代次变化后提交到新账号。现状在延迟 body 和 settings 的 WeSing 文件准备后均可复现串号。
2. 弹幕发送界面只接受最新状态读取的结果、错误和忙闲更新；过期读取不得触发重连或恢复旧账号状态。
3. 同 preset 的队列素材包变化需要更新实际布局。
4. Stardust 参数/画布预览与实际 scene 的 SC 能力一致，其他样式行为保持现有合同。
5. ASIO 二次枚举后过期选择不能改设备列表、选择或持久偏好。
6. 正式 NSIS include 能进入正常 Git 暂存；测试分组反映实际 Electron 依赖，登录测试观察当前 owner 的行为。

## Ownership and milestones

### M1: HTTP account binding

Owner: backend agent. Sources: `src/server.js`、`src/server/http-server.js`、`api-routes.js`、`http-utils.js`、`settings-service.js`、`bilibili-runtime.js`、`src/music/wesing-capture-engine.js` 和有跨 await 提交的相关 `routes/`。

- 捕获已有 `getSceneOwner()` 的可信 scope/epoch；不信任 payload 账号字段，不建立第二套身份状态。
- 将同一请求的授权断言带到惰性 body 读取后，以及实际异步准备后的持久化/入队/删除前。原本已有 authorize 回调的原始上传复用该边界。
- 同步领域函数维持其接口，storage 不依赖 server。失授权和代次变化使用稳定公开错误映射。
- 正式回归复用 HTTP transport、内存设置/歌库 fixture，涵盖延迟 body、完整 body 后的 WeSing 等待、A→B→A、失授权、正常同 owner；相关异步清理提交点单独补集成验证。
- 交叉复核确认独立 WeSing configure/offset 入口也会在异步目录准备或队列等待后保存本机设置；同一授权断言传给既有 setter，在保存和应用前复核。本机路径/偏移仍不是租户数据，不新增存储作用域。
- 文档 owner：`docs/reference/backend/server-core.md`、`docs/reference/backend/api.md` 和 `docs/reference/backend/music/wesing.md`。

### M2: Danmaku state and preview

Owner: danmaku agent. Sources: `public/js/admin/danmaku-tool.js`；`public/js/overlays/queue.js`、`danmaku.js`、`scene-danmaku-display.js`、`danmaku-message-renderer.js`；现有前后端 `danmaku-style-options.js` 注册表及生成镜像。

- 状态读取增加当前请求代次，首读和重连补读的 await 后先验证，再操作界面/重连；catch/finally 同样归属当前读取。
- 队列缓存包含实际资源配置身份。
- SC 资格收敛为注册表能力及共享谓词，保留显式 fullscreen 参数和 sinking 的现有实际路径。
- 扩展现有 `frontend-admin-danmaku.test.js`、`queue-overlay-esm.test.js`、`danmaku-local-preview.test.js`，覆盖原故障行为，不复制静态清单断言。
- 文档 owner：`docs/reference/frontend/app.md` 和 `docs/reference/frontend/overlays.md`。

### M3: Output preference, installer source and test maintenance

Owner: desktop agent. Sources: `public/js/playback/features/output-device.js`、`.gitignore`、`scripts/run-tests.js`；相关 `test/playback/output-device.test.js`、`test/bilibili/bilibili-startup-wiring.test.js`、`test/engineering/run-tests.test.js`。

- ASIO 第二次枚举先存局部变量，核对 disposed/revision 后再提交 devices/selected 和偏好；回归延迟枚举与 storage 新选择交错，及销毁后不得落盘。
- `.gitignore` 只放行现有 `build/installer-per-user.nsh`，不重写脚本或暂存。
- `desktop-user-data-electron` 加入 desktop 组；现有依赖分组检查识别直接 Electron 引用。
- 旧 main 源码正则改为真实 cloud-sync-controller 登录成功/取消行为测试，复用现有 fixture。
- 工程测试文档同步分组。播放规范已有过期结果和 storage 不写回合同，不重复改写。

## Verification and execution checkpoints

- 各 owner 先核对现有实现与覆盖，写最小回归并确认能拒绝旧行为，再完成局部修复。
- 编辑时不运行依赖这些输入的长测试。所有分工进入验证阶段后冻结相关输入，集中运行完整相关测试文件；记录输入变化使哪轮证据失效，避免盲目重跑。
- M2 完整文件：`test/danmaku/{frontend-admin-danmaku,danmaku-local-preview,danmaku-entry-display,danmaku-message-renderer,danmaku-style-options,danmaku-overlay-fullscreen}.test.js`、`test/songs/{queue-overlay-esm,frontend-queue,queue-overlay-responsive,frontend-queue-scrolling}.test.js`；先用同选择器 `npm test -- --list --file=...`，再执行；运行注册表镜像 check。
- M3 完整文件：`test/playback/{output-device,native-output}.test.js`、`test/bilibili/bilibili-startup-wiring.test.js`、`test/engineering/{run-tests,installer-static}.test.js`，同样先 list；验证分组列表和 `git check-ignore`。
- M1 首批 20 个完整文件：`test/server/{http-account-isolation,server-smoke,http-websocket-boundary}.test.js`、`test/settings/settings-service.test.js`、`test/songs/{queue-random-request,song-import-update}.test.js`、`test/transport/{http-server-errors,http-utils,component-preview,component-preview-renewal}.test.js`、`test/scenes/{component-styles,scene-text-media}.test.js`、`test/overlays/opening-upload-api.test.js`、`test/ai/ai-routes.test.js`、`test/wesing/wesing-routes.test.js`、`test/games/game-routes.test.js`、`test/bilibili/bilibili-danmaku-send.test.js`、`test/gifts/{gift-effect-danmaku,gift-ledger-maintenance}.test.js`、`test/storage/retention.test.js`。命令使用 `npm test -- --list` 加逐个 `--file=完整路径` 确认，去掉 `--list` 执行；不使用真实账号或用户数据库。
- WeSing 复核补丁只补验 `test/wesing/{wesing-capture,wesing-routes,wesing-capture-refresh,wesing-lifecycle}.test.js`、`test/server/{http-account-isolation,server-smoke}.test.js`、`test/settings/settings-service.test.js` 和 `test/songs/queue-random-request.test.js`，其余有效结果复用。
- 主代理运行受影响 JS 语法、`npm run verify:docs`、`npm run verify:architecture`，审查本任务起点差异与 `git diff --check`。不默认跑完整 offline、完整 Electron 或安装器打包。
- 用户指南和交互式引导核对后，如操作路径和操作步骤保持准确则不改；本轮恢复既有合同，不新建 ADR 或重复规格。

## Failure handling and done when

失败时先定位本轮改变的 owner，集中修复并仅补失效相关检查；不得修改不相关失败、削弱有效断言、清理用户目录或回滚其他工作。需要撤销时按保存的任务起点逐段撤销本任务的改动，不使用 reset/checkout。

完成条件：五项复现不再成立且相关回归通过；正式安装 include 不再被忽略；登录行为测试与 desktop 分组一致；受影响技术参考已同步；验证边界、未做的硬件/完整安装验收明确；最终差异无额外格式化或无关重构。

## Results

- M1：23 个完整文件的最终有效结果 273/273 通过。首批 20 文件 229/229，9.76 秒，527 个输入前后哈希一致；交叉复核补齐专用 WeSing setter 后仅补直接消费者。增量唯一失败来自新夹具把默认路径假定为空，修正为启动时原值并隔离桌面采集后，`wesing-routes` 完整 4/4 通过，0.70 秒；531 个输入前后哈希一致。既有通过文件按消费者复用，没有盲目重跑首批。
- M2：10 个完整文件 115/115 通过，5.95 秒；843 个输入前后哈希一致，注册表镜像检查通过。其他会话随后修改发送面板导入的欢迎模块，本轮未改这些文件；只补跑 `frontend-admin-danmaku.test.js`，13/13 通过、4.37 秒，713 个相关输入前后哈希一致，其余九文件复用。
- M3：4 个完整文件 21/21 通过，0.27 秒；33 个输入前后哈希一致。全测试树停止编辑后，运行器完整文件另行 16/16 通过，21.77 秒。后续 WeSing 测试仍使用已有 Node helper，文件归组与运行器输入规则未改变，此结果保留。正式 NSIS include 已被 Git 发现，未暂存。
- 合并各文件最新有效结果：38 个完整文件、425/425 通过，0 失败/取消/跳过/待办；这不是全客户端测试集合。记录保存在 `tmp/client-audit-repair-2026-11-12/combined-test-summary.json`；完整执行器结果依次为 `run-OEzKzr`、`run-TZKqpy`、`run-yjr681`（发送面板由 `run-peDIao` 替代）、`run-9rbbrT`（直接消费者由 `run-fBACpZ`、最终 WeSing 路由由 `run-caZA91` 替代）。
- 最终 JavaScript 语法覆盖 1,888 文件，增量执行 10、复用 1,878；检查器验证运行期间输入未变。架构 29/29、文档 10/10、仓库正常换行设置下 `git diff --check` 通过。归档移动后的文档链接另行复核。
- 主代理已对照任务起点逐项审查差异，桌面子代理另复核 HTTP 调用链并发现/促成 WeSing 遗漏修复，新增补丁已由主代理定点复核。产品代码、测试和六份所属技术参考同步完成；使用指南与交互引导的入口、步骤仍准确，未重复改写，未新增 ADR。
- 本轮沿现有模块修复，SC 能力归现有注册表；未新增依赖、账号状态框架或存储格式。源码已完成，未暂存、提交、打包或发布；未进行真实账号、声卡硬件、直播软件实播或完整安装器验收。临时验证服务和浏览器由所属测试收尾。
