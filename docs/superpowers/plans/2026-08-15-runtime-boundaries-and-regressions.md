# Runtime Boundaries and Regression Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split server and Electron setup by runtime boundaries, coalesce WebSocket snapshots, and cover the three deferred edge cases with focused regression tests.

**Architecture:** `buildMusicRuntime` owns music providers, lyrics, WeSing, and lyric state; `buildAiRuntime` owns AI configuration, quota, tools, and delivery services. Electron IPC registration moves into focused modules that receive explicit dependencies. WebSocket snapshot broadcasts are scheduled once per event-loop turn and send the latest reason/state.

**Tech Stack:** Node.js CommonJS, Electron IPC, built-in `node:test`.

## Global Constraints

- Preserve existing public APIs and user-visible behavior.
- Keep AI independent-database migration out of scope.
- Follow repository JavaScript style and run `npm run check && npm test`.

---

### Task 1: Server Runtime Boundaries

**Files:**
- Create: `src/server/music-runtime.js`
- Create: `src/server/ai-runtime.js`
- Modify: `src/server.js`

- [x] Move music provider, lyrics, WeSing, and lyric-state construction behind `buildMusicRuntime(dependencies)`.
- [x] Move AI stores, quota, clients, tools, and Xiaomi service construction behind `buildAiRuntime(dependencies)`.
- [x] Replace direct construction in `createServerRuntime` while preserving callbacks and shutdown behavior.

### Task 2: Electron IPC Modules

**Files:**
- Create: `src/electron/ipc/update-ipc.js`
- Create: `src/electron/ipc/music-ipc.js`
- Create: `src/electron/ipc/bilibili-ipc.js`
- Modify: `src/electron/main.js`

- [x] Move update, music/playback, and Bilibili handler registration into explicit module functions.
- [x] Pass getters/callbacks for mutable window/runtime state so registration order remains unchanged.
- [x] Keep `main.js` responsible only for lifecycle wiring and module invocation.

### Task 3: Coalesce WebSocket Snapshots

**Files:**
- Modify: `src/server/ws.js`
- Modify: `test/websocket-transport.test.js`

- [x] Queue at most one snapshot flush per event-loop turn, retaining the newest reason and context.
- [x] Flush immediately for a newly connected socket and on shutdown-compatible paths.
- [x] Assert multiple same-turn broadcasts produce one `getState()` call and one latest-reason snapshot.

### Task 4: Deferred Regression Tests

**Files:**
- Modify: `test/message-deduplicator.test.js`
- Modify: `test/electron-main-modules.test.js`
- Create: `test/packet-decoder.test.js`

- [x] Cover pure anonymous cross-source deduplication.
- [x] Cover malformed packet followed by a valid packet, asserting the valid packet is discarded.
- [x] Cover inverted local-media ranges returning the complete file response.
