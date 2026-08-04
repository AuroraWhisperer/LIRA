# Gift Duplicate Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one future `x1` gift duplication reproducible from `terminal.log` and `desktop.log` without changing gift acceptance, deduplication, persistence, or display behavior.

**Architecture:** Keep the existing parsed-packet log as the transport boundary. Add structured decision logs inside `gift-service` for every terminal outcome, log the server broadcast trigger, and report the admin gift-toast request through the existing Electron preload bridge. Correlate all lines with stable platform, combo, database-event, user, gift, quantity, and price fields.

**Tech Stack:** Node.js 24, CommonJS backend and Electron code, browser JavaScript, built-in `node:test`.

## Global Constraints

- Preserve existing CommonJS style, two-space indentation, semicolons, and single quotes.
- Add no dependency and do not change gift processing decisions.
- Preserve all unrelated worktree changes.
- Write diagnostic lines to `terminal.log`; write the actual desktop display request to both `terminal.log` and `desktop.log`.
- Verify with focused tests, `npm run check`, and the relevant test files.

---

### Task 1: Gift-service decision diagnostics

**Files:**
- Modify: `src/bilibili/gift-service.js`
- Test: `test/gift-service.test.js`

**Interfaces:**
- Consumes: the existing `createGiftService(context).add(gift)` flow.
- Produces: `[Bilibili][GiftService] action=... trace={...}` lines while preserving the existing row-or-null return value.

- [ ] Add a test that captures `console.log`, inserts a gift, repeats its platform ID, and asserts `inserted` followed by `deduplicated` with the same database event ID.
- [ ] Run `node --test test/gift-service.test.js` and confirm the new assertion fails.
- [ ] Add a small formatter/logger and cover `disabled`, `invalid`, `free`, `buffered`, `ignored-deleted`, `deduplicated`, `updated`, and `inserted` exits.
- [ ] Re-run `node --test test/gift-service.test.js` and confirm it passes.

### Task 2: Broadcast and desktop display correlation

**Files:**
- Modify: `src/server.js`
- Modify: `src/electron/main.js`
- Modify: `src/electron/preload.js`
- Modify: `public/js/admin/gifts/notification.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: the normalized gift row returned by the gift service and the gift selected by `notifyNewGift(items)`.
- Produces: `[Bilibili][GiftDelivery] action=broadcast trigger=immediate|combo-flush trace={...}` and `[Bilibili][GiftDisplay] action=toast-requested trace={...}`.

- [ ] Add source-level regression assertions proving the preload exposes `reportGiftDisplay` and the notification module reports the exact gift key it requests.
- [ ] Run the focused frontend regression test and confirm it fails.
- [ ] Log immediate and delayed gift broadcasts with the database event ID and gift fields.
- [ ] Add a narrow `desktop:gift-display` IPC handler, sanitize its scalar fields, write it through `writeLog`, and mirror the canonical line with `console.log`.
- [ ] Call the bridge only after gift notifications are enabled and a toast is requested; remain a no-op in a normal browser.
- [ ] Re-run the focused frontend regression test and confirm it passes.

### Task 3: Verification

**Files:**
- Verify only; no additional source files.

**Interfaces:**
- Consumes: the diagnostic implementation from Tasks 1 and 2.
- Produces: evidence that the changes are syntactically valid and preserve existing relevant behavior.

- [ ] Run `npm run check`.
- [ ] Run `node --test test/gift-log.test.js test/gift-service.test.js test/terminal-log.test.js`.
- [ ] Run the targeted frontend regression assertion with the repository's VM-module test configuration.
- [ ] Review `git diff --check` and ensure every changed line belongs to diagnostics or its tests.

## Self-Review

- Spec coverage: transport receipt, service decision, server broadcast, and desktop toast request are all observable and correlated.
- Deliberate exclusion: no new deduplication heuristic and no change to the 10-second combo buffer.
- Placeholder scan: no deferred implementation placeholders.
- Type consistency: service methods keep their row-or-null returns; Electron receives only a plain scalar diagnostic object.
