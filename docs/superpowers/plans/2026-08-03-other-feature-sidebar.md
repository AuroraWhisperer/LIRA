# Other Feature Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder "其他" page with an extensible left-side feature menu and move the existing performance monitor into its first feature panel.

**Architecture:** Keep each feature's implementation independent from the navigation shell. HTML connects menu buttons and panels through `data-other-feature` and element IDs; `other.js` only manages selection state, while `metrics.js` continues to own all performance behavior.

**Tech Stack:** Static HTML, modular CSS, browser JavaScript, Node.js `node:test` regression tests.

## Global Constraints

- Preserve the existing warm neutral admin theme and fixed player-dock spacing.
- Do not add dependencies or change the performance API.
- Keep the existing performance element IDs so `metrics.js` remains unchanged.
- Preserve unrelated worktree changes, including `public/css/admin/modals.css`.

---

### Task 1: Lock the feature-shell contract with regression tests

**Files:**
- Modify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: Existing `admin.html`, `styles-admin.css`, and `other.js` source files.
- Produces: Regression assertions for a single performance panel, a data-driven menu/panel mapping, and active-state behavior.

- [x] **Step 1: Add a structure test**

Assert that the point-song tab list no longer targets `performancePage`, the other page contains `data-other-feature="otherPerformanceFeature"`, the panel has `id="otherPerformanceFeature"`, and all metric IDs occur exactly once.

- [x] **Step 2: Add an interaction test**

Evaluate `other.js` in a VM with two menu buttons and two panels, call its exported feature selector, then assert `active`, `aria-selected`, `tabIndex`, and `hidden` states move to the requested panel.

- [x] **Step 3: Run the focused tests and verify failure**

Run: `node --experimental-vm-modules --test test/frontend-regressions.test.js`

Expected: FAIL because the placeholder page has no feature-shell markup or selector implementation.

### Task 2: Build the data-driven other-page navigation

**Files:**
- Modify: `public/js/admin/other.js`

**Interfaces:**
- Consumes: `#otherAssistantPage`, `[data-other-feature]`, and `[data-other-feature-panel]` DOM contracts.
- Produces: `window.AdminApp.other.initOtherPage()` and `window.AdminApp.other.selectFeature(root, featureId)`.

- [x] **Step 1: Replace placeholder initialization**

Implement `selectFeature(root, featureId)` to resolve a valid menu/panel pair and update button/panel accessibility state without importing or calling feature modules.

- [x] **Step 2: Bind menu clicks once**

Have `initOtherPage()` bind each feature button and select the button marked `aria-selected="true"`, falling back to the first valid feature.

- [x] **Step 3: Run the focused interaction test**

Run: `node --experimental-vm-modules --test test/frontend-regressions.test.js`

Expected: The interaction test passes while the HTML structure test still fails.

### Task 3: Move performance into the new shell and style it

**Files:**
- Modify: `public/pages/admin.html`
- Create: `public/css/admin/other-features.css`
- Modify: `public/css/styles-admin.css`

**Interfaces:**
- Consumes: Existing metric element IDs and `.monitor-*` component styles.
- Produces: A left navigation shell whose first item controls `#otherPerformanceFeature` and whose right panel contains the unchanged metric controls.

- [x] **Step 1: Remove the old point-song performance entry and panel**

Delete the `data-tab="performancePage"` button and the old `#performancePage` wrapper so no duplicate navigation path or IDs remain.

- [x] **Step 2: Replace the other-page placeholder**

Add an `aside` menu with a performance button and a sibling feature-content region. Move the existing monitor hero, cards, and footer into `#otherPerformanceFeature` without renaming metric IDs.

- [x] **Step 3: Add isolated layout styles**

Define only `.other-*` shell selectors in `other-features.css`: desktop two-column layout, active menu state, scroll ownership, focus visibility, reduced motion, and a stacked narrow-window layout.

- [x] **Step 4: Import the feature stylesheet**

Add `@import url('./admin/other-features.css');` after the workspace stylesheet in `styles-admin.css`.

- [x] **Step 5: Run the focused test**

Run: `node --experimental-vm-modules --test test/frontend-regressions.test.js`

Expected: PASS.

### Task 4: Verify the complete change

**Files:**
- Inspect: `public/pages/admin.html`
- Inspect: `public/js/admin/other.js`
- Inspect: `public/css/admin/other-features.css`
- Inspect: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: Completed feature shell and existing metrics module.
- Produces: A reviewable, tested patch with no unrelated modifications.

- [x] **Step 1: Run static validation**

Run: `npm run check`

Expected: PASS.

- [x] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [x] **Step 3: Review the final diff**

Confirm performance markup exists once, `metrics.js` is unchanged, the new CSS is selector-scoped, and `public/css/admin/modals.css` remains untouched by this work.
