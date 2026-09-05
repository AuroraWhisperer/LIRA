# Call Chain Regression Fixes Implementation Plan

**Status:** Complete, with unrelated full-suite failures recorded below.

**Goal:** Fix the four reviewed notification, cancellation, lyric-version, and
sender-concurrency defects without changing public contracts.

**Architecture:** Keep each fix in its current owner. Admin and OBS recognize the
existing cloud song notification; the Bilibili runtime invalidates obsolete
client work; the shared sender serializes complete messages before rate checks.

**Tech Stack:** Node.js 24+, CommonJS backend, browser ESM, node:test.

## Constraints And Non-goals

- Preserve HTTP/WS/IPC shapes, `cloud:songs`, sender options and error wording,
  persisted formats, Electron security, and all unrelated user changes.
- No dependencies, new services, UI redesign, commits, or speculative cleanup.
- The unrelated Admin security-copy assertion failure is not a repair target.
- Use existing test helpers and isolated fake network, timers, auth, and DOM.

## Evidence And Ownership

- `src/server.js` broadcasts `cloud:songs`; `public/js/admin/state.js` and
  `public/js/overlays/songs.js` do not reload their song lists for it.
- `src/server/bilibili-runtime.js` can start pending replacement work after
  disabling monitoring because only permanent shutdown invalidates that work.
- `StateService.reloadState()` calls the mutating `acceptLyricState()` twice,
  suppressing the event for a newly accepted version.
- `src/bilibili/danmaku/sender-service.js` checks `lastSentAt` before awaiting
  network work, allowing concurrent callers to pass the same rate-limit check.
- Owning docs: frontend `app.md` / `overlays.md`, backend `server-core.md` /
  `bilibili/danmaku.md`. Update only the affected facts.

## Milestones

- [x] Frontend: failing behavioral tests for Admin/OBS cloud-song reloads and
  new/duplicate/stale HTTP lyric states, followed by minimal consumer fixes.
  Preserve ordinary `songs:` notifications and unrelated snapshot filtering.
  Reuse the first version decision: `const lyricAccepted = ...`.
- [x] Bilibili runtime: failing tests for queued/in-flight reconnect cancellation,
  explicit disconnect, re-enable and room replacement. Give replacement requests
  a generation invalidated synchronously when the current client is disconnected.
  Recheck before/after auth reads; obsolete clients cannot publish callbacks or
  surface stale errors. Keep replacement execution serialized.
- [x] Sender: failing tests for concurrent default calls, waiting callers,
  zero-interval chunk ordering and recovery after an earlier send fails.
  Queue entire sends with `sendChain.then(() => sendNow(input))`; perform the
  existing rate check only when the operation reaches the front of the queue.
  Preserve `waitForRateLimit`, caller-specific intervals and result shapes.
- [x] Update owning documentation, inspect source/test diffs, and run verification.

## Verification

1. Run each new regression before its implementation and confirm the targeted
   failure; rerun the owning tests after the fix.
2. Backend: `node --test test/bilibili-runtime.test.js test/danmaku-sender-service.test.js`.
3. Frontend: relevant tests under `node --experimental-vm-modules --test`, including
   the existing song-board and Admin suites. Record exact additional test paths
   and results as they are implemented.
4. `npm run check`, `npm run verify:architecture`, and `npm run verify:docs`.
5. Run the deterministic full `npm test` suite after checking isolation of any
   tests that could start services. Record unrelated failures without fixing them.
6. Review the final task-owned diff, `git diff --check`, and `git status --short`.

## Failure Handling And Done When

Stop on a contract conflict; do not guess or expand scope. Roll back only
task-owned hunks if needed, without resetting or checking out user files.
Done when all four regressions pass, affected callers remain compatible, docs
match behavior, and broader verification limitations are recorded. Archive this
plan only after final acceptance.

## Results

- Backend red: 8 targeted failures reproduced across the two existing test files;
  shutdown cancellation and failure recovery controls continued to pass.
- Backend green: the initial 24 tests passed after the minimal implementation.
- Backend compatibility: 55 tests passed across Bilibili runtime, sender, client,
  message handler and AI assistant suites, including two additional current-error
  and active-room compatibility checks.
- Frontend red: three new behavioral cases failed before the implementation.
- Frontend green: 7 tests passed via `node --experimental-vm-modules --test
  test/admin-state.test.js test/overlay-songs-invalidation.test.js
  test/frontend-song-board.test.js`. Root reviewed all three source hunks and
  both new test files.
- The existing Admin shell suite still has its unrelated removed-security-copy
  assertion failure (45 pass, 1 fail); no task-owned source is involved.
- Frontend work is delegated to Luna with source/tests only; root owns documents,
  backend, and final acceptance. No new execution plugin or test framework is used.
- Final gates: `npm run check` passed for 572 JavaScript files;
  `npm run verify:architecture` passed 13 tests; `npm run verify:docs` passed 5.
- Full suite: `npm test -- --test-reporter=tap` ran 1283 tests: 1279 passed and
  4 unrelated tests failed. All 15 new regression/compatibility cases passed.
- Remaining failures are in existing user-edited UI surfaces: removed account
  security copy (`test/frontend-admin-shell.test.js:446`); a 10px calendar label
  (`test/frontend-typography.test.js:269`); the changed danmaku style markup
  (`test/toolbox-sidebar.test.js:750`); native confirm calls in existing
  `public/js/admin/todo.js` (`test/ui-surface.test.js:172`). Their failing inputs
  were inspected and are outside this task's source edits.
- No real Bilibili service or user data was used for regressions; no full Electron
  UI session was launched. Source/test/docs diffs were reviewed, user changes were
  preserved, and no runtime output or secrets were added.
