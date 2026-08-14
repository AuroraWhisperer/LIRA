# WeSing Offset Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the WeSing lyric time offset to ±3000 ms, add a reset control, and remove redundant panel copy.

**Architecture:** Keep the existing `WeSingService` request flow as the sole persistence path. Align the browser input bounds, browser validation, and server-side validation, then cover the supported boundary and reset-control contract with existing tests.

**Tech Stack:** HTML, CSS, browser ES modules, Node.js `node:test`.

## Global Constraints

- Keep the existing 50 ms input step and automatic persistence API.
- Do not change cache-directory selection, status reporting, login behavior, or data handling.
- Use two-space indentation, semicolons, and single quotes in JavaScript.

---

### Task 1: Update the WeSing offset panel

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/css/playback/panels.css`
- Test: `test/playback-wesing.test.js`

**Interfaces:**
- Consumes: `#weSingLyricOffsetMs`, `#weSingLyricOffsetMsNumber` and the existing panel styles.
- Produces: `#weSingResetLyricOffsetBtn`, which the browser service binds to reset the offset.

- [x] **Step 1: Write the failing panel contract assertions**

```js
assert.match(html, /id="weSingLyricOffsetMs"[^>]*min="-3000"[^>]*max="3000"[^>]*step="50"/);
assert.match(html, /id="weSingResetLyricOffsetBtn"[^>]*>重置<\/button>/);
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/playback-wesing.test.js`

Expected: FAIL because the current bounds are ±1500 and the reset button is absent.

- [x] **Step 3: Implement the minimal panel change**

```html
<input id="weSingLyricOffsetMs" type="range" min="-3000" max="3000" step="50" value="0">
<button id="weSingResetLyricOffsetBtn" type="button">重置</button>
```

Remove `.wesing-console-intro` and the offset helper text, and adjust the control grid to accommodate the button.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --test test/playback-wesing.test.js`

Expected: PASS.

### Task 2: Persist reset values and validate the expanded range

**Files:**
- Modify: `public/js/playback/services/wesing-service.js`
- Modify: `src/music/wesing-capture.js`
- Test: `test/wesing-capture.test.js`
- Test: `test/wesing-routes.test.js`

**Interfaces:**
- Consumes: `#weSingResetLyricOffsetBtn` and `POST /api/music/wesing/offset`.
- Produces: accepted integer lyric offsets from `-3000` through `3000` and a reset that sends `0`.

- [x] **Step 1: Update boundary tests**

```js
assert.equal((await capture.setLyricOffsetMs(3000)).lyricOffsetMs, 3000);
await assert.rejects(capture.setLyricOffsetMs(3001), /-3000.*3000/);
```

- [x] **Step 2: Run the focused tests to verify they fail**

Run: `node --test test/wesing-capture.test.js test/wesing-routes.test.js`

Expected: FAIL because 3000 is currently rejected.

- [x] **Step 3: Implement shared bounds and reset binding**

```js
const MIN_LYRIC_OFFSET_MS = -3000;
const MAX_LYRIC_OFFSET_MS = 3000;
document.getElementById('weSingResetLyricOffsetBtn')?.addEventListener('click', () => {
  void this.saveLyricOffset(0);
});
```

Make client validation and its displayed error use the same ±3000 range.

- [x] **Step 4: Run focused tests to verify they pass**

Run: `node --test test/wesing-capture.test.js test/wesing-routes.test.js`

Expected: PASS.

### Task 3: Verify the complete change

**Files:**
- Verify: `public/pages/admin.html`
- Verify: `public/js/playback/services/wesing-service.js`
- Verify: `src/music/wesing-capture.js`

**Interfaces:**
- Consumes: completed panel and persistence changes.
- Produces: a syntax-valid, regression-tested UI change.

- [x] **Step 1: Run static validation**

Run: `npm run check`

Expected: PASS.

- [x] **Step 2: Run the full suite**

Run: `npm test`

Expected: PASS.
