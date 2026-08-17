# P0 Data Safety And Correctness Remediation

> Status: Completed
> Started: 2026-08-17
> Completed: 2026-08-17
> Source audit: `specs/plans/2026-08-17-existing-code-governance-remediation.md`
> Findings: `AUD-H02`, `AUD-H03`, `AUD-M02`, `AUD-M03`, `AUD-M08`, `AUD-M11`

## Goal

Prevent concurrent runtime database access, make genuine pre-v1 song and gift
databases upgrade safely, and ensure shutdown stops new work and drains accepted
asynchronous work before any database handle or port is released.

## Non-goals

- Do not change HTTP paths, response shapes, WebSocket messages, IPC channels,
  settings keys, or persisted business-data formats beyond applying the existing
  immutable migrations in their intended order.
- Do not address API key projection, Host/Origin hardening, external URI policy,
  clear-all semantics, gift-retention settlement repair, code signing, or
  dependency upgrades in this phase.
- Do not introduce a dependency-injection container, generic resource framework,
  new process, port, framework, build step, or runtime dependency.
- Do not rewrite the server, AI subsystem, storage layer, or Electron lifecycle.
- Do not automatically create a Git commit.

## Current Behavior

- Constructing the server runtime opens and mutates databases before the process
  has proven exclusive ownership of the configured port. A replacement runtime
  can therefore migrate, repair, or clear startup state while the old runtime is
  still writing the same files.
- `createDatabases()` executes complete schemas before migrations. The song
  schema creates an index using `queue.pinned_at`, and the gift schema creates an
  index using `gift_events.counted_in_sprint`, before their v1 migration adds
  those columns. Genuine pre-v1 databases fail with `no such column` errors.
- Shutdown closes resources without a single admission boundary and without
  draining every accepted HTTP handler, AI task, gift settlement, renderer
  playback flush, and owned timer before database close.
- AI coordinator stop clears queued state but active provider work can finish
  later and write context, cache, or audit data. Delivery verification also owns
  a timer without a unified async shutdown boundary.
- The 1.2 second replacement-runtime cleanup budget is shorter than the existing
  renderer flush and Electron graceful-shutdown budgets, so a healthy old
  process can be force-terminated during a legitimate database write.
- The focused baseline tests pass but do not exercise these failure paths.

## Ownership

- Storage schema and migration ownership:
  `src/storage/schema.js`, `src/storage/database.js`,
  `docs/architecture/backend/storage.md`, and
  `test/database-maintenance.test.js`.
- Server composition, process ownership, and HTTP lifecycle:
  `src/server.js`, `src/server/lifecycle.js`,
  `docs/architecture/backend/server-core.md`,
  `test/server-smoke.test.js`, and `test/server-lifecycle.test.js`.
- AI runtime lifecycle:
  `src/server/ai-runtime.js`, `src/ai/async-coordinator.js`,
  `src/ai/xiaomi-ai-service.js`, provider/tool clients, delivery verification,
  request logging, `docs/architecture/backend/ai.md`, and
  `test/xiaomi-ai-service.test.js`.
- Gift and overtime lifecycle remains owned by the existing domain runtimes.
  Server shutdown may call their narrow lifecycle methods but must not absorb
  their business rules.

## Compatibility Constraints

- Preserve the existing five database files, tables, columns, schema-version
  keys, published migration steps, and legacy Super Chat transfer behavior.
- Preserve Node.js 24+, CommonJS, `node:test`, the modular monolith, and existing
  public HTTP/WebSocket/Electron contracts.
- Keep the HTTP listener bound while the runtime is quiescing and closing its
  databases; the port is the runtime exclusivity boundary.
- During startup, do not expose token-bearing HTML or business APIs before the
  database-backed application is ready.
- Cancellation caused by shutdown is an expected lifecycle event. It must not
  send a failure reply or be recorded as an ordinary provider failure.
- Preserve unrelated user changes already present in the worktree.

## Proposed Changes

### Storage migration ordering

- Split only the song and gift schema exports that require migration-dependent
  indexes into table DDL and index DDL. Keep their combined schema exports for
  compatibility with existing imports and tests.
- Make `createDatabases()` execute table DDL, existing immutable migrations,
  migration-dependent indexes, and legacy Super Chat transfer in that order.
- Make `createDatabases()` exception-safe by closing every database handle it
  opened when any later initialization step fails.
- Add real pre-v1 song and gift fixtures. Verify data preservation, schema
  versions, expected index columns, `PRAGMA integrity_check`, and a second
  idempotent startup.

### AI lifecycle boundary

- Make the AI runtime the owner of an async, idempotent `shutdown()` operation.
- Stop admission, combine an owned shutdown signal with request timeouts, discard
  queued work, and await active generation, direct provider operations, delivery
  verification, and pending request-log writes.
- Prevent shutdown-cancelled work from starting a new send/retry or writing
  context, cache, or audit records. Already-started external delivery may only
  be bounded and awaited; it cannot be retracted.
- Add only the narrow optional `signal` and lifecycle methods required by the
  existing clients and tools.

### Server startup and shutdown

- Keep `server.js` as the composition root with explicit phases:
  `starting`, `ready`, `quiescing`, and `stopped`.
- Validate no-I/O arguments, request a trusted old instance to stop, wait for
  port release, bind the listener, then open/migrate databases and construct the
  application. Start external reconnect ingress only after the ready transition.
- While starting or quiescing, return a stable `503` for business traffic
  without building a full API context or serving token-bearing HTML.
- Add a small `src/server/inflight-tracker.js` with `run(work)`, `quiesce()`, and
  `drain()` so request admission and draining remain separate from process/PID
  identity logic in `src/server/lifecycle.js`.
- On shutdown: transition synchronously to quiescing; stop Bilibili/WebSocket
  ingress; flush renderer playback while storage is open; drain accepted HTTP,
  AI, and gift work; dispose gifts before overtime; stop remaining timers;
  optimize and close databases; then close the listener and remove only the
  runtime file owned by this process.
- Extend the graceful old-instance wait budget to cover the existing renderer
  and Electron shutdown budgets plus a bounded margin. Any forced termination
  must continue to use the existing trusted lifecycle checks; stronger PID
  identity validation is included only if required to keep this path safe.
- Prefer one narrow application facade returned by server initialization over
  scattering nullable stores and database handles through the composition root.
  Extract `src/server/application-runtime.js` only if the local function becomes
  materially difficult to review.

## Milestones

### Milestone 1: Pre-v1 migration safety

- Add failing pre-v1 fixtures and failure-cleanup coverage.
- Split migration-dependent table/index DDL and reorder database initialization.
- Update the storage owner document.
- Focused verification:
  `node --test test/database-maintenance.test.js`.

### Milestone 2: AI shutdown drain

- Add failing tests for active generation, queued work, delivery timers, direct
  provider operations, and pending request-log writes during shutdown.
- Implement the narrow abort/drain interfaces and unified AI runtime shutdown.
- Update the AI owner document if its lifecycle contract changes.
- Focused verification:
  `node --test test/xiaomi-ai-service.test.js` plus directly affected AI tests.

### Milestone 3: Runtime exclusivity and server quiesce

- Add failing tests proving runtime construction has no database/token/log I/O,
  a replacement cannot open the same databases before the old runtime releases
  them, startup traffic is gated, and accepted handlers drain before close.
- Implement phase gating, listener-first ownership, in-flight tracking, ordered
  shutdown, and the corrected graceful wait budget.
- Update the server-core owner document.
- Focused verification:
  `node --test test/server-smoke.test.js test/server-lifecycle.test.js`.

### Milestone 4: Integrated verification

- Run the combined focused regression suite.
- Run documentation, architecture, syntax, quick, and full gates.
- Review the complete scoped diff, cached diff if present, and worktree status.

## Verification

Expected result for every test command is zero failures.

```powershell
node --test test/database-maintenance.test.js
node --test test/xiaomi-ai-service.test.js
node --test test/server-smoke.test.js test/server-lifecycle.test.js
node --test test/server-smoke.test.js test/server-lifecycle.test.js test/database-maintenance.test.js test/xiaomi-ai-service.test.js
npm run verify:docs
npm run verify:architecture
npm run check
npm run verify:quick
npm test
npm run verify
git diff --check
git status --short --untracked-files=all
git diff
git diff --cached
```

The cached diff is inspection-only because staged governance work existed before
this phase. No task-owned file is staged or committed automatically.

## Rollback Or Failure Handling

- Stop after the current milestone if a focused regression cannot be made
  deterministic or an owning contract conflicts with the intended behavior.
- Inspect only task-owned paths with targeted `git diff -- <paths>` commands.
- Reverse task-owned edits with a new surgical patch. Do not use blanket
  checkout, destructive reset, broad deletion, or commands that disturb the
  user's existing staged governance changes.
- Database tests use temporary directories only. They must never open, migrate,
  or delete real user data.
- Failed database initialization closes all handles opened by that attempt;
  failed runtime startup retains the listener only long enough to perform its
  ordered cleanup, then removes only its owned runtime record.

## Done When

- Genuine pre-v1 song and gift databases migrate twice without error, retain
  fixture data, expose the expected indexes and schema versions, and pass
  integrity checks.
- Constructing a runtime performs no database, token, or log I/O before start,
  and database initialization begins only after exclusive listener ownership.
- Startup and quiescing traffic cannot reach a partial API context or receive
  token-bearing HTML.
- Shutdown rejects new business work, drains every accepted tracked operation,
  performs no post-close database write, and releases the port only after
  database close.
- AI shutdown is async and idempotent; cancelled work produces no new delivery,
  retry, context/cache/audit write, ordinary failure reply, or owned timer.
- Focused, quick, and full verification pass; owner documents match runtime
  behavior; every task-owned changed line traces to this plan; and no unrelated,
  generated, sensitive, staged, or committed material is added.

## Implementation Record

- Song/gift initialization now runs table DDL → immutable migrations →
  migration-dependent indexes → legacy Super Chat transfer. Genuine pre-v1
  fixtures retain data, reach song v3/gift v6, pass integrity checks, and reopen
  idempotently. Initialization failure closes all five opened handles.
- AI owns one shutdown `AbortController`; coordinator stop drains active work,
  direct provider operations are tracked, delivery waiters dispose cleanly, and
  request logs expose `flush()`. Shutdown cancellation uses `AI_SHUTDOWN` and
  produces no retry, failure reply, context/cache write, or ordinary failure
  audit after cancellation.
- Server construction performs no data-directory I/O. Startup binds the exact
  port before database initialization and gates starting/quiescing traffic.
  Shutdown stops ingress, flushes renderer state, drains accepted HTTP and AI
  work, disposes gifts before overtime, closes databases, then releases the port
  and removes owned runtime files.
- Focused regression suite: 77/77 passed.
- `npm run verify:docs`, `npm run verify:architecture`, `npm run check`, and
  `npm run verify:quick` passed.
- `npm test` and `npm run verify` passed with 544/544 tests.
- `git diff --check` passed. No generated or sensitive files appeared in
  `git status --short --untracked-files=all`; pre-existing staged governance
  content was inspected but not modified or committed by this phase.
