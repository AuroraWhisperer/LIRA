# Discard SC and completed lottery history

Status: Complete

## User decision and scope

The user explicitly says SC and completed lottery history need not be retained.
Preserve currently displayed SC and current lottery results long enough for their
normal interaction; reclaim historical content at an explicit lifecycle boundary.
Keep only necessary duplicate-rejection state where deleting it would revive old
events. Do not invent retention dates or silently drop active/paused work.

The user asks whether fan profiles are small and what audit logs/viewer samples
mean. Explain these from actual source/isolated synthetic measurements; do not
delete fan evidence, audit history or viewer samples on that question alone.

## Owners and parallel boundaries

- Client SC worker: `superchat-store` and its domain callers/tests. Reclaim old
  deleted/retracted payloads, preserve active/assisted displays and duplicate
  suppression. Propose migration helper; parent registers shared schema changes.
- Lottery worker: task/draw stores and actual lifecycle callers. Delete completed
  historical task/scan/evidence/order/award state once superseded or explicitly
  dismissed, preserving current result, resumable work, account boundaries and
  request idempotence. Parent coordinates shared storage docs/migration registry.
- Server worker: inspect SC consumers and remove unused persisted content without
  losing insertion-based realtime deduplication; owns companion-repo requirements,
  protocol and verification. Explain audit/viewer event meanings from source.
- Parent: migration integration, explanations, shared docs, final review and
  focused cross-consumer verification. No real database edits or deployment.

## Verification and safeguards

Approved lifecycle choices:

- Client SC v2 stores only `platform_id` receipts after delete, retraction, clear
  or configured expiry. A transactional DELETE trigger covers all established
  deletion paths. Migrate old deleted payloads and prevent cross-db legacy import
  retries or late original packets from reviving already retracted messages.
- Server SC stores only the existing event-key digest; realtime message content
  comes from the current incoming event. Migrate keys and drop the obsolete content
  table atomically, preserving insert-result-based delivery deduplication.
- Creating a validated new lottery task retires that streamer's completed/exhausted
  historical tasks in the same transaction. Keep current results and resumable
  tasks; startup trims legacy terminal history according to the current task.
  Retain minimal request-id/hash receipts so stale create retries cannot restart
  a discarded lottery.

1. Confirm lifecycle and consumers before edits; distinguish display data from
   duplicate rejection. Verify current displays/restarts and old-event replay.
2. Use appended, atomic, idempotent migration steps for persisted changes. Verify
   old synthetic data, rollback/retry, foreign keys and account isolation.
3. Run affected SC/lottery/storage suites; companion server uses its supported
   Node runtime. Update owner references and any affected user guidance. Run
   applicable architecture/docs gates and inspect scoped diff plus git status.

Do not touch unrelated concurrent work, installed apps, real data, deployments,
or the previously approval-blocked desktop fixture. No new date/size limits for
audit logs, viewer samples or fan histories are authorized by these annotations.

## Explanation evidence

- A synthetic in-memory SQLite profile using the current compact roster storage,
  unchanged identity/level and one observation per day added 303104 allocated bytes
  for 365 dates and 3072000 bytes for 3650 dates, including SQLite indexes. This is
  only roster evidence, not a measured real profile or a cap on notes/revisions/
  restore snapshots. The user's few-MB intuition is reasonable for this example;
  no fan-history deletion is necessary on that basis.
- Server audit examples include account create/update, device revoke, activation
  code creation and password-reset completion, with actor/target/details/IP/time.
- `viewer_samples` stores `room_info.online`, live status, title and sample time,
  not viewer identities. The official-field label must not be described as an
  exact realtime headcount; transient heartbeat popularity is a separate field.

## Done when

Unneeded SC/lottery history content no longer accumulates under the clarified
lifecycle, required live behavior and deduplication survive, migration and focused
tests pass, documentation is synchronized, and all three annotations are answered.

## Completion evidence — 2026-10-12

- Client SC storage v2 atomically removes deleted payloads and retains single-column
  platform-ID receipts. Delete, retract, clear and configured expiry share the
  deletion trigger; late originals and retrying legacy imports cannot revive them.
- Lottery task creation and startup reclaim superseded completed/exhausted task
  trees. Current results, resumable work, account isolation and request replay
  protection remain covered. No lottery schema revision was needed.
- Companion server replaces SC payload history with opaque digest receipts through
  an atomic migration. Live projection and withdrawal still use current packets.
- Parent combined tests: 84/84 across SC service/parser, storage initialization,
  maintenance/retention/clear/recovery, server smoke and usage guide; 76/76 across
  `node --experimental-vm-modules --test test/dynamic-lottery/*.test.js`.
  Logs: `tmp/discard-history/sc-integration.log` and `lottery.log`.
- `npm run check`: 1503 JavaScript files passed; `npm run verify:architecture`:
  27/27 passed. Logs under `tmp/discard-history/`.
- Server worker used Node 24.18.0: affected delivery/history consumers 52/52;
  storage migration/ownership/availability/WAL backup 37/37; docs 55/55.
  Evidence under `D:/Work/lira-server/tmp/sc-storage-check/` and its
  `docs/superpowers/plans/2026-10-12-super-chat-storage.md` closeout.
- Owning storage, Bilibili SC, lottery specification, server protocols and affected
  in-app guidance are synchronized. Current display contracts do not change, so
  no new appearance acceptance or external-service calls were required.
- Final `npm run verify:docs`: 10/10 passed (`tmp/discard-history/docs.log`);
  scoped diff/status review completed with no whitespace errors. No
  runtime/generated files are part of this task's source changes; no commits,
  installation updates, deployment or real-database cleanup were performed.

Remaining limits are explicit: deduplication/request receipts still grow by unique
event/task, and current unremoved SC and resumable lottery tasks remain. This is
content reclamation, not a hard database-size cap or immediate file compaction.
Fan histories, audit logs and viewer samples retain their current behavior. The
prior fan-song desktop verification limitation remains owned by its active plan.
