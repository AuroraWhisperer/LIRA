# Gift Sync Silent Stream Recovery Implementation Plan

**Status:** Complete (2026-09-09; source fix verified, packaged application unchanged).

**Goal:** Recover finalized server gifts promptly when an open SSE stream delivers no gift notifications.

**Architecture:** Keep SSE as the immediate path and add a controller-owned 10-second cursor reconciliation timer after successful synchronization. Reuse the existing serialized, fenced catch-up and idempotent importer; do not add another transport or change settlement semantics.

**Tech Stack:** Electron 43, Node.js 24, CommonJS, existing `node:test` fake timers.

## Current Behavior

Read-only runtime inspection found cursor 1524 last validated at 13:03:21 on September 9. At 13:08:22 the client imported 77 finalized gifts in one batch and requested display notifications. The server implementation rotates SSE connections every five minutes. The client has no cursor reconciliation trigger while a stream remains silently open. The deployed SSE delivery failure itself is not established by this evidence.

## Ownership and Constraints

- Owner: `src/electron/remote-gift-controller.js`.
- Tests: `test/remote-gift-controller.test.js`; existing processed-import, gift-sync-store and remote-license-client tests protect adjacent contracts.
- Fact owner: `docs/architecture/desktop/main.md`.
- Preserve DeviceBearer handling, source/auth/controller/projection fences, durable cursor ordering, history-only bootstrap, idempotent consumers and all HTTP/IPC/schema contracts.
- Do not enable local gift detection, change recent-list eligibility, modify real user data, edit/deploy the remote server, package or publish.

## Milestone: Bound silent-stream recovery latency

- [x] Add regression tests with existing injected timers: a silent open stream recovers a new final through cursor pull; later ticks use the advanced cursor; a pending pull is not overlapped; stop/dispose/restart invalidate timers; legacy mode remains partial; retryable failures retain reconnect backoff.
- [x] Run the new focused tests before implementation and confirm the missing timer causes failure.
- [x] Add one `RECONCILE_INTERVAL_MS = 10_000` timer. Schedule only after `LIVE` or `LEGACY_PARTIAL`, clear on all other states and remote-work cancellation, capture the four-field fence when scheduling, and invoke existing `requestReconcile` only when that timer and fence remain current.
- [x] Document the interval and controller ownership in the desktop fact owner.
- [x] Run the controller tests, related import/store/client tests, syntax checks, and relevant architecture/document checks listed below.
- [x] Review the actual diff, `git diff --check`, and `git status --short`.

## Verification Results

- Before implementation: `node --test --test-name-pattern='silent open SSE' test/remote-gift-controller.test.js` failed at `assert.ok(firstTimer)`, reproducing the absent fallback.
- After implementation: `node --test test/remote-gift-controller.test.js` passed 30/30 tests, including eight new regression cases.
- `node --test test/remote-license-client.test.js test/processed-gift-import.test.js test/gift-sync-store.test.js` passed 35/35 related contract tests.
- `node --experimental-vm-modules --test test/module-boundaries.test.js test/esm-module-boundaries.test.js test/governance-docs.test.js` passed 18/18 checks after the controller edit.
- `node --check src/electron/remote-gift-controller.js`, `node --check test/remote-gift-controller.test.js`, and `git diff --check` passed. Git only reported repository LF/CRLF conversion warnings.
- Reviewed changes are limited to the controller, its tests, the owning desktop fact document, and this plan. No database, generated asset, secret, package or deployment changed. At completion the root cause was not yet diagnosed; this change only bounded client recovery when the authoritative cursor endpoint was available. Subsequent source and installed-archive inspection reproduced a client-side canonical-event rejection, tracked in the `2026-09-09-gift-sse-canonical-event-handoff` follow-up plan.

## Failure Handling and Done When

Failed pulls continue through existing generation error handling/backoff. Timers never independently advance a cursor or import an event. Reverse only this task's scoped edits if checks uncover a contract conflict; do not reset repositories or touch live data. Complete when focused tests demonstrate silent-stream recovery with lifecycle and concurrency invariants preserved, documentation is consistent and the diff is reviewed. The running packaged application is not replaced as part of this source fix.
