# Frontend Gifts Test Ownership Plan

## Goal

Reorganize `test/frontend-gifts.test.js` by existing UI behavior boundaries so every test file has one clear subject and remains below the ordinary 800-line ceiling, without changing production code or test assertions.

## Current Behavior / Ownership

- The 2,408-line file registers 37 top-level tests (40 including nested cases) covering the gift workspace summary, history drawer, blind-box admin and mapping state, blind-box OBS rendering, and recent gift cards.
- The focused baseline passes 40/40.
- Batch A owns only the test migration. Batch B/C/D production and lifecycle files are out of scope.

## Compatibility Constraints / Non-goals

- Preserve every existing test body and assertion; move complete test blocks only.
- Keep fixtures local unless they are genuinely reused. The blind-box mapping fixture may be shared only by the two mapping groups.
- Preserve default `node --test` discovery. `test:admin` does not currently list this suite, so do not expand that explicit script.
- Do not modify application JavaScript, CSS, HTML, persisted settings, API contracts, or or unrelated tests.

## Milestones

- [x] Keep workspace and summary contracts in `frontend-gifts.test.js`.
- [x] Move history drawer behavior to `frontend-gift-history.test.js`.
- [x] Move blind-box admin/configuration, mapping state/refresh, and OBS behavior to named suites with one shared mapping fixture.
- [x] Move recent gift card layout, artwork, and catalog-event behavior to `frontend-recent-gifts.test.js`.
- [x] Remove the obsolete legacy-size baseline entry after all resulting files are below 800 lines.
- [x] Verify names and assertion-bearing test blocks were migrated exactly once, then run focused, architecture, syntax, modularity, and diff checks.

## Verification

Run the split gift suites together and confirm 40/40. Compare the original and resulting top-level test names as an exact multiset, confirm every file is below 800 lines, then run `npm run check`, `npm run verify:architecture`, `npm run verify:modularity`, Prettier checks, and `git diff --check`.

## Results

- The 37 top-level tests (40 including nested cases) now live in seven behavior suites of 114–530 lines plus one shared 155-line mapping fixture; focused execution passed 40/40 and the exact top-level name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

Each gift UI behavior has one discoverable test owner, all 37 top-level tests remain present exactly once, all focused tests pass, and the old 2,408-line baseline allowance is removed without touching B/C/D-owned implementation.
