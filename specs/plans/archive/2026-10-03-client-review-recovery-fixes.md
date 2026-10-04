# Client Review Recovery Fixes Implementation Plan

Status: Completed on 2026-10-03. All four requested fixes and their regression checks passed; completion evidence and verification limits are recorded below.

## Goal and architecture

Preserve saved opening settings after read failures, retain unsent account-owned cloud settings across restarts, flush playback before normal window closure, and reconcile songs after WebSocket reconnects. Keep the existing modular monolith, stores, cloud coordinator, shutdown coordinator, and Admin state service as owners.

## Evidence before implementation

- Failed opening config GET followed by a volume edit posts all 11 default fields.
- A failed settings upload followed by controller recreation replaces local queue limit 77 with remote 50.
- The close-window IPC destroys the main window before the shutdown hook; the real playback flush returns `skipped`.
- A reconnect snapshot leaves songs changed during disconnection stale in the UI.
- Existing related tests: 82 passing; dependency/ESM tests: 13 passing. At initial review, fan-profiles.css had an unrelated size-gate failure (650 lines against 647); the final architecture gate passed in the current workspace.

## Boundaries and compatibility

No changes to HTTP/IPC URLs, payloads, authentication, updater policy, public settings keys, dependencies, or the other repository. Preserve pre-existing workspace edits and staged content. New internal pending settings records use the existing settings table, are partitioned by authenticated account owner, and are omitted from public settings. No schema migration is needed for additional private key/value records. Do not persist credentials or the server-only gift interaction intent. No commits or release work.

## Ownership and implementation

1. `public/js/admin/start-animation.js` and its HTML fragment: mark config loaded only after a successful valid response. Disable editing while unloaded, expose a retry and persistent read status, and guard autosave/media mutations. Reuse existing form/control styles. Tests: `test/overlays/frontend-opening-runtime.test.js`.
2. `src/storage/settings-store.js` owns atomic settings plus pending-snapshot writes; a focused `cloud-settings-sync-store.js` reads/acknowledges `{ mutationId, values }` records. Move only the cloud key inventory and change predicate into `src/shared/cloud-settings.js`, retaining the existing server contract exports. `src/server.js` exposes narrow pending read/ack methods, serializes pending values using the existing contract, and explicitly suppresses dirty capture for cloud application. `cloud-sync-controller.js` restores the current owner's pending settings before reconciliation, uploads them, and clears a record only after a matching successful acknowledgement. A newer concurrent edit or account change must survive late acknowledgements. Tests: new `test/cloud-sync/cloud-settings-sync-recovery.test.js`, existing settings/cloud/account tests.
3. `src/electron/main.js`: intercept main-window `close`, prevent destruction, and enter `requestDesktopShutdown`. Existing five-second deadline and first-intent ownership remain. Test the actual close IPC and native close events with the real playback-flush module, including repeated close and timeout, in the existing shutdown fixture/suite.
4. `public/js/admin/state.js`: reload songs after a successful reconnection, use current filters and existing latest-request checks, and avoid an extra fetch on the first connection. Tests: existing Admin state suite with a real mocked-fetch reconnect scenario and a shutdown timer assertion.

Contracts: `docs/reference/backend/storage.md`, `docs/reference/desktop/main.md`, `docs/reference/frontend/app.md`, and `docs/reference/frontend/comms.md`.

## Milestones and verification

- [x] Add regressions and confirm the four failure paths against the current code (13 failing cases before implementation; the network-error fixture also exposed its incomplete toast stub, resolved by the persistent error UI).
- [x] Implement opening read protection and reconnect reconciliation; run the affected frontend suites.
- [x] Implement atomic pending settings and restart/account/concurrent mutation recovery; run cloud-sync and settings suites with isolated SQLite data (139 passing).
- [x] Implement unified window close and run shutdown/lifecycle tests (61 passing across opening, Admin state and desktop shutdown, using the real playback-flush module for window closure).
- [x] Update the four owning contract documents and review the task-touched size registry entries for `src/server.js`, `src/electron/main.js`, and `src/electron/cloud-sync-controller.js`.
- [x] Run `npm run check` (1,209 JavaScript files), `npm run verify:docs` (10 tests), `npm run verify:architecture` (22 tests), and `node scripts/run-tests.js offline --test-reporter=spec` (449 of 499 test files; 3,097 tests). All passed with no failed or skipped tests. The offline group excludes runtime/browser/installer tests; no real Electron app or manual UI validation was run. Window closure used the real playback-flush module with an isolated simulated Electron window.
- [x] Review the task-owned changes using recorded patches and scoped Git diffs, run `git -c core.safecrlf=false diff --check`, inspect status, and archive the completed plan. The original temporary baseline at `tmp/client-review-fixes-before` was unavailable at final review; unrelated style/scene edits were distinguished from the recorded task changes and preserved.

## Failure handling and done conditions

Read failure keeps opening writes blocked. Failed/aborted sync retains the pending record. SQLite errors roll back both the setting and its pending record. Stale responses cannot acknowledge a newer mutation or apply to another account. Shutdown retains its existing bounded timeout. Rollback must identify task-owned hunks from the recorded patches and scoped Git diffs, then reverse only those hunks; do not reset or discard unrelated work.

Done when all four regressions pass, affected contracts match the implementation, proportional verification passes or unrelated baseline failures are documented, and the scoped diff contains no runtime or secret data.
