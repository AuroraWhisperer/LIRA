# ADR-0011: Source-Partitioned Gift Ledger Projection

- Status: Accepted
- Date: 2026-09-01

## Context

ADR-0006 made `gift_events` the local shared gift ledger, and the first
server-authoritative delivery design added a main-process live cursor. That
cursor intentionally established a latest baseline for a fresh client. The
persisted cursor and ledger rows do not currently share a transaction or a
verified streamer partition, so the design cannot safely claim complete history
or switch principals in one installation.

## Decision

The client keeps one SQLite projection per canonical server/account source in
the existing gift database. `gift_sources` owns the hashed source identity,
`gift_events.source_id` partitions projected rows, and `gift_sync_state` owns
bootstrap token, epoch, final cursor, projection generation, and validation
watermark. Rows and synchronization progress commit in the same gift database
transaction.

Historical bootstrap uses a side-effect-free importer. It never enters the live
detection/consumer pipeline. SSE remains an acceleration hint and epoch-aware
cursor pull remains recovery truth. Authorization switching and projection
replacement are guarded by an immutable source/auth/controller/projection fence
and drain old work before another source is exposed.

The renderer never selects a source. Local gift history and statistics resolve
the active verified source in the main/server composition boundary. A server
without history bootstrap support remains compatible for new final events but
the projection is explicitly `LEGACY_PARTIAL`.

## Consequences

### Positive

- Complete paid gift history and offline local statistics can be verified.
- Multiple streamers can reuse one installation without cross-source reads or
  event-ID deduplication collisions.
- Clearing and rebuilding cannot leave a cursor that falsely describes deleted
  or stale rows.
- Historical recovery cannot trigger old live business effects.

### Negative

- Gift storage, authorization lifecycle, remote delivery, and local queries now
  share a stricter transactional/fence contract.
- Existing unpartitioned remote rows cannot be attributed and remain legacy
  diagnostic data outside active-source queries.

### Neutral

- The existing five-database layout and live consumer registry remain.
- Old server/client baseline behavior remains a compatibility mode rather than
  a completeness guarantee.

## Alternatives Considered

**Reuse the JSON cursor and infer ownership for existing rows**

- Rejected because its old key included mutable/device-specific inputs and no
  transaction proves which streamer owns existing ledger rows.

**Clear all gifts whenever the streamer changes**

- Rejected because it destroys offline history, makes switching expensive, and
  still does not fence late responses.

**Feed bootstrap records through the live importer**

- Rejected because historical data must not run sprint, overtime, snapshot,
  frame, or finalization side effects.

## References

- `specs/gift-ledger-projection-sync_design.md`
- `specs/server-authoritative-gift-detection_design.md`
- `src/storage/gift-sync-store.js`
- `src/electron/remote-gift-controller.js`
- `src/bilibili/gift/query-service.js`
