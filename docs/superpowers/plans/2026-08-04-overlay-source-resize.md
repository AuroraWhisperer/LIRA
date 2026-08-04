# Overlay Source Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep copied overlay URLs on IPv4 loopback and make the queue overlay stable while an OBS or live-streaming browser source changes width or height.

**Architecture:** Generate overlay links from one local IPv4 origin helper so opening the admin page through `localhost` cannot leak that hostname into OBS. Keep queue data rendering separate from resize layout: state changes may rebuild rows, while resize events only recalculate viewport sizes, loop copies, overflow distances, and animations.

**Tech Stack:** Browser JavaScript, CSS, Node.js `node:test`

## Global Constraints

- Preserve the current visual style and all user-configured font sizes.
- Add no dependencies.
- Do not alter unrelated admin, playback, or generated files.
- Preserve user changes already present in `public/css/admin/workspace.css`, `public/css/playback/player.css`, and `test/frontend-regressions.test.js`.

---

### Task 1: Fixed IPv4 Overlay URLs

**Files:**
- Modify: `public/js/shared/utils.js`
- Modify: `public/js/admin/display.js`
- Modify: `public/js/admin/settings.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `location.protocol` and `location.port`
- Produces: `localOverlayOrigin(locationLike): string`

- [x] Add a regression test requiring queue, song-list, lyric, and blind-box URLs to use `127.0.0.1` while preserving the active port.
- [x] Implement `localOverlayOrigin` in shared browser utilities and use it in both overlay URL builders.
- [x] Run the focused frontend regression test.

### Task 2: Resize-Safe Queue Layout

**Files:**
- Modify: `public/js/overlays/queue.js`
- Modify: `public/css/overlays/base.css`
- Modify: `public/pages/overlays/queue.html`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: browser-source viewport width/height and existing rendered queue rows
- Produces: `relayoutQueue()` that changes layout and animation state without replacing queue content

- [x] Add regression coverage proving resize uses `relayoutQueue`, responsive edge spacing remains non-negative, and loop copies are removable before recalculation.
- [x] Separate classic and identity vertical overflow configuration from row rendering.
- [x] Mark cloned loop rows, remove stale clones before measurement, and preserve animation progress across settings renders and resize relayouts.
- [x] Recalculate classic and identity viewport overflow from the browser-source height without scaling configured typography.
- [x] Update the overlay asset version query strings so OBS reloads the corrected JavaScript and CSS.

### Task 3: Verification

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed Tasks 1 and 2
- Produces: passing static checks and tests

- [x] Run focused frontend regression tests.
- [x] Run `npm run check`.
- [x] Run `npm test` (134/135 pass; one unrelated pre-existing playback CSS expectation fails).
