# Playback Panel CSS Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `public/css/playback/panels.css` into feature-owned stylesheets while preserving its URL, declarations, and cascade order.

**Architecture:** Keep `panels.css` as an ordered CSS import entrypoint. Move existing contiguous sections into `public/css/playback/panels/`; source-based regression tests read the expanded bundle through `readCssBundle`.

**Tech Stack:** Plain CSS, CommonJS Node.js tests, `node:test`, Node.js 24+

## Global Constraints

- Do not change selectors, declarations, responsive rules, or import order.
- Add no dependency and no runtime HTML change.
- Keep `/css/styles-playback.css` and `public/css/playback/panels.css` as stable entrypoints.
- Run focused regressions, `npm run check`, and `npm test`.

---

### Task 1: Protect the modular entrypoint

**Files:**
- Modify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `readCssBundle(...relativeSegments)` created by the gift CSS refactor.
- Produces: a regression assertion for the `./panels/search.css` import and import-aware reads of `panels.css`.

- [x] **Step 1: Add an entrypoint assertion and verify it fails**

```js
const panelEntry = fs.readFileSync(
  path.join(ROOT_DIR, 'public', 'css', 'playback', 'panels.css'),
  'utf8'
);
assert.match(panelEntry, /@import url\('\.\/panels\/search\.css'\);/);
```

Run: `node --experimental-vm-modules --test --test-name-pattern="playback panel styles load" test/frontend-regressions.test.js`

Expected: FAIL before the stylesheet is split.

- [x] **Step 2: Replace direct panel stylesheet reads**

```js
const styles = readCssBundle('public', 'css', 'playback', 'panels.css');
```

### Task 2: Split playback panel styles

**Files:**
- Modify: `public/css/playback/panels.css`
- Create: `public/css/playback/panels/user-and-health.css`
- Create: `public/css/playback/panels/discovery.css`
- Create: `public/css/playback/panels/track-menu.css`
- Create: `public/css/playback/panels/confirm-dialog.css`
- Create: `public/css/playback/panels/search.css`
- Create: `public/css/playback/panels/match.css`
- Create: `public/css/playback/panels/queue.css`
- Create: `public/css/playback/panels/wesing.css`

**Interfaces:**
- Consumes: the existing 1,094-line stylesheet.
- Produces: the unchanged `panels.css` URL and expanded stylesheet behavior.

- [x] **Step 1: Move the existing sections at exact boundaries**

```text
1-118     user-and-health.css
119-262   discovery.css
263-334   track-menu.css
335-457   confirm-dialog.css
458-594   search.css
595-670   match.css
671-772   queue.css
773-end   wesing.css
```

- [x] **Step 2: Replace `panels.css` with ordered imports**

```css
/* Playback panel styles - ordered compatibility entrypoint. */
@import url('./panels/user-and-health.css');
@import url('./panels/discovery.css');
@import url('./panels/track-menu.css');
@import url('./panels/confirm-dialog.css');
@import url('./panels/search.css');
@import url('./panels/match.css');
@import url('./panels/queue.css');
@import url('./panels/wesing.css');
```

- [x] **Step 3: Verify focused and full behavior**

Run: `node --experimental-vm-modules --test --test-name-pattern="playback|queue|WeSing|search|match" test/frontend-regressions.test.js`

Expected: PASS.

Run: `npm run check && npm test`

Expected: PASS.
