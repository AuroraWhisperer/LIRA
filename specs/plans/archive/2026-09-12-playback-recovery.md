# Playback Recovery Implementation Plan

**Goal:** Fix S7-008, S7-009 and S7-010: restore single-track repeat with its queue, prevent obsolete error recovery from taking playback back, and keep the displayed track aligned with the audio when a new track has no URL.

**Architecture:** Keep playback ownership in `features/playback-controls.js`. Its existing request generation also governs error recovery through an injected guard; the stream service checks that guard before reporting or acting on an asynchronous result. Normalize supported saved mode aliases in the existing state manager.

**Tech Stack:** Electron 43, Node.js 24+, native frontend ESM and existing `node:test` playback fixtures. Execute inline in this task.

## Constraints and boundaries

- Preserve existing uncommitted playback changes, especially generation protection for quality changes, metadata and queue clearing.
- Preserve HTTP/IPC payload structure, storage keys, database schema, retry limit and resume-position behavior. No new dependencies or processes.
- Runtime modes remain `sequence`, `shuffle`, `repeat-one`; accept legacy `single` and normalize it to `repeat-one`. Preserve existing acceptance of `loop` and rejection of unknown modes.
- On a new track with no usable URL, retain the current track and audio; use the stream service's existing unavailable-song notification. Queue rollback and automatic skipping policy are outside this task.
- Do not change unrelated playback UI, provider resolution, lyrics, Electron lifecycle or audit findings.

## Current behavior and ownership

- `state/manager.js` rejects the `repeat-one` value produced by `utils.getNextMode()`. `state/storage.js` consequently rejects an otherwise valid server/local snapshot before normalization.
- `features/stream-handler.js` forwards an old track's late success or failure to play/next without checking ownership. `services/stream-service.js` can also publish an obsolete success/error notification and mutate the supplied track.
- `features/playback-controls.js` assigns a new current track in its empty-URL branch while the old audio remains active.
- Composition: `controller.js`; consumer: `core/initializer.js` audio error listener; contract: `docs/architecture/frontend/playback.md`, architecture route `ROUTE-PLAYBACK`.
- Tests: existing `test/helpers/playback-app.js`, `test/playback-persistence.test.js`, and a focused `test/playback-stream-recovery.test.js`. No helper infrastructure changes planned.

## Milestones

- [x] Reproduce S7-008 with UI mode-save-restart and server/v2/v1 snapshots, including legacy `single`. Confirm current track, queue, mode and playback position survive.
- [x] Reproduce S7-009 with a deferred refresh resolving/rejecting after track change, clear or another request for the same track; retain normal retry/resume and failure-to-next behavior. Cover an old audio error arriving while a newer request is still resolving.
- [x] Reproduce S7-010 by playing A and selecting B whose stream is empty; assert display, current, audio source, history and progress still belong to A.
- [x] Implement the scoped fixes and run the directly affected playback tests.
- [x] Update the playback contract, review task-owned diffs and archive this plan after verification. Completion evidence is recorded under the audit directory above.

## Implementation details

1. In both mode validation lists, include `repeat-one`; before normalized-mode validation, apply:

   ```js
   if (normalized.mode === 'single') normalized.mode = 'repeat-one';
   ```

2. In playback controls, capture the current audio's effective generation. `createPlaybackRequestGuard(track)` returns a predicate over that captured generation and current track; a later play/quality request or queue clear invalidates it. A failed switch renews ownership for the retained audio without reviving old guards. Initial generation zero preserves recovery of a restored current track. Inject the factory into the stream handler through `controller.js`.
3. The stream handler captures the original origin and a track copy, then passes the guard through `StreamService.handlePlaybackError`. The service checks it at entry, after URL resolution and in the error branch. Its successful retry callback returns the playback promise.
4. Remove current/currentOrigin assignment from the empty-URL branch; render the retained playback state.

## Verification

- Red: `node --experimental-vm-modules --test test/playback-persistence.test.js test/playback-stream-recovery.test.js`.
- Focused: add `test/playback-quality.test.js`, `test/playback-queue-behavior.test.js`, `test/frontend-playback.test.js`, `test/playback-flush.test.js`, and `test/playback-store.test.js` to the same command. This checks renderer integration, generation compatibility and persistence consumers without real user data.
- Boundaries/docs: `npm run verify:quick`, justified by the new internal guard dependency and mode contract correction. Do not run the full repository test suite unless a concrete failure requires it.
- Final: inspect task-owned diffs against saved starting copies, `git diff --check`, `git status --short`, and verify unrelated starting changes plus index are preserved. Audit snapshots/logs live outside the repository in `D:/Work/lira-audit/remediation/2026-09-12-playback-recovery/`.

## Failure handling and completion

If verification fails, inspect the affected test and owning layer. Reverse only task-owned edits if necessary; do not restore whole files over earlier work, reset the checkout, commit, or deploy. Completion requires all three reproductions passing, compatible retry/queue/persistence checks, updated contracts and audit records, and a reviewed final diff. Actual Electron/provider integration remains unverified unless explicitly exercised.

## Results

Completed 2026-09-12. The initial direct run reproduced 20 failures among 28 cases; 6 existing persistence tests and 2 normal recovery checks passed. Four additional cases first reproduced loss of recovery for retained audio after an unsuccessful track/quality switch, then passed after renewing its effective generation.

The final affected test command passed 55/55, including all 32 direct persistence/recovery cases. `npm run verify:quick` passed 5 governance tests, syntax checks for 590 JavaScript files, and 13 module-boundary tests. Existing playback queue/quality changes were retained. No production database, live provider, actual Electron playback session, full repository suite, commit or deployment was used.
