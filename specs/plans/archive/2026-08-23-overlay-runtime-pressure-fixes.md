# Overlay Runtime Pressure Fixes Implementation Plan

> **Execution note:** Implement this plan test-first in the current task. Do not create commits unless the user explicitly asks for them.

## Goal

Fix five verified runtime and documentation defects: isolate the high-frequency danmaku WebSocket stream, bound slow-client writes, render the danmaku overlay incrementally with authoritative Bilibili status, stop the overtime overlay's unconditional 60 fps loop, and restore API/WebSocket documentation consistency.

## Non-goals

- Do not change existing WebSocket JSON message shapes or snapshot fields.
- Do not add a frontend framework, build step, dependency, process, port, or service.
- Do not redesign either overlay or alter unrelated broadcast consumers.
- Do not change Bilibili connection semantics or persisted data.

## Current Behavior

- `danmaku:message` is broadcast to every WebSocket client and every outbound frame is written without a pending-byte ceiling.
- `/danmaku` rebuilds all message nodes and forces a scroll layout read/write for each incoming message.
- `/danmaku` labels its local `/ws` connection as `弹幕接收中` before consulting snapshot `liveStatus`.
- `/overtime` schedules `requestAnimationFrame` forever and writes clock text/classes every frame, including while paused or hidden.
- API and architecture documents disagree with `PUBLIC_API_PATHS` and the 16-field state snapshot.

## Ownership

- WebSocket transport and public message contract: `src/server/ws.js`, `src/server.js`, `docs/architecture/backend/ws.md`, `test/websocket-transport.test.js` (`ROUTE-SERVER`).
- Danmaku overlay rendering and status: `public/js/overlays/danmaku.js`, `public/js/overlays/danmaku-feed.js`, `test/danmaku-overlay.test.js` (`ROUTE-OVERLAYS`).
- Overtime countdown presentation: `public/js/overlays/overtime.js`, `test/overtime-overlay.test.js` (`ROUTE-OVERTIME`, `ROUTE-OVERLAYS`).
- HTTP/public snapshot facts: `src/server/api-routes.js`, `docs/architecture/backend/api.md`, `docs/architecture/backend/server-core.md`, `docs/architecture/README.md`, and linked consumer documents (`ROUTE-SERVER`).

## Compatibility

- Existing `/ws` clients without a topic continue receiving all ordinary broadcasts and all snapshots.
- `danmaku:message` keeps `{type:'danmaku:message', item}`; only clients requesting `topic=danmaku` receive that high-frequency event.
- Slow clients that exceed the pending-write ceiling are disconnected and recover through the existing reconnect plus snapshot path.
- Existing `createDanmakuFeed().render()` consumers retain full-render and auto-scroll behavior unless they explicitly disable it.
- Overlay page URLs, HTTP paths, authentication, reconnect behavior, CSS classes, and state snapshot shape remain unchanged.

## Proposed Changes

1. Parse repeated/comma-separated `topic` query parameters during WebSocket upgrade and store a per-socket topic set. Add an optional `{topic}` broadcast filter. Connect `/danmaku` with `topic=danmaku` and publish `danmaku:message` only to that topic.
2. Add a configurable outbound pending-byte ceiling to each hub. Before writing a frame, compare `socket.writableLength + frame.length` with the ceiling; destroy and clean up an overflowing socket instead of allowing the Node socket queue to grow without bound.
3. Extend the shared danmaku feed with an `append(item)` path that preserves existing nodes and trims only the oldest node. Disable forced auto-scroll for the fixed overlay and batch incoming messages into one animation-frame flush.
4. Derive `/danmaku` status text and connected styling from snapshot `liveStatus` after the local socket opens. Keep local disconnect/retry status as the transport-level override.
5. Replace the overtime perpetual animation-frame loop with an aligned one-shot timeout while running, no timer while paused/disabled/finished/hidden, and memoized clock DOM writes.
6. Correct all owner/consumer documentation references from 15 to 16 snapshot fields and list both public API paths.

## Milestones

1. [x] Add failing transport tests for topic filtering, ordinary broadcast compatibility, and pending-byte overflow cleanup.
2. [x] Implement WebSocket topic delivery and bounded writes; verify with `node --test test/websocket-transport.test.js`.
3. [x] Add failing danmaku tests for node-preserving append, frame batching markers, and snapshot-driven status; implement and verify with `node --test test/danmaku-overlay.test.js`.
4. [x] Add a failing overtime scheduling regression; implement state/visibility-aware timeout scheduling and verify with `node --test test/overtime-overlay.test.js`.
5. [x] Correct documentation facts and run `npm.cmd run verify:docs`.
6. [x] Run `npm.cmd run check`, `npm.cmd run verify:quick`, the focused overlay/transport tests, and `npm.cmd test`; then review `git diff`, `git diff --check`, and `git status --short`.

## Verification

- `node --test test/websocket-transport.test.js`
- `node --test test/danmaku-overlay.test.js`
- `node --test test/overtime-overlay.test.js`
- `npm.cmd run verify:docs`
- `npm.cmd run check`
- `npm.cmd run verify:quick`
- `npm.cmd test`
- `git diff --check`

## Results

- Focused transport and overlay run: 20 tests passed.
- Documentation verification: 5 tests passed.
- JavaScript syntax check: 429 files passed.
- Architecture verification: 9 tests passed.
- Full repository suite: 834 tests passed, 0 failed.
- `git diff --check`: passed; line-ending notices are existing Windows working-copy warnings, not whitespace errors.

## Rollback

Revert only the task-owned changes listed under Ownership. No schema, settings, persisted state, or generated artifacts are involved. Existing clients remain compatible because topic selection is opt-in and payload shapes are unchanged.

## Done When

- Only topic-subscribed sockets receive `danmaku:message`, while unfiltered broadcasts and snapshots retain existing behavior.
- A slow socket cannot accumulate outbound frames beyond the configured pending-byte ceiling.
- Incremental danmaku messages do not rebuild existing message nodes or force scroll layout, and the overlay reports Bilibili `liveStatus` truthfully.
- The overtime clock updates at display-resolution boundaries only while needed and performs no repeated DOM writes for unchanged values.
- API/WebSocket documents agree with runtime public paths and the 16-field snapshot.
- Focused and repository verification gates pass with no unrelated files modified by this task.
