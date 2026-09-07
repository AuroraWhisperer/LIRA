# Cloud Song Sync Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cloud song-library synchronization accept and preserve the local free-text `点歌价格` field, migrate existing server databases safely, expose actionable validation errors, and render the same values on the public song page.

**Architecture:** The desktop main process will send `requestPrice` as trimmed text, `null`, or a legacy finite number without coercing descriptive text. The server will normalize strings and legacy numbers to nullable text, validate the remaining song fields before the existing atomic replacement transaction, and rebuild an old `REAL` column to `TEXT` without changing song ids or indexes. Error metadata will carry only a bounded song index through the remote client and IPC; the admin UI will turn it into readable Chinese feedback.

**Tech Stack:** Electron main/preload JavaScript, Node.js CommonJS, Express, better-sqlite3, browser JavaScript, Node test runner, JSON OpenAPI 3.1 documents.

## Global Constraints

- Keep `requestPrice`/`request_price` as descriptive free text; never infer point-song eligibility or silently discard `免费`, `舰长`, `30元SC`, or similar text.
- Accept legacy finite JSON numbers and normalize them to text for compatibility; accept `null` and missing values as no price; reject booleans, arrays, objects, `NaN`, and infinities.
- Keep the existing 5000-song limit, tenant/authentication boundaries, atomic replacement semantics, legacy aliases, and IPC source validation.
- Migrate existing `songs.request_price` columns transactionally with no data loss; repeated initialization must be idempotent.
- Do not commit, branch, reset, or modify unrelated user changes.

---

### Task 1: Lock the wire and validation behavior with focused tests

**Files:**

- Modify: `D:/Work/Live/test/license-manager.test.js`
- Modify: `D:/Work/Live/test/remote-license-client.test.js`
- Modify: `D:/Work/Live/test/license-background.test.js`
- Modify: `D:/Work/lira-server/test/song-library-validation.test.js`
- Modify: `D:/Work/lira-server/test/song-library-sync.test.js`
- Modify: `D:/Work/lira-server/test/cloud-sync-http.test.js`
- Modify: `D:/Work/lira-server/test/public-song-page.test.js`

**Interfaces:**

- Consumes: `mapSongForSync`, `createRemoteLicenseClient`, `registerLicenseIpc`, `normalizeSong`, and the existing Device/Streamer song routes.
- Produces: executable expectations for text/number/null prices, bounded error indexes, schema-compatible HTTP responses, and text rendering on the public page.

- [ ] **Step 1: Add the client mapping expectation**

Extend the existing mapping fixture so `免费`, `舰长`, and numeric `12.5` remain their original supported types while an omitted value maps to `null`.

```js
assert.equal(mapSongForSync({ title: 'Free', requestPrice: '免费' }).requestPrice, '免费');
assert.equal(mapSongForSync({ title: 'Guard', request_price: '舰长' }).requestPrice, '舰长');
assert.equal(mapSongForSync({ title: 'Legacy', requestPrice: 12.5 }).requestPrice, 12.5);
assert.equal(mapSongForSync({ title: 'Empty' }).requestPrice, null);
```

- [ ] **Step 2: Add remote/IPC error metadata expectations**

Use a mocked `400 {"error":"INVALID_SONG","index":2}` response and assert the thrown `RemoteLicenseError.index` is `2`; assert an unsafe negative, fractional, or huge index is omitted. Invoke the IPC sync handler with a rejected error carrying `index: 2` and assert the renderer receives `{ ok: false, error: 'INVALID_SONG', index: 2 }`.

- [ ] **Step 3: Update server validation expectations**

Replace the old string-price rejection with assertions that the following normalize exactly as shown:

```js
assert.equal(normalizeSong({ title: 'Free', requestPrice: ' 免费 ' }).requestPrice, '免费');
assert.equal(normalizeSong({ title: 'Guard', requestPrice: '舰长' }).requestPrice, '舰长');
assert.equal(normalizeSong({ title: 'Legacy', requestPrice: 12.5 }).requestPrice, '12.5');
assert.equal(normalizeSong({ title: 'Empty', requestPrice: '' }).requestPrice, null);
```

Keep invalid boolean/object/array values and non-finite numbers covered by `INVALID_SONG` with the supplied array index.

- [ ] **Step 4: Add HTTP and public-page regressions**

Send a Device sync containing `免费`, `30元SC`, and `舰长`, assert `200`, read the songs back as strings, and assert the public response passes OpenAPI validation. Load the page helpers and assert `formatPrice('免费') === '免费'`, `formatPrice('舰长') === '舰长'`, and `formatPrice('12.5') === '¥12.5'`.

- [ ] **Step 5: Run the tests and verify the failures identify only the missing behavior**

Run:

```powershell
node --test test/license-manager.test.js test/remote-license-client.test.js test/license-background.test.js
```

from `D:/Work/Live`, and:

```powershell
node --test test/song-library-validation.test.js test/song-library-sync.test.js test/cloud-sync-http.test.js test/public-song-page.test.js
```

from `D:/Work/lira-server`. The new assertions should fail before implementation.

### Task 2: Preserve the free-text value in the desktop sync path

**Files:**

- Modify: `D:/Work/Live/src/electron/license/license-response-utils.js`
- Modify: `D:/Work/Live/src/electron/license/remote-license-client.js`
- Modify: `D:/Work/Live/src/electron/ipc/license-ipc.js`
- Modify: `D:/Work/Live/public/js/admin/import.js`

**Interfaces:**

- Consumes: local song objects with camelCase or legacy snake_case fields and server JSON errors.
- Produces: a request payload whose `requestPrice` is text/finite number/null, `RemoteLicenseError.index` as an optional safe non-negative integer, and an IPC/UI error carrying that index.

- [ ] **Step 1: Replace string coercion in `mapSongForSync`**

Use the canonical field when present, otherwise the legacy alias. Return `null` for missing/null, trim strings, and leave numbers or unsupported values untouched so server validation is not bypassed:

```js
const rawPrice = song.requestPrice !== undefined ? song.requestPrice : song.request_price;
const requestPrice = rawPrice === undefined || rawPrice === null
  ? null
  : typeof rawPrice === 'string'
    ? rawPrice.trim()
    : rawPrice;
```

Keep all other field aliases and boolean handling unchanged.

- [ ] **Step 2: Carry only safe error indexes through the remote client**

Add a `normalizeErrorIndex` helper accepting only `Number.isSafeInteger(index) && index >= 0`. Let `RemoteLicenseError` copy that value from `options.index`. When parsing structured HTTP errors in `requestWithBody` and `readStreamError`, pass `index: normalizeErrorIndex(data.index)` and never copy any other response fields.

- [ ] **Step 3: Preserve the index at the IPC boundary**

Add a bounded `safeErrorIndex` helper in `license-ipc.js`. Include `index` in the catch response only when valid, and let `sanitizeSyncResponse` copy the same bounded index for structured results. Do not expose arbitrary error text or response objects.

- [ ] **Step 4: Render an actionable admin message**

When the sync response is not OK, construct an error with its `code` and safe `index` before throwing. Display `第 N 首歌曲的字段格式无效，请检查点歌价格、启用状态或排序后重试。` for `INVALID_SONG`; retain existing generic/network messages for other codes. Keep confirmation, snapshot timing, retry state, and local last-sync storage unchanged.

- [ ] **Step 5: Run the client-focused checks**

```powershell
node --test test/license-manager.test.js test/remote-license-client.test.js test/license-background.test.js test/license-ui.test.js
node scripts/check-js.js
```

### Task 3: Normalize server prices and migrate old SQLite schemas

**Files:**

- Modify: `D:/Work/lira-server/src/lib/song-library.js`
- Modify: `D:/Work/lira-server/src/storage/streamer-storage.js`
- Modify: `D:/Work/lira-server/test/song-library-validation.test.js`
- Modify: `D:/Work/lira-server/test/song-library-sync.test.js`
- Create or modify: `D:/Work/lira-server/test/song-request-price-migration.test.js`

**Interfaces:**

- Consumes: Device/Streamer/Admin song writes and existing `songs.db` files whose `request_price` declaration may be `REAL`.
- Produces: normalized nullable text in all song DTOs, a fresh `TEXT` column, and an idempotent migration preserving rows, ids, sequence, and indexes.

- [ ] **Step 1: Implement server price normalization**

Replace numeric-only `cleanPrice` with:

```js
function cleanPrice(value, index) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? text.slice(0, 1000) : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw invalidSong(index);
}
```

Use it for both canonical and legacy aliases; do not convert booleans or objects.

- [ ] **Step 2: Change the fresh schema and missing-column addition to `TEXT`**

Declare `request_price TEXT` in `initSongDb` and use `TEXT` when adding it to a legacy table. Keep nullable semantics consistent with existing reads/writes.

- [ ] **Step 3: Rebuild an existing non-text column transactionally**

When `PRAGMA table_info(songs)` reports a non-text `request_price`, execute one `BEGIN IMMEDIATE` transaction that drops/recreates the known `idx_songs_order`, renames the old table, creates the canonical schema with `request_price TEXT`, copies every existing column with explicit `id` and `CAST(request_price AS TEXT)`, drops the legacy table, recreates the index, and commits. Roll back on any error. Re-run initialization after commit and assert the declaration is `TEXT`.

- [ ] **Step 4: Add migration coverage**

Create an in-memory legacy table with `request_price REAL`, two rows (`12.5` and `免费`), the order index, and a non-default id. Call the storage initializer twice; assert `PRAGMA table_info` reports `TEXT`, ids/order/data are unchanged, `sqlite_sequence` remains at least the prior maximum, the index exists, and `PRAGMA integrity_check` returns `ok`.

- [ ] **Step 5: Run storage and library checks**

```powershell
node --test test/song-library-validation.test.js test/song-library-sync.test.js test/song-request-price-migration.test.js
```

### Task 4: Update public rendering and all normative wire contracts

**Files:**

- Modify: `D:/Work/lira-server/public/song/app.js`
- Modify: `D:/Work/lira-server/docs/protocol/client-server-api.md`
- Modify: `D:/Work/lira-server/docs/protocol/management-api.md`
- Modify: `D:/Work/lira-server/docs/protocol/error-codes.md`
- Modify: `D:/Work/lira-server/docs/protocol/device-api.openapi.json`
- Modify: `D:/Work/lira-server/docs/protocol/management-api.openapi.json`
- Modify: `D:/Work/lira-server/docs/protocol/public-song-page-api.openapi.json`
- Modify: `D:/Work/lira-server/docs/requirements/system-rules.md`
- Modify: `D:/Work/lira-server/docs/requirements/acceptance-criteria.md`
- Modify: `D:/Work/lira-server/docs/requirements/traceability.md`
- Create: `D:/Work/lira-server/docs/architecture/decisions/0028-song-request-price-text.md`
- Modify: `D:/Work/lira-server/docs/architecture/decisions/README.md`

**Interfaces:**

- Consumes: the final normalized server behavior and existing requirement ids `REQ-SONG-001`, `AC-SONG-001`, and `INVALID_SONG`.
- Produces: synchronized normative descriptions and schemas that accept `string | number | null` on input and expose `string | null` on stored/read song responses.

- [ ] **Step 1: Render text without a bogus currency prefix**

Make `formatPrice` trim text, hide empty/zero numeric values, format positive numeric text with the existing `¥` convention, and return descriptive text unchanged. Remove the template’s unconditional `¥` prefix and continue using `escapeHtml`.

- [ ] **Step 2: Update protocol prose and schemas**

Document that sync inputs accept trimmed free-text strings, finite legacy numbers, `null`, or omission; blank strings normalize to `null`; stored/read `requestPrice` is `string | null`. Keep `INVALID_SONG` for unsupported types and retain the response `index` field. Update all three OpenAPI song schemas and examples accordingly.

- [ ] **Step 3: Record the architectural decision**

Add ADR-0028 explaining why the server follows the already-established local free-text meaning, how legacy REAL databases are migrated, and why numeric clients remain accepted. Link it from the decisions README without changing unrelated ADR conclusions.

- [ ] **Step 4: Run contract and public-page checks**

```powershell
node --test test/cloud-sync-http.test.js test/public-song-page.test.js test/song-page-title.test.js test/documentation-governance.test.js test/device-protocol-contract.test.js
```

### Task 5: Final cross-repository acceptance

**Files:**

- Review only the task-owned diff in both repositories; do not rewrite unrelated working-tree changes.

**Interfaces:**

- Consumes: all implementations, tests, and updated normative documents from Tasks 1–4.
- Produces: a verified, reviewable fix with no generated or secret files added.

- [ ] **Step 1: Run focused suites and syntax checks**

```powershell
# D:/Work/Live
node --test test/license-manager.test.js test/remote-license-client.test.js test/license-background.test.js test/license-ui.test.js
node scripts/check-js.js

# D:/Work/lira-server
node --test test/song-library-validation.test.js test/song-library-sync.test.js test/song-request-price-migration.test.js test/cloud-sync-http.test.js test/public-song-page.test.js
```

- [ ] **Step 2: Inspect the final diff and repository state**

```powershell
git diff --check
git status --short
git diff --stat
```

Confirm no runtime database, output directory, credential, or unrelated pre-existing edit entered the task diff. If a check fails because of an unrelated dirty-tree change, report the exact file and preserve it.

**Done When:** A local song snapshot containing empty, numeric, and Chinese free-text prices synchronizes successfully through Device and Streamer routes; existing REAL databases upgrade idempotently with intact data/indexes; invalid song errors identify a safe array index in the UI; the public page displays descriptive prices correctly; all affected tests and protocol/governance checks pass; and both working-tree diffs are reviewed without commits.
