# Interactive Tour Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with the repository verification gates.

**Goal:** Keep the admin onboarding guide visually connected to the selected control while leaving the normal interface visible and interactive.

**Architecture:** Keep the existing vanilla ESM controller and CSS. Replace the fixed-center fallback with a viewport-aware four-side placement calculation, move the spotlight with the target, and raise only the active target above the dimming layer. No dependency or public contract changes.

**Tech Stack:** Vanilla JavaScript ES modules, CSS, `node:test`.

## Global Constraints

- Preserve the existing admin page, step definitions, localStorage completion key, and no-build ESM loading model.
- Keep the normal target control clickable while the tour is open.
- Respect reduced-motion preferences and the existing responsive layout.

## Current Behavior

`interactive-tour.js` measures the target before smooth scrolling, places the card at the target's raw left edge, and falls back to the viewport center when a candidate overflows. `interactive-tour.css` paints an almost opaque white full-screen backdrop with `pointer-events: auto`, so the normal interface is visually washed out and target interaction is blocked.

## Ownership

- Owner: `public/js/admin/interactive-tour.js`.
- Styles: `public/css/admin/other-features/interactive-tour.css`.
- Page inclusion: `public/pages/admin/shell-start.html`.
- Focused tests: new `test/interactive-tour.test.js`; syntax gate `npm run check`.

## Proposed Changes

1. Export and test a placement helper that clamps the card to viewport padding, chooses a viable side, and returns an arrow offset.
2. Scroll to the target before measuring, update spotlight/card on resize and captured scroll, and remove the active-target class on close or step changes.
3. Replace the opaque backdrop with a translucent dim layer plus a visible cutout treatment; allow the active target to receive pointer and keyboard input.
4. Add focused tests for right-edge placement, side fallback, and center-only no-target steps.

## Milestones

- [ ] Add placement regression tests and verify they fail against the current raw-left/center-fallback behavior.
- [ ] Implement controller positioning, target interaction, and scroll/resize refresh.
- [ ] Update tour CSS and run focused tests, syntax checks, and diff review.

## Verification

- `node --test test/interactive-tour.test.js`
- `npm run check`
- `npm run verify:quick`
- `git diff --check` and `git status --short`

## Rollback Or Failure Handling

Inspect the scoped diff and revert only the task-owned files with `git restore -- <path>` if the focused tests or visual behavior regress; do not reset unrelated worktree changes.

## Done When

The target remains visible and clickable, the card stays adjacent to it on desktop and narrow viewports, edge targets choose a safe alternate side without centering, and focused plus quick verification gates pass.
