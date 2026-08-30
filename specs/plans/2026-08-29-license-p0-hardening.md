# License P0 Hardening Implementation Plan

> Status: Complete (production endpoint reachability requires deployment repair)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every P0 gap in the LIRA Electron device-license lifecycle and prove byte-compatible communication with LIRA Server.

**Architecture:** Keep `src/electron/license/license-manager.js` as the single token/state owner. Serialize renewal and heartbeat, route every protected remote operation through one fail-closed wrapper, and let Electron main own resume wiring. Preserve all server, IPC, persisted-state, and renderer contracts.

**Tech Stack:** Node.js 24 CommonJS, Electron 43 `safeStorage`/`powerMonitor`, native `fetch`, `node:test`, Express-based LIRA Server protocol helpers.

## Global Constraints

- Correctness/data safety and security take priority over compatibility and minimal diff.
- Device private keys and access tokens must never cross the main-process boundary.
- `license-state.json`, IPC channel names, HTTP paths, protocol version 2, and canonical payload format must remain compatible.
- Desktop token TTL defaults to `10m`; proactive renewal must occur before expiry and heartbeat every 2–3 minutes.
- Existing user changes in both dirty worktrees must be preserved.
- Do not commit, publish, add dependencies, or use real user data.

---

## Goal

Implement single-flight authorization maintenance, complete server error classification, immediate gate closure, resume recovery, initial authorized-work startup, and cross-repository golden-vector protection.

## Non-goals

- Offline authorization, refresh tokens, automatic song sync, multi-device conflict resolution, or server API redesign.
- Cleanup or refactoring outside the license path.

## Current Behavior

- Concurrent expired protected calls each invoke `renew()`, producing parallel challenge/verify requests.
- Protected business requests return errors without updating the central state machine.
- HTTP 5xx and Session rejection codes fall through to `NEEDS_ACTIVATION`.
- Heartbeat runs every 150 seconds but is not explicitly triggered on OS resume.
- The server skips authorized work before `bootstrap()`, while the state listener is registered after that transition.
- Current canonical strings match the server, but existing tests assert only fragments.

## Ownership

- Owner: `src/electron/license/license-manager.js`, `src/electron/main.js`.
- Contracts: `specs/license-p0-hardening_design.md`, `D:/Work/lira-server/specs/lira-server_reverse_spec.md`, `docs/architecture/desktop/main.md`, `docs/architecture/desktop/preload.md`.
- Consumers: `src/electron/ipc/license-ipc.js`, `src/server.js`, `public/js/license.js`, `public/js/admin/import.js`.
- Tests: `test/license-manager.test.js`, `test/license-protocol.test.js`, `test/license-gate.test.js`, `test/license-ui.test.js`, and `D:/Work/lira-server/test/device-license-protocol.test.js`.

## Compatibility Constraints

- Keep protocol v2, ECDSA signing, fingerprint fields, remote paths, response shapes, and UI bridge method names unchanged.
- Preserve encrypted private-key storage and memory-only access tokens.
- Preserve the current manual full-snapshot song-sync UX.
- Do not modify server runtime behavior; server receives only a protocol regression test.

## Milestone 1: Lock the server/client protocol with golden vectors

**Files:**

- Modify: `test/license-protocol.test.js`
- Create: `D:/Work/lira-server/test/device-license-protocol.test.js`

**Interfaces:**

- Consumes: `buildActivationPayload()`, `buildAuthPayload()`, server `buildChallengePayload()`.
- Produces: fixed complete canonical strings shared by both repositories.

- [x] Replace fragment-only assertions with full-string client assertions for activation and challenge payloads.
- [x] Run `node --experimental-vm-modules --test test/license-protocol.test.js`; expect the golden tests to pass against the current client.
- [x] Add the same fixed strings to the server protocol test using server parameter names (`code`, `accountPassword`).
- [x] Run `node --test test/device-license-protocol.test.js` in `D:/Work/lira-server`; expect both server vectors to pass.

## Milestone 2: Make renewal and protected operations single-flight

**Files:**

- Modify: `src/electron/license/license-manager.js`
- Modify: `test/license-manager.test.js`

**Interfaces:**

- Consumes: existing `remote.challenge`, `remote.verify`, and protected remote methods.
- Produces: `renew()` backed by one `renewalPromise`, `heartbeatNow()`, `resume()`, and an internal authorized-request wrapper.

- [x] Add a failing test that gives the first token `expiresIn: '0s'`, invokes two `syncSongs()` calls concurrently, and asserts only two total challenge/verify calls including bootstrap.
- [x] Run the focused test and confirm it fails with three challenge/verify calls.
- [x] Implement `renewalPromise`; make `ensureAuthorized()` await it before reading the token.
- [x] Route profile, song sync, background, and pairing methods through one wrapper that retries once after a stale-token/session response and otherwise classifies the error centrally.
- [x] Add a heartbeat overlap test proving heartbeat waits for renewal and uses the replacement token.
- [x] Run `node --experimental-vm-modules --test test/license-manager.test.js`; expect all manager tests to pass.

## Milestone 3: Complete state mapping and fail-closed transitions

**Files:**

- Modify: `src/electron/license/license-manager.js`
- Modify: `public/js/license.js`
- Modify: `test/license-manager.test.js`

**Interfaces:**

- Consumes: `RemoteLicenseError.code`, `.status`, and `.retryable`.
- Produces: deterministic `AUTHORIZED`, `NEEDS_CONNECTION`, `NEEDS_ACTIVATION`, and `BLOCKED` transitions.

- [x] Add failing tests for protected `DEVICE_REVOKED`, startup `HTTP_503`, valid-token transient 503, and `SESSION_SUPERSEDED` during immediate heartbeat.
- [x] Expand terminal authorization codes and classify retryable errors (including 429/5xx) as connection failures only when the current token is no longer valid.
- [x] Preserve `AUTHORIZED` for transient protected-call failures while the token remains valid.
- [x] Add renderer messages for session rejection and generic HTTP 5xx without exposing response bodies.
- [x] Run the manager and UI tests; expect explicit rejection to clear the token and temporary failures to preserve identity.

## Milestone 4: Wire OS resume and initial authorized work

**Files:**

- Modify: `src/electron/main.js`
- Modify: `src/electron/license/license-manager.js`
- Modify: `test/license-manager.test.js`
- Modify: `test/license-gate.test.js`

**Interfaces:**

- Consumes: Electron `powerMonitor`, manager `resume()`, runtime `resumeAuthorizedWork()`.
- Produces: one immediate server check on resume and one initial authorized-work resume after successful bootstrap.

- [x] Add a manager test asserting `resume()` immediately heartbeats and leaves one rescheduled maintenance timer.
- [x] Import `powerMonitor`, register one `resume` listener after manager creation, and remove it in `before-quit`.
- [x] Invoke `resumeAuthorizedWork()` once when bootstrap initially returns `AUTHORIZED`, without reloading the already-targeted page.
- [x] Add static lifecycle assertions covering registration, cleanup, and initial resume ordering.
- [x] Run focused Electron/license tests and expect the lifecycle assertions to pass.

## Milestone 5: Documentation and final verification

**Files:**

- Modify: `docs/architecture/desktop/main.md`
- Modify: `specs/README.md`
- Update: this plan with actual verification results and completion state.

**Interfaces:**

- Produces: lifecycle and specification facts consistent with runtime code.

- [x] Document token maintenance ownership, resume behavior, fail-closed state transitions, and the initial authorized-work resume.
- [x] Mark `specs/license-p0-hardening_design.md` implemented only after source and tests pass.
- [x] Run `npm run check`.
- [x] Run `npm run verify:architecture` (8/9 pass; unrelated pre-existing gift SQL-boundary failure recorded below).
- [x] Run all focused license tests.
- [x] Run `npm test` because authorization and Electron lifecycle are release-critical (947/948 pass; same unrelated gift SQL-boundary failure).
- [x] Run the server protocol test in `D:/Work/lira-server`.
- [x] Run `git diff --check` and inspect `git status --short` in both repositories.

## Rollback Or Failure Handling

Stop on any contract mismatch or unrelated failing gate. Inspect only task-owned hunks with `git diff -- <paths>` and reverse them with `apply_patch`; never reset, checkout, or delete unrelated work. Tests use mocks or temporary directories and require no runtime-data cleanup.

## Verification Results

- Focused client license suite: all protocol, identity, manager, transport, gate, UI, and background tests passed.
- Client JavaScript check: 458 files passed.
- Client documentation gate: 5/5 passed.
- Client architecture gate: 8/9 passed; only `src/bilibili/gift/event-service.js` increased receiver-aware SQL usage. That file was already modified outside this task and was not changed here.
- Client full suite: 947/948 passed; the only failure is the same unrelated architecture assertion.
- LIRA Server full suite: 38/38 passed, including the new byte-exact desktop/server vectors.
- Client `git diff --check` passed. The server-wide check reports trailing whitespace in the concurrently modified `docs/GIFT_EFFECT_CATALOG_SERVER_PLAN.md`; the task-owned protocol test has no whitespace finding.
- Live deployment probe: `api.lirahub.cn` resolves to `106.14.34.179`, but TCP 443 timed out while this machine could reach another HTTPS host; port 80 answered `403`. Production HTTPS therefore needs deployment/network repair and was not weakened to HTTP in client code.

## Done When

- Concurrent operations share exactly one renewal.
- Heartbeat and protected requests cannot race a token rotation.
- Revocation/session rejection immediately closes the gate and preserves local identity.
- Timeout, DNS, 429, and 5xx recovery states are correct.
- Resume and initial startup both restore authorized work correctly.
- Client and server canonical golden vectors match exactly.
- Focused and full verification passes, documentation matches code, and diffs contain only task-related changes.
