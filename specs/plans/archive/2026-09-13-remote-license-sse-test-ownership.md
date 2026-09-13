# Remote License SSE Test Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the next client modularity batch A item by separating remote-license SSE parsing and reader-lifecycle tests from HTTP request and error-contract tests without changing production behavior or coverage.

**Architecture:** Keep activation, origin policy, JSON responses, error sanitization, fixed HTTP endpoints, and caller cancellation in `remote-license-client.test.js`. Create `remote-license-event-stream.test.js` for cloud-state and gift SSE framing, bounds validation, field allowlisting, and reader cancellation/release. Both files exercise the same production client directly and need no shared helper module.

**Tech Stack:** Node.js 24 test runner, CommonJS tests, Fetch API `Response` and `ReadableStream` fixtures.

## Global Constraints

- Move the five existing event-stream tests without changing names, assertions, fake payloads, or production source.
- Preserve the 15 HTTP request/error tests and their current order.
- Do not extract a helper that would merely wrap the shared `createRemoteLicenseClient` import.
- Keep both files independently runnable and automatically discoverable by the repository-wide `test` script.
- Preserve unrelated dirty-worktree changes and do not create commits without explicit user authorization.

---

## Non-goals

- No refactor of `src/electron/license/remote-license-client.js`.
- No behavior changes to URL policy, authentication headers, timeouts, cancellation, payload validation, or SSE limits.
- No split of individual cloud-state or gift-stream scenarios into smaller tests.
- No change to `package.json`; its argument-free default test command already discovers both files.

## Current Behavior

- `test/remote-license-client.test.js` contains 20 tests and 753 physical lines.
- Five non-contiguous tests own the SSE protocol surface: two cloud-state stream tests, reader cleanup on consumer failure, and two gift-event stream tests.
- The remaining 15 tests own HTTPS origins, JSON HTTP contracts, sanitized errors, fixed Device endpoints, bounded queries, and caller abort propagation.
- The current combined baseline passes all 20 tests.

## Ownership

- Remote HTTP request/error contract owner: `test/remote-license-client.test.js`.
- Remote SSE protocol/lifecycle owner: new `test/remote-license-event-stream.test.js`.
- Production owner remains `src/electron/license/remote-license-client.js`; it is read-only for this task.
- Test discovery owner remains the default `test` script in `package.json`.

## Compatibility Constraints

- Before and after inventories must contain the same 20 unique test names with no duplicates.
- Event-stream tests must retain their original relative order.
- HTTP tests before, between, and after the moved blocks must retain their original relative order.
- `RemoteLicenseError` remains in the HTTP file; the event-stream file imports only `createRemoteLicenseClient` from production.
- SSE frame chunking, maximum-size failures, sync-epoch validation, field filtering, authentication headers, and reader cleanup assertions must remain unchanged.

## Proposed Changes

- Create `test/remote-license-event-stream.test.js` with `assert`, `test`, `createRemoteLicenseClient`, and the five existing SSE tests.
- Remove those five tests from `test/remote-license-client.test.js` without changing any remaining test.
- Leave imports in the original file unchanged because both exported symbols remain in use.
- Leave `package.json` unchanged because the default test command discovers both filenames.

## Milestones

### Task 1: Capture the current contract

**Files:**

- Inspect: `test/remote-license-client.test.js`

**Interfaces:**

- Consumes: the current Node test output and declared test-name inventory.
- Produces: a 20-name baseline and a five-name SSE move set.

- [x] Enumerate the current 20 test names and identify the five event-stream tests by their exact names.
- [x] Run `node --experimental-vm-modules --test test/remote-license-client.test.js` and record 20 passing tests.
- [x] Do not manufacture a failing behavior test: this is a test-only ownership move; the red condition is the absent focused stream file and mixed source inventory.

### Task 2: Copy and validate the SSE contracts

**Files:**

- Create: `test/remote-license-event-stream.test.js`

**Interfaces:**

- Consumes: `createRemoteLicenseClient(options)` and standard Fetch stream fixtures.
- Produces: five independently runnable SSE parsing, validation, and cleanup tests.

- [x] Copy these tests in their existing relative order: `cloud state event stream uses DeviceBearer and parses revision-only SSE frames`; `cloud state event stream rejects non-SSE and oversized event data`; `SSE readers are cancelled and released when a consumer fails during open`; `gift event stream allowlists valid SSE fields and ignores malformed blocks`; `gift event stream rejects an oversized sync epoch header`.
- [x] Run the new file while the original tests still exist and confirm all five copied tests pass.

### Task 3: Remove duplicate ownership and verify discovery

**Files:**

- Modify: `test/remote-license-client.test.js`
- Modify: this plan with execution results.

**Interfaces:**

- Consumes: the 20-name baseline and the independently passing stream file.
- Produces: 15 HTTP tests plus five stream tests with unchanged aggregate coverage.

- [x] Remove only the five copied test blocks from the original file.
- [x] Compare the aggregate names with the 20-name baseline and fail on a missing, added, renamed, or duplicate name.
- [x] Run both split files together and expect 20 passes: 15 HTTP and five SSE.
- [x] Run Prettier 3.7.4 on both test files and this plan.
- [x] Run `npm run check`.
- [x] Run `git diff --check` and inspect `git status --short` plus the scoped diff.

## Execution Results

- The pre-move `remote-license-client.test.js` run passed all 20 tests.
- The copied `remote-license-event-stream.test.js` passed all five tests before the original blocks were removed.
- After the move, the two files passed 20 tests together: 15 HTTP and five SSE.
- The aggregate name inventory contains zero missing, added, renamed, or duplicate names; both groups retain their original relative order.
- After formatting the original Git source with the same Prettier version, every remaining HTTP test body and every moved SSE test body compared exactly with its baseline block.
- `remote-license-client.test.js` is now 524 lines and `remote-license-event-stream.test.js` is 235 lines.
- Prettier 3.7.4 passed, and `npm run check` passed syntax validation for 620 JavaScript files.
- The scoped diff and worktree status were reviewed; `git diff --check` reported no whitespace errors, only existing Windows line-ending conversion warnings.
- `package.json` was intentionally unchanged because the default repository-wide test command discovers both files automatically.

## Verification

- `node --experimental-vm-modules --test test/remote-license-client.test.js`
- `node --experimental-vm-modules --test test/remote-license-event-stream.test.js`
- `node --experimental-vm-modules --test test/remote-license-client.test.js test/remote-license-event-stream.test.js`
- Exact aggregate test-name comparison against the original 20-name inventory
- Prettier 3.7.4 `--check` for both test files and this plan
- `npm run check`
- `git diff --check`

## Rollback Or Failure Handling

If a moved scenario changes or disappears, stop and compare both files with the recorded 20-name baseline. Reverse only the new file and the five removed hunks with `apply_patch`; do not reset or checkout the dirty worktree.

## Done When

- The same 20 test names pass across the two files with no duplicates.
- `remote-license-client.test.js` contains 15 HTTP request/error tests and no SSE parsing or reader-lifecycle scenarios.
- `remote-license-event-stream.test.js` contains the five event-stream tests and stays independently runnable.
- Formatting, JavaScript checks, diff checks, and scoped review pass without production or package-script changes.
