# Feature: Gift detail retention and lasting statistics

- Decision status: Accepted (2026-10-12).
- Delivery status: Implemented; focused checks passed. Fixed-revision release
  verification and deletion activation remain pending; evidence is maintained in
  [the implementation plan](plans/2026-10-12-gift-retention.md).
- Decision: [ADR-0024](../docs/architecture/adr/0024-gift-retention.md).

## Required behavior

Scope clarification (2026-10-12): the user permits storage changes and explicitly
requires the existing Bilibili gift reader and detector to remain unchanged.
Do not change connection, event parsing, combo/finalization or valuation rules.
Retention adapters preserve existing storage contracts; statistical formulas,
classification and business results remain the acceptance oracle.

Paid gift details are retained for approximately 90 days. The lower boundary is
the Shanghai midnight preceding `now - 90 days`, so a rolling 90-day query keeps
its exact first-day boundary. Pending settlement, recent finalization and valid
snapshots may delay physical deletion. The published boundary is authoritative;
an offline client does not advance it using its own clock.

Long-term statistics retain full daily, historical viewer-name and frozen gift
identity dimensions. Event count and item quantity are different metrics. Every
original amount becomes integer cents before aggregation; unknown cost remains
different from zero cost. Totals, averages, dates, name filters, rankings, box
composition and yearly/all-time chat queries must match the original ledger.
Monthly totals are computed from days, never used to approximate partial months.

Summary contributions and uncovered details form disjoint sets. Queries pin the
summary revision and existing epoch/watermarks. Late finalization is included
once without changing an already-issued website snapshot. Chat queries retain
their existing request watermark and await eligible pre-existing progress groups.

Expired details and exports are unavailable and visibly identified as expired;
statistics are still available. A summary is never presented as one gift event.
The UI distinguishes statistical completeness from detail availability.

## Desktop synchronization and consumer boundaries

The authenticated main-process source owns both summaries and details. Summary
pages are validated in staging; changed days are replaced atomically only after
the contiguous final cursor reaches the advertised coverage. First upgrade and
rebuild stage the complete summary and recent-detail set before activation.
Failed downloads preserve the previous usable projection. Existing authorization,
generation, source-switch and clear fences apply to every new operation.

Server-private UID and room scope must not enter the device statistical DTO.
The server merges those dimensions before export. Local live-consumer statistics
are retained separately: `gift_stats_eligible`, sprint resets, user/box analysis
and pending overtime retain their existing semantics. Importing or archiving must
not trigger gifts, thanks, overtime, wishes or other live actions for historical-only records. A locally accepted progress group is completed by the existing final importer only after activation, retaining its original eligibility.

Source-less and unidentified legacy records are not assigned to a current source
or deleted by this policy. Super Chat, fans, check-in and guard expiry retain
their original domain lifecycles.

## Deletion and recovery

Deletion requires a reconciled published summary, expired snapshot protection,
terminal local consumers, durable deduplication receipts and a safely prunable
delivery prefix. Final cursors remain monotonic after the outbox becomes empty.
Unexpected middle gaps remain errors; routine retention never changes the epoch.
Explicit clear removes all associated summary, staging and receipt state and
rotates the epoch, keeping other sources and tenants intact.

Work is resumable in bounded transactions. Cleanup is disabled until both ends
support the protocol and correctness checks pass. Existing SQLite files reuse
freed pages; no live full-database VACUUM is introduced. Summary dimensions and
minimum exact deduplication receipts continue growing, so no fixed compression
ratio or permanently bounded total database size is promised.

After physical deletion, rollback requires preserving the aggregate reader or
restoring a consistent backup under the existing epoch rules. An old raw-only
reader cannot truthfully serve complete totals.

## Acceptance

The plan's feature matrix and fixed cross-repository fixture must pass before
and after publication, partial/full pruning, restart and clear. Tests cover exact
filters and composition, late events, repeated pages, old snapshots, offline
rebuild and unchanged live consumer effects. Small deterministic cases establish
correctness; no 200,000-row synthetic performance claim is required.
