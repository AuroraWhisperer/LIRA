# ADR-0024: Gift retention with daily statistical contributions

- Status: Accepted
- Date: 2026-10-12
- Supersedes the permanent-detail assumption of ADR-0011 and its projection
  specification; source identity, atomic final delivery and authorization fences
  remain in force.
- Implementation is tracked in the [plan](../../../specs/plans/2026-10-12-gift-retention.md).

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
