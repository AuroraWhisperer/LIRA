# Gift History 3.x Sorting Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- Status: Complete
- Date: 2026-09-08
- Owner requirement: restore the desktop recent-gift “View all” drawer to the 3.x table layout and sorting behavior.

**Goal:** Restore the 3.x sortable six-column gift-history drawer, including total-count and total-page feedback, without weakening the 4.x active-source isolation or reverting its keyset pagination.

**Architecture:** Keep `GET /api/gifts/history` source-resolved at the server boundary and retain opaque keyset cursors. Extend the existing query with allowlisted `sortField`/`sortDirection`, encode the selected ordering in each cursor, and return the filtered total alongside every page. The renderer restores the four sortable 3.x headers and drives the existing previous/next cursor navigation.

**Tech Stack:** Electron 43 renderer, no-build Vanilla JavaScript ES modules, CommonJS Node.js services/routes, SQLite `DatabaseSync`, native CSS, `node:test`.

## Global Constraints

- Preserve active-source resolution; the renderer must never send `sourceId` or receive another streamer’s rows.
- Preserve opaque keyset pagination and the unbounded all-history projection; do not restore the 3.x 3000-row cap or OFFSET pagination.
- Preserve the accepted clear-display behavior: clear only the current table, invalidate pending requests, and reload on reopen without deleting rows.
- Preserve search/range API compatibility even though the desktop drawer continues to request `range=all` and exposes neither control.
- Allow only `created_at`, `gift_name`, `price`, and `remarks`; allow only `asc` and `desc`; parameterize all cursor values.
- Preserve existing version-1 default-time cursors while emitting/accepting a versioned cursor that binds non-default sorting.
- Make only task-owned edits, preserve current unrelated worktree changes, and do not commit.

---

## Non-goals

- Reintroducing the removed statistics, ranking, trend, search, date-range, or sync-toolbar UI.
- Changing remote bootstrap, SSE delivery, projection ownership, persistence schema, retention, or database-clear behavior.
- Making quantity or user columns sortable; the 3.x drawer did not expose those sort controls.
- Refactoring adjacent gift code or changing recent-gift cards.

## Current Behavior

- `public/pages/admin/gifts/history.html` has the six table columns but no sortable header metadata or arrows.
- `public/js/admin/gifts/history.js` always requests default time-descending order and shows only “本页 N 条 / 第 N 页”.
- `src/bilibili/gift/query-service.js` and `src/storage/gift-query-store.js` support only `(created_at DESC, id DESC)` cursors.
- Tag `v3.7.11` had sortable `created_at`, `gift_name`, `price`, and `remarks` headers plus total-count and total-page feedback, but its old implementation was unpartitioned, limited to 3000 rows, and OFFSET-based.
- The accepted projection-sync design requires the modern drawer to remain source-partitioned and keyset-paginated.

## Ownership

- Product/UI contract: `specs/gift-ledger-projection-sync_design.md`.
- Query owner: `src/bilibili/gift/query-service.js`.
- SQL owner: `src/storage/gift-query-store.js`.
- HTTP boundary: `src/server/routes/gift-routes.js`.
- Renderer: `public/pages/admin/gifts/history.html`, `public/js/admin/gifts/history.js`, and `public/css/admin/responsive.css`.
- Contract documentation: `docs/architecture/backend/api.md` and `docs/architecture/backend/bilibili/gift.md`.
- Direct tests: `test/gift-query-service.test.js`, `test/gift-routes.test.js`, and `test/frontend-gifts.test.js`.

## Compatibility Constraints

- Default requests with no sort parameters remain time-descending.
- Existing default-order opaque cursors remain valid.
- A cursor is invalid when reused with a different query, range, sort field, or sort direction.
- Every ordered query uses `id DESC` as the deterministic tie-breaker.
- Counts and pages use the same active source, canonical paid-final predicate, range, search query, and `asOf` boundary as the rows.
- Incomplete/offline/error synchronization status stays below the title only when relevant.

## Proposed Changes

- Add allowlisted sort normalization, sort-bound cursors, and total metadata in the gift query service.
- Add allowlisted SQL ordering, strict keyset predicates for each order, and a matching count query in the gift query store.
- Forward sort parameters and map sort validation errors to HTTP 400 in the gift route.
- Restore the four interactive table headers, arrows, total count, total pages, and previous/next arrow labels in the drawer.
- Update focused tests and the accepted/public contract documents.

## Milestones

### Task 1: Lock the sorted keyset and route contract

**Files:**
- Modify: `test/gift-query-service.test.js`
- Modify: `test/gift-routes.test.js`

**Interfaces:**
- Consumes: `getGiftHistory(context, { query, range, limit, cursor, sortField, sortDirection })`.
- Produces: history data containing `items`, `nextCursor`, `hasMore`, `total`, `totalPages`, `sortField`, and lowercase `sortDirection`.

- [x] Add a service test with tied rows proving all four fields sort across more than one page, the cursor continues without duplicates, and totals remain stable.
- [x] Add service assertions that unknown fields/directions and a cursor reused under another order throw `INVALID_GIFT_SORT_FIELD`, `INVALID_GIFT_SORT_DIRECTION`, and `INVALID_GIFT_CURSOR` respectively.
- [x] Add route assertions that `sortField=price&sortDirection=asc` is forwarded but renderer-supplied source selectors remain forbidden.
- [x] Add route assertions that the two new validation errors return HTTP 400.
- [x] Run `node --test test/gift-query-service.test.js test/gift-routes.test.js` and confirm the new assertions fail before implementation.

### Task 2: Implement source-safe sorted keyset queries

**Files:**
- Modify: `src/storage/gift-query-store.js`
- Modify: `src/bilibili/gift/query-service.js`
- Modify: `src/server/routes/gift-routes.js`

**Interfaces:**
- `normalizeHistorySortField(value)` returns one of `created_at|gift_name|price|remarks` or throws `INVALID_GIFT_SORT_FIELD`.
- `normalizeHistorySortDirection(value)` returns `asc|desc` or throws `INVALID_GIFT_SORT_DIRECTION`.
- `createGiftQueryStore(giftDb).listHistory(options)` consumes validated sort data and a cursor whose `sortValue` matches that field.
- `createGiftQueryStore(giftDb).countHistory(options)` returns the count for the same filter without applying the page cursor.

- [x] Add constant SQL expressions for the four fields; derive remarks order from 3.x guard ranks and canonical blind-box profit, and reject unknown fields/directions before interpolating SQL.
- [x] Extend the filter with `sortValue >|< ? OR (sortValue = ? AND id < ?)` and keep `ORDER BY <allowlisted expression> <ASC|DESC>, id DESC`.
- [x] Count the same filtered, active-source, pre-`asOf` event set without the cursor boundary.
- [x] Normalize sort options in the service; bind sort/query/range/as-of into the opaque cursor and retain version-1 default-order decoding.
- [x] Return `total` and `totalPages = max(1, ceil(total / limit))` with the existing sync metadata.
- [x] Forward only the two sort parameters in the route and map their validation codes to HTTP 400.
- [x] Run `node --test test/gift-query-service.test.js test/gift-routes.test.js` and confirm all tests pass.

### Task 3: Restore the 3.x drawer interaction and feedback

**Files:**
- Modify: `public/pages/admin/gifts/history.html`
- Modify: `public/js/admin/gifts/history.js`
- Modify: `public/css/admin/responsive.css`
- Modify: `test/frontend-gifts.test.js`

**Interfaces:**
- `buildGiftHistoryUrl({ cursor, limit, sortField, sortDirection })` always keeps `range=all`, omits renderer source identity, and sends non-default sorting.
- `createGiftLedgerState()` owns `sortField='created_at'`, `sortDirection='desc'`, `total=0`, and `totalPages=1` in addition to cursor navigation.

- [x] Update the markup test to require `data-sort` and `.sort-arrow` on time, gift, amount, and remarks, with time initially `aria-sort="descending"`; require the 3.x arrow labels in the footer.
- [x] Extend renderer tests so clicking a new header starts ascending on page one, clicking it again toggles descending, updates `aria-sort`/the arrow, and requests the selected order without any source selector.
- [x] Extend row-loading assertions to expect `共 N 条` and `第 current/total 页` from server metadata while retaining escaped six-cell rows and sync-state behavior.
- [x] Restore the four sortable headers and footer labels in HTML; add a restrained keyboard focus outline in the existing table style.
- [x] Add click plus Enter/Space handling, reset cursor navigation on sort changes, include sort parameters in requests, and render sort/total/page state.
- [x] Run `node --test test/frontend-gifts.test.js test/frontend-admin-shell.test.js` and confirm all tests pass.

### Task 4: Align contracts and complete verification

**Files:**
- Modify: `specs/gift-ledger-projection-sync_design.md`
- Modify: `docs/architecture/backend/api.md`
- Modify: `docs/architecture/backend/bilibili/gift.md`
- Modify: this plan, moving it to `specs/plans/archive/` only after all checks pass.

**Interfaces:**
- Documents must describe the same allowlist, default order, sort-bound keyset cursor, total metadata, and sortable desktop headers implemented in code.

- [x] Amend the accepted local-query/UI contract and acceptance criterion 16 to name the four sortable fields while preserving keyset navigation and source isolation.
- [x] Update the API table and gift query fact to match the implemented request/response.
- [x] Run `node --test test/gift-query-service.test.js test/gift-routes.test.js test/frontend-gifts.test.js test/frontend-admin-shell.test.js`.
- [x] Run `git diff --check` and inspect `git diff --` for only the task-owned files.
- [x] Inspect `git status --short` and confirm unrelated pre-existing changes remain untouched.
- [x] Mark this plan complete and archive it only when every Done When item is satisfied.

## Verification

```text
node --test test/gift-query-service.test.js test/gift-routes.test.js
node --test test/frontend-gifts.test.js test/frontend-admin-shell.test.js
git diff --check
git status --short
```

Expected result: all focused tests pass, diff check prints no errors, and status contains only the known pre-existing changes plus this task’s scoped files.

## Rollback Or Failure Handling

Stop at the first failing milestone and inspect only the scoped diff. Reverse task-owned hunks with `apply_patch`; do not reset the worktree, delete user files, or touch unrelated staged/unstaged content. Because this change adds no schema or persisted setting, rollback is code-only; version-1 cursors remain accepted throughout.

## Done When

- The drawer visibly matches the 3.x six-column table/actions/footer structure.
- Time, gift, amount, and remarks sort the complete matching history in both directions with deterministic cross-page results.
- Total count and `current/total` page feedback are accurate for the same `asOf` event set.
- Existing default cursors, range/search API use, active-source isolation, clear-display behavior, and sync-state display remain intact.
- Focused tests, diff check, contract documentation, and final scoped status/diff review pass.
