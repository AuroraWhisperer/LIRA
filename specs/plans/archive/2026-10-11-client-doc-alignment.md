# 客户端实现与文档差异核对

**Status:** Completed

日期：2026-10-11。

## Goal

核对当前客户端与有效文档，修复证据足以确定归属的错误，交付修改依据、验证结果和不能自行裁决的差异。

## Scope And Ownership

- 按 `docs/reference/README.md` 事实地图和 `docs/architecture/engineering/ai-workflow.md` 路由追踪桌面、HTTP/WS、存储、主要业务、前端及工程入口。
- 使用有效规格、Accepted ADR 和 owner 合同判断预期；历史报告仅作调查线索，Draft / Paused / Deferred 及缺少实机验收不直接认定为代码错误。
- 以当前工作区为基线；任务前源码与文档快照、命令日志放在 `tmp/client-doc-audit-2026-10-11/`。

## Compatibility And Non-goals

保留已有未提交修改、公共合同、存储格式和安全边界。不提交、发布、操作真实账号或生产服务；不因文档审查恢复未确认的产品提案，也不扩大为独立架构改造。

## Milestones

- [x] 核对文档登记、状态及真实入口，建立覆盖范围与候选差异。
- [x] 逐项追踪 owner、调用方和现有测试；确定修代码、修文档或保留待确认。
- [x] 完成最小修正及直接相关验证；实现缺陷优先用现有测试夹具复现。
- [x] 交付有源码证据的审查报告，复核增量 diff、`git diff --check` 与 `git status --short`。

## Verification

文档变更运行 `npm run verify:docs`。行为变更按所属测试路由运行直接相关测试；跨仓合同差异使用 `npm run verify:contracts` 核验，失败时区分代码偏差和验证环境。未变更且无具体风险的领域不自动扩展全量测试或真实 UI 验收。

## Confirmed Changes

- 更新状态 owner `src/electron/update-manager.js`：错误事件已按 `friendlyUpdateError` 区分无更新包与真实错误，但 check/download Promise catch 强制覆盖为 error；各失败/安装分支还可能保留旧 progress。依 `docs/reference/desktop/update.md` 现行合同修正映射与进度清理，保留安装、安全与更新源策略。
- `src/electron/desktop-update-controller.js` 的外层错误投递同样清空 progress；扩展既有 `test/desktop/update-manager.test.js` 与 `desktop-update-controller.test.js`，先证明回归失败，再运行这两项及 `frontend-desktop-update.test.js`。使用隔离 Electron/updater 替身，不启动实际客户端、不检查或下载真实更新。
- IPC 参考首段漏记已经登记并实现的 `plannerReminders`；构建参考的 js-yaml override 与 package.json / lock 不一致。属于文档事实修正。
- 其余已确认文档偏差、来源和同步范围见[审查报告](../../../docs/reports/2026-10-11-client-document-alignment.md)。持续 localStorage 备份与微唱偏移范围记入台账 B10/B11；AI 配额计数继续沿用已暂停计划的 R4 待裁决项。

## Verification Evidence

- 更新器修复前 5 个断言失败，修复后相关 16 项通过；播放/礼物/AI/默认值/指南既有检查 88 项通过。四个变更 JS 文件语法检查通过。
- 在隔离临时目录执行现有数据库迁移，确认六库共有 47 张业务表；未改存储实现。
- 默认服务器检出不匹配契约 pin；在本地已有的锁定提交建立临时 detached worktree，10 个契约夹具全部通过。已确认干净并移除该临时检出，不调整锁或用户服务器分支。
- 文档门禁 10/10 通过，增量 diff、`git diff --check` 和工作区状态已复核，保留原有未提交修改。日志、任务前快照和临时状态位于 `tmp/client-doc-audit-2026-10-11/`；没有提交、发布或真实平台验收。

## Failure Handling

存在规格冲突或缺少明确意图的项写入报告，不猜测实现。失败检查保留原因；需要撤回时只根据任务前快照撤回本任务增量，禁止重置工作区或覆盖用户已有修改。

## Done When

已确认差异完成修正且相应验证通过或限制明确；测试、技术参考、使用指南影响已评估；报告包含未确认项的具体冲突和所需裁决；最终 diff 只包含任务相关改动。
