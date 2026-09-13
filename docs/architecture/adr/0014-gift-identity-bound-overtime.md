# ADR-0014: Bind overtime to gift activity identity

- Status: Accepted
- Date: 2026-09-13
- Extends: ADR-0003, ADR-0011, ADR-0012

## Context

Bilibili may reuse a gift ID for a different name or price. ID-only rules,
artwork indexes and catalog joins could silently apply old settings to a new
gift. Existing rules have no original list price and cannot be safely inferred.

## Decision

Consume validated server schema 3 archives and negotiate frozen event identities
with `X-Lira-Gift-Identity: 1`. Persist full rule identity and match exactly inside
the existing gift database settlement transaction. The append-only v10 migration
preserves old rule settings with unresolved identity. Users reselect their gift
without resetting effects. Guard aliases keep their established meaning.

Images and pools follow the same identity. Unknown event identity cannot trigger
a platform rule. Completed settlements remain immutable; historical import never
dispatches live consumers. Old server event DTOs and schema 2 cache files remain
readable, but cannot supply missing historical identity evidence.

## Consequences

Both server and desktop upgrades are needed for identity-bound gift settlement.
Installed older clients keep the default wire shape. New clients may display
legacy history while identity-dependent rules wait for confirmed events.

Requirements and acceptance criteria: [gift identity specification](../../../specs/gift-identity-overtime.md).
