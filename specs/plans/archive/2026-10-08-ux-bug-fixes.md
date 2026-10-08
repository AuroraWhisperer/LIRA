# Four UX Bug Fixes

Status: Complete. All four fixes, focused regressions, documentation and final diff checks passed on 2026-10-08.

## Goal / Current Behavior

Preserve song edits made while a save is pending; continue automatic playback past unavailable songs; keep radio refills with their originating platform and queue; align the playlist highlight after switching from shuffle to sequence. The earlier isolated reproductions confirmed draft loss, stalled advancement, wrong-provider refills and a stale playlist cursor.

## Ownership / Scope

- `public/js/admin/songs.js`: form snapshots and save responses; `test/songs/frontend-song-editor.test.js` verifies the real form.
- `public/js/playback/features/playback-controls.js`: bounded automatic advancement and cancellation; `test/playback/playback-stream-recovery.test.js` verifies actual controller events.
- `public/js/playback/features/radio-mode.js`: refill ownership; `test/playback/playback-radio-feedback.test.js` verifies delayed responses.
- `public/js/playback/queue/manager.js`: radio source and playlist cursor; `test/playback/playback-state-actions.test.js` verifies duplicate/request identity.
- Contract: `docs/reference/frontend/playback.md`; `controller.js` forwards the internal skip option, `features/stream-handler.js` requests automatic skipping after audio recovery fails. Queue coordinator and audio event handlers remain consumers.

## Compatibility / Non-goals

Keep public HTTP/IPC contracts, persisted fields, provider authentication and manual selection failure behavior. No provider retries, new dependencies, new UI, release, commit or unrelated refactoring. Preserve concurrent user changes. Synthetic fixtures only.

## Proposed Changes / Milestones

1. Capture the submitted form and form identity; only reset an unchanged form, retain later edits and the returned ID. Verify the existing browser fixture.
2. Let playback attempts report unavailable versus accepted or superseded; automatic advancement scans a bounded queue/list pass and stops on cancellation. Verify empty/error results, playlist wrap, all-unavailable termination and a newer user selection.
3. Bind refill requests to a radio array and fixed source; check ownership before mutation or notifications. Verify provider browsing and queue replacement, including same-provider replacement.
4. Match the consumed track to the playlist cursor while keeping sequential duplicate positions. Verify shuffle-to-sequence and distinct requests of the same song.

## Verification

- `node --test test/songs/frontend-song-editor.test.js` (existing installed Playwright runtime via NODE_PATH if needed).
- `node --experimental-vm-modules --test --test-concurrency=3 test/playback/playback-stream-recovery.test.js test/playback/playback-radio-feedback.test.js test/playback/playback-state-actions.test.js test/playback/playback-queue-behavior.test.js`.
- Directly related quality/logout/persistence tests if request-generation or radio restoration changes require them.
- `npm run verify:docs`, touched JavaScript syntax checks, final scoped diff review, `git diff --check`, `git status --short`.

## Budget / Failure Handling / Done When

Start 2026-10-08 10:29:20 UTC; original delivery target 10:59:20 UTC. The user's replacement AGENTS removed the mandatory execution budget during implementation. Song saving and radio ownership were independently delegated under the original instructions; primary owns playback and queue behavior. The main uncertainty is bounded skipping without allowing an obsolete task to advance a newer selection. If verification fails, preserve the scoped diff and report concrete unfinished work; reverse only task-owned changes if necessary. Complete only when all four behaviors, relevant regressions, contract updates and final review pass.

## Results

- Confirmed failures before fixing automatic advancement, playlist cursor and missing radio source keys. Existing reproduction evidence already covered form loss and radio source changes.
- Song form: 6/6 browser tests passed, including a rerun after concurrent changes to the song owner; no real user data or external services.
- Playback: final 92/92 tests passed across stream-recovery, state-actions, queue-behavior, radio-feedback, quality, logout-recovery and persistence. This includes delayed responses, empty/error URLs, list wrap, repeat-one failure, all-unavailable termination, and new radio tracks arriving while an unavailable song resolves. Logs: ignored `tmp/ux-fixes-playback-tests.log`.
- Current-queue-only bounds initially stopped before newly refilled radio tracks; the final bound permits one existing configured refill batch and has a regression covering continuous unavailable refills.
- Final caller inspection reproduced the same stall when audio error recovery advances to an unavailable song. That caller now requests the same automatic skip policy; manual next remains unchanged. The final focused rerun includes this regression.
- `npm run verify:docs`: 10/10 passed. Syntax checks passed for all 10 touched JavaScript files, and `git diff --check` passed. Final scoped diff and status reviewed; concurrent unrelated work preserved, including `readSongFilters` in the shared song file. No commits, releases, real user data or new dependencies.
- Verification used synthetic provider responses and isolated fixtures; live provider accounts and privileged Electron sessions were not exercised. No remaining implementation or focused verification work.
