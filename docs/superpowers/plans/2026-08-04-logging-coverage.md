# Logging Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add actionable, consistently formatted diagnostics for Bilibili message handling, WebSocket failures, and Electron lifecycle boundaries without flooding normal logs.

**Architecture:** Keep transport context at the Bilibili client boundary and propagate it with normalized messages. Keep the deduplicator boolean API stable while logging the first actionable rejection for each cached message/source pair. Use existing console capture for `terminal.log` and `writeLog` for `desktop.log`.

**Tech Stack:** Node.js 24, CommonJS, Electron, built-in `node:test` and `node:assert/strict`.

## Global Constraints

- Preserve existing CommonJS style, two-space indentation, semicolons, and single quotes.
- Add no dependencies and do not refactor unrelated code.
- Preserve all pre-existing worktree changes.
- Verify with `npm run check` and `npm test`.

---

### Task 1: Deduplication diagnostics

**Files:**
- Modify: `src/bilibili/danmaku/message-deduplicator.js`
- Test: `test/message-deduplicator.test.js`

**Interfaces:**
- Consumes: `remember(uid, message, timestampMs, options)`.
- Produces: the same boolean return value plus one `[Bilibili][Command] status=deduplicated` diagnostic for the first `seen-key` or `cross-source` rejection.

- [ ] Add tests that capture `console.log` and assert rejection reason, identity, message, timestamp, and sources.
- [ ] Run `node --test test/message-deduplicator.test.js` and confirm the new assertions fail.
- [ ] Store enough metadata with cached keys to format the decision while retaining the existing boolean API.
- [ ] Suppress repeated history-poll diagnostics for the same cached rejection to avoid a line every 2.5 seconds.
- [ ] Re-run the focused test and confirm it passes.

Expected log shape:

```text
[Bilibili][Command] status=deduplicated reason=cross-source uid="123" message="点歌 A" timestampMs=123 sources=["danmaku","history"]
```

### Task 2: Bilibili event correlation and normalized prefixes

**Files:**
- Modify: `src/bilibili/danmaku/message-handlers.js`
- Modify: `src/bilibili/danmaku-client.js`
- Modify: `src/bilibili/bilibili-message-handler.js`
- Modify: `src/bilibili/helpers.js`
- Modify: `src/bilibili/utils/gift-normalizers.js`
- Modify: `src/bilibili/parsers/gift-parser.js`
- Modify: `src/server.js`
- Test: `test/gift-log.test.js`
- Test: `test/bilibili-message-log.test.js`

**Interfaces:**
- Consumes: normalized message objects delivered through `handlers.onMessage`.
- Produces: `connectionGeneration`, `connectionAttempt`, and `cmd` correlation fields; canonical Gift, Command, SuperChat, and Live prefixes.

- [ ] Add focused formatting tests for command trace, gift status, and unrecognized gift status.
- [ ] Propagate WS command context from `MessageHandlers`; use `HISTORY` for history transport.
- [ ] Format command results as `[Bilibili][Command] status=accepted|ignored ... trace={...}`.
- [ ] Replace duplicate gift rejection helpers/log lines with one `[Bilibili][Gift] status=rejected|unrecognized` line; mark successful gifts `status=parsed`.
- [ ] Log every received SuperChat once, including non-command messages and connection trace.
- [ ] Consolidate live-start transition logging into one `[Bilibili][Live] action=started` line.
- [ ] Run the focused tests and confirm they pass.

### Task 3: WebSocket close and error evidence

**Files:**
- Modify: `src/bilibili/danmaku/websocket-connection.js`
- Modify: `src/bilibili/danmaku-client.js`
- Test: `test/websocket-connection.test.js`

**Interfaces:**
- Consumes: browser-compatible `CloseEvent` and generic error `Event` objects.
- Produces: close/error events forwarded to the client with `code`, `reason`, `wasClean`, `readyState`, and any available message.

- [ ] Add a fake WebSocket test proving close/error event details reach registered handlers.
- [ ] Forward event objects from `WebSocketConnection` without changing reconnect behavior.
- [ ] Include details in `[Bilibili][Connection] action=close|error` trace objects.
- [ ] Run the focused test and confirm it passes.

### Task 4: Electron lifecycle diagnostics

**Files:**
- Modify: `src/electron/main.js`
- Modify: `src/electron/update-manager.js`
- Test: `test/update-manager.test.js`
- Test: `test/electron-lifecycle-log.test.js`

**Interfaces:**
- Consumes: app startup/quit, main-window events, playback flush acknowledgement/timeout, updater events, and restart/close IPC calls.
- Produces: structured `desktop:lifecycle`, `desktop:window`, `desktop:playback-flush`, `desktop:update`, and `desktop:ipc` entries.

- [ ] Extract a small playback-flush result helper that returns `ack`, `timeout`, `skipped`, or `error` without altering the two-second shutdown guard.
- [ ] Record START/READY and QUIT_BEGIN/QUIT_DONE/QUIT_TIMEOUT boundaries.
- [ ] Record main-window create/ready/closed and restart/close-window IPC intent.
- [ ] Record updater checking/available/not-available/downloaded events; do not log every progress callback.
- [ ] Add focused tests for flush outcomes and updater success logging.
- [ ] Run focused tests, then `npm run check` and `npm test`.

## Self-Review

- Spec coverage: rejection diagnostics, command trace, gift normalization, WS close/error, SuperChat, live transition, and high-value desktop lifecycle events are covered.
- Deliberate exclusions: API requests are not coupled to WS generations; history commands already use the common command log; heartbeat and prune logging remain silent to avoid continuous noise.
- Placeholder scan: no deferred implementation placeholders.
- Type consistency: normalized messages carry numeric generations/attempts and string `cmd`; public deduplicator behavior remains boolean.
