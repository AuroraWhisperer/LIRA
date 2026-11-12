# ADR-0024: Gift retention with daily statistical contributions

- Status: Accepted
- Date: 2026-10-12
- Supersedes the permanent-detail assumption of ADR-0011 and its projection
  specification; source identity, atomic final delivery and authorization fences
  remain in force.
- Original implementation evidence is tracked in the [original plan](../../../specs/plans/2026-10-12-gift-retention.md).
  The accepted 2026-11-11 extension below is implemented in the working tree; see the
  [current execution plan](../../../specs/plans/2026-11-11-gift-retention-tiers.md).

## Context

The owner requests approximately 90 days of gift details while retaining existing
date filters, website totals and yearly/all-time chat queries. Monthly totals
cannot reproduce arbitrary date ranges or personal and gift-name filters.

## Decision

Keep versioned daily statistical contributions in the existing gift database.
Replace changed source-scoped days atomically and combine them with uncovered
details. Preserve counts and per-event integer cents, historical names, identity,
known/unknown costs and query revision. Keep consumer-qualified local totals
separate from the authoritative server's all-gift totals.

Only verified, covered details outside the published window may be removed,
after snapshot and pending-consumer protection. Server deduplication receipts and
monotonic cursor boundaries survive deletion. Existing clear/rebuild operations
own all new state. The [specification](../../../specs/gift-retention.md) owns the
behavior; this decision adds no service, database or runtime dependency.

## Consequences

Historical statistics remain exact while detailed history and exports have an
explicit limit. Summaries and exact deduplication receipts still grow. This costs
schema and protocol complexity and requires coordinated rollout; removing raw
rows alone or retaining only monthly totals would produce incorrect results.

## Accepted extension: independent retention and coordinated maintenance

Date: 2026-11-11. The owner accepts approximately 90 days of server details,
365 days of already-synchronized desktop details, and lasting daily aggregates.
Monthly and yearly views continue to derive from those aggregates. This changes
the original shared detail-window assumption without changing gift detection,
valuation, tenant identity or authoritative server statistics.

The desktop keeps published same-epoch detail membership through ordinary
resynchronization. Its history/export availability is separate from the server
recovery window and from statistical completeness. New devices and long-offline
devices cannot recover details already deleted on the server. Existing explicit
clear and epoch invalidation still revoke old visibility.

The owner additionally permits a one-time reset of incompatible pre-release
local gift projections because no formal users depend on them. This replaces
legacy projection/archive migration, not the new rule's data safety: subsequent
same-epoch rebuilds preserve received details. A rebuild that skips unconsumed
cursors revokes old completeness proofs, including dates preceding the outage;
only the newly verified bootstrap range is marked complete.

Before desktop deletion, validate authoritative summary coverage without adding
the same contributions twice. Carry consumer-qualified local statistics
separately; compact year-old eligible blind-box details and immutable wish-boundary
contributions rather than retaining a disguised second per-event ledger.
Day archives preserve their recorded timezone and disclose precision limits when
later viewed in another timezone.

Use the existing server maintenance owner and tenant queue. Start physical
detail-deletion batches only during 03:00-04:00 Asia/Shanghai; incremental
aggregation can continue outside that window. The desktop registers maintenance
after startup/UI readiness and resumes it through one giftDb owner. Sync, startup
and manual triggers coalesce; live input takes precedence between bounded
transactions, export uses a short read snapshot, and clear/switch/shutdown fence
stale work. No second SQL script, scheduler service or cross-host lock is added.

The tradeoff is that older detail recovery depends on the local copy and its
backup. Safety checks may extend physical retention beyond the nominal days.
Discarding exact timestamps also limits later timezone re-bucketing. These
limits and implementation evidence are recorded in the [specification](../../../specs/gift-retention.md).
