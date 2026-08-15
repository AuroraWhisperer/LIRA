# Admin HTML Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic admin HTML into ordered, domain-focused fragments while preserving the exact rendered DOM and existing initialization timing.

**Architecture:** A single `composeAdminHtml(publicDir)` function owns the explicit fragment order. The HTTP server and test helper both call that function, so production and tests cannot drift. Admin routes compose the page before the existing token injection step; all other static assets retain the current read path.

**Tech Stack:** Node.js CommonJS, built-in `node:fs` and `node:path`, `node:test`, static HTML fragments.

## Global Constraints

- Preserve all existing user changes in the dirty worktree, including the path-containment fix already present in `src/server/http-utils.js`.
- Move HTML only; do not change text, tag order, IDs, CSS classes, scripts, styles, or initialization behavior.
- Use an explicit ordered fragment list; never scan the fragment directory to determine order.
- Compose the complete admin document before injecting the API token script.
- Remove the physical `public/pages/admin.html` after all callers use the composer.
- Add no dependencies and do not introduce client-side fragment loading, iframes, or lazy initialization.
- Do not commit unless the user explicitly requests a commit.

---

## File Structure

- Create `src/server/admin-page.js`: owns admin route recognition, the ordered fragment manifest, and `composeAdminHtml(publicDir)`.
- Modify `src/server/http-utils.js`: routes `/`, `/admin`, `/settings`, and `/songs` through the composer before token injection.
- Create `public/pages/admin/**`: stores shell, song tabs, gifts, toolbox features, playback, drawers, and global modal fragments.
- Delete `public/pages/admin.html`: removes the obsolete production/test fallback.
- Create `test/helpers/admin-html.js`: thin wrapper around the production composer.
- Modify the 13 tests that currently read `admin.html`: use `readAdminHtml()` instead.
- Create `test/admin-page-composition.test.js`: verifies route coverage, fragment order invariants, required document anchors, and unique IDs.

### Task 1: Lock the composition contract with tests

**Files:**
- Create: `test/admin-page-composition.test.js`

**Interfaces:**
- Consumes: future exports `ADMIN_FRAGMENT_PATHS`, `composeAdminHtml(publicDir)`, and `isAdminPageRoute(pathname)` from `src/server/admin-page.js`.
- Produces: executable expectations for fixed routes, ordered fragments, one complete HTML document, and unique IDs.

- [ ] **Step 1: Write the failing composition test**

```js
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  ADMIN_FRAGMENT_PATHS,
  composeAdminHtml,
  isAdminPageRoute
} = require('../src/server/admin-page');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

test('admin routes use one explicit ordered fragment composition', () => {
  assert.deepEqual(['/', '/admin', '/settings', '/songs'].map(isAdminPageRoute), [true, true, true, true]);
  assert.equal(isAdminPageRoute('/queue'), false);
  assert.ok(Object.isFrozen(ADMIN_FRAGMENT_PATHS));
  assert.equal(ADMIN_FRAGMENT_PATHS[0], 'pages/admin/shell-start.html');
  assert.equal(ADMIN_FRAGMENT_PATHS.at(-1), 'pages/admin/document-end.html');
});

test('composed admin page is complete, ordered, and has unique ids', () => {
  const html = composeAdminHtml(PUBLIC_DIR);
  assert.match(html, /<!doctype html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.ok(html.indexOf('id="songAssistantPage"') < html.indexOf('id="giftAssistantPage"'));
  assert.ok(html.indexOf('id="giftAssistantPage"') < html.indexOf('id="otherAssistantPage"'));
  assert.ok(html.indexOf('id="otherAssistantPage"') < html.indexOf('id="playbackAssistantPage"'));
  assert.ok(html.indexOf('/js/admin/index.js') < html.indexOf('/js/playback.js'));

  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});
```

- [ ] **Step 2: Run the test and verify it fails because the production composer does not exist**

Run: `node --test test/admin-page-composition.test.js`

Expected: FAIL with `Cannot find module '../src/server/admin-page'`.

### Task 2: Add the production composer and byte-equivalent fragments

**Files:**
- Create: `src/server/admin-page.js`
- Create: `public/pages/admin/shell-start.html`
- Create: `public/pages/admin/song/*.html`
- Create: `public/pages/admin/gifts/*.html`
- Create: `public/pages/admin/toolbox/*.html`
- Create: `public/pages/admin/playback/*.html`
- Create: `public/pages/admin/shared/*.html`
- Create: `public/pages/admin/main-end.html`
- Create: `public/pages/admin/document-end.html`

**Interfaces:**
- Produces: `ADMIN_FRAGMENT_PATHS` as a frozen ordered array, `isAdminPageRoute(pathname)`, and `composeAdminHtml(publicDir)` returning a UTF-8 string.

- [ ] **Step 1: Implement a fixed manifest and composer**

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ADMIN_PAGE_ROUTES = new Set(['/', '/admin', '/settings', '/songs']);
const ADMIN_FRAGMENT_PATHS = Object.freeze([
  'pages/admin/shell-start.html',
  // Domain fragments are listed explicitly in their original byte order.
  'pages/admin/document-end.html'
]);

function isAdminPageRoute(pathname) {
  return ADMIN_PAGE_ROUTES.has(pathname);
}

function composeAdminHtml(publicDir) {
  return ADMIN_FRAGMENT_PATHS
    .map(relativePath => fs.readFileSync(path.join(publicDir, relativePath), 'utf8'))
    .join('');
}

module.exports = { ADMIN_FRAGMENT_PATHS, composeAdminHtml, isAdminPageRoute };
```

- [ ] **Step 2: Split the existing file by semantic ranges without changing bytes**

Use a temporary Node script that reads `public/pages/admin.html` as UTF-8, writes the fixed range list to the manifest paths, concatenates the written fragments, and aborts unless `Buffer.equals(original, recomposed)` is true.

- [ ] **Step 3: Run the composition test**

Run: `node --test test/admin-page-composition.test.js`

Expected: PASS.

- [ ] **Step 4: Perform the one-time migration equivalence check before deleting the source**

Run a Node comparison between `composeAdminHtml(publicDir)` and `fs.readFileSync('public/pages/admin.html', 'utf8')`.

Expected: exact equality and identical SHA-256 hashes.

### Task 3: Route production requests through the composer

**Files:**
- Modify: `src/server/http-utils.js`
- Test: `test/admin-page-composition.test.js`

**Interfaces:**
- Consumes: `composeAdminHtml(publicDir)` and `isAdminPageRoute(pathname)`.
- Produces: complete admin HTML for all four existing admin routes before the unchanged token injection block.

- [ ] **Step 1: Remove admin entries from the static `pageMap` and detect them with `isAdminPageRoute`**

- [ ] **Step 2: Feed composed HTML into the existing response callback before token injection**

Keep the current token insertion and content-type logic unchanged after content acquisition. Preserve the existing safe path-containment check for non-admin assets.

- [ ] **Step 3: Add a source-level regression assertion**

Assert that `src/server/http-utils.js` imports the composer, checks `isAdminPageRoute(requestUrl.pathname)`, and does not map an admin route to `pages/admin.html`.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/admin-page-composition.test.js test/overtime-overlay.test.js`

Expected: PASS.

### Task 4: Make every HTML test use the production composition path

**Files:**
- Create: `test/helpers/admin-html.js`
- Modify: the 13 `test/*.test.js` files containing `admin.html` reads.

**Interfaces:**
- Consumes: `composeAdminHtml(PUBLIC_DIR)` from production.
- Produces: `readAdminHtml()` with no independent fragment list or ordering logic.

- [ ] **Step 1: Add the thin test helper**

```js
'use strict';

const path = require('node:path');
const { composeAdminHtml } = require('../../src/server/admin-page');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

function readAdminHtml() {
  return composeAdminHtml(PUBLIC_DIR);
}

module.exports = { readAdminHtml };
```

- [ ] **Step 2: Replace all 31 direct reads with `readAdminHtml()`**

Add `const { readAdminHtml } = require('./helpers/admin-html');` to each affected top-level test and retain unrelated `fs`, `path`, and local read helpers.

- [ ] **Step 3: Verify no test directly references the legacy file**

Run: `rg -n "pages[/\\\\]admin\.html|['\"]admin\.html['\"]" test`

Expected: no matches.

- [ ] **Step 4: Run the affected frontend tests**

Run: `node --experimental-vm-modules --test test/admin-page-composition.test.js test/desktop-lyrics.test.js test/frontend-admin-ai.test.js test/frontend-admin-shell.test.js test/frontend-gifts.test.js test/frontend-playback.test.js test/frontend-queue.test.js test/frontend-song-board.test.js test/playback-wesing.test.js test/queue-overlay-responsive.test.js test/song-library-filter-menu.test.js test/song-library-filter.test.js test/toolbox-sidebar.test.js test/toolbox-todo.test.js`

Expected: PASS.

### Task 5: Remove the legacy file and verify the complete change

**Files:**
- Delete: `public/pages/admin.html`

- [ ] **Step 1: Delete only the verified legacy file**

Remove `D:\Work\Live\public\pages\admin.html` after the byte-equivalence check passes.

- [ ] **Step 2: Confirm production and tests have no legacy reads**

Run: `rg -n "pages/admin\.html|pages\\\\admin\.html" src test public scripts`

Expected: no matches.

- [ ] **Step 3: Validate fragment size and responsibility**

Run: `Get-ChildItem public/pages/admin -Recurse -File | Sort-Object Length -Descending | Select-Object FullName,Length`

Expected: no replacement monolith; the largest fragments correspond to a single tab or feature.

- [ ] **Step 4: Run repository validation**

Run: `npm run check`

Expected: PASS.

Run: `npm test`

Expected: PASS.

## Self-Review

- Spec coverage: one production composer, explicit order, pre-token composition, no physical legacy page, shared test path, exact migration diff, duplicate-ID guard, and full validation are all assigned to tasks.
- Placeholder scan: no deferred implementation placeholders remain; the only abbreviated manifest in the illustrative snippet is fully specified by Task 2's semantic range requirement and concrete file structure.
- Type consistency: `composeAdminHtml(publicDir)` returns a string everywhere; `readAdminHtml()` returns that same string; `isAdminPageRoute(pathname)` returns a boolean.
