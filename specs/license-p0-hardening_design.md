# Feature: License P0 Hardening

> Status: Implemented
> Requirement source: server `docs/protocol/session-lifecycle.md` and `docs/protocol/device-authentication-v2.md`.
> Updated 2026-09-16: automatic renewal is conditional on the last Session; the
> former manual-only cloud-sync clauses are superseded by
> [Cloud-authoritative Streamer sync](cloud-authoritative-streamer-sync_design.md).

## Goal

Make the Electron client enforce the server device-license protocol without renewal races, stale-token requests, incorrect recovery states, or missed lifecycle recovery.

## Requirements (EARS)

- While a device token is being renewed, when another protected operation needs authorization, the client shall await the same renewal promise.
- When a protected server request returns an explicit device, license, streamer, or session rejection, the client shall clear the in-memory token, stop maintenance, enter `BLOCKED`, and close the local business gate.
- When startup or an expired-token renewal fails because of DNS, timeout, HTTP 429, or HTTP 5xx, the client shall preserve the device identity and enter `NEEDS_CONNECTION`.
- While a valid token remains usable, when a transient network failure occurs, the client shall preserve `AUTHORIZED` and allow bounded retry.
- When Windows resumes from suspension, the Electron main process shall immediately recheck the current license session and reschedule heartbeat maintenance.
- When an already-enrolled device starts and verifies successfully, the Electron main process shall resume license-gated Bilibili work.
- The activation and challenge canonical payloads shall match server-owned golden vectors byte for byte; activation shall hash the SPKI PEM after removing surrounding whitespace so Node-generated trailing newlines cannot change the proof.
- Automatic renewal, protected-request revalidation and resume recovery shall send the last successful `sessionId` as `renewalSessionId`. Network failure shall retain this prerequisite even when the in-memory token is cleared; only explicit startup, activation or user retry may omit it and take over another runtime.
- The local business gate shall require an unexpired in-memory token, including when timers have not run and no protected remote request occurs. Short token lifetimes shall schedule maintenance before expiry rather than imposing a 30-second minimum.
- Retryable startup and renewal shall retain the transport `retryAfterMs` deadline. Resume and expired protected calls cannot bypass it; waits larger than a native timer are split into cancellable chunks. Waiting never extends token validity.
- Malformed SSE error bodies (including null, arrays and text) shall preserve HTTP 401/403 rejection, clear the token and close the local gate.
- Song synchronization follows the newer cloud-authoritative specification, including automatic synchronization; its rules supersede this document's former manual-only limitation.

## Architecture

### Frontend

- Keep the existing `/license` page and narrow `liraLicense` bridge; cloud-sync controls follow their current owning specification.
- Add readable messages for server/session rejection and temporary server-unavailable states.
- Do not expose a token, private key, fingerprint, or configurable remote URL.

### Backend / Main Process

- `license-manager.js` remains the sole owner of device-token state, renewal, heartbeat, and server error classification.
- All protected remote methods execute through one authorized-request wrapper.
- `renewalPromise` and `heartbeatPromise` serialize maintenance and prevent stale-token overlap.
- `main.js` owns the Electron `powerMonitor` resume listener and removes it during shutdown.
- Verify adds the optional HTTP-only `renewalSessionId` field. v2 canonical bytes, mandatory request fields and response contracts remain unchanged; deploy the supporting server before this client. Old clients remain compatible but cannot provide the new automatic-renewal guarantee. Never retry a rejected conditional verify without its prerequisite.

### Security

- Device private keys remain PKCS8 values encrypted by Electron `safeStorage`; no plaintext fallback is added.
- Access tokens remain process-memory-only and are absent from IPC snapshots and persisted state.
- Explicit authorization rejection fails closed. Transient connectivity failure does not destroy device identity.
- IPC channel names, renderer payloads, server URLs, and persisted `license-state.json` format remain compatible.
- Tests use generated keys, mock responses, local temporary state, and fixed public golden vectors only.

## Acceptance Criteria

1. Two concurrent protected calls after expiry produce one renewal challenge/verify pair.
2. Heartbeat waits for an in-flight renewal and never sends the superseded token.
3. A protected call returning `DEVICE_REVOKED` immediately leaves `AUTHORIZED`, clears the token, and notifies the local gate.
4. `SESSION_SUPERSEDED`, `SESSION_REVOKED`, and unrecoverable session codes enter `BLOCKED`, not `NEEDS_ACTIVATION`.
5. HTTP 429/5xx, timeout, and DNS failures during startup or expired renewal enter `NEEDS_CONNECTION` while preserving identity.
6. A transient protected-call failure while the token is still valid preserves `AUTHORIZED`.
7. System resume performs an immediate heartbeat/revalidation and resets the heartbeat timer.
8. An initially authorized startup calls `resumeAuthorizedWork()` once.
9. Client and server protocol tests assert the same complete activation and challenge canonical strings, including SPKI PEM surrounding-whitespace normalization.
10. Existing IPC, background-image, song-sync, gate, and license UI tests remain green.
11. After B takes over A, A's already-scheduled renewal carries A's Session ID and becomes BLOCKED even if no heartbeat observed the takeover. Transient recovery retains that ID; an explicit user retry may omit it.
12. With a 1-second token and unreachable server, the local business gate closes at expiry without any remote business call or timer callback; renewal scheduling does not delay its first attempt until 30 seconds.
13. A renewal retry with `Retry-After: 60` waits at least 60 seconds, including resume or expired protected calls during that wait. A token that expires during the wait no longer authorizes local work or appears authorized in snapshots; oversized delays use bounded native timer chunks and disposal cancels them.
14. Real SSE 401 responses with null, array or text bodies remain authorization rejections and clear the in-memory token.

## Non-goals

- No offline-license grace period or refresh-token protocol.
- No new server endpoint, database, persisted-state, or IPC contract changes.
- Cloud song synchronization and merge behavior belong to the newer cloud-authoritative specification.
- No unrelated Electron, Bilibili, gift, or UI refactoring.

## Implementation Evidence

- Client protocol, manager, gate, UI, transport, background, and device-identity tests cover the acceptance criteria.
- LIRA Server asserts the same complete activation and challenge canonical strings and passes its full test suite.
- JavaScript and documentation checks pass. The repository-wide architecture/full-suite run has one unrelated pre-existing gift SQL-boundary failure in `src/bilibili/gift/event-service.js`.
- Production reachability remains a deployment check: code must continue to require HTTPS and must not fall back to the reachable but rejected HTTP endpoint.

## Done When

The task-owned client and server checks, JavaScript check, `git diff --check`, and scoped diff review pass, with no sensitive or generated runtime data added. Any unrelated baseline failure or external deployment outage is recorded separately rather than hidden by weakening authorization or transport security.
