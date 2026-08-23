# All Song Board Proportional Scaling Implementation Plan

> **For agentic workers:** Execute this plan inline in the current workspace. Do not create commits unless the user explicitly requests one.

**Goal:** Make all six `/queue` song-board styles scale as one undistorted unit when an OBS or 直播姬 browser source is resized to any width and height.

**Architecture:** Give every style a stable design-space width and keep its internal row viewport in design coordinates. Measure the rendered panel's untransformed design size, calculate one contain scale from the available browser-source width and height, and transform the complete panel so backgrounds, artwork, rows, text, badges, spacing, clipping windows, and animation distances share the same multiplier. Mismatched source ratios leave transparent space instead of stretching either axis.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS, `node:test`, Playwright-backed local Chromium QA.

## Global Constraints

- Preserve the existing `/queue` URL, settings keys, WebSocket behavior, rendered fields, scroll modes, and untrusted-text escaping.
- Preserve each style's current design appearance and current style 6 row-height ratio `2139 / 539`.
- Do not distort supplied artwork or independently recalculate font sizes from the browser-source width.
- Permit both enlargement and reduction; do not cap the scale at `1`.
- Do not add dependencies, settings, framework code, or persisted data.
- Preserve unrelated uncommitted workspace changes and do not create a commit.

---

### Task 1: Lock the six-style scaling contract

**Files:**

- Modify: `test/queue-overlay-responsive.test.js`
- Modify: `test/frontend-queue.test.js`
- Modify: `test/queue-overlay-esm.test.js`

**Interfaces:**

- Consumes: bundled queue CSS/JavaScript test helpers and the real queue ES module graph.
- Produces: assertions for `calculateQueuePanelScale(...)`, `syncQueuePanelViewport(panel)`, fixed design widths, fixed list-window heights for styles 1–2, and one shared transform variable across styles 1–6.

- [x] **Step 1: Change the pure-scale expectations**

  Require `calculateQueuePanelScale(1920, 1080, 560, 840, 16)` to return `1048 / 840`, proving large sources can enlarge the board. Keep width-limited `368 / 560` and height-limited `425 / 840` cases.

- [x] **Step 2: Require one panel-level transform for all styles**

  Assert that `.queue-classic`, `.queue-identity`, `.queue-storybook`, `.queue-neon-vinyl`, `.queue-cherry-ribbon`, and `.queue-golden-lily` use `transform: scale(var(--queue-panel-scale, 1))` with `transform-origin: top left`.

- [x] **Step 3: Replace reflow assertions for styles 1–2**

  Require fixed design widths of `405px` and `430px`, fixed list windows of `235px` and `364px`, and remove expectations for `.queue-viewport-resized` width/height overrides.

- [x] **Step 4: Run the focused tests and confirm failure**

  Run `node --experimental-vm-modules --test test/frontend-queue.test.js test/queue-overlay-responsive.test.js test/queue-overlay-esm.test.js`. Expected failures must point to the old illustrated-only scale, the scale cap, or the old style 1–2 reflow rules.

### Task 2: Apply one contain scale to all six styles

**Files:**

- Modify: `public/js/overlays/queue-viewport.js`
- Modify: `public/js/overlays/queue.js`
- Modify: `public/js/overlays/queue-scroll.js`
- Modify: `public/css/overlays/base/foundation-and-classic.css`
- Modify: `public/css/overlays/base/identity.css`
- Modify: `public/css/overlays/base/illustrated.css`
- Modify: `public/css/overlays/base/storybook.css`

**Interfaces:**

- Produces: `calculateQueuePanelScale(viewportWidth, viewportHeight, panelWidth, panelHeight, edge)` returning the smaller positive width/height ratio without an upper cap.
- Produces: `syncQueuePanelViewport(panel)` applying the result as `--queue-panel-scale`.
- Consumes: the panel's untransformed `offsetWidth`/`offsetHeight`, browser-source dimensions, and computed panel margins.

- [x] **Step 1: Generalize the viewport helper**

  Replace the illustrated-only helper with `calculateQueuePanelScale(...)` using `Math.min(availableWidth / panelWidth, availableHeight / panelHeight)`, and make `syncQueuePanelViewport(panel)` always set `--queue-panel-scale`.

- [x] **Step 2: Synchronize after every render and on every source resize**

  Render the selected style first, then measure and scale the completed panel. On `resize`, rescale immediately and keep the existing delayed scroll remeasurement.

- [x] **Step 3: Keep styles 1–2 in stable design coordinates**

  Set classic to `405px` wide with a `235px` list window and identity to `430px` wide with a `364px` list window. Remove viewport-resized reflow selectors, and make scroll setup measure overflow inside those fixed windows.

- [x] **Step 4: Use the shared transform variable in styles 3–6**

  Rename their transform input from `--illustrated-queue-scale` to `--queue-panel-scale`; retain every artwork aspect ratio, inset, row ratio, and typography declaration.

- [x] **Step 5: Run the focused tests**

  Run the three focused test files from Task 1 and require all assertions to pass.

### Task 3: Update the overlay contract and browser cache keys

**Files:**

- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `public/pages/overlays/queue.html`

**Interfaces:**

- Produces: documented six-style scaling behavior and refreshed existing CSS/JavaScript resource URLs.

- [x] **Step 1: Document the design-space contract**

  State that all six styles use one contain scale; arbitrary source ratios preserve artwork/text proportions and leave transparent space on the unconstrained axis.

- [x] **Step 2: Bump the existing queue CSS and JavaScript query versions**

  Change only the cache-key suffixes on `/css/overlays/base.css` and `/js/overlays/queue.js`.

- [x] **Step 3: Verify documentation**

  Run `npm run verify:docs` and require a passing result.

### Task 4: Verify visual proportionality and viewport fit

**Files:**

- Test only; screenshots and diagnostic scripts remain under ignored `tmp/`.

**Interfaces:**

- Consumes: deterministic queue state for all six style values.
- Produces: normalized panel/row/text metrics and reviewed screenshots at multiple source shapes.

- [x] **Step 1: Cover the requested states**

  Render each style at a reference source, a narrow/tall source, and a wide/short source with five dense rows and long identity content.

- [x] **Step 2: Compare normalized geometry**

  For each style, compare child bounds divided by panel bounds across source sizes within a `0.002` rounding tolerance; confirm the effective scale can be above and below `1`.

- [x] **Step 3: Review screenshots independently**

  Check all six reference screenshots plus narrow/tall and wide/short samples for clipped frames, stretched artwork, text drift, overlapping rows, unexpected horizontal page scroll, and hidden bottom content.

- [x] **Step 4: Run final gates and review the diff**

  Run the focused tests, `npm run check`, `npm run verify:quick`, `git diff --check`, relevant `git diff`, and `git status --short`. Do not modify unrelated failures or user changes.

## Done When

- Every style uses a single multiplier for the complete rendered panel.
- Resizing larger or smaller changes images, text, rows, spacing, and clipping windows together.
- Arbitrary source ratios do not stretch either axis; unused space remains transparent.
- All three viewport shapes pass numeric and screenshot checks for all six styles.
- Focused tests and applicable quick gates pass, and the owner documentation matches runtime behavior.

## Execution Results

- Focused queue tests: 42 passed.
- Chromium QA: 18 cases passed across six styles and three browser-source shapes; normalized row/text geometry stayed within `0.002` and no case created horizontal page scrolling or exceeded the source bounds.
- Visual review: all 18 screenshots inspected; no stretched artwork, text drift, row overlap, frame clipping, or hidden panel boundary was found.
- Documentation verification: 5 passed.
- JavaScript syntax check: 429 files passed.
- Architecture verification: 9 passed.
- `npm run verify:quick`: passed.
- `git diff --check`: passed; QA artifacts remained under ignored `tmp/`.
