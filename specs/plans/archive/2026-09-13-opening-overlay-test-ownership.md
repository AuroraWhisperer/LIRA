# Opening Overlay Test Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the next client modularity batch A item by separating opening media upload and serving API tests from the admin/OBS opening surface tests without changing production behavior or test coverage.

**Architecture:** Keep admin configuration, persisted settings, startup defaults, overlay assets, and OBS rendering contracts in `opening-overlay.test.js`. Create `opening-upload-api.test.js` for the music upload, character upload, write authentication, and selected-file serving contracts. Keep fixtures local to their owning file because the split creates no genuine cross-file fixture reuse.

**Tech Stack:** Node.js 24 test runner, CommonJS test files, filesystem-backed temporary test data.

## Global Constraints

- Move the three existing upload/serving tests without changing names, assertions, fake inputs, or production source.
- Preserve the seven frontend/overlay tests and their current order.
- Remove only imports made unused by the move.
- Keep both files independently runnable and automatically discoverable by the repository-wide `test` script.
- Preserve unrelated dirty-worktree changes and do not create commits without explicit user authorization.

---

## Non-goals

- No refactor of opening routes, settings persistence, overlay code, or admin UI.
- No split between the admin and OBS assertions that intentionally meet in the same configuration tests.
- No shared test-helper module unless the completed split reveals real cross-file reuse.
- No change to `test:admin`; it is an explicit shell/AI/overtime grouping and does not currently own opening tests.

## Current Behavior

- `test/opening-overlay.test.js` contains 10 tests and 779 physical lines.
- The first seven tests cover assets/routes, frame policy, OBS rendering, admin configuration, defaults, settings validation, and per-session startup state.
- The final three tests cover music upload/delete, character upload/signature validation/delete, write authentication, and selected-character file serving.
- The current combined baseline passes all 10 tests.

## Ownership

- Frontend and OBS opening contract owner: `test/opening-overlay.test.js`.
- Opening upload and protected media-serving contract owner: new `test/opening-upload-api.test.js`.
- Production owners remain `src/server/routes/opening-routes.js`, `src/server/api-routes.js`, and `src/server/http-utils.js`; they are read-only for this task.
- Repository-wide test discovery remains the argument-free `node --test` command in `package.json`.

## Compatibility Constraints

- Before and after inventories must contain the same 10 unique test names with no duplicates.
- The three moved tests must retain their current order.
- `opening-overlay.test.js` must not retain stream, upload-authentication, or character-serving imports made unused by the move.
- Temporary directories must continue to be isolated and removed in each test's existing `finally` block.
- Authentication status, response payloads, stored filenames, signature checks, and selected-file serving assertions must remain unchanged.

## Proposed Changes

- Create `test/opening-upload-api.test.js` with the minimal Node core and server imports plus the final three existing tests.
- Remove those three tests from `test/opening-overlay.test.js`.
- Remove only `Readable`, `Writable`, `serveOpeningCharacter`, and `handleApi` from the original file after the copied tests pass independently.
- Leave `package.json` unchanged because default test discovery already includes both filenames.

## Milestones

### Task 1: Capture the current contract

**Files:**

- Inspect: `test/opening-overlay.test.js`

**Verification:**

- [x] Enumerate 10 current test names and confirm the split begins at `opening music uploads stay inside the configured data directory`.
- [x] Run `node --experimental-vm-modules --test test/opening-overlay.test.js` and record 10 passing tests.
- [x] Do not manufacture a failing behavior test: this is a test-only ownership move; the red condition is the absent focused upload file and the mixed ownership inventory.

### Task 2: Move the upload and serving contracts

**Files:**

- Create: `test/opening-upload-api.test.js`
- Modify: `test/opening-overlay.test.js`

**Verification:**

- [x] Copy the final three tests into the new file with only their required imports.
- [x] Run the new file while the original tests still exist and confirm all three copied tests pass.
- [x] Remove the original test block and imports made unused by the move.
- [x] Compare before/after test-name inventories and fail on a missing, added, renamed, or duplicate name.

### Task 3: Verify focused discovery and final scope

**Files:**

- Modify: this plan with execution results.

**Verification:**

- [x] Run both split files together and expect 10 passes: seven frontend/overlay and three upload/API.
- [x] Run Prettier 3.7.4 on both test files and this plan.
- [x] Run `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Execution Results

- The pre-move `opening-overlay.test.js` run passed all 10 tests.
- The copied `opening-upload-api.test.js` passed all three tests before the original block was removed.
- After the move, the two files passed 10 tests together: seven frontend/overlay and three upload/API.
- Comparing the post-move names with the original Git inventory found zero missing, added, renamed, or duplicate names.
- `opening-overlay.test.js` is now 521 lines and `opening-upload-api.test.js` is 266 lines.
- Prettier 3.7.4 and `npm run check` passed; the scoped diff and worktree status were reviewed, and `git diff --check` reported no whitespace errors.
- `package.json` was intentionally unchanged because the default repository-wide test command discovers both files automatically.

## Verification

- `node --experimental-vm-modules --test test/opening-overlay.test.js`
- `node --experimental-vm-modules --test test/opening-upload-api.test.js`
- `node --experimental-vm-modules --test test/opening-overlay.test.js test/opening-upload-api.test.js`
- Exact test-name inventory comparison against the current 10-name baseline
- Prettier 3.7.4 `--check` for both test files and this plan
- `npm run check`
- `git diff --check`

## Rollback Or Failure Handling

If the move loses or changes a contract, stop and compare both files with the recorded 10-name baseline. Reverse only the new file and moved hunks with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The same 10 test names pass across the two files with no duplicates.
- `opening-overlay.test.js` owns seven frontend/overlay tests and no upload-only dependencies.
- `opening-upload-api.test.js` owns the three upload/authentication/serving tests and stays independently runnable.
- Formatting, JavaScript checks, diff checks, and scoped review pass without production changes.
