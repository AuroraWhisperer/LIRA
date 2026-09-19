# Fan Profile Session Renewal Implementation Plan

**Goal:** 同一主播账号在后台续期后，粉丝档案保留当前详情和编辑操作，不再误报账号切换。

**Architecture:** 粉丝档案 controller 继续从已认证的服务器 origin 和 streamerId 决定归属。页面上下文在持续授权的同一归属内保持稳定；异步同步仍捕获授权代次，续期后的旧结果不得写入。

**Tech Stack:** Electron、CommonJS controller、原生 ESM renderer、node:test。

**Status:** Completed（2026-09-19）。

## Constraints and non-goals

- 不修改 licenseManager 的续期、令牌、退出或身份认证流程。
- 保留 IPC 参数和返回字段、来源校验、主进程归属解析及持久化格式。
- 换主播、换服务器、失去授权、退出和 dispose 后，旧页面上下文不可继续操作。
- 保留当前工作区其他任务和本任务此前的改动；不提交、不创建分支。
- 不增加自动重试写入、依赖、服务或新的 UI 功能。

## Current behavior and ownership

`license-manager.js` 每次接受自动续期结果都会增加 authorizationEpoch。`src/electron/fan-profile-controller.js` 将 epoch 变化和所有状态通知都视为页面上下文变化；`public/js/admin/fans/index.js` 在定时 open 返回不同 contextId 时清空选中项并显示“账号已切换”。

controller 拥有上下文、取消和同步生命周期；renderer 消费 contextId 并持有详情。私有 IPC 契约归属 `docs/architecture/desktop/preload.md`，产品要求归属 `specs/fan-profiles.md`。既有 `test/fan-profiles-ipc.test.js` 验证调用来源、归属、授权代次、迟到结果、名单同步和关闭。

## Proposed changes

1. `context()` 在持续授权的同一 scope 下复用 contextId，但 epoch 变化时创建新的内部上下文并取消旧异步操作。无授权时立即丢弃当前上下文。
2. `same(captured)` 同时核对上下文 ID 和授权代次；状态通知调用 `context()`，不再无条件重置。
3. renderer 和 IPC 的通用失效提示使用“登录状态已变化”，避免将重新登录、恢复连接等一律描述为换账号。
4. 增补续期前后页面上下文稳定、旧编辑请求可以保存、无身份变化的通知不取消读取、退出后重新登录及账号往返切换仍拒绝旧上下文的测试；保留旧异步结果的代次隔离测试。
5. 同步更新上述契约文档。

## Milestones and verification

- [x] 补回归测试并运行 `node --test test/fan-profiles-ipc.test.js`，先确认续期复现失败。
- [x] 实施 controller 与提示修复，再运行该测试，确认续期可继续操作而旧异步响应仍不能落库。
- [x] 运行 `node --experimental-vm-modules --test test/fan-profiles-ipc.test.js test/frontend-fan-profiles.test.js test/license-manager-renewal.test.js test/license-session-boundaries.test.js`。
- [x] 运行与 IPC/ESM 和契约文档相关的 `node --experimental-vm-modules --test test/module-boundaries.test.js test/esm-module-boundaries.test.js test/governance-docs.test.js`，以及改动 JS 的语法检查。
- [x] 检查本次 diff、`git diff --check`、`git status --short`；完成后归档计划。

## Results

- 修改前 22 项 IPC 测试中 20 项通过、2 项按预期失败，分别复现自动续期拒绝保存和无变化通知中止名单读取。
- 修改后 22 项 IPC 测试全部通过；合并相关 renderer、真实登录管理器续期及授权边界测试共 41 项通过。
- ESM、模块边界及文档检查 18 项通过；改动 JS 的 `node --check` 通过。
- 仅调整粉丝档案 controller 的上下文生命周期和两处 renderer 提示；登录管理器、IPC 来源校验、持久化与其他任务改动保持原样。
- 未操作真实用户数据；本次使用隔离测试验证，未重新启动正在运行的桌面客户端。

## Rollback or failure handling

若发现跨账号或授权隔离回归，停止交付并在本次 controller / renderer / 测试补丁内修正或逐块撤回；不得重置工作区或覆盖此前改动。

## Done when

续期和无身份变化的通知不改变页面上下文；真正换归属或失去授权后旧上下文失效；异步请求不能跨授权代次提交；相关测试与文档检查通过，且 diff 仅包含本次修复和已有改动。
