# Illustrated Queue Layering And Scroll Bounds Implementation Plan

> Archived: 2026-08-20

> **For agentic workers:** Execute this plan inline in the current workspace. Do not create commits unless the user explicitly requests one.

**Goal:** Persist the user's style 4–6 coordinate adjustments, tighten style 5 and 6 vertical scrolling bounds, and layer cards between each frame's center fill and decorative border.

**Architecture:** Keep the existing fixed 560px design canvases and outer contain scale. Render the full frame artwork as a bottom `::before` layer, keep queue cards in the existing middle content layer, and render only the border slices of the same artwork as a top `::after` layer using `border-image` without center fill. Let existing scroll measurement derive animation distances from the tightened viewports, with style 6 using the same 3px row gap on initial render and resize relayout.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS, `node:test`, Playwright-backed local visual inspection.

## Global Constraints

- Preserve the existing Node.js 24+, Electron 43, Vanilla JavaScript, and native CSS architecture.
- Preserve the fixed 560px design canvases and `--illustrated-queue-scale` outer scaling contract.
- Preserve all supplied PNG files and the user's unrelated changes in `public/css/admin/collapsible.css` and `test/frontend-admin-shell.test.js`.
- Preserve queue markup, fields, horizontal overflow animation, vertical scroll modes, reduced-motion behavior, and public settings.
- Do not create a commit.

## Current Behavior

- Screenshot-only DevTools coordinates for styles 4–6 are not persisted in the CSS files.
- Style 5 uses the broad `19.5% ... 9.5%` vertical content window instead of trimming 5px at the top and 30px at the bottom.
- Style 6 uses a 6px CSS gap, passes 6px during initial rendering, but incorrectly falls back to 8px during resize relayout; its content bottom is 8.5%, below the requested boundary near the current fourth rank.
- Styles 4–6 render the whole frame image in one layer below the cards, so cards can cover the frame ornaments.

## Ownership

- Route: `ROUTE-OVERLAYS`.
- CSS owners: `public/css/overlays/base/illustrated.css`, `neon-vinyl.css`, `cherry-ribbon.css`, and `golden-lily.css`.
- JavaScript owners: `public/js/overlays/queue-render.js` and `public/js/overlays/queue.js`.
- Contract: `docs/architecture/frontend/overlays.md` section 2.
- Tests: `test/frontend-queue.test.js` and `test/queue-overlay-responsive.test.js`.

## Compatibility Constraints

- Style 4 text viewport: `top: 19%`, `right: 15%`, `bottom: 31%`, `left: 25.5%`.
- Style 5 text viewport: `top: 33%`, `right: 14.5%`, `bottom: 33%`, `left: 22%`.
- Style 6 text viewport: `top: 31%`, `right: 11%`, `bottom: 29%`, `left: 32%`.
- Style 6 row width: `76%`; row gap: `3px` on initial render and relayout.
- The purple DevTools bands in the supplied screenshot describe only the row gap; they do not define the content-window height or visible row count.
- Style 5 content window: existing top plus 5 design pixels, existing bottom plus 30 design pixels.
- Style 6 content bottom: `17%`, placing its visible lower edge near the current fourth-rank center while preserving vertical overflow.
- Foreground frame border slices must omit the opaque center (`border-image-slice` without `fill`) so cards remain above the center color.

## Milestones

### Task 1: Add coordinate, bounds, gap, and layer regression assertions

**Files:**

- Modify: `test/frontend-queue.test.js`
- Modify: `test/queue-overlay-responsive.test.js`

- [x] Assert the four screenshot-derived text viewport coordinates and style 6 width `76%`.
- [x] Assert style 5's `+5px` top trim and `+30px` bottom trim.
- [x] Assert style 6's `17%` bottom boundary and `3px` CSS/render/relayout gap.
- [x] Assert styles 4–6 have a z-index 0 full-frame `::before`, z-index 2 content, and z-index 3 no-fill `border-image` `::after`.
- [x] Run the two focused test files and confirm these new assertions fail before implementation.

### Task 2: Implement visual coordinates, scroll bounds, and frame sandwich layers

**Files:**

- Modify: `public/css/overlays/base/neon-vinyl.css`
- Modify: `public/css/overlays/base/cherry-ribbon.css`
- Modify: `public/css/overlays/base/golden-lily.css`
- Modify: `public/css/overlays/base/illustrated.css`
- Modify: `public/js/overlays/queue-render.js`
- Modify: `public/js/overlays/queue.js`

- [x] Persist all screenshot-derived text viewport coordinates.
- [x] Tighten style 5's content inset using 5px/30px design-space variables.
- [x] Set style 6 row width to `76%`, content bottom to `17%`, and row gap to `3px` in CSS and both JavaScript paths.
- [x] Split each style 4–6 frame into a full bottom background and a no-center border-image foreground above the cards.
- [x] Run focused tests and expect the new assertions to pass.

### Task 3: Update contract, cache keys, and visual evidence

**Files:**

- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `public/pages/overlays/queue.html`

- [x] Document the background/cards/decorative-border layer contract and tightened style 5/6 viewport behavior.
- [x] Bump CSS and JavaScript cache query versions.
- [x] Capture styles 4–6 at reference, width-limited, and height-limited sizes, including top and bottom scroll endpoints.
- [x] Verify long horizontal content uses the measured information-window overflow and does not cover the decorative border.
- [x] Run `npm run verify:quick`, review `git diff`, `git diff --check`, and `git status --short`.

## Verification

1. `node --experimental-vm-modules --test test/frontend-queue.test.js test/queue-overlay-responsive.test.js`.
2. Deterministic local screenshots for styles 4–6 at 900×1000, 400×900, and 900×457, plus bottom-scroll states.
3. `npm run verify:quick`.
4. Final diff/status review that preserves the two unrelated user-modified files.

## Rollback Or Failure Handling

If a border slice covers the center text or hides too much card artwork, adjust only that style's `border-image-slice` and matching design-space border width. Reverse task-owned hunks with `apply_patch`; do not use reset, checkout, or broad deletion.

## Done When

- Styles 4–6 use the exact screenshot coordinates and retain them under outer source scaling.
- Style 5 scrolls only between its new top and bottom cutoffs.
- Style 6 shows the narrower 76% cards, half-sized 3px gaps, and lower boundary near the fourth rank.
- Cards render above the central frame color but below the visible frame decorations throughout scrolling.
- Focused tests, visual checks, and quick verification pass with unrelated user changes untouched.
