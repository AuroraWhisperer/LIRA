# Clear-All Failure Recovery Implementation Plan

> Status: Active — implementation complete; full gate blocked by unrelated concurrent work
> Started: 2026-08-23
> Execution: Inline in the current task; no subagents, commits, or unrelated cleanup.

## Goal

Make the clear-all workflow recover safely from pre-commit and commit failures,
surface structured partial-failure details to the Admin UI, and leave exactly
one canonical default song category after a successful clear.

## Non-goals

- Do not refactor the legacy `window.AdminApp` boundary.
- Do not change database files, schemas, migrations, HTTP methods or paths.
- Do not attempt true atomic commit across separate SQLite database files.
- Do not change code signing, dependencies, Electron behavior, or gift-frame
  presentation work.
- Do not modify or stage concurrent user changes under gift effects, gift-frame
  assets, or their existing plan.
- Do not create a Git commit.

## Current Behavior

- `clearAllData()` begins transactions in five database connections and commits
  them sequentially. When one commit fails, the failing and later connections
  retain open transactions.
- The clear-all route pauses gift detection and overtime recovery. A pre-commit
  exception is propagated without resuming either writer even though all
  database changes were rolled back.
- The route returns `{ ok: false, partial: true, data }`, but the shared Admin
  `api()` helper converts it to a plain `Error`. The settings UI therefore cannot
  reach its partial-failure reload path.
- Storage recreates `默认分类`, while the startup and domain-service owner ensures
  `默认`, producing two categories after a complete application clear.
- Existing success-path tests pass but do not cover these combined failure paths.

## Ownership

- Transaction owner: `src/storage/database.js` and
  `docs/architecture/backend/storage.md`.
- Clear-all runtime lifecycle owner: `src/server/routes/data-routes.js`.
- Domain post-clear state owner: `src/server/domain-services.js`.
- Admin transport and presentation consumers:
  `public/js/shared/utils.js` and `public/js/admin/settings.js`.
- Regression coverage: `test/database-clear-all.test.js`, a focused route/UI
  recovery test, and `test/server-smoke.test.js`.

## Compatibility Constraints

- Preserve all clear-all request paths, confirmation semantics, success payloads,
  stable server errors, preserved tables, and existing partial-failure fields.
- A commit failure remains a partial failure because already committed database
  files cannot be rolled back.
- Only database connections not confirmed committed may be rolled back after a
  commit failure.
- Writers resume after success or a fully rolled-back pre-commit exception, but
  remain paused after a partial commit failure.
- Additive error metadata may be exposed to the Admin caller without changing
  behavior for successful `api()` calls.
- Tests must use temporary databases and must not access real user data.

## Proposed Changes

### Storage recovery and canonical default

- Track databases confirmed committed during the sequential commit phase.
- If a commit fails, attempt `ROLLBACK` on the failing and all later database
  connections before returning the existing partial-failure result.
- Add `rolledBack` and `rollbackFailed` diagnostic arrays while preserving
  `committed`, `failed`, `error`, `deletedCounts`, and `results`.
- Change the clear-all matrix and recreated row from `默认分类` to the canonical
  runtime category `默认`; keep the domain `ensureCategory('默认')` call idempotent.
- Update the storage owner document to match the canonical row and recovery
  semantics.

### Route lifecycle recovery

- Add one local helper that resumes gift detection and overtime recovery.
- Wrap `context.data.clearAll()` so a thrown pre-commit failure resumes both
  writers before the error is propagated to the server error boundary.
- Reuse the helper after success and deliberately skip it for `partial: true`.

### Admin structured errors

- When `api()` receives `{ ok: false }`, attach HTTP status and the parsed payload
  to the thrown error before preserving the existing error display/rethrow flow.
- Centralize the settings partial-failure alert/reload presentation so it works
  for both a returned partial response and `error.payload` from the shared helper.
- Preserve the existing generic toast for network and non-partial failures.

## Milestones

### Milestone 1: Reproduce storage failure and default drift

- Add a commit-failure test using temporary real SQLite databases and a wrapper
  that fails one `COMMIT` before it reaches SQLite.
- Assert uncommitted databases retain their data and accept a fresh
  `BEGIN`/`ROLLBACK` after recovery.
- Change the success expectation to exactly one category named `默认` and tighten
  the server smoke assertion to the exact category list.
- Focused verification:
  `node --test test/database-clear-all.test.js` must fail before implementation.

### Milestone 2: Reproduce route and Admin recovery

- Add focused route tests asserting pause/resume counts for success, pre-commit
  exception, and partial commit failure.
- Add a shared-API test asserting the thrown error retains HTTP status and parsed
  partial payload.
- Add an Admin settings test asserting a partial payload alerts, reloads once,
  and does not emit the generic settings-level failure toast.
- Focused verification: the new test file must fail before implementation.

### Milestone 3: Minimal implementation

- Implement only the transaction cleanup, route recovery, error metadata,
  partial-failure presentation, canonical category, and owner-document edits
  described above.
- Re-run both focused test files until they pass.

### Milestone 4: Integrated verification

- Run the affected server smoke test, JavaScript syntax check, documentation and
  architecture gates, quick gate, and complete test suite.
- Review task-owned diffs separately from concurrent user changes.

## Verification

Expected result for every command is zero failures.

```powershell
node --test test/database-clear-all.test.js
node --experimental-vm-modules --test test/data-clear-all-recovery.test.js
node --test test/server-smoke.test.js
npm run check
npm run verify:docs
npm run verify:architecture
npm run verify:quick
npm test
git diff --check -- src/storage/database.js src/server/routes/data-routes.js public/js/shared/utils.js public/js/admin/settings.js docs/architecture/backend/storage.md test/database-clear-all.test.js test/data-clear-all-recovery.test.js test/server-smoke.test.js specs/plans/2026-08-23-clear-all-failure-recovery.md
git status --short --untracked-files=all
```

## Rollback Or Failure Handling

- Stop if a deterministic test cannot distinguish fully rolled-back failure from
  partial commit failure, or if the owning contract conflicts with the intended
  recovery semantics.
- Inspect and reverse only the task-owned paths listed in Verification using a
  surgical patch; never use broad checkout, reset, deletion, or staging.
- Keep all test databases in temporary directories and close every database
  handle before cleanup.
- Leave every concurrent gift-effects, gift-frame, and unrelated plan change
  exactly as found.

## Done When

- A simulated commit failure leaves no transaction open on any uncommitted
  database and returns compatible partial-failure diagnostics.
- A pre-commit failure resumes paused writers; a partial commit failure does not.
- The Admin UI can read the structured partial result and forces one reload.
- A successful application clear leaves exactly one category named `默认`.
- Focused, quick, and full tests pass; the storage owner document matches the
  implementation; task-owned diffs are clean; unrelated concurrent work is
  untouched and uncommitted.

## Implementation Record

- Commit-stage failure now rolls back the failing database and every later
  uncommitted database, returning `rolledBack` and `rollbackFailed` diagnostics.
- A pre-commit exception resumes gift detection and overtime recovery before it
  reaches the stable server error boundary; partial commit failures remain
  paused.
- Shared Admin API errors retain HTTP status and parsed response payloads, and
  the clear-all UI now alerts and reloads from the structured partial result.
- Clear-all and startup now converge on exactly one canonical category named
  `默认`.
- Focused verification passed: storage 3/3, route/Admin 5/5, server smoke 11/11.
- `npm run verify:quick` passed: governance 5/5, syntax for 434 JavaScript files,
  and architecture boundaries 9/9.
- The complete suite was run twice. All task-owned tests passed, but the current
  concurrent worktree has three unrelated failures in
  `test/contextual-help.test.js`, `test/desktop-lyrics.test.js`, and
  `test/frontend-gifts.test.js`. Their corresponding source/tests were already
  modified or untracked outside this task and were not changed here.
- Targeted `git diff --check` passed. No task-owned file is staged or committed.
