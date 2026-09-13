# Remote Gift Controller Test Ownership Plan

## Goal

Split the 1,333-line remote gift controller test into bootstrap/cursor, SSE/catch-up, and silent-stream lifecycle suites while preserving all 32 controller regressions and per-instance fences.

## Current Behavior / Ownership

- The file covers history capability, epoch/token restart, cursor validation, SSE wire and immediate projection, silent reconciliation, retry backoff, authorization fences, stop/dispose/restart invalidation, and origin rejection.
- The focused baseline passes 32/32 against the completed Batch C recovery-rule extraction.
- One existing fixture creates a fresh authorization epoch, runtime state, stream, timers, and call logs per test.

## Compatibility Constraints / Non-goals

- Move complete tests without changing the four-field fence, epoch/generation logic, page data, timer callbacks, or assertions.
- Extract only the existing fixture/page/deferred helpers for genuine reuse; no controller, stream, callback, or mutable runtime state is shared.
- Keep complete bootstrap, SSE handoff, and silent-reconciliation chains intact.
- Do not modify the completed Batch C controller/recovery modules or B/D work.

## Milestones

- [x] Keep bootstrap, history capability, epoch/token restarts, cursor validation, stop query freeze, and loopback rejection in `remote-gift-controller.test.js`.
- [x] Move SSE closure, epoch mismatch, discovery retry, immediate projection, wire validation, and ordered catch-up to `remote-gift-controller-sse.test.js`.
- [x] Move silent reconciliation, non-overlap, stop/dispose/restart/auth invalidation, backoff, and pending-pull fencing to `remote-gift-controller-reconciliation.test.js`.
- [x] Share only the existing per-test fixture and immutable page/event builders through `helpers/remote-gift-controller-fixture.js`.
- [x] Remove the obsolete legacy-size record and verify exact test ownership, 32 focused tests, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 32 tests now live in bootstrap, SSE/catch-up, and reconciliation suites of 350, 393, and 320 lines plus a 327-line isolated fixture; focused execution passed 32/32 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 32 tests remain present and passing exactly once, complete lifecycle chains remain intact, every file is below 800 lines, and the old 1,333-line allowance is removed.
