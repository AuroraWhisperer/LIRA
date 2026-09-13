# Frontend Overtime Test Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the next client modularity batch A item by moving six overtime console and rule-editor contract tests out of the queue test file into a focused frontend overtime test file without changing production behavior or test coverage.

**Architecture:** Keep queue theme, rendering, scrolling, and identity behavior in `frontend-queue.test.js`. Create `frontend-overtime.test.js` for the composed overtime panel, controller/editor boundary, save-state controls, duration parsing, and structured rule UI; existing behavioral tests such as `overtime-gift-picker.test.js` remain intact.

**Tech Stack:** Node.js 24 test runner, CommonJS test files, VM-based frontend module inspection.

## Global Constraints

- Move the six existing tests byte-for-byte except for imports and formatting required by the new file.
- Preserve every assertion, test name, fake input, and source path.
- Do not change production JavaScript, CSS, HTML, settings, or runtime behavior.
- Keep `test:admin` aware of the new file because that script uses an explicit file list.
- Preserve unrelated dirty-worktree changes and do not create commits without explicit user authorization.

---

## Non-goals

- No split of `overtime-gift-picker.test.js`, `overtime-rule-editor.test.js`, or production overtime modules.
- No second-stage split of the remaining queue style tests.
- No assertion cleanup, helper redesign, or replacement of static contract tests with isolated unit tests.

## Current Behavior

- `test/frontend-queue.test.js` contains 28 tests and 1,927 physical lines.
- Six consecutive tests from `overtime toolbox panel loads its isolated controller and renders untrusted labels safely` through `overtime gift rules use novice-friendly structured controls` occupy lines 1212–1572.
- Queue-specific tests resume immediately afterward with `identity queue shows the actual room medal name for a requester without guard status`.
- Only the overtime block uses `readOvertimeAdminSource()` and `loadModuleExports()`.

## Ownership

- Queue behavior owner: `test/frontend-queue.test.js`.
- Frontend overtime contract owner: new `test/frontend-overtime.test.js`.
- Existing detailed picker owner: `test/overtime-gift-picker.test.js`.
- Existing editor behavior owner: `test/overtime-rule-editor.test.js`.
- Test discovery owner: `package.json` scripts.

## Compatibility Constraints

- Before and after test-name inventories must contain the same 28 unique names across the two files.
- The six moved tests must retain their current order.
- The queue file must not retain overtime imports, helpers, or tests made unused by the move.
- Pre-existing unused imports unrelated to this move are not part of the cleanup scope.
- Both files must remain independently runnable with `node --experimental-vm-modules --test`.

## Proposed Changes

- Create `test/frontend-overtime.test.js` with the minimal CommonJS imports, `ROOT_DIR`, `readOvertimeAdminSource()`, and the six existing tests.
- Remove that helper and six-test block from `test/frontend-queue.test.js`.
- Remove only `loadModuleExports` from the queue file's frontend helper import because this move makes it unused there.
- Add `test/frontend-overtime.test.js` to the explicit `test:admin` command.

## Milestones

### Task 1: Capture the pre-move contract

**Files:**

- Inspect: `test/frontend-queue.test.js`

**Interfaces:**

- Consumes: current Node test output and test-name inventory.
- Produces: a baseline of 28 passing names, including exactly six consecutive overtime names.

- [x] Run `node --experimental-vm-modules --test test/frontend-queue.test.js` and record 28 passing tests.
- [x] Enumerate `test(...)` declarations and confirm the split boundaries at lines 1212 and 1573 of the current formatted file.
- [x] Do not manufacture a failing behavioral test: this is a test-only ownership move with no intended behavior change; the red condition is the currently absent focused file and the mixed-domain source inventory.

### Task 2: Move the overtime contract tests

**Files:**

- Create: `test/frontend-overtime.test.js`
- Modify: `test/frontend-queue.test.js`

**Interfaces:**

- Consumes: `readAdminHtml()`, Node core `assert`, `fs`, `path`, `test`, `vm`, and `loadModuleExports()`.
- Produces: six independently runnable frontend overtime tests; the original queue file retains 22 queue tests.

- [x] Copy the six overtime tests and `readOvertimeAdminSource()` into the new file with only their required imports.
- [x] Run the new file while the original block is still present and confirm all six copied tests pass.
- [x] Remove the original block, `readOvertimeAdminSource()`, and the newly unused `loadModuleExports` queue import.
- [x] Compare test names across both files and fail if any baseline name is missing, duplicated, or renamed.

### Task 3: Preserve focused discovery and verify

**Files:**

- Modify: `package.json`
- Modify: this plan with execution results.

**Interfaces:**

- Consumes: the repository's explicit admin test command.
- Produces: continued focused discovery of both queue-adjacent and overtime frontend contracts.

- [x] Add `test/frontend-overtime.test.js` to `test:admin`.
- [x] Run both split files together and expect 28 passes: 22 queue and 6 overtime.
- [x] Run `npm run test:admin` and expect zero failures.
- [x] Run Prettier 3.7.4 on the touched JavaScript, JSON, and Markdown files.
- [x] Run `npm run check`, `git diff --check`, and inspect `git status --short`.

## Execution Results

- The pre-move `frontend-queue.test.js` run passed all 28 tests.
- The copied `frontend-overtime.test.js` passed all six tests before the original block was removed.
- After the move, the two files passed 28 tests together: 22 queue and six overtime.
- Comparing against the original Git test-name inventory found zero missing, added, renamed, or duplicate names.
- `frontend-queue.test.js` is now 1,543 lines and `frontend-overtime.test.js` is 395 lines.
- `npm run test:admin` passed 80 tests, including the new focused file.
- `npm run check` passed syntax validation for 618 JavaScript files.

## Verification

- `node --experimental-vm-modules --test test/frontend-queue.test.js`
- `node --experimental-vm-modules --test test/frontend-overtime.test.js`
- `node --experimental-vm-modules --test test/frontend-queue.test.js test/frontend-overtime.test.js`
- `npm run test:admin`
- `npm run check`
- Prettier 3.7.4 `--check` for `package.json`, both test files, and this plan
- `git diff --check`

## Rollback Or Failure Handling

If the split loses or changes a test, stop and compare the current file contents to the pre-move test-name inventory. Reverse only the new file, package script entry, and moved hunks with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The same 28 test names pass across the two files with no duplicates.
- `frontend-queue.test.js` contains only queue-related tests and no overtime helper.
- `frontend-overtime.test.js` contains the six moved contracts and stays below 600 lines.
- `test:admin`, formatting, JavaScript checks, and diff checks pass.
