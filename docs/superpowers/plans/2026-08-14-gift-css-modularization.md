# Gift CSS Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic admin gift stylesheet into feature-owned files without changing rendered behavior, import order, or the public `/css/styles-admin.css` entrypoint.

**Architecture:** Keep `public/css/admin/gifts.css` as a compatibility entrypoint whose ordered `@import` statements reproduce the current cascade. Place each contiguous feature section under `public/css/admin/gifts/`, and teach the source-based frontend regression suite to resolve CSS imports before asserting selectors.

**Tech Stack:** Plain CSS, CommonJS Node.js tests, `node:test`, `node:assert/strict`, Node.js 24+

## Global Constraints

- Preserve the existing `/css/styles-admin.css` browser entrypoint.
- Preserve selector contents and their current cascade order exactly.
- Add no dependencies and no build step.
- Keep two-space indentation, semicolons, single quotes, and CommonJS style in tests.
- Run `npm run check && npm test` before considering the batch complete.

---

### Task 1: Make CSS source assertions import-aware

**Files:**
- Modify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: `ROOT_DIR` and Node's existing `fs`/`path` modules.
- Produces: `readCssBundle(...relativeSegments) -> string`, returning an entry stylesheet followed by recursively resolved local imports in declaration order.

- [x] **Step 1: Add a failing regression expectation for the modular gift entrypoint**

Add an assertion that `public/css/admin/gifts.css` imports `./gifts/recent.css`; it must fail before Task 2 creates the entrypoint.

```js
const giftEntry = fs.readFileSync(
  path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'),
  'utf8'
);
assert.match(giftEntry, /@import url\('\.\/gifts\/recent\.css'\);/);
```

- [x] **Step 2: Run the focused test and verify failure**

Run: `node --experimental-vm-modules --test --test-name-pattern="recent gift cards" test/frontend-regressions.test.js`

Expected: FAIL because the current file contains selectors instead of the new import.

- [x] **Step 3: Add the recursive CSS reader and use it for gift CSS assertions**

```js
function readCssBundle(...relativeSegments) {
  const visited = new Set();

  function read(filePath) {
    const resolvedPath = path.resolve(filePath);
    if (visited.has(resolvedPath)) return '';
    visited.add(resolvedPath);

    const source = fs.readFileSync(resolvedPath, 'utf8');
    return source.replace(/@import\s+url\(['"]([^'"]+)['"]\);/g, (_statement, importPath) => {
      if (/^(?:[a-z]+:|\/)/i.test(importPath)) return '';
      return read(path.resolve(path.dirname(resolvedPath), importPath));
    });
  }

  return read(path.join(ROOT_DIR, ...relativeSegments));
}
```

Replace direct reads of `public/css/admin/gifts.css` with:

```js
const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');
```

- [x] **Step 4: Run the focused test again**

Run: `node --experimental-vm-modules --test --test-name-pattern="recent gift cards" test/frontend-regressions.test.js`

Expected: The new entrypoint expectation still fails, while existing selector assertions continue to read the full bundle.

### Task 2: Split the gift stylesheet by feature

**Files:**
- Modify: `public/css/admin/gifts.css`
- Create: `public/css/admin/gifts/detection.css`
- Create: `public/css/admin/gifts/recent.css`
- Create: `public/css/admin/gifts/blindbox-mapping.css`
- Create: `public/css/admin/gifts/blindbox-stats.css`
- Create: `public/css/admin/gifts/blindbox-broadcast.css`
- Create: `public/css/admin/gifts/main-page-tabs.css`

**Interfaces:**
- Consumes: existing selectors and their declaration order from `gifts.css`.
- Produces: the unchanged `gifts.css` URL as an ordered compatibility entrypoint.

- [x] **Step 1: Move contiguous sections without editing their declarations**

Use the existing section boundaries:

```text
1-74       detection.css
75-485     recent.css
486-712    blindbox-mapping.css
713-1051   blindbox-stats.css
1052-1274  blindbox-broadcast.css
1275-end   main-page-tabs.css
```

- [x] **Step 2: Replace the old file with ordered imports**

```css
/* Admin gift styles - ordered compatibility entrypoint. */
@import url('./gifts/detection.css');
@import url('./gifts/recent.css');
@import url('./gifts/blindbox-mapping.css');
@import url('./gifts/blindbox-stats.css');
@import url('./gifts/blindbox-broadcast.css');
@import url('./gifts/main-page-tabs.css');
```

- [x] **Step 3: Run gift-related frontend regressions**

Run: `node --experimental-vm-modules --test --test-name-pattern="gift|blind box|blindbox|recent" test/frontend-regressions.test.js`

Expected: PASS.

- [x] **Step 4: Run static validation and the full suite**

Run: `npm run check`

Expected: PASS.

Run: `npm test`

Expected: PASS.
