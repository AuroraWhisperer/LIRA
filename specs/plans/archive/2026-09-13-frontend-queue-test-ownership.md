# Frontend Queue Test Ownership Plan

## Goal

Finish the Batch A test migration for `frontend-queue.test.js` by separating queue configuration, illustrated themes, and overflow/scrolling behavior without changing any assertion or production code.

## Current Behavior / Ownership

- Overtime-console tests were already moved out; the remaining 1,543-line file registers 22 queue tests.
- The focused baseline passes 22/22.
- The remaining natural boundaries are admin configuration, complete illustrated-theme rows, and runtime overflow/resize behavior.

## Compatibility Constraints / Non-goals

- Preserve all 22 complete test blocks exactly once.
- Keep the local JavaScript bundle adapter with each consumer; do not add a generic helper for three small declarations.
- Do not split by individual skin and do not change queue CSS, renderer JavaScript, settings storage, or B/C/D files.
- Preserve default test discovery; this suite is not part of the explicit `test:admin` command.

## Milestones

- [x] Keep admin queue settings, persisted typography, sizing, identity color, and selected-style contracts in `frontend-queue.test.js`.
- [x] Move complete illustrated style 3–6 behavior to `frontend-queue-themes.test.js`.
- [x] Move identity/classic overflow, resize, row sizing, and loop-copy behavior to `frontend-queue-scrolling.test.js`.
- [x] Remove obsolete imports and the legacy-size baseline entry created by this migration.
- [x] Verify the exact test-name multiset, focused suites, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 22 tests now live in configuration, illustrated-theme, and scrolling suites of 479, 525, and 577 lines; focused execution passed 22/22 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 22 queue tests pass and remain present exactly once, every resulting file is below 800 lines, and the old 1,543-line baseline allowance is gone.
