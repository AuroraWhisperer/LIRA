# 你画我猜绘图控制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为你画我猜画布增加服务端一致的“撤销上一笔”、清空确认和画笔快捷键，并在 Admin 主持区提供操作说明。

**Architecture:** `src/games/draw-guess.js` 继续作为画布状态和操作校验的 owner，新增 `undo` 操作并返回被撤销的笔画 ID；`src/games/game-session-service.js` 原样通过 `game:draw` 广播校验后的撤销操作。`public/js/overlays/games.js` 负责乐观更新、整画布重绘、清空确认和快捷键；Admin 只展示说明，不复制业务判断。

**Tech Stack:** Node.js 24+、CommonJS、Vanilla JavaScript ES modules、原生 CSS、`node:test`。

## Global Constraints

- 保持现有 `/api/games/session/draw`、`game:draw`、`/games` 页面和 session-token 校验兼容。
- 保持画布操作服务端校验、有限笔画/坐标上限和多浏览器源同步；不得只在发起页本地撤销。
- 保持 Node.js 24+、CommonJS 后端、Vanilla JS ES modules、原生 CSS、无构建步骤。
- 不新增数据库、设置键、进程、端口或运行时依赖。
- 不改变数字炸弹、五子棋、转盘、答案隐藏和计分规则。

---

## Current Behavior

- `src/games/draw-guess.js:177` 的 `applyDrawOperation()` 只接受 `append` 和 `clear`，画布状态按 `strokes` 顺序保存。
- `src/games/game-session-service.js:127` 校验画笔操作后广播 `{type:'game:draw', operation, revision}`，当前没有撤销操作。
- `public/js/overlays/games.js:331` 只有画笔/橡皮擦、颜色、粗细和清空按钮；`clearDrawCanvas()` 直接清空，没有确认；没有键盘监听。
- `public/pages/admin/toolbox/games.html` 的画猜主持区已有题词、回合控制和状态文本，但没有画板快捷操作说明。
- 现有覆盖测试位于 `test/games.test.js`、`test/games-overlay.test.js`、`test/frontend-games.test.js`、`test/game-routes.test.js`。

## Ownership

- 状态与输入限制 owner：`src/games/draw-guess.js`。
- 会话生命周期和广播 owner：`src/games/game-session-service.js`。
- HTTP contract：`docs/architecture/backend/api.md` §小游戏 API。
- WebSocket contract：`docs/architecture/backend/ws.md` §3 `game:draw`。
- 画布消费者：`public/js/overlays/games.js`；主持说明：`public/pages/admin/toolbox/games.html` 与 `public/css/admin/other-features/games.css`。
- 回归测试：`test/games.test.js`、`test/games-overlay.test.js`、`test/frontend-games.test.js`、必要时 `test/game-routes.test.js`。

## Compatibility Constraints

- `append` 和 `clear` 的请求/广播形状保持不变；仅在同一端点/消息类型中增加已校验的 `{action:'undo',clientId,strokeId,revision}`。
- 撤销以服务端当前最后一笔为准，操作成功后所有 `/games` 实例都删除同一个 `strokeId` 并完整重绘；没有可撤销笔画时稳定返回 400 错误。
- 撤销橡皮擦笔画时恢复被擦除前的服务端笔画集合，因为画布重绘来自剩余笔画记录。
- 快捷键只在 `draw-guess` 作画阶段处理，并忽略 input、textarea、select、contenteditable，避免干扰 Admin 或文本输入。
- 清空确认取消时不发送操作；清空、撤销和快捷键失败时沿用现有快照恢复路径。

## Proposed Changes

- `src/games/draw-guess.js`：新增 `undo` 分支，移除最后一笔、减少 `totalPoints`、递增 `revision`，返回撤销笔画 ID；无笔画时拒绝。
- `src/games/game-session-service.js`：复用现有 `draw()` 流程广播撤销操作；保持 `game:draw` 消息和 revision 语义。
- `public/js/overlays/games.js`：添加“撤销上一笔”按钮；抽取笔画宽度设置函数；实现 `B`、`E`、`Ctrl/Cmd+Z`、`[`、`]`；清空前调用浏览器确认；处理 undo 广播并重绘。
- `public/pages/overlays/games.html`：在工具栏加入撤销按钮。
- `public/pages/admin/toolbox/games.html` 与 `public/css/admin/other-features/games.css`：加入简短快捷键/清空确认说明，保持桌面端卡片层级。
- `docs/architecture/backend/api.md`、`docs/architecture/backend/ws.md`、`specs/danmaku-draw-guess_design.md`：补充 undo 操作 contract 和已实现行为。
- 测试文件：覆盖状态撤销、服务广播、前端按钮/快捷键/说明文本和旧操作兼容。

## Milestones

### Milestone 1: 服务端撤销操作

- [x] 在 `test/games.test.js` 先写两笔追加后撤销最后一笔、连续撤销和空画布拒绝的测试。
- [x] 在 `src/games/draw-guess.js` 实现 `undo`，只移除 `state.canvas.strokes.at(-1)`，保持其他状态字段不变。
- [x] 在 `test/games.test.js` 增加 `createGameSessionService().draw({action:'undo'})` 广播断言。
- [x] 运行 `node --test test/games.test.js`，预期所有游戏服务测试通过。

### Milestone 2: Overlay 操作和快捷键

- [x] 在 `public/pages/overlays/games.html` 增加 `drawUndoBtn`，并在 `public/js/overlays/games.js` 纳入启用/禁用状态。
- [x] 在 `public/js/overlays/games.js` 增加 `finalizeActiveStroke()`、`undoLastDrawStroke()`、`setDrawWidth()` 和 `handleDrawShortcut()`；`Ctrl/Cmd+Z` 发送 undo，`B/E` 切换工具，`[`/`]` 在 `[2,4,8,12]` 中调整粗细。
- [x] `clearDrawCanvas()` 在可作画且存在笔画时调用共享 `showConfirmationDialog()`，取消则不入队。
- [x] `mergeDrawOperation()` 支持 undo，按 `strokeId` 删除并调用 `redrawCanvas()`；自身广播只更新 revision，避免重复删除。
- [x] 运行 `node --test test/games-overlay.test.js` 并执行 `npm.cmd run check`。

### Milestone 3: Admin 说明和 contract 文档

- [x] 在画猜主持区加入说明：`B` 画笔、`E` 橡皮擦、`Ctrl+Z` 撤销、`[`/`]` 调整粗细、清空画布会二次确认。
- [x] 添加最小 CSS，保证说明在桌面端和 760px 以下布局中可读，不改变现有卡片结构。
- [x] 更新 API、WebSocket 和画猜规格中的绘画操作描述。
- [x] 扩展 `test/frontend-games.test.js` 和相关静态断言，确保按钮、快捷键说明和 contract 文档存在。

### Milestone 4: Verification and handoff

- [x] 运行 `node --test test/games.test.js test/games-overlay.test.js test/frontend-games.test.js test/game-routes.test.js`。
- [x] 运行 `npm.cmd run check`、`npm.cmd run verify:architecture` 和 `npm.cmd run verify:quick`，均通过。
- [x] 运行完整 `npm.cmd test`，804 个测试中 803 通过、1 个跳过、0 个失败；检查任务相关 diff 和工作区状态，未重写并行改动。

## Verification

Focused tests must prove:

```text
append stroke-1 -> append stroke-2 -> undo
state.canvas.strokes === [stroke-1]
operation === { action: 'undo', strokeId: 'stroke-2', revision: 3 }
```

The browser flow must prove that canceling the shared clear confirmation makes zero HTTP requests, while accepting it produces one `clear` operation; keyboard events must be ignored for form controls and non-drawing phases.

Commands:

```powershell
node --test test/games.test.js test/games-overlay.test.js test/frontend-games.test.js test/game-routes.test.js
npm.cmd run check
npm.cmd run verify:architecture
npm.cmd run verify:quick
git diff --check
```

## Rollback Or Failure Handling

If a focused test fails, stop at the failing milestone and inspect only the task-owned diff. Revert task-owned hunks with `apply_patch`; do not use `git reset --hard`, blanket checkout, or broad deletion. If undo ordering cannot be kept consistent across clients, remove the new UI trigger and operation branch together, leaving existing append/clear behavior untouched.

## Done When

- Server accepts and broadcasts a bounded undo operation, rejects empty undo, and all focused game tests pass.
- Overlay provides undo, confirmation, and the four requested keyboard shortcuts without breaking pointer drawing, tool state, or recovery.
- Admin card contains the shortcut/confirmation note and its frontend test passes.
- API/WS/spec owner documents describe the new operation accurately.
- Syntax, architecture, focused tests, diff review, and applicable quick-gate results are recorded; unrelated worktree changes remain untouched.
