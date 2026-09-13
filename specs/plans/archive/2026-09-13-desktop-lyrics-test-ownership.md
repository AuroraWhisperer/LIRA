# Desktop Lyrics Test Ownership Plan

## Goal

Finish Batch A ownership for the remaining 1,632-line desktop lyric test by grouping normalization, admin settings, publication, and renderer/timeline behavior without changing product code or assertions.

## Current Behavior / Ownership

- Static surface and stylesheet ownership already moved to dedicated suites.
- `desktop-lyrics.test.js` still registers 33 tests covering payload normalization, settings markup and behavior, local fonts, playback publication, shared clocks, and renderer timelines.
- The focused baseline passes 35/35 together with the two existing ownership suites.

## Compatibility Constraints / Non-goals

- Preserve every existing test block and cross-layer assertion exactly once.
- Reuse the established `helpers/frontend-modules` loader instead of retaining an identical private ESM loader.
- Keep settings markup and settings runtime/preview behavior separate because together they exceed the ordinary limit.
- Do not modify desktop lyric production modules, CSS, HTML, API behavior, or B/C/D work.

## Milestones

- [x] Keep normalized browser-source state/timeline contracts in `desktop-lyrics.test.js`.
- [x] Move static settings/default contracts to `desktop-lyric-settings.test.js`.
- [x] Move font permission, preview, and autosave behavior to `desktop-lyric-settings-runtime.test.js`.
- [x] Move authenticated publication, ordering, scheduler, and shared-clock behavior to `desktop-lyric-publication.test.js`.
- [x] Move active-line, spring, karaoke, discrete-word, and visible-line renderer behavior to `desktop-lyric-renderer.test.js`.
- [x] Remove the duplicated local module loader and obsolete legacy-size record.
- [x] Verify the exact test-name multiset, focused suites, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 33 migrated tests now live in five suites of 152–534 lines and reuse the established frontend-module helper; together with the two existing ownership tests, focused execution passed 35/35 and the 33-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 33 migrated tests plus the two existing ownership tests pass, every resulting file is below 800 lines, and the old 1,718-line allowance is removed.
