# Clock Overlay CSS Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized clock overlay stylesheet with a fixed ordered compatibility entry that gives the shared clock skeleton, each existing named visual family, and shared animations explicit owners without changing any rendered style or loading JavaScript.

**Architecture:** Keep `public/css/overlays/clock.css` as the only URL loaded by `clock.html`. It will statically import seven files under `public/css/overlays/clock/`: base skeleton, peach, starlight, soda, the two timeline orientations as one family, digital, and shared animations/motion policy. Existing composed assertions will resolve the fixed entry recursively, while a focused ownership contract reads the entry and owner files directly.

**Tech Stack:** Native CSS, ordered nested `@import`, Node.js contract tests, Prettier 3.7.4.

## Global Constraints

- Preserve every existing selector, declaration, value, animation, and rule body.
- Keep `/css/overlays/clock.css` as the single fixed HTML entry; do not add JavaScript-driven theme loading.
- Preserve source order: base → peach → starlight → soda → timeline → digital → animations.
- Treat `timeline-horizontal` and `timeline-vertical` as one theme family because they share selectors and typography.
- Keep `[hidden]` and reduced-motion policy after all theme rules, matching the existing cascade.
- Update tests only to follow the new ownership/composition boundary; do not weaken existing assertions.
- Do not change HTML, JavaScript, settings, routes, theme values, dependencies, or commits.
- Preserve unrelated dirty-worktree changes, including the pre-existing formatting-only changes in `test/clock-overlay.test.js`.

---

## Non-goals

- No visual redesign, selector cleanup, token extraction, or animation changes.
- No one-file-per-timeline-orientation fragmentation.
- No changes to the admin clock-card stylesheet or preview behavior.
- No dynamic stylesheet switching by query parameter or theme value.

## Current Behavior

- `public/css/overlays/clock.css` contains 1,228 physical lines and is loaded directly by `public/pages/overlays/clock.html`.
- Shared canvas and clock typography occupy the opening block through `.clock-sparkles i`.
- Peach, starlight, and soda are contiguous illustrated theme blocks.
- The timeline block owns both horizontal and vertical variants; digital is a separate contiguous block.
- Shared keyframes, `[hidden]`, and reduced-motion policy occupy the final block.
- `test/clock-overlay.test.js` currently passes 8/8.

## Ownership

- Stable compatibility entry: `public/css/overlays/clock.css`.
- Shared canvas, scale, and time skeleton: new `public/css/overlays/clock/base.css`.
- Peach illustrated theme: new `public/css/overlays/clock/peach.css`.
- Starlight illustrated theme: new `public/css/overlays/clock/starlight.css`.
- Soda illustrated theme: new `public/css/overlays/clock/soda.css`.
- Horizontal and vertical timeline family: new `public/css/overlays/clock/timeline.css`.
- Digital theme: new `public/css/overlays/clock/digital.css`.
- Shared keyframes, visibility utility, and reduced-motion policy: new `public/css/overlays/clock/animations.css`.
- Composed and ownership contracts: `test/clock-overlay.test.js`.

## Compatibility Constraints

- Entry import order must exactly preserve the current source order.
- Each formatted owner must compare exactly with its routed formatted Git-baseline segment.
- The HTML must continue loading only `clock.css`.
- The bundle must expose all six accepted style values and resolve every nested import.
- Animation names must stay available after their consuming theme declarations.
- All resulting files must stay below 800 lines.

## Proposed Changes

- Add a red/green ownership test and use the existing CSS bundle helper for composed assertions.
- Route unchanged contiguous source blocks into seven focused files.
- Replace `clock.css` with seven ordered static imports.
- Keep the HTML and all runtime code unchanged.

## Milestones

### Task 1: Lock composition and current behavior

**Files:**

- Modify: `test/clock-overlay.test.js`

**Interfaces:**

- Consumes: `readCssBundle(...relativeSegments)` and direct owner files.
- Produces: a test enforcing fixed entry order and representative selector ownership.

- [x] Run `test/clock-overlay.test.js` and record an 8/8 baseline.
- [x] Import `readCssBundle` and add `clock styles keep fixed base, named theme, and animation ownership`.
- [x] Assert the seven-entry order and representative selector ownership.
- [x] Run the named test and confirm it fails because the focused entry/files are absent.

### Task 2: Create focused owners and compatibility entry

**Files:**

- Modify: `public/css/overlays/clock.css`
- Create: `public/css/overlays/clock/base.css`
- Create: `public/css/overlays/clock/peach.css`
- Create: `public/css/overlays/clock/starlight.css`
- Create: `public/css/overlays/clock/soda.css`
- Create: `public/css/overlays/clock/timeline.css`
- Create: `public/css/overlays/clock/digital.css`
- Create: `public/css/overlays/clock/animations.css`

**Interfaces:**

- Consumes: the current formatted monolith and its contiguous semantic ranges.
- Produces: the same CSS through the stable `/css/overlays/clock.css` URL.

- [x] Copy each contiguous source range into its semantic owner without editing rule bodies.
- [x] Compare every copied segment with the current source before replacing the monolith.
- [x] Replace `clock.css` with only the seven ordered imports.
- [x] Run the ownership test and confirm it passes.

### Task 3: Update the composed test consumer

**Files:**

- Modify: `test/clock-overlay.test.js`

**Interfaces:**

- Consumes: the stable compatibility entry.
- Produces: unchanged cross-theme assertions against recursively composed CSS.

- [x] Replace the direct monolith read used for cross-theme assertions with `readCssBundle`.
- [x] Keep every existing cross-theme regex assertion unchanged.
- [x] Run the complete clock test file and expect 9/9 after adding the ownership test.

### Task 4: Verify routing and fixed-load safety

**Files:**

- Modify: this plan with execution results.

**Interfaces:**

- Consumes: formatted Git baseline plus focused owner files.
- Produces: exact segment routing and focused regression evidence.

- [x] Compare each formatted routed segment with its formatted Git baseline source.
- [x] Confirm all files are below 800 lines and recursive composition has no unresolved imports.
- [x] Confirm `clock.html` still contains exactly one clock stylesheet link and no theme-loader changes.
- [x] Run the clock test, Prettier 3.7.4, and `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Verification

- Red/green ownership test in `test/clock-overlay.test.js`
- Exact per-segment comparison against formatted Git baseline
- `node --experimental-vm-modules --test test/clock-overlay.test.js`
- Prettier 3.7.4 `--check`
- `npm run check`
- `git diff --check`

## Execution Results

- Recorded an 8/8 clock test baseline, then observed the new ownership test fail before the focused imports existed and pass after routing.
- Confirmed all seven formatted owner files exactly match their contiguous formatted Git-baseline segments.
- Final physical line counts are 8 for the compatibility entry and 141, 227, 222, 243, 245, 88, and 56 for the seven owners; recursive composition leaves no unresolved imports.
- Confirmed `clock.html` still contains exactly one `/css/overlays/clock.css` link and remained unmodified; no runtime theme loader was added.
- The complete clock test passes 9/9, Prettier 3.7.4 checks pass, and `npm run check` passes for 620 JavaScript files.
- `git diff --check` reports no errors after filtering line-ending warnings. Scoped diff review shows the fixed entry, focused owner files, bundle-aware test read, and ownership contract; the pre-existing formatting-only test hunks remain preserved.

## Rollback Or Failure Handling

If a selector, rule body, import, animation, or composed assertion changes, stop and compare the seven owner files with the recorded Git ranges. Reverse only the new directory files, compatibility entry, and task-owned test read changes with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The stable `clock.css` entry explicitly composes seven focused owners in source order.
- Every original rule is present once in an owner, with exact bodies and all files below 800 lines.
- The fixed HTML load and all six existing clock styles remain covered by passing tests.
- Formatting, JavaScript checks, diff checks, and scoped review pass without runtime behavior changes.
