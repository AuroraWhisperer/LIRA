# Toolbox Sidebar Test Ownership Plan

## Goal

Split the 977-line toolbox sidebar test into static layout, durable preferences/migration, and panel routing/keyboard suites while preserving all 19 tests and realistic DOM behavior.

## Current Behavior / Ownership

- The file mixes CSS/HTML structure, offscreen rendering, grouped navigation, durable and legacy preference migration, panel routing/deep links, keyboard movement, update visibility, and repeated-title rules.
- The focused baseline passes 19/19.
- One existing fake DOM/runtime factory is reused by preference and routing scenarios and creates new nodes, storage, and listeners per call.

## Compatibility Constraints / Non-goals

- Move complete tests without changing DOM ids, ARIA state, storage keys, feature groups, keyboard order, or persistence assertions.
- Extract only the existing runtime factory for genuine reuse; no fake node, storage map, or listener collection is shared.
- Keep static layout contracts separate from runtime routing.
- Do not modify toolbox production code, HTML, CSS, settings, or B/C/D work.

## Milestones

- [x] Keep stylesheet order, rendering containment, sidebar modes, workflow groups, and heading typography in `toolbox-sidebar.test.js`.
- [x] Move durable/default/legacy preference and group-state migration to `toolbox-sidebar-preferences.test.js`.
- [x] Move explicit selection, deep-link reopening, visible-feature keyboard navigation, detail/update panels, toggle state, and title behavior to `toolbox-sidebar-routing.test.js`.
- [x] Share only the existing per-call fake runtime through `helpers/toolbox-runtime.js`.
- [x] Remove the obsolete legacy-size record and verify exact test ownership, 19 focused tests, syntax, architecture, modularity, formatting, and diff checks.

## Results

- The 19 tests now live in static, preference, and routing suites of 164–340 lines plus a 194-line per-call runtime helper; focused execution passed 19/19 and the exact test-name multiset is unchanged.
- The obsolete size allowance was removed. Final Batch A gates passed: full `npm test`, `npm run test:admin` (83/83), `npm run check`, `npm run verify:architecture` (22/22), `npm run verify:modularity` (900 files, 25 reviewed-size files, 0 errors), `npm run verify:docs` (5/5), Prettier, and `git diff --check`.

## Done When

All 19 tests remain present and passing exactly once, fake runtime state remains isolated, every file is below 800 lines, and the old 977-line allowance is removed.
