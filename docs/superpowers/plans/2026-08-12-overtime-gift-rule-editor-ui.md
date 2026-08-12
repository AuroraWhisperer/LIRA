# Overtime Gift Rule Editor UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overtime gift rule's signed-clock and blind-box textarea syntax with plain-language controls that a novice can configure without memorizing formats.

**Architecture:** Keep the existing `/api/overtime/rules` payload and server validation unchanged. Build accessible DOM controls inside each rule card, then translate the selected direction and hour/minute/second fields back to `fixedSeconds` or `{ seconds, weight }[]` only when saving. Recalculate displayed blind-box probabilities from weights in the browser without persisting derived percentages.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js `node:test` regression tests.

## Global Constraints

- Preserve the user's current uncommitted initial-duration, navigation-copy, overlay-style, and regression-test changes.
- Keep rule modes as `fixed` and `random`; keep the existing `/api/overtime/rules` contract.
- Keep fixed and random outcome durations within the server's existing signed 24-hour limit.
- Keep blind boxes at 2–10 outcomes, weight each outcome with a positive integer, and cap total weight at `100000`.
- Keep the maximum of 8 enabled gift rules.
- Do not add dependencies or commit changes unless the user requests a commit.

---

### Task 1: Lock the novice-facing rule editor contract

**Files:**
- Modify: `test/frontend-regressions.test.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `public/js/admin/overtime.js` and `public/css/admin/overtime.css` as source text.
- Produces: regression assertions for structured time fields, mode choices, dynamic blind-box rows, probability copy, and removal of the textarea syntax.

- [x] **Step 1: Write the failing test**

```js
test('overtime gift rules use novice-friendly structured controls', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'overtime.css'), 'utf8');

  assert.match(source, /data-rule-direction/);
  assert.match(source, /data-duration-hours/);
  assert.match(source, /data-duration-minutes/);
  assert.match(source, /data-duration-seconds/);
  assert.match(source, /data-random-outcome/);
  assert.match(source, /data-add-outcome/);
  assert.match(source, /不用凑到 100/);
  assert.match(source, /function updateOutcomeProbabilities/);
  assert.doesNotMatch(source, /createElement\('textarea'\)/);
  assert.match(styles, /\.overtime-rule-mode-options/);
  assert.match(styles, /\.overtime-outcome-card/);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --experimental-vm-modules --test --test-name-pattern="overtime gift rules" test/frontend-regressions.test.js`

Expected: FAIL because the current editor still creates one text input or textarea containing signed clock syntax.

### Task 2: Build structured fixed and blind-box controls

**Files:**
- Modify: `public/js/admin/overtime.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: persisted rules shaped as `{ mode: 'fixed', fixedSeconds }` or `{ mode: 'random', outcomes: Array<{ seconds, weight }> }`.
- Produces: `createDirectionControl(value, scopeName)`, `createDurationControl(seconds)`, `readSignedDuration(root)`, `createOutcomeCard(outcome, index)`, `refreshOutcomeCards(root)`, and `updateOutcomeProbabilities(root)`.

- [x] **Step 1: Replace the mode select with two readable radio choices**

Create two connected options whose labels are `直接增加或减少时间` and `随机抽一个结果（盲盒）`. Mark the checked radio with `data-rule-mode`, rerender only the effect area on change, and keep the rule dirty state handled by the existing delegated `change` listener.

- [x] **Step 2: Implement reusable signed-duration controls**

```js
function readSignedDuration(root) {
  const direction = root.querySelector('[data-rule-direction]:checked').value;
  const hours = readDurationPart(root, 'hours', 0, 24);
  const minutes = readDurationPart(root, 'minutes', 0, 59);
  const seconds = readDurationPart(root, 'seconds', 0, 59);
  const absoluteSeconds = hours * 3600 + minutes * 60 + seconds;
  return direction === 'subtract' ? -absoluteSeconds : absoluteSeconds;
}
```

Render a compact `增加时间` / `减少时间` choice followed by numeric fields explicitly labeled `小时`, `分钟`, and `秒`. A persisted negative value preselects subtraction; zero defaults to addition.

- [x] **Step 3: Implement readable blind-box outcome cards**

Each result card contains its result number, the signed-duration controls, a positive integer `抽中机会` input, a derived percentage badge, and a `删除这个结果` button. Add explanatory copy: `数字越大越容易抽中，不用凑到 100，系统会自动换算。` Add an `＋ 添加一个可能结果` button and enforce 2–10 rows in the editor.

- [x] **Step 4: Translate controls back to the existing API payload**

For fixed rules, call `readSignedDuration` on the fixed effect panel. For random rules, map each `[data-random-outcome]` card to `{ seconds: readSignedDuration(card), weight }`, reject invalid weights, and retain the total-weight check.

- [x] **Step 5: Recalculate probabilities after input, addition, or deletion**

Compute `weight / totalWeight * 100`, show one decimal place when needed, and show `—` while weights are invalid. Percentages are display-only and must not be sent to the server.

- [x] **Step 6: Run the focused regression test**

Run: `node --experimental-vm-modules --test --test-name-pattern="overtime gift rules" test/frontend-regressions.test.js`

Expected: PASS.

### Task 3: Reshape rule cards into readable ticket-like sections

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/css/admin/overtime.css`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: class names emitted by `createRuleRow`, `renderEffectEditor`, `createDirectionControl`, and `createOutcomeCard`.
- Produces: responsive desktop and mobile layouts with visible keyboard focus and semantic add/subtract/random colors.

- [x] **Step 1: Clarify the section heading**

Change the description to explain the workflow in one sentence: add a gift, choose whether it directly changes time or randomly draws a result, then save.

- [x] **Step 2: Restyle each rule as a ticket card**

Use a quiet paper-like card with a gift header, plain-language mode section, effect panel, and separate footer actions. Reserve teal for additions, coral for subtractions, and gold for random/blind-box elements.

- [x] **Step 3: Make blind-box results scan cleanly**

Lay outcome cards out in a responsive grid, keep labels beside their fields, use a high-contrast probability badge, and stack each result on narrow screens without horizontal overflow.

- [x] **Step 4: Preserve keyboard and reduced-motion behavior**

Keep `:focus-visible` outlines on buttons, inputs, and radio labels. Do not introduce essential animation; any hover transform must be disabled under `prefers-reduced-motion: reduce`.

- [x] **Step 5: Run all verification**

Run: `npm run check`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.
