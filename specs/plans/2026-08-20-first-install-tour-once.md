# First-install Tour Once Implementation Plan

> **For agentic workers:** Execute inline in the current worktree. Do not create commits unless the user explicitly requests one.

**Goal:** Show the interactive setup tour automatically only once for a fresh LIRA profile, without reopening it after an overwrite install, a tour-version change, or any later app launch.

**Architecture:** Keep the renderer-owned tour and its existing `localStorage` persistence boundary. Add a version-independent “first-run tour was shown” marker, treat the existing completion marker as a backward-compatible indication that an older installation has already seen the tour, and leave manual reopening available without clearing either automatic-display marker.

**Tech Stack:** Vanilla JavaScript ES modules, Chromium `localStorage`, `node:test`, Electron desktop renderer.

## Global Constraints

- Preserve the Electron desktop flow, no-build ESM model, page URLs, authentication behavior, tour steps, and completion gates.
- Do not add a process, dependency, HTTP route, IPC channel, settings key, or database migration.
- Preserve existing `liraTourCompleted` data so overwrite installations remain recognized.
- Do not touch unrelated queue-overlay changes already present in the worktree.

## Non-goals

- Do not change tour copy, layout, step order, spotlight positioning, or setup validation.
- Do not remove the “重新打开交互式引导” action.
- Do not define uninstall/reinstall cleanup behavior; the existing Electron profile remains the persistence boundary.

## Current Behavior

- `shouldAutoOpen()` compares `localStorage.liraTourCompleted` with `TOUR_VERSION`.
- Increasing `TOUR_VERSION` makes an overwrite installation auto-open the tour again.
- Exiting before the final step writes no marker, so a later launch auto-opens the tour again.
- Manual `reset()` deletes the completion marker, unintentionally re-enabling future automatic display.

## Ownership

- Owner: `public/js/admin/interactive-tour.js`.
- Startup consumer: `public/js/admin/app.js`.
- Manual consumer: `public/js/admin/usage-guide.js`.
- Runtime guides: `docs/interactive-tour-demo.md` and `docs/interactive-tour-visual-guide.md`.
- Focused regression: `test/interactive-tour.test.js`.
- Architecture route: `ROUTE-ADMIN` in `docs/architecture/engineering/ai-workflow.md`.

## Proposed Changes

1. Export a stable `liraTourFirstRunShown` key and a first-run claim function that returns false when either that key or the legacy `liraTourCompleted` key exists, regardless of stored tour version, and otherwise records the claim before returning true.
2. Mark the first-run key when the startup path claims the automatic display, before opening the tour.
3. Make manual `reset()` restart the visible steps without deleting automatic-display history.
4. Add focused regressions for fresh profiles, existing version markers, first-run claiming, and manual reopen persistence.
5. Align the two interactive-tour guides with the version-independent, once-per-profile behavior.

## Milestones

- [x] Add focused tests and verify the current version-based behavior fails them.
- [x] Implement the minimum persistence decision and verify the focused test passes.
- [x] Update runtime guides and run syntax, quick, and final diff checks.

## Verification

- `node --experimental-vm-modules --test test/interactive-tour.test.js`
- `npm run check`
- `npm run verify:quick`
- `npm test`
- `git diff --check`
- `git status --short`

Expected result: all commands pass; the tour opens for empty storage, does not open when either old completion data or the new shown marker exists, and manual reopening does not clear those markers.

## Rollback Or Failure Handling

Inspect the scoped diff and reverse only task-owned hunks with `apply_patch` if focused verification fails. Do not reset, broadly restore, or alter unrelated worktree content.

## Done When

- A fresh Electron profile automatically sees the tour once.
- Closing, completing, or manually reopening the tour does not make later launches auto-open it.
- Existing installations with any `liraTourCompleted` value do not reopen after an overwrite install or `TOUR_VERSION` change.
- Focused and quick checks pass, documentation matches runtime behavior, and unrelated worktree changes remain untouched.

## Verification Results

- `node --experimental-vm-modules --test test/interactive-tour.test.js test/frontend-admin-shell.test.js`: 49 passed.
- `npm run verify:quick`: documentation, syntax, and architecture gates passed.
- `npm test`: 710 passed, 1 skipped, 0 failed.
- `git diff --check`: passed.
- Pre-existing queue-overlay changes remained untouched.
