# Desktop Lyric Renderer Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the OBS lyric browser source's dependency on admin internals by giving both the admin preview and overlay a named ESM dependency on a neutral desktop-lyric rendering owner, without changing lyric URLs, WebSocket messages, settings, timing, or animation behavior.

**Architecture:** Keep the existing renderer state machine and module-singleton lifetime because the admin page and overlay run in separate documents. Move shared desktop-lyric defaults, setting normalization, style application, timeline calculations, and rendering into `public/js/lyrics/`. Reduce `public/js/admin/desktop-lyric-preview.js` to admin-only controls/events plus the compatibility registration consumed by the existing admin initializer. Make `public/js/overlays/lyric-window.js` import the named renderer API directly and retain all socket/reconnect ownership.

**Tech Stack:** Browser-native JavaScript ES modules, Node.js VM module contract tests, repository modularity checks, Prettier 3.7.4.

## Global Constraints

- Preserve `/lyrics`, `/api/settings`, `/ws`, `lyric-state`, `lyric-timeline`, and `snapshot` contracts.
- Preserve every persisted desktop-lyric settings key and default value.
- Preserve timeline, version/sequence, word animation, performance profile, follow-pause, fallback-text, and visibility behavior.
- Do not add `window.AdminApp` dependencies outside the existing admin compatibility surface; remove its use from the overlay path.
- Keep admin form reads, preview-background controls, URL copying/toasts, and app-state event wiring in the admin owner.
- Keep WebSocket creation, reconnect backoff, snapshot handling, and settings fetch in the overlay owner.
- Do not introduce a build step, framework, generic shared utility, class conversion, or speculative renderer factory.
- Preserve unrelated dirty-worktree changes and do not create commits.

---

## Non-goals

- No CSS or HTML ownership changes in this milestone; those follow as separate reviewable batches.
- No visual, copy, accessibility, settings UI, or overlay protocol changes.
- No redesign of the existing admin global bridge beyond retaining its current compatibility registration.
- No split of the renderer's internal state machine merely to reduce function or line counts.

## Current Behavior

- `public/js/overlays/lyric-window.js` imports `../admin/desktop-lyric-preview.js` and obtains the renderer through `window.AdminApp.desktopLyricPreview`.
- `public/js/admin/desktop-lyric-preview.js` mixes the shared 581-line rendering state machine with admin form controls, URL copying, and `app:*` event wiring.
- Four renderer dependencies (`desktop-lyric-defaults.js`, `desktop-lyric-settings.js`, `desktop-lyric-timeline.js`, and `desktop-lyric-styles.js`) are also located under `public/js/admin/` despite being used by shared rendering behavior.
- `public/js/admin/desktop-lyric.js` imports the same defaults for the settings form.
- The focused `test/desktop-lyrics.test.js` baseline passes 34/34.

## Ownership

- Neutral desktop-lyric rendering API and renderer helpers: new `public/js/lyrics/` domain.
- Admin preview controls, form-derived settings, copy action, app events, and compatibility registration: `public/js/admin/desktop-lyric-preview.js`.
- Admin settings form and persistence UI: `public/js/admin/desktop-lyric.js` plus `desktop-lyric-controls.js`.
- OBS socket, reconnect, and initial settings fetch: `public/js/overlays/lyric-window.js`.
- Behavior and dependency-direction contracts: `test/desktop-lyrics.test.js`, `test/module-boundaries.test.js`, `test/esm-module-boundaries.test.js`, and `test/modularity-size.test.js`.

## Compatibility Constraints

- The admin initializer must continue to call `window.AdminApp.desktopLyricPreview.init(form)` and `applySettings(settings)` without caller changes.
- The neutral renderer must export the same pure helper functions currently exercised from the admin preview module.
- Both surfaces must use the same renderer API: `init`, `applySettings`, `updateLyricState`, and `updateLyricTimeline`.
- The overlay module must contain no admin import and no `window.AdminApp` access.
- All moved relative ESM paths must resolve, and the internal dependency graph must remain acyclic.
- Existing script/page URLs remain stable; cache-busting versions may advance only where required to load changed module contents.

## Proposed Changes

- Move the four renderer-owned helper modules from `public/js/admin/` to `public/js/lyrics/` with their contents unchanged.
- Move the rendering state machine into `public/js/lyrics/desktop-lyric-renderer.js`, give its four runtime methods a named exported API object, and keep pure helper exports available.
- Recreate `public/js/admin/desktop-lyric-preview.js` as a thin adapter over the neutral renderer plus existing admin-only controls and utilities.
- Change the overlay to import and use the named neutral renderer object directly.
- Point the admin form at the neutral defaults owner and update focused tests to assert the new dependency direction and ownership.

## Milestones

### Task 1: Lock dependency-direction and behavior contracts

**Files:**

- Modify: `test/desktop-lyrics.test.js`
- Create: `test/desktop-lyric-surface-ownership.test.js`

**Interfaces:**

- Consumes: static source imports and named renderer exports.
- Produces: assertions that both UI adapters use the neutral renderer and the overlay has no admin/global dependency.

- [x] Update the browser-source test to require a direct `public/js/lyrics/desktop-lyric-renderer.js` import.
- [x] Require the admin adapter to import the same renderer API and retain admin-only control/copy wiring.
- [x] Redirect pure helper and shared rendering source assertions to their new owners.
- [x] Run the focused file and confirm the ownership assertions fail before implementation.

### Task 2: Establish the neutral lyric domain

**Files:**

- Move: `public/js/admin/desktop-lyric-defaults.js` to `public/js/lyrics/desktop-lyric-defaults.js`
- Move: `public/js/admin/desktop-lyric-settings.js` to `public/js/lyrics/desktop-lyric-settings.js`
- Move: `public/js/admin/desktop-lyric-timeline.js` to `public/js/lyrics/desktop-lyric-timeline.js`
- Move: `public/js/admin/desktop-lyric-styles.js` to `public/js/lyrics/desktop-lyric-styles.js`
- Create: `public/js/lyrics/desktop-lyric-renderer.js`

**Interfaces:**

- Consumes: DOM lyric surface plus normalized settings, lyric states, and timelines.
- Produces: named renderer API and existing pure timing/settings helpers.

- [x] Move the helper owners without behavioral edits.
- [x] Extract the existing renderer state machine and update only its relative imports.
- [x] Remove form controls, copying, admin events, and `window.AdminApp` access from the neutral renderer.
- [x] Export `desktopLyricRenderer` with `init`, `applySettings`, `updateLyricState`, and `updateLyricTimeline`.

### Task 3: Rewire both surface adapters

**Files:**

- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `public/js/admin/desktop-lyric.js`
- Modify: `public/js/overlays/lyric-window.js`
- Modify: `public/pages/overlays/lyric-window.html` only if its module cache version must advance.

**Interfaces:**

- Admin consumes: form controls, local overlay origin, copied URL, app events/state, and neutral renderer.
- Overlay consumes: settings fetch/WebSocket messages and neutral renderer.

- [x] Build the thin admin adapter while retaining the existing `window.AdminApp.desktopLyricPreview` compatibility object.
- [x] Point the admin settings form at neutral defaults.
- [x] Make the overlay import and invoke the named renderer directly with no admin/global access.
- [x] Preserve existing initialization order and all message handlers.

### Task 4: Verify architecture and behavior

**Files:**

- Modify: this plan with execution results.

**Interfaces:**

- Consumes: final source graph and focused runtime contracts.
- Produces: passing behavior, architecture, formatting, and diff evidence.

- [x] Run `test/desktop-lyrics.test.js` and the three architecture test files.
- [x] Run `npm run check` and `npm run verify:modularity`.
- [x] Run Prettier 3.7.4 on changed JavaScript/tests/plan.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Verification

- Red/green ownership assertions in `test/desktop-lyrics.test.js`
- `node --experimental-vm-modules --test test/desktop-lyrics.test.js`
- `npm run verify:architecture`
- `npm run check`
- `npm run verify:modularity`
- Prettier 3.7.4 `--check`
- `git diff --check`

## Execution Results

- Recorded a 34/34 focused baseline, then observed the new ownership contract fail only because the neutral modules did not yet exist.
- Moved the four helper owners with exact line-for-line content equality against their previous tracked files. The neutral renderer is 536 lines and the admin adapter is 73 lines.
- Removed every admin import and `window.AdminApp` access from the overlay; its frozen legacy-global allowance dropped from one occurrence to zero.
- Moved the surface ownership scenario into a focused 74-line test because adding it to the existing 1718-line legacy file would exceed that file's reviewed ceiling. The remaining legacy test file is 1685 lines.
- The combined lyric tests pass 34/34 and the architecture suite passes 22/22.
- `npm run check` passes for 626 JavaScript files; `npm run verify:modularity` reports 812 scanned files, 51 reviewed-size files, and zero errors.
- Prettier 3.7.4, `git diff --check`, scoped status, and final source/diff review pass. No full `npm test` run was required for this isolated dependency-direction batch.

## Rollback Or Failure Handling

If exports, runtime initialization, architecture checks, or focused behavior regress, stop and inspect only the lyric-domain moves and three adapter diffs. Reverse task-owned patches with `apply_patch`; do not reset, checkout, delete unrelated untracked files, or disturb existing staged content.

## Done When

- Admin preview and OBS lyric source both depend on the neutral named renderer API.
- The overlay has no import from `public/js/admin/` and no `window.AdminApp` dependency.
- Admin-only controls/events and overlay-only socket behavior remain in their owners.
- Public URLs, settings, WebSocket messages, timeline/animation behavior, and existing caller compatibility are unchanged.
- Focused lyric, architecture, modularity, formatting, JavaScript, and diff checks pass with a reviewed scoped diff.
