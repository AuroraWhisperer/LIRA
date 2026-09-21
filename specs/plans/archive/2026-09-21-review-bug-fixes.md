# Review Bug Fixes Implementation Plan

**Goal:** Preserve song-library edits across failed uploads and restarts; make manual/error skips work in repeat-one mode; prevent a pending stream request from restarting playback after music logout.

**Architecture:** Keep the existing SQLite stores, cloud controller and playback state owner. Store pending song snapshots in private settings metadata, committed with the song mutation, keyed by the existing authenticated cloud account identity. Extract song-specific cloud reconciliation into a focused helper so the existing controller stays within its registered size boundary.

**Tech Stack:** Node.js 24, SQLite, Electron, frontend ES modules, node:test.

## Boundaries and current evidence

- The review reproduced loss of an unsent added song after recreating the cloud controller: dirty flags are currently memory-only.
- Repeat-one currently intercepts both ended and explicit next/error skips.
- Logout clears audio/current state without invalidating the in-flight playback generation.
- Preserve HTTP/IPC contracts, local song formats, credential storage, cloud settings/Bilibili semantics, and existing initial cloud seeding. Do not commit or publish. Tests use synthetic data and isolated storage.
- This change does not implement multi-device conflict merging or recover edits already overwritten before the fix.

## Ownership and proposed changes

1. `src/storage/cloud-song-sync-store.js` owns private `cloudSongSyncPending:` settings rows. Each row stores a mutation ID and full song snapshot, scoped by the hash of the existing `[origin, accountName, streamerId]` identity. No schema migration is needed for the existing extensible settings table. `settings-store.js` excludes these rows from ordinary snapshots.
2. `song-store.js`, `database-maintenance.js` and `database-clear-operations.js` capture the latest pending snapshot inside local song mutation/clear transactions. Cloud replacement does not create an upload echo. An empty snapshot represents an intentional clear.
3. `domain-services.js`, `server.js` and `desktop-runtime.js` expose internal pending-read/acknowledgement ports. `cloud-song-sync-controller.js` handles pending restoration and cloud song reads/uploads; the existing cloud controller retains scheduling, authorization and dirty-generation ownership. Only a successful, current upload may acknowledge its exact mutation ID. Switching accounts preserves another account's pending snapshot without uploading it.
4. `playback-controls.js` limits repeat-one to natural completion and owns source-aware invalidation of in-flight playback. `provider-operations.js` invokes this on logout; `controller.js` wires the callback.
5. Update storage, desktop sync and playback owner documents with the resulting behavior.

## Milestones and verification

- [x] Add failing regressions for restart recovery, atomic song/outbox rollback, newer edits during upload, account changes, empty clears, repeat-one manual/error skipping, and logout while resolving a stream.
- [x] Implement persistent pending song snapshots and confirm failed uploads remain protected across restart; acknowledgement must not remove a newer snapshot.
- [x] Implement the playback fixes and confirm natural repeat-one still repeats and logout of another provider does not cancel unrelated playback.
- [x] Run focused tests: `node --experimental-vm-modules --test test/cloud-sync-controller.test.js test/cloud-sync-account-isolation.test.js test/cloud-room-account.test.js test/cloud-runtime-sync.test.js test/cloud-song-sync-recovery.test.js test/cloud-song-sync-store.test.js test/song-import-update.test.js test/database-maintenance.test.js test/data-clear-all-runtime.test.js test/data-clear-all-recovery.test.js test/playback-queue-behavior.test.js test/playback-stream-recovery.test.js test/playback-provider-operations.test.js test/playback-logout-recovery.test.js`.
- [x] Run `npm run verify:quick` for syntax, architecture and documentation checks; run the full local test suite because persistence and lifecycle paths change. Review the diff, `git diff --check` and `git status --short`.

## Failure handling and completion

Pending-snapshot write failure must roll back the song edit. Upload failure or stale authorization must retain pending data. An old acknowledgement must not clear a newer mutation. Preserve snapshots belonging to other accounts during account changes and local clears. If verification fails, fix only failures caused by this task; report unrelated failures. Rollback is limited to task-owned edits, without destructive repository commands or deleting user data.

Done when all three review reproductions are protected by passing regressions, relevant contracts describe the implementation, and the final diff contains no runtime data or secrets. Move this plan to `specs/plans/archive/` after completion and record actual verification below.

## Completed verification — 2026-09-21

- The new regressions first reproduced the lost offline edit after restart, missing atomic pending writes, repeat-one manual/error skips, and stale playback after logout. All now pass.
- Focused command above, with `--test-reporter=dot`: 139 passed.
- `npm run verify:quick`: passed; 5 documentation tests, syntax checks for 961 JavaScript files, and 22 architecture/modularity tests.
- The first full test run had 7 failures because the sibling server checkout was at a different revision from `server-contract.lock.json`. An existing, clean detached checkout at `C:/Users/Tom/AppData/Local/Temp/lira-interactions-server-contract` was verified with `node scripts/verify-server-contract.js`; all 5 fixture hashes matched revision `5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577`.
- `npm test` with `LIRA_SERVER_ROOT` set to that verified checkout: 2651 tests, 2647 passed, 0 failed, 4 skipped. No server working-copy changes were needed.
- Final diff and status reviewed; `git diff --check` passed. Changes contain only source, regression tests, owner documentation and this plan. No commits, runtime data or secrets.
- Playback verification uses actual frontend modules with isolated fake audio/IPC and deferred stream responses; native Electron UI was not launched. Song recovery tests use isolated SQLite databases, plus the existing HTTP/runtime integration fixture.

Implementation detail: recovery compares song payloads before replacing the local library so restarting the same pending library preserves song IDs and queue/history references. Source-specific logout invalidation also restores the retained provider's audio generation so it can still recover from a later playback error.
