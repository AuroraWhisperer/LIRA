# Overtime Service Test Ownership Plan

## Goal

Split the 1,703-line overtime service test into schema/recovery, timer/state, gift-rule, and settlement/recovery suites while preserving all 39 runtime tests and isolated database/clock fixtures.

## Current Behavior / Ownership

- The file combines schema migration, recovery pauses, monotonic timers, action failure matrices, validation, fixed/random rules, settlement idempotency, rollback, replay, and legacy identity behavior.
- The focused baseline passes 39/39.
- Existing fixture functions create a fresh data directory, database set, service, and fake clock per test.

## Compatibility Constraints / Non-goals

- Move complete test and generated-test blocks without changing SQL, time values, rule weights, failure injection, or assertions.
- Extract only the existing fixture/rule/fake-clock functions for genuine reuse; no database, clock, or service instance may be shared.
- Keep complete rollback and recovery chains together.
- Do not modify the completed Batch B overtime implementation or C/D storage work.

## Milestones

- [x] Keep schema migration and recovery pause/reload contracts in `overtime-service.test.js`.
- [x] Move monotonic timing, restart, and validation to `overtime-state.test.js`.
- [x] Move the action save-failure matrix to `overtime-state-failures.test.js`.
- [x] Move fixed/group/item/random/effect rule behavior to `overtime-rules.test.js`.
- [x] Move pending epochs, startup compensation, rollback/retry, clear, identity replay, and legacy rules to `overtime-settlement.test.js`.
- [x] Share only the existing per-test fixture, rule builders, insert helper, and fake clock through `helpers/overtime-service-fixture.js`.
- [x] Remove the obsolete legacy-size record and verify source registration parity, 39 focused tests, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 39 runtime tests now live in five behavior suites of 237–405 lines plus a 213-line isolated fixture; focused execution passed 39/39 and all 30 source registration expressions remain present exactly once.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 39 tests pass after migration, every registration block is present exactly once, fixtures remain isolated, every file is below 800 lines, and the old 1,703-line allowance is removed.
