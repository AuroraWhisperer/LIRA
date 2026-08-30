# Button Color Hierarchy Implementation Plan

**Goal:** Make colored Admin and playback buttons read as intentional full-surface actions or frameless low-emphasis controls, without a second colored outline or an outer segmented frame.

**Architecture:** Keep the existing native CSS cascade and semantic button classes. The shared button rules define the hierarchy, while narrowly scoped selectors remove local colored-outline overrides; selection cards, inputs, dialogs, and OBS overlays remain unchanged because their borders communicate structure or selection.

**Tech Stack:** Electron 43, Vanilla JavaScript ES modules, native CSS, `node:test`, Playwright-based visual QA.

## Global Constraints

- Electron desktop is the visual source of truth; browser rendering is supporting evidence only.
- Preserve all HTTP, WebSocket, IPC, page, storage, settings, and authentication contracts.
- Do not add dependencies, a build step, or JavaScript behavior.
- Preserve existing user changes in the dirty worktree and limit edits to button presentation plus focused tests.
- Keep inputs, selection cards, choice tiles, confirmation dialogs, and OBS overlay controls out of scope.

---

## Goal

Remove the repeated "colored control inside another colored frame" treatment. Primary actions use a solid fill across the full hit area, secondary actions stay neutral, and destructive or low-emphasis colored actions use a frameless soft-fill/text treatment.

## Non-goals

- No copy, icon, navigation, or interaction changes.
- No redesign of cards, form controls, theme/style choice tiles, modal confirmations, or OBS overlays.
- No change to persisted state or page composition.

## Current Behavior

The Electron-styled Admin page renders the main navigation as a bordered segmented container with a second solid active tab inside it. Several low-emphasis actions also combine accent-colored text, a tinted background, and a matching colored border. Existing focused tests cover Admin composition and individual compact button sizing, but not the color hierarchy.

## Ownership

- Owner: `public/css/styles-base.css`, `public/css/admin/`, and `public/css/playback/` under `ROUTE-ADMIN`.
- Contracts: `docs/architecture/frontend/pages.md` and `docs/architecture/frontend/app.md`.
- Consumers: Admin fragments under `public/pages/admin/` loaded in the Electron desktop renderer.
- Focused tests: `test/frontend-admin-shell.test.js`.

## Compatibility Constraints

Button element types, IDs, classes, labels, focus behavior, disabled behavior, click handlers, and page URLs must remain unchanged. Existing solid destructive confirmation buttons remain solid so the final irreversible step keeps its warning hierarchy.

## Proposed Changes

- `public/css/styles-base.css`: make shared primary buttons borderless solid fills and shared danger buttons frameless text/soft-hover actions.
- `public/css/admin/gifts/main-page-tabs.css` and `public/css/overlays/desktop.css`: remove the outer segmented frame around the top-level navigation.
- `public/css/admin/layout.css`, `public/css/admin/workspace/song.css`, `public/css/admin/desktop-lyric-preview.css`, `public/css/admin/responsive.css`, and `public/css/admin/other-features/shell.css`: remove local accent/danger outlines while preserving hierarchy through fill, text, or an existing active rail.
- `public/css/admin/other-features/start-animation.css`, `public/css/admin/other-features/usage-guide.css`, and `public/css/playback/player.css`: convert remaining accent-outline action controls to solid or frameless alternatives.
- `test/frontend-admin-shell.test.js`: add regression assertions for the shared hierarchy and key local exceptions.

## Milestones

### Task 1: Lock the shared button hierarchy

**Files:**

- Modify: `test/frontend-admin-shell.test.js`
- Modify: `public/css/styles-base.css`

**Interfaces:**

- Consumes: existing `button.primary`, `button.secondary`, `button.danger`, and `button.danger-filled` classes.
- Produces: solid primary actions, neutral secondary actions, and frameless danger actions without changing markup.

- [x] Add a focused test that extracts the three shared rules and asserts `primary` has `background: var(--primary)` with a transparent border, `secondary` keeps the neutral border, and `danger` has a transparent border/background.
- [x] Run `node --test test/frontend-admin-shell.test.js` and confirm the new assertion fails against the current colored-outline rule.
- [x] Update only the shared button declarations and add a soft danger hover state using the existing danger and surface tokens.
- [x] Re-run `node --test test/frontend-admin-shell.test.js` and confirm the shared hierarchy assertion passes.

### Task 2: Remove nested and local colored frames

**Files:**

- Modify: `public/css/admin/gifts/main-page-tabs.css`
- Modify: `public/css/overlays/desktop.css`
- Modify: `public/css/admin/layout.css`
- Modify: `public/css/admin/workspace/song.css`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `public/css/admin/responsive.css`
- Modify: `public/css/admin/other-features/shell.css`
- Modify: `public/css/admin/other-features/start-animation.css`
- Modify: `public/css/admin/other-features/usage-guide.css`
- Modify: `public/css/playback/player.css`
- Modify: `test/frontend-admin-shell.test.js`

**Interfaces:**

- Consumes: the shared hierarchy from Task 1 and existing component-specific selectors.
- Produces: a frameless top navigation; full-fill primary CTA; frameless soft-fill/text low-emphasis actions; unchanged selection-card boundaries.

- [x] Add focused CSS assertions that the top navigation has no border or container fill, active toolbox navigation relies on its existing left rail instead of an accent border, and the listed local action controls do not reintroduce colored outlines.
- [x] Run `node --test test/frontend-admin-shell.test.js` and confirm the local assertions fail against the current rules.
- [x] Apply the minimum selector-level CSS changes, keeping dimensions, radii, labels, disabled states, and focus-visible outlines intact.
- [x] Re-run `node --test test/frontend-admin-shell.test.js` and confirm all focused assertions pass.

### Task 3: Desktop visual and interaction verification

**Files:**

- No production files created.
- Temporary screenshots may be written under ignored `tmp/`.

**Interfaces:**

- Consumes: the completed CSS cascade.
- Produces: visual evidence at the default 1280x720 Electron viewport and a smaller supported desktop window.

- [x] Launch the local runtime with temporary data and capture the Admin UI with `?desktop=1` at 1280x720.
- [x] Inspect point-song, playback, gifts, toolbox, usage guide, start animation, desktop lyric, and representative hover/disabled states.
- [x] Verify primary fill covers the hit area, no colored action is surrounded by a second colored outline, neutral controls remain distinguishable, and focus-visible styling is still present.
- [x] Repeat the key view at the 1024x680 minimum Electron size and confirm labels do not wrap or clip.

## Verification

- Focused: `node --test test/frontend-admin-shell.test.js`
- Syntax: `npm.cmd run check`
- Quick gate: `npm.cmd run verify:quick`
- Diff hygiene: `git diff --check`
- Scope review: `git diff -- public/css/styles-base.css public/css/admin public/css/playback/player.css test/frontend-admin-shell.test.js specs/plans/2026-08-23-button-color-hierarchy.md`
- Worktree review: `git status --short`

Expected result: all commands exit successfully; screenshots show a clear solid/neutral/frameless hierarchy with no nested colored frame; unrelated user changes remain intact.

## Rollback Or Failure Handling

If a local selector harms hierarchy or contrast, inspect only the task-owned hunks and revise that selector. Do not reset the worktree or restore whole files because several target files already contain unrelated user changes.

## Done When

- Top-level navigation no longer has an outer segmented frame around its solid active action.
- Shared and listed local colored actions follow the solid-fill or frameless rule.
- Selection cards, inputs, and final destructive confirmations keep their necessary boundaries.
- Focused tests, syntax checks, quick gates, visual checks, and diff checks pass.
- The plan records final verification and is moved to `specs/plans/archive/`.

## Final Verification

- `node --test test/frontend-admin-shell.test.js`: passed, 42/42 tests.
- `npm.cmd run check`: passed, 437 JavaScript files.
- `npm.cmd run verify:quick`: passed documentation, syntax, and architecture gates.
- Electron QA: passed at 1280x720 and 1024x680; real mouse navigation worked, the minimum viewport had no horizontal overflow, and audited colored borders were transparent or absent.
- Contrast: desktop red primary text is 4.83:1 against white; the song-queue teal primary gradient was darkened to a 4.80-5.50:1 range.
- `git diff --check`: passed (line-ending conversion warnings only).
- `npm.cmd test`: 2 unrelated existing dirty-worktree assertions failed in `test/frontend-gifts.test.js` and `test/opening-overlay.test.js`; both failures correspond to separate contextual-help markup changes outside this task.
