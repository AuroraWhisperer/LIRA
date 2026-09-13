# Danmaku Admin HTML Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the oversized danmaku toolbox fragment by extracting the complete AI interaction assistant section into its own HTML owner while preserving the exact composed DOM order, IDs, settings bindings, and current uncommitted preview-button changes.

**Architecture:** Keep `pages/admin/toolbox/danmaku.html` as the complete `otherDanmakuFeature` panel. Add a narrowly scoped inline-fragment marker inside its existing panel body, teach the existing server admin composer to replace approved `pages/admin/.../*.html` markers with complete fragment contents, and place a complete `xiaomiAiSection` in `danmaku-ai.html`. This avoids creating new start/end fragments or splitting an HTML element across files and provides the same mechanism needed by the remaining desktop-lyric region extraction.

**Tech Stack:** Server-side Node.js file composition, HTML fragments, Node.js contract tests, Prettier 3.7.4.

## Global Constraints

- Preserve the complete composed markup, DOM order, IDs, form fields, attributes, default values, accessibility labels, and setting/event hooks.
- Preserve the existing uncommitted removal of the embedded preview iframe and addition of `danmakuPreviewOverlayBtn`.
- Use the captured pre-split working-tree baseline (SHA-256 `EE30C48D0AE6038090F8467C37D0603530DCB5AEA39E99D6582096B682D85752`) for reconstruction verification.
- Extract only the complete `section#xiaomiAiSection`; do not split a form or outer feature panel across files.
- Keep `ADMIN_FRAGMENT_PATHS` as the explicit top-level route order and preserve cache behavior.
- Limit inline fragment paths to static `pages/admin/` HTML paths with kebab-case segments; do not create a general filesystem include language.
- Keep all existing composed-page uniqueness, ordering, frame-protection, and token-injection contracts.
- Do not change frontend JavaScript, CSS, settings keys, runtime behavior, dependencies, or commits.
- Preserve all unrelated dirty-worktree changes.

---

## Non-goals

- No redesign or copy changes.
- No extraction of connection, style, sender, or fixed-reply sections in this milestone; after AI extraction the main fragment is already below 800 lines.
- No new incomplete start/end fragments and no changes to the seven intentionally incomplete shell fragments.
- No client-side HTML fetching, custom elements, templating framework, or build step.

## Current Behavior

- `public/pages/admin/toolbox/danmaku.html` contains 912 physical lines and is a complete outer feature panel.
- The complete AI assistant section spans the current `section#xiaomiAiSection`, including its status grid and `form#xiaomiAiForm`.
- The server currently concatenates only the explicit `ADMIN_FRAGMENT_PATHS` entries and does not expand complete nested regions.
- Tests reading the composed admin page already cover AI order, IDs, settings ranges, and accessibility; `ui-surface.test.js` directly reads the oversized owner for one AI combobox assertion.
- The five affected test files currently pass 46/46.

## Ownership

- Top-level danmaku panel and connection/style/send/fixed-reply regions: `public/pages/admin/toolbox/danmaku.html`.
- Complete AI interaction assistant region: new `public/pages/admin/toolbox/danmaku-ai.html`.
- Static inline-fragment expansion at the server composition root: `src/server/admin-page.js`.
- Composition completeness/order/uniqueness contract: `test/admin-page-composition.test.js`.
- AI-specific direct markup consumer: `test/ui-surface.test.js`.
- Composed consumers: `test/frontend-admin-ai.test.js`, `test/contextual-help.test.js`, and `test/toolbox-sidebar.test.js`.

## Compatibility Constraints

- The composed output must place `xiaomiAiSection` after `danmakuSendForm` and before `danmakuFixedReplyTitle`.
- The composed output must contain no unresolved inline-fragment marker and no duplicate IDs.
- The extracted AI file must be one complete section, and the remaining danmaku file must still be one complete outer section.
- Normalizing formatting-only whitespace after marker expansion must reproduce the captured working-tree fragment.
- Both resulting HTML files must stay below 800 lines.
- Existing public admin URLs and `ADMIN_FRAGMENT_PATHS` top-level order must remain unchanged.

## Proposed Changes

- Add a red/green composition contract for a complete nested admin fragment.
- Add a static inline-fragment reader to the existing admin composer.
- Move the unchanged complete AI section into `danmaku-ai.html` and leave one explicit marker at the same position.
- Redirect the one direct AI-markup test to the focused owner; leave all composed tests on `composeAdminHtml`.

## Milestones

### Task 1: Lock current composition and desired ownership

**Files:**

- Modify: `test/admin-page-composition.test.js`

**Interfaces:**

- Consumes: raw parent/subfragment files plus `composeAdminHtml`.
- Produces: a test enforcing complete extraction, marker expansion, order, and uniqueness.

- [x] Capture the current working-tree fragment hash and run the five affected files for a 46/46 baseline.
- [x] Add `admin composition expands the complete danmaku AI subfragment in place`.
- [x] Assert raw ownership, complete section boundaries, resolved composition order, and no marker leakage.
- [x] Run the named test and confirm it fails before the marker/subfragment exist.

### Task 2: Add narrow inline-fragment composition

**Files:**

- Modify: `src/server/admin-page.js`

**Interfaces:**

- Consumes: `<!-- admin-fragment: pages/admin/.../*.html -->` inside an explicit top-level fragment.
- Produces: the same cached composed admin HTML with the complete referenced region expanded in place.

- [x] Add a restricted inline-fragment pattern and a small file-reader helper.
- [x] Route every top-level fragment through the helper without changing `ADMIN_FRAGMENT_PATHS`.
- [x] Keep direct, one-level expansion only; do not add recursive or dynamic behavior.

### Task 3: Extract the complete AI section

**Files:**

- Modify: `public/pages/admin/toolbox/danmaku.html`
- Create: `public/pages/admin/toolbox/danmaku-ai.html`
- Modify: `test/ui-surface.test.js`

**Interfaces:**

- Consumes: the current complete `xiaomiAiSection` node.
- Produces: the same node at the same composed location from its focused owner.

- [x] Copy the complete AI section unchanged into `danmaku-ai.html`.
- [x] Compare the copied node with the captured current source before replacing it with the marker.
- [x] Update the direct AI-markup test to read `danmaku-ai.html`.
- [x] Run the named composition test and confirm it passes.

### Task 4: Verify DOM and route compatibility

**Files:**

- Modify: this plan with execution results.

**Interfaces:**

- Consumes: the captured working-tree fragment and final composed page.
- Produces: exact normalized reconstruction plus focused regression evidence.

- [x] Reconstruct the parent plus AI subfragment and compare it with the captured working-tree baseline after whitespace normalization.
- [x] Confirm both owner files are below 800 lines and each is a complete section.
- [x] Run the five affected test files and `npm run test:admin`.
- [x] Run Prettier 3.7.4 on complete fragments/code/tests and `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Verification

- Red/green inline-fragment composition test
- Normalized reconstruction against captured working-tree HTML
- `node --experimental-vm-modules --test test/admin-page-composition.test.js test/frontend-admin-ai.test.js test/ui-surface.test.js test/contextual-help.test.js test/toolbox-sidebar.test.js`
- `npm run test:admin`
- Prettier 3.7.4 `--check`
- `npm run check`
- `git diff --check`

## Execution Results

- Captured the pre-split working-tree fragment at SHA-256 `EE30C48D0AE6038090F8467C37D0603530DCB5AEA39E99D6582096B682D85752` and recorded a 46/46 affected-test baseline.
- Observed the new composition contract fail before the marker/subfragment existed and pass after one-level expansion was implemented.
- Copied the complete AI section before replacing it, then confirmed the formatted parent plus AI owner canonically reconstruct the captured 17,708-character tag/text structure exactly.
- The parent is now 513 lines and the complete AI section is 372 lines. The parent contains one marker and no AI ID; the AI owner starts and ends with its complete section.
- The five affected files pass 47/47, `npm run test:admin` passes 82/82, Prettier 3.7.4 checks pass, and `npm run check` passes for 624 JavaScript files.
- `git diff --check` reports no errors after filtering line-ending warnings. Scoped review confirms the one-level composer, complete AI extraction, and direct test-owner redirect while preserving the existing preview-button and unrelated test changes.

## Rollback Or Failure Handling

If the composed order, IDs, structure, or existing tests change, stop and compare the raw parent/AI files with the captured source. Reverse only the inline-fragment helper, marker, new complete AI file, and direct test-owner change with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The danmaku parent and AI files are both complete, focused HTML regions below 800 lines.
- Server composition expands the AI section at the original location without marker leakage, duplicate IDs, or contract changes.
- The captured uncommitted markup changes and all existing AI/danmaku behavior remain intact.
- Formatting, JavaScript checks, affected tests, admin tests, diff checks, and scoped review pass.
