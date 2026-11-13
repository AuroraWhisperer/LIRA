# Feature: Gift detail retention and lasting statistics

- Decision status: Accepted (2026-10-12); independent server/desktop retention
  and maintenance scheduling accepted on 2026-11-11.
- Delivery status: The original shared 90-day implementation has focused evidence
  in the [original plan](plans/2026-10-12-gift-retention.md). The 2026-11-11
  extension below is implemented in the working tree; execution and verification
  are tracked in the [current plan](plans/2026-11-11-gift-retention-tiers.md).
  Neither planning nor earlier checks imply production deletion is enabled.
- Decision: [ADR-0024](../docs/architecture/adr/0024-gift-retention.md).

## Required behavior

Scope clarification (2026-10-12): the user permits storage changes and explicitly
requires the existing Bilibili gift reader and detector to remain unchanged.
Do not change connection, event parsing, combo/finalization or valuation rules.
Retention adapters preserve existing storage contracts; statistical formulas,
classification and business results remain the acceptance oracle.

The server retains paid gift details for approximately 90 days. The desktop
retains already-received paid gift details for approximately 365 days. Boundaries
use Shanghai midnight so rolling ranges retain their complete first day; one year
means 365 days, not a calendar-year reset. Pending settlement, recent finalization,
valid snapshots, failed aggregation and maintenance backlog can delay deletion.
The desktop derives a conservative independent cutoff from a successfully
activated server summary boundary, not directly from the server's 90-day detail
cutoff or an untrusted local clock. Offline work may clear eligible backlog at the
last verified cutoff, but cannot advance deletion on the computer clock alone.

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

Details and detailed exports expire at their respective server or desktop
boundary; statistics remain available. A summary is never presented as one gift
event. The UI distinguishes statistical completeness, the desktop retention
policy, actual local detail coverage and the server recovery window. New devices
cannot recover a year of details from a server retaining only 90 days. Missing
unsynchronized or previously deleted details remain missing, with partial
availability identified rather than inferred from the oldest stored event.

## Desktop synchronization and consumer boundaries

Pre-release baseline decision (2026-11-11): there are no formal old-version
users. A one-time migration may reset incompatible local server-sourced gift
projections, associated settlements and derived retention state instead of
recovering legacy membership or exact archives. Rebootstrap restores only what
the server still supplies. Other domains, source-less records, wish configuration,
gift rules and exported files remain outside this reset. Later startups and
same-epoch rebuilds must preserve records received under the new rules. This
authorized one-time atomic startup reset is exempt from the routine background
batch budget; it is not a migration that gradually preserves old projections.

Coverage is invalidated atomically when a full rebuild skips unconsumed cursors:
only the freshly bootstrapped server window is then proven complete. Older local
details stay readable but are partial, since a missed late final may refer to
an earlier date. Continuous catch-up can extend existing coverage; elapsed
calendar dates alone cannot locate a delivery gap.

The authenticated main-process source owns both summaries and details. Summary
pages are validated in staging; changed days are replaced atomically only after
the contiguous final cursor reaches the advertised coverage. First upgrade and
rebuild stage the complete summary and recent-detail set before activation.
Failed downloads preserve the previous usable projection. Existing authorization,
generation, source-switch and clear fences apply to every new operation.

Successfully published same-source, same-epoch membership remains evidence for
locally retained 91-365-day details after an ordinary full rebuild. Unpublished
staging never supplies visible history. Multiple published memberships must not
duplicate an event. An authenticated epoch change or explicit ledger clear keeps
its existing invalidation semantics; account switches do not reassign records.
Preserving local detail evidence does not pin obsolete statistical revisions.

Server-private UID and room scope must not enter the device statistical DTO.
The server merges those dimensions before export. Local live-consumer statistics
are retained separately: `gift_stats_eligible`, sprint resets and pending overtime
retain their existing semantics. Blind-box totals and user/box analysis include
visible final history details from the active source, independently of live-consumer
eligibility; retained pages become visible only after snapshot activation. Event
time, rather than import time, determines the local calendar day. Importing or archiving must
not trigger gifts, thanks, overtime, wishes or other live actions for historical-only records. A locally accepted progress group is completed by the existing final importer only after activation, retaining its original eligibility.

Within 365 days, original gift rows preserve exact event instants for local-day
queries. Eligible older details compact directly into daily business groups;
there is no second per-event archive. Freeze the archive timezone and expose
precision limits when the viewing timezone changes; do not claim exact
re-bucketing after discarding event times. `last_opened_at` remains only a group
maximum. Under the authorized pre-release reset, earlier exact and Beijing-day
archives are discarded once, including those whose raw rows were already gone.
Server daily summaries keep their Shanghai-day contract.

Before deleting desktop details, retain and validate already-covered server
summaries rather than adding the same gifts again. Uncovered authoritative facts
wait for verified summary synchronization. Consumer-qualified local sprint,
blind-box and settled wish-boundary contributions are carried forward according
to their own eligibility rules. Eligible wish contributions become scoped
boundary totals once immutable; mutable boundaries remain protected. Minimal
deduplication identities may remain, but are not detailed history or full event
payloads. Compaction, carry updates, receipts, deletion and batch progress commit
atomically so retries never duplicate contributions.

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

## Maintenance scheduling (implemented 2026-11-11)

Server detail deletion starts batches only during 03:00 inclusive to 04:00
exclusive in Asia/Shanghai. Incremental summaries can run throughout the day.
An in-flight transaction may complete after the window closes; missed or
unfinished deletion resumes in a later window. Reuse the existing tenant
maintenance queue and lifecycle; do not run a second direct-SQL cron cleanup.

Desktop startup registers background work after migration and UI readiness,
subject to the existing automatic-maintenance setting and an authorized usable
source. Successful synchronization wakes the same owner rather than invoking an
independent deletion loop. Existing low-frequency maintenance can register the
next daily cycle during a long-running session. Lack of a verified summary delays
deletion without delaying startup.

For one database, maintenance batches and destructive operations must not race.
Use one runner, coalesced requests, short storage-owned transactions and bounded
candidate scans. Prioritize live input and allow reads through the established
snapshot rules. Do not await networking, another queue lease or image rendering
inside a transaction. Export uses its existing bounded in-memory snapshot after
a short read. Clear, account switching and shutdown stop stale work and wait for
the current batch before invalidation or database closure. General retention and
gift-specific maintenance coordinate giftDb writes without locking unrelated
databases. The two hosts do not acquire a shared lock or wait for every device
to acknowledge deletion.

After physical deletion, rollback requires preserving the aggregate reader or
restoring a consistent backup under the existing epoch rules. An old raw-only
reader cannot truthfully serve complete totals.

## Acceptance

The plan's feature matrix and fixed cross-repository fixture must pass before
and after publication, partial/full pruning, restart and clear. Tests cover exact
filters and composition, late events, repeated pages, old snapshots, offline
rebuild and unchanged live consumer effects. The extension additionally requires
90/365-day boundaries, Shanghai maintenance windows, startup/sync/export/clear/
shutdown interleavings, local coverage gaps and true compaction of old exact
archives. Small deterministic cases establish correctness. Capacity and batch
latency probes supplement them without promising performance on untested servers
or devices.
