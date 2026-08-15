# Requested Maintenance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bound in-memory song-request cooldown state, report all queue deletions accurately, and refund API quota for any failed provider-operation post-processing.

**Architecture:** Reuse the existing 24-hour cooldown retention policy and evict expired Map entries in insertion order. Count every queue row before the existing full-table delete. Add an idempotent quota reservation lifecycle helper and wrap each AMap/QWeather request plus its response normalization in that lifecycle.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, SQLite via `node:sqlite`.

## Global Constraints

- Keep changes minimal and preserve existing public tool behavior.
- Follow the repository's two-space JavaScript style and existing test helpers.
- Verify with `npm run check && npm test`.

---

### Task 1: Bound Cooldown Map

**Files:**
- Modify: `src/storage/cooldown-store.js`
- Modify: `src/bilibili/bilibili-message-handler.js`
- Test: `test/random-song-filter.test.js`

- [x] Add a cooldown-store Map-pruning method that removes entries older than the existing retention window, and load persisted rows oldest-first so eviction is amortized.
- [x] Invoke pruning before cooldown lookup in the danmaku handler.
- [x] Add a regression test proving an expired entry is removed while a fresh entry remains.

### Task 2: Count All Queue Deletions

**Files:**
- Modify: `src/storage/database.js`
- Create: `test/database-maintenance.test.js`

- [x] Change the pre-delete queue count to include every row because the following statement deletes every queue row.
- [x] Seed active and deleted queue rows, call `clearAllData`, and assert `deletedCounts.queue`, `totalDeleted`, and the table row count.

### Task 3: Make Provider Quota Reservations Lifecycle-Safe

**Files:**
- Modify: `src/ai/api-quota-store.js`
- Modify: `src/ai/tools/amap-tool.js`
- Modify: `src/ai/tools/qweather-tool.js`
- Modify: `test/ai-provider-adapters.test.js`

- [x] Add an idempotent reservation/`withApiQuota` helper that commits only after the supplied operation succeeds and releases once on any thrown error.
- [x] Wrap AMap and QWeather response validation/normalization inside the reservation callback, including empty locations, empty routes, and invalid connection responses.
- [x] Add regression tests that force post-request processing failures and assert the quota store release count.
