# Song Request Price Column Implementation Plan

**Status:** Completed.

**复核日期：** 2026-09-28。按原文完成/执行及验证记录归档；原测试结果仅代表记录时点，本次未重跑历史任务。

当前依据：[所属规格或参考](../../song-request-metadata.md)。状态索引见 [计划入口](../README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

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

- Modify: `test/songs/song-file-codec.test.js`
- Create: `test/songs/song-import-table.test.js`

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

Run: `node --test test/songs/song-file-codec.test.js`

Expected: FAIL because the current schema has no `点歌价格` column or `requestPrice` normalization.

### Task 2: Add compatible persistence

**Files:**

- Modify: `src/storage/schema.js`
- Modify: `src/storage/database.js`
- Modify: `src/music/song-service.js`
- Modify: `test/storage/database-maintenance.test.js`

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

Run: `node --test test/storage/database-maintenance.test.js test/songs/song-file-codec.test.js`

Expected: PASS, including two consecutive database startups and `PRAGMA integrity_check = ok`.

### Task 3: Extend the workbook/CSV schema

**Files:**

- Modify: `src/music/song-import-schema.js`
- Modify: `src/music/song-file-codec.js`
- Modify: `public/js/admin/song-import.js`

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

Run: `node --test test/songs/song-file-codec.test.js`

Expected: PASS for CSV and XLSX round trips.

### Task 4: Synchronize owner documentation and verify

**Files:**

- Modify: `docs/reference/backend/storage.md`
- Modify: `docs/reference/backend/music/services.md`
- Modify: `docs/reference/frontend/app.md`

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
node --test test/songs/song-file-codec.test.js test/storage/database-maintenance.test.js
npm run check
git diff --check
git status --short
```

Generate the template through `buildSongsWorkbook(templateSongs())`, import/render it with the bundled spreadsheet runtime, and visually verify the single `歌库` sheet shows the ninth header and unclipped sample values.
