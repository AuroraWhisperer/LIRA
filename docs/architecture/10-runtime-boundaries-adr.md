# ADR-001: Make Local Runtime Resources Instance-Owned

## Status
Accepted

## Context
The desktop app embeds an HTTP/WebSocket server in the Electron main process. Previously, loading `src/server.js` created databases and mutable runtime state, while WebSocket timers and selected cache paths were module globals. Electron also opened a server-owned SQLite file directly. These boundaries made lifecycle cleanup and isolated tests depend on module-load order.

## Decision
Keep the application as a modular monolith with the existing four SQLite files. Construct a server runtime explicitly for each data directory; it owns databases, timers, sockets, Bilibili listeners, and cache configuration. Electron uses a narrow in-process facade rather than direct database access. No new process, framework, dependency-injection container, or database migration is introduced.

## Consequences

### Positive
- Runtime shutdown can release its own timers, sockets, and databases deterministically.
- Tests and future profiles can use isolated data directories in one Node process.
- SQLite ownership and Electron-to-service interactions have one defined boundary.

### Negative
- Startup wiring becomes an explicit factory and needs regression coverage for lifecycle order.
- Compatibility wrappers must remain until existing CLI and Electron consumers use the runtime facade.

### Neutral
- HTTP endpoints, WebSocket payloads, IPC channels, and SQLite file names remain unchanged.

## Alternatives Considered

**Microservices or a separate server process**
- Rejected: local single-user deployment does not justify distributed operations or a network boundary.

**Merge all SQLite files into one database**
- Deferred: it could provide cross-domain transactional operations, but would impose user-data migration and does not solve runtime ownership by itself.

**Keep module singletons and reset globals in tests**
- Rejected: it preserves hidden initialization order and cannot reliably release owned resources.

## References
- `src/server.js`
- `src/server/ws.js`
- `src/electron/main.js`
