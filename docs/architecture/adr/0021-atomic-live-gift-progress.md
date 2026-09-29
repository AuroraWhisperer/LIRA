# ADR-0021: Atomic Live Gift Progress

- Status: Accepted
- Date: 2026-09-28
- Refines the live reception portion of [ADR-0011](0011-source-partitioned-gift-ledger-projection.md).

## Context

A healthy final SSE already carries the canonical settled record, but immediate
import leaves its durable cursor unchanged and triggers an HTTP read of the
same event. The user authorized reducing this repeated transfer while retaining
server gift detection and recovery behavior.

## Decision

Use the existing synchronous gift-sync-store transaction to commit a contiguous
final and its cursor together when bootstrap is complete, the current stream is
epoch-validated, and the controller is clean LIVE without pending recovery.
Dispatch consumers after commit. Ignore already committed cursors on that
validated path. Failure, gaps and recovery use the existing serialized HTTP path.
Aborted/replaced streams and stale source/auth/projection generations cannot write.

This extends ADR-0011's description of SSE as an acceleration hint: a validated
contiguous final can also advance durable progress. HTTP remains authoritative
for bootstrap, reconnect/gap recovery and periodic reconciliation. An SSE commit
updates the observed cursor but not the last HTTP validation timestamp or the
10-second reconciliation deadline.

## Consequences

Normal final events no longer require a second download. Cursor durability and
post-commit effects use the existing transaction, without a schema, runtime
bridge or dependency change. Local source changes during delivery are fenced
before publishing state. Existing consumer retry/idempotency remains necessary;
this decision does not promise exactly-once execution of external effects.

Server detector, amounts, combo handling, finalization and wire fields remain
owned by their current implementations. Legacy mode and initial-history behavior
are retained. No release or server deployment is part of this change.

## Alternatives

A fixed debounce delays recovery and only reduces requests close enough in time.
Keeping per-final pulls repeats data that can already be committed safely.
Removing periodic checks would weaken recovery from a silently missed last event.

## References

- [Projection sync requirements and acceptance](../../../specs/gift-ledger-projection-sync_design.md)
- [Controller](../../../src/electron/remote-gift-controller.js)
- [SQLite-backed controller regressions](../../../test/gifts/remote-gift-controller-commit.test.js)
