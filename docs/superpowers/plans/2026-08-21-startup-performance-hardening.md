# Startup Performance Hardening Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with focused tests and review after each task.

**Goal:** Remove confirmed startup and Admin refresh amplification risks from the performance report while preserving all HTTP, WebSocket, IPC, authentication, and persistence contracts.

**Architecture:** Add low-overhead lifecycle timing at existing composition roots, narrow Admin refreshes by snapshot reason and domain, make renderer timers lifecycle-bound, and cache only immutable-in-process Admin HTML composition. Defer speculative SQLite/logging/blur changes until profiling evidence exists.

**Tech Stack:** Node.js 24 CommonJS backend, Electron 43 main process, Vanilla JS ESM renderer, `node:test`.

## Global Constraints

- Preserve HTTP methods/paths, response shapes, WebSocket messages/reason values, IPC channels, cookie restoration ordering, settings keys, and persistence semantics.
- Keep context isolation, `safeStorage`, session partitions, and exact `local-media://` origin checks unchanged.
- Use isolated temporary data in tests; never access real user data.
- Follow the existing two-space JavaScript style and make surgical changes only.

### Task 1: Instrument startup lifecycle and port cleanup

**Files:** `src/electron/main.js`, `src/server.js`, `src/server/lifecycle.js`, `test/server-lifecycle.test.js`, `test/electron-main-modules.test.js`

- [x] Add structured phase timing for startup and ready-to-show without changing ordering.
- [x] Add internal cleanup timing for health check, graceful wait, terminate wait, and result.
- [x] Add focused tests for timing callbacks and all cleanup paths.
- [x] Run lifecycle and Electron module tests.

### Task 2: Remove Admin request amplification

**Files:** `public/js/admin/state.js`, `public/js/admin/app.js`, `test/frontend-admin-shell.test.js`

- [x] Make initial `reloadAll()` issue one state request and one songs request.
- [x] Schedule songs reload only for `songs:*` snapshots.
- [x] Add request-count regression tests for initial load and representative snapshot reasons.

### Task 3: Bind renderer work to active state

**Files:** `public/js/admin/overtime.js`, `public/js/admin/games.js`, focused frontend tests

- [x] Stop Overtime RAF when not running or page is hidden; restart only when needed.
- [x] Replace permanent game interval with an active draw-guess timer lifecycle.
- [x] Test idle/start/pause/finish/visibility cleanup behavior.

### Task 4: Cache Admin fragment composition

**Files:** `src/server/admin-page.js`, `test/admin-page-composition.test.js`

- [x] Cache composed HTML by absolute public directory.
- [x] Preserve fragment order and response bytes; existing composition tests pass.

### Task 5: Optimize WebSocket serialization only where contract-neutral

**Files:** `src/server/ws.js`, `test/websocket-transport.test.js`

- [x] Serialize one snapshot payload once per flush and reuse the Buffer for all sockets.
- [x] Preserve framing, reason, payload shape, and socket error behavior.
- [x] Existing coalescing and multi-context WebSocket regressions pass.

## Verification

Run focused tests after each task, then `npm run check`, `npm run verify:quick`, and `git diff --check`.
