# Overtime Gift Sale Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the overtime machine refresh Bilibili's current room gift panel, update Markdown availability columns, and offer only currently listed gifts for new rules.

**Architecture:** A focused gift-sale catalog service fetches the fixed Bilibili `giftData` and `giftConfig` endpoints, joins panel IDs to local Markdown image mappings, persists a runtime snapshot, and updates the three Markdown tables when writable. The authenticated overtime API exposes cached and refresh operations; the admin UI consumes that API and preserves existing unavailable rules with a warning.

**Tech Stack:** Node.js 24 CommonJS, built-in `fetch`, `node:sqlite`, existing HTTP router, browser ES modules, `node:test`.

## Global Constraints

- Use the configured Bilibili room ID; never accept an arbitrary upstream URL from the browser.
- Preserve existing overtime rules when a gift is no longer listed.
- Do not download new gift images during refresh; use mapped local images or the existing placeholder.
- Keep all current user changes outside the files named in this plan untouched.
- Run `npm run check && npm test` before completion.

---

### Task 1: Gift Sale Catalog Core

**Files:**
- Create: `src/bilibili/gift/sale-catalog.js`
- Create: `test/gift-sale-catalog.test.js`

**Interfaces:**
- Produces: `collectPanelGiftIds(payload): Set<number>`.
- Produces: `parseGiftConfig(payload): Map<number, GiftMetadata>`.
- Produces: `readGiftMappings(publicDir): { byId: Map, documents: Array }`.
- Produces: `updateMarkdownAvailability(content, saleIds, options): string`.
- Produces: `createGiftSaleCatalogService(options): { getSnapshot, refresh }`.

- [ ] **Step 1: Write failing parser tests**

```js
test('collectPanelGiftIds includes main, upgrade and tab gifts', () => {
  const ids = collectPanelGiftIds({ data: {
    room_gift_list: { gold_list: [{ gift_id: 1, upgrade_gift: [{ gift_id: 2 }] }] },
    tab_list: [{ list: [{ gift_id: 3 }] }]
  } });
  assert.deepEqual([...ids].sort(), [1, 2, 3]);
});
```

- [ ] **Step 2: Run the focused test and confirm missing-module failure**

Run: `node --test test/gift-sale-catalog.test.js`

- [ ] **Step 3: Implement strict payload parsing and local mapping joins**

```js
function addGiftEntry(ids, entry) {
  const id = Number(entry?.gift_id ?? entry?.id);
  if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  for (const upgrade of Array.isArray(entry?.upgrade_gift) ? entry.upgrade_gift : []) {
    addGiftEntry(ids, upgrade);
  }
}
```

- [ ] **Step 4: Test Markdown status replacement and alias handling**

```js
assert.match(updated, /\| 100 \|[^\n]+\| 200 \| 在售 \|/);
assert.equal((updated.match(/当前在售/g) || []).length, 1);
```

- [ ] **Step 5: Implement refresh caching, fixed endpoints, timeout, atomic persistence and optional Markdown writes**

The service validates a positive numeric room ID, returns the last snapshot within `minRefreshMs`, uses only hardcoded HTTPS endpoint builders, and writes `overtime-gift-sale.json` via `file.tmp` plus `renameSync`.

- [ ] **Step 6: Run the focused tests**

Run: `node --test test/gift-sale-catalog.test.js`

### Task 2: Script and Authenticated API

**Files:**
- Create: `scripts/refresh-bilibili-gift-sale.js`
- Modify: `src/server/domain-services.js`
- Modify: `src/server/api-context.js`
- Modify: `src/server/routes/overtime-routes.js`
- Modify: `src/server.js`
- Modify: `test/overtime-routes.test.js`

**Interfaces:**
- Consumes: `createGiftSaleCatalogService(options)` from Task 1.
- Produces: `GET /api/overtime/gifts` and `POST /api/overtime/gifts/refresh`.
- Produces: CLI arguments `--room-id <positive integer>` and optional `--data-dir <path>`.

- [ ] **Step 1: Extend the route test with an injected upstream fixture**

```js
const runtime = createServerRuntime({
  dataDir,
  giftSaleFetchJson: async (name) => name === 'gift_data' ? giftDataPayload : giftConfigPayload,
  giftSalePublicDir: fixturePublicDir
});
```

- [ ] **Step 2: Verify the new route test fails with 404**

Run: `node --test test/overtime-routes.test.js`

- [ ] **Step 3: Wire the service through domain services and API context**

```js
'GET /api/overtime/gifts': overtimeRoute(overtime => overtime.getGiftCatalog()),
'POST /api/overtime/gifts/refresh': overtimeRoute(overtime => overtime.refreshGiftCatalog())
```

- [ ] **Step 4: Implement the CLI using the shared service**

The script reads `roomId` from `node:sqlite` only when `--room-id` is absent, prints refreshed counts, and exits non-zero on validation or network errors.

- [ ] **Step 5: Run route and core tests**

Run: `node --test test/gift-sale-catalog.test.js test/overtime-routes.test.js`

### Task 3: Overtime Admin Refresh UI

**Files:**
- Modify: `public/pages/admin/toolbox/overtime.html`
- Modify: `public/js/admin/overtime.js`
- Modify: `public/css/admin/overtime.css`
- Modify: `test/frontend-queue.test.js`

**Interfaces:**
- Consumes: overtime gift catalog snapshot with `gifts`, `count`, `roomId`, `refreshedAt` and `markdownUpdated`.
- Produces: `refreshGiftCatalog()`, `renderGiftCatalogStatus()` and `syncRuleAvailability()` browser functions.

- [ ] **Step 1: Add failing static frontend assertions**

```js
assert.match(html, /id="overtimeRefreshGiftsBtn"/);
assert.match(source, /\/api\/overtime\/gifts\/refresh/);
assert.doesNotMatch(source, /fetch\('\/img\/bilibili-gifts\.json'/);
```

- [ ] **Step 2: Run the frontend test and confirm failure**

Run: `node --experimental-vm-modules --test test/frontend-queue.test.js`

- [ ] **Step 3: Add accessible loading and status controls**

The button uses `disabled` while refreshing; the adjacent status has `role="status"` and reports room, count and refresh time.

- [ ] **Step 4: Replace the static catalog fetch and filter the picker**

```js
const payload = await readJsonResponse(await fetch('/api/overtime/gifts'), '读取在售礼物失败');
catalog = [...GUARD_GIFTS, ...payload.data.gifts].map(normalizeCatalogGift);
```

- [ ] **Step 5: Mark existing rules without deleting them**

Rows whose IDs are absent from the refreshed set receive `.is-unavailable` and a text node containing `当前未在售`.

- [ ] **Step 6: Run the frontend test**

Run: `node --experimental-vm-modules --test test/frontend-queue.test.js`

### Task 4: Generate Markdown Status and Verify

**Files:**
- Modify: `public/img/bilibili-gifts/gift-mapping-under-100.md`
- Modify: `public/img/bilibili-gifts/gift-mapping-100-above.md`
- Modify: `public/img/bilibili-gifts/silver-free-mapping.md`

**Interfaces:**
- Consumes: CLI from Task 2 and the configured room ID.
- Produces: one `当前在售` column per gift table with `在售` or `非目前在售` values.

- [ ] **Step 1: Run the script against a valid room fixture or configured room**

Run: `node scripts/refresh-bilibili-gift-sale.js --room-id <room-id>`

- [ ] **Step 2: Verify column counts and link integrity**

Run a Node assertion that every gift row has the same number of columns as its header and every local Markdown image link exists.

- [ ] **Step 3: Run static validation**

Run: `npm run check`

- [ ] **Step 4: Run the full test suite**

Run: `npm test`

- [ ] **Step 5: Inspect the final diff**

Confirm only the design, plan, catalog service, script, overtime API/UI/tests, three Markdown files, and generated sale snapshot changed; preserve unrelated user edits.

