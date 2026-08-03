# Identity Row Unified Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each identity queue row as one continuous inline stream and scroll the complete stream together when it overflows.

**Architecture:** Replace the separate song and requester viewports with one `.identity-content-wrapper` containing an intrinsic-width `.identity-content` strip. Keep the existing four content parts in order: song, requester, guard badge, and medal level. Schedule one marquee against the unified strip, preserving reduced-motion behavior and relative badge sizing.

**Tech Stack:** Browser HTML/CSS, vanilla JavaScript, Node.js `node:test`

## Global Constraints

- Keep the existing identity colors, type scale, row height, index behavior, and content order.
- Scroll song and requester identity as one strip; do not add independent region animations.
- Keep the badge and medal at 60% of the row font size with relative geometry.
- Do not add dependencies or settings.
- Match the repository's two-space JavaScript indentation, semicolons, single quotes, and ASCII edits where possible.

---

### Task 1: Replace split row markup with one content stream

**Files:**
- Modify: `public/js/overlays/queue.js:554-580`
- Modify: `public/css/overlays/base.css:408-530`
- Modify: `test/frontend-regressions.test.js:827-880`

**Interfaces:**
- Consumes: `renderIdentityRow(item, index, showIndex)` and the existing identity fields.
- Produces: `.identity-content-wrapper` as the only identity marquee viewport and `.identity-content` as its intrinsic-width strip.

- [x] **Step 1: Update the regression contract**

Assert the rendered row contains one content wrapper and strip with all four fields in sequence, and no separate song/details wrappers:

```js
assert.match(row, /identity-content-wrapper[\\s\\S]*identity-content[\\s\\S]*identity-song[\\s\\S]*identity-requester[\\s\\S]*identity-badge[\\s\\S]*identity-medal/);
assert.doesNotMatch(row, /identity-song-wrapper|identity-details-wrapper|identity-details/);
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --experimental-vm-modules --test --test-concurrency=1 test/frontend-regressions.test.js`

Expected: FAIL because the current renderer still emits separate song and details wrappers.

- [x] **Step 3: Render a single inline strip**

Change `renderIdentityRow` to emit the index followed by one clipped wrapper. Keep the fields adjacent inside the strip and use a small inline gap:

```js
<span class="identity-content-wrapper">
  <span class="identity-content">
    <span class="identity-song">${fullSongText}</span>
    <span class="identity-requester">${escapeHtml(item.requester_name || '观众')}</span>
    ${identityText ? `<span class="identity-badge ${identityClass}">${escapeHtml(identityText)}</span>` : ''}
    ${medalLevel > 0 ? `<span class="identity-medal">${medalLevel}</span>` : ''}
  </span>
</span>
```

- [x] **Step 4: Make the wrapper and strip continuous**

Replace the split viewport rules with a flexible wrapper (`flex: 1 1 auto`, `min-width: 0`, `overflow: hidden`) and an intrinsic inline-flex strip (`min-width: max-content`, `display: inline-flex`, `align-items: center`, `gap: 0.3em`, `white-space: nowrap`). Keep the row's existing song and requester colors.

- [x] **Step 5: Run the focused test and verify structure**

Run: `node --experimental-vm-modules --test --test-concurrency=1 test/frontend-regressions.test.js`

Expected: the unified markup and CSS assertions pass; old independent-region assertions are updated to the new contract.

### Task 2: Animate the complete identity stream as one marquee

**Files:**
- Modify: `public/js/overlays/queue.js:220-340, 590-640`
- Modify: `test/frontend-regressions.test.js:782-895`

**Interfaces:**
- Consumes: `.identity-content-wrapper` containing `.identity-content`.
- Produces: `scheduleIdentityContentScroll(content)`, which animates only overflowing complete strips.

- [x] **Step 1: Add the unified overflow test**

Create one overflowing wrapper/strip and one fitting wrapper/strip. Assert the overflowing strip animates by `strip.scrollWidth - wrapper.clientWidth`, while the fitting strip does not:

```js
sandbox.scheduleIdentityContentScroll({ querySelectorAll: () => containers });
assert.ok(longAnimation);
assert.deepEqual(
  Array.from(longAnimation.keyframes, (frame) => frame.transform),
  ['translateX(0)', 'translateX(0)', 'translateX(-200px)', 'translateX(-200px)', 'translateX(0)']
);
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --experimental-vm-modules --test --test-concurrency=1 test/frontend-regressions.test.js`

Expected: FAIL because the new scheduler does not exist and the renderer still calls the two old schedulers.

- [x] **Step 3: Implement one overflow scheduler**

Measure each `.identity-content-wrapper` and its `.identity-content`, skip reduced motion, skip fitting strips, and animate the strip from zero to the negative overflow distance, pause, then return. Use the existing `prefersReducedMotion()` helper and animation timing pattern.

- [x] **Step 4: Schedule the unified marquee once**

In identity queue rendering, replace `scheduleIdentitySongScroll(content)` and `scheduleIdentityDetailsScroll(content)` with `scheduleIdentityContentScroll(content)`. Remove obsolete independent scheduler functions and selectors if no other caller remains.

- [x] **Step 5: Verify the full repository**

Run: `npm run check` and `npm test`.

Expected: syntax checks pass and all tests pass, including the unified overflow behavior.

### Task 3: Review the visual and diff contracts

**Files:**
- Review: `public/css/overlays/base.css`
- Review: `public/js/overlays/queue.js`
- Review: `test/frontend-regressions.test.js`
- Review: `docs/superpowers/plans/2026-08-03-identity-row-unified-scroll.md`

- [x] **Step 1: Check the CSS contract**

Confirm the content wrapper is the only clipped identity region, the strip uses intrinsic width, no field has its own overflow/ellipsis rule, and badge/medal sizing remains `font-size: 60%` with `em` geometry.

- [x] **Step 2: Check reduced motion and no-content states**

Confirm the scheduler exits cleanly for missing elements, fitting content, and reduced-motion users, while empty queues keep their existing rendering.

- [x] **Step 3: Run final whitespace and diff checks**

Run: `git diff --check` and `git diff -- public/js/overlays/queue.js public/css/overlays/base.css test/frontend-regressions.test.js docs/superpowers/plans/2026-08-03-identity-row-unified-scroll.md`.

Expected: no whitespace errors and every changed runtime line supports the unified inline stream requirement.
