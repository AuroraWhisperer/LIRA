# ADR-0002: Server-Authoritative Countdown Timing

- Status: Accepted
- Date: 2026-08-10
- Original ID: ADR-OT-001

## Context

The overtime machine is rendered as an OBS browser source: the page refreshes, disconnects, and can be hidden, and several instances may be open at once. Placing the source of truth in any browser process would cause countdown drift between pages and duplicate gift settlement when a browser reloads or reconnects. This ADR was extracted from the overtime machine design specification (accepted 2026-08-10) and verified implemented in the v3.3.14 codebase (`src/overtime/overtime-service.js`).

## Decision

The server is the single authority for countdown timing. It persists `remaining_ms`, `anchor_at_ms`, `status`, and a monotonically increasing `revision`, and it never writes the database or broadcasts every second. Any start, pause, manual time set, or gift adjustment first materializes time to the current instant and then writes a new anchor.

While a session is running, elapsed time is computed in-process with the Node monotonic clock (`performance.now()`), so NTP or manual clock adjustments cannot make the countdown jump; the wall clock is used only for persistence across restarts. On process startup with a persisted `running` state, the wall-clock anchor is used to subtract the elapsed downtime (clamped at zero so a rolled-back system clock can never add time) before rescheduling.

A single "reach zero" timer is scheduled when entering `running` or after a positive adjustment; for long counts it is rescheduled in 24-hour chunks. When it fires, the server materializes the clock to zero, changes the state to `finished`, increments the revision, and broadcasts `reason=finished`.

Clients receive `effectiveRemainingMs` and `serverNowMs`, subtract transport delay, and interpolate locally with `performance.now()`; a full snapshot received on connection or reconnection unconditionally corrects the local estimate, and incremental updates are only accepted when their revision is newer.

## Consequences

### Positive

- Multiple overlay instances and the Admin panel share one consistent view from a single truth source.
- Reconnection recovers cleanly from the server snapshot without re-settling gifts.
- No per-second database writes or broadcasts; browser timers are display-only.
- Monotonic-clock elapsed time prevents NTP or manual clock changes from jumping the countdown.

### Negative

- A new state table and control API were required for time management.
- Clients must implement local interpolation plus revision-based correction.

### Neutral

- Persisted timestamps remain wall-clock Unix milliseconds to support restart recovery; the runtime path uses the monotonic clock.

## Alternatives Considered

**Browser-held truth (each overlay keeps its own timer)**

- Rejected: multiple instances would drift, and a refreshed or reconnected page could double-settle gifts.

**Per-second database writes or broadcasts**

- Rejected: unnecessary write and network load; state is only synchronized on manual actions, gift settlement, configuration changes, natural zero, and connection establishment.

## References

- ../backend/overtime.md
- `src/overtime/overtime-service.js` (`getEffectiveRemainingMs`, `materialize`, `recoverPersistedClock`, `scheduleZeroTimer`)
