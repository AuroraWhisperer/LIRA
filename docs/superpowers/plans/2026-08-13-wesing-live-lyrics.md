# WeSing Live Lyrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated WeSing playback source that captures the local desktop client's current song, progress, and word-timed QRC lyrics, then feeds both the playback page and the existing desktop-lyric experience.

**Architecture:** A bounded Node service owns the Windows UI Automation monitor and local cache parsing. Authenticated HTTP routes configure/activate it, while the existing WebSocket lyric state remains the single delivery path for desktop lyrics. A focused browser client renders the WeSing-only playback view, and the desktop-lyric settings form gains a live preview using that same state.

**Tech Stack:** Node.js CommonJS, Windows PowerShell/.NET UI Automation, `qrc-decoder`, existing lyric parser and WebSocket hub, Electron IPC, vanilla browser ES modules, CSS, `node:test`.

## Global Constraints

- Do not implement WeSing login, cloud playlists, volume, or playback controls.
- Start monitoring only while the selected playback source is `wesing`.
- Preserve existing QQ Music, NetEase, streamer-planner, and desktop-lyric behavior.
- Use no new dependencies and expose no raw log/QRC contents.
- Bound file reads and reject unsafe cache paths/song IDs before resolving QRC files.

### Task 1: Cache parsing and capture state

**Files:**
- Create: `src/music/wesing-capture.js`
- Test: `test/wesing-capture.test.js`

- [ ] Write fixtures for a UTF-16LE `StartKSong` log and a prefixed encrypted local QRC.
- [ ] Verify the parser extracts a matching safe `mid`, decrypts `LyricContent`, metadata, lines, and word timings.
- [ ] Verify invalid IDs, oversized/invalid files, title mismatches, and missing paths fail safely.
- [ ] Implement the capture state machine and injected monitor seam; verify progress-change/play-pause and current-line selection.
- [ ] Implement the fixed PowerShell UI Automation monitor and stop/restart lifecycle.

Run: `node --test test/wesing-capture.test.js`

Expected: all cache, lyric, state, and safety cases pass.

### Task 2: Authenticated API and runtime publication

**Files:**
- Modify: `src/storage/settings-store.js`
- Create: `src/server/routes/wesing-routes.js`
- Modify: `src/server/api-routes.js`
- Modify: `src/server.js`
- Test: `test/wesing-routes.test.js`

- [ ] Add the platform default cache setting without changing existing setting values.
- [ ] Add status/configure/active/refresh routes and route-level error responses.
- [ ] Inject the service into runtime state and broadcast `wesing-state`.
- [ ] Publish normalized `lyric-state` only while WeSing is active; stop the monitor during shutdown.
- [ ] Verify token enforcement, configuration persistence, activation, and public response shape.

Run: `node --test test/wesing-routes.test.js test/server-smoke.test.js`

Expected: WeSing routes and existing runtime smoke cases pass.

### Task 3: Electron directory picker

**Files:**
- Modify: `src/electron/main.js`
- Modify: `src/electron/preload.js`
- Test: `test/playback-wesing.test.js`

- [ ] Add a directory-only picker defaulting to the saved WeSing cache path.
- [ ] Expose only `selectWeSingCacheDirectory()` through the preload bridge.
- [ ] Verify the IPC names and directory-only options statically.

### Task 4: Dedicated playback source and live lyric stage

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/css/playback/header.css`
- Modify: `public/css/playback/panels.css`
- Modify: `public/css/playback/responsive.css`
- Create: `public/js/playback/services/wesing-service.js`
- Modify: `public/js/playback/controller.js`
- Modify: `public/js/playback/core/initializer.js`
- Modify: `public/js/playback/core/event-handlers.js`
- Modify: `public/js/playback/core/renderer.js`
- Modify: `public/js/playback/operations/provider-operations.js`
- Modify: `public/js/playback/state/manager.js`
- Modify: `public/js/playback/ui/playback-bar.js`
- Modify: `public/js/playback/utils.js`
- Modify: `public/js/admin/state.js`
- Test: `test/playback-wesing.test.js`

- [ ] Add failing DOM/state assertions for the third source, cache controls, source-specific view, and live word stage.
- [ ] Implement the authenticated browser client, source activation, WebSocket updates, safe DOM rendering, and animation anchor.
- [ ] Hide online discovery/search/match content for WeSing and hide account-only actions.
- [ ] Pause the page's online audio when entering WeSing and restore the normal Provider refresh path on exit.
- [ ] Add responsive and reduced-motion styles.

Run: `node --test test/playback-wesing.test.js test/frontend-regressions.test.js`

Expected: third-source and existing playback regressions pass.

### Task 5: Desktop lyric settings live preview

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/js/admin/desktop-lyric.js`
- Modify: `public/css/playback/desktop-lyric.css`
- Modify: `test/desktop-lyrics.test.js`

- [ ] Add preview markup and tests for current line, status, translation, and progress.
- [ ] Subscribe to `lyric-state`, interpolate word progress, and update with safe DOM operations.
- [ ] Reflect every existing desktop lyric setting immediately while the form is edited.
- [ ] Verify the independent desktop lyric window's existing assertions still pass.

Run: `node --test test/desktop-lyrics.test.js test/playback-wesing.test.js`

Expected: live preview and desktop overlay regressions pass.

### Task 6: Repository verification

- [ ] Run `npm run check` and fix only errors introduced by this feature.
- [ ] Run focused tests for WeSing capture, routes, playback UI, and desktop lyrics.
- [ ] Run `npm test` and confirm the full serial suite passes.
- [ ] Inspect `git diff --check` and the final diff to ensure unrelated user edits remain intact.

## Self-Review

- The source-to-UI and source-to-overlay paths share one normalized lyric state.
- The implementation has explicit process, path, file-size, traversal, shutdown, and non-Windows handling.
- All user-visible requirements—third tab, separate page, directory selection, capture, dynamic playback lyrics, and dynamic desktop-lyric preview—map to a task and test above.
