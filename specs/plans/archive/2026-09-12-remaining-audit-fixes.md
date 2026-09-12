# Remaining Audit Fixes Implementation Plan

**Goal:** 顺序修复剩余 13 个确认问题，复现 3 个怀疑项及加班恢复调度线索，逐项记录验证证据。

**Architecture:** 保留 Electron + 本地模块化单体和现有 Server 边界。事务、流和异步任务由各自拥有者管理；顺序实施，每项独立验证。按用户要求在当前任务直接执行，不创建分支、提交或发布。

**Tech Stack:** Node.js 24、CommonJS 后端、原生前端 ES modules、SQLite、Electron、NSIS、Bash/PM2。

## Constraints / Non-goals

- 保留当前工作区已存在的修改，以 `D:/Work/lira-audit/remediation/2026-09-12-remaining-fixes/before/` 中本轮触及文件副本区分归属。
- 不改公开 HTTP/WS/IPC、数据格式、账号权限、session 分区和既有迁移数值语义。
- 测试仅使用本测试创建的临时目录、合成流和可控时钟。发布脚本只做离线验证，不部署或操作生产服务。
- 怀疑项先复现；不能由相邻修复推定闭合。真实平台验收与自动测试结果分别记录。

## Current behavior and ownership

依据 `D:/Work/lira-audit/remediation/2026-09-12-remaining-review/assessment.md` 及原阶段 finding。Client owner/consumer 路由见 `docs/architecture/engineering/ai-workflow.md`，Server 按其 `docs/README.md` 读取直接关联规范。

## Milestones

每项按“确认具体入口 → 捕捉回归 → 最小修复 → 直接测试 → 同步 owning 文档/证据”执行；具体发现和验证命令追加到执行记录。

- [x] S5-002：`src/storage/settings-store.js` 拥有设置启动事务，`src/server/settings-bootstrap.js` 委托；旧版本读取、默认值、转换、版本写入在同一 `BEGIN IMMEDIATE/COMMIT` 中，错误 `ROLLBACK`。新增 `test/settings-bootstrap.test.js`，以 SQLite trigger 注入版本写入失败，断言重启只转换一次、缺版本不提前发布、新库和已完成版本稳定。更新 `docs/architecture/backend/storage.md`。
- [x] S7-001：`src/electron/media-request-headers.js`、`src/electron/main.js` 合成同 session 的请求头策略；`test/electron-main-modules.test.js` 覆盖网易、QQ、B站与无关请求，核对现有 session 调用者。
- [x] S6-004：`src/music/qq-encrypted-stream.js` 联合处理流背压、下游取消、实际字节上限和清理；增加合成流回归，保持响应契约。
- [x] S6-005：`src/music/wesing-capture-engine.js` 统一启停代次，旧目录/歌词异步结果不能重新启动或发布；扩充直接 WeSing 测试。
- [x] S6-002：`src/ai/ai-assistant-service.js` 与 `src/ai/async-coordinator.js` 核对生成与投递契约，验证同用户慢 A / 快 B / 第三问、缓存及失败重试的上下文顺序。
- [x] S2-002：`src/server/lifecycle.js` 修正进程路径大小写；保持目录和命令归属条件，以同名无关进程做负向测试。
- [x] S8-006：`build/installer.nsh` 解析卸载命令中的可执行路径；覆盖引号、空格、参数和存在性；验证安装模式，不运行实际卸载。
- [x] S8-007：核对 Server 两个 `.codex-tmp/update-server-*.sh` 与当前部署入口；对仍有效的入口补准备顺序和失败恢复，离线模拟各失败点，不回滚数据库。
- [x] S9-004：Server `test/gift-history-contract.test.js` 补盲盒 ID 映射、已知 ID 与旧数据 null 的断言。
- [x] S7-002：`public/js/shared/lyric-performance.js`、`lyric-word-animator.js` 验证 WAAPI → manual → static 可达，取消旧动画并保留正确进度。
- [x] S9-001：按原 finding 列出的 Client/Server 礼物目录测试逐个使用 test cleanup 持有目录、连接、service，失败路径也释放自身资源。
- [x] S9-006：Server 历史观察脚本解析全部产物，按完整礼物身份查账本；用合成数据验证，不读取真实账本。
- [x] S9-005：按原 finding 的文档定位逐一核对当前代码/接受规范，同步当前事实，保留历史 ADR。
- [x] S2-006 / S2-007 / S2-008 / overtime 新线索：核对真实调用路径，在可控环境复现并修复成立的问题；不能完成的真实环境验收写明证据边界。
- [x] 集成验证：执行两个仓库实际提供的相关全局门禁和联合测试，检查本轮 diff、`git diff --check`、`git status --short`；记录既有阻塞，刷新中央台账。

## Failure handling

本轮修改前逐项保存文件副本；失败只修改自己的 hunk，避免覆盖已有修复。迁移失败整笔回滚，异步关闭使旧任务失效；部署失败恢复服务的动作不触碰数据库回滚。

## Done when

13 项确认问题都有修复与直接验证记录，4 条待核实线索有明确结论或环境限制，文档及中央台账与证据一致，联合测试通过或现有失败边界明确，最终 diff 无运行时数据和敏感材料。

## Execution record

- 初始工作区已有大量 Client/Server 未提交修复；保存状态基线，不重置或提交。

## Completed execution / verification

- 完成日期：2026-09-12。13 个确认问题顺序修复；3 个原怀疑项和 overtime 新线索均有受控补证及代码/配置修复。
- S8-007 的两个脚本属于忽略的一次性历史入口，明确退役并在任何部署命令前退出 64；未新建自动部署或数据库回滚路径。
- S2-006 正常调用者已有单飞，直接 helper 重叠调用确有悬空 Promise；S2-007 用真实 loopback HTTP 未完成响应验证排空；S2-008 只更改仓库 PM2 预算，生产有效配置留作发布验收。
- S9-001 在成功与强制断言失败场景均验证临时根为空。S9-005 对齐 17 个快照字段、39 个 invoke、27 张业务表及 571 处当前追踪路径；同期补齐既有 UI 保存版本的 Server REQ/AC。
- 首轮联合回归暴露两个旧测试维护阻塞，已用一处断言和一个 import 排版的最小变更修正，产品行为不变。
- Client npm test 1677/1677；Server npm test 1068/1068；Client verify:quick、Server docs:check 33/33；两库 git diff --check 通过。
- 交付、基线差异、哈希、日志和验收边界位于 D:/Work/lira-audit/remediation/2026-09-12-remaining-fixes/README.md。真实 Electron/OBS/平台/安装/PM2/生产恢复未运行，不阻断本轮代码修复交付。
- 没有提交、分支、发布、部署或清理其他批次临时目录；原工作区修改保留。
