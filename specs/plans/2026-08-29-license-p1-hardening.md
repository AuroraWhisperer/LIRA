# License P1 Hardening Implementation Plan

> Status: Complete — automated verification green (979/980; the single failure is the pre-existing `src/bilibili/gift/event-service.js` SQL-debt regression from the uncommitted P0 workstream, HEAD baseline 11 → worktree 12, unrelated to P1). Manual desktop verification items below remain for the user.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the eight client-side P1 gaps from the LIRA Server v0.6 audit report §8, on top of the completed P0 hardening.

**Architecture:** `src/electron/license/license-manager.js` remains the single token/state owner. Renewal retries gain a bounded jittered backoff policy. Resume wiring moves to a testable module. Pairing/song-sync UX gains explicit confirmation and cloud-state visibility. A stateful fake license server drives protocol E2E tests.

**Tech Stack:** Node.js 24 CommonJS, Electron 43 `safeStorage`/`powerMonitor`, native `fetch`, `node:test`.

## Global Constraints

- Correctness/data safety and security take priority over compatibility and minimal diff.
- Device private keys and access tokens must never cross the main-process boundary.
- `license-state.json`, IPC channel names, HTTP paths, protocol version 2, and canonical payload format must remain compatible.
- Preserve all P0 behavior and the user's uncommitted P0 working-tree changes; P1 builds on them in place on `main`.
- Do not commit, publish, add dependencies, or use real user data.
- Song sync stays manual-only; no automatic background sync.
- `GET /api/device/songs` response shape is unverified; parse defensively and degrade gracefully.

## Non-goals

- Server-side changes (revision/If-Match, sync metadata) — deferred to server P2.
- Real-HTTP stub server E2E — deferred; E2E uses a stateful in-memory fake server.
- Offline authorization grace, refresh tokens, auto-sync.

## Milestone 1: Testable resume wiring (P1-7)

**Files:**

- Create: `src/electron/license/license-resume.js`
- Modify: `src/electron/main.js`
- Create: `test/license-resume.test.js`

- [x] Write failing `test/license-resume.test.js`: fake `powerMonitor` (`on`/`removeListener` event table); register adds `resume` listener; firing `resume` calls `licenseManager.resume()`; errors are logged via `writeLog`; unregister removes the listener.
- [x] Implement `createLicenseResumeHandler({ powerMonitor, getLicenseManager, writeLog })` returning `{ register, unregister, isRegistered }`; `getLicenseManager` stays a function to capture the latest reference.
- [x] Replace the internal `registerLicenseResumeHandler`/`unregisterLicenseResumeHandler` closures in `main.js` with the new module; ensure `before-quit` unregisters.
- [x] Run `node --experimental-vm-modules --test test/license-resume.test.js test/license-gate.test.js`.

## Milestone 2: Bounded jittered renewal retry (P1-1)

**Files:**

- Create: `src/electron/license/retry-policy.js`
- Modify: `src/electron/license/license-manager.js`
- Create: `test/license-retry.test.js`

- [x] Write failing `test/license-retry.test.js`: deterministic `randomSource` produces 5s→10s→20s→… capped delays; exceeding `maxAttempts` yields `null` and `NEEDS_CONNECTION`; success resets the policy.
- [x] Implement `createRetryPolicy({ baseMs = 5000, capMs = 60000, maxAttempts = 10, jitter })` → `{ nextDelay(), reset(), attempts }`; exponential growth capped at `capMs`, jitter factor `[0.5, 1.5)`, `null` past `maxAttempts`.
- [x] Add `randomSource` injection to `createLicenseManager` (default `Math.random`), wrapped as `() => randomSource()` for the policy.
- [x] Rewrite `scheduleRenewalRetry()` to use the policy; `null` → `NEEDS_CONNECTION` and stop; delay clamped by remaining token lifetime (`Math.max(1000, Math.min(backoff, tokenExpiresAt - Date.now()))`).
- [x] Reset the policy in `scheduleSessionMaintenance()` (success) and `handleAuthError()` (state change).
- [x] Run `node --experimental-vm-modules --test test/license-retry.test.js test/license-manager.test.js`.
- [x] Confirm `npm run verify:architecture` accepts the new module.

## Milestone 3: Concurrent 401 regression test (P1-2)

**Files:**

- Modify: `test/license-manager.test.js`

- [x] Add test: after bootstrap, `remote.syncSongs` fails N times with `DEVICE_SESSION_INVALID` then succeeds; fire 3 concurrent `manager.syncSongs([])`; assert exactly one extra `verify` call and all three calls succeed with the new token.

## Milestone 4: Log redaction completeness (P1-3)

**Files:**

- Modify: `src/shared/log-redaction.js`
- Create: `test/log-redaction.test.js`

- [x] Write failing `test/log-redaction.test.js`: objects/Errors/URLs containing password, full activation code, token, signature, privateKeyPem, raw fingerprint/hardwareId are fully `[REDACTED]`; non-sensitive fields survive.
- [x] Extend `redactObject` key matching: exact `activationcode`/`pairingcode`/`fingerprint`/`hardwareid`, `*signature` suffix, `privatekey` substring.
- [x] Extend `redactString` URL query regex and `redactUrl` `sensitiveParams` with `activationcode|pairingcode|signature|privatekey`.
- [x] Run `node --experimental-vm-modules --test test/log-redaction.test.js`.

## Milestone 5: Song-sync overwrite confirmation (P1-5)

**Files:**

- Modify: `public/js/admin/import.js`
- Modify: `public/pages/admin/song/import-export.html`
- Modify: `test/license-ui.test.js`

- [x] Write failing UI test: `import.js` calls `showConfirmationDialog` before `window.liraLicense.syncSongs` and skips sync on cancel.
- [x] Insert caution confirmation dialog in `initCloudSongSync` click handler showing local song count; `confirmLabel` 覆盖同步, `initialFocus: 'cancel'`.
- [x] Update the static hint in `import-export.html` to mention the confirmation.

## Milestone 6: Cloud sync visibility (P1-6)

**Files:**

- Modify: `src/electron/license/remote-license-client.js`
- Modify: `src/electron/license/license-manager.js`
- Modify: `src/electron/ipc/license-ipc.js`
- Modify: `src/electron/preload.js`
- Modify: `public/js/admin/import.js`
- Modify: `public/pages/admin/song/import-export.html`
- Modify: `test/license-manager.test.js`, `test/license-ui.test.js`

- [x] Add `getCloudSongs` to the remote client (`GET /api/device/songs`), expose via manager `withAuthorizedToken`, IPC channel `license:get-cloud-songs`, and preload `liraLicense.getCloudSongs`.
- [x] Manager test: `getCloudSongs` uses the current token through `withAuthorizedToken`.
- [x] `import.js`: fetch cloud song count on panel init; parse defensively (`Array` / `.songs` / `.items`); degrade to `null` on failure without blocking.
- [x] Confirmation dialog shows `云端现有 X 首，将被本地 Y 首覆盖` when the count is known, local-only otherwise.
- [x] On successful sync, persist `localStorage['lira:license:lastCloudSync'] = { time, count }`; render 本机上次同步 line (or 尚未同步); add `#licenseLastCloudSync`/`#licenseCloudCount` placeholders in `import-export.html`.
- [x] UI test: cloud count is read before sync and rendered into the confirmation copy.

## Milestone 7: Pairing UI polish (P1-4)

**Files:**

- Modify: `public/js/admin/settings.js`
- Modify: `public/pages/admin/toolbox/settings.html`
- Optional: `public/css/admin/other-features/settings.css`
- Modify: `test/license-ui.test.js`

- [x] Write failing UI tests: `settings.js` uses `dangerConfirm` before revoke; renders `createdAt`/`expiresAt`/`usedAt`; contains `PAIRING_CODE_ALREADY_CONSUMED` copy.
- [x] Extend `renderCodes` with created/expires/used timestamps (guard invalid dates).
- [x] Gate revoke behind `dangerConfirm`; restore button state on cancel; refresh list after confirmed revoke.
- [x] Add local `PAIRING_ERROR_MESSAGES` map (TOO_MANY_PAIRING_CODE_REQUESTS, TOO_MANY_ACTIVE_PAIRING_CODES, PAIRING_CODE_NOT_FOUND, PAIRING_CODE_ALREADY_CONSUMED) — copy text from `public/js/license.js`, no cross-file import.
- [x] Add `<small>`/`<time>` containers in `settings.html` and matching CSS.

## Milestone 8: Protocol E2E with stateful fake server (P1-8)

**Files:**

- Create: `test/license-protocol-e2e.test.js`

- [x] Implement `createFakeLicenseServer()`: in-memory devices/sessions/pairingCodes/revocation state, all remote-client methods, `calls` counters, and helpers (`revokeDevice`, `supersedeSession`, network down/up toggle). No real signature verification — record presence only.
- [x] Scenario: first activation → challenge/verify → `AUTHORIZED`.
- [x] Scenario: restart with new `runtimeId` → verify carries the new runtimeId.
- [x] Scenario: proactive renewal single-flight (`expiresIn: '0s'` + concurrent business calls → exactly one extra verify).
- [x] Scenario: mid-session `DEVICE_REVOKED` → `BLOCKED`, token cleared.
- [x] Scenario: `SESSION_SUPERSEDED` → `BLOCKED`.
- [x] Scenario: network down → `NEEDS_CONNECTION`; network up + `resume()` → `AUTHORIZED`.
- [x] Scenario: pairing create/list/revoke round-trip.
- [x] Scenario: concurrent 401 storm → exactly one re-verify.
- [x] Run `node --experimental-vm-modules --test test/license-protocol-e2e.test.js`.

## Milestone 9: Documentation sync

**Files:**

- Modify: `docs/architecture/desktop/preload.md`
- Modify: `docs/architecture/frontend/pages.md`
- Modify: `docs/architecture/desktop/main.md`

- [x] `preload.md`: complete the `liraLicense` channel registry (get-state/activate/retry/get-profile/sync-songs/pairing trio/state-changed) plus new `license:get-cloud-songs`.
- [x] `pages.md`: import/export page gains overwrite confirmation, cloud count compare, last-sync display; settings page gains pairing timestamps and revoke confirmation.
- [x] `main.md`: renewal retry backoff policy, `license-resume.js` ownership, redacted-field list.
- [x] Run `npm run verify:docs`.

## Final Verification

- [x] `npm run verify` passes (docs + check + architecture + full test suite). — 979/980; sole failure is the pre-existing `event-service.js` SQL-debt regression from the P0 workstream (HEAD=11, worktree=12, limit=11), not introduced by P1.
- [ ] Manual: offline renewal retries show increasing jittered intervals in desktop.log without sensitive data.
- [ ] Manual: 账号中心 pairing create/list shows timestamps; revoke asks for confirmation.
- [ ] Manual: 导入导出页 sync asks for confirmation with local/cloud counts and shows last-sync info afterwards.
