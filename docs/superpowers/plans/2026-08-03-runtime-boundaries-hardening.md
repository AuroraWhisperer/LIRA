# Runtime Boundaries Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local application runtime instance-owned, release all timed resources on shutdown, and remove the most consequential cross-layer ownership leaks without changing public API or IPC contracts.

**Architecture:** Keep the application as a modular monolith with four SQLite files. Create one server runtime per `dataDir`; it owns the databases, HTTP server, WebSocket hub, Bilibili client, and music cache configuration. Electron receives a narrow in-process facade from that runtime, while browser routes and IPC channel names remain unchanged.

**Tech Stack:** Node.js 24 CommonJS backend, browser-native ES modules, Electron 43, `node:test`, `node:sqlite`.

## Global Constraints

- Preserve existing HTTP paths, WebSocket payload shape, IPC channel names, and SQLite file names.
- Do not add dependencies or introduce a web framework, DI container, service process, or database merge.
- Preserve the user's existing uncommitted overlay modularization files and behavior.
- Add behavior-focused regression tests before or together with each lifecycle fix.
- Run `npm run check && npm test` after integration.

---

### Task 1: Instance-Owned Server and WebSocket Runtime

**Files:**
- Modify: `src/server.js`, `src/server/ws.js`, `src/electron/main.js`
- Test: `test/server-smoke.test.js`, `test/websocket-transport.test.js`

**Interfaces:**
- Produces `createServerRuntime(options)` returning `{ start, stop, setPreShutdownHook, persistPlaybackSnapshot, getApiToken, getSetting }`.
- Produces `createWebSocketHub()` returning `{ handleUpgrade, broadcastSnapshot, stop }`.

- [x] Add a server test that creates and stops two sequential runtimes with separate temporary `dataDir` values.
- [x] Add a WebSocket test that verifies heartbeat starts on upgrade and `stop()` clears owned resources.
- [x] Move server module initialization into `createServerRuntime`; retain `startServer` as a compatibility singleton wrapper for the CLI and current consumers.
- [x] Make the WebSocket heartbeat per hub, start it on upgrade, and invoke `hub.stop()` from runtime shutdown.
- [x] Run `node --test test/server-smoke.test.js test/websocket-transport.test.js`.

### Task 2: Durable Gift and Music Service Boundaries

**Files:**
- Modify: `src/bilibili/gift-service.js`, `src/server/domain-services.js`, `src/music/lyrics-service.js`, `src/music/stream-resolver.js`, `src/server/routes/music-routes.js`, `src/server/routes/song-routes.js`
- Create: `src/music/song-file-codec.js`, `src/music/song-import-schema.js`, `src/music/track-contract.js`
- Modify: `src/shared/utils.js`
- Test: `test/gift-log.test.js`, `test/lyrics.test.js`, `test/qq-provider.test.js`

**Interfaces:**
- `createGiftService(context, { onGiftFlushed })` schedules and disposes pending combo flushes.
- `createLyricsService({ apiCacheDir, lyricCacheDir })` replaces mutable module-level cache paths.
- `normalizeMusicTrackForProvider(track)` has one implementation in `track-contract.js`.

- [x] Add a test that a final `SEND_GIFT` combo flushes without a later gift or snapshot read.
- [x] Add a test that stream and lyric requests retain `sourceSongId` for QQ tracks.
- [x] Add a one-shot combo timer with a disposal hook and arrange runtime shutdown to invoke it.
- [x] Convert lyrics cache configuration to an instance service and inject it into the music route context.
- [x] Move song CSV/XLSX serialization and the single import schema into `src/music`; leave only generic primitives in `shared/utils.js`.
- [x] Run focused domain tests.

### Task 3: Electron Facade and Login Window Ownership

**Files:**
- Modify: `src/electron/main.js`
- Create: `src/electron/bilibili-login-window.js`
- Test: `test/local-media-access.test.js`, `test/server-smoke.test.js`

**Interfaces:**
- `startDesktopApp` retains the runtime facade returned by `createServerRuntime`.
- `openBilibiliLoginWindow({ mainWindow, dataDir, writeLog })` preserves current cookie persistence behavior.

- [x] Extract the Bilibili login window lifecycle to its own module while preserving navigation allow-list and cookie cleanup behavior.
- [x] Replace dynamic server requires and direct `DatabaseSync` reads with runtime facade calls.
- [x] Verify desktop startup ordering and playback flush behavior remain compatible.
- [x] Run focused Electron-adjacent tests.

### Task 4: Admin Entrypoint and Documentation Alignment

**Files:**
- Create: `public/js/admin/index.js`
- Modify: `public/pages/admin.html`, `test/frontend-regressions.test.js`
- Modify: `public/js/overlays/README.md`, `public/css/admin/README.md`, `public/css/playback/README.md`, `public/pages/README.md`

**Interfaces:**
- `admin.html` loads one admin ES module entrypoint; the entrypoint imports existing files in their required order.

- [x] Add a regression assertion that the page references the entrypoint and no longer lists the legacy admin module sequence.
- [x] Create the ordered module entrypoint without changing the existing `window.AdminApp` compatibility surface.
- [x] Remove the ineffective Cache Storage deletion block; retain server-side `no-store` behavior.
- [x] Correct module type, CSS path, overlay utility, and route documentation references.
- [x] Run frontend regressions.

### Task 5: Integration Review

**Files:**
- Modify: `docs/architecture/10-runtime-boundaries-adr.md`

- [x] Review changed imports for CJS/ESM mixing and duplicate factory creation.
- [x] Run `npm run check && npm test`.
- [x] Inspect `git diff --check` and ensure no generated data, logs, or release files changed.
