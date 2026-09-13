# Desktop Lyric CSS Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1361-line admin desktop-lyric stylesheet so the admin page owns settings and preview controls while both the admin preview and OBS lyric source consume one neutral rendering stylesheet, preserving every existing selector, declaration, responsive behavior, and stable admin CSS URL.

**Architecture:** Keep `public/css/admin/desktop-lyric-preview.css` as the ordered compatibility entry. Extract settings-shell and settings-control groups into focused admin owners, move the card/stage/timeline/word rendering rules into `public/css/lyrics/desktop-lyric.css`, and keep admin-only preview chrome, workspace scaling, container queries, and narrow-layout overrides in an admin preview owner. The overlay will link only the neutral renderer plus its existing playback overrides.

**Tech Stack:** Native CSS with ordered `@import`, static HTML links, Node.js CSS-bundle contract tests, Prettier 3.7.4.

## Global Constraints

- Preserve the existing `/css/admin/desktop-lyric-preview.css` admin entry URL and its placement in `styles-admin.css`.
- Preserve all declarations from the captured clean stylesheet baseline (SHA-256 `E251ECFB2D88C40EB5A290A23DB3B5F69F03574C6E49278D16DB32CE1A673301`).
- Preserve cascade intent: settings bases first, shared renderer bases next, admin-scoped preview overrides and responsive rules last.
- Keep `.desktop-lyric-settings*`, source selectors, form controls, preview header/tools/background buttons, `.desktop-lyric-workspace` scaling, and `admin-lyric-preview` container rules out of the overlay stylesheet.
- Keep card, stage, viewport, timeline, row, word, translation, countdown, progress, low-power, and reduced-motion rules in the neutral renderer owner.
- Preserve overlay page structure, `/lyrics`, JavaScript behavior, CSS variables, media queries, and existing playback overrides.
- Do not introduce dynamic CSS loading, a build step, duplicated declarations, selector renames, or visual redesign.
- Preserve unrelated dirty-worktree changes and do not create commits.

---

## Non-goals

- No JavaScript or HTML fragment ownership changes in this milestone.
- No cleanup of existing selector values, empty rules, global `.sr-only`, or adjacent playback CSS.
- No attempt to make the neutral renderer independent of shared design tokens already supplied by `styles-base.css`.
- No viewport expansion beyond the existing focused contracts.

## Current Behavior

- `public/css/admin/desktop-lyric-preview.css` is 1361 lines and combines admin workspace/settings controls with the reusable lyric card and timeline renderer.
- The admin bundle imports this file, and `public/pages/overlays/lyric-window.html` also links it directly before `styles-playback.css`.
- Lines 1-727 own settings and controls; shared renderer rules are interleaved with admin-only header/workspace regions from line 728 onward; the final container/media rules are admin-preview-specific except reduced-motion rendering behavior.
- Seven assertions in `test/desktop-lyrics.test.js` plus three other frontend tests read the physical file directly and therefore need recursive bundle reads after it becomes an entry.
- The five affected test files currently pass 96/96.

## Ownership

- Stable ordered admin entry: `public/css/admin/desktop-lyric-preview.css`.
- Settings shell, source picker, group shell: `public/css/admin/desktop-lyric/settings.css`.
- Karaoke, input, range, alignment, and reset controls: `public/css/admin/desktop-lyric/controls.css`.
- Admin preview header/background controls, workspace sizing, container query, and responsive layout: `public/css/admin/desktop-lyric/preview.css`.
- Shared lyric card/stage/viewport/timeline/row/word rendering: `public/css/lyrics/desktop-lyric.css`.
- Overlay-specific fixed/full-height behavior remains in `public/css/playback/desktop-lyric.css`.
- Ownership and behavior contracts: new `test/desktop-lyric-style-ownership.test.js` and existing focused frontend tests.

## Compatibility Constraints

- The admin composed bundle must still expose every selector/declaration expected by existing tests.
- The neutral stylesheet must not contain admin settings, workspace, preview toolbar, or container-query selectors.
- The overlay must link `/css/lyrics/desktop-lyric.css` and must not link the admin entry.
- `styles-playback.css` must remain after the neutral renderer link so `.lyric-window-*` fixed/full-height overrides retain precedence.
- Every new owner must stay below 800 lines without requiring a modularity exception.
- Test consumers must follow `@import` recursively rather than weakening existing assertions.

## Proposed Changes

- Add a failing ownership contract for the four admin imports, neutral selector boundary, overlay link, line limits, and representative composed rules.
- Replace the oversized admin file with four ordered imports.
- Mechanically extract every original rule into its natural owner without declaration edits.
- Change the overlay stylesheet link and advance its cache version.
- Convert direct test reads of the stable entry to the repository's existing `readCssBundle` helper.

## Milestones

### Task 1: Lock stylesheet ownership

**Files:**

- Create: `test/desktop-lyric-style-ownership.test.js`

- [x] Assert the exact ordered imports in the stable admin entry.
- [x] Assert representative settings, controls, shared renderer, and admin preview selectors in their owners.
- [x] Assert the neutral owner excludes admin selectors and the overlay excludes the admin stylesheet.
- [x] Assert all owners remain below 800 lines and run the test red before implementation.

### Task 2: Extract natural CSS owners

**Files:**

- Modify: `public/css/admin/desktop-lyric-preview.css`
- Create: `public/css/admin/desktop-lyric/settings.css`
- Create: `public/css/admin/desktop-lyric/controls.css`
- Create: `public/css/admin/desktop-lyric/preview.css`
- Create: `public/css/lyrics/desktop-lyric.css`

- [x] Extract original lines 1-354 and 355-727 into the two settings owners.
- [x] Gather the original common card, stage/viewport/timeline, row/word, and reduced-motion regions into the neutral owner.
- [x] Gather header/tools, workspace scaling, container query, and responsive regions into the admin preview owner.
- [x] Keep the stable entry as ordered imports with admin-scoped overrides last.
- [x] Verify every original nonblank rule line appears in exactly one owner and owner line counts are below 800.

### Task 3: Rewire consumers and tests

**Files:**

- Modify: `public/pages/overlays/lyric-window.html`
- Modify: `test/desktop-lyrics.test.js`
- Modify: `test/desktop-lyric-surface-ownership.test.js`
- Modify: `test/frontend-admin-shell.test.js`
- Modify: `test/frontend-select-menu-overflow.test.js`
- Modify: `test/frontend-typography.test.js`

- [x] Point the overlay at the neutral stylesheet and retain playback CSS after it.
- [x] Use `readCssBundle` for every test that consumes the stable admin entry.
- [x] Preserve all existing selector/declaration assertions unchanged.

### Task 4: Verify CSS and runtime contracts

**Files:**

- Modify: this plan with execution results.

- [x] Run the ownership test and five affected test files.
- [x] Run `npm run test:admin`, `npm run check`, and `npm run verify:modularity`.
- [x] Run Prettier 3.7.4 on all complete changed CSS/HTML/tests/plan.
- [x] Run `git diff --check` and inspect scoped status plus the final split.

## Verification

- Red/green `test/desktop-lyric-style-ownership.test.js`
- `node --experimental-vm-modules --test test/desktop-lyrics.test.js test/desktop-lyric-surface-ownership.test.js test/desktop-lyric-style-ownership.test.js test/frontend-admin-shell.test.js test/frontend-select-menu-overflow.test.js test/frontend-typography.test.js`
- `npm run test:admin`
- `npm run check`
- `npm run verify:modularity`
- Prettier 3.7.4 `--check`
- `git diff --check`

## Execution Results

- Captured the clean 1361-line source at SHA-256 `E251ECFB2D88C40EB5A290A23DB3B5F69F03574C6E49278D16DB32CE1A673301` and recorded a 96/96 affected-test baseline.
- Observed the new ownership test fail because the old stylesheet had no imports, then pass after the split.
- The stable entry is 4 lines; settings, controls, neutral renderer, and admin preview owners are 353, 372, 472, and 161 lines respectively.
- Segment-by-segment comparison with the tracked baseline confirms all 1182 nonblank source lines remain exactly once. Admin-scoped overrides remain after the neutral renderer in the composed bundle.
- The overlay now loads `/css/lyrics/desktop-lyric.css?v=20260913-01` before the existing playback stylesheet and no longer loads admin control CSS.
- All direct consumers of the stable admin entry now resolve its imports with `readCssBundle`; existing selector/declaration assertions were retained.
- The six focused files pass 97/97, `npm run test:admin` passes 82/82, and the architecture suite passes 22/22.
- `npm run check` passes for 635 JavaScript files; `npm run verify:modularity` reports 825 files, 49 reviewed-size files, and zero errors.
- Prettier 3.7.4, `git diff --check`, scoped status, and final owner review pass. No full `npm test` run was required for this isolated CSS ownership batch.

## Rollback Or Failure Handling

If a declaration is lost, an overlay loads admin selectors, or focused visual contracts change, stop and compare the four extracted owners with the captured baseline regions. Reverse only this task's entry, owners, link, and test-reader patches with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The admin entry is a small ordered import manifest and every natural owner is below 800 lines.
- Admin controls and preview chrome remain admin-owned; the overlay loads only neutral rendering plus playback overrides.
- All original declarations and focused visual contracts remain present with the required override order.
- Focused, admin, JavaScript, modularity, formatting, and diff checks pass with a reviewed scoped diff.
