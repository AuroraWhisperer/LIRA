# ADR-0019: Stable Owner Identity For Gift Sources

- Status: Accepted
- Date: 2026-09-16
- Supersedes: ADR-0011's account-name-only source identity

## Context

Server tenant removal permits account-name reuse with a new immutable Streamer ID.
The previous gift-source-v1 hash contained only origin and account name, so a new
owner could read the previous owner's local projection before discovery succeeded.
The earlier client specification's immutable-account assumption conflicts with
the server identity contract and ADR-0016.

## Decision

Use a versioned SHA-256 source key over canonical HTTPS origin, lowercase account
name, and the positive safe-integer streamerId from the existing main-only
getCloudSyncIdentity boundary. Missing stable identity fails closed. The renderer
snapshot cannot substitute for that principal and no identity field is added to
gift wire DTOs or renderer APIs.

Existing v1 sources have no provable stable owner. Retain their rows for diagnosis
without assigning, copying, or automatically migrating them to a v2 source.
Bootstrap v2 sources from the authenticated server ledger. Normal offline reads
remain available for the same verified v2 owner, including discovery failure.
Existing authorization/controller/projection fences discard late old-owner work.

## Consequences

- Same-name recreation cannot reuse the predecessor's projection or cursor.
- The first v2 use downloads history again; unsupported old servers remain
  LEGACY_PARTIAL and cannot claim retained v1 history as complete.
- Old rows remain on disk but do not participate in active-source results.
- SQLite schema, storage transactions, renderer routes and wire contracts stay
  unchanged.

## Verification

Source-key tests distinguish recreated owners and reject missing IDs. A real
SQLite/controller/query regression preserves old and legacy rows while returning
only the new owner's empty projection on discovery failure. A deferred old
discovery response cannot advance either owner's cursor after a principal switch.

## References

- [Gift projection specification](../../../specs/gift-ledger-projection-sync_design.md)
- [Original projection ADR](0011-source-partitioned-gift-ledger-projection.md)
