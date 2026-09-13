# Playback Player CSS Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the oversized playback player stylesheet by moving the existing quality selector and volume control into focused CSS modules while preserving the playback entry URL, cascade behavior, selectors, and declarations.

**Architecture:** Keep dock layout, cover/song/progress/playback controls, the shared divider, queue state, and external-source composition state in `player.css`. Create `quality-control.css` and `volume-control.css` from the two existing contiguous component blocks, then load them immediately after the player base and before drawer and responsive styles through `styles-playback.css`.

**Tech Stack:** Native CSS, ordered `@import` entrypoint, Node.js contract tests, Prettier 3.7.4.

## Global Constraints

- Move existing CSS declarations without redesigning, renaming selectors, or changing values.
- Keep `public/css/styles-playback.css` as the public ordered stylesheet entry.
- Keep `responsive.css` after the new modules so its volume overrides retain precedence.
- Preserve the shared divider and player-wide external-source state in `player.css`.
- Do not change HTML or JavaScript behavior, add dependencies, or create commits.
- Preserve unrelated dirty-worktree changes.

---

## Non-goals

- No visual redesign of the quality popup, volume popup, slider, or playback dock.
- No extraction of individual buttons, cover art, progress, queue state, or external-source state.
- No changes to `fullscreen.css`, `responsive.css`, markup, or playback controllers.
- No new runtime stylesheet loading mechanism.

## Current Behavior

- `public/css/playback/player.css` is 830 lines.
- The quality component is a contiguous block at current lines 517–664.
- The volume component is a contiguous block at current lines 674–812.
- The shared divider lies between them; queue and external-source state follows them and remains composition-owned.
- `styles-playback.css` currently imports `player.css` immediately before `drawer.css`; `responsive.css` is later in the same fixed entry.
- `test/playback-layering.test.js` passes its current single layering test.

## Ownership

- Playback dock/base owner: `public/css/playback/player.css`.
- Quality popup owner: new `public/css/playback/quality-control.css`.
- Volume popup and slider owner: new `public/css/playback/volume-control.css`.
- Ordered CSS composition owner: `public/css/styles-playback.css`.
- Ownership/cascade contract owner: `test/playback-layering.test.js`.

## Compatibility Constraints

- Every moved selector and declaration must remain byte-equivalent after formatting.
- Import order must be `player.css` → `quality-control.css` → `volume-control.css` → `drawer.css`, with `responsive.css` later.
- The existing `responsive.css` volume selectors must continue to override base volume declarations.
- `player.css` must retain `.playback-controls-divider`, `#playbackQueueBtn.active`, and the `.is-external-source` rules.
- The new files contain no `url(...)` references, so asset paths cannot change.

## Proposed Changes

- Add a focused ownership test that initially fails while the new imports/files are absent.
- Create `public/css/playback/quality-control.css` from the exact quality block.
- Create `public/css/playback/volume-control.css` from the exact volume block.
- Remove only those two blocks from `player.css`.
- Add both imports after `player.css` in `styles-playback.css`.

## Milestones

### Task 1: Lock the entry and ownership contract

**Files:**

- Modify: `test/playback-layering.test.js`

**Interfaces:**

- Consumes: CSS text from the playback entry and component files.
- Produces: a test enforcing import order, component selector ownership, and preservation of shared player state.

- [x] Run `node --test test/playback-layering.test.js` and record the existing 1/1 baseline pass.
- [x] Add a test named `playback control styles keep focused ownership and responsive cascade order`.
- [x] Assert the entry import order and that quality/volume selectors live only in their new owners while shared player selectors remain in `player.css`.
- [x] Run the focused test and confirm it fails because the new modules/imports do not exist yet.

### Task 2: Extract the two control modules

**Files:**

- Create: `public/css/playback/quality-control.css`
- Create: `public/css/playback/volume-control.css`
- Modify: `public/css/playback/player.css`
- Modify: `public/css/styles-playback.css`

**Interfaces:**

- Consumes: existing quality lines 517–664 and volume lines 674–812.
- Produces: the same selectors/declarations through the same public stylesheet URL in a fixed import order.

- [x] Copy the quality and volume blocks into their named files.
- [x] Confirm each new module contains its complete original block before removing the source blocks.
- [x] Remove only the copied blocks from `player.css`; leave the divider and trailing player states in place.
- [x] Insert both imports between `player.css` and `drawer.css`.
- [x] Run the ownership test and expect 2/2 passes.

### Task 3: Prove behavior-preserving movement

**Files:**

- Modify: this plan with execution results.

**Interfaces:**

- Consumes: the original Git stylesheet and the split working files.
- Produces: evidence that CSS content and ordering constraints are preserved.

- [x] Compare each new formatted component block exactly with the corresponding block from the formatted Git baseline.
- [x] Confirm `player.css` is below 800 lines and both new modules follow natural component boundaries.
- [x] Run `node --experimental-vm-modules --test test/playback-layering.test.js test/playback-quality.test.js test/playback-persistence.test.js`.
- [x] Run Prettier 3.7.4 on all touched CSS, test, and plan files.
- [x] Run `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Execution Results

- The existing playback layering baseline passed 1/1 before the ownership contract was added.
- The new ownership test failed on the absent imports, then passed after extraction; the focused file now passes 2/2.
- `quality-control.css` exactly matches original lines 517–664 after formatting, and `volume-control.css` exactly matches original lines 674–812 after formatting.
- `player.css` is now 542 lines; the focused modules are 148 and 140 lines. Neither new file contains asset URLs.
- Import order is `player.css`, quality, volume, drawer, then later responsive overrides. The shared divider, queue state, and external-source state remain in `player.css`.
- The focused playback group passed all 19 tests across layering, quality selection, and persistence.
- Prettier 3.7.4 passed, and `npm run check` passed syntax validation for 620 JavaScript files.
- The scoped diff and worktree status were reviewed; `git diff --check` returned zero whitespace errors, with only existing Windows line-ending conversion warnings.

## Verification

- Red/green ownership test in `test/playback-layering.test.js`
- Exact quality and volume block comparison against the formatted Git baseline
- `node --experimental-vm-modules --test test/playback-layering.test.js test/playback-quality.test.js test/playback-persistence.test.js`
- Prettier 3.7.4 `--check` for all touched files
- `npm run check`
- `git diff --check`

## Rollback Or Failure Handling

If cascade order, selector ownership, or declaration equality fails, stop and compare the three split files with the original Git block boundaries. Reverse only the two new files, two imports, ownership-test addition, and removed source hunks with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The public playback stylesheet imports the two focused modules in the required order.
- The ownership test passes and moved CSS blocks compare exactly with baseline.
- `player.css` is below 800 lines without arbitrary line cutting or changed visual declarations.
- Focused playback tests, formatting, JavaScript checks, diff checks, and scoped review pass.
