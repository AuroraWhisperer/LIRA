# Regression Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the identified regressions while retaining session-token protection and the intended security hardening.

**Architecture:** Keep authentication centralized in the HTTP/WebSocket server and make every first-party transport token-aware. Persist only user-approved local-media paths, preserve non-empty stored metadata during partial updates, and bound WebSocket messages across fragments. Restore compatibility-sensitive behavior where it is safe, with an opt-in path for plaintext Cookie export.

**Tech Stack:** Node.js 24, CommonJS, browser JavaScript modules, Electron 43, `node:test`, `node:sqlite`.

## Global Constraints

- Preserve the current random per-process API token; do not make protected APIs public.
- Do not add dependencies or refactor unrelated code.
- Use parameterized SQLite statements and output encoding for generated HTML.
- Add regression coverage for each deterministic failure where the project test harness can exercise it.
- Do not create commits unless the user explicitly requests them.

---

### Task 1: Token-aware first-party transports and graceful restart

**Files:**
- Modify: `src/server.js`
- Modify: `src/server/lifecycle.js`
- Modify: `src/server/http-utils.js`
- Modify: `public/js/playback.js`
- Test: `test/server-smoke.test.js`
- Test: `test/server-lifecycle.test.js`

**Interfaces:**
- Produces: a session-token file in the active data directory, tokenized API download links, and token-aware unload persistence.
- Consumes: existing `verifyToken(context, req, requestUrl)` Bearer/query-token contract.

- [x] Add a failing lifecycle test whose mock shutdown server requires the token stored in the data directory.
- [x] Add failing smoke assertions that tokenized admin download URLs succeed and the same APIs without a token return 401.
- [x] Persist the generated token with restrictive permissions after listen succeeds; read it when asking an old instance to shut down; remove only the current process token during shutdown.
- [x] Extend injected page bootstrap code to append the token to same-origin `/api/` anchor URLs.
- [x] Append the token query parameter to the `sendBeacon` unload URL without placing it in the payload.
- [x] Run `node --test test/server-lifecycle.test.js test/server-smoke.test.js` and expect all assertions to pass.

### Task 2: Playback and diagnostic UI regressions

**Files:**
- Modify: `public/js/playback.js`
- Modify: `public/debug-gifts.html`
- Modify: `public/js/playback/ui/fullscreen.js`
- Modify: `public/js/playback/content/loader.js`
- Test: `test/playback-queue.test.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Produces: history navigation without duplicate pushes, safe attribute encoding, synchronized lyric mode, and untruncated pagination with repeated-page detection.
- Consumes: existing playback state and `ContentLoader` response format.

- [x] Add failing tests for previous-track history order, attribute escaping, lyric-mode reset ordering, and repeated liked-track pages.
- [x] Restore `fromHistory: true` behavior and remove the manual current-track push.
- [x] Add an `escAttr` helper that encodes `&`, `<`, `>`, quotes, and apostrophes before inserting values into attributes.
- [x] Reset lyric mode when the track ID changes before rendering lyrics.
- [x] Replace the 50-page cap with repeated-page/non-progress detection so finite large libraries are fully loaded.
- [x] Run the targeted frontend tests and expect them to pass.

### Task 3: Persistent local-media permission and compatibility behavior

**Files:**
- Create: `src/electron/local-media-access.js`
- Modify: `src/electron/main.js`
- Modify: `src/electron/update-manager.js`
- Modify: `src/electron/bilibili-auth.js`
- Modify: `src/music/providers/netease-provider.js`
- Test: `test/local-media-access.test.js`
- Test: `test/netease-provider.test.js`

**Interfaces:**
- Produces: `createLocalMediaAccess({ dataDir })` with `allow`, `isAllowed`, and persisted reload behavior.
- Consumes: paths returned by Electron's user-mediated file picker.

- [x] Add a failing cold-start test that allows a file, constructs a new access store, and expects the path to remain allowed.
- [x] Move allowlist persistence into the focused helper and validate IPC sender origin by exact origin comparison.
- [x] Restore `autoUpdater.autoDownload = true` so the existing “automatic update” setting retains its behavior.
- [x] Preserve/update an existing legacy `cookies.txt`; create it on fresh installs only when `BILIBILI_PLAINTEXT_COOKIE_EXPORT=1`; retain the compatibility state field and exported path helper.
- [x] Restore the first-playlist fallback when no localized “liked” title is found and cover it with a provider test.
- [x] Run the targeted Electron-independent tests and expect them to pass.

### Task 4: Storage and WebSocket robustness

**Files:**
- Modify: `src/storage/playback-store.js`
- Modify: `src/server/ws.js`
- Test: `test/playback-store.test.js`
- Test: `test/websocket-transport.test.js`

**Interfaces:**
- Produces: non-destructive partial history upserts and a 256 KiB cumulative fragmented-message limit.
- Consumes: existing play-history schema and WebSocket close-code behavior.

- [x] Add a failing store test that records complete metadata, repeats the track with partial metadata, and expects the original non-empty values to survive.
- [x] Add a failing transport test that feeds multiple individually valid fragments whose cumulative size exceeds the message limit and expects close code 1009.
- [x] Change metadata upserts to overwrite only with non-empty incoming values.
- [x] Track fragment byte totals and close/reset before concatenation exceeds the cumulative limit.
- [x] Run both targeted tests and expect them to pass.

### Task 5: Integrated verification and security review

**Files:**
- Modify only files made necessary by failures from the commands below.

**Interfaces:**
- Consumes: all changes from Tasks 1-4.
- Produces: a release-ready verified working tree with documented remaining limitations.

- [x] Run `npm.cmd run check` and expect all JavaScript files to pass syntax checking.
- [x] Run `npm.cmd test` and expect the complete test suite to pass.
- [x] Run `git diff --check` and expect no whitespace errors.
- [x] Review the final diff for token disclosure, path traversal, unsafe IPC origins, unbounded buffers, and unrelated changes.
- [x] Confirm documentation-only files do not enter the packaged Electron `files` list.
