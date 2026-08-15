# Overlay CSS Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `public/css/overlays/base.css` into ordered overlay feature modules while preserving all existing page URLs and cascade behavior.

**Architecture:** Keep `base.css` as a compatibility entrypoint. Use only contiguous source ranges so common selectors and queue variants retain their exact relative order; defer page-specific loading optimization to a separate change.

**Tech Stack:** Plain CSS, CommonJS Node.js tests, `node:test`, Node.js 24+

## Global Constraints

- Preserve declarations, keyframes, media queries, and selector order exactly.
- Do not change overlay HTML or JavaScript in this batch.
- Add no dependencies.
- Verify queue viewport, song board, frontend regressions, syntax, and the full test suite.

---

### Task 1: Split the overlay stylesheet

**Files:**
- Modify: tests that read `public/css/overlays/base.css`
- Modify: `public/css/overlays/base.css`
- Create: `public/css/overlays/base/foundation-and-classic.css`
- Create: `public/css/overlays/base/identity.css`
- Create: `public/css/overlays/base/songs.css`

**Interfaces:**
- Consumes: `readCssBundle` and the existing 789-line stylesheet.
- Produces: the same `base.css` URL and an import assertion for `./base/identity.css`.

- [x] **Step 1: Add and run the failing entrypoint test**

```js
assert.match(entry, /@import url\('\.\/base\/identity\.css'\);/);
```

Run: `node --test --test-name-pattern="overlay base styles load" test/queue-overlay-responsive.test.js`

Expected: FAIL before splitting.

- [x] **Step 2: Use `readCssBundle` for selector assertions**

```js
const styles = readCssBundle('public', 'css', 'overlays', 'base.css');
```

- [x] **Step 3: Move exact contiguous ranges**

```text
1-245    foundation-and-classic.css
246-655  identity.css
656-end  songs.css
```

- [x] **Step 4: Replace `base.css` with ordered imports**

```css
/* Overlay styles - ordered compatibility entrypoint. */
@import url('./base/foundation-and-classic.css');
@import url('./base/identity.css');
@import url('./base/songs.css');
```

- [x] **Step 5: Verify focused and full behavior**

Run: `node --experimental-vm-modules --test test/queue-overlay-responsive.test.js test/frontend-regressions.test.js`

Expected: PASS.

Run: `npm run check && npm test`

Expected: PASS.
