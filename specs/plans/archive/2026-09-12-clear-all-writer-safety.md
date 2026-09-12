# Batch Nine Clear-All Writer Safety Implementation Plan

> Status: Complete — implemented and verified 2026-09-12
> Execution: Inline in the current task, following repository PLANS.md.

**Goal:** Fix S4-003 and S5-001 so real gift/countdown writers respect clear-all
quiescence and required default rows cannot fail after a reported successful clear.

**Architecture:** Keep the existing domain services, synchronous SQLite ownership,
API context and clear-all route. Defaults belong in each database's existing
transaction. Gift detection and overtime own their pause state and timers.

**Tech Stack:** Node.js 24, CommonJS, node:sqlite, node:test.

## Constraints and non-goals

- Preserve the POST path, confirm requirement, success fields, partial-failure
  payload, tenant/source fences, preserved tables, schema and settings keys.
- Separate database files still commit sequentially; no claim of crash atomicity.
- No Server repository changes, other audit fixes, dependencies, real user data,
  branches, commits or deployment. Preserve all existing uncommitted changes.
- Evidence goes in D:/Work/lira-audit/remediation/2026-09-12-batch-nine; leave the
  central remediation index and earlier batches untouched.

## Current behavior and ownership

- src/server/routes/data-routes.js calls four optional methods absent from
  src/server/api-context.js and the real domain services. Handler tests supply
  these methods themselves, masking the production wiring failure.
- src/bilibili/gift/detection-service.js owns local detection, remote imports,
  finalization and consumer retry timers. src/overtime/overtime-service.js owns
  settlement recovery and countdown zero timers.
- Remote imports run inside src/storage/gift-sync-store.js transactions. A paused
  import must throw, rather than return null and allow a cursor-only commit.
- src/storage/database-maintenance.js recreates two required rows after all
  commits, catches errors and unconditionally returns cleared/recreated success.
- src/server/domain-services.js reloads runtime state after storage success;
  exceptions here must not be confused with fully rolled-back storage failure.
- Contracts: docs/architecture/backend/api.md and storage.md. Route/owner map:
  ROUTE-SERVER, ROUTE-STORAGE, ROUTE-GIFTS and ROUTE-OVERTIME.

## Milestone 1: Reproduce and fix required defaults

- [x] In test/database-clear-all.test.js inject INSERT failures for default
  category and overtime state; assert an error, retained pre-clear data, no
  COMMIT, and usable transaction handles. Verify partial commit still reports
  actual committed/rolled-back databases and required defaults commit with them.
- [x] Move existing default INSERT statements before the commit loop while all
  transactions are open. Report `phase: 'recreate'` through error.details.
- [x] Track begun transactions and report rollback failures as partial results;
  never treat uncertain rollback as permission to resume writes.

## Milestone 2: Connect real writer controls

- [x] Add synchronous pauseDetection/resumeDetection to detection-service.
  Pause cancels quiet-window and consumer retries without flushing. Block local
  detection/finalization and throw GIFT_DETECTION_PAUSED for remote imports.
  Resume recovers persisted pending work and surviving failed-consumer retries.
  Disposing a paused writer must not flush writes into partial state.
- [x] Add pauseRecovery/resumeRecovery to overtime-service. Cancel zero/retry
  timers and gate gift settlement and scheduling while paused. Resume schedules
  the current clock and persisted recovery; clear success first reloads defaults.
- [x] Export these capabilities via api-context. Require the route ports so
  future missing wiring fails visibly. On fully rolled-back failure restore only
  pauses acquired by this attempt; after partial failure keep both paused.
- [x] Keep post-commit runtime/restart errors structured as partial failures,
  with no success broadcast/cloud sync and with writers paused.
- [x] Add an integration regression using createRuntimeApiContextFactory and real
  createDomainServices with temporary databases, plus focused fake-clock tests
  for gift and overtime timers and cursor atomicity tests for paused imports.

## Milestone 3: Verify and record

- [x] Run the new regressions before implementation and record expected failures.
- [x] Run directly affected tests:

```powershell
node --experimental-vm-modules --test test/database-clear-all.test.js test/data-clear-all-recovery.test.js test/data-clear-all-runtime.test.js test/gift-detection-service.test.js test/overtime-service.test.js test/processed-gift-import.test.js test/gift-ledger-maintenance.test.js
node --test test/database-maintenance.test.js test/gift-sync-store.test.js test/server-smoke.test.js test/server-modules.test.js test/domain-services-initialization.test.js
npm run verify:quick
git diff --check
git status --short
```

- [x] Update storage/API owner documentation, review only task-owned increments
  against saved pre-edit copies, verify staged/protected work is unchanged, and
  write batch-nine results with actual test outcomes and limitations.

## Failure handling and done when

Fully rolled-back failures preserve data and prior pause ownership. Partial
commits, rollback failures or runtime restoration failures retain paused writers
and explicit HTTP 500 partial status. Required defaults and deletion commit
together per database. Success recovers writers and emits existing notifications.
Revert only task-owned hunks if necessary; never reset or overwrite user changes.
Complete when these observable regressions and proportional checks pass, contracts
match, and the final scoped diff is reviewed. Archive this plan upon completion.

## Implementation record

- Initial reproductions: 8 expected failures, including both swallowed default
  INSERT errors and absent production context controls (red.log).
- Main focused run: 73/73 passed. Integration run: 31/31 passed, including the
  isolated HTTP server smoke test and prior initialization cleanup regressions.
- verify:quick passed: 5 governance tests, syntax for 588 JavaScript files,
  and 13 architecture/ES-module boundary tests.
- Final additions: deferred pre-pause gift delivery is invalidated by a generation
  fence; rollback diagnostics preserve per-result status. Affected final rerun
  passed 30/30, including the added delivery test and governance checks.
- Storage/API, overtime and gift owner documents now describe transactional
  defaults and paused disposal. No schema or public route change was needed.
- Task-owned increments reviewed against saved pre-edit files; 99 pre-existing
  modified files outside the candidate set retain their hashes. Index remains
  empty. git diff --check passed.
- No real user data, external services, production fault injection or full
  repository test suite was used. Multi-file COMMIT remains non-atomic.
- Evidence: D:/Work/lira-audit/remediation/2026-09-12-batch-nine/results.md.
