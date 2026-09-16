# Gift Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume and display the server's three explicit gift categories across the desktop client.

**Architecture:** `giftCategory` is required catalog metadata, independent of an individual event's blind-box origin. The user deploys both ends together and reinstalls clients; no new old-format compatibility path is needed. The detailed cross-repository plan is `D:/Work/lira-server/docs/superpowers/plans/2026-09-16-gift-category.md`.

**Tech Stack:** Existing CommonJS catalog/cache modules, browser ESM and node:test.

## Global Constraints

- Preserve existing uncommitted work; do not commit or release.
- Keep raw upstream numbers, processed gift/ledger origin flags, probabilities and valuation unchanged.
- Use server categories; UI does not reconstruct category from raw flags or gift names.

## Tasks

- [x] Update `specs/gift-identity-overtime.md` and `docs/architecture/backend/bilibili/gift.md` for `directGift | blindBox | blindBoxOutput`.
- [x] Update `src/bilibili/gift/variant-catalog-contract.js` and `remote-catalog-contract.js` to validate named categories and relation consistency; preserve atomic cache behavior and category in normalized snapshots.
- [x] Ensure `variant-room-catalog.js` does not retain a category when the complete identity is unmatched.
- [x] Update `public/js/shared/gift-catalog-roles.js` and `public/js/admin/gifts/blindbox.js` to display/select by the enum.
- [x] Update catalog/frontend fixtures and add invalid/missing/contradictory category/cache regression coverage; run focused suites and repository gates.

## Current behavior and ownership

Previously catalog `isBlindBox` and relation membership jointly encoded categories.
The catalog publisher now owns category derivation; client contract modules own
validation, the existing cache owns atomic persistence and the UI owns labels.
No new service, migration or category fallback was introduced. Event processing,
settlement, raw upstream metadata and probability maintenance are non-goals.

## Done when and verification

The catalog, cache, room identity and picker regressions pass; documentation and
architecture checks pass; remaining failures outside this change are identified
without modifying their owners. Final task-specific diff review is complete.

- `node --experimental-vm-modules --test test/gift-category.test.js test/overtime-gift-picker.test.js test/remote-overtime-catalog.test.js`: 15 passed.
- `node --experimental-vm-modules --test test/overtime-routes.test.js test/overtime-gift-picker.test.js test/modularity-size.test.js test/governance-docs.test.js`: 25 passed after updating remaining catalog fixtures.
- `npm run verify:quick`: passed documentation, JS syntax, architecture and modularity gates.
- `npm test`: 1,961 passed, 4 skipped, 1 unrelated failure. `test/frontend-admin-toolbox.test.js:312` still expects a local `/danmaku` assignment; pre-existing `public/js/admin/display.js` changes now obtain a server overlay address. Neither file was edited for gift categories.
- Server full suite: 1,430 passed. All 25 relevant browser scenarios passed across the main run and the corrected-fixture rerun.

## Failure handling and rollout

Release the server and freshly installed client together. Invalid categories or
relations preserve the last successful snapshot; room identities that no longer
match lose their stale category. Reverting this task requires reversing only the
category-specific diff in both repositories; preserve other uncommitted changes.
No commit, packaging or deployment was performed.
