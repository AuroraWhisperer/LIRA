# Song Board Styles 4 And 5 Implementation Plan

> **For agentic workers:** Execute this plan inline in the current task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits unless the user explicitly requests one.

**Goal:** Add two selectable song-board queue styles with four original generated image assets, real queue data rendering, and horizontal overflow motion for song name, requester, guard tier, and fan-medal level.

**Architecture:** Preserve the existing OBS queue overlay and persisted `overlayQueueStyle` setting. Extend the existing illustrated-queue render and scroll paths with two named variants, each using its own CSS module and generated frame/entry assets; keep classic, identity, legacy festival normalization, and storybook behavior unchanged.

**Tech Stack:** Electron 43 renderer, Vanilla JavaScript ES modules, native CSS, PNG assets, `node:test`.

## Global Constraints

- Electron desktop and the OBS browser-source overlay are the primary user-visible targets.
- Do not add a framework, bundler, dependency, process, port, schema migration, or new settings key.
- Preserve the `/queue` page, WebSocket and HTTP contracts, legacy `festival` normalization, and existing style 1-3 behavior.
- Render queue-sourced text through the existing HTML escaping helper.
- Keep unrelated working-tree changes intact and do not commit automatically.

---

## Goal

The 点歌板 tab offers style 4 and style 5. Style 4 is a dark violet/cyan/coral neon-vinyl board; style 5 is a berry-pink geometric glass-and-ribbon board. Neither repeats style 3's cream-blue dessert, cloud, bow, cookie, yellow rank block, or top-title composition.

## Non-goals

- No changes to queue ordering, request matching, backend persistence, APIs, WebSocket messages, or OBS URLs.
- No configurable palettes or per-style typography settings beyond the shared illustrated-style font-size and vertical-scroll controls.
- No redesign of styles 1-3.

## Current Behavior

- `overlayQueueStyle` recognizes `classic`, `identity`, and `storybook`; legacy `festival` maps to `identity`, while unknown values map to `classic`.
- Style 3 renders generated `frame.png` and `entry.png` assets, shows a fixed yellow rank endpoint, and scrolls a single inline content stream when it overflows.
- The admin 点歌板 tab currently exposes three style buttons and shares identity font-size/scroll controls with style 3.

## Ownership

- Owner: `public/js/overlays/`, `public/css/overlays/`, and `public/pages/overlays/queue.html` (`ROUTE-OVERLAYS`).
- Admin consumer: `public/pages/admin/song/queue-theme.html` and `public/js/admin/theme.js` (`ROUTE-ADMIN`).
- Persisted contract: `src/storage/theme-store.js` already permits `overlayQueueStyle`; the documented accepted values are owned by `docs/architecture/backend/storage.md`.
- Tests: `test/frontend-queue.test.js` and `test/queue-overlay-esm.test.js`.

## Compatibility Constraints

- Continue storing a single string in `overlayQueueStyle`; only add accepted values.
- Continue using the shared `identityQueueFontSize`, `identityQueueScrollSpeed`, and `queueScrollMode` settings for illustrated styles.
- Keep queue text escaped and keep reduced-motion behavior disabling horizontal motion.
- Preserve transparent space outside each generated board silhouette for OBS composition.

## Proposed Changes

- Create `public/img/overlays/song-board-style-4/frame.png` and `entry.png` with a neon-vinyl visual language.
- Create `public/img/overlays/song-board-style-5/frame.png` and `entry.png` with a berry-pink geometric visual language.
- Create `public/css/overlays/base/neon-vinyl.css` and `cherry-ribbon.css`, then import them through `public/css/overlays/base.css`.
- Create `public/css/overlays/base/illustrated.css` for the shared clipped-field structure used by styles 4 and 5; keep palette and asset placement in their named theme files.
- Add style buttons and shared-setting copy in `public/pages/admin/song/queue-theme.html`; update the style picker grid in `public/css/admin/toasts/gifts.css`.
- Extend style normalization, admin selection, rendering, resize relayout, and tests for both values.
- Update the frontend/admin/storage architecture documents that enumerate the style contract.

## Milestones

### Task 1: Generate and validate the four image assets

**Files:**

- Create: `public/img/overlays/song-board-style-4/frame.png`
- Create: `public/img/overlays/song-board-style-4/entry.png`
- Create: `public/img/overlays/song-board-style-5/frame.png`
- Create: `public/img/overlays/song-board-style-5/entry.png`

- [x] Generate one transparent, text-free PNG per asset with the built-in image tool.
- [x] Copy the final outputs into their project directories without overwriting existing assets.
- [x] Inspect all four images and verify portrait frame / landscape entry composition, usable content apertures, color separation, and alpha-compatible output.

Focused verification: load all four files through the image viewer and confirm non-zero dimensions and expected orientation.

### Task 2: Add failing coverage for styles 4 and 5

**Files:**

- Modify: `test/frontend-queue.test.js`
- Modify: `test/queue-overlay-esm.test.js`

- [x] Assert both admin buttons, both normalized style values, five-column picker layout, CSS imports, asset paths, and title-free frame rules.
- [x] Assert both render paths output escaped song/requester values plus explicit song, requester, guard, and medal fields.
- [x] Assert both real ESM render paths link and execute without cross-module reference errors.
- [x] Run the focused tests and confirm the new assertions fail before implementation.

### Task 3: Implement admin selection and queue rendering

**Files:**

- Modify: `public/pages/admin/song/queue-theme.html`
- Modify: `public/css/admin/toasts/gifts.css`
- Modify: `public/js/admin/theme.js`
- Modify: `public/js/overlays/queue.js`
- Modify: `public/js/overlays/queue-render.js`
- Modify: `public/js/overlays/queue-scroll.js`

- [x] Add `neon-vinyl` and `cherry-ribbon` style choices to the 点歌板 tab.
- [x] Normalize the two settings values in both admin and overlay code while retaining all existing fallbacks.
- [x] Render four explicit inline fields for each new entry and reuse the established escaped-content horizontal bounce behavior.
- [x] Reuse the illustrated vertical scrolling and resize behavior with per-style list selectors and row gaps.

Focused verification: `node --experimental-vm-modules --test test/frontend-queue.test.js test/queue-overlay-esm.test.js` passes.

### Task 4: Integrate the generated art as responsive OBS layouts

**Files:**

- Modify: `public/css/overlays/base.css`
- Create: `public/css/overlays/base/illustrated.css`
- Create: `public/css/overlays/base/neon-vinyl.css`
- Create: `public/css/overlays/base/cherry-ribbon.css`
- Modify: `public/pages/overlays/queue.html`

- [x] Build a 2:3 responsive board shell for each style and hide the shared top title only for styles 4 and 5.
- [x] Position the generated frame as a non-interactive overlay and each generated entry as a fixed row background.
- [x] Keep all four text fields in a clipped single stream, with integrated rank typography and no separate yellow rank block.
- [x] Respect reduced motion and keep decorative layers transparent outside the frame silhouette.

Focused verification: inspect both styles in the desktop/OBS renderer at representative viewport sizes, including overflowing sample content.

### Task 5: Update contracts and run repository gates

**Files:**

- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/backend/storage.md`
- Modify: `specs/plans/2026-08-20-song-board-styles-4-5.md`

- [x] Document the two new accepted style values, generated asset locations, four-field rendering, and shared controls.
- [x] Run focused tests, `npm run verify:docs`, `npm run check`, and `npm run verify:quick`.
- [x] Review `git diff`, `git diff --check`, `git diff --cached`, and `git status --short`, distinguishing pre-existing changes from task-owned additions.
- [x] Record verification results below and mark the plan complete only when all Done When conditions hold.

## Verification

- `node --experimental-vm-modules --test test/frontend-queue.test.js test/queue-overlay-esm.test.js` — expected PASS.
- `npm run verify:docs` — expected PASS.
- `npm run check` — expected PASS.
- `npm run verify:quick` — expected PASS.
- Visual desktop/OBS inspection — both styles display real sample queue data, preserve the board silhouette, hide the top title, and animate only overflowing inline content.
- `git diff --check` — expected no whitespace errors.

## Rollback Or Failure Handling

Stop after inspecting the exact scoped diff. Remove only the two new style directories/CSS modules and reverse only task-owned additions with a targeted patch; do not use reset, checkout, or broad deletion. Keep all pre-existing style 3 and unrelated working-tree changes untouched.

## Done When

- The 点歌板 tab selects and persists styles 4 and 5.
- Each style uses its own original frame and entry PNG, with no style 3 motifs or palette reuse.
- Every rendered entry includes song name, requester, guard tier, and medal name/level; untrusted text is escaped and overflow scrolls.
- Styles 1-3 and legacy `festival` behavior remain intact.
- Focused tests, documentation verification, syntax checks, quick gates, visual inspection, and final diff review pass.

## Results

Completed on 2026-08-20.

- Built-in image generation produced four text-free PNG assets. Both frames are 1024×1536 with transparent corners and central apertures; the entries are 1536×1024 and 2172×724 with transparent outer canvas.
- Focused regression: 24 tests passed, 0 failed.
- Visual QA used an isolated temporary data directory and mocked queue snapshots. Normal admin clicks selected and persisted styles 4 and 5, then returned to classic. Both designs fit 560×840 and 420×630 viewports, rendered four fields per row, animated only real overflow, hid the shared title, showed empty/no-guard/zero-medal states, and disabled motion under `prefers-reduced-motion`.
- `npm run verify:docs`, `npm run check`, and `npm run verify:quick` passed.
- Full suite: 703 tests, 702 passed, 1 skipped, 0 failed.
- `git diff --check` passed; no staged changes were present. Pre-existing style 3 and unrelated working-tree changes were preserved.
