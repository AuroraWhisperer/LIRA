# Frontend Admin Shell Test Ownership Plan

## Goal

Split the 2,010-line admin shell test by its existing UI behavior boundaries while preserving all 52 tests and keeping the Shell/navigation contract in the original file.

## Current Behavior / Ownership

- `frontend-admin-shell.test.js` mixes Shell/navigation, toolbox/help, hardware/onboarding, player/workspace layout, application lifecycle, and theme behavior.
- The focused baseline passes 52/52.
- `npm run test:admin` explicitly lists the original file, so every extracted admin suite must be added to that discovery entry.

## Compatibility Constraints / Non-goals

- Move complete test blocks and the usage-guide fixture without changing assertions or production files.
- Keep Shell/navigation tests in the original file; group extracted tests by real UI consumer rather than by size.
- Do not modify B/C/D-owned implementation or broaden `test:admin` beyond the extracted suites.
- Preserve the existing runtime, DOM, CSS, and settings expectations exactly.

## Milestones

- [x] Keep Shell/navigation and shared top-level surface contracts in `frontend-admin-shell.test.js`.
- [x] Move hardware, onboarding, tour controls, toolbox routing, updates, and browser-source navigation to `frontend-admin-toolbox.test.js`.
- [x] Move the usage-guide fixture and behavior to `frontend-usage-guide.test.js`.
- [x] Move player/workspace/queue layout behavior to `frontend-admin-layout.test.js`.
- [x] Move state initialization and theme compatibility behavior to `frontend-admin-runtime.test.js`.
- [x] Add all extracted files to `test:admin` and remove the obsolete legacy-size baseline record.
- [x] Verify the exact test-name multiset, focused suites, `test:admin`, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 52 tests now live in five behavior suites of 295–558 lines; focused execution passed 52/52, the exact test-name multiset is unchanged, and `test:admin` discovers every extracted suite.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 52 tests remain discoverable exactly once, each resulting file stays below 800 lines, `test:admin` includes every extracted suite, and the old 2,010-line allowance is removed.
