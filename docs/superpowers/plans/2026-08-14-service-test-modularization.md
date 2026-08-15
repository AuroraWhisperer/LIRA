# Playback and Gift Test Modularization Plan

**Goal:** Split the remaining 886-line playback queue and 790-line gift service tests into focused files with reusable fixtures.

**Architecture:** Extract the large browser playback fixture into a test helper, group playback behavior separately from persistence/lifecycle, and group gift capture/deduplication separately from blind-box analysis and database migrations.

**Tech Stack:** CommonJS, `node:test`, Node.js VM modules, SQLite test databases

## Constraints

- Preserve every existing test name and assertion.
- Keep temporary database cleanup behavior unchanged.
- Do not change production code.
- Keep resulting test files below 700 lines.

### Task 1: Split playback queue tests

- [x] Create `test/helpers/playback-app.js` from the existing fixture code.
- [x] Create focused playback behavior and persistence test files.
- [x] Remove the original combined playback queue test file.

### Task 2: Split gift service tests

- [x] Create capture/deduplication and analysis/migration test files.
- [x] Keep the database repair helper beside the migration tests.
- [x] Remove the original combined gift service test file.

### Task 3: Verify all replacements

- [x] Run all replacement files and confirm the original test count is preserved.
- [x] Run `npm run check` and `npm test`.
