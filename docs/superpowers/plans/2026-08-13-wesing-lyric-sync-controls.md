# WeSing Lyric Sync Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent manual WeSing lyric offset and prevent lyric timing from starting while WeSing is still loading or before playback progress is proven to move.

**Architecture:** Keep the authoritative raw WeSing playback clock in `wesing-capture.js`, derive an offset lyric clock only when constructing `lyricState`, and expose a narrowly validated offset endpoint. Detect loading through the existing UI Automation text scan and require a changed valid progress sample before starting a new track. The browser UI edits the setting, while all lyric consumers receive the same backend-derived state.

**Tech Stack:** Node.js 24, CommonJS server modules, browser ES modules, Node `node:test`, PowerShell UI Automation.

## Global Constraints

- Offset range is exactly `-1500` through `1500` milliseconds.
- Browser control step is `50` milliseconds; negative delays lyrics and positive advances lyrics.
- No new dependencies.
- Preserve raw playback progress and apply the offset only to lyric line/word timing.
- Existing local API authentication remains required.

---

### Task 1: Capture timing and offset domain logic

**Files:**
- Modify: `src/music/wesing-capture.js`
- Modify: `src/storage/settings-store.js`
- Test: `test/wesing-capture.test.js`

**Interfaces:**
- Consumes: `options.lyricOffsetMs`, `options.saveLyricOffsetMs(value)`.
- Produces: `setLyricOffsetMs(value)`, `state.lyricOffsetMs`, and offset-derived `state.lyricState`.

- [ ] **Step 1: Write failing timing tests**

```js
assert.equal(capture.getStatus().playing, false);
onSample({ detected: true, title, currentSec: 0, totalSec: 255, loading: false });
assert.equal(capture.getStatus().playing, false);
onSample({ detected: true, title, currentSec: 1, totalSec: 255, loading: false });
assert.equal(capture.getStatus().playing, true);
```

- [ ] **Step 2: Write failing offset tests**

```js
await capture.setLyricOffsetMs(-500);
assert.equal(capture.getStatus().lyricOffsetMs, -500);
assert.equal(capture.getStatus().lyricState.currentMs, rawCurrentMs - 500);
```

- [ ] **Step 3: Run the focused test and verify failure**

Run: `node --test test/wesing-capture.test.js`

- [ ] **Step 4: Implement the state machine and offset calculation**

```js
const lyricCurrentMs = clampPlaybackMs(state.currentMs + state.lyricOffsetMs, durationMs);
const currentLine = findCurrentLyricLine(lyrics, lyricCurrentMs);
```

- [ ] **Step 5: Run the focused test and verify success**

Run: `node --test test/wesing-capture.test.js`

### Task 2: Authenticated offset endpoint

**Files:**
- Modify: `src/server.js`
- Modify: `src/server/routes/wesing-routes.js`
- Test: `test/wesing-routes.test.js`

**Interfaces:**
- Consumes: `{ offsetMs: number }`.
- Produces: the updated WeSing capture status.

- [ ] **Step 1: Write a failing route test**

```js
const saved = await requestJson(`${app.baseUrl}/api/music/wesing/offset`, token, {
  method: 'POST',
  body: JSON.stringify({ offsetMs: -250 })
});
assert.equal(saved.payload.data.lyricOffsetMs, -250);
```

- [ ] **Step 2: Run the route test and verify failure**

Run: `node --test test/wesing-routes.test.js`

- [ ] **Step 3: Add the route and persistence callback**

```js
'POST /api/music/wesing/offset': weSingRoute(async (context, request) => {
  const body = await request.body();
  return context.weSing.setLyricOffsetMs(body.offsetMs);
})
```

- [ ] **Step 4: Test valid and invalid values**

Run: `node --test test/wesing-routes.test.js`

### Task 3: Manual offset controls

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/css/playback/panels.css`
- Modify: `public/js/playback/services/wesing-service.js`
- Test: `test/playback-wesing.test.js`

**Interfaces:**
- Consumes: `status.lyricOffsetMs` and `POST /api/music/wesing/offset`.
- Produces: synchronized range/number controls and a persisted manual offset.

- [ ] **Step 1: Add failing static UI assertions**

```js
assert.match(html, /id="weSingLyricOffsetMs"/);
assert.match(source, /\/api\/music\/wesing\/offset/);
```

- [ ] **Step 2: Run the UI test and verify failure**

Run: `node --test test/playback-wesing.test.js`

- [ ] **Step 3: Implement controls, synchronization, saving, and error feedback**

```js
await this.request('/api/music/wesing/offset', {
  method: 'POST',
  body: { offsetMs }
});
```

- [ ] **Step 4: Run the UI test and verify success**

Run: `node --test test/playback-wesing.test.js`

### Task 4: Symmetric authoritative clock correction

**Files:**
- Modify: `public/js/shared/lyric-word-renderer.js`
- Modify: `public/js/overlays/lyric-window.js`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: each latest authoritative `currentMs` state.
- Produces: a renderer anchor that accepts both forward and backward corrections.

- [ ] **Step 1: Write a failing backward-correction test**

```js
renderer.setState({ currentMs: 1300, playing: true });
assert.equal(renderer.getPosition(now).currentMs, 1300);
```

- [ ] **Step 2: Run the desktop lyric test and verify failure**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

- [ ] **Step 3: Make the newest incoming clock authoritative**

```js
function smoothCurrentMs(incoming) {
  return incoming;
}
```

- [ ] **Step 4: Run the desktop lyric test and verify success**

Run: `node --experimental-vm-modules --test test/desktop-lyrics.test.js`

### Task 5: Verification

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: completed Tasks 1 through 4.
- Produces: syntax-checked and regression-tested implementation.

- [ ] **Step 1: Run static validation**

Run: `npm run check`

- [ ] **Step 2: Run the full serial test suite**

Run: `npm test`

- [ ] **Step 3: Review the final diff for unrelated changes**

Run: `git diff --check` and `git diff --stat`

