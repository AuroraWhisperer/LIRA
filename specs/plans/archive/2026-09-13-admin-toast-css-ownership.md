# Admin Toast CSS Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the first independently testable item in client modularity batch A by separating shared toast foundations, domain toast variants, song-overlay settings, performance-page styles, and the shared switch control without changing rendered behavior.

**Architecture:** Keep `public/css/admin/toasts.css` as the ordered compatibility entry for transient admin notifications. Move non-toast rules to their existing owning entries (`workspace.css`, `other-features.css`, and `styles-admin.css`) so consumers no longer depend on a gift-toast implementation file.

**Tech Stack:** Native CSS `@import`, Electron admin renderer, Node.js test runner.

## Global Constraints

- Preserve every existing selector, declaration, page URL, DOM ID, setting key, and JavaScript class name.
- Preserve `live-refresh-icon.webp` resolution after moving its stylesheet.
- Keep `system.css` as the shared toast foundation and keep `toasts.css` as the public ordered entry.
- Do not introduce a frontend build step, runtime dependency, dynamic stylesheet loader, or broad formatting change.
- Do not modify unrelated existing working-tree changes and do not create commits without explicit user authorization.

---

## Non-goals

- No visual redesign or selector renaming.
- No implementation of the remaining batch A CSS/HTML/test splits.
- No change to the 600/800-line CI policy or modularity standard.
- No JavaScript behavior changes.

## Current Behavior

- `public/css/admin/toasts/system.css` is 763 lines and combines shared toast rules with gift-catalog, AI, playback, live-refresh, and desktop-update variants.
- `public/css/admin/toasts/gifts.css` is 969 lines; only its first gift notification block is a toast. Song overlay settings, performance metrics, hardware cards, and the generic switch control follow it.
- `public/css/admin/tabs.css` duplicates the shared toast foundation and playback-login toast that load again through `toasts.css`.
- Queue tests read `toasts/gifts.css` directly for song settings, and the shell test reads `toasts/system.css` directly for the live-refresh asset.

## Ownership

- Owner entry: `public/css/styles-admin.css`.
- Toast compatibility entry: `public/css/admin/toasts.css`.
- Shared switch owner: `public/css/components/switch-control.css`.
- Song overlay settings owner: `public/css/admin/workspace/song-overlay-settings.css`, loaded by `public/css/admin/workspace.css`.
- Performance owner: `public/css/admin/other-features/performance.css`, loaded by `public/css/admin/other-features.css`.
- Relevant consumers: admin gift notification/catalog modules, AI settings, playback operations/controls, settings operations, desktop updater, song settings pages, and the toolbox performance page.
- Focused tests: `test/admin-style-ownership.test.js`, `test/frontend-admin-shell.test.js`, `test/frontend-admin-ai.test.js`, `test/frontend-queue.test.js`, `test/ui-surface.test.js`, and `test/frontend-typography.test.js`.

## Compatibility Constraints

- The shared `.toast` rules must load before every domain variant.
- The generic switch rules must load before feature-specific overrides.
- The live-refresh image remains at `public/img/shared/live-refresh-icon.webp`; its relative URL must be recalculated from the new stylesheet directory only if that directory changes.
- The admin CSS entry remains a static import graph with no missing or duplicate relative imports.
- Responsive rules in `public/css/admin/responsive.css` continue to target the same selectors.

## Proposed Changes

- Reduce `toasts/system.css` to `.hint`, `.toast-stack`, `.toast`, and `.toast.show`.
- Keep gift-catalog and gift-notification variants together in `toasts/gifts.css`.
- Add `toasts/ai.css`, `toasts/playback.css`, `toasts/live.css`, and `toasts/desktop-update.css`; import them from `toasts.css` in a stable order after the shared foundation.
- Remove the duplicate toast rules from `tabs.css`.
- Add `components/switch-control.css`, `workspace/song-overlay-settings.css`, and `other-features/performance.css`; load them from their owning compatibility entries.
- Point tests at the owning bundle or compatibility entry instead of implementation files from another domain.

## Milestones

### Task 1: Lock the stylesheet ownership contract

**Files:**

- Create: `test/admin-style-ownership.test.js`
- Modify: `package.json`

**Interfaces:**

- Consumes: static CSS entry files and `test/helpers/css-bundle.js`.
- Produces: focused assertions for import order, selector ownership, and live-refresh asset resolution.

- [x] Add a failing test that expects the new toast and feature-owned imports.
- [x] Assert that the resolved admin bundle contains representative selectors exactly once where duplication would alter cascade behavior.
- [x] Assert that `system.css` and `toasts/gifts.css` no longer contain song, performance, hardware, or shared-switch selectors.
- [x] Add the focused test file to `npm run test:admin` and run it once to confirm failure before implementation.

### Task 2: Separate shared and domain toast styles

**Files:**

- Modify: `public/css/admin/toasts.css`
- Modify: `public/css/admin/toasts/system.css`
- Modify: `public/css/admin/toasts/gifts.css`
- Modify: `public/css/admin/tabs.css`
- Create: `public/css/admin/toasts/ai.css`
- Create: `public/css/admin/toasts/playback.css`
- Create: `public/css/admin/toasts/live.css`
- Create: `public/css/admin/toasts/desktop-update.css`

**Interfaces:**

- Consumes: unchanged class names emitted by current JavaScript modules.
- Produces: the same resolved rules through `public/css/admin/toasts.css`, with one owner for each toast variant.

- [x] Move declarations byte-for-byte apart from path correction and formatting required by their new files.
- [x] Keep the shared foundation first and the gift/AI/playback/live/desktop variants in an explicit ordered import list.
- [x] Remove only the duplicated toast blocks from `tabs.css`.

### Task 3: Rehome non-toast component styles

**Files:**

- Modify: `public/css/styles-admin.css`
- Modify: `public/css/admin/workspace.css`
- Modify: `public/css/admin/other-features.css`
- Create: `public/css/components/switch-control.css`
- Create: `public/css/admin/workspace/song-overlay-settings.css`
- Create: `public/css/admin/other-features/performance.css`
- Modify: `test/frontend-admin-shell.test.js`
- Modify: `test/frontend-queue.test.js`
- Modify: `test/ui-surface.test.js`

**Interfaces:**

- Consumes: the existing admin stylesheet entry and unchanged page class names.
- Produces: feature-owned CSS available through the same top-level `styles-admin.css` bundle.

- [x] Load shared switch styles before admin feature overrides.
- [x] Load song-overlay settings through `workspace.css` and performance styles through `other-features.css`.
- [x] Update tests to read owning bundles rather than cross-domain toast files.

### Task 4: Verify behavior and diff scope

**Files:**

- Modify: this plan with actual verification results and completed checkboxes.

- [x] Run `node --test test/admin-style-ownership.test.js test/ui-surface.test.js test/frontend-typography.test.js` and expect zero failures.
- [x] Run `node --experimental-vm-modules --test test/frontend-admin-shell.test.js test/frontend-admin-ai.test.js test/frontend-queue.test.js` and expect zero failures.
- [x] Run the repository formatter check on the touched CSS, test, JSON, and Markdown files using the repository's Prettier 3.7.4 installation.
- [x] Run `npm run check`, `git diff --check`, and inspect `git status --short`.
- [x] Confirm all new CSS files remain below 600 lines and `system.css` / `gifts.css` no longer sit in the modularity warning ranges.

## Execution Results

- The ownership test failed in all four cases before implementation and passed in all four cases afterward.
- The resolved-style and typography command passed 19 tests; the admin shell, AI, and queue command passed 92 tests; `npm run test:admin` passed 74 tests.
- `npm run check` passed syntax validation for 617 JavaScript files.
- VS Code's bundled Prettier 3.7.4 reported all touched files formatted, and `git diff --check` passed.
- A direct pre/post split comparison confirmed that the toast, switch, song-overlay, performance, and remaining tab declaration blocks are unchanged.
- Final line counts are: `system.css` 51, `gifts.css` 262, `ai.css` 59, `playback.css` 402, `live.css` 149, `desktop-update.css` 71, `switch-control.css` 51, `song-overlay-settings.css` 274, and `performance.css` 406.

## Verification

Focused commands and expected results are listed in Task 4. The final review must also inspect the resolved `styles-admin.css` import graph and confirm that the live-refresh asset exists at the resolved path.

## Rollback Or Failure Handling

Stop after the failing focused command, inspect only the files listed above, and reverse only task-owned hunks with `apply_patch`. Do not reset, checkout, or overwrite the dirty working tree. If an existing user edit overlaps a required hunk, preserve it and record the conflict here before proceeding.

## Done When

- Shared toast, domain toast, switch, song-overlay, and performance styles each have one clear owner.
- Existing selectors and visual declarations resolve through `styles-admin.css` with no duplicate shared toast block.
- Focused tests, formatter checks, JavaScript checks, and diff checks pass.
- No unrelated file or behavior is changed.
