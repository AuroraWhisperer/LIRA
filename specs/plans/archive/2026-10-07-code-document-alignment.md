# 当前代码与文档一致性审查

Status: Completed

## Goal

以 2026-10-07 的客户端工作区为基线，区分文档过时、实现违反已接受约定、尚未完成的验收及证据不足的差异；直接修正确认有误的部分，并留下可复核依据。

## Non-goals

不发布、提交、迁移真实数据或操作生产服务；不把 Draft、Proposed、Paused 或 Deferred 内容自动实施，不把历史报告当成当前缺陷清单。

## Current Behavior

开始审查时 `git status --porcelain=v1` 有 643 项已有变更，包含代码、文档及测试。当前事实需基于工作区核验，不能用 HEAD 覆盖已有工作。文档结构检查不能证明语义一致，代码和通过的测试也不能替代已接受要求。

## Ownership

- 依据：`AGENTS.md`、`docs/README.md`、`specs/README.md`、Accepted ADR。
- 实现路由：`docs/reference/README.md`、`docs/architecture/engineering/ai-workflow.md`。
- 优先核对近期变化集中的组件/场景、HTTP/WS、Electron 同步/IPC、测试运行方式及其 owner 文档；遇到其他确定差异沿调用链核对。
- 修正依据、覆盖范围与未裁决项记录到 `docs/reports/2026-10-07-code-document-alignment.md`。

## Compatibility Constraints

保持公共接口、持久化格式、授权边界和已接受行为。实现变更仅修复与有效约定有明确冲突的问题；若需要变更约定，先记录，不用更新文档掩盖实现回归。保留已有用户修改和暂存内容。

## Proposed Changes

先建立差异表。过时的实现参考直接更新 owner 原章节；错误的实现修复 owner 并运行有意义的回归检查；无法确定预期的部分只记录证据及缺少的裁决。

## Milestones

1. [x] 对照有效规格、ADR、实现及测试建立差异分类；文档与架构基线通过。
2. [x] 修复旧刷新错误跨账号/停止后回写，并更正五份技术参考中的六类文档滞后；直接相关测试通过。
3. [x] 以修改前快照复核任务增量，记录结果并归档；快速门禁、最终文档及 diff 检查通过，跨仓验证限制单独记录。

## Verification

- `npm run verify:docs`：导航、owner 路由、规格与计划结构。
- `npm run verify:architecture`：当前依赖边界与模块化约束。
- 具体实现修正的检查命令在发现问题后追加；测试使用隔离状态，不操作用户数据。
- `node --experimental-vm-modules --test test/gifts/gift-interaction-controls.test.js`：复现并修正旧刷新失败跨账号/停止后回写状态；依据 `specs/gift-interaction-controls.md` 的迟到操作隔离要求，沿用 cloud-sync owner 的账号/代次检查。
- `git diff --check`、任务文件差异及 `git status --short`：区分已有修改，检查任务变更范围。

## Rollback Or Failure Handling

修改前保存任务文件当前内容到根目录 `tmp/`，对比任务前后版本。失败时只撤销本次 patch，不重置工作区。运行环境或跨仓基线不满足时记录限制，不降低门禁或修改锁文件来制造通过。

## Done When

审查范围内的确定差异已修正，未裁决项有明确依据；验证实际执行并如实记录；最终差异复核完成，索引和报告一致。

## Results

- 修正依据和未裁决项见[审查报告](../../../docs/reports/2026-10-07-code-document-alignment.md)。没有更改接受的规格或 ADR 来迁就实现。
- 礼物互动与云同步 104/104，IPC/场景/预览/样式/事件/权限相关 130/130，桌面模块与关闭生命周期 39/39。
- `npm run verify:quick` 通过：文档 10/10、架构 23/23，语法覆盖 1322 个 JS 文件（28 执行、1294 缓存复用）。归档后文档最终复核 10/10；期间并行背景指南创建前短暂出现断链，落盘后复跑通过，未改动并行文件。
- `npm run verify:contracts` 未通过：当前服务器检出与既有锁定提交不同。该环境限制记录在报告；未修改契约锁、重置服务器或声称完成跨仓运行时验收。
- 测试与任务快照位于 `tmp/code-document-alignment/`。保持原有工作区修改，不提交、不发布，不操作用户运行数据。
