# Song Board Styles 3–6 Horizontal Scroll Implementation Plan

> **For agentic workers:** Execute this plan inline in the current session. Do not dispatch subagents because the user did not request delegation.

**Goal:** Make point-song board styles 3–6 show the complete left edge at the start and the complete right edge at the end of horizontal overflow motion, without leaving a large blank region.

**Status:** Completed. Task-focused gates and visual QA pass; the unrelated full-suite failure is recorded under Verification Results.

**Architecture:** Keep the existing queue renderer and Web Animations API path. Correct the owned horizontal-scroll setup so its animation endpoints use the viewport's real visible boundaries even when a theme centers fitting content, then lock the behavior with focused unit and browser-layout checks.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS, Web Animations API, `node:test`, Playwright with Chromium/Electron-compatible rendering.

## Global Constraints

- Preserve `/queue`, settings keys, snapshot shapes, queue ordering, vertical scrolling, and styles 1–2.
- Preserve the existing uncommitted font-size and unrelated working-tree changes.
- Keep short content centered according to each illustrated theme; only overflowing content changes alignment or endpoints.
- Do not add dependencies, processes, ports, or persisted settings.
- Do not create a commit unless the user explicitly requests one.

---

## Scope Map

- Modify `public/js/overlays/queue-scroll.js`: own horizontal overflow detection and animation endpoint setup.
- Modify `public/css/overlays/base/illustrated.css` only if an overflow-state class is required to preserve centered short content while start-aligning long content.
- Modify `test/frontend-queue.test.js`: cover start/end transforms, non-overflow behavior, and the style 3–6 selector path.
- Update `docs/architecture/frontend/overlays.md` only if the documented animation contract needs clarification.
- Create temporary QA output only under `tmp/`; do not commit it.

### Task 1: Reproduce and measure the defect

**Files:**

- Inspect: `public/js/overlays/queue-scroll.js`
- Inspect: `public/css/overlays/base/{storybook,illustrated,neon-vinyl,cherry-ribbon,golden-lily}.css`
- QA: `tmp/inspect-illustrated-horizontal-scroll.cjs`

**Interfaces:**

- Consumes: rendered `.identity-content-wrapper` viewport and `.identity-content` stream geometry.
- Produces: measured left/right offsets and animation endpoints for `storybook`, `neon-vinyl`, `cherry-ribbon`, and `golden-lily`.

- [x] Run the illustrated queue through a long song/requester/identity row at the fixed 560px design canvas.
- [x] Record `container.left/right`, `text.left/right`, `clientWidth`, `scrollWidth`, and Web Animation keyframes before changing product code.
- [x] Verify the observed style 4 failure is caused by endpoint math or theme alignment, and check whether styles 3, 5, and 6 share the same risk.

Discovery: current Chromium start-aligns illustrated overflow, but the shared algorithm assumed that behavior instead of measuring it. A centered overflow baseline reproduces the reported defect exactly: the leading edge begins clipped and the same width becomes blank at the trailing endpoint. Styles 3–6 all share this algorithm, so the correction belongs in `queue-scroll.js`.

### Task 2: Add the focused failing regression

**Files:**

- Modify: `test/frontend-queue.test.js`

**Interfaces:**

- Consumes: `scheduleIdentityContentScroll(content)`.
- Produces: a regression that requires the first animation frame to expose the content's left edge and the far frame to expose its right edge, while fitting text does not animate.

- [x] Extend the horizontal-scroll test fixture with the alignment state or element geometry proven by Task 1.
- [x] Assert exact transform endpoints and one-second pauses at both ends.
- [x] Run `node --experimental-vm-modules --test test/frontend-queue.test.js` and confirm the new assertion fails against the reproduced bug.

### Task 3: Implement the minimal endpoint correction

**Files:**

- Modify: `public/js/overlays/queue-scroll.js`
- Modify if required: `public/css/overlays/base/illustrated.css`

**Interfaces:**

- Consumes: actual overflow distance and the existing `text.animate(keyframes, options)` call.
- Produces: a two-ended bounce whose left endpoint has no clipped leading content and whose right endpoint has no trailing blank space.

- [x] Normalize only overflowing illustrated/identity content to the measured left boundary, or calculate transforms from the measured element and viewport rectangles.
- [x] Preserve fitting-content centering and `prefers-reduced-motion` behavior.
- [x] Run `node --experimental-vm-modules --test test/frontend-queue.test.js test/queue-overlay-responsive.test.js test/queue-overlay-esm.test.js` and require all tests to pass.

### Task 4: Browser and desktop-compatible visual QA

**Files:**

- QA output: `tmp/illustrated-horizontal-scroll-qa/`

**Interfaces:**

- Consumes: real Chromium layout and animation timing used by Electron renderers and OBS browser sources.
- Produces: screenshots and numeric fit checks for styles 3–6 at the left and right endpoints.

- [x] Check each style at the 560px design canvas and one width-limited viewport.
- [x] Capture the initial/left endpoint and far/right endpoint with deliberately overflowing content.
- [x] Confirm no document-level horizontal scroll, no clipped leading/trailing glyphs at endpoints, no large blank tail, and no changes to vertical card placement.
- [x] Complete an exploratory pass with short text, long text, missing badges, and maximum-density fields.

### Task 5: Final verification and review

**Files:**

- Review only the task-owned diff plus pre-existing modifications in overlapping files.

**Interfaces:**

- Consumes: focused test and QA results.
- Produces: a reviewed, uncommitted working-tree change ready for the user.

- [x] Run `npm run check` and `npm run verify:quick`.
- [x] Run `git diff --check`, scoped `git diff`, and `git status --short`.
- [x] Confirm every new changed line traces to this defect and no temporary QA output is staged.

## Verification Results

- PASS: 42 focused tests across `frontend-queue`, `queue-overlay-responsive`, and `queue-overlay-esm`.
- PASS: repository illustrated-queue Chromium regression at reference, width-limited, and height-limited viewports.
- PASS: horizontal endpoint QA for styles 3–6 at reference and 400px width-limited viewports; left-edge error was `0`, right-edge rounding stayed below `1px`, and no case introduced document-level horizontal scrolling.
- PASS: `npm run check`, `npm run verify:quick`, scoped `git diff --check`, and scoped diff review.
- KNOWN UNRELATED FAILURE: full `npm test` has one failing assertion in `test/frontend-song-board.test.js:235`; it expects `scrollSecondsRange` to have exactly `class="parameter-range"`, while the separate uncommitted parameter-range variant work adds `parameter-range--tempo`. This task does not modify that page or test.

## Rollback Or Failure Handling

If the measured defect differs from the plan, record the discovery here before changing scope. Reverse only task-owned hunks with `apply_patch`; do not use reset, checkout, or broad deletion, and preserve all pre-existing changes in overlapping files.

## Done When

- Styles 3–6 expose their full leftmost content at one endpoint and full rightmost content at the other.
- Fitting content keeps its intended centered presentation and does not animate.
- Vertical scrolling, queue data, settings, and styles 1–2 remain unchanged.
- Focused tests, syntax checks, quick verification, visual checks, diff checks, and status review pass.
