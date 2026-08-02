# Admin Section Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep both queue panels at their intended height while making every song-assistant section reachable and visible above either player-dock height.

**Architecture:** The song workspace remains the single vertical scroll container above the fixed player. Its queue row becomes a non-shrinking fixed-height child, while the management area keeps natural height and follows it in document order. The narrow-screen override returns the queue row to natural height so stacked panels remain responsive.

**Tech Stack:** CSS flex/grid layout, browser DOM geometry assertions, Node.js `node:test`, Electron renderer verification.

## Global Constraints

- Preserve the existing desktop visual language, copy, typography, and color tokens.
- Do not modify unrelated playback work already present in the working tree.
- Support the 96px collapsed and 218px expanded fixed player heights.
- Run `npm run check && npm test` before completion.

---

### Task 1: Protect the queue row from flex compression

**Files:**
- Modify: `public/css/admin/workspace.css:157-166`
- Modify: `public/css/admin/responsive.css:89-96`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `.song-workspace` as the bounded vertical flex scroll container.
- Produces: `.queues-row` with a 510px desktop flex basis and natural-height narrow layout.

- [x] **Step 1: Write the failing regression assertions**

```js
assert.match(queueRowRule, /flex:\s*0 0 510px/);
assert.match(responsiveQueueRule, /flex:\s*0 0 auto/);
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --test-name-pattern "queue panels keep" test/frontend-regressions.test.js`

Expected: FAIL because the desktop queue row still uses the flex default `0 1 auto`.

- [x] **Step 3: Add the minimum layout rules**

```css
.queues-row {
  flex: 0 0 510px;
  height: 510px;
}

@media (max-width: 900px) {
  .queues-row {
    flex: 0 0 auto;
    height: auto;
  }
}
```

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --test-name-pattern "queue panels keep" test/frontend-regressions.test.js`

Expected: PASS.

### Task 2: Verify every song-assistant section in a real renderer

**Files:**
- Create temporarily: `tmp/verify-admin-sections.js`
- Do not retain generated screenshots, databases, or verification scripts.

**Interfaces:**
- Consumes: isolated local server state and the real `/admin?desktop=1` page.
- Produces: geometry results for queue panels, quick-add panel, management tabs, scroll reachability, and player overlap.

- [x] **Step 1: Launch an isolated server and hidden Electron window**

Use port `39000` with `SONG_PLUGIN_DATA_DIR=tmp/ui-section-verify-data` and a `1920x1080` window.

- [x] **Step 2: Assert desktop geometry with the collapsed player**

Verify both `.queue-panel` elements are approximately 510px high, their empty states have positive rectangles, `.song-workspace.scrollHeight > clientHeight`, and setting `scrollTop` reaches the management panel.

- [x] **Step 3: Assert every management tab is visible when selected**

Click each `[data-tab]`, verify its target `.tab-page.active` has positive width and height, and verify the workspace can scroll the active page's bottom above the fixed player.

- [x] **Step 4: Assert expanded-player and narrow-window behavior**

Toggle `player-dock-expanded` and repeat reachability checks; resize below 900px and verify queue panels stack with natural height and remain reachable.

- [x] **Step 5: Inspect console output and screenshots**

Fail on uncaught errors, missing target pages, zero-height sections, or player overlap. Remove temporary verification artifacts afterward.

### Task 3: Run repository validation

**Files:**
- Verify only; no additional production files expected.

**Interfaces:**
- Consumes: completed CSS and regression changes.
- Produces: syntax, test, and diff-clean evidence.

- [x] **Step 1: Run JavaScript syntax validation**

Run: `npm run check`

Expected: all JavaScript files pass.

- [x] **Step 2: Run the complete serial test suite**

Run: `npm test`

Expected: all tests pass.

- [x] **Step 3: Check the final diff**

Run: `git diff --check` and confirm every changed production line traces to section visibility or the earlier initialization fix.
