# Illustrated Queue Responsive Scaling Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current workspace. Do not create commits unless the user explicitly requests one.

**Goal:** Keep illustrated queue styles 3, 4, 5, and 6 visually locked to their source artwork when an OBS or 直播姬 browser source changes width or height, while giving style 3 a 10px design-space bottom safety offset so its fifth visible entry is not crowded or covered by the frame.

**Architecture:** Treat each illustrated queue as a fixed 560px-wide design canvas with the artwork's own aspect ratio. Compute one bounded scale from the available viewport width and height, then transform the complete panel so the frame, rows, text, badges, clipping windows, and animation distances remain in the same coordinate system. Keep classic and identity queue sizing unchanged.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS, `node:test`, Playwright-backed local visual inspection.

## Global Constraints

- Preserve the existing Node.js 24+, Electron 43, framework-free ES module, and native CSS architecture.
- Preserve queue HTTP, WebSocket, settings, page URL, and rendered field contracts.
- Preserve the user's current uncommitted style 3 text-window coordinates in `public/css/overlays/base/storybook.css`.
- Do not modify or regenerate the supplied PNG artwork.
- Do not change classic or identity queue behavior.
- Do not create a commit.

---

## Goal

Styles 3–6 must keep every overlay element at the same position relative to its frame across width-limited, height-limited, and mismatched-aspect-ratio browser sources. At the 560px style 3 design width, the list viewport must be shifted upward by 10px without changing its height, creating the requested extra bottom clearance; the offset scales with the whole canvas at smaller source sizes.

## Non-goals

- Redesigning the four illustrated themes or changing their content fields.
- Making the artwork stretch to fill every source aspect ratio.
- Changing queue scroll modes, speeds, cloning, or overflow animation semantics.
- Refactoring the classic or identity overlay layouts.
- Adding a framework, dependency, build step, setting, or persisted value.

## Current Behavior

- The four panels use viewport-dependent widths while row heights and font sizes also contain fixed pixel clamps. Resizing can therefore reflow internal geometry independently of the frame artwork.
- Width is capped, but height is not part of the panel-fit calculation, so a short browser source can clip the bottom of the frame.
- Style 3 uses `inset: 24.5% 7.5% 17% 12.5%` for the list viewport and can leave its last visible row crowded by the bottom decoration.
- The focused baseline command passes 26 of 27 tests. The only failure is the existing `frontend-queue` assertion still expecting the pre-existing style 3 text-window coordinates instead of the user's current uncommitted values.

## Ownership

- Route: `ROUTE-OVERLAYS` in `docs/architecture/engineering/ai-workflow.md`.
- Owner CSS: `public/css/overlays/base/storybook.css`, `illustrated.css`, `neon-vinyl.css`, `cherry-ribbon.css`, and `golden-lily.css`.
- Owner JavaScript: `public/js/overlays/queue-viewport.js` and `public/js/overlays/queue.js`.
- Public page consumer: `public/pages/overlays/queue.html`, consumed by OBS/直播姬 browser sources.
- Contract: `docs/architecture/frontend/overlays.md` section 2.
- Focused tests: `test/frontend-queue.test.js` and `test/queue-overlay-responsive.test.js`.

## Compatibility Constraints

- Keep `overlayQueueStyle` values and normalization intact.
- Keep all current row markup, untrusted-text escaping, content-scroll behavior, and reduced-motion behavior intact.
- Keep each PNG's original frame aspect ratio: style 3 `1024/1536`, style 4 and 6 `1122/1402`, style 5 `1086/1448`.
- Keep the current 560px maximum visual size when the source is large enough; do not upscale beyond 1.
- Leave transparent space when the browser source aspect ratio differs from the artwork rather than stretching it.
- Maintain the user's current style 3 `background-position`, rank position, and text viewport coordinates.

## Proposed Changes

- `public/js/overlays/queue-viewport.js`: add a pure scale calculation and a DOM adapter that applies/removes `--illustrated-queue-scale`.
- `public/js/overlays/queue.js`: synchronize the illustrated canvas after applying a style and immediately on source resize before the delayed scroll relayout.
- `public/css/overlays/base/illustrated.css`: make styles 4–6 fixed 560px design canvases and scale them from the top-left as one unit.
- `public/css/overlays/base/storybook.css`: apply the same design-canvas rule to style 3 and shift its list viewport upward by a 10px design-space offset.
- `test/queue-overlay-responsive.test.js`: cover the pure contain-scale calculation and the shared canvas CSS contract.
- `test/frontend-queue.test.js`: preserve the user's current style 3 coordinates and assert the new bottom offset.
- `public/pages/overlays/queue.html`: bump CSS and JavaScript cache keys.
- `docs/architecture/frontend/overlays.md`: document the single-canvas scaling contract for styles 3–6.

## Milestones

### Task 1: Lock the responsive scaling contract with focused tests

**Files:**

- Modify: `test/queue-overlay-responsive.test.js`
- Modify: `test/frontend-queue.test.js`

**Interfaces:**

- Consumes: the existing bundled queue CSS and JavaScript test helpers.
- Produces: assertions for `calculateIllustratedQueueScale(...)`, the shared 560px design canvas, the transform variable, source-resize synchronization, the preserved style 3 text coordinates, and its 10px bottom offset.

- [x] Add a test that expects scale `1` for a source larger than a 560×840 canvas plus edges.
- [x] Add width-limited and height-limited cases that expect the smaller ratio and never allow a value above `1`.
- [x] Add CSS assertions requiring a fixed 560px canvas and `transform: scale(var(--illustrated-queue-scale, 1))` for all illustrated styles.
- [x] Update style 3 coordinate assertions to the user's current `right: 11.5%`, `left: 25%`, and `padding: 0` values, then require a 10px design-space list offset.
- [x] Run `node --experimental-vm-modules --test test/frontend-queue.test.js test/queue-overlay-responsive.test.js`; the new scale and offset assertions failed before implementation.

### Task 2: Implement one contain-scale coordinate system

**Files:**

- Modify: `public/js/overlays/queue-viewport.js`
- Modify: `public/js/overlays/queue.js`
- Modify: `public/css/overlays/base/illustrated.css`
- Modify: `public/css/overlays/base/storybook.css`

**Interfaces:**

- Produces: `calculateIllustratedQueueScale(viewportWidth, viewportHeight, canvasWidth, canvasHeight, edge)` returning a number in `(0, 1]` for valid dimensions.
- Produces: `syncIllustratedQueueViewport(panel, illustrated)` applying the pure result as `--illustrated-queue-scale` for styles 3–6 and removing it for other styles.
- Consumes: `window.innerWidth`, `window.innerHeight`, panel `offsetWidth`/`offsetHeight`, and the computed `--overlay-edge` value.

- [x] Implement the pure scale as `min(1, availableWidth / canvasWidth, availableHeight / canvasHeight)` with finite positive fallbacks.
- [x] Implement the DOM adapter without changing queue state or persistence.
- [x] Call the adapter after `applyTheme` and at the start of resize handling so visual fit updates immediately.
- [x] Replace viewport-dependent illustrated widths with a 560px design width and apply one top-left transform to the whole panel.
- [x] In style 3, define a 10px design-space vertical offset and subtract it from the top inset while adding it to the bottom inset, preserving viewport height.
- [x] Run the scale-focused file and style 3 test; both pass. The combined legacy file retains two unrelated failures from the user's concurrent removal of the `级` suffix.

### Task 3: Update the owner contract and browser cache keys

**Files:**

- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `public/pages/overlays/queue.html`

**Interfaces:**

- Produces: documented resize behavior and new resource versions for existing browser-source consumers.

- [x] Document that styles 3–6 use fixed design coordinates and a single contain scale based on both source dimensions.
- [x] State that mismatched aspect ratios leave transparent space and do not stretch artwork.
- [x] Bump the queue CSS and JavaScript query versions so existing browser sources fetch the change.
- [x] Run `npm run verify:docs`; it passes.

### Task 4: Visual and regression verification

**Files:**

- Test only; any screenshots belong under ignored `tmp/` and must not enter the diff.

**Interfaces:**

- Consumes: the local `/queue` overlay with deterministic mocked queue state.
- Produces: reviewed viewport screenshots and numeric frame/text bounds for styles 3–6.

- [x] Verify style 3 at the reference design size and confirm the fifth row has the requested 10px design-space upward clearance from its prior position.
- [x] Capture each style at a normal source, a width-limited source, and a height-limited source.
- [x] Compare normalized element-to-frame bounds and confirm the same relative coordinates within rounding tolerance.
- [x] Explore wide/short and narrow/tall sources; screenshots show transparent letterboxing, no frame distortion, no text drift, and no scroll workaround.
- [x] Run `npm run check`, then `npm run verify:quick`; both pass.
- [x] Review `git diff`, `git diff --check`, `git status --short`, and staged content if any.

## Verification

1. Baseline/focused: `node --experimental-vm-modules --test test/frontend-queue.test.js test/queue-overlay-responsive.test.js` → all pass after implementation.
2. Documentation: `npm run verify:docs` → pass.
3. Syntax: `npm run check` → pass.
4. Quick gate: `npm run verify:quick` → pass.
5. Visual QA: style 3–6 screenshots at normal, width-limited, and height-limited source sizes; relative frame/row/text bounds remain stable and all required frame regions are visible.
6. Final review: no PNG, generated output, user data, unrelated source, or staged content is added by this task.

## Execution Results

- Focused responsive tests: 6 passed.
- Style 3 focused test: 1 passed.
- Documentation verification: 5 passed.
- JavaScript syntax check: 394 files passed.
- Architecture verification: 9 passed.
- Multi-size visual QA: 12 screenshots across four styles and three viewport shapes passed normalized-coordinate and viewport-bound checks; style 3's bottom scroll endpoint was inspected separately.
- Full suite: 710 passed, 1 skipped, 2 failed. Both failures are stale `26级` expectations after the user's concurrent intentional change to render `26`; they are outside this plan's scope.
- Diff check: passed; no staged content.

## Rollback Or Failure Handling

Stop if the fixed canvas changes the large-source appearance or if numeric and screenshot checks disagree. Inspect only the files named above and reverse task-owned hunks with `apply_patch`; do not use blanket checkout, reset, or deletion. Preserve the user's pre-existing `storybook.css` coordinates even if the responsive approach is rolled back.

## Done When

- Style 3 has the 10px design-space bottom safety offset and its current text coordinates remain intact.
- Styles 3–6 scale as one undistorted unit against both browser-source width and height.
- Normal, wide/short, and narrow/tall checks show no text drift, frame clipping, or artwork stretching.
- Focused tests, documentation verification, syntax checks, and the quick gate pass.
- The overlay owner document matches runtime behavior, cache keys are bumped, and final diff review shows only task-owned changes plus the user's original `storybook.css` edits.
