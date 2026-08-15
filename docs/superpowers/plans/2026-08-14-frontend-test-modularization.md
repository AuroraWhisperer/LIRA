# Frontend Regression Test Modularization Plan

**Goal:** Replace the 2547-line frontend regression test file with focused domain test files while preserving every test and assertion.

**Architecture:** Group tests by admin/AI, gifts, admin shell, playback, queue overlay, and song board. Move only the shared VM module loader and tiny test factories into a helper module; keep test bodies unchanged.

**Tech Stack:** CommonJS, `node:test`, Node.js VM modules

## Constraints

- Preserve all 73 existing test names and bodies exactly.
- Do not change production behavior in this batch.
- Keep each resulting test file below 700 lines.
- Ensure the full suite discovers all replacement files.

### Task 1: Extract shared test helpers

**Files:**
- Create: `test/helpers/frontend-modules.js`

- [x] Move the VM module loader, response helper, and lyric toggle factory.

### Task 2: Split tests by domain

**Files:**
- Delete: `test/frontend-regressions.test.js`
- Create: `test/frontend-admin-ai.test.js`
- Create: `test/frontend-gifts.test.js`
- Create: `test/frontend-admin-shell.test.js`
- Create: `test/frontend-playback.test.js`
- Create: `test/frontend-queue.test.js`
- Create: `test/frontend-song-board.test.js`

- [x] Move every test exactly once and retain the common source helpers.
- [x] Confirm every resulting file remains below 700 lines.

### Task 3: Verify discovery and behavior

- [x] Run all six focused frontend test files.
- [x] Run `npm run check` and `npm test`.
