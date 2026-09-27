# Client Audit Closeout Implementation Plan

**Status:** Complete — 2026-09-26.

## Goal

修复客户端文档审计中无需账号、证书、外部部署或新增产品决策即可确认并关闭的当前工程缺口；目标审计文档最终只记录未完成项，不保留已完成事项和历史核验过程。

## Non-goals

不实施明确延期的功能或未批准草案，不操作真实用户数据、账号、系统 DPI、生产环境或发布流程，不替用户选择签名身份。不把整体日志/诊断后续建设当成本轮已确认的局部缺陷。不提交、不切分支、不派生代理。

## Current Behavior And Ownership

- A5：`src/storage/retention.js` 未清理 `ai_request_logs`；默认设置及启动摘要缺少对应字段。既有治理计划明确要求默认 30 天和 dry-run/实际删除计数。
- A3：`server-contract.lock.json` 没有四组已在服务器真实提交中的样例；客户端测试仍维护本地副本/黄金值。只迁移测试数据，不改变生产协议。
- A4：`test/governance-docs.test.js` 不核对 HTTP 注册路由与 `docs/architecture/backend/api.md` 的集合。
- D2/文档索引：先复现当前门禁，只处理本报告已发现的未登记文件或格式问题，不批量重构未到期债务。
- C5：若已有隔离 NSIS 工具环境可用，运行现成测试；不修改用户安装和全局工具环境。

## Compatibility Constraints

保留现有工作树中粉丝档案和资源完整性相关改动。数据库不变更表结构；仅清理明确超过可配置期限的请求审计，0 禁用，配置、黑名单和配额不受影响。契约锁只能指向真实提交，所有已登记哈希和独立消费者都要验证。路由检查不启动业务服务或改变公开 API。

## Proposed Changes And Milestones

1. 在既有 retention owner 中增加 `aiRequestLogDays`/`aiRequestLogsDeleted`，通过 `aiRequestLogRetentionDays` 读取配置；补默认值、启动摘要、存储/AI 文档及隔离数据库回归。验证过期边界、dry-run、0、重复清理和无关数据保留。
2. 核对服务器真实 revision 和样例差异，更新锁与 SHA-256；通过已有契约加载器迁移四类消费者，确认无引用后删除本地副本。运行全部契约消费者。
3. 使用现有路由注册入口推导 HTTP 路由集合，增加与 API owner 文档双向比较的门禁，修正文档中经源码确认的漏项/冗余项。验证遗漏和额外记录均可发现。
4. 实跑相关文档/规模门禁；对真实的文件 review 缺口做责任、边界、退出条件审阅后补登记；检查现成 NSIS 环境。
5. 重写目标审计文档为未完成清单，复核本轮 diff、链接、`git diff --check` 和 `git status --short`。

## Verification

- `node --test test/ai-cache-retention.test.js test/database-maintenance.test.js`，以及新增的 AI retention 回归。
- `node scripts/verify-server-contract.js`；`node scripts/run-tests.js contracts`。
- `node --test test/governance-docs.test.js`；`node --experimental-vm-modules --test test/modularity-size.test.js test/module-boundaries.test.js test/esm-module-boundaries.test.js`。
- `node --test test/installer-app-exit.test.js test/installer-directory.test.js test/installer-migration.test.js test/installer-uninstall.test.js`，仅在已存在的隔离工具环境适配后执行原生部分。
- 对触及的源码执行语法检查；最终 `git diff --check`、任务 diff 和状态检查。只有相关跨域风险出现时扩大检查范围。

## Rollback Or Failure Handling

失败时保留证据并修复本轮变更；不改动其他任务的文件内容，不使用 reset/checkout/广泛删除。未满足外部前提的事项留在目标清单中，并写清未完成部分。

## Done When

三项工程缺口有直接回归和消费者验证；当前门禁问题经核验处理或注明限制；清单只剩仍未完成内容；没有发布、用户数据或秘密操作，最终差异无无关改动。

## Verification Results

- AI 请求审计新增 6 项回归先失败再通过；连同缓存 TTL、数据库维护共 14/14。毫秒截止边界、dry-run/实际计数、默认/自定义/禁用、幂等、其他 AI 数据保留及启动摘要均覆盖。
- 服务器真实提交为 `a28db3a2ccf5f0fec1626a4fe3bd97a7eb402d1b`；新增四份 fixture 逐字节对应已提交文件，三份本地 JSON 语义完全一致，原六份锁定哈希不变。十份样例校验通过，全部契约消费者 133/133；四个迁移文件已从 offline 移入 contracts。
- 存储、文档、模块边界及契约锁隔离回归组合 49/49。路由门禁初次运行发现两个真实漏项；补齐礼物特效接口并区分远端引用后通过。没有改动生产路由或协议。
- 三个粉丝档案文件只增加逐文件职责 review，保留既有源码；相关前端测试通过。资源自检任务后续自行更新 main 记录，本轮未接管其业务实现；索引证据修正保留其 In Progress 状态。
- 现成 electron-builder 缓存提供 NSIS 3.0.4.1 和 nsis-resources 3.4.1；仅在测试子进程设置 `LIRA_TEST_MAKENSIS`/`LIRA_TEST_NSIS_PLUGINS`。四类原生安装器测试 39/39、0 skipped，使用原有隔离临时目录和自建进程，退出/迁移/卸载的真实 Windows 路径已运行。未安装或更新用户客户端。
- 最终 `npm run verify:quick` 通过：文档 7/7、1031 份 JavaScript 语法检查、架构/规模 22/22。不是全仓完整测试套件或正式签名安装验收。
- 目标清单 36 个本地链接解析通过；保留 19 项未闭环工程/提案/验收/维护事项，不保留本轮完成项或历史审计流水。未批准/延期范围、真实账号、证书与正式签名安装均未越界操作。
