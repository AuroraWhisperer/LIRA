# Playback Fullscreen CSS Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the oversized fullscreen playback stylesheet by extracting its background, cover, vinyl, and tonearm visuals into one focused module while preserving selectors, asset paths, responsive precedence, and rendered behavior.

**Architecture:** Keep fullscreen shell visibility, close/content layout, track metadata, lyrics, toggles, and playlist row state in `fullscreen.css`. Create `fullscreen-visuals.css` from the two existing visual blocks: the background theme palette and the complete artwork/turntable block. Load the visual owner after `fullscreen.css` and before the existing `responsive.css`; the retained and moved top-level selectors are disjoint, so this ordering preserves the cascade while retaining the public `styles-playback.css` entry.

**Tech Stack:** Native CSS, ordered `@import` entrypoint, Node.js contract tests, Prettier 3.7.4.

## Global Constraints

- Move existing rules without changing selectors, declarations, animation values, or the turntable asset URL.
- Keep `public/css/styles-playback.css` as the public ordered stylesheet entry.
- Keep `responsive.css` after both fullscreen modules.
- Preserve duplicate vinyl rules and their order inside the visual module because the later square-turntable declarations intentionally override the earlier base artwork.
- Do not change HTML, JavaScript, responsive rules, dependencies, or commits.
- Preserve unrelated dirty-worktree changes, including the completed player-control imports and ownership test.

---

## Non-goals

- No visual redesign or consolidation of the 30 background theme declarations.
- No deduplication of the two vinyl rule groups.
- No extraction of lyrics, toggle buttons, queue row state, or close/content layout into additional files.
- No dynamic theme loading or runtime stylesheet switching.

## Current Behavior

- `public/css/playback/fullscreen.css` is 894 lines.
- Background themes occupy the current block beginning at line 24 and ending before the close-button section.
- Artwork, cover, vinyl, tonearm, animation, and reduced-motion rules occupy the current block beginning at line 339 and ending before `.player-fs-panel`.
- The visual block references `/img/playback/player-turntable-chassis.webp` with a root-relative URL.
- `styles-playback.css` imports `fullscreen.css` before `responsive.css`.
- The current playback ownership/layering file passes 2/2 tests.

## Ownership

- Fullscreen shell/content/lyrics owner: `public/css/playback/fullscreen.css`.
- Fullscreen background and turntable visual owner: new `public/css/playback/fullscreen-visuals.css`.
- Ordered composition owner: `public/css/styles-playback.css`.
- Ownership, layering, and asset contract owner: `test/playback-layering.test.js`.

## Compatibility Constraints

- Both moved formatted blocks must compare exactly with the corresponding formatted Git baseline blocks.
- The two visual blocks must retain their relative order and every duplicate vinyl selector.
- Import order must place `fullscreen.css` before `fullscreen-visuals.css`, with `responsive.css` later.
- The retained and moved top-level selector sets must have no cross-file duplicates; intentional duplicates within the visual file stay ordered.
- The turntable image path must remain root-relative and resolve to an existing public asset.
- `.player-fullscreen` must remain in `fullscreen.css` so existing z-index ownership and tests remain valid.

## Proposed Changes

- Add a failing ownership test for the visual import, selector boundary, asset path, and responsive order.
- Create `public/css/playback/fullscreen-visuals.css` from the two complete existing visual blocks.
- Remove only those copied blocks from `fullscreen.css`.
- Import the visual module immediately after `fullscreen.css` in `styles-playback.css`.

## Milestones

### Task 1: Lock the visual ownership contract

**Files:**

- Modify: `test/playback-layering.test.js`

**Interfaces:**

- Consumes: playback entry text, fullscreen CSS owners, and the public turntable asset.
- Produces: a test enforcing import order, selector ownership, and stable asset resolution.

- [x] Record the current 2/2 playback layering baseline.
- [x] Add `fullscreen visuals keep artwork ownership and load before responsive overrides`.
- [x] Assert the entry order, moved/retained selector boundary, exact root-relative asset URL, and asset existence.
- [x] Run the focused test and confirm it fails because the visual module/import is absent.

### Task 2: Extract the complete visual groups

**Files:**

- Create: `public/css/playback/fullscreen-visuals.css`
- Modify: `public/css/playback/fullscreen.css`
- Modify: `public/css/styles-playback.css`

**Interfaces:**

- Consumes: the existing background block and artwork/turntable block.
- Produces: the same visual rules through the unchanged top-level stylesheet URL.

- [x] Copy both visual blocks in original relative order into the new file.
- [x] Confirm both copied blocks match their current source before removal.
- [x] Remove only those two blocks from `fullscreen.css`.
- [x] Add the visual import after `fullscreen.css` and before `responsive.css`.
- [x] Run `node --test test/playback-layering.test.js` and expect 3/3 passes.

### Task 3: Prove cascade and content equivalence

**Files:**

- Modify: this plan with execution results.

**Interfaces:**

- Consumes: formatted Git baseline CSS and split working files.
- Produces: exact moved-block and selector-boundary evidence.

- [x] Compare both formatted moved blocks exactly with the formatted Git baseline.
- [x] Verify no top-level selector is duplicated across `fullscreen.css` and `fullscreen-visuals.css`.
- [x] Confirm `fullscreen.css` is below 800 lines and the visual owner retains its intentional duplicate order.
- [x] Run `node --experimental-vm-modules --test test/playback-layering.test.js test/playback-quality.test.js test/playback-persistence.test.js`.
- [x] Run Prettier 3.7.4 on all touched files and `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Execution Results

- The existing playback layering baseline passed 2/2 before the fullscreen ownership contract was added.
- The new fullscreen ownership test failed on the absent import, then passed after extraction; the ownership file now passes 3/3.
- The formatted background-theme block and complete artwork/turntable block each compare exactly with their formatted Git baseline ranges.
- `fullscreen.css` is now 343 lines and `fullscreen-visuals.css` is 551 lines.
- A top-level selector scan found 41 retained selectors, 55 visual selectors, and zero duplicates across owners; intentional repeated vinyl selectors remain ordered inside the visual file.
- The root-relative turntable asset path is unchanged and resolves to the existing WebP file.
- The focused playback group passed all 20 tests across layering, quality selection, and persistence.
- Prettier 3.7.4 passed, and `npm run check` passed syntax validation for 620 JavaScript files.
- The scoped diff and worktree status were reviewed; `git diff --check` returned zero whitespace errors, with only existing Windows line-ending conversion warnings.

## Verification

- Red/green fullscreen ownership test in `test/playback-layering.test.js`
- Exact background and artwork block comparison against the formatted Git baseline
- Cross-owner top-level selector duplicate scan
- `node --experimental-vm-modules --test test/playback-layering.test.js test/playback-quality.test.js test/playback-persistence.test.js`
- Prettier 3.7.4 `--check`
- `npm run check`
- `git diff --check`

## Rollback Or Failure Handling

If selector ownership, asset resolution, or block equality fails, stop and compare the split files with the two original Git ranges. Reverse only the new visual file, its import, ownership-test addition, and two removed source hunks with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- `fullscreen.css` owns shell/content/lyrics and is below 800 lines.
- `fullscreen-visuals.css` owns both complete visual blocks with exact baseline declarations and internal override order.
- The unchanged playback entry loads both before responsive overrides, and the turntable asset still resolves.
- Focused tests, formatting, JavaScript checks, diff checks, and scoped review pass.
