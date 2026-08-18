# 固定游戏链接与单会话互斥 Implementation Plan

> **For agentic workers:** Implement this plan task by task in the current worktree. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits unless explicitly requested.

**Goal:** 让直播姬只保存 `/games` 一个地址，并由服务端保证同一时间只有一个可运行游戏。

**Architecture:** `GameSessionService` 是唯一会话所有者，`start()` 在已有会话时抛出带 HTTP 状态的冲突错误；Overlay 去掉 URL 游戏选择，直接渲染当前会话；Admin 仅提供基础链接、状态提示和客户端禁用反馈。

**Tech Stack:** Node.js 24+、CommonJS、Vanilla JavaScript ES modules、原生 CSS、`node:test`、现有 HTTP/WebSocket/session-token 管线。

## Global Constraints

- 保持模块化单体、无新进程/依赖/数据库/设置键。
- 保持 `/api/games/session`、`/api/games/session/move`、`game:update` 和现有认证边界。
- 保留旧 `?game=` 页面可访问性，但不再把它作为状态来源。
- 不覆盖工作区中其他并发修改，不创建提交。

## Current Behavior

- `public/js/admin/games.js` 在每张卡上复制 `?game=` 专属链接，启动后自动 `window.open()`。
- `public/js/overlays/games.js` 从 `location.search` 固定选择游戏，单个 `/games` 地址不能切换。
- `src/games/game-session-service.js#start()` 直接替换 `session`，第二个游戏可以覆盖第一个。

## Ownership And Files

- Modify `src/games/game-session-service.js` and `src/server/routes/game-routes.js` for the server invariant and 409 response.
- Modify `public/js/admin/games.js`, `public/pages/admin/toolbox/games.html`, and `public/js/overlays/games.js` for the single link and dynamic UI.
- Modify `test/game-routes.test.js`, `test/games-overlay.test.js`, and `test/frontend-games.test.js` for focused regression coverage.
- Update `specs/README.md` and the three owner docs for the accepted runtime contract.

## Milestones

### 1. Add failing tests

- [x] Assert a second `GameSessionService.start()` rejects and preserves the first session.
- [x] Assert route conflict responses use HTTP 409 and the existing `{ok:false,error}` envelope.
- [x] Assert Overlay no longer selects a game from `URLSearchParams` and renders from `session.game`.
- [x] Assert Admin markup contains only the base link and no per-game copy controls.

### 2. Implement the invariant and UI

- [x] Add a synchronous service guard before replacing `session`.
- [x] Map the guard error to 409 in the existing route catch block.
- [x] Remove per-game links and automatic opening; disable start buttons while active.
- [x] Make Overlay derive the visible view from the latest session and show the empty state when stopped.

### 3. Align contracts and verify

- [x] Update API/page/WS facts and specification index.
- [x] Run focused game tests, `npm run check`, `npm run verify:quick`, `npm test`, `git diff --check`, and `git status --short`.
- [x] Move this completed plan to `specs/plans/archive/` after all Done When conditions pass.

## Verification Results

- Focused game/admin tests: 14 passed.
- `npm run verify:quick`: passed.
- `npm test`: 658 passed, 1 skipped.
- `git diff --check`: passed.

## Rollback Or Failure Handling

Revert only the task-owned hunks with `apply_patch` or restore the specific plan/spec edits; never reset the worktree or touch unrelated concurrent changes. If the UI cannot render a session, preserve the base link and server state, then inspect the focused Overlay test before changing the contract.

## Done When

The acceptance criteria in `specs/games-single-overlay-session_design.md` are observable, focused and full tests pass, docs and index agree with runtime behavior, and the completed plan is archived.
