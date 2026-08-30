# Song Clip Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent free-text `歌切` column to song Excel/CSV imports and exports so a clip link, BV identifier, timestamp, or other note survives import and later export.

**Architecture:** Store the value as `songs.song_clip TEXT NOT NULL DEFAULT ''`, appended after the existing `request_price` field. Add an idempotent `song_db` v5 migration, then extend the established XLSX/CSV/text import path without changing queue or point-song behavior.

**Tech Stack:** Node.js 24+, CommonJS, `node:sqlite`, the repository XLSX codec, Node test runner.

## Global Constraints

- Preserve the existing nine columns and append `歌切` as column ten.
- Treat `歌切` as optional free text only; do not validate URLs or change point-song behavior.
- Preserve existing `song_clip` when an edit caller omits the field.
- Do not add a UI editor, runtime dependency, process, or service.
- Do not commit or touch real user databases.

---

### Task 1: Lock the new contract with tests

**Files:**

- Modify: `test/song-file-codec.test.js`
- Modify: `test/song-import-table.test.js`
- Modify: `test/database-maintenance.test.js`

**Interfaces:**

- Consumes: `buildSongsCsv`, `buildSongsWorkbook`, `parseSongsFromXlsx`, `normalizeImportedSongRow`, `songService.importSongs`, `songService.saveSong`, `createDatabases`.
- Produces: regression coverage for column ten, persistence, edit preservation, and v5 legacy migration.

- [x] **Step 1: Add the codec/service assertions**

Use `song_clip: 'BV1SongClip'` and expect normalized `songClip: 'BV1SongClip'`, stored `song_clip`, and preservation after an edit that omits it.

- [x] **Step 2: Add text-import and migration assertions**

Assert headered and positional TSV imports read column index 9, and pre-v1 databases upgrade to `songDb: 5` with legacy `song_clip: ''`.

- [x] **Step 3: Run the focused tests and confirm failure**

Run: `node --test test/song-file-codec.test.js test/song-import-table.test.js test/database-maintenance.test.js`

Expected: FAIL because the tenth column, `song_clip` schema, and v5 migration do not exist yet.

### Task 2: Implement the permanent column

**Files:**

- Modify: `src/music/song-import-schema.js`
- Modify: `src/music/song-file-codec.js`
- Modify: `public/js/admin/import.js`
- Modify: `src/music/song-service.js`
- Modify: `src/storage/schema.js`
- Modify: `src/storage/database.js`

**Interfaces:**

- Consumes: import keys `songClip` / `song_clip` and database row property `song_clip`.
- Produces: header `歌切`, normalized `songClip`, persistent `songs.song_clip`, and export mapping.

- [x] **Step 1: Append header and aliases**

```js
songClip: ['songClip', 'song_clip', '歌切', '歌切链接', '歌曲切片', '切片链接'];
```

- [x] **Step 2: Extend workbook, CSV, and text row mapping**

Append `song.song_clip || ''` after `request_price`; use fixed positional index `9` when no header exists and width `20` for column J.

- [x] **Step 3: Append persistence and migration**

Add `song_clip TEXT NOT NULL DEFAULT ''` to the fresh schema. Append v5 using a `PRAGMA table_info(songs)` guard before:

```sql
ALTER TABLE songs ADD COLUMN song_clip TEXT NOT NULL DEFAULT ''
```

Persist the value on inserts/imports and preserve it when edit payloads omit both accepted key spellings.

- [x] **Step 4: Run the focused tests**

Run: `node --test test/song-file-codec.test.js test/song-import-table.test.js test/database-maintenance.test.js`

Expected: PASS.

### Task 3: Synchronize documentation and verify the generated template

**Files:**

- Modify: `docs/architecture/backend/storage.md`
- Modify: `docs/architecture/backend/music/services.md`
- Modify: `docs/architecture/frontend/app.md`

**Interfaces:**

- Consumes: final ten-column order, aliases, storage column, and migration version.
- Produces: owner documentation matching code and a visually verified template.

- [x] **Step 1: Update owner documents**

Document `songs.song_clip`, `song_db` v5, the ten-column order, and text-import mapping.

- [x] **Step 2: Inspect and render the generated workbook**

Generate the application template, inspect `歌库!A1:J3`, scan formula errors, and render the only sheet to confirm the `歌切` header is visible and not clipped.

- [x] **Step 3: Run final verification**

Run `npm run verify:quick`, the server smoke test, `git diff --check`, and `git status --short`.
