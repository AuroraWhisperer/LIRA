# PK opponent report desktop integration

## Goal and ownership

Add the server-confirmed PK opponent report switch to 弹幕姬 → 固定回复.
The server's `docs/protocol/pk-opponent-report.md` and Device OpenAPI own the
behavior. Main license operations own account binding, IPC validates/project
only the boolean switch, and `public/js/admin/danmaku-pk-report.js` owns UI state.

## Current behavior and scope

Welcome already uses dedicated authenticated Device requests, owner-checked
operations, narrow preload/IPC and confirmed/pending/error rendering. Reuse this
path for PK without changing welcome, local sending, credentials or cloud scope
revisions. Default off; monetary ranks remain unavailable until upstream rules
are verified. No dependencies, new process, release or deployment.

## Changes and verification

- [x] Extend remote-license-client, license-operations, license-ipc and preload
  with `getPkReportSettings` / `updatePkReportSettings({ enabled })` and fixed
  `license:get-pk-report-settings` / `license:update-pk-report-settings` channels.
- [x] Add fixed-reply fragment and named ESM controller; initialize from
  danmaku-tool. Pending/failed writes keep the confirmed checkbox value; failed
  disable warns that cloud reporting may continue. Account switches and disposal
  reject stale results. Old server unsupported state allows retry, never local send.
- [x] Document the IPC/HTTP contract in desktop/main.md and retain a shared fixture.
- [x] Run `node --experimental-vm-modules --test test/pk-report-settings-ipc.test.js
  test/frontend-pk-report.test.js test/welcome-settings-ipc.test.js
  test/frontend-welcome.test.js test/danmaku-overlay-ipc.test.js
  test/admin-page-composition.test.js`; run architecture checks for module/size
  boundaries and inspect scoped diff plus `git diff --check`.

## Failure handling and completion

All failures preserve last confirmed state with explicit retry; no queued offline
write. Stop on contract mismatch and correct server/client together. Reversal is
limited to this task's named changes, preserving existing untracked audit folders.
Complete when synthetic auth/IPC/account-switch/frontend checks pass, contracts
match and the final diff contains no generated runtime data or secrets.

## Verification outcome

The six focused test files passed 30/30; module boundaries, ESM identifiers, file-size registry and documentation checks passed 27/27. Reviewed the one-line HTML fragment insertion and four-line fixed transport declarations, recording cohesive ownership and exact warning-band ceilings. `git diff --check` passed. Monetary conversion and real upstream end-to-end validation remain deferred by the server contract. No release or real user settings changed.
