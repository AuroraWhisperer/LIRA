# Remote Catalog Cache Test Ownership Plan

## Goal

Split the 1,040-line remote catalog cache test into cache lifecycle, catalog contract, and hybrid room/server behavior while retaining all 21 tests and persisted-cache integration paths.

## Current Behavior / Ownership

- One file mixes lookup replacements, coalescing/ETag/disk fallback, strict v2 and image-origin validation, relation changes, and hybrid room/search behavior.
- The focused baseline passes 21/21 against the completed Batch B catalog extraction.
- Three small response wrappers adapt fixture payloads to the v2 contract and are used by both cache and contract suites.

## Compatibility Constraints / Non-goals

- Move complete tests without changing temporary directories, snapshots, ETags, failure injection, origins, relations, or identity assertions.
- Share only the existing immutable logger/constants and v2 response wrappers; each test still creates its own cache and storage.
- Preserve the persisted-cache and post-persistence notification integration behavior.
- Do not modify the completed Batch B catalog modules or C/D work.

## Milestones

- [x] Keep lookup, refresh coalescing, ETag, persisted fallback, and stop behavior in `remote-catalog-cache.test.js`.
- [x] Move strict v2, image-origin, relation, replacement, and persistence-failure contracts to `remote-catalog-contract.test.js`.
- [x] Move room-primary merge, relation-only filtering, and unavailable server search to `hybrid-gift-catalog.test.js`.
- [x] Share only the existing v2 fixture adapters through `helpers/remote-catalog-fixture.js`.
- [x] Remove the obsolete legacy-size record and verify exact test ownership, 21 focused tests, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 21 tests now live in cache, contract, and hybrid-catalog suites of 349, 545, and 142 lines plus a 46-line fixture; focused execution passed 21/21 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 21 tests remain present and passing exactly once, each file stays below 800 lines, cache lifecycle state remains local to each test, and the old 1,040-line allowance is removed.
