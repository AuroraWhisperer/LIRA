# Parameter Range Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every parameter-adjustment range with one reusable sky-blue control while leaving playback seek and volume controls unchanged.

**Architecture:** A shared browser module calculates a range input's normalized position and writes it to a CSS custom property. A component stylesheet consumes that property for the sky-blue gradient rail and glass-bead thumb. Explicit `parameter-range` classes define the scope, so the existing playback selectors keep their current styles.

**Tech Stack:** HTML, CSS custom properties, browser ES modules, Node.js `node:test`.

## Global Constraints

- Preserve the current styles and behavior of `#playbackSeek` and `#playbackVolume`.
- Do not add dependencies.
- Use the shared parameter component for all other `input[type="range"]` controls in `public/pages/admin.html`.
- Use the sky-blue palette `#43c7ff → #61b4ff → #bdebff` and allow the thumb to reach both visual track endpoints.

---

### Task 1: Add regression coverage for component scope and progress calculation

**Files:**
- Modify: `test/frontend-regressions.test.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `getParameterRangeProgress(input)` from `public/js/shared/parameter-range.js`.
- Produces: Regression assertions that parameter controls are opted in and playback controls are not.

- [x] **Step 1: Write the failing test**

```js
const { getParameterRangeProgress } = await loadModuleExports(
  path.join(ROOT_DIR, 'public', 'js', 'shared', 'parameter-range.js')
);
assert.equal(getParameterRangeProgress({ min: '0', max: '100', value: '25' }), 25);
assert.equal(getParameterRangeProgress({ min: '-3000', max: '3000', value: '0' }), 50);
assert.match(html, /id="themeOpacity" class="parameter-range" type="range"/);
assert.doesNotMatch(html, /id="playbackSeek" class="parameter-range"/);
assert.doesNotMatch(html, /id="playbackVolume" class="[^\"]*parameter-range/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules --test test/frontend-regressions.test.js`

Expected: FAIL because `parameter-range.js` and the classes do not yet exist.

### Task 2: Create the reusable range behavior and styles

**Files:**
- Create: `public/js/shared/parameter-range.js`
- Create: `public/css/components/parameter-range.css`
- Modify: `public/js/shared/utils.js:7-16`
- Modify: `public/css/styles-admin.css:1-8`
- Modify: `public/js/admin/app.js:1-19`

**Interfaces:**
- Produces: `getParameterRangeProgress(input)`, `refreshParameterRange(input)`, and `initParameterRanges(root)`.
- Consumes: The `parameter-range` class and `--parameter-range-progress` CSS custom property.

- [x] **Step 1: Implement normalized progress updates**

```js
export function getParameterRangeProgress(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

export function refreshParameterRange(input) {
  if (!input?.matches?.('input.parameter-range[type="range"]')) return;
  input.style.setProperty('--parameter-range-progress', `${getParameterRangeProgress(input)}%`);
}
```

- [x] **Step 2: Implement the shared glass-bead CSS**

```css
.parameter-range[type="range"] {
  --parameter-range-thumb-size: 18px;
  background: linear-gradient(90deg, #43c7ff, #61b4ff 62%, #bdebff)
    0 / var(--parameter-range-progress, 0%) 100% no-repeat,
    #e7f0f7;
}
```

- [x] **Step 3: Initialize and refresh component state**

```js
initParameterRanges();

export function setValue(id, nextValue) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = nextValue ?? '';
  refreshParameterRange(el);
}
```

### Task 3: Opt all parameter ranges into the component

**Files:**
- Modify: `public/pages/admin.html:374-1052,2449`
- Modify: `public/js/playback/services/wesing-service.js:58-69,263-269`

**Interfaces:**
- Consumes: The class and refresh function from Task 2.
- Produces: Every parameter-adjustment range renders with the shared component; playback seek and volume keep existing selectors and markup.

- [x] **Step 1: Add `class="parameter-range"` to each parameter range**

```html
<input id="themeOpacity" class="parameter-range" type="range" min="0" max="1" step="0.01">
<input id="weSingLyricOffsetMs" class="parameter-range" type="range" min="-3000" max="3000" step="50" value="0">
```

- [x] **Step 2: Refresh WeSing's offset range after direct assignments**

```js
if (offsetRange && offsetMs !== null) {
  offsetRange.value = String(offsetMs);
  refreshParameterRange(offsetRange);
}
```

### Task 4: Verify the component and full project

**Files:**
- Test: `test/frontend-regressions.test.js`

- [x] **Step 1: Run focused regression coverage**

Run: `node --experimental-vm-modules --test test/frontend-regressions.test.js`

Expected: PASS, including parameter range progress and playback-exclusion assertions.

- [x] **Step 2: Run full validation**

Run: `npm run check && npm test`

Expected: PASS with no JavaScript syntax failures or test regressions.
