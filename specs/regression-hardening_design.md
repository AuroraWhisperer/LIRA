# Feature: Regression Hardening

## Requirements (EARS Format)

- While session-token protection is enabled, when a first-party page downloads an API resource or flushes state during unload, the system shall authenticate the request.
- When a new process finds a previous instance on port 3000, the system shall authenticate the shutdown request and allow the previous instance to flush state and close databases.
- When a user explicitly selects a local media file, the desktop application shall preserve permission for that exact path across restarts.
- When navigating to the previous track, the player shall consume one history entry without duplicating the current entry.
- When WebSocket fragments form a message larger than 256 KiB, the server shall close the connection with code 1009 without retaining the oversized payload.
- When a partial play-history update omits metadata, the store shall preserve existing non-empty metadata.

## Architecture

### Frontend

- The injected bootstrap owns token propagation for `fetch`, WebSocket, and API anchors.
- The playback page adds the token to `sendBeacon` through the already-supported query parameter.
- Track history, lyric mode, diagnostics escaping, and liked-track pagination are fixed at their existing ownership points.

### Backend

- The server writes its random session token to the configured data directory for same-user process coordination.
- Lifecycle cleanup reads that token and sends it as a Bearer credential to the old instance.
- SQLite upserts preserve stored metadata when incoming fields are empty.
- WebSocket transport tracks total fragmented-message bytes in addition to per-frame bytes.

### Security

- Protected APIs remain protected; no mutation endpoint becomes public.
- The token file contains only the existing ephemeral token and uses restrictive file mode where supported.
- Local-media access persists only paths returned by the native file chooser; IPC origin checks compare exact origins.
- Attribute data is encoded before insertion into HTML.
- Plaintext Bilibili Cookie export remains disabled for new installations unless explicitly enabled; existing export users retain compatibility.

## Implementation Plan

- [x] Repair token propagation and graceful process replacement.
- [x] Repair frontend playback and diagnostic regressions.
- [x] Persist explicit local-media permission and restore compatibility behavior.
- [x] Bound WebSocket messages and make history upserts non-destructive.
- [x] Run targeted and full verification plus a final security review.
