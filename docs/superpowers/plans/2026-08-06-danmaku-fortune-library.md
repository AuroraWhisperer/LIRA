# Danmaku Fortune Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the danmaku composer above the check-in blessing library and add an editable fortune-bot library directly below the blessings.

**Architecture:** Store the fortune pool as JSON in the existing settings store, parse it with a default fallback in the fortune service, and expose it through the existing danmaku state endpoint. Extend the current admin panel with a second collapsible editor that loads and saves the same data the bot uses.

**Tech Stack:** CommonJS Node.js 24, vanilla browser JavaScript, HTML/CSS, `node:test`.

## Global Constraints

- Keep two-space indentation, semicolons, single quotes, and existing file naming/style.
- Do not add dependencies or refactor unrelated code.
- Preserve the existing warm card UI and make the editor usable on narrow screens.
- Run `npm run check` and `npm test` before completion.

---

### Task 1: Fortune pool behavior

**Files:**
- Modify: `src/bilibili/fortune-service.js`
- Modify: `src/storage/settings-store.js`
- Modify: `src/server/routes/bilibili-routes.js`
- Test: `test/fortune-service.test.js`

**Interfaces:**
- Consumes: `settings().fortunePool` as a JSON string.
- Produces: `parseFortunePool(value)`, `pickDailyFortune(uid, dateKey, value)`, and `data.fortunePool` from the danmaku state endpoint.

- [x] **Step 1: Write failing service tests**

Add assertions that a valid saved pool is parsed and selected, while invalid, empty, or incomplete entries fall back to `FORTUNES`.

- [x] **Step 2: Run the focused test and verify failure**

Run: `node --test test/fortune-service.test.js`

Expected: FAIL because `parseFortunePool` and configurable selection do not exist.

- [x] **Step 3: Implement the minimal persisted pool**

Add `fortunePool: JSON.stringify(FORTUNES)` to defaults, return it from the state endpoint, parse four required string fields, and make the service select from the parsed setting.

- [x] **Step 4: Run the focused test and verify success**

Run: `node --test test/fortune-service.test.js`

Expected: PASS.

### Task 2: Admin panel order and editor

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/js/admin/danmaku-tool.js`
- Modify: `public/css/admin/other-features.css`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `state.fortunePool` from `/api/bilibili/danmaku/state`.
- Produces: `{ fortunePool: JSON.stringify(cleaned) }` through `POST /api/settings`.

- [x] **Step 1: Write failing markup and script regression assertions**

Assert that `danmakuComposeTitle` occurs before `danmakuBlessingsPanel`, that `danmakuFortunesPanel` follows it, and that the script loads, removes, and saves fortune entries.

- [x] **Step 2: Run the focused regression test and verify failure**

Run: `node --test test/frontend-regressions.test.js`

Expected: FAIL because the order and fortune editor are absent.

- [x] **Step 3: Reorder the existing sections and add the editor**

Move the composer immediately below the bot switches. Add a collapsed fortune section under blessings with count, four labeled fields per entry, delete controls, an add row, save status, and save button.

- [x] **Step 4: Add responsive styling and browser behavior**

Reuse the existing card tokens; display fortune fields in a four-column grid on wide screens and one column on narrow screens. Keep unsaved changes during state refresh and require at least one complete fortune before saving.

- [x] **Step 5: Run the focused regression test and verify success**

Run: `node --test test/frontend-regressions.test.js`

Expected: PASS.

### Task 3: Final verification

**Files:**
- Modify: `public/pages/admin.html` only if the embedded usage guide needs wording aligned with the new order and fortune editor.

**Interfaces:**
- Consumes: all changes from Tasks 1 and 2.
- Produces: a verified implementation with no unrelated edits.

- [x] **Step 1: Update the embedded guide text if needed**

Describe both editable word libraries and the new composer-first order without changing unrelated help content.

- [x] **Step 2: Run static validation**

Run: `npm run check`

Expected: PASS.

- [x] **Step 3: Run the complete test suite**

Run: `npm test`

Expected: PASS.

- [x] **Step 4: Review the diff**

Confirm every changed line implements section order, fortune pool persistence, editing, responsive layout, help text, or regression coverage.
