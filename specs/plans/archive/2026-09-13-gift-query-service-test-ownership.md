# Gift Query Service Test Ownership Plan

## Goal

Split the 809-line gift query test into history/source behavior and statistics behavior while preserving the isolated temporary-database setup and all eight tests.

## Current Behavior / Ownership

- Three history/search/sort tests, four statistics tests, and one legacy active-source integration test share a per-test database fixture.
- The focused baseline passes 8/8.
- The file is only nine lines over the ordinary ceiling, but history and statistics are already distinct contracts.

## Compatibility Constraints / Non-goals

- Move complete tests without changing database rows, source isolation, money checks, pagination, or failure assertions.
- Extract only the existing database fixture for genuine reuse by both suites; each call creates and closes its own directory and databases.
- Keep the legacy page read helper with its sole integration test.
- Do not modify storage/query production code or B/C/D work.

## Milestones

- [x] Keep query validation, literal search, deterministic keyset pagination, and legacy active-source behavior in `gift-query-service.test.js`.
- [x] Move cents, canonical rows, bounded metrics, month buckets, and aggregate-failure behavior to `gift-statistics-service.test.js`.
- [x] Share the existing isolated database constructor through `helpers/gift-query-fixture.js`.
- [x] Remove the obsolete legacy-size record and verify exact test ownership, focused tests, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The eight tests now live in 491-line query and 241-line statistics suites plus a 93-line isolated database fixture; focused execution passed 8/8 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All eight tests remain present and passing exactly once, both suites and the fixture stay below 800 lines, no database state is shared across tests, and the old 809-line allowance is removed.
