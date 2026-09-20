# Fan Profile Daily Update Implementation Plan

**Goal:** 增加每日核对当前大航海身份的设置：北京时间 12:10 客户端仍运行时同步，错过后当日首次打开补同步，两种情况都有 toast。更新舰长／提督／总督等级及已不在舰的状态，保留私人资料与历史。

**Status:** Completed（2026-09-20）。

**Architecture:** Electron fan-profile-controller 负责时机、归属、单次读取和取消；既有名单 importer 在同一事务内保存成功日期；Admin 使用现有受限 IPC 获取待展示通知。

**Tech Stack:** Electron、CommonJS、原生 ESM、node:test；无新依赖。

## Constraints and non-goals

- 新开关默认关闭；保留现有事实增量同步、手动同步和私人字段。
- 沿用 Asia/Shanghai 日期、主窗口 IPC 来源校验、账号代次隔离和关闭等待。
- 不更改数据库结构；可选设置字段对旧数据兼容。
- 保留已有工作区改动，不提交、不建分支、不操作真实用户数据。

## Current behavior and ownership

现有 controller 每 15 秒同步远程事实；名单仅由 sync-guard-roster 显式触发，已有单次读取、取消和事务保护。Admin 初始化所有粉丝档案 UI，但列表只在打开时轮询。

Owner: src/electron/fan-profile-controller.js、src/fans/guard-roster-import.js、src/fans/profile-service.js。
Consumers: src/electron/main.js、public/js/admin/index.js、public/js/admin/fans/automatic-update.js、public/js/admin/fans/forms.js。
Contracts: specs/fan-profiles.md、docs/architecture/desktop/preload.md、docs/architecture/backend/storage.md。
Tests: test/fan-profiles-ipc.test.js、test/fan-profiles-guard-roster.test.js、test/frontend-fan-profiles.test.js。

## Proposed changes

1. configure 接受可选严格布尔 autoSyncGuardRoster；表单增加开关与时间说明。
2. controller 拥有独立定时检查，不依赖事实接口成功；只有主窗口存在且授权有效才执行。成功日期按归属/房间保存，进程内失败不循环刷提示。
3. 自动与手动名单读取共用互斥和账号/房间检查。自动成功日期与名单导入原子保存；失败或取消不标为成功。
4. auto-update-status action 返回并取走当前上下文待展示通知；Admin 全局轮询，启动立即读取，卸载清理。定时与补更新文案区分，失败有提示。
5. 更新设置及 IPC 契约文档，并补充隔离回归。

## Milestones and verification

- [x] 实现设置、原子成功日期和自动来源说明；验证名单与设置持久化测试。
- [x] 实现桌面调度和通知；验证 12:10 前后、重启去重、跨日、关闭、失败、互斥、换账号、授权续期和 dispose。
- [x] 接入设置表单和 toast，更新契约；验证前端表单与通知行为。
- [x] 运行 `node --experimental-vm-modules --test test/fan-profiles-ipc.test.js test/fan-profiles-guard-roster.test.js test/frontend-fan-profiles.test.js test/fan-profiles-domain.test.js test/fan-profiles-transfer.test.js test/electron-main-modules.test.js`：85 项通过。
- [x] 运行 `npm run verify:quick`；文档与全库语法通过，架构检查发现新轮询接入使已有 fans/index.js 超过冻结上限且错误分支为空。将初始化移到 Admin 组合入口、明确 bridge 不可用时的返回行为后，重跑相关检查通过。
- [x] 后续定向检查 `node --experimental-vm-modules --test test/fan-profiles-ipc.test.js test/frontend-fan-profiles.test.js test/frontend-admin-runtime.test.js test/module-boundaries.test.js test/modularity-size.test.js test/governance-docs.test.js`：71 项通过；新增授权续期后自动同步重新完成的回归通过。

## Review and limits

用户确认 12:10 前打开等待定时，错过后首次打开补更新，并明确重点是当前大航海身份。复用完整名单保护，未知身份时不猜测缺席，不推算有效期。最终检查 touched diff、`git diff --check` 与 `git status --short`，未增加运行数据或敏感材料；测试使用隔离数据库与虚构资料，未重启或控制真实桌面客户端。

## Failure handling

失败沿用原名单事务与错误提示；不导入半份名单，不记录成功日期。同进程当天不自动反复重试，可手动同步或下次启动重试。发现回归仅修正本次补丁，不重置工作区。

## Done when

设置可保存、两种触发都有 toast、每日成功不重复、关闭和账号隔离保持正确，相关测试通过，契约和最终 diff 已检查。
