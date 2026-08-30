# Song Request Price Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent free-text `点歌价格` column to song Excel/CSV imports and exports so values such as `免费`, `心动`, `30元SC`, `舰长`, and `冠歌` survive import and later export.

**Architecture:** Store the value as `songs.request_price TEXT NOT NULL DEFAULT ''`. Append an idempotent song-database migration for existing installations, then extend the existing import schema and file codec without changing point-song eligibility or queue behavior.

**Tech Stack:** Node.js 24+, CommonJS, `node:sqlite`, the repository's zero-dependency XLSX codec, Node test runner.

## Global Constraints

- Preserve existing HTTP routes, workbook filename, worksheet name, and the meanings of all eight current song columns.
- Treat `点歌价格` as descriptive free text only; do not enforce pricing or point-song eligibility.
- Do not add a UI field, runtime dependency, process, or service.
- Preserve the field when an existing song is edited through a caller that does not send it.
- Do not commit, branch, tag, publish, or touch real user databases.

---

### Task 1: Lock the import/export contract with tests

**Files:**

- Modify: `test/song-file-codec.test.js`
- Create: `test/song-import-table.test.js`

**Interfaces:**

- Consumes: `buildSongsCsv(rows)`, `buildSongsWorkbook(rows)`, `parseSongsFromXlsx(buffer)`, `normalizeImportedSongRow(row)`.
- Produces: a regression proving `request_price: '30元SC'` exports under `点歌价格` and normalizes to `requestPrice: '30元SC'`.
- Produces: a regression proving headered and positional CSV/TSV parsing retains the ninth column.

- [x] **Step 1: Extend the existing codec round-trip fixture**

```js
request_price: '30元SC';
```

Add `requestPrice: '30元SC'` to the normalized expected object and assert the CSV contains the new header/value.

- [x] **Step 2: Run the focused test and confirm the new assertion fails**

Run: `node --test test/song-file-codec.test.js`

Expected: FAIL because the current schema has no `点歌价格` column or `requestPrice` normalization.

### Task 2: Add compatible persistence

**Files:**

- Modify: `src/storage/schema.js`
- Modify: `src/storage/database.js`
- Modify: `src/music/song-service.js`
- Modify: `test/database-maintenance.test.js`

**Interfaces:**

- Consumes: `createDatabases({ dataDir })`, the append-only `song_db` migration list, and song service inputs with optional `requestPrice` / `request_price`.
- Produces: `songs.request_price TEXT NOT NULL DEFAULT ''` on fresh and upgraded databases; save/import paths persist it.

- [x] **Step 1: Make the migration expectation fail at v4**

Update the pre-v1 upgrade test to expect `songDb: 4`, select `request_price`, and assert the legacy row receives `''` without changing its existing fields.

- [x] **Step 2: Append the migration and fresh-schema column**

```js
(db) => {
  ensureSongRequestPriceColumn(db);
};
```

The helper checks `PRAGMA table_info(songs)` before running:

```sql
ALTER TABLE songs ADD COLUMN request_price TEXT NOT NULL DEFAULT ''
```

- [x] **Step 3: Persist the field in save and bulk-import SQL**

Normalize the two accepted input spellings with `cleanText`. On updates, retain the existing stored value when neither spelling is present; on inserts, default to `''`.

- [x] **Step 4: Run storage and codec tests**

Run: `node --test test/database-maintenance.test.js test/song-file-codec.test.js`

Expected: PASS, including two consecutive database startups and `PRAGMA integrity_check = ok`.

### Task 3: Extend the workbook/CSV schema

**Files:**

- Modify: `src/music/song-import-schema.js`
- Modify: `src/music/song-file-codec.js`
- Modify: `public/js/admin/import.js`

**Interfaces:**

- Consumes: database/API row property `request_price` and import aliases.
- Produces: ninth header `点歌价格`, normalized property `requestPrice`, and sample values illustrating supported free-text entries.

- [x] **Step 1: Append the header and aliases**

```js
requestPrice: [
  'requestPrice',
  'request_price',
  '点歌价格',
  '点歌价',
  '点歌门槛',
  '点歌要求',
];
```

Append `点歌价格` after `核对备注` to avoid shifting the eight existing positional columns.

- [x] **Step 2: Extend row mapping and examples**

Export `song.request_price || ''`. Give the two template sample rows representative values `免费` and `心动 / 30元SC / 舰长 / 冠歌`; arbitrary strings remain accepted.

- [x] **Step 3: Run the focused test**

Run: `node --test test/song-file-codec.test.js`

Expected: PASS for CSV and XLSX round trips.

### Task 4: Synchronize owner documentation and verify

**Files:**

- Modify: `docs/architecture/backend/storage.md`
- Modify: `docs/architecture/backend/music/services.md`
- Modify: `docs/architecture/frontend/app.md`

**Interfaces:**

- Consumes: final migration number, column name, header order, and aliases.
- Produces: owner documentation matching the implemented persistence and import/export contracts.

- [x] **Step 1: Update the storage fact map**

Document `songs.request_price`, `song_db` v4, and its idempotent column-add migration.

- [x] **Step 2: Update the music import/export contract**

Document nine columns and the new free-text alias/normalization mapping.

- [x] **Step 3: Run proportional verification**

Run:

```powershell
node --test test/song-file-codec.test.js test/database-maintenance.test.js
npm run check
git diff --check
git status --short
```

Generate the template through `buildSongsWorkbook(templateSongs())`, import/render it with the bundled spreadsheet runtime, and visually verify the single `歌库` sheet shows the ninth header and unclipped sample values.
