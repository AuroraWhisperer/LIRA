# Danmaku Overlay CSS Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized danmaku overlay stylesheet with a fixed ordered compatibility entry that gives the shared message/identity foundation, each existing named style, and shared motion/responsive policy explicit owners without changing rendering or runtime style selection.

**Architecture:** Keep `public/css/overlays/danmaku.css` as the only URL loaded by `danmaku.html`. It will statically import eight files under `public/css/overlays/danmaku/`: base, signal, bubble, minimal/bow, ranked, transparent, outline/fullscreen, and motion/responsive. The shared base retains common identity and emote behavior; theme files contain only their current contiguous overrides. Existing cross-theme assertions will resolve the fixed entry recursively, and a new focused ownership test will read entry/owners directly.

**Tech Stack:** Native CSS, ordered nested `@import`, Node.js contract tests, Prettier 3.7.4.

## Global Constraints

- Preserve every selector, declaration, value, animation, breakpoint, and rule body from the current working tree.
- Preserve the existing uncommitted danmaku layout fixes and their tests; do not restore `HEAD` over them.
- Use the captured pre-split working-tree baseline (SHA-256 `C406FC0A80A0DED694938180C539C7FAB146F0C416B444DC3A09CED177A264E8`) for exact routing verification.
- Keep `/css/overlays/danmaku.css?v=20260901-01` as the single HTML stylesheet URL; do not add JavaScript-driven theme loading.
- Preserve source order: base → signal → bubble → minimal → ranked → transparent → outline → motion/responsive.
- Keep common identity, avatar, badge, medal, emote, empty-state, and preview behavior in base ownership.
- Keep all keyframes and final responsive/reduced-motion overrides last.
- Update tests only to follow the new ownership/composition boundary; do not weaken existing assertions.
- Do not change HTML, runtime JavaScript, settings, routes, style values, assets, dependencies, or commits.
- Preserve all unrelated dirty-worktree changes.

---

## Non-goals

- No visual redesign, selector cleanup, token extraction, or animation changes.
- No duplication of shared identity rules inside theme files.
- No changes to feed pruning, emote rendering, fullscreen collision layout, or expiry behavior.
- No test-suite domain split beyond the focused CSS ownership contract needed here.

## Current Behavior

- `public/css/overlays/danmaku.css` contains 1,271 physical lines and differs meaningfully from `HEAD` because of in-progress user layout fixes.
- Shared stage, header, feed, message, identity, emote, empty-state, and preview rules occupy the opening block.
- Signal, bubble, minimal/bow, ranked, transparent, and outline/fullscreen are contiguous named style blocks.
- Shared keyframes and final viewport/reduced-motion overrides occupy the final block.
- `test/danmaku-overlay.test.js` currently passes 8/8 and itself contains related uncommitted regression coverage.

## Ownership

- Stable compatibility entry: `public/css/overlays/danmaku.css`.
- Shared canvas, feed, message, identity, emote, empty, and preview foundation: new `public/css/overlays/danmaku/base.css`.
- Signal console style: new `public/css/overlays/danmaku/signal.css`.
- Social bubble style: new `public/css/overlays/danmaku/bubble.css`.
- Bow/minimal style: new `public/css/overlays/danmaku/minimal.css`.
- Ranked live-bubble style: new `public/css/overlays/danmaku/ranked.css`.
- Transparent overlay style: new `public/css/overlays/danmaku/transparent.css`.
- Outline/fullscreen-random style: new `public/css/overlays/danmaku/outline.css`.
- Shared keyframes and final responsive/motion policy: new `public/css/overlays/danmaku/motion.css`.
- Direct ownership contract: new `test/danmaku-style-ownership.test.js`.
- Existing composed contract consumer: `test/danmaku-overlay.test.js`.

## Compatibility Constraints

- Entry import order must exactly preserve the current working-tree source order.
- Concatenating the eight formatted owners must reproduce the captured formatted working-tree baseline exactly.
- The HTML must continue loading only the versioned `danmaku.css` URL.
- The composed bundle must expose all six existing style values with no unresolved imports.
- Theme animation names must remain available after their consuming rules.
- All resulting files must stay below 800 lines.

## Proposed Changes

- Add a red/green ownership test in a focused new test file.
- Route unchanged contiguous source blocks into eight focused files.
- Replace `danmaku.css` with eight ordered static imports.
- Update the existing cross-theme test to resolve the compatibility entry recursively.
- Keep HTML, runtime code, and all existing assertions unchanged.

## Milestones

### Task 1: Lock composition and current behavior

**Files:**

- Create: `test/danmaku-style-ownership.test.js`

**Interfaces:**

- Consumes: direct compatibility entry and owner files.
- Produces: a test enforcing entry order and representative selector ownership.

- [x] Capture the current stylesheet hash and run an 8/8 overlay-test baseline.
- [x] Add `danmaku styles keep base, named style, and motion ownership`.
- [x] Assert the eight-entry order and representative selector ownership.
- [x] Run the ownership test and confirm it fails because the focused entry/files are absent.

### Task 2: Create focused owners and compatibility entry

**Files:**

- Modify: `public/css/overlays/danmaku.css`
- Create: `public/css/overlays/danmaku/base.css`
- Create: `public/css/overlays/danmaku/signal.css`
- Create: `public/css/overlays/danmaku/bubble.css`
- Create: `public/css/overlays/danmaku/minimal.css`
- Create: `public/css/overlays/danmaku/ranked.css`
- Create: `public/css/overlays/danmaku/transparent.css`
- Create: `public/css/overlays/danmaku/outline.css`
- Create: `public/css/overlays/danmaku/motion.css`

**Interfaces:**

- Consumes: the captured current working-tree monolith and its contiguous semantic ranges.
- Produces: the same CSS through the stable versioned entry URL.

- [x] Copy each contiguous source range into its semantic owner without editing rule bodies.
- [x] Compare every copied segment with the captured source before replacing the monolith.
- [x] Replace `danmaku.css` with only the eight ordered imports.
- [x] Run the ownership test and confirm it passes.

### Task 3: Update the composed test consumer

**Files:**

- Modify: `test/danmaku-overlay.test.js`

**Interfaces:**

- Consumes: `readCssBundle('public', 'css', 'overlays', 'danmaku.css')`.
- Produces: unchanged cross-theme assertions against recursively composed CSS.

- [x] Import `readCssBundle` and replace the direct monolith read.
- [x] Keep every existing CSS and runtime assertion unchanged.
- [x] Run both danmaku test files and expect 9/9 total.

### Task 4: Verify current-baseline routing and fixed-load safety

**Files:**

- Modify: this plan with execution results.

**Interfaces:**

- Consumes: the captured formatted working-tree baseline plus focused owner files.
- Produces: exact routing and focused regression evidence without losing dirty-worktree changes.

- [x] Compare each formatted owner and their concatenation with the captured working-tree baseline.
- [x] Confirm all files are below 800 lines and recursive composition has no unresolved imports.
- [x] Confirm `danmaku.html` still contains exactly one versioned stylesheet link and no theme-loader changes.
- [x] Run both danmaku tests, Prettier 3.7.4, and `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Verification

- Red/green ownership test in `test/danmaku-style-ownership.test.js`
- Exact per-segment and concatenated comparison against the captured working-tree baseline
- `node --experimental-vm-modules --test test/danmaku-style-ownership.test.js test/danmaku-overlay.test.js`
- Prettier 3.7.4 `--check`
- `npm run check`
- `git diff --check`

## Execution Results

- Captured the pre-split working-tree stylesheet at SHA-256 `C406FC0A80A0DED694938180C539C7FAB146F0C416B444DC3A09CED177A264E8` and recorded an 8/8 overlay-test baseline.
- Observed the new ownership test fail before the focused imports existed and pass after routing.
- Confirmed all eight formatted owners exactly match their captured working-tree segments, and their normalized concatenation reproduces the complete captured stylesheet.
- Final physical line counts are 9 for the compatibility entry and 331, 126, 259, 84, 164, 128, 86, and 88 for the eight owners; recursive composition leaves no unresolved imports.
- Confirmed `danmaku.html` still contains exactly one `/css/overlays/danmaku.css?v=20260901-01` link and remained unmodified; no runtime theme loader was added.
- Both danmaku test files pass 9/9, Prettier 3.7.4 checks pass, and `npm run check` passes for 621 JavaScript files.
- `git diff --check` reports no errors after filtering line-ending warnings. Scoped review confirms the compatibility entry, focused owners, ownership test, and bundle-aware read while preserving all pre-existing danmaku CSS/runtime-test changes.

## Rollback Or Failure Handling

If a selector, rule body, import, animation, or composed assertion changes, stop and compare the eight owner files with the captured working-tree ranges. Reverse only the new directory files, compatibility entry, focused ownership test, and task-owned bundle-read change with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The stable `danmaku.css` entry explicitly composes eight focused owners in source order.
- Every current working-tree rule is present once in an owner, with exact bodies and all files below 800 lines.
- All existing user layout fixes, the fixed HTML load, and all six style variants remain covered by passing tests.
- Formatting, JavaScript checks, diff checks, and scoped review pass without runtime behavior changes.
