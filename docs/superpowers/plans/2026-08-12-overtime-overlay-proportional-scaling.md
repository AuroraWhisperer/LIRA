# Overtime Overlay Proportional Scaling Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current task. No subagent execution skill is available in this session.

**Goal:** Limit the viewer gift board to two or three tickets per row and make all overlay content scale from one shared viewport-relative type unit.

**Architecture:** Keep the existing rule snapshot and ticket DOM, but expose wide and narrow column counts as CSS custom properties. Split the static `LIVE` label from the optional state suffix, then express typography, icons, spacing, and panel geometry in `em` from a `2cqmin` root scale.

**Tech Stack:** Vanilla HTML, CSS container queries, browser DOM APIs, Node.js `node:test`

## Global Constraints

- Preserve the existing transparent OBS composition and ticket color semantics.
- Display no more than three gift tickets per row; use no more than two on widths at or below `719px`.
- Running state shows `LIVE` without `直播加班中`.
- At the current `1340 × 420` preview baseline, increase gift names from about `9px` to `13px`, effect values from about `12px` to `16px`, and `LIVE` from about `10px` to `12px`.
- All overlay content derives from one `2cqmin` scale and uses `2vmin` only as the compatibility fallback.
- Do not create a Git commit unless the user asks for one.

---

### Task 1: Status Copy and Column Limits

**Files:**
- Modify: `public/pages/overlays/overtime.html`
- Modify: `public/js/overlays/overtime.js`
- Modify: `test/overtime-overlay.test.js`

**Interfaces:**
- Consumes: enabled rule count and `currentState.status`.
- Produces: `--ticket-wide-columns`, `--ticket-narrow-columns`, a static `.overtime-live-label`, and an optional `#overtimeStatusText` suffix.

- [x] **Step 1: Add failing source assertions**

```js
assert.match(html, /class="overtime-live-label">LIVE<\/strong>/);
assert.match(html, /id="overtimeStatusText"/);
assert.match(source, /running:\s*''/);
assert.match(source, /Math\.min\(3, ticketCount\)/);
assert.match(source, /Math\.min\(2, ticketCount\)/);
```

- [x] **Step 2: Verify the focused test fails**

Run: `node --test test/overtime-overlay.test.js`

Expected: FAIL because the current status is a single text node and the grid uses `auto-fit`.

- [x] **Step 3: Implement status and layout custom properties**

Replace the status span with a container holding a static `LIVE` strong element and suffix span. Map running status to an empty suffix, hide the suffix when empty, and set the two column custom properties while rendering enabled rules.

- [x] **Step 4: Re-run the focused test**

Run: `node --test test/overtime-overlay.test.js`

Expected: PASS.

### Task 2: Shared Proportional Scale

**Files:**
- Modify: `public/css/overlays/overtime.css`
- Modify: `test/overtime-overlay.test.js`

**Interfaces:**
- Consumes: `--ticket-wide-columns` and `--ticket-narrow-columns` from Task 1.
- Produces: `.overtime-machine { font-size: 2cqmin; }`, `em`-based typography and geometry, three-column wide layout, and two-column narrow layout.

- [x] **Step 1: Add failing scale assertions**

```js
assert.match(css, /\.overtime-machine\s*\{[\s\S]*?font-size:\s*2cqmin/);
assert.match(css, /\.overtime-live-label\s*\{[\s\S]*?font-size:\s*1\.43em/);
assert.match(css, /\.overtime-ticket-name\s*\{[\s\S]*?font-size:\s*1\.55em/);
assert.match(css, /font:\s*800 1\.9em\/1/);
assert.match(css, /repeat\(var\(--ticket-wide-columns/);
assert.match(css, /repeat\(var\(--ticket-narrow-columns/);
assert.doesNotMatch(css, /font-size:\s*clamp/);
```

- [x] **Step 2: Convert overlay sizing to the shared scale**

Set the root scale to `2cqmin`; convert clock, guide, ticket, icon, status, and adjustment dimensions to `em`; remove the forced eight-ticket single row from the short-height query; and use the narrow column variable at the `719px` container breakpoint.

- [x] **Step 3: Validate code and focused behavior**

Run: `npm run check`

Run: `node --test test/overtime-overlay.test.js`

Expected: both commands PASS.

- [x] **Step 4: Run visual and proportional QA**

Render eight rules at `1340 × 420`, `640 × 360`, and `320 × 180`. Verify rows contain `3`, `2`, and `2` tickets respectively; running status shows only `LIVE`; computed ticket-name/effect/LIVE ratios remain `1.55:1.9:1.43` against the root size; and required regions have no clipping or scroll.

- [x] **Step 5: Run the complete repository suite**

Run: `npm run check && npm test`

Expected: PASS with no new failures.

---

## Self-Review

- Spec coverage: row limits, proportional resizing, removed running copy, and requested font increases each have an implementation and QA step.
- Placeholder scan: no deferred or unspecified implementation remains.
- Type consistency: both column properties are integer strings set in `renderTickets()` and consumed directly by CSS `repeat()`.
