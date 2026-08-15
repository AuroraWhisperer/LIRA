# Toolbox CSS Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `public/css/admin/other-features.css` into focused toolbox stylesheets without changing its stable URL or cascade.

**Architecture:** Preserve `other-features.css` as an ordered compatibility entrypoint. Move contiguous source ranges to `public/css/admin/other-features/`; tests expand imports through `test/helpers/css-bundle.js`.

**Tech Stack:** Plain CSS, CommonJS Node.js tests, `node:test`, Node.js 24+

## Global Constraints

- Preserve all selectors, declarations, media queries, and order exactly.
- Do not change admin HTML or JavaScript behavior.
- Add no dependency or build step.
- Verify focused toolbox tests, syntax, and the full suite.

---

### Task 1: Protect and split the toolbox stylesheet

**Files:**
- Modify: `test/frontend-regressions.test.js`
- Modify: other tests that read `public/css/admin/other-features.css`
- Modify: `public/css/admin/other-features.css`
- Create: `public/css/admin/other-features/shell.css`
- Create: `public/css/admin/other-features/danmaku-tool.css`
- Create: `public/css/admin/other-features/xiaomi-ai.css`
- Create: `public/css/admin/other-features/danmaku-editors.css`
- Create: `public/css/admin/other-features/usage-guide.css`
- Create: `public/css/admin/other-features/streamer-planner.css`

**Interfaces:**
- Consumes: the existing 1,763-line stylesheet and `readCssBundle`.
- Produces: the same `other-features.css` URL and a regression assertion for `./other-features/streamer-planner.css`.

- [x] **Step 1: Add a failing import assertion**

```js
assert.match(entry, /@import url\('\.\/other-features\/streamer-planner\.css'\);/);
```

Run: `node --experimental-vm-modules --test --test-name-pattern="toolbox styles load" test/frontend-regressions.test.js`

Expected: FAIL before splitting.

- [x] **Step 2: Convert selector assertions to import-aware reads**

```js
const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
```

- [x] **Step 3: Move exact contiguous ranges**

```text
1-305      shell.css
306-491    danmaku-tool.css
492-703    xiaomi-ai.css
704-863    danmaku-editors.css
864-1163   usage-guide.css
1164-end   streamer-planner.css
```

- [x] **Step 4: Replace the entrypoint with ordered imports**

```css
/* Toolbox styles - ordered compatibility entrypoint. */
@import url('./other-features/shell.css');
@import url('./other-features/danmaku-tool.css');
@import url('./other-features/xiaomi-ai.css');
@import url('./other-features/danmaku-editors.css');
@import url('./other-features/usage-guide.css');
@import url('./other-features/streamer-planner.css');
```

- [x] **Step 5: Verify focused and full behavior**

Run: `node --experimental-vm-modules --test --test-name-pattern="toolbox|danmaku|Xiaomi|usage guide|streamer planner"`

Expected: PASS.

Run: `npm run check && npm test`

Expected: PASS.
