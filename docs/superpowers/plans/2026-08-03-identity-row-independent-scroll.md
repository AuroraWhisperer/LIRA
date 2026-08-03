# Identity Row Independent Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the song name and requester identity in separate clipped regions, with independent horizontal scrolling when either region overflows.

**Architecture:** Preserve the existing identity queue row and song marquee. Wrap requester name, guard badge, and medal level in one right-aligned overflow viewport, then animate only that viewport's inner strip when needed. CSS flex sizing keeps the song region flexible while capping the identity region so neither can paint over the other.

**Tech Stack:** Browser HTML/CSS, vanilla JavaScript, Node.js `node:test`

## Global Constraints

- Keep the existing identity colors, typography, row height, and content order.
- Keep song-name scrolling independent from requester identity scrolling.
- Do not add dependencies or settings.
- Match the repository's two-space JavaScript indentation, semicolons, and single quotes.

---

### Task 1: Define the two-region row contract

**Files:**
- Modify: `test/frontend-regressions.test.js`
- Modify: `public/js/overlays/queue.js`
- Modify: `public/css/overlays/base.css`

**Interfaces:**
- Consumes: `renderIdentityRow(item, index, showIndex)` and the existing `.identity-song-wrapper` viewport.
- Produces: `.identity-details-wrapper`, `.identity-details`, and `scheduleIdentityDetailsScroll(content)`.

- [ ] **Step 1: Write the failing markup and CSS regression assertions**

Add assertions that the rendered identity row groups the requester and both badges inside a dedicated viewport, and that the styles remove the old fixed translation while clipping the two regions independently:

```js
const row = sandbox.renderIdentityRow({
  song_name: '米粒bb万岁万万岁',
  requester_name: '很长的点歌人',
  requester_guard_level: 2,
  requester_medal_name: '灯牌',
  requester_medal_level: 26
}, 0);
assert.match(row, /identity-details-wrapper/);
assert.match(row, /identity-details/);
assert.doesNotMatch(overlayStyles, /\.identity-requester\s*\{[^}]*translateX/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --experimental-vm-modules --test --test-concurrency=1 test/frontend-regressions.test.js`

Expected: FAIL because the details wrapper and independent details marquee do not exist and the requester still has `translateX(-52px)`.

- [ ] **Step 3: Group the right-side identity fields**

Change `renderIdentityRow` so its right-side fields are siblings inside a clipped viewport:

```js
<span class="identity-details-wrapper">
  <span class="identity-details">
    <span class="identity-requester">...</span>
    ...guard badge...
    ...medal level...
  </span>
</span>
```

Call `scheduleIdentityDetailsScroll(content)` after `scheduleIdentitySongScroll(content)` in `renderIdentityQueue`.

- [ ] **Step 4: Separate the CSS sizing responsibilities**

Keep `.identity-song-wrapper` as `flex: 1 1 auto; min-width: 0; overflow: hidden`. Add a right-side viewport with `flex: 0 1 auto`, a percentage `max-width`, `min-width: 0`, and `overflow: hidden`. Make `.identity-details` an intrinsic-width inline flex strip and remove the requester's fixed translation and per-field ellipsis.

- [ ] **Step 5: Run the focused test and verify the structure passes**

Run: `node --experimental-vm-modules --test --test-concurrency=1 test/frontend-regressions.test.js`

Expected: PASS.

### Task 2: Add independent identity overflow motion

**Files:**
- Modify: `test/frontend-regressions.test.js`
- Modify: `public/js/overlays/queue.js`

**Interfaces:**
- Consumes: `.identity-details-wrapper` containing `.identity-details`.
- Produces: `scheduleIdentityDetailsScroll(content)`, which animates only overflowing identity strips.

- [ ] **Step 1: Write the failing overflow behavior test**

Create one overflowing and one fitting details viewport. Assert that only the overflowing strip animates and that its travel distance equals `text.scrollWidth - container.clientWidth`:

```js
sandbox.scheduleIdentityDetailsScroll({ querySelectorAll: () => containers });
assert.equal(longAnimation.keyframes[1].transform, 'translateX(-200px)');
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --experimental-vm-modules --test --test-concurrency=1 test/frontend-regressions.test.js`

Expected: FAIL because `scheduleIdentityDetailsScroll` is not defined.

- [ ] **Step 3: Implement the independent details marquee**

Measure each `.identity-details` strip against its `.identity-details-wrapper`. When overflow exceeds one pixel and reduced motion is not requested, animate from `translateX(0)` to the negative overflow distance, pause, and return. Do not query or mutate `.identity-song` from this function.

- [ ] **Step 4: Run repository verification**

Run: `npm run check`

Expected: all JavaScript syntax checks pass.

Run: `npm test`

Expected: the complete serial test suite passes.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check` and `git diff -- public/js/overlays/queue.js public/css/overlays/base.css test/frontend-regressions.test.js docs/superpowers/plans/2026-08-03-identity-row-independent-scroll.md`.

Expected: no whitespace errors; every changed runtime line supports the two independent overflow regions.

### Task 3: Scale guard and medal blocks with the queue font setting

**Files:**
- Modify: `test/frontend-regressions.test.js`
- Modify: `public/css/overlays/base.css`

**Interfaces:**
- Consumes: the inherited `--identity-queue-font-size` applied by `.identity-row`.
- Produces: guard and medal blocks whose text and geometry scale with `identityQueueFontSize`.

- [ ] **Step 1: Write the failing shared-size regression assertions**

Extract the combined `.identity-badge, .identity-medal` rule and assert that it inherits the row font size while its height, horizontal padding, and corner radius use relative units. Extract `.identity-medal` and assert that its minimum width is relative and the old fixed maximum width is absent:

```js
assert.match(identityBlockRule, /font-size:\s*inherit/);
assert.match(identityBlockRule, /height:\s*max\(16px,\s*1\.15em\)/);
assert.match(identityBlockRule, /padding:\s*0\s+0\.24em/);
assert.match(medalRule, /min-width:\s*1\.45em/);
assert.doesNotMatch(medalRule, /max-width/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --experimental-vm-modules --test --test-concurrency=1 test/frontend-regressions.test.js`

Expected: FAIL because the current blocks use a fixed `16px` height, `4px` padding, `4px` radius, `11px`-based font size, and fixed medal width limits.

- [ ] **Step 3: Replace fixed badge geometry with inherited and relative sizing**

Keep the existing colors and weights. Set the shared block rule to `font-size: inherit`, `height: max(16px, 1.15em)`, `padding: 0 0.24em`, and `border-radius: max(3px, 0.15em)`. Set the medal minimum width to `1.45em` and remove its fixed maximum width.

- [ ] **Step 4: Verify supported font-size extremes and the full repository**

Use Electron computed layout checks at `9px`, `26px`, and `78px` to confirm each block fits inside the row height and grows monotonically. Then run `npm run check`, `npm test`, and `git diff --check`.

Expected: all three rendered sizes fit, all syntax checks pass, and the complete serial test suite passes.
