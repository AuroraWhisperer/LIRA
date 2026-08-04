# Responsive Queue Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the fixed six-song queue layout and make the classic queue use the browser's available width and height.

**Architecture:** Keep the existing classic queue markup and visual tokens, but replace the six-row threshold with overflow measured from the rendered list and current viewport. Short queues retain their natural content height; long queues use the remaining viewport height and the existing loop/bounce animation modes.

**Tech Stack:** Browser JavaScript, CSS, HTML, Node.js `node:test`

## Global Constraints

- Use Node.js 24 or newer.
- Keep two-space indentation, semicolons, and single quotes in JavaScript.
- Do not add dependencies or alter unrelated admin/playback layout work.
- Verify with `npm run check && npm test`.

---

### Task 1: Lock the responsive behavior with a regression test

**Files:**
- Create: `test/queue-overlay-responsive.test.js`

**Interfaces:**
- Consumes: `public/pages/admin.html`, `public/js/overlays/queue.js`, `public/css/overlays/base.css`, theme setting sources
- Produces: Regression coverage for removal of `queueFixedSixRows` and measured classic-list overflow

- [x] **Step 1: Write the failing test**

```js
test('classic queue removes the six-row setting and follows the viewport', () => {
  assert.doesNotMatch(adminHtml, /queueFixedSixRows/);
  assert.doesNotMatch(queueSource, /visibleRows\s*=\s*6|queueFixedSixRows/);
  assert.match(overlayCss, /\.queue-classic\s*\{[^}]*width:\s*calc\(100vw - 32px\)/s);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/queue-overlay-responsive.test.js`

Expected: FAIL because the admin setting, six-row JavaScript, and capped classic width still exist.

- [x] **Step 3: Add behavioral assertions**

```js
assert.equal(configureClassicVerticalScroll(shortViewport, shortList, {}, '', 5), false);
assert.equal(configureClassicVerticalScroll(longViewport, longList, settings, rowsHtml, 5), true);
```

These assertions require a short list to remain unanimated and a genuinely overflowing list to use the configured loop or bounce animation.

### Task 2: Remove the obsolete six-row setting

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/js/admin/theme.js`
- Modify: `src/storage/settings-store.js`
- Modify: `src/storage/theme-store.js`

**Interfaces:**
- Consumes: Existing theme form and preset key lists
- Produces: Theme settings without `queueFixedSixRows`

- [x] **Step 1: Remove the control and form collection**

Delete the `queueFixedSixRows` label/select/hint from the classic theme section and stop reading the removed element in `collectTheme()`.

- [x] **Step 2: Remove the default and preset key**

Delete `queueFixedSixRows` from `DEFAULT_SETTINGS` and `OVERLAY_THEME_KEYS`. Existing persisted values remain harmless database data and need no destructive migration.

- [x] **Step 3: Run the focused test**

Run: `node --test test/queue-overlay-responsive.test.js`

Expected: The setting-removal assertions pass; viewport behavior remains failing until Task 3.

### Task 3: Size and scroll the classic queue from real viewport overflow

**Files:**
- Modify: `public/js/overlays/queue.js`
- Modify: `public/css/overlays/base.css`
- Modify: `public/pages/overlays/queue.html`

**Interfaces:**
- Consumes: `queueScrollMode`, `queueScrollSpeed`, rendered list `scrollHeight`, viewport `clientHeight`
- Produces: `scheduleClassicVerticalScroll(content, settings, rowsHtml, rowGap)` and `configureClassicVerticalScroll(viewport, list, settings, rowsHtml, rowGap)`

- [x] **Step 1: Render one natural-height list**

Always render the classic rows into `.classic-list-window > .classic-list`; remove `visibleRows`, computed six-row height, and the fixed-row branch.

- [x] **Step 2: Limit only genuine viewport overflow**

Set the classic window's maximum height from the distance between its rendered top and the bottom viewport margin. If `list.scrollHeight <= viewport.clientHeight`, leave it still and at natural height.

- [x] **Step 3: Configure overflow animation from measured pixels**

For loop mode, duplicate the rendered rows and animate by the original list height plus its row gap. For bounce mode, animate by `list.scrollHeight - viewport.clientHeight`. Reuse the existing speed and pause calculations.

- [x] **Step 4: Make width responsive and invalidate cached assets**

Set `.queue-classic` to `width: calc(100vw - 32px)` and bump the queue CSS/JavaScript query versions in the overlay HTML.

- [ ] **Step 5: Run focused and full verification**

Run: `node --test test/queue-overlay-responsive.test.js`

Expected: PASS.

Run: `npm run check && npm test`

Expected: PASS with no syntax or regression failures.
