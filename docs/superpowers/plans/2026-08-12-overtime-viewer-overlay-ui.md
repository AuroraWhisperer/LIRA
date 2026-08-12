# Overtime Viewer Overlay UI Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current task. No subagent execution skill is available in this session.

**Goal:** Make the `/overtime` broadcast overlay compact and immediately explain which configured gift adds time, removes time, or triggers a blind box.

**Architecture:** Keep the server-authoritative overtime snapshot unchanged and reshape only the overlay's HTML, CSS, and safe DOM rendering. A pure presentation helper converts each enabled rule into an audience-facing verb/value pair, while the overlay groups the clock and configured gift tickets into one centered, responsive broadcast instrument.

**Tech Stack:** Vanilla HTML, CSS container queries, browser DOM APIs, Node.js `node:test`

## Global Constraints

- Preserve the user's existing uncommitted admin overtime editor changes.
- Display only enabled rules already supplied by `state.rules`; do not change persistence or API contracts.
- Fixed positive, negative, and zero rules must be distinguishable; random rules must display `盲盒` rather than `随机`.
- Keep transparent OBS composition, reduced-motion behavior, and the existing `320 × 180` minimum viewport fallback.
- Do not add dependencies or generate a bitmap asset for code-native panel decoration.
- Do not create a Git commit unless the user asks for one.

---

### Task 1: Audience-Facing Rule Presentation

**Files:**
- Modify: `test/overtime-overlay.test.js`
- Modify: `public/pages/overlays/overtime.html`
- Modify: `public/js/overlays/overtime.js`

**Interfaces:**
- Consumes: snapshot rules shaped as `{ giftId, giftName, imagePath, mode, fixedSeconds, enabled }`.
- Produces: `describeRuleEffect(rule) -> { modifier, verb, value }` and safe DOM nodes for gift name plus effect.

- [x] **Step 1: Write the failing regression test**

```js
test('overtime overlay explains configured gift effects to viewers', () => {
  const html = read('public/pages/overlays/overtime.html');
  const source = read('public/js/overlays/overtime.js');

  assert.match(html, /id="overtimeGiftGuide"/);
  assert.match(html, /送礼加班表/);
  assert.match(source, /time\.textContent = presentation\.value/);
  assert.doesNotMatch(source, /rule\.mode === 'random' \? '随机'/);

  const helperStart = source.indexOf('function describeRuleEffect');
  const helperEnd = source.indexOf('\nfunction formatSignedSeconds', helperStart);
  const sandbox = {};
  vm.runInNewContext(
    `${source.slice(helperStart, helperEnd)}\nthis.describeRuleEffect = describeRuleEffect;`,
    sandbox
  );
  assert.equal(sandbox.describeRuleEffect({ mode: 'random' }).value, '盲盒');
  assert.equal(sandbox.describeRuleEffect({ mode: 'fixed', fixedSeconds: 300 }).verb, '加时');
  assert.equal(sandbox.describeRuleEffect({ mode: 'fixed', fixedSeconds: -90 }).value, '1分30秒');
});
```

- [x] **Step 2: Run the focused test and verify the new expectation fails**

Run: `node --test test/overtime-overlay.test.js`

Expected: FAIL because the gift guide and `describeRuleEffect` do not exist yet.

- [x] **Step 3: Add the viewer guide and semantic rule rendering**

Add a `送礼加班表` heading around the ticket grid. In `renderTickets()`, create separate gift-name, effect-verb, and effect-value nodes with `textContent`, using `describeRuleEffect()` for `加时`, `减时`, `时间不变`, and `盲盒` output. Hide the guide when no enabled rule is configured and bump the overlay asset query versions.

- [x] **Step 4: Re-run the focused test**

Run: `node --test test/overtime-overlay.test.js`

Expected: PASS.

### Task 2: Compact Broadcast-Instrument Styling

**Files:**
- Modify: `test/overtime-overlay.test.js`
- Modify: `public/css/overlays/overtime.css`

**Interfaces:**
- Consumes: `.overtime-gift-guide`, `.overtime-guide-heading`, `.overtime-ticket-effect`, and the `is-positive`, `is-negative`, `is-random`, `is-neutral` modifiers from Task 1.
- Produces: a centered clock housing and a wrapping ticket rail that remains legible with one through eight enabled rules.

- [x] **Step 1: Extend the structural regression assertions**

```js
assert.match(css, /\.overtime-gift-guide/);
assert.match(css, /\.overtime-ticket-effect/);
assert.match(css, /\.overtime-ticket\.is-positive/);
assert.match(css, /\.overtime-ticket\.is-negative/);
assert.match(css, /\.overtime-ticket\.is-random/);
assert.match(css, /grid-template-columns:\s*repeat\(auto-fit/);
```

- [x] **Step 2: Implement the compact visual system**

Center the foreground as a content-sized group; give the clock a translucent high-contrast instrument housing; cap a single gift guide at ticket width; wrap denser guides using `auto-fit`; and apply teal, coral, neutral, and gold result strips. Preserve the current container-query and reduced-motion fallbacks, with the smallest-height mode hiding only secondary copy required to fit eight rules.

- [x] **Step 3: Run static validation and focused tests**

Run: `npm run check`

Run: `node --test test/overtime-overlay.test.js`

Expected: both commands PASS.

- [x] **Step 4: Run visual QA in representative states**

Render fixed positive, fixed negative, random, and zero rules at `1340 × 420`, then check the dense eight-rule state at `640 × 360` and the minimum `320 × 180` state. Verify gift names/effects are visible in normal preview sizes, the random rule says `盲盒`, one rule does not stretch across the canvas, and there is no clipping or page scrolling.

- [x] **Step 5: Run the repository verification suite**

Run: `npm run check && npm test`

Expected: PASS with no new failures.

---

## Self-Review

- Spec coverage: the plan covers gift names, fixed add/subtract effects, blind-box wording, compact layout, transparent OBS compatibility, and visual packaging.
- Placeholder scan: no deferred implementation or unspecified validation steps remain.
- Type consistency: `describeRuleEffect()` consumes the existing serialized rule fields and produces only the modifier/verb/value fields used by the overlay renderer.
