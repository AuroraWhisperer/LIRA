# Desktop Lyric Browser Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the obsolete compact Electron lyric window with a copyable `/lyrics` browser source that renders exactly like the admin live timeline preview.

**Architecture:** The `/lyrics` page will use the existing admin timeline renderer and preview CSS instead of maintaining a second lyric renderer. The admin action will copy the loopback overlay URL. Electron-only window IPC and playback window state will be removed because no visible control will open that window after this change.

**Tech Stack:** Vanilla JavaScript ES modules, HTML, CSS, Node.js `node:test`, Electron CommonJS integration.

## Global Constraints

- Keep `/lyrics` as the canonical project route; screenshot ports and paths are reference-only.
- Preserve the existing full-timeline preview behavior: active row, word progress, translations, romanization, countdown, and spring follow.
- Preserve transparent browser-source output; the checkerboard remains an admin preview aid only.
- Do not add dependencies or change unrelated UI.
- Do not create commits unless the user requests them.

---

### Task 1: Lock the new browser-source contract with tests

**Files:**
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: composed admin HTML, `/lyrics` overlay HTML/JS/CSS, playback lyric publisher, Electron preload and IPC source.
- Produces: regression assertions for the copy action, shared preview renderer, timeline WebSocket messages, and removed Electron window API.

- [ ] **Step 1: Replace compact-window assertions with browser-source assertions**

Assert that the overlay contains `desktopLyricPreviewViewport`, `desktopLyricPreviewTimeline`, `desktopLyricPreviewPlayback`, and `desktopLyricPreviewProgress`; its module imports `../admin/desktop-lyric-preview.js`; and it handles both `lyric-state` and `lyric-timeline` messages.

- [ ] **Step 2: Add copy-action and cleanup assertions**

Assert that the admin HTML contains `desktopLyricCopyUrlBtn` and `复制桌面歌词`, the preview module writes a `/lyrics` URL to `navigator.clipboard`, and sources no longer expose or register `openLyricWindow`, `closeLyricWindow`, `updateLyricWindow`, or `setLyricWindowLocked`.

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `node --experimental-vm-modules --test --test-name-pattern="lyrics browser source|desktop lyric settings" test/desktop-lyrics.test.js`

Expected: FAIL because the old overlay and open-window action still exist.

### Task 2: Reuse the live preview for `/lyrics`

**Files:**
- Modify: `public/pages/overlays/lyric-window.html`
- Modify: `public/js/overlays/lyric-window.js`
- Modify: `public/css/playback/desktop-lyric.css`
- Modify: `public/pages/admin/song/desktop-lyric.html`
- Modify: `public/js/admin/desktop-lyric-preview.js`

**Interfaces:**
- Consumes: `window.AdminApp.desktopLyricPreview.init`, `updateLyricState`, `updateLyricTimeline`, and `applySettings` from `public/js/admin/desktop-lyric-preview.js`.
- Produces: a full-screen transparent browser source and a copy button for `${localOverlayOrigin(location)}/lyrics`.

- [ ] **Step 1: Change the admin action to copy the browser-source URL**

Rename the button to `desktopLyricCopyUrlBtn`, label it `复制桌面歌词`, bind it to `navigator.clipboard.writeText`, and show `桌面歌词地址已复制` after success.

- [ ] **Step 2: Replace overlay markup with preview-compatible markup**

Use the same stage, viewport, timeline, hidden playback line, and progress element IDs/classes as the live preview. Load the admin preview stylesheet before the overlay-specific stylesheet and load the overlay script as an ES module.

- [ ] **Step 3: Replace overlay rendering with the preview module**

Initialize `window.AdminApp.desktopLyricPreview`, forward WebSocket `lyric-state`, `lyric-timeline`, and snapshot state into it, load settings through `/api/settings`, and keep reconnect status represented through the empty timeline fallback.

- [ ] **Step 4: Override only browser-source framing**

Make the preview card/stage fill `100vw` by `100vh`, remove admin borders and checkerboard/solid preview backgrounds, keep the output transparent, and preserve the shared timeline row styling and scrolling.

- [ ] **Step 5: Run the focused test and confirm pass**

Run: `node --experimental-vm-modules --test --test-name-pattern="lyrics browser source|desktop lyric settings" test/desktop-lyrics.test.js`

Expected: PASS.

### Task 3: Remove the obsolete Electron lyric window path

**Files:**
- Delete: `src/electron/lyric-window.js`
- Modify: `src/electron/main.js`
- Modify: `src/electron/ipc/music-ipc.js`
- Modify: `src/electron/preload.js`
- Modify: `public/js/playback/services/lyric-service.js`
- Modify: `public/js/playback/features/lyric-controls.js`
- Modify: `public/css/playback/README.md`

**Interfaces:**
- Consumes: the existing HTTP publication methods `publishBrowserTimeline(track)` and `publishBrowserState(state, force)`.
- Produces: browser-only lyric synchronization with no Electron window state or IPC surface.

- [ ] **Step 1: Remove Electron window creation and IPC exposure**

Delete the window module, its main-process wrappers, four IPC handlers, four preload methods, and the renderer callback used only by that window.

- [ ] **Step 2: Simplify playback lyric synchronization**

Remove `windowOpen`, `windowLocked`, window toggle/lock methods, and `musicAPI.updateLyricWindow`. Keep `syncWindow(track, audio, force)` publishing the timeline and state through HTTP, with `locked: false` retained only for the normalized state contract.

- [ ] **Step 3: Update the playback CSS module description**

Describe `desktop-lyric.css` as the full timeline browser source rather than a compact desktop window.

- [ ] **Step 4: Run full validation**

Run: `npm run check && npm test`

Expected: syntax check passes and all tests pass.

