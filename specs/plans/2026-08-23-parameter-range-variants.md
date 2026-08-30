# Parameter Range Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Admin UI's one-style-fits-all parameter sliders with reusable semantic visual variants suited to motion, size, effect intensity, and signed offsets.

**Architecture:** Keep `parameter-range` as the single opt-in component and preserve its existing progress synchronization. Add modifier classes to the same component rather than page-specific slider CSS; extend the shared ESM only for the centered variant's zero-origin geometry.

**Tech Stack:** Electron 43 renderer, Vanilla JavaScript ESM, native CSS, `node:test`.

## Global Constraints

- Preserve all input IDs, min/max/step/value attributes, persistence keys, event wiring, and playback seek/volume controls.
- Use named ESM exports and do not add `window.AdminApp` dependencies.
- Add no package dependency, bundler, framework, process, port, or persisted setting.
- Preserve unrelated worktree changes, including the in-progress danmaku test edits in `test/frontend-admin-ai.test.js`.
- Do not create a commit unless the user explicitly requests one.

---

## Goal

Admin parameter inputs retain identical values and behavior while their shape and track treatment communicate whether they control tempo, scale, effect intensity, or a signed value around zero. A caller selects a design by adding one modifier class next to `parameter-range`.

## Non-goals

- Redesigning playback seek, playback volume, the opening-animation volume input, or non-input progress indicators.
- Changing setting defaults, normalization, save timing, validation, or API contracts.
- Introducing a custom element or JavaScript component wrapper around native range inputs.

## Current Behavior

`public/css/components/parameter-range.css` gives every opted-in slider the same sky-blue rail and circular glass thumb. `public/js/shared/parameter-range.js` computes the left-to-current fill geometry. Admin fragments use only `class="parameter-range"`, so scroll speed, font size, opacity, and signed offsets are visually indistinguishable.

## Ownership

- Owner: `public/css/components/parameter-range.css` and `public/js/shared/parameter-range.js`.
- Composition: `public/css/styles-admin.css` and `public/js/admin/app.js`.
- Consumers: `public/pages/admin/song/queue-theme.html`, `song-board.html`, `desktop-lyric.html`, and `public/pages/admin/playback/page.html`.
- Contract documentation: `docs/architecture/frontend/app.md` and `docs/architecture/frontend/pages.md`.
- Focused regression: `test/frontend-admin-ai.test.js`.

## Compatibility Constraints

The base `parameter-range` selector remains supported as a restrained sky-blue fallback. The shared initializer continues to accept a `Document`, subtree, or one matching input, remains safe to call repeatedly, and keeps existing resize/input/change refresh behavior. Playback controls without `parameter-range` remain outside the component.

## Proposed Changes

- `public/css/components/parameter-range.css`: retain the base component and add `--tempo`, `--scale`, `--intensity`, and `--centered` modifier blocks with matching hover, focus, disabled, and reduced-motion behavior.
- `public/js/shared/parameter-range.js`: compute zero-origin start and length variables for all component inputs; centered consumers use them, other variants ignore them.
- Admin HTML fragments: add exactly one semantic modifier class to each existing `parameter-range` input.
- `test/frontend-admin-ai.test.js`: assert the public modifier vocabulary, centered geometry, representative consumer assignments, and playback isolation.
- `docs/architecture/frontend/pages.md`: record the shared component and its caller-facing modifier interface.

### Task 1: Lock the reusable modifier contract

**Files:**

- Modify: `test/frontend-admin-ai.test.js`

**Interfaces:**

- Consumes: `getParameterRangeProgress(input)` and new `getParameterRangeOrigin(input)`.
- Produces: structural coverage for `parameter-range--tempo|scale|intensity|centered` and representative HTML assignments.

- [x] Add assertions that `getParameterRangeOrigin({ min: '-20', max: '20', value: '-5' })` returns `{ zeroProgress: 50, startProgress: 37.5, lengthProgress: 12.5, polarity: 'negative' }`, with positive and zero cases.
- [x] Assert that the CSS defines all four modifier selectors and that playback seek/volume still omit `parameter-range`.
- [x] Assert representative assignments: scroll speed uses `--tempo`, font size uses `--scale`, opacity uses `--intensity`, and time offset uses `--centered`.
- [x] Run `node --test test/frontend-admin-ai.test.js`; expect failure because the new export and modifier classes do not exist yet.

### Task 2: Implement the component variants

**Files:**

- Modify: `public/js/shared/parameter-range.js`
- Modify: `public/css/components/parameter-range.css`

**Interfaces:**

- Produces: `getParameterRangeOrigin(input): { zeroProgress, startProgress, lengthProgress, polarity }`.
- Produces CSS variables: `--parameter-range-origin-start`, `--parameter-range-origin-length`, and `--parameter-range-zero-position`.

- [x] Add the pure origin calculation by clamping zero and the current value into `[min, max]`, then derive the start and absolute segment length as percentages.
- [x] In `refreshParameterRange`, convert those percentages into pixels along the thumb-center-aligned track and set `data-range-polarity` for centered CSS color selection.
- [x] Add the four modifier designs using only component-scoped selectors; keep a restrained sky-blue base as the compatibility fallback.
- [x] Keep keyboard focus visible, disabled controls subdued, and thumb transitions disabled under `prefers-reduced-motion`.
- [x] Run `node --test test/frontend-admin-ai.test.js`; the geometry assertions should pass while consumer assignment assertions still fail.

### Task 3: Assign variants by control meaning

**Files:**

- Modify: `public/pages/admin/song/queue-theme.html`
- Modify: `public/pages/admin/song/song-board.html`
- Modify: `public/pages/admin/song/desktop-lyric.html`
- Modify: `public/pages/admin/playback/page.html`

**Interfaces:**

- Consumes: the modifier classes from Task 2.
- Preserves: every existing input ID and numeric attribute.

- [x] Apply `parameter-range--tempo` to scroll-speed controls.
- [x] Apply `parameter-range--scale` to typography, spacing, stroke, blur radius, perspective, and overall scale controls.
- [x] Apply `parameter-range--intensity` to opacity, glow, shadow intensity, brightness, contrast, and saturation controls.
- [x] Apply `parameter-range--centered` to signed time, position, shadow offset, interlude offset, and rotation controls.
- [x] Run `node --test test/frontend-admin-ai.test.js test/frontend-song-board.test.js test/desktop-lyrics.test.js test/playback-wesing.test.js`; expect all tests to pass.

### Task 4: Document and verify the finished module

**Files:**

- Modify: `docs/architecture/frontend/pages.md`
- Update: `specs/plans/2026-08-23-parameter-range-variants.md`

**Interfaces:**

- Produces: discoverable caller guidance for future Admin controls.

- [x] Add the component to the CSS inventory with the exact modifier names and explain that unmodified `parameter-range` remains the default sky-blue variant.
- [x] Run `npm run check`, `npm run verify:docs`, and `npm run verify:quick`; expect exit code 0.
- [x] Inspect `git diff --check`, the scoped diff, `git status --short`, and any pre-existing staged diff; confirm no unrelated lines or generated files were added.
- [x] Record the completed verification commands and results in this plan.

## Verification

1. `node --test test/frontend-admin-ai.test.js test/frontend-song-board.test.js test/desktop-lyrics.test.js test/playback-wesing.test.js`
2. `npm run check`
3. `npm run verify:docs`
4. `npm run verify:quick`
5. Desktop visual inspection of the Admin theme, song-board, desktop-lyric, and WeSing offset controls at default, hover, keyboard-focus, zero, and disabled states.
6. `git diff --check`, scoped `git diff`, `git diff --cached` when applicable, and `git status --short`.

## Rollback Or Failure Handling

Stop after the first failing focused gate, inspect only the files listed above, and reverse only task-owned hunks with `apply_patch`. Do not use reset, blanket checkout, recursive deletion, or any operation that would discard the existing danmaku/overlay worktree changes.

## Done When

- Four reusable modifier classes render distinct, coherent native range controls.
- Signed controls fill from zero toward the current value.
- Existing values, event handlers, setting persistence, and non-component playback controls are unchanged.
- Focused tests and applicable quick verification gates pass.
- The component interface is documented and the final scoped diff contains only task-related lines.

## Execution Record

- Status: complete; inline execution used because the user requested implementation in the current task.
- Follow-up refinement: removed glass highlights, rotated diamonds, striped thumbs, layered halos, and heavy shadows; retained restrained shape differences through a rounded square, small ring, short capsule, and vertical oval.
- Focused regression: 123 tests passed across Admin composition, theme/song-board, desktop lyrics, frontend queue, and WeSing playback.
- Visual QA: desktop-shell renderer checked at 1536×960, Electron default 1280×720, and minimum 1024×680; tempo/scale/intensity/centered, keyboard focus, disabled state, signed extremes, and playback-control isolation passed. Direct Playwright Electron launch closed during startup port cleanup, so visual inspection used the identical `/admin?desktop=1` renderer in system Chrome with an isolated data directory.
- Gates: `npm run check`, `npm run verify:docs`, `npm run verify:quick`, and `npm test` passed; the full suite reported 829 passed, 0 failed.
- Follow-up verification: the slider-specific test and syntax check passed; a later architecture re-run was blocked only by unrelated concurrent `public/js/admin/danmaku-tool.js` legacy-global changes.
- Diff review: scoped and repository-wide `git diff --check` passed. The worktree contains extensive unrelated concurrent changes; task-owned hunks were reviewed without modifying or reverting those changes.
