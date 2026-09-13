# Danmaku Overlay Test Ownership Plan

## Goal

Split the 1,057-line danmaku overlay test into fixed-feed integration, shared renderer/pruning, and fullscreen-random lifecycle suites without changing its eight behavior tests.

## Current Behavior / Ownership

- The file combines a large fixed-overlay contract, ranked/shared emote rendering, viewport pruning, fullscreen positioning/expiry, preview retention, and live-status labeling.
- The focused baseline passes 8/8.
- Each large fake DOM is already scoped to its individual test and should stay there.

## Compatibility Constraints / Non-goals

- Move complete tests only; do not centralize mutable fake DOM state.
- Preserve sanitization, emote image handling, viewport limits, timer expiry, preview behavior, arrival timestamps, and connection-label assertions.
- Do not modify the Batch B renderer/feed implementation, CSS, overlay HTML, server transport, or C/D work.

## Milestones

- [x] Keep the fixed overlay integration and live-status label in `danmaku-overlay.test.js`.
- [x] Move ranked viewport, shared emote renderer, and fixed-feed pruning to `danmaku-overlay-renderer.test.js`.
- [x] Move fullscreen random bounds, timers, preview, and missing-timestamp behavior to `danmaku-overlay-fullscreen.test.js`.
- [x] Remove the obsolete legacy-size record.
- [x] Verify exact test ownership, focused suites, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The eight tests now live in fixed-feed, renderer/pruning, and fullscreen suites of 480, 255, and 336 lines; focused execution passed 8/8 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All eight tests remain present and passing exactly once, each file is below 800 lines with behavior-local fixtures, and the old 1,057-line allowance is removed.
