# Admin Games CSS Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the oversized admin games stylesheet by separating shared game-card styling, wheel controls, draw/word controls, and responsive overrides while preserving the existing admin stylesheet entry and exact cascade order.

**Architecture:** Keep shared page/category/link/card rules in `games.css`. Move the contiguous wheel and draw control blocks into `games-wheel.css` and `games-draw.css`, and move the complete trailing media-query block into `games-responsive.css`. Import the four files consecutively in their original source order so concatenated formatted CSS remains equivalent to the current monolith.

**Tech Stack:** Native CSS, ordered `@import` entrypoint, Node.js frontend contract tests, Prettier 3.7.4.

## Global Constraints

- Move existing CSS without changing selectors, declarations, values, or responsive breakpoints.
- Keep `public/css/admin/other-features.css` as the existing public ordered entrypoint.
- Preserve order as shared base → wheel → draw/word → all responsive overrides.
- Update direct-source tests only where selector ownership moves; bundled consumer tests must continue to pass unchanged.
- Do not change admin HTML, JavaScript, visual behavior, dependencies, or commits.
- Preserve unrelated dirty-worktree changes.

---

## Non-goals

- No redesign of game cards, draw controls, word categories, wheel rows, or mobile layout.
- No selector renaming or consolidation of similar wheel/draw patterns.
- No production JavaScript split or markup extraction.
- No separate file per small card or poster variant.

## Current Behavior

- `public/css/admin/other-features/games.css` is 832 lines.
- Shared games/category/card rules occupy lines 1–258.
- Wheel-specific rules occupy lines 259–414; draw and word-library rules occupy lines 415–751.
- Three trailing media-query groups at lines 752–832 cover wheel, draw, and shared layout overrides in the required final cascade position.
- `frontend-games.test.js` directly reads `games.css`; only its word-library test follows a selector that will move.
- The focused frontend games/select group passes 9/9, and the bundled wheel optical-alignment test passes 1/1.

## Ownership

- Shared admin games shell/cards owner: `public/css/admin/other-features/games.css`.
- Wheel editor owner: new `public/css/admin/other-features/games-wheel.css`.
- Draw/word editor owner: new `public/css/admin/other-features/games-draw.css`.
- Responsive owner for this composed surface: new `public/css/admin/other-features/games-responsive.css`.
- Ordered composition owner: `public/css/admin/other-features.css`.
- Direct ownership tests: `test/frontend-games.test.js`; composed CSS consumer test: `test/frontend-admin-shell.test.js`.

## Compatibility Constraints

- Concatenating the four formatted owner files in import order must exactly reproduce the formatted Git baseline `games.css`.
- The final responsive module must load after all three base/component owners.
- Shared selectors such as `.game-admin-card:has(.lira-select.is-open)` remain in `games.css` for select overflow behavior.
- Wheel selectors used by the admin shell bundle remain discoverable through `other-features.css`.
- The word-library test must read `games-draw.css` after ownership moves without changing its assertions.
- None of the source blocks contains asset URLs, so extraction must not introduce any.

## Proposed Changes

- Add a failing ownership/import-order test to `frontend-games.test.js`.
- Create the three focused CSS files from exact contiguous source ranges.
- Remove those ranges from `games.css`, leaving only shared rules.
- Import wheel, draw, and responsive modules immediately after `games.css`.
- Redirect the existing direct word-library CSS test to the draw owner.

## Milestones

### Task 1: Lock the CSS ownership contract

**Files:**

- Modify: `test/frontend-games.test.js`

**Interfaces:**

- Consumes: admin stylesheet entry and four game-style owners.
- Produces: a test enforcing import order and representative selector ownership.

- [x] Record the focused 9/9 frontend baseline and 1/1 bundled wheel baseline.
- [x] Add `admin game styles keep shared, wheel, draw, and responsive ownership`.
- [x] Assert exact import order and representative owner-only selectors.
- [x] Run the named test and confirm it fails because the focused files/imports are absent.

### Task 2: Extract component and responsive modules

**Files:**

- Create: `public/css/admin/other-features/games-wheel.css`
- Create: `public/css/admin/other-features/games-draw.css`
- Create: `public/css/admin/other-features/games-responsive.css`
- Modify: `public/css/admin/other-features/games.css`
- Modify: `public/css/admin/other-features.css`
- Modify: `test/frontend-games.test.js`

**Interfaces:**

- Consumes: current line groups 1–258, 259–414, 415–751, and 752–832.
- Produces: four ordered CSS owners whose concatenation is behavior-equivalent.

- [x] Copy wheel, draw, and responsive blocks into their named files and compare each with its current source before removal.
- [x] Remove only the three copied blocks from `games.css`.
- [x] Add all three imports after `games.css` in original block order.
- [x] Redirect only the word-library CSS test to `games-draw.css`.
- [x] Run the ownership test and the focused frontend games/select tests.

### Task 3: Verify exact cascade preservation

**Files:**

- Modify: this plan with execution results.

**Interfaces:**

- Consumes: formatted Git baseline and the four ordered working files.
- Produces: byte-equivalent concatenation and focused consumer evidence.

- [x] Confirm formatted `games.css + games-wheel.css + games-draw.css + games-responsive.css` exactly equals the formatted Git baseline.
- [x] Confirm the shared file and each extracted module stay below 800 lines and contain no asset URLs.
- [x] Run `node --test test/frontend-games.test.js test/frontend-select-menu-overflow.test.js`.
- [x] Run the bundled wheel test and `npm run test:admin` to verify recursive import discovery.
- [x] Run Prettier 3.7.4 on all touched files and `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Execution Results

- The pre-change frontend games/select baseline passed 9/9, and the bundled wheel alignment test passed 1/1.
- The new ownership test failed on the absent imports, then passed after extraction.
- The four formatted files concatenate exactly to the formatted Git baseline in shared, wheel, draw, responsive order.
- Final sizes are 258 lines for shared games, 157 for wheel, 338 for draw/word, and 82 for responsive styles; no file contains an asset URL.
- The focused frontend games/select group now passes 10/10, and the bundled wheel test still passes.
- `npm run test:admin` passed all 80 tests, confirming the admin CSS bundler discovers the new imports.
- Prettier 3.7.4 passed, and `npm run check` passed syntax validation for 620 JavaScript files.
- The scoped diff and worktree status were reviewed; `git diff --check` returned zero whitespace errors, with only existing Windows line-ending conversion warnings.

## Verification

- Red/green ownership test in `test/frontend-games.test.js`
- Exact four-file concatenation comparison against formatted Git baseline
- `node --test test/frontend-games.test.js test/frontend-select-menu-overflow.test.js`
- `node --test --test-name-pattern="wheel expand control" test/frontend-admin-shell.test.js`
- `npm run test:admin`
- Prettier 3.7.4 `--check`
- `npm run check`
- `git diff --check`

## Rollback Or Failure Handling

If concatenation, imports, or focused consumers fail, stop and compare each split range with the original Git file. Reverse only the three new files, their imports, and task-owned test hunks with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- Shared, wheel, draw/word, and responsive CSS each have one clear owner and load in original order.
- The four files concatenate exactly to the original formatted CSS.
- Direct and bundled admin game tests pass, and no selectors/assertions are discarded.
- Formatting, JavaScript checks, diff checks, and scoped review pass.
