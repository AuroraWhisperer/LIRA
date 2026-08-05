# Song Board Windowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the song board's duplicated full-list animation with a looped DOM window containing two viewports above and three viewports below the visible viewport.

**Architecture:** `song-virtual-scroller.js` owns variable-height DOM windowing and accepts all domain behavior through constructor arguments. `songs.js` remains the adapter for API data, sorting/grouping, settings classification, theme updates, and anchor preservation. The server API and queue overlay remain unchanged.

**Tech Stack:** Browser ES modules, DOM APIs, `requestAnimationFrame`, `ResizeObserver`, Node `node:test`.

## Global Constraints

- Keep the full enabled song list in JavaScript memory.
- Render two viewport heights above and three below the visible viewport.
- Preserve the existing song speed control semantics as seconds per viewport.
- Rebuild only for data order or layout changes; paint-only changes must retain song nodes.
- Do not change the queue overlay or server routes.
- Add no dependencies.

---

### Task 1: Window Calculation Tests

**Files:**
- Modify: `test/frontend-regressions.test.js`
- Create: `public/js/overlays/song-virtual-scroller.js`

**Interfaces:**
- Consumes: `{ viewport, content, createNode, keyOf, beforeViewports, afterViewports }`
- Produces: `SongVirtualScroller`, `wrapIndex`, and `pixelsPerSecond`

- [ ] **Step 1: Write failing tests for circular indexes and pixel speed**

```js
assert.equal(wrapIndex(-1, 5), 4);
assert.equal(wrapIndex(5, 5), 0);
assert.equal(pixelsPerSecond(300, 12), 25);
```

- [ ] **Step 2: Run the focused test and confirm the exports are missing**

Run: `node --experimental-vm-modules --test --test-name-pattern="song virtual scroller" test/frontend-regressions.test.js`

- [ ] **Step 3: Implement pure helpers and constructor validation**

```js
export function wrapIndex(index, length) {
  return length > 0 ? ((index % length) + length) % length : 0;
}

export function pixelsPerSecond(viewportHeight, secondsPerViewport) {
  return Math.max(1, viewportHeight) / Math.max(0.01, secondsPerViewport);
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `node --experimental-vm-modules --test --test-name-pattern="song virtual scroller" test/frontend-regressions.test.js`

### Task 2: Independent Virtual Scroller

**Files:**
- Modify: `public/js/overlays/song-virtual-scroller.js`
- Modify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: records, anchor `{ key, offset }`, and seconds per viewport
- Produces: `setRecords`, `setSecondsPerViewport`, `captureAnchor`, `relayout`, `start`, `pause`, `destroy`

- [ ] **Step 1: Add a fake-DOM test proving the rendered window stays bounded**

```js
scroller.setRecords(records);
assert.equal(scroller.beforeViewports, 2);
assert.equal(scroller.afterViewports, 3);
assert.ok(content.children.length < records.length);
```

- [ ] **Step 2: Implement initial prepend/append filling using measured `scrollHeight` deltas**

The anchor record is mounted first. Previous circular records are prepended until at least `2 * clientHeight` is buffered, then following records are appended until at least `3 * clientHeight` remains below the visible viewport.

- [ ] **Step 3: Implement animation and recycling**

Advance `viewport.scrollTop` by elapsed pixels. Recycle nodes only after they leave the two-screen top buffer, subtracting the removed height from `scrollTop` before appending the next circular record.

- [ ] **Step 4: Add lifecycle cleanup**

Cancel the animation frame and disconnect listeners in `destroy()`. Reset frame time after visibility changes so a suspended browser source cannot jump.

- [ ] **Step 5: Run focused tests**

Run: `node --experimental-vm-modules --test --test-name-pattern="song virtual scroller" test/frontend-regressions.test.js`

### Task 3: Song Board Adapter

**Files:**
- Modify: `public/js/overlays/songs.js`
- Modify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `SongVirtualScroller` from `./song-virtual-scroller.js`
- Produces: flattened display records and classified setting updates

- [ ] **Step 1: Add tests for grouped and flat record generation**

Verify grouped output contains independent heading and song records so no group node owns the entire category.

- [ ] **Step 2: Replace full HTML rendering with DOM node creation**

Use `textContent` for names, artists, headings, and title attributes. Pass this node factory into the scroller.

- [ ] **Step 3: Split update keys**

Use order, layout, and motion keys. Always apply theme values, rebuild records only when order changes, relayout only when font metrics change, and update speed without replacing nodes.

- [ ] **Step 4: Preserve anchors during reload and sort changes**

Capture the current record key and offset before replacing data. Resolve the same key in the new record order; fall back to index zero if it no longer exists.

- [ ] **Step 5: Add resize and font relayout scheduling**

Observe `.song-scroll-window`, debounce by 120ms, pause while waiting for `document.fonts.ready`, relayout from the saved anchor, and resume.

### Task 4: CSS and Browser Entry

**Files:**
- Modify: `public/css/overlays/base.css`
- Modify: `public/pages/overlays/songs.html`
- Modify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: direct heading/song children generated by the adapter
- Produces: a non-animated, bounded song list layout

- [ ] **Step 1: Add regression assertions for module loading and removed full-list animation**

- [ ] **Step 2: Remove `song-scroll` animation and group wrapper dependency**

Use grouped/flat list classes to preserve the current 6px and 8px gaps. Keep the viewport clipped with programmatic scrolling.

- [ ] **Step 3: Load `songs.js` as an ES module with a cache-busting version**

```html
<script type="module" src="/js/overlays/songs.js?v=20260805-01"></script>
```

### Task 5: Verification

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed implementation
- Produces: passing static and behavioral checks

- [ ] **Step 1: Run syntax checks**

Run: `npm run check`

- [ ] **Step 2: Run the focused frontend suite**

Run: `node --experimental-vm-modules --test test/frontend-regressions.test.js`

- [ ] **Step 3: Run the complete serial suite**

Run: `npm test`

- [ ] **Step 4: Start the server and inspect `/songlist`**

Confirm the DOM stays bounded with a large song set, resize/font changes preserve the visible anchor, and paint-only changes retain the same song nodes.
