# Processed Gift Import Test Ownership Plan

## Goal

Split the 1,190-line processed gift import test into projection, atomicity, wire-contract, and source-identity suites while preserving all 17 tests and complete cross-database assertions.

## Current Behavior / Ownership

- The file mixes history/live projection consumers, pause/clear/replay rollback, privacy and exact wire validation, negotiated source identity, and shared database/clock setup.
- The focused baseline passes 17/17.
- Existing fixture functions create a fresh database set, projection service, source, and fake clock per invocation.

## Compatibility Constraints / Non-goals

- Move complete tests without changing canonical DTOs, privacy rejection, source binding, transaction rollback, cursor, or consumer assertions.
- Keep the full multi-consumer and replay rollback scenarios intact.
- Extract only the existing isolated fixture/event helpers for genuine reuse; no database or runtime state is shared.
- Do not modify the completed Batch B import implementation or C/D storage/lifecycle work.

## Milestones

- [x] Keep history/realtime projection and existing consumer coverage in `processed-gift-import.test.js`.
- [x] Move pause, clear-generation, and full canonical replay rollback to `processed-gift-import-atomicity.test.js`.
- [x] Move privacy, canonicalization, history-page, and incremental-page validation to `processed-gift-contract.test.js`.
- [x] Move explicit captured-source and negotiated identity/rebinding behavior to `processed-gift-source.test.js`.
- [x] Share only the existing per-test database/projection/event helpers through `helpers/processed-gift-fixture.js`.
- [x] Remove the obsolete legacy-size record and verify exact test ownership, 17 focused tests, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 17 tests now live in four behavior suites of 63–454 lines plus a 154-line isolated fixture; focused execution passed 17/17 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 17 tests remain present and passing exactly once, transaction-spanning scenarios remain whole, fixtures stay isolated, every file is below 800 lines, and the old 1,190-line allowance is removed.
