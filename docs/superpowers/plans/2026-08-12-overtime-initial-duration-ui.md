# Overtime Initial Duration UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the overtime controls readable and replace the separate initial/remaining time fields with one minute-precision initial-duration editor that supports typing and hour/minute selection.

**Architecture:** Keep the existing overtime API and persisted state unchanged. The admin controller will submit the chosen initial duration as both `initialSeconds` and `remainingSeconds`, so applying it also returns the countdown to that duration and pauses it; the overlay clock remains second-precision while configuration is minute-precision.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js `node:test` regression tests.

## Global Constraints

- Keep the existing `/api/overtime/time` contract and server behavior.
- Do not add dependencies.
- Use `HHH:MM` for initial-duration entry; seconds must always be zero when applying it.
- Preserve the second-precision live countdown and gift-rule time formats.

---

### Task 1: Lock the intended admin behavior with a regression test

**Files:**
- Modify: `test/frontend-regressions.test.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: existing `public/pages/admin.html`, `public/js/admin/overtime.js`, and `public/css/admin/overtime.css` source files.
- Produces: static assertions for the minute-duration UI, API payload behavior, and dark-console contrast rules.

- [x] **Step 1: Write the failing test**

```js
test('overtime initial duration is minute-based, selectable, and readable', () => {
  assert.match(html, /id="overtimeInitialTime"[^>]+value="00:00"/);
  assert.match(html, /id="overtimeInitialHours"/);
  assert.match(html, /id="overtimeInitialMinutes"/);
  assert.doesNotMatch(html, /id="overtimeRemainingTime"/);
  assert.match(source, /remainingSeconds:\s*initialSeconds/);
  assert.match(source, /function parseInitialDuration/);
  assert.match(overtimeStyles, /\.overtime-actions button:disabled[\s\S]*?opacity:\s*1/);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --experimental-vm-modules --test --test-name-pattern="overtime initial duration" test/frontend-regressions.test.js`

Expected: FAIL because the remaining-time field still exists and the selectors/contrast rules do not.

- [x] **Step 3: Keep the test focused on user-visible contracts**

Confirm the assertions do not require server or storage changes and do not constrain unrelated gift-rule time inputs.

### Task 2: Implement the single initial-duration editor and contrast fix

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `public/js/admin/overtime.js`
- Modify: `public/css/admin/overtime.css`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `POST /api/overtime/time` with integer `initialSeconds` and `remainingSeconds`.
- Produces: `parseInitialDuration(value: string): number`, synchronized `overtimeInitialHours` and `overtimeInitialMinutes` controls, and a payload `{ initialSeconds, remainingSeconds: initialSeconds }`.

- [x] **Step 1: Replace the remaining-time input in the HTML**

Use one `HHH:MM` input, one hours select, one minutes select, and a button labeled `设置初始时间`. Explain that setting it returns the countdown to that duration and pauses it.

- [x] **Step 2: Populate and synchronize the selectors**

Populate hours `0` through `999` and minutes `0` through `59`. Selector changes update the text input; a valid typed value updates both selectors.

- [x] **Step 3: Apply minute-precision values**

Parse only `H:MM` through `HHH:MM`, reject hours over `999` and minutes over `59`, multiply total minutes by 60, and submit the same value as initial and remaining seconds.

- [x] **Step 4: Improve top-control contrast and responsive layout**

Use an opaque dark header, explicit light header copy, explicit console button colors, readable disabled buttons with `opacity: 1`, visible keyboard focus, and a stacked mobile duration editor.

- [x] **Step 5: Run verification**

Run: `node --experimental-vm-modules --test --test-name-pattern="overtime" test/frontend-regressions.test.js`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.
