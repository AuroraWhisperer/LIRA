# ADR-0003: Settle Exactly Once Per Gift Group

- Status: Accepted
- Date: 2026-08-10
- Original ID: ADR-OT-002

## Context

The gift service returns the existing record when a duplicate platform event arrives and updates the same record as a combo progresses; a single combo of cheap gifts can end up as `num=100`. Product requires one settlement per gift group, not per unit — a fixed rule applies once and a time blind box draws once, regardless of final quantity. This ADR was extracted from the overtime machine design specification (accepted 2026-08-10) and verified implemented in the v3.3.14 codebase (`src/overtime/overtime-service.js`, `src/overtime/overtime-store.js`).

## Decision

`gift_events.id` is the gift group and the sole settlement key; `num` and total price are display and audit snapshots at finalization, never multipliers. The shared detection core finalizes a group after the platform end marker or 10 seconds of silence and dispatches exactly one `final` event; the overtime consumer settles immediately in the same round of work, without waiting a second 10-second window.

Before finalization the consumer persists a `pending` settlement row with an idempotent upsert over the `UNIQUE(gift_event_id)` key. At finalization, the entire flow — confirm enabled and epoch match, ensure the pending row exists, re-read the frozen group snapshot and the current rules, materialize the clock, draw the random result, mark the row `applied` or `ignored`, and update the clock — commits in a single `BEGIN IMMEDIATE` transaction. `applied`/`ignored` rows are never modified by duplicate, late, or quantity-growing packets.

Fixed rules apply the configured seconds once; time blind boxes draw once with `node:crypto.randomInt` over cumulative weights, and the versioned result is persisted so a page refresh, WebSocket reconnect, or repeated gift packet can never re-roll it. Settlements record requested and applied delta seconds (negative adjustments clamp the clock at zero) together with a versioned rule snapshot for audit. A failed settlement transaction keeps the row `pending` with an exponential 1–30 second backoff, and a compensating scan resumes eligible `final` events after restart.

## Consequences

### Positive

- Cheap combo gifts do not amplify time by quantity — 100 one-cent gifts apply one rule exactly once.
- Fixed and random results are auditable, idempotent, and stable across refresh and reconnect.
- Restart recovery completes without relying on platform resends.

### Negative

- Time feedback is delayed by up to the 10-second silence window.
- Updates arriving very late after finalization no longer trigger any change.

### Neutral

- Each `gift_event_id` occupies exactly one settlement row (`pending`/`applied`/`ignored`), which also serves as the dedup checkpoint.

## Alternatives Considered

**Settle on every progress broadcast or scale by quantity**

- Rejected: duplicate platform events and growing `num` would settle repeatedly, and an `x1 -> x100` progression could not be handled.

**Add time in the browser from the last received gift message**

- Rejected: browsers may re-broadcast stale snapshots on reconnect and would double-settle.

## References

- ../backend/overtime.md
- `src/overtime/overtime-store.js` (`observeGift`, `settleFinal`, `ensurePending`, `listRecoverableFinal`)
- `src/overtime/overtime-service.js` (`finalizeGift`, `selectRuleResult`)
