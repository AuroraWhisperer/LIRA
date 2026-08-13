# Complete Lyric Verification Plan

**Goal:** Verify and lock down that the vertical desktop lyric preview receives and renders the complete real lyric timeline instead of the nine-line visual fixture.

**Architecture:** Keep the existing full-timeline transport. Compare the installed Now Playing API with this project's QQ/NetEase resolver, then add regression coverage at the provider-selection, timeline-normalization, and preview-rendering boundaries. Use the real 《失控》 result for final end-to-end UI verification.

**Tech Stack:** Node.js 24 CommonJS/ES modules, native DOM/CSS, `node:test`, Electron/local HTTP service.

### Task 1: Establish real-data parity

**Files:**
- Modify: `specs/now-playing-wesing_reverse_spec.md`

- [x] Query `http://127.0.0.1:9863/api/lyric` while 《失控》 is active.
- [x] Query this project's QQ provider and WeSing online resolver for the same 255-second track.
- [x] Record the observed 76 raw QRC rows and 64 renderable timeline lines.

### Task 2: Add non-truncation regressions

**Files:**
- Modify: `test/wesing-online-lyrics.test.js`
- Modify: `test/desktop-lyrics.test.js`

- [x] Add a failing candidate-selection test where a nine-line result competes with a complete result of otherwise equal quality.
- [x] Add a timeline test proving more than nine lines survive normalization.
- [x] Implement only the minimum completeness tie-break needed by the failing selection test.
- [x] Run both focused test files.

### Task 3: Match Now Playing automatic lyric motion

**Files:**
- Modify: `public/js/admin/desktop-lyric-preview.js`
- Modify: `public/css/admin/desktop-lyric-preview.css`
- Modify: `test/desktop-lyrics.test.js`

- [x] Add a failing unit test for stable spring interpolation toward a new lyric anchor.
- [x] Replace one-shot native smooth scrolling with a requestAnimationFrame spring controller.
- [x] Keep the current line at a centered reading anchor and animate scale/blur/opacity during transitions.
- [x] Preserve the six-second manual browsing pause and reduced-motion fallback.
- [x] Run the focused desktop lyric tests.

### Task 4: Real 64-line UI verification

**Files:**
- No product-file changes unless the check exposes a defect.

- [x] Start the local service and publish the real 64-line 《失控》 timeline.
- [x] Verify the status reports 64 lines and the DOM contains 64 lyric rows.
- [x] Verify the first credits, first sung line, last line, and 247.5-second endpoint.
- [x] Verify mouse/keyboard scrolling reaches the last row and active-line following does not delete rows.
- [x] Inspect desktop and narrower viewports for clipping and overflow.

### Task 5: Repository verification

- [x] Run `npm run check`.
- [x] Run `npm test`.
- [x] Run `git diff --check` and review the final diff/status.
