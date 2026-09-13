# Desktop Lyric HTML Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the 1279-line desktop-lyric admin fragment by extracting complete, naturally grouped settings nodes and the complete live-preview section into focused subfragments while preserving the exact composed DOM order, IDs, settings keys, accessibility attributes, and event selectors.

**Architecture:** Reuse the existing one-level static `<!-- admin-fragment: pages/admin/... -->` expansion in `src/server/admin-page.js`. Keep `desktop-lyric.html` as the complete page/workspace/form owner, leave the source settings and group wrapper in place, replace groups with four ordered markers whose files contain only complete sibling nodes, and replace the complete preview section with one marker. No element will be split across files and `ADMIN_FRAGMENT_PATHS` will remain unchanged.

**Tech Stack:** Static HTML fragments, existing Node.js server composition, Node.js contract tests, Prettier 3.7.4.

## Global Constraints

- Preserve the captured clean source (SHA-256 `AAEF335E1012C18C532EDF2F4CE7FFBC38425393E81F347121EFAC195F7CFE05`) after marker expansion, modulo formatting-only whitespace.
- Preserve the outer `desktopLyricPage`, workspace, `desktopLyricForm`, source fieldset, settings wrapper, and all closing structure in the parent.
- Preserve every DOM node, order, ID, class, setting key, default value, label/help relationship, ARIA attribute, and button type.
- Extract only complete `<details>` and `<section>` nodes; do not create start/end fragments or add wrapper elements.
- Keep the source picker before all style groups, preserve group order, and keep the live preview after the complete settings section.
- Reuse only one-level static composition; do not change the include pattern, cache behavior, top-level fragment list, or public admin routes.
- Preserve existing uncommitted server-composer and composition-test changes from the completed danmaku extraction.
- Do not change JavaScript, CSS, copy, behavior, settings contracts, or commits.
- Preserve all unrelated dirty-worktree changes.

---

## Non-goals

- No new templating framework, client-side fragment fetch, custom element, or recursive include mechanism.
- No redesign, control regrouping, label changes, default changes, or form-element conversion.
- No edits to the seven intentionally incomplete shell fragments.
- No further split of the already focused 65-line preview skeleton.

## Current Behavior

- `public/pages/admin/song/desktop-lyric.html` is a complete 1279-line `desktopLyricPage` fragment.
- It contains six complete `<details>` settings groups, one complete reset `<section>`, and one complete live-preview `<section>`.
- The existing composer already expands approved complete nested fragments for the danmaku AI section and leaves `ADMIN_FRAGMENT_PATHS` as the explicit top-level order.
- Seven desktop-lyric tests read the raw oversized file even though runtime consumers receive composed HTML.
- Current lyric, composition, and admin tests pass before extraction.

## Ownership

- Page/workspace/form/source picker/settings-wrapper shell: `public/pages/admin/song/desktop-lyric.html`.
- Basic style plus stroke/shadow groups: `desktop-lyric-appearance.html`.
- Display strategy plus visibility/sync groups: `desktop-lyric-behavior.html`.
- Animation/layout group: `desktop-lyric-layout.html`.
- Background/render group plus complete reset section: `desktop-lyric-rendering.html`.
- Complete live-preview section: `desktop-lyric-preview.html`.
- Static expansion: existing `src/server/admin-page.js` behavior, unchanged.
- Composition ownership/order contract: `test/admin-page-composition.test.js`.
- Desktop lyric DOM behavior contracts: `test/desktop-lyrics.test.js` through `readAdminHtml`.

## Compatibility Constraints

- The parent must contain exactly five approved markers and none may remain in composed output.
- Subfragments must not be added to `ADMIN_FRAGMENT_PATHS`; they are nested complete regions only.
- Group order must remain: basic, effect, content, visibility, layout, render, reset, preview.
- The composed page must continue to have unique IDs and one complete document shell.
- Every new owner and the remaining parent must stay below 800 lines.
- Canonical tag/text reconstruction must equal the tracked pre-split fragment.

## Proposed Changes

- Add a failing composition contract for marker ownership, complete node boundaries, order, line limits, and composed output.
- Mechanically move the original complete node ranges into five subfragments.
- Leave five markers at their original positions without changing outer parent structure.
- Convert raw desktop-lyric test reads to the existing composed-page helper so tests observe runtime HTML.

## Milestones

### Task 1: Lock complete-region composition

**Files:**

- Modify: `test/admin-page-composition.test.js`

- [x] Assert five ordered markers in the parent and absence of extracted IDs/content there.
- [x] Assert each subfragment starts and ends on complete node boundaries.
- [x] Assert subfragments remain nested-only and composed output contains their content in order with no marker leakage.
- [x] Assert all owners are below 800 lines and run the new test red before extraction.

### Task 2: Extract complete settings and preview nodes

**Files:**

- Modify: `public/pages/admin/song/desktop-lyric.html`
- Create: `public/pages/admin/song/desktop-lyric-appearance.html`
- Create: `public/pages/admin/song/desktop-lyric-behavior.html`
- Create: `public/pages/admin/song/desktop-lyric-layout.html`
- Create: `public/pages/admin/song/desktop-lyric-rendering.html`
- Create: `public/pages/admin/song/desktop-lyric-preview.html`

- [x] Move basic/effect, content/visibility, layout, render/reset, and preview ranges without content edits.
- [x] Insert the five markers at the exact original positions.
- [x] Confirm every extracted file contains complete nodes and the parent retains a complete outer fragment.

### Task 3: Align tests with runtime composition

**Files:**

- Modify: `test/desktop-lyrics.test.js`

- [x] Replace raw desktop-lyric file reads with a scoped view of `readAdminHtml()`.
- [x] Keep all existing ordering, ID, text, default, and accessibility assertions unchanged.
- [x] Run focused lyric and composition tests.

### Task 4: Verify reconstruction and repository gates

**Files:**

- Modify: this plan with execution results.

- [x] Canonically reconstruct parent plus subfragments and compare with the captured tracked source.
- [x] Run focused lyric/composition tests and `npm run test:admin`.
- [x] Run `npm run check`, `npm run verify:architecture`, and `npm run verify:modularity`.
- [x] Run Prettier 3.7.4, `git diff --check`, scoped status, and final owner review.

## Verification

- Red/green desktop-lyric composition contract in `test/admin-page-composition.test.js`
- Canonical reconstruction against the captured tracked HTML
- `node --experimental-vm-modules --test test/admin-page-composition.test.js test/desktop-lyrics.test.js test/desktop-lyric-surface-ownership.test.js test/desktop-lyric-style-ownership.test.js`
- `npm run test:admin`
- `npm run check`
- `npm run verify:architecture`
- `npm run verify:modularity`
- Prettier 3.7.4 `--check`
- `git diff --check`

## Execution Results

- Captured the clean 1279-line source at SHA-256 `AAEF335E1012C18C532EDF2F4CE7FFBC38425393E81F347121EFAC195F7CFE05` and observed the new composition contract fail because the five markers did not yet exist.
- Moved only complete nodes into appearance, behavior, layout, rendering/reset, and preview owners. After formatting they are 344, 278, 233, 161, and 58 lines; the complete parent is 103 lines.
- The parent retains the source fieldset and settings wrapper, contains exactly five ordered static markers, and the nested owners remain absent from `ADMIN_FRAGMENT_PATHS`.
- Canonical reconstruction after trimming formatting-only tag/text-edge whitespace exactly matches the tracked 26,545-character tag/text structure.
- Desktop lyric tests now scope the real composed admin HTML to `desktopLyricPage`, preventing unrelated admin regions from satisfying or violating lyric-only assertions.
- Focused lyric/composition/style tests pass 43/43, `npm run test:admin` passes 83/83, and the architecture suite passes 22/22.
- `npm run check` passes for 635 JavaScript files; `npm run verify:modularity` reports 830 files, 48 reviewed-size files, and zero errors.
- Prettier 3.7.4, `git diff --check`, scoped status, and final fragment review pass. No full `npm test` run was required for this isolated complete-fragment extraction.

## Rollback Or Failure Handling

If composed order, IDs, canonical structure, or focused behavior changes, stop and compare each complete extracted region with the captured source. Reverse only the five markers, five subfragments, composition assertion, and composed-test reader changes with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The parent and all five subfragments are complete, focused owners below 800 lines.
- Runtime composition reproduces the original DOM order and structure with no unresolved markers or duplicate IDs.
- Existing JavaScript selectors, settings keys, accessibility relationships, and all focused assertions remain valid.
- Focused, admin, JavaScript, architecture, modularity, formatting, and diff checks pass with a reviewed scoped diff.
