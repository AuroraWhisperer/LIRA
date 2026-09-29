# Gift SSE Commit Implementation Plan

**Status:** Completed (2026-09-28). Requested behavior and focused regressions pass; unrelated workspace-wide failures are recorded below.
**Goal:** Accept healthy contiguous final gifts without downloading the same records again, while preserving recovery, durable progress, source isolation and prompt local delivery.
**Architecture:** Use the existing synchronous gift-sync-store transaction through commitGiftCatchUpPage. The Electron controller owns admission and synchronization state; HTTP remains the startup/reconnect/gap/periodic recovery path.
**Tech Stack:** Node.js 24, CommonJS, SQLite, Node test runner.

## Constraints and ownership

- User authorized implementation after the message-pattern research. Do not change server detection, valuation, finalization, gift DTOs, auth, schemas, or upstream connections.
- Preserve unrelated working changes; no commits, branches or deployment.
- Owner: src/electron/remote-gift-controller.js. Existing transaction: src/storage/gift-sync-store.js. Consumers: local gift projection, statistics and existing post-commit delivery.
- Current accepted specs require immediate SSE import followed by pull. Explicitly replace that rule in specs/gift-ledger-projection-sync_design.md and related references; document the extension to client ADR-0011 in a new ADR.
- Update server REQ/AC-GIFT-007, protocol description, OpenAPI prose and ADR for the client delivery decision. Server endpoints and detector runtime do not need changes.
- Cursor and gift rows commit together. Preserve HTTP validation time on SSE commits. latestCursor is the latest observed server final cursor, not a fresh full-ledger validation.
- Only the current authenticated stream in clean LIVE can advance via SSE. Bootstrap, legacy, pending catch-up, gaps and stale sources use existing recovery.
- Ignore already committed cursors only on this validated healthy path. Failed commits advance nothing and schedule recovery.
- Do not reset the 10-second reconcile timer on each event.

## Task 1: Implement and verify atomic live reception

Modify src/electron/remote-gift-controller.js and test/gifts/remote-gift-controller-sse.test.js; extend test/gifts/remote-gift-controller-reconciliation.test.js and add test/gifts/remote-gift-controller-commit.test.js. Reuse existing controller and processed-gift fixtures.

Interfaces: runtime.commitGiftCatchUpPage accepts sourceId, projectionGeneration, events, nextCursor, syncEpoch and optional validatedAt; it returns the committed state synchronously. No new runtime bridge or storage abstraction.

- [x] Add/update tests and observe failures for healthy final delivery without extra GET, continuous traffic preserving the periodic deadline, real SQLite rollback and committed progress visible before effects.
- [x] Replace the immediate import with the existing transaction:
~~~js
const nextState = runtime.commitGiftCatchUpPage({
  sourceId: fence.sourceId,
  projectionGeneration: fence.projectionGeneration,
  events: [event],
  nextCursor: event.cursor,
  syncEpoch: currentState.syncEpoch,
});
~~~
- [x] Recheck the fence after post-commit effects, publish the committed cursor and latest observed cursor without rescheduling reconciliation. Reject callbacks from aborted/replaced streams.
- [x] Verify gap recovery, pending-HTTP serialization, restart from saved progress, duplicates, account/generation invalidation, and commit failure.
~~~js
assert.equal(controller.getCursor(), 11);
assert.equal(fixture.pullCalls.length, pullsBefore);
assert.equal(fixture.activeContexts.at(-1).syncedAt, validatedBefore);
assert.equal(originalTimer.cleared, undefined);
~~~

## Task 2: Align contracts and verify the change boundary

- [x] Update owning specifications, requirement/acceptance, reference, protocol/OpenAPI prose and ADR indexes together.
- [x] Run controller/reconciliation/storage/importer/source-isolation/consumer focused tests using Node's existing runner.
- [x] Run client documentation, syntax and architecture gates relevant to this controller change; report unrelated existing failures without changing them.
- [x] Run server protocol/documentation and gift detector/broker/endpoint tests.
- [x] Inspect task-only diffs against the external baseline, git diff --check and final scoped status; verify no server runtime changes.
- [x] Archive this plan and record exact outcomes.

## Verification

Focused client command:
~~~powershell
node --test test/gifts/remote-gift-controller*.test.js test/gifts/remote-gift-owner-isolation.test.js test/gifts/gift-sync-store.test.js test/gifts/processed-gift-import-atomicity.test.js test/gifts/gift-effect-danmaku.test.js
~~~

The command runner may enumerate paths explicitly for Windows. Tests use temporary databases and fake clocks; do not use user data or real Bilibili credentials. Add meaningful SQLite-backed controller scenarios, not only mock assertions.

Client gates: npm run verify:quick, npm run test:offline.
Server focused command: Node test runner with --require ./test/support/test-mode.cjs and explicit device-protocol-contract, documentation-governance, gift-sync-documentation-governance, device-gift-events, device-gift-epoch, bilibili-gift-detector, bilibili-gift-event-broker and sse-writer tests.

The known server release-pin mismatch is separate from this task; do not fabricate a new commit or bypass its verifier.

## Rollback and done conditions

Task-owned pre-edit files are saved under D:/Work/lira-audit/08-transport-research-2026-09-28/gift-sse-baseline. Reverse only the task delta if needed. Healthy events must persist immediately with no event-triggered GET, recovery must still work, no effects may escape a rolled-back transaction, periodic reconciliation must remain active, and contracts must agree with the final implementation. Existing unrelated gate failures are documented, not hidden.


## Implementation evidence

The only production source changed is src/electron/remote-gift-controller.js.
The existing storage transaction is reused without a schema or runtime bridge
change. Post-commit notification failure reloads persisted progress before HTTP
recovery, preventing an already committed final from being treated as a gap.

- Controller/SSE/reconciliation regressions: 26/26 pass, including real SQLite
  rollback, commit-before-effects, saved-cursor restart, duplicate suppression,
  stale stream rejection and ten-second fallback under continuous events.
- Server gift/protocol/documentation regressions: 64/64 pass. Device OpenAPI
  comparison confirms only the gift stream description changed; all schemas,
  endpoint shapes and versions are identical. Server detector/delivery source
  has no diff.
- Client syntax scan: 1044 JavaScript files pass; the final controller and new
  test were checked again after the notification-failure repair.
- Final offline suite: 2742/2757 pass. Fifteen failures are in untouched checks:
  five danmaku style/layout/frontend assertions, one active-plan status rule,
  one modularity registry rule (gift-display CSS/settings test), one empty-catch
  rule (start-animation), and seven old schema-version assertions expecting 14
  while the shared workspace initializes gift schema 15. These changes were not
  altered or hidden by this task. The earlier broad focused run was 68/71, with
  three of the same schema-version assertions failing.
- verify:quick stops at an unrelated active plan status failure; syntax was run
  separately, and architecture tests were included in the offline suite.
- A reproducible fixture comparison of ten spaced finals (excluding startup
  and periodic checks) changes additional GETs from 10 to 0, with final cursor
  20 and LIVE on both versions. This is a synthetic result, not live traffic.

The shared plan index also received an unrelated concurrent danmaku-canvas entry;
that entry was preserved. No user databases, Bilibili accounts or running app were
used. No commits or deployment were made. The release contract pin remains a
separate unresolved release prerequisite; no revision was fabricated.

Logs, baseline copies and measurement script are in
D:/Work/lira-audit/08-transport-research-2026-09-28 (gift-sse-* files).
