# ADR-0006: Shared Gift Detection Core with Consumer Registry

- Status: Accepted
- Date: 2026-08-10
- Original ID: ADR-OT-005

## Context
Previously `src/bilibili/gift/event-service.js` combined low-level detection, gift event persistence, and the `enableGiftSprint` switch in one service, so gifts were unavailable to overtime whenever `enableGiftSprint` was false. Gift statistics and the overtime machine need the same normalization, platform deduplication, and combo merging, yet their start/stop switches and business outcomes must remain independent. This ADR was extracted from the overtime machine design specification (accepted 2026-08-10) and verified implemented in the v3.3.14 codebase (`src/bilibili/gift/detection-service.js`, `src/bilibili/gift/consumer-registry.js`, `src/bilibili/gift/statistics-consumer.js`, `src/overtime/overtime-consumer.js`).

## Decision
A single-instance `GiftDetectionService` owns parsing, normalization, platform deduplication, and combo merging. Each raw Bilibili gift enters the system exactly once through `giftDetection.detect(gift)`; the core persists the `progress`/`final` lifecycle in `gift_events` and freezes consumer eligibility at the first platform packet of a group (`gift_stats_eligible`, `overtime_epoch`). Standard events are fanned out to `GiftStatisticsConsumer` and `OvertimeConsumer` through a consumer registry that isolates per-consumer failures (one consumer throwing never blocks the others).

The detection core runs whenever at least one consumer is enabled; when both are disabled it stops accepting new raw gifts but first drains already-persisted `progress` groups to `final`, then goes idle. All combo timers, forced flushes, and the shutdown flush route through the single `finalizeDetected()` path, and query code never mutates the gift lifecycle. A single 10-second silence window (based on the dedicated `last_platform_at_ms` integer field) governs finalization, and both consumers settle on the `final` event immediately — no consumer waits a second 10-second window.

At-least-once delivery with exactly-once business results is enforced with idempotent checkpoints (`counted_in_sprint`/`gift_stats_delivered` for statistics, `overtime_settlements` status for overtime) and compensating scans with 1–30 second exponential backoff that resume eligible `final` events after first-delivery failure or process restart, without relying on platform resends.

## Consequences

### Positive
- Exactly one parsing, normalization, and deduplication rule exists; the two features cannot parse the same raw packet differently.
- Gift statistics and overtime no longer depend on each other's switches; each can run with the other disabled.
- No duplicate parsing or duplicate `gift_events` writes; the shared ledger supports audit and diagnosis.
- Both consumers share the same `gift_events.id`, so statistics ownership and overtime settlement never pollute each other.

### Negative
- The existing gift service boundary had to be refactored, and failure isolation plus compensation required new tests.

### Neutral
- `gift_events` became the shared detection event ledger; statistics queries read only `final` rows that are `gift_stats_eligible`, so `progress` and overtime-only events stay out of gift statistics.

## Alternatives Considered

**Let overtime call the existing service that still gates on `enableGiftSprint`**
- Rejected: the two switches would remain coupled, and overtime could not receive gifts while gift statistics is off.

**Duplicate the parser inside the overtime module**
- Rejected: two separate deduplication and combo-merge states would diverge over time.

Both options were considered and rejected in the source specification; neither is used.

## References
- ../backend/overtime.md
- `src/bilibili/gift/detection-service.js`
- `src/bilibili/gift/consumer-registry.js`
- `src/bilibili/gift/statistics-consumer.js`
- `src/overtime/overtime-consumer.js`
