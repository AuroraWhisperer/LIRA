# ADR-0004: Reuse the Existing Modular Monolith and gift-data.db

- Status: Accepted
- Date: 2026-08-10
- Original ID: ADR-OT-003

## Context

The app is a single-user local desktop tool: a Node.js native HTTP + WebSocket + Vanilla JS + SQLite modular monolith with an existing gift database (`gift-data.db`), page routing, session-token auth, and a WebSocket channel that already delivers full snapshots on connect. This ADR was extracted from the overtime machine design specification (accepted 2026-08-10) and verified implemented in the v3.3.14 codebase (`src/storage/database.js` schema migration v5, `src/overtime/`).

## Decision

The overtime machine was implemented as a new domain module inside the existing process, adding three tables to the existing `gift-data.db`: `overtime_machine_state` (singleton row for the countdown state machine), `overtime_gift_rules` (per-`gift_id` rules), and `overtime_settlements` (settlement ledger keyed by `gift_event_id`). No new process, microservice, message queue, framework, or runtime dependency was introduced; the existing session-token auth and WebSocket channels were reused, and the `/overtime` page was added to the existing static page map.

## Consequences

### Positive

- Overtime is available wherever the local service runs, matching the existing deployment boundary.
- Gift settlement, the shared `gift_events` ledger, and the overtime tables commit in a single SQLite transaction.
- No new operational surface, network boundary, or deployment model.

### Negative

- The shared `gift-data.db` now also carries overtime data: clearing the gift database must clear `gift_events` and `overtime_settlements` (and both autoincrement sequences) in the same transaction, leaving rules and the current clock state intact.
- The overtime domain is not independently deployable; it ships with the local service.

### Neutral

- Tables and indexes were added through the existing schema migration mechanism (v5).

## Alternatives Considered

**Separate server process or microservice**

- Rejected: a local single-user deployment does not justify a network boundary or distributed operations.

**A separate SQLite database for overtime**

- Deferred: it would break single-transaction settlement against the shared gift event ledger and complicate backup and cleanup.

## References

- ../backend/server-core.md
- ../backend/storage.md
- ../backend/overtime.md
- `src/storage/database.js` (`giftDb: 'gift-data.db'`, migration v5)
