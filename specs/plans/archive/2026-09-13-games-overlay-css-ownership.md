# Games Overlay CSS Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized games overlay stylesheet with a fixed ordered compatibility entry that gives shared layout, number-bomb/Gomoku boards, drawing controls, empty/result surfaces, shared adaptive policy, and the late live drawing layout explicit owners without changing rendering.

**Architecture:** Keep `public/css/overlays/games.css` as the only URL loaded by `games.html`. It will statically import six files under `public/css/overlays/games/`: shared, board, drawing, result, responsive, and drawing-live. The final drawing-live owner intentionally remains after the first responsive layer because it contains the current late overrides plus drawing danmaku styles. Existing composed assertions will resolve the fixed entry recursively, and a focused ownership contract will read the entry and owners directly.

**Tech Stack:** Native CSS, ordered nested `@import`, Node.js contract tests, Prettier 3.7.4.

## Global Constraints

- Preserve every existing selector, declaration, value, animation, breakpoint, and rule body.
- Keep `/css/overlays/games.css?v=20260824-04` as the single HTML stylesheet URL; do not add runtime stylesheet loading.
- Preserve exact source order: shared → board → drawing → result → responsive → drawing-live.
- Keep number-bomb and Gomoku selectors together as the board interaction owner.
- Keep drawing danmaku, live viewport layout, and their final responsive overrides in drawing ownership.
- Preserve the late drawing overrides after the earlier drawing foundation and first responsive policy.
- Update tests only to follow the new ownership/composition boundary; do not weaken existing assertions.
- Do not change HTML, JavaScript, game contracts, assets, dependencies, or commits.
- Preserve unrelated dirty-worktree changes in the other game tests.

---

## Non-goals

- No visual redesign, selector cleanup, token extraction, or animation changes.
- No changes to number-bomb, Gomoku, draw/guess, result actions, or danmaku runtime behavior.
- No fragmentation of individual drawing tools, colors, widths, or result controls.
- No edits to the separately owned admin games styles.

## Current Behavior

- `public/css/overlays/games.css` contains 1,504 physical lines and has no current working-tree diff.
- Shared page/stage/header/view rules occupy the opening block.
- Number-bomb and Gomoku board controls form one contiguous block.
- The initial draw/guess layout and tools form the next contiguous block.
- Empty/result surfaces and result animations precede a shared narrow-screen/reduced-motion block.
- A final contiguous drawing-live block overrides the initial layout, owns drawing danmaku presentation, and ends with its own narrow-screen rules.
- `test/games-overlay.test.js` currently passes 2/2.

## Ownership

- Stable compatibility entry: `public/css/overlays/games.css`.
- Shared stage/header/view foundation: new `public/css/overlays/games/shared.css`.
- Number-bomb and Gomoku boards: new `public/css/overlays/games/board.css`.
- Initial draw/guess canvas, toolbar, clue, score, and correct-feed foundation: new `public/css/overlays/games/drawing.css`.
- Empty state, result layer, actions, and result animations: new `public/css/overlays/games/result.css`.
- First cross-surface narrow-screen and reduced-motion policy: new `public/css/overlays/games/responsive.css`.
- Late live drawing layout, drawing danmaku, and final drawing responsive rules: new `public/css/overlays/games/drawing-live.css`.
- Composed and ownership contracts: `test/games-overlay.test.js`.

## Compatibility Constraints

- Entry import order must exactly preserve the current monolith sequence.
- Each formatted owner must compare exactly with its routed formatted Git-baseline segment.
- The HTML must continue loading only the versioned `games.css` URL.
- The composed bundle must include board, drawing, result, and drawing-danmaku contracts with no unresolved imports.
- The late `body[data-game='draw-guess']` overrides must remain after initial drawing and responsive rules.
- All resulting files must stay below 800 lines.

## Proposed Changes

- Add a red/green ownership test and use the existing CSS bundle helper for composed assertions.
- Route unchanged contiguous source blocks into six focused files.
- Replace `games.css` with six ordered static imports.
- Keep HTML, runtime code, and all existing assertions unchanged.

## Milestones

### Task 1: Lock composition and current behavior

**Files:**

- Modify: `test/games-overlay.test.js`

**Interfaces:**

- Consumes: `readCssBundle(...relativeSegments)` and direct owner files.
- Produces: a test enforcing entry order and representative selector ownership.

- [x] Run `test/games-overlay.test.js` and record a 2/2 baseline.
- [x] Import `readCssBundle` and add `games overlay styles keep shared, board, drawing, result, responsive, and late drawing ownership`.
- [x] Assert the six-entry order and representative selector ownership.
- [x] Run the named test and confirm it fails because the focused entry/files are absent.

### Task 2: Create focused owners and compatibility entry

**Files:**

- Modify: `public/css/overlays/games.css`
- Create: `public/css/overlays/games/shared.css`
- Create: `public/css/overlays/games/board.css`
- Create: `public/css/overlays/games/drawing.css`
- Create: `public/css/overlays/games/result.css`
- Create: `public/css/overlays/games/responsive.css`
- Create: `public/css/overlays/games/drawing-live.css`

**Interfaces:**

- Consumes: the current formatted monolith and its contiguous semantic ranges.
- Produces: the same CSS through the stable versioned entry URL.

- [x] Copy each contiguous source range into its semantic owner without editing rule bodies.
- [x] Compare every copied segment with the current source before replacing the monolith.
- [x] Replace `games.css` with only the six ordered imports.
- [x] Run the ownership test and confirm it passes.

### Task 3: Update the composed test consumer

**Files:**

- Modify: `test/games-overlay.test.js`

**Interfaces:**

- Consumes: the stable compatibility entry.
- Produces: unchanged cross-domain assertions against recursively composed CSS.

- [x] Replace the direct monolith read with `readCssBundle`.
- [x] Keep every existing CSS and runtime assertion unchanged.
- [x] Run the complete games-overlay test file and expect 3/3 after adding the ownership test.

### Task 4: Verify routing and cascade safety

**Files:**

- Modify: this plan with execution results.

**Interfaces:**

- Consumes: formatted Git baseline plus focused owner files.
- Produces: exact routing and focused regression evidence.

- [x] Compare each formatted routed segment with its formatted Git baseline source.
- [x] Confirm all files are below 800 lines and recursive composition has no unresolved imports.
- [x] Confirm `games.html` still contains exactly one versioned stylesheet link and no loader changes.
- [x] Run the games-overlay test, Prettier 3.7.4, and `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Verification

- Red/green ownership test in `test/games-overlay.test.js`
- Exact per-segment comparison against formatted Git baseline
- `node --experimental-vm-modules --test test/games-overlay.test.js`
- Prettier 3.7.4 `--check`
- `npm run check`
- `git diff --check`

## Execution Results

- Recorded a 2/2 games-overlay test baseline, then observed the ownership test fail before the focused imports existed and pass after routing.
- Confirmed all six formatted owner files exactly match their contiguous formatted Git-baseline segments.
- Final physical line counts are 7 for the compatibility entry and 100, 211, 357, 214, 52, and 569 for the six owners; recursive composition leaves no unresolved imports.
- Confirmed `games.html` still contains exactly one `/css/overlays/games.css?v=20260824-04` link and remained unmodified; no runtime loader was added.
- The complete games-overlay test passes 3/3, Prettier 3.7.4 checks pass, and `npm run check` passes for 621 JavaScript files.
- `git diff --check` reports no errors after filtering line-ending warnings. Scoped review confirms only the compatibility entry, focused owners, bundle-aware test read, and ownership contract; unrelated dirty game-test changes remain untouched.

## Rollback Or Failure Handling

If a selector, rule body, import, animation, or composed assertion changes, stop and compare the six owner files with the recorded Git ranges. Reverse only the new directory files, compatibility entry, and task-owned test read changes with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The stable `games.css` entry explicitly composes six focused owners in source order.
- Every original rule is present once in an owner, with exact bodies and all files below 800 lines.
- The late drawing overrides, fixed HTML load, and all current overlay assertions remain covered by passing tests.
- Formatting, JavaScript checks, diff checks, and scoped review pass without runtime behavior changes.
