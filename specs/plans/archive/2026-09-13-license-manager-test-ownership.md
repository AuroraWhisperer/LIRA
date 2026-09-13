# License Manager Test Ownership Plan

## Goal

Split the 1,102-line license manager test into authorization establishment, protected operations, renewal/revocation, and revalidation/lifecycle suites while preserving all 39 state-transition tests.

## Current Behavior / Ownership

- The file has one 163-line `createHarness` factory and 39 tests spanning bootstrap, expiry parsing, song/gift/background operations, renewal, revocation, heartbeat, concurrent reverify, disposal, and challenge races.
- The focused baseline passes 39/39.
- Every harness call already creates an independent manager, key pair, remote mock, and state store.

## Compatibility Constraints / Non-goals

- Move complete tests without weakening fail-closed, credential, authorization, retry, epoch, or disposal assertions.
- Extract only the existing harness for genuine reuse; do not share a manager or mutable calls object between tests.
- Preserve production state enums, errors, token semantics, and operation contracts.
- Do not modify the completed Batch B license implementation or C/D work.

## Milestones

- [x] Keep bootstrap, activation, and expiry parsing in `license-manager.test.js`.
- [x] Move song, background, catalog, gift, and renderer-boundary operations to `license-manager-operations.test.js`.
- [x] Move renewal, revocation, bootstrap failure, heartbeat, and transient protected failures to `license-manager-renewal.test.js`.
- [x] Move cloud reads, shared reverify, epoch changes, disposal, 401 storms, resume, and challenge races to `license-manager-revalidation.test.js`.
- [x] Share the existing independent harness through `helpers/license-manager-harness.js`.
- [x] Remove the obsolete legacy-size record and verify exact test ownership, focused tests, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 39 tests now live in four behavior suites of 88–374 lines plus a 171-line per-test harness; focused execution passed 39/39 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 39 tests remain present and passing exactly once, each test still owns an independent manager instance, every file is below 800 lines, and the old 1,102-line allowance is removed.
