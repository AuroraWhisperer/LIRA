# Blind Box Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin blind-box event stream with a novice-friendly per-viewer summary and add a maintainable full analysis workspace below the desktop top bar.

**Architecture:** Keep the existing compact statistics endpoint for frequent admin refreshes and add a paginated analysis query for filtered detail. Split compact rendering, analysis behavior, and analysis styling into focused files, with the admin page providing only semantic markup and stable element IDs.

**Tech Stack:** Node.js 24, CommonJS service/routes, SQLite, browser ES modules, vanilla HTML/CSS, `node:test`.

## Global Constraints

- Preserve all existing uncommitted user changes.
- Add no dependency.
- Use two-space indentation, semicolons, and single quotes.
- Use plain Chinese labels suitable for users unfamiliar with computers.
- Treat profit as viewer profit: opened value minus blind-box cost.
- Treat `num` as box count and all three money fields as totals for the stored event; never multiply money by `num` again.
- Run `npm run check` and `npm test` before completion.

---

### Task 1: Analysis query contract

**Files:**
- Modify: `src/bilibili/gift/blind-box-analysis.js`
- Modify: `src/server/routes/gift-routes.js`
- Modify: `src/server.js`
- Test: `test/gift-service.test.js`

**Interfaces:**
- Consumes: `context.db.giftDb` and normalized gift rows.
- Produces: `getBlindBoxAnalysis(context, options)` and service method `getBlindBoxAnalysis(options)`.

- [ ] Write tests that insert multiple viewers, box types, quantities, and pages, then assert filtered summaries, grouped rows, box/viewer options, and record pagination.
- [ ] Run `node --test --experimental-vm-modules test/gift-service.test.js` and confirm the new tests fail because the analysis function is missing.
- [ ] Implement bounded view, page, limit, sort, and direction parsing plus parameterized viewer and box filters.
- [ ] Return `{ today, summary, filters, view, items, pagination }` from the service, expose it at `GET /api/gifts/blind-box-analysis`, and inject the method into the route context in `src/server.js`.
- [ ] Re-run the focused service test and confirm it passes.

### Task 2: Compact per-viewer panel

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/js/admin/gifts/blindbox.js`
- Modify: `public/css/admin/gifts.css`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `summary` and `perUser` from `/api/gifts/blind-box-stats`.
- Produces: `openBlindBoxAnalysis(initialFilters)` call through `window.AdminApp.gifts.analysis`.

- [ ] Add regression assertions for a “查看全部” button, per-viewer columns, and removal of event-level columns from the compact table.
- [ ] Run the focused frontend test and confirm it fails.
- [ ] Update semantic markup and render one row per viewer, sorted by viewer profit descending.
- [ ] Add row activation so a viewer opens that viewer's “开盒记录” directly.
- [ ] Add compact responsive styles and clear positive/negative presentation.
- [ ] Re-run the focused frontend test.

### Task 3: Analysis workspace module

**Files:**
- Create: `public/js/admin/gifts/blindbox-analysis.js`
- Create: `public/css/admin/blindbox-analysis.css`
- Modify: `public/pages/admin.html`
- Modify: `public/css/styles-admin.css`
- Modify: `public/js/admin/gifts/index.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `GET /api/gifts/blind-box-analysis` and utilities from `window.AdminApp.utils`.
- Produces: `window.AdminApp.gifts.analysis.open(filters)`, `.close()`, and `.refreshIfOpen()`.

- [ ] Add regression assertions for the separate assets, named-region semantics, close control, two filters, three view buttons, results table, and pagination controls.
- [ ] Run the focused frontend test and confirm it fails.
- [ ] Add the workspace markup after the admin pages and before transient modal layers.
- [ ] Implement isolated state and request sequencing in `blindbox-analysis.js`; encode all dynamic text.
- [ ] Implement open/close cleanup, Escape handling, focus restoration, filters, views, loading, error, empty, and pagination states. Keep sorting internal and defaulted for novice users.
- [ ] Build a restrained operational design in `blindbox-analysis.css` using the existing admin palette, a fixed 58px top boundary, responsive controls, sticky table headers, and stable control sizes.
- [ ] Re-run the focused frontend test.

### Task 4: Integration and visual verification

**Files:**
- Modify: `public/js/admin/state.js`
- Modify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: WebSocket snapshot `reason` and the shared event bus.
- Produces: debounced gift-only refresh without queue-module coupling or playback interruption.

- [ ] Emit `Events.GIFT_RECEIVED` only for gift-related snapshot reasons.
- [ ] Subscribe from the compact and analysis modules and debounce refresh while analysis is open.
- [ ] Run `npm run check` and fix syntax errors only in files touched by this feature.
- [ ] Run `npm test` and fix feature regressions.
- [ ] Start the existing development server and capture 1440x900 and 1024x768 screenshots with seeded or mocked data.
- [ ] Verify the workspace covers the player, leaves the top bar usable, has no text overlap, and closes back to the original gift page state.
