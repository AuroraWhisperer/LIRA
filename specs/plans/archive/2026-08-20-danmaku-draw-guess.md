# Bilibili 弹幕你画我猜 Implementation Plan

> **For agentic workers:** Implement inline in this session. Do not create commits unless the user explicitly asks. Track discoveries and verification results in this file.

**Goal:** 在现有单会话小游戏域内交付固定 `/games` 地址的主播画板、弹幕猜词、五局积分赛和第四张管理卡片。

**Architecture:** 新增纯领域模块维护题词、计分和受限画布状态；现有游戏会话服务继续拥有互斥与生命周期，并新增单个服务端回合计时器。管理页只消费私有题词接口，直播页只消费剔除答案的公开状态和增量画笔广播。

**Tech Stack:** Node.js 24+ CommonJS、`node:test`、原生 `node:http`、Vanilla JavaScript ES modules、Canvas 2D、原生 CSS、现有只读 WebSocket hub。

## Global Constraints

- 保留用户对 `src/server.js` 顶部版本注释的并行修改。
- 不新增依赖、数据库、设置键、页面、端口、进程或前端构建步骤。
- `/games` 仍是游戏 1、2、4 共用网址；`/wheel` 继续独立。
- 题词不得进入公开会话或 WebSocket payload。
- 不创建 Git commit。

---

## Goal

主播在管理页开始五局比赛并私下查看题词，在 `/games` 网页实时作画；观众通过 Bilibili 弹幕抢答，服务端按 10/7/5/3 计分并在五局后展示排行。

## Non-goals

自定义词库、历史战绩持久化、礼物规则、观众作画、AI 判题和现有游戏重构均不在范围内。

## Current Behavior

`src/games/game-session-service.js` 只支持数字炸弹和五子棋，二者共享单会话互斥与 `game:update`。`public/pages/admin/toolbox/games.html` 已有三张卡片，其中转盘独立；`public/pages/overlays/games.html` 是固定 `/games` 入口并允许主播操作游戏 1、2。

## Ownership

- Owner: `src/games/`、`src/server/routes/game-routes.js`、`public/js/admin/games.js`、`public/js/overlays/games.js`。
- Contracts: `docs/architecture/backend/api.md`、`docs/architecture/backend/ws.md`、`docs/architecture/frontend/pages.md`、`docs/architecture/frontend/app.md`。
- Consumers: Bilibili client、Admin 百宝箱、OBS/直播姬 `/games` 浏览器源。
- Tests: `test/games.test.js`、`test/game-routes.test.js`、`test/frontend-games.test.js`、`test/games-overlay.test.js`。

## Compatibility Constraints

保留现有 HTTP 方法、响应信封、token/Origin 校验、`game:update`、旧查询字符串地址、数字炸弹与五子棋状态形状、转盘独立运行，以及工作区所有无关用户修改。

## Proposed Files

- Create `src/games/draw-guess.js`: 固定词库、答案规范化、公开状态、计分、回合转换、画笔验证。
- Modify `src/games/game-session-service.js`: 新游戏分派、服务端计时器、弹幕猜词、增量绘画广播和 dispose。
- Modify `src/server/routes/game-routes.js`: 新主持状态和绘画端点，扩展开始输入。
- Modify `src/server/api-context.js` and `src/server.js`: 暴露最小接口并清理计时器。
- Modify Admin/Overlay HTML、JS、CSS: 第四卡片、主持状态、Canvas 和实时排行。
- Modify contract docs/spec index and focused tests.

## Milestones

### Task 1: Domain rules and failing tests

**Interfaces:**

- Produces `createDrawGuessState(options)`, `submitGuess(state, danmaku, nowMs)`, `finishRound(state, nowMs)`, `startNextRound(state, options)`, `applyDrawOperation(state, input)`, `publicDrawGuessState(state, timing)`.
- `submitGuess` returns `{accepted, state, award?}`; drawing returns `{accepted, state, operation?, reason?}`.

- [x] Add focused tests for answer secrecy, 10/7/5/3 scoring, per-round UID dedupe, five-round completion and drawing validation.
- [x] Run `node --test test/games.test.js` and confirm the new tests fail because the module/interfaces do not exist.
- [x] Implement the minimum pure domain module and rerun the test until it passes.

### Task 2: Session lifecycle, HTTP and WebSocket contracts

**Interfaces:**

- `service.getHostState()` returns `{game, word, category, round, totalRounds, phase}` or `null`.
- `service.draw(input)` returns `{accepted, revision?, reason?}` and broadcasts `{type:'game:draw', operation, revision}`.
- `POST /api/games/session/move` keeps `{value}` and accepts draw-guess control actions inside `value`.

- [x] Add route/session tests for mutual exclusion, secret host state, automatic timeout, next-round control, validated drawing and `game:draw` broadcasts.
- [x] Run `node --test test/games.test.js test/game-routes.test.js` and verify the contract tests fail first.
- [x] Extend service, context, routes and shutdown cleanup; rerun focused tests to green.

### Task 3: Fourth Admin card

**Interfaces:**

- `GET /api/games/host-state` refreshes private clue copy after start and every `game:update`.
- Existing `[data-start-game]` control gains `draw-guess`; expanded card control buttons submit `finish-round` and `next-round` through the existing move endpoint.

- [x] Add static frontend assertions for card order, expansion controls, rules copy, host-only clue and shared URL behavior.
- [x] Run `node --test test/frontend-games.test.js` and confirm failure before markup/script changes.
- [x] Implement the card with the existing Admin token, typography and spacing system; rerun the test.

### Task 4: `/games` canvas and live scoreboard

**Interfaces:**

- Pointer input posts normalized, bounded chunks to `/api/games/session/draw` with a per-page client ID.
- `game:draw` consumers apply remote operations; the originating page ignores its echoed client ID and keeps its optimistic local stroke.
- `game:update` redraws the authoritative canvas snapshot after load/reconnect/round change.

- [x] Add overlay assertions for Canvas 2D, pointer events, `game:draw`, no untrusted `innerHTML`, score rendering and answer secrecy.
- [x] Run `node --test test/games-overlay.test.js` and confirm failure before UI implementation.
- [x] Implement drawing tools, countdown interpolation, round result and rankings; rerun overlay tests.

### Task 5: Contract docs and verification

- [x] Update API, WebSocket, page/app owner docs and mark the new specification Implemented.
- [x] Run `node --test test/games.test.js test/game-routes.test.js test/frontend-games.test.js test/games-overlay.test.js` expecting all pass.
- [x] Run `npm run verify:docs`, `npm run verify:architecture`, `npm run check`, `npm run verify:quick`, then `npm test`.
- [x] Launch the Electron desktop client, inspect the fourth card and two `/games` instances, and verify draw synchronization and responsive layout.
- [x] Review `git diff`, `git diff --check`, `git status --short`, and `git diff --cached` if staged content exists.

## Verification Results

- Focused game suite: 22 tests passed.
- Governance, architecture, syntax and quick gates passed; syntax covered 398 JavaScript files.
- Full suite: 733 tests, 732 passed, 1 skipped, 0 failed.
- Browser QA: two `/games` pages restored the same session; a real pointer drag produced one four-point stroke and synchronized to the second page; Admin and both game pages reported no console warnings or errors.
- Electron QA: verified the fourth-card order, downward expansion, private clue, shared-session button lock, round controls and next clue at 1280x722 and 1024x682 without horizontal overflow or clipped controls after normal panel scrolling.

## Rollback Or Failure Handling

Stop active game timers through the service `dispose()` path, inspect only the files listed in Proposed Files, and reverse task-owned hunks with targeted patches. Do not use blanket checkout, reset, or broad deletion; preserve the user-owned `src/server.js` change and all unrelated dirty files.

## Done When

All nine acceptance criteria in `specs/danmaku-draw-guess_design.md` are observable, focused and repository gates pass, Electron validation succeeds, owner docs match runtime contracts, the plan is moved to `specs/plans/archive/`, and the final diff contains no unrelated edits.
