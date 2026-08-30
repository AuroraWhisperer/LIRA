# Opening Animation Motion Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Complete (2026-08-23)

**Goal:** Make the `/opening` Browser Source animation feel continuous and calm by removing the white waveform sweep, reducing stacked character motion and brightness pulses, and eliminating visible loop resets in ambient effects.

**Architecture:** Keep the existing semantic scene, transform-wrapper ownership, fixed `/opening` route, query/settings contract, and quality modes. Make the minimum motion changes in the overlay CSS plus the existing SVG motion duration, with static regression assertions in the focused opening-overlay test.

**Tech Stack:** Vanilla JavaScript ES modules, native CSS animations, inline SVG/SMIL, `node:test`, Electron/Chromium Browser Source.

## Global Constraints

- Preserve the explicit `/opening` page URL, response headers, API/settings keys, audio behavior, and fixed 16:9 composition.
- Preserve the existing character transform-wrapper separation: enter, float, sway, and breathe each own one transform animation.
- Prefer `transform` and `opacity`; do not add a runtime dependency, build step, canvas loop, or unbounded JavaScript scheduler.
- Keep reduced-motion and low-quality modes functional and avoid compressing the character when motion is disabled.
- Do not modify or clean up unrelated worktree changes.
- Do not create a commit unless the user explicitly requests one.

---

## Non-goals

- No layout, typography, palette, copy, route, settings, upload, or audio changes.
- No live FFT/audio-reactive animation and no new animation controls.
- No replacement of the character artwork or waveform path.

## Current Behavior

- `.track::before` renders a 13%-wide near-white gradient over the waveform and moves it from `-9.375cqw` to `39.583cqw` every 5.6 seconds, producing the reported white bar.
- Character motion stacks a `-1.25cqw` float, `1.3deg` total sway, `scale(1.04)` breathe, a large aura pulse from `.32` to `.66` opacity, and a separate microphone glint.
- Note opacity remains non-zero at the loop boundary, making a reset capable of appearing as a jump.
- Reduced-motion rules apply `scaleY(.72)` to the same combined selector as EQ bars, which can vertically compress character wrappers.

## Ownership

- Owner: `public/pages/overlays/opening.html`, `public/css/overlays/opening.css`, and `public/js/overlays/opening.js` under `ROUTE-OVERLAYS`.
- Contract: `docs/architecture/frontend/overlays.md` and the implemented runtime portions of `specs/opening-overlay_design.md`.
- Consumer: Bilibili Live Companion/OBS Browser Source and the Admin opening-animation preview iframe.
- Focused test: `test/opening-overlay.test.js`.

## Proposed Files

- Modify `test/opening-overlay.test.js`: replace the old large-float assertion with regression checks for the removed sweep/glint, restrained character amplitudes, invisible ambient loop boundaries, paused pseudo-elements, and non-compressing reduced motion.
- Modify `public/css/overlays/opening.css`: remove the waveform sweep and microphone flash; reduce character, aura, glow, note, particle, EQ, and heartbeat amplitudes; smooth visibility/loop boundaries; correct pause and reduced-motion selectors.
- Modify `public/pages/overlays/opening.html`: slow the existing heart path traversal so its CSS visibility cycle stays synchronized with the calmer motion.
- Update this plan with verification evidence and move it to `specs/plans/archive/` only after all Done When conditions pass.

### Task 1: Add focused motion regressions

**Files:**

- Modify: `test/opening-overlay.test.js`
- Test: `test/opening-overlay.test.js`

**Interfaces:**

- Consumes: the current opening scene CSS and HTML as text fixtures.
- Produces: assertions that define the visual defect boundaries without changing runtime contracts.

- [x] **Step 1: Replace the old float-amplitude assertion with exact defect checks**

```js
assert.doesNotMatch(css, /\.track::before\s*\{/);
assert.doesNotMatch(css, /@keyframes\s+track-glint/);
assert.doesNotMatch(css, /mic-glint/);
assert.match(css, /@keyframes\s+character-float[^\n]*-\.45cqw/);
assert.match(css, /@keyframes\s+character-breathe[^\n]*scale\(1\.008\)/);
assert.match(
  css,
  /@keyframes\s+note-drift[^\n]*0%,\s*100%\s*\{\s*opacity:\s*0/,
);
assert.match(css, /\.opening-stage\.is-paused\s+\*::before/);
assert.match(
  css,
  /\.opening-stage\.is-reduced-motion\s+\.character-float[^\{]*\{[^}]*transform:\s*none/,
);
assert.match(html, /<animateMotion dur="7\.2s"/);
```

- [x] **Step 2: Run the focused test and confirm the new assertions fail against the current animation**

Run: `node --test test/opening-overlay.test.js`

Expected: FAIL on the retained track sweep, large character amplitude, microphone flash, note loop boundary, and old 5.6-second heart traversal.

### Task 2: Restrain and synchronize the scene motion

**Files:**

- Modify: `public/css/overlays/opening.css`
- Modify: `public/pages/overlays/opening.html`
- Test: `test/opening-overlay.test.js`

**Interfaces:**

- Consumes: existing class names and the `#openingTrackPath` SMIL motion path.
- Produces: the same `/opening` DOM/query contract with calmer CSS/SMIL timing.

- [x] **Step 1: Remove the broad waveform sweep and microphone flash**

Delete the `.track::before` rule, `@keyframes track-glint`, `.character-breathe::after`, and `@keyframes mic-glint`, then remove those selectors from low-quality and reduced-motion groups. The moving gold heart remains the waveform's only traveling highlight.

- [x] **Step 2: Reduce stacked character and light amplitudes**

Use `-.45cqw` for the float apex, `±.08cqw/±.22deg` for sway, `scale(1.008)` for breathe, and a slower low-contrast aura/glow range. Set `transform-origin: 50% 100%` on the breathe wrapper so the feet remain visually anchored.

- [x] **Step 3: Make ambient loops join while invisible**

Make note and particle endpoints `opacity: 0` while holding their end position before the loop reset. Reduce EQ and heartbeat peaks so they read as ambience rather than repeated attention cues.

- [x] **Step 4: Synchronize heart motion and visibility at 7.2 seconds**

Change the SVG `animateMotion` duration to `7.2s` and match `.track-heart-motion` to the same duration, with gradual fade-in and fade-out windows around the held endpoints.

- [x] **Step 5: Correct lifecycle and reduced-motion behavior**

Pause descendant pseudo-elements with the rest of the scene. Separate character wrappers (`transform: none`) from the static EQ fallback (`scaleY(.72)`) so reduced motion never compresses the artwork.

- [x] **Step 6: Run focused verification**

Run: `node --test test/opening-overlay.test.js`

Expected: 5 tests pass.

### Task 3: Visual and repository verification

**Files:**

- Review: `public/css/overlays/opening.css`
- Review: `public/pages/overlays/opening.html`
- Review: `test/opening-overlay.test.js`
- Update/archive: `specs/plans/2026-08-23-opening-animation-motion-polish.md`

**Interfaces:**

- Consumes: the polished overlay at `http://127.0.0.1:3000/opening?enabled=1&audio=none`.
- Produces: visual QA evidence and a reviewed task-scoped diff.

- [x] **Step 1: Capture several animation timestamps at 1920×1080**

Confirm no broad white strip appears over the waveform, the character remains anchored, no brightness flash crosses the artwork, and notes/particles do not visibly jump at loop boundaries.

- [x] **Step 2: Run repository gates**

Run: `npm run check`

Run: `npm run verify:quick`

Expected: both commands pass.

- [x] **Step 3: Review the final diff and worktree**

Run: `git diff --check`

Run: `git diff -- public/css/overlays/opening.css public/pages/overlays/opening.html test/opening-overlay.test.js specs/plans/2026-08-23-opening-animation-motion-polish.md`

Run: `git status --short`

Expected: no whitespace errors; opening-animation changes are scoped to the listed files; unrelated pre-existing worktree changes remain untouched.

## Verification Results

- `node --test test/opening-overlay.test.js`: 5/5 passed after the new assertions first reproduced the old sweep/amplitude behavior.
- 1920×1080 Chromium sampling at 1, 3, 6, 8, and 12 seconds: no track sweep pseudo-element, no console/page errors, full stage fit, character float stayed within about 8px, breathe stayed below 0.8%, and aura opacity stayed within 0.28–0.38.
- Exploratory reduced-motion check found the background glow was still animated; the task was expanded narrowly to stop it at opacity 0.74. Final reduced-motion sampling showed no character transforms, no moving heart, and a static glow.
- Low-quality sampling hid notes, particles, and EQ and stopped the heart animation as expected.
- `npm.cmd run check`: passed for 427 JavaScript files.
- `npm.cmd run verify:quick`: governance 5/5, syntax check, and architecture 9/9 passed.
- `git diff --check`: passed; existing line-ending warnings and unrelated dirty worktree files were not changed or cleaned up.

## Rollback Or Failure Handling

If visual QA regresses the existing composition, inspect and reverse only the task-owned hunks in the three opening files and this plan. Do not use a blanket checkout, destructive reset, or broad deletion, and do not alter unrelated dirty files.

## Done When

- The waveform has no broad white sweep; only the small gold heart travels along it.
- Character breathing is a subtle bottom-anchored scale with restrained float/sway and no separate microphone flash.
- Glow, aura, notes, particles, EQ, and heartbeat have gentle amplitudes and invisible loop joins.
- Pausing/reduced-motion works without moving pseudo-elements or vertically compressing the character.
- Focused tests, JavaScript check, quick verification, and diff checks pass.
- The visual result is inspected at multiple animation timestamps in a 1920×1080 Chromium surface.
- No unrelated files are changed or cleaned up.
