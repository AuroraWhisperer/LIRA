# Desktop Lyric Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single “前奏中” preview with a complete, scrollable, synchronized lyric timeline including credits, word progress, and a three-beat start countdown.

**Architecture:** Keep high-frequency playback position in the existing `lyric-state` message and add a bounded `lyric-timeline` message published only when lyrics change. The server normalizes and stores the timeline for snapshots; the admin preview renders it once and updates only active presentation on animation frames.

**Tech Stack:** Node.js 24 CommonJS server, browser ES modules, native DOM/CSS, `node:test`, WebSocket snapshots.

## Global Constraints

- Use two-space indentation, semicolons, single quotes, and existing module style.
- Add no dependencies and no database persistence.
- Keep every WebSocket snapshot below the existing 256 KB frame boundary.
- Treat browser lyric payloads as untrusted and render text with DOM text nodes only.
- Do not change the compact independent desktop lyric window.

---

### Task 1: Bounded lyric timeline contract

**Files:**
- Create: `src/music/lyric-timeline.js`
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: `{ trackTitle, artists, status, lines[] }` from browser playback or WeSing capture.
- Produces: `normalizeLyricTimeline(input)` returning a safe snapshot with normalized line timing and text.

- [ ] **Step 1: Write the failing normalization test**

  Add a test that passes control characters, invalid times, more than eight artists, and a timeline exceeding the character budget; assert sanitized output, monotonic sorting, and bounded serialized size.

- [ ] **Step 2: Run the focused test and confirm failure**

  Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

  Expected: FAIL because `src/music/lyric-timeline.js` does not exist.

- [ ] **Step 3: Implement the minimal normalizer**

  Export `normalizeLyricTimeline`; allow statuses `idle`, `loading`, `ready`, and `empty`; clamp times to 24 hours; keep at most 500 non-empty lines and stop before the 48 KiB text budget is exceeded.

- [ ] **Step 4: Re-run the focused test**

  Expected: PASS for the new contract and existing desktop lyric tests.

### Task 2: Low-frequency producers and server broadcast

**Files:**
- Modify: `public/js/playback/services/lyric-service.js`
- Modify: `src/music/wesing-capture.js`
- Modify: `src/server/routes/playback-routes.js`
- Modify: `src/server.js`
- Modify: `test/wesing-capture.test.js`
- Modify: `test/server-smoke.test.js`

**Interfaces:**
- Consumes: `track.lyrics.lines` and WeSing's internal `lyrics` array.
- Produces: authenticated `POST /api/playback/lyric-timeline`, `lyricTimeline` in snapshots, and `lyric-timeline` WebSocket messages.

- [ ] **Step 1: Write failing producer and integration tests**

  Assert that WeSing calls `onTimeline` once after lyrics resolve, that the new route returns normalized lines, and that a fresh WebSocket snapshot contains the published timeline.

- [ ] **Step 2: Run the focused tests and confirm failure**

  Run: `node --experimental-vm-modules --test test/wesing-capture.test.js test/server-smoke.test.js test/desktop-lyrics.test.js`

- [ ] **Step 3: Add browser timeline deduplication**

  Track the last curve identity in `LyricService`; post title, artists, status, and lines only when the track or `lyrics` object changes. Catch request failures independently from `lyric-state` and desktop IPC updates.

- [ ] **Step 4: Add WeSing low-frequency callback**

  Call `onTimeline` after `resetLyrics()` and after a successful `refreshLyrics()` result; do not place all lines inside `updateLyricState()`.

- [ ] **Step 5: Store and broadcast the normalized timeline**

  Initialize `lyricTimeline`, expose it in `getState()`, publish route and WeSing updates through one helper, and broadcast `{ type: 'lyric-timeline', timeline }`.

- [ ] **Step 6: Re-run the focused tests**

  Expected: PASS with one low-frequency full payload and unchanged high-frequency current-line behavior.

### Task 3: Admin state and full timeline DOM

**Files:**
- Modify: `public/js/admin/state.js`
- Modify: `public/pages/admin.html`
- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: `app:lyric-state` for playback position and `app:lyric-timeline` for full content.
- Produces: safe lyric row DOM, active row classes, word spans, countdown marker, and temporary manual-scroll suspension.

- [ ] **Step 1: Write failing markup and module tests**

  Assert the page contains a focusable timeline viewport and live playback announcer; assert state dispatches timeline snapshots and messages; unit-test active-index and countdown calculations exported by the preview module.

- [ ] **Step 2: Run the focused test and confirm failure**

  Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

- [ ] **Step 3: Add timeline state dispatch**

  On snapshot, reload, and `lyric-timeline` messages, store `appState.lyricTimeline` and dispatch `app:lyric-timeline`.

- [ ] **Step 4: Replace the single visual line with the timeline viewport**

  Keep an off-screen `aria-live` element for the current line and the existing overall progress element. Create lyric rows using `createElement` and `textContent`; include translation and romanization only when present.

- [ ] **Step 5: Add playback synchronization**

  Use the existing `LyricWordRenderer` as the interpolated clock. On each frame, find the active index, update word progress, move the countdown before the next line after a long gap, and scroll active content unless manual browsing is active.

- [ ] **Step 6: Re-run the focused test**

  Expected: PASS for contract, DOM, countdown, and state integration assertions.

### Task 4: Purposeful responsive lyric runway styling

**Files:**
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: timeline row states (`active`, `past`, countdown) and existing desktop lyric CSS variables.
- Produces: scrollable layout matching the black grid preview and all configured typography/color settings.

- [ ] **Step 1: Add failing style assertions**

  Require vertical overflow, active-row styling, word-gradient progress, countdown dots, visible keyboard focus, and reduced-motion handling.

- [ ] **Step 2: Implement the lyric runway CSS**

  Use `#15171b`/`#202328` stage tones, low-opacity inactive rows, a restrained translucent active pill, `#ffcf4a` word progress, and a three-dot countdown. Preserve mobile breakpoints and the solid-background toggle.

- [ ] **Step 3: Run desktop lyric tests**

  Expected: PASS with no regression to settings autosave or independent lyric window tests.

### Task 5: Verification and visual review

**Files:**
- Modify only files required to fix failures introduced by Tasks 1–4.

**Interfaces:**
- Consumes: completed feature.
- Produces: syntax-clean, test-passing, visually reviewed implementation.

- [ ] **Step 1: Run syntax validation**

  Run: `npm run check`

- [ ] **Step 2: Run all tests**

  Run: `npm test`

- [ ] **Step 3: Launch the local app and inspect the preview**

  Verify complete lines are present before playback, mouse/keyboard scrolling works, current line follows playback, and the three-beat countdown appears only for a long gap.

- [ ] **Step 4: Review the diff**

  Run: `git diff --check` and `git diff --stat`; confirm every change maps to the requested lyric behavior and no generated files are included.

