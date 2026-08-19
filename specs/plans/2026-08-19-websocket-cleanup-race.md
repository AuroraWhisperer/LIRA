# WebSocket Cleanup Race Implementation Plan

**Goal:** Prevent a cleaned-up WebSocket from processing late `data` events or running cleanup more than once.

**Architecture:** Keep lifecycle state local to each upgraded socket. The transport marks cleanup before removing the data listener and releasing buffers; the data handler rejects any event after that transition. No WebSocket frame format, route, authentication, or snapshot contract changes.

**Tech Stack:** Node.js 24+, CommonJS, `node:test`, `node:events`.

## Global Constraints

- Preserve existing WebSocket paths, frame formats, close codes, authentication, and snapshot semantics.
- Make the smallest change in `src/server/ws.js` and `test/websocket-transport.test.js`.
- Preserve existing unrelated working-tree changes.

## Current Behavior

- `cleanupSocket()` releases `socket._wsBuffer`, but the anonymous data listener remains installed.
- A late data event can therefore read `null.length` after cleanup.

## Task 1: Make Socket Cleanup a One-Way Lifecycle Transition

**Files:**
- Modify: `src/server/ws.js`
- Modify: `test/websocket-transport.test.js`

- [x] Add a regression test that closes an upgraded fake socket, emits a late WebSocket data frame, and asserts that it does not throw, write a frame, recreate its buffer, or restore membership in `context.state.sockets`.
- [x] Run `node --experimental-vm-modules --test test/websocket-transport.test.js` and confirm the new regression fails before the implementation.
- [x] Store a removable per-socket data handler, initialize an explicit cleanup flag, and make cleanup return after its first invocation.
- [x] Mark the socket cleaned up before removing its data listener and releasing resources; have the data handler return before accessing state if cleanup already started or the socket is no longer hub-managed.
- [x] Run `node --experimental-vm-modules --test test/websocket-transport.test.js`, then `npm run check`.

## Verification

- Review `git diff --check` and `git diff` for task-only changes.
- Run `git status --short` and preserve pre-existing interactive-tour changes.

## Rollback Or Failure Handling

- Use the scoped diff to revert only task-owned changes if verification identifies a regression; do not use destructive repository-wide commands.

## Done When

- Cleanup is idempotent, late data is ignored, the data listener is removed, and the focused test plus syntax check pass.
