# Cloud room account ownership implementation plan

**Status:** Implemented; repository-wide verification limitations recorded below.

> Execute task-by-task in the current session under the user's repair request. Preserve pre-existing work and do not commit, package, deploy, or change installed user data.

**Goal:** A newly authorized LIRA account must not automatically inherit the previous account's local live room.

**Architecture:** The settings store owns a persisted room-account marker and clears an unowned room in the same transaction that changes its owner. The Electron sync controller prepares that boundary synchronously before starting requests; the runtime reconfigures and broadcasts the resulting room without a dirty echo. Authenticated origin, account name and stable streamer ID identify the owner, including across restart and same-name account recreation.

**Tech Stack:** Existing CommonJS, Node.js 24, Electron 43, SQLite settings store, node:test. No new dependency or wire field.

## Current behavior and scope

Installed 4.1.1 retained room `1716079620` from test1 and seeded test2 after authorization. Current code resets in-memory revisions/dirty state on account changes but retains the shared local room. Server ADR-0006 clause 6 and REQ-SYNC-002 currently permit this initial seeding; this repair explicitly narrows room inheritance with a superseding ADR and matching requirements/acceptance text.

Only room ownership changes. Songs, other settings, credential storage, Device authentication, server monitoring and local data directories retain their existing contracts. Existing cloud rooms still restore normally. The repair does not guess whether an already initialized cloud room was mistakenly seeded.

## Owners and interfaces

- `src/electron/license/license-manager.js`: main-only `getCloudSyncIdentity()` returns `{streamerId, accountName}` from saved device identity; no token or key.
- `src/storage/settings-store.js`: `prepareCloudRoomAccount(accountKey)` returns whether ownership changed. Persist internal `cloudRoomAccountKey` with the reset room atomically; exclude it from ordinary settings snapshots and editable defaults.
- `src/server.js`: `prepareCloudRoomAccount(accountKey)` calls the store and, after change, reconfigures the room and broadcasts `cloud:settings`.
- `src/electron/desktop-runtime.js`: forwards that one internal runtime method.
- `src/electron/cloud-sync-controller.js`: validates identity, builds `JSON.stringify([origin, accountName, streamerId])`, fences old work, prepares the room, then permits sync. Missing identity or storage failure must not upload. Same-owner authorization interruption retains pending writes.
- Tests: new `test/cloud-room-account.test.js`, existing controller/isolation/runtime/license tests.
- Contracts: client sync spec/storage/main docs; server REQ-SYNC-002, AC-SYNC-002, client-server API semantics, traceability and new accepted ADR.

## Milestones

### 1. Reproduce inheritance and define the contract

- [x] Add isolated SQLite/controller tests for old local room -> empty new cloud, same owner restart, different origin/account/streamer ID, dirty retry, missing identity, and transactional failure.
- [x] Verify the regression is red with `node --test test/cloud-room-account.test.js`.
- [x] Narrow normative room seeding rules and add the ADR; preserve existing OpenAPI DTOs.

### 2. Implement the ownership boundary

- [x] Expose the saved non-secret sync identity and forward the room preparation method through the existing runtime adapter.
- [x] Store the marker/reset in one SQLite transaction:

```js
db.exec('BEGIN IMMEDIATE');
try {
  writeSetting.run('roomId', '', now());
  writeSetting.run('cloudRoomAccountKey', accountKey, now());
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
```

- [x] Prepare the room before first sync and every changed authenticated identity. Drop unowned settings dirty state while retaining same-owner pending edits.
- [x] Add adapter/runtime coverage proving room reset does not emit dirty or expose the marker in settings/Device snapshots.
- [x] Run `node --test test/cloud-room-account.test.js test/cloud-sync-controller.test.js test/cloud-sync-account-isolation.test.js test/cloud-runtime-sync.test.js test/license-manager.test.js`.

### 3. Verify and review

- [x] Run client `npm run verify:quick` and the focused lifecycle/auth/settings suites; broaden to the full client gate because the account preparation changes every authorized startup.
- [x] Run server `npm run docs:check` and existing cloud sync HTTP/state tests (server runtime is unchanged).
- [x] Compare task deltas to `.codex-tmp/room-account-fix-before/`, review `git diff --check` and targeted status in both repositories. Preserve unrelated concurrent edits.
- [x] Record results, archive this plan, and report that installed binaries and existing cloud data require a separate update/configuration action.

## Failure and rollback

Storage failures leave the old marker and room unchanged and prevent sync. Missing or invalid stable identity leaves synchronization inactive. A same-owner room is not cleared by restart or temporary authorization loss. Reverse only this task's hunks against the saved baselines if needed; never restore whole files over subsequent user work.

## Done when

The old room cannot seed a different owner, including after restart and same-name recreation; the current owner can explicitly configure and retry a room; current cloud rooms restore; storage failure is atomic; contracts/tests agree and task changes contain no runtime data or secrets.

## Verification results

- Regression baseline: 10 tests, 9 failed. The first failure uploaded the old room instead of the expected empty room.
- Focused controller/runtime/license run: 78/78 passed before adding one more database-reopen regression. The added regression also passed in the full suite.
- Client syntax: passed for 624 JavaScript files. Documentation governance: 5/5 passed.
- Full client suite: 1748 tests, 1740 passed, 6 failed, 2 skipped. Failures concern the unchanged desktop lyrics tests, playback typography and the reviewed size ceiling of test/desktop-lyrics.test.js (1743 versus 1718 lines). No related room/controller/runtime/license test failed.
- npm run verify reaches the architecture gate and reports the unrelated desktop-lyrics size failure. Task source changes were kept within their existing reviewed ceilings.
- Server docs:check: 33/33 passed. Server cloud-state, HTTP sync and SSE tests: 21/21 passed.
- Task source/test deltas were compared with saved baselines and git diff --check passed for touched files. Unrelated work was preserved.
- No installed executable, live client database, cloud room, release, commit or deployment was changed. Existing cloud room remediation and distributing the fixed client remain separate operations.

**Outcome:** Repair implementation and scoped validation complete; the repository-wide gate remains limited by the six unrelated failures above.
