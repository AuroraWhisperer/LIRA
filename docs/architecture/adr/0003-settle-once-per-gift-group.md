# ADR-0003: Settle Exactly Once Per Gift Group

- Status: Accepted
- Date: 2026-08-10
- Original ID: ADR-OT-002
- Quantity semantics: Extended by the [quantity-mode specification](../../../specs/overtime-rule-quantity-mode_design.md); the one-settlement-per-group decision remains accepted.
- Finalization semantics: [LIRA Server ADR-0107](https://github.com/AuroraWhisperer/LIRA-server/blob/d125d93c52190d377973dfaecfae8388b6c17b92/docs/architecture/decisions/0107-six-second-gift-combo-continuations.md) governs quiet windows and additive late segments; idempotency remains per finalized event ID.

## Context

The gift service returns the existing record when a duplicate platform event arrives and updates the same record as a combo progresses; a single combo of cheap gifts can end up as `num=100`. At original acceptance, product required both one settlement per gift group and one rule application regardless of final quantity. This ADR was extracted from the overtime machine design specification (accepted 2026-08-10) and verified implemented in the v3.3.14 codebase. The later quantity-mode specification extends rule application counts while preserving group-level idempotency.

## Decision

`gift_events.id` identifies a server-finalized gift event segment and is the sole settlement key. The finalized `num` and total price remain audit snapshots; `quantityMode='group'` applies the rule once, while `quantityMode='item'` uses the segment's finalized quantity as the application count within that same settlement. Missing quantity mode preserves the original `group` behavior. The server-owned detection core determines finalization and emits at most one `final` per segment; the overtime consumer settles immediately, without a second client-side waiting window. Later positive cumulative growth can produce a new segment containing only the unrecorded difference, without modifying an existing final. Current finalization behavior is documented in the [overtime contract](../../reference/backend/overtime.md#31-结算键与生命周期).

Before finalization the consumer persists a `pending` settlement row with an idempotent upsert over the `UNIQUE(gift_event_id)` key. At finalization, the entire flow — confirm enabled and epoch match, ensure the pending row exists, re-read the frozen group snapshot and the current rules, materialize the clock, draw the random result, mark the row `applied` or `ignored`, and update the clock — commits in a single `BEGIN IMMEDIATE` transaction. `applied`/`ignored` rows are never modified by duplicate, late, or quantity-growing packets.

Fixed rules repeat their configured operation for the application count; time blind boxes draw independently for each application with `node:crypto.randomInt` over cumulative weights. The versioned results are persisted so a page refresh, WebSocket reconnect, or repeated gift packet can never re-roll them. Settlements record requested and applied delta seconds (negative adjustments clamp the clock at zero) together with a versioned rule snapshot for audit. A failed settlement transaction keeps the row `pending` with an exponential 1–30 second backoff, and a compensating scan resumes eligible `final` events after restart. Capacity limits and quantity-limit recovery are owned by the quantity-mode specification.

## Consequences

### Positive

- In `group` mode, 100 one-cent gifts apply one rule once; `item` mode deliberately applies it 100 times within one settlement.
- Fixed and random results are auditable, idempotent, and stable across refresh and reconnect.
- Restart recovery completes without relying on platform resends.

### Negative

- Time feedback waits for the server-owned group finalization window.
- Updates never rewrite an existing final or its settlement; an additive late segment has its own event ID and settles independently.

### Neutral

- Each `gift_event_id` occupies exactly one settlement row (`pending`/`applied`/`ignored`), which also serves as the dedup checkpoint.

## Alternatives Considered

**Settle on every progress broadcast**

- Rejected: duplicate platform events and growing `num` would settle repeatedly, and an `x1 -> x100` progression could not be handled. Applying the finalized quantity once in `item` mode does not introduce this repeated-progress behavior.

**Add time in the browser from the last received gift message**

- Rejected: browsers may re-broadcast stale snapshots on reconnect and would double-settle.

## References

- [Overtime runtime contract](../../reference/backend/overtime.md)
- [Quantity-mode requirements and limits](../../../specs/overtime-rule-quantity-mode_design.md)
- [Settlement storage](../../../src/storage/overtime-store.js)
- [Settlement calculation](../../../src/overtime/overtime-settlement.js) (`resolveGiftSettlement`)
