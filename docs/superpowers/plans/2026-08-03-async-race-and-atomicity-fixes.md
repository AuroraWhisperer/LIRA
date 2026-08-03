# Async Race and Atomicity Fixes Implementation Plan

> **For agentic workers:** Implement these tasks inline in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stopped or stale asynchronous work from committing side effects, make queue/request persistence atomic, and make ephemeral-port startup report and release the actual listener.

**Architecture:** Keep the existing CommonJS backend and browser ES modules. Use monotonic generation counters for in-process cancellation, an explicit SQLite transaction for the paired inserts, and a small server-listener cleanup helper for startup rollback.

**Tech Stack:** Node.js 24, browser-native ES modules, `node:test`, `node:sqlite`.

## Global Constraints

- Preserve public HTTP, WebSocket, and playback APIs.
- Add no dependencies.
- Preserve all existing uncommitted runtime-boundary changes in `src/server.js`.
- Run focused tests, `npm run check`, and the full serial test suite.

---

### Task 1: Danmaku Connection Generation

**Files:**
- Modify: `src/bilibili/danmaku-client.js`
- Test: `test/danmaku-client.test.js`

**Interfaces:**
- `start()` and `restart()` begin a new connection generation.
- `stop()` invalidates every pending generation.
- `connect(options, generation)` returns without side effects when its generation is stale.

- [x] Add a deferred `resolveRoomInfo()` regression that calls `stop()` before resolution and asserts history polling, rank polling, live monitoring, and WebSocket connection never start.
- [x] Add a monotonic generation field and validate it after each awaited room/danmaku lookup and in asynchronous WebSocket handlers.
- [x] Run `node --test test/danmaku-client.test.js`.

### Task 2: Latest Search Wins

**Files:**
- Modify: `public/js/playback/services/search-service.js`
- Modify: `public/js/playback/features/search-handler.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- `SearchService.search()` preserves its existing array return contract and ignores stale completion state.
- Only the latest handler invocation renders results or an error.

- [x] Add deferred fetches for `old` and `new`, resolve `new` first, and assert the stored and rendered result remains `new` after `old` settles.
- [x] Increment request counters in both state owner and UI owner so stale success and stale failure cannot update shared state or DOM.
- [x] Run `node --experimental-vm-modules --test test/frontend-regressions.test.js`.

### Task 3: Atomic Queue Request Persistence

**Files:**
- Modify: `src/music/queue-service.js`
- Create: `test/queue-service.test.js`

**Interfaces:**
- `addQueueItem(context, input)` keeps its current return value and errors.
- Queue and request rows commit together or both roll back.

- [x] Create a temporary database with a trigger that aborts `requests` inserts; assert `addQueueItem()` throws and both table counts stay zero.
- [x] Wrap the two inserts and final row lookup in `BEGIN`/`COMMIT`, with `ROLLBACK` and rethrow on failure.
- [x] Run `node --test test/queue-service.test.js`.

### Task 4: Ephemeral Port and Startup Rollback

**Files:**
- Modify: `src/server/lifecycle.js`
- Modify: `src/server.js`
- Test: `test/server-lifecycle.test.js`
- Test: `test/server-smoke.test.js`

**Interfaces:**
- `listenExactly()` returns `server.address().port` after listening.
- Startup failure removes its token/runtime files and closes an opened listener before rejecting.

- [x] Assert `listenExactly({ port: 0 })` returns the OS-assigned positive port.
- [x] Inject a runtime-info write failure after listen and assert startup rejects, the assigned listener closes, and startup files are absent.
- [x] Return the bound port and add catch-path listener/file cleanup without changing normal shutdown behavior.
- [x] Run focused lifecycle and smoke tests.

### Task 5: Integration Verification

- [x] Run `npm run check`.
- [x] Run `npm test`.
- [x] Run `git diff --check` and inspect that every changed line maps to these four defects.
