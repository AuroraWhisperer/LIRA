# Desktop Lyric Settings Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every desktop-lyric control into a single left column beside a tall live preview and persist every change automatically without a save button.

**Architecture:** Keep the existing setting IDs, range-pair bindings, preview renderer, and `/api/settings` endpoint. Restructure only the desktop-lyric tab markup and its scoped stylesheet, then replace submit-driven persistence with a debounced, serialized autosave loop that always submits the latest form state.

**Tech Stack:** HTML, CSS Grid, browser JavaScript, Node.js `node:test`

## Global Constraints

- Keep desktop-lyric text horizontal so the preview remains faithful to the real desktop window; make the preview card itself vertically oriented.
- Reuse the existing `/api/settings` endpoint and add no dependencies.
- Preserve all existing desktop-lyric setting element IDs and values.
- Do not touch unrelated working-tree changes.

---

### Task 1: Define layout and autosave regressions

**Files:**
- Modify: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: `public/pages/admin.html`, `public/css/admin/desktop-lyric-preview.css`, and `public/js/admin/desktop-lyric.js` as UTF-8 source.
- Produces: Regression assertions for the side-by-side workspace, single-column controls, missing manual-save button, and automatic `/api/settings` writes.

- [x] **Step 1: Add the failing source-level regression**

```js
assert.match(html, /class="desktop-lyric-workspace"/);
assert.match(html, /class="desktop-lyric-settings-fields"/);
assert.doesNotMatch(html, /保存桌面歌词设置/);
assert.match(source, /AUTOSAVE_DELAY_MS/);
assert.match(source, /form\.addEventListener\('input'/);
assert.match(source, /form\.addEventListener\('change'/);
assert.doesNotMatch(source, /form\.addEventListener\('submit'/);
assert.match(styles, /grid-template-columns:\s*minmax\(280px, 380px\) minmax\(0, 1fr\)/);
```

- [x] **Step 2: Run the focused test and confirm the new assertions fail**

Run: `node --test test/desktop-lyrics.test.js`

Expected: FAIL because the existing page stacks a two-column form below the preview and only saves on submit.

### Task 2: Build the left-control and tall-preview workspace

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/css/admin/desktop-lyric-preview.css`

**Interfaces:**
- Consumes: Existing control IDs and preview IDs.
- Produces: `.desktop-lyric-workspace` with `#desktopLyricForm` first and `#desktopLyricLivePreview` second; `.desktop-lyric-settings-fields` forces every former pair into one column.

- [x] **Step 1: Reorder the desktop-lyric markup**

Wrap the settings container and preview card in `desktop-lyric-workspace`, place settings on the left, remove the submit button, and add an `aria-live` autosave status beside the settings heading.

- [x] **Step 2: Add only desktop-lyric-scoped layout rules**

```css
.desktop-lyric-workspace {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.desktop-lyric-settings-fields {
  grid-template-columns: 1fr;
}
```

Give the preview a viewport-aware tall stage and sticky positioning at desktop widths. Collapse to one column below 980px and place the preview before settings so the live result remains discoverable on narrow screens.

- [x] **Step 3: Run the focused test**

Run: `node --test test/desktop-lyrics.test.js`

Expected: The layout assertions pass while autosave assertions still fail.

### Task 3: Replace submit persistence with serialized autosave

**Files:**
- Modify: `public/js/admin/desktop-lyric.js`
- Test: `test/desktop-lyrics.test.js`

**Interfaces:**
- Consumes: `collectDesktopLyric()` and `window.AdminApp.utils.api(url, body)`.
- Produces: Debounced `input` saves, immediate final `change` saves, serialized network writes, and status text in `#desktopLyricAutosaveState`.

- [x] **Step 1: Add the autosave state machine**

Use a 500 ms debounce while dragging or typing. Mark changes dirty, serialize requests with `saving`/`pendingSave`, collect values immediately before each request, and retry the newest pending state after an in-flight request completes.

- [x] **Step 2: Remove manual-submit behavior**

Delete the submit listener, success toast, and `reloadState()` call. Bind autosave after range-number synchronization so the canonical range value is current when collected.

- [x] **Step 3: Run focused and full verification**

Run: `node --test test/desktop-lyrics.test.js test/frontend-regressions.test.js`

Run: `npm run check && npm test`

Expected: All commands exit successfully.
