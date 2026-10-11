# 签到与抽签词库编辑实施计划

Status: Completed.

用户要求恢复编辑/预览、减少传输，并复用现有弹幕互动结构。

## Goal / Current Behavior

当前固定回复区只有云端开关；正式词库已经属于 Server 的租户数据库，旧本地词库不自动同步。恢复两个词库入口，编辑和预览在客户端完成，保存后服务器用于新的每日结果。

## Ownership / Decisions

- Server `daily-bot-store` 继续拥有事务和正式词库，`daily-bot-contract` 复用导入预检的词库规则，settings service/routes 负责认证后编排。
- 新增 GET/PUT `/api/device/daily-bot-libraries/:kind`。GET 可带 `version`（词库 canonical SHA-256），未变化仅回版本与 unchanged；PUT 只收 expectedVersion/library，只修改对应词库，不改变开关或每日快照。
- Electron 沿用 dailyBots IPC/controller 和固定远端路由，令牌留在 main。当前授权 context 内缓存两份已确认词库；renderer 保存会话草稿。账号/服务器/授权代际变化清缓存和草稿，不引入磁盘缓存或自动上传。
- UI 复用 fixed-replies 的展开、标题、收起和现有词库/预览 CSS。签到/抽签共用一个编辑器实现，保留各自草稿与分页。展开按需读取，已缓存版本只核对小响应；输入、分页、搜索、预览不请求服务器。
- 保存采用内容版本比较；重复保存相同内容幂等。冲突保留草稿并要求明确重新载入。保存过程中继续编辑不丢失；失败保留草稿。

## Compatibility / Non-goals

保留 DeviceBearer、租户隔离、IPC 来源校验、开关 revision、当日结果快照、旧导入与原始旧库。阻止活动导入期间编辑。无需新数据库/迁移/依赖/服务，不部署、不提交、不操作真实账号或真实数据库。保留两仓现有未提交修改。

## Milestones / Verification

- [x] Server：复用词库校验，增加条件读取/原子保存；扩展现有 store/settings/http tests，验证同日快照、幂等、冲突、鉴权/租户隔离及 OpenAPI。
- [x] Desktop：增加受限 IPC actions、响应投影和 context 缓存；扩展 takeover/controller tests，验证条件读取、迟到账号响应和固定路径。
- [x] UI：复用面板结构，添加增删改、分页/搜索、本地预览与独立保存；扩展 daily-bot-frontend tests 验证请求次数、冲突、失败、编辑中保存与账号切换。
- [x] 同步 cloud-daily-bots 规格、frontend/desktop reference、用户指南、Server protocol/OpenAPI/requirements/acceptance 与 ADR。
- [x] 隔离 Electron 检查真实 preload/IPC、两种词库视觉与交互；所有合成数据和截图位于 tmp。执行相关测试、两仓文档门禁、Live architecture gate，以及两仓 diff/check/status。

精确测试命令随实现登记；使用现有 Node test runner 与 test helpers，不启动用户正在运行的应用。

## Evidence / Review

- Server 使用仓库支持的 Node v24.18.0（系统 v24.21.0 超出其版本上限）；`--require ./test/support/test-mode.cjs --test test/daily-bot-store.test.js test/daily-bot-http.test.js test/daily-bot-settings.test.js test/daily-bot-runtime.test.js`：23 项通过。
- Live `node --test test/bots/daily-bot-takeover.test.js test/bots/daily-bot-frontend.test.js test/license/remote-license-client.test.js`：32 项通过；随后草稿载入竞争修正由该 frontend suite 的 5 项定向复验通过。
- Live 最终 `node --experimental-vm-modules --test test/bots/daily-bot-frontend.test.js test/danmaku/admin-danmaku-markup.test.js test/admin/admin-page-composition.test.js test/admin/admin-style-ownership.test.js test/admin/frontend-usage-guide.test.js test/danmaku/frontend-admin-danmaku.test.js`：44 项通过，含新增完整昵称/组合表情/四条限制预览检查。
- `node --test test/desktop/daily-bot-editor-electron.test.js`：1 项通过。正式 admin composition/preload/IPC 与鉴权、按需读取、纯本地编辑、保存、页面刷新复用 main 缓存、失败草稿和另一种词库均已核验；远端只用合成服务，不连接真实账号。
- `npm run check`：1439 个 JS 文件语法通过；`npm run verify:architecture`：27 项通过。
- 默认跨仓库门禁因相邻仓库 revision 与锁不符拒绝；改用已经存在的固定提交检出，`node scripts/verify-server-contract.js D:/Work/Live/tmp/guard-accompany-contract`：原锁定提交 01fb2b47 的 10 个夹具通过。设置 `LIRA_SERVER_ROOT` 为该检出后，`node --test test/bots/daily-bot-controller.test.js` 的 1 项跨仓库字节契约也通过。此项只证明原有契约基线；新增接口由当前 Server HTTP/OpenAPI 测试验证，未改变锁或提交。
- 独立功能复核发现显式放弃草稿后等待读取时新输入可能丢失，已用编辑代际修正并回归；新上下文的视觉 reviewer 返回 `ship`。设计 documenter 确认复用现有语义 token/固定回复/欢迎词库结构，无需新增设计系统文件。
- 两种最终桌面截图位于 `tmp/daily-library-visual-jrjHaR/`；用户指南截图只截取已核验的签到编辑区域。未发现该范围的横向溢出、标签换行或内容截断。
- 文档初次门禁发现计划状态标签格式及 HTTP 清单漏记，已补齐。Live `npm run verify:docs`：10 项通过；Server 以 Node v24.18.0 执行 package.json 的 `docs:check` 原始命令：50 项通过。两仓 `git diff --check` 通过，已审阅任务差异与 `git status --short`，保留其余已有修改。未引入运行数据或凭据。
- 隔离桌面测试进程已关闭，保留必要截图。未部署、提交、使用真实账号或执行真实 B 站发送；旧服务器需更新后才具备新词库端点。既有云端每日机器人全天实播验收仍由原计划跟踪，不属于本次编辑器交付。

## Failure Handling / Done When

只撤销本任务差异，不清理已有修改。网络错误不标记成功，不自动重放保存；旧服务器仍可使用原开关并提示词库功能需更新。完成条件是上述行为、对应自动化和隔离桌面检查通过，文档准确且最终 diff 已审阅；部署不属于本次完成条件。
