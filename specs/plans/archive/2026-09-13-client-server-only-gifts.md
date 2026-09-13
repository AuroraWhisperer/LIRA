# Client Server-only Gift Runtime Implementation Plan

> Status: Complete. Executed inline in the existing worktree without commits.

**Goal:** Make server-processed events the only gift detection input exposed by
the desktop runtime, including startup, resume, and shutdown.

**Architecture:** Keep the existing processed-event importer, source partitions,
cursor controller, and final consumers. Assemble the shared gift service in
processed-only mode and remove the local Bilibili accounting callback. Legacy
parsers remain available for user identity hints and isolated compatibility tests.

**Tech Stack:** Node.js 24 CommonJS, Electron, node:sqlite, node:test.

## Constraints and non-goals

- Preserve unrelated dirty files, database schemas, stored history, Device/IPC/WS
  contracts, credentials, source isolation, and public query behavior.
- Preserve local danmaku, song requests, Super Chat, games, and gift-derived user
  identity hints. Server DTOs intentionally do not contain UIDs.
- Do not modify or deploy LIRA Server, add dependencies, or remove diagnostic and
  legacy parser fixtures. Existing final consumer retry remains supported.
- No fallback to local raw detection when the remote server is unavailable.

## Current behavior and ownership

- `src/server.js` disables only `onGift` through a false constant but still calls
  `repairGiftV2Events` at startup.
- `src/server/bilibili-client.js` retains an opt-in raw accounting callback.
- `src/bilibili/danmaku/message-handlers.js` parses and logs gifts before that
  callback and uses parsed names/avatars/guard purchases as identity hints.
- `src/bilibili/gift/detection-service.js` combines raw detection and processed
  import. Construction/resume calls `recover`, and shutdown calls `flushPending`;
  these can still finalize legacy local progress rows.
- `src/server/domain-services.js` owns service assembly; `gift/index.js` exposes
  the raw `add` alias. Remote delivery remains owned by the existing Electron
  controller and the processed importer.
- Contracts: `specs/server-authoritative-gift-detection_design.md` and
  `docs/architecture/backend/bilibili/gift.md`.
- Baseline: 27 focused startup/client/import/clear-all tests pass.

## Milestones

### 1. Close production raw write and recovery entry points

- [x] Add `processedOnly: true` at domain composition. In that mode expose only
  processed import, consumer recovery, status, pause/resume, and disposal:

  ```js
  return {
    ...(!processedOnly ? { detect, flushPending, finalizeDetected } : {}),
    importProcessedEvent,
    importProcessedHistoryRecord,
    recover, pauseDetection, resumeDetection, getStatus, dispose,
  };
  ```

- [x] Do not expose the `add` alias in processed-only mode. Skip local pending
  flushes and exclude legacy pending groups from runtime pending status. Leave
  existing final consumer compensation intact.
- [x] Remove the local gift callback/flag and automatic V2 repair from server
  assembly. The message handler retains identity ingestion but skips local gift
  diagnostics and dispatch when no gift consumer is attached.
- [x] Add regression assertions for absence of raw entry points, untouched
  legacy progress across startup/resume/shutdown, remote progress waiting for
  remote final, idempotent final import, and preserved identity/danmaku/SC:

  ```js
  assert.equal(gifts.add, undefined);
  assert.equal(gifts.detect, undefined);
  assert.equal(gifts.finalizeDetected, undefined);
  gifts.recover();
  gifts.pauseDetection();
  gifts.resumeDetection();
  gifts.dispose();
  assert.equal(readLegacyRow().detection_status, 'progress');
  ```

- [x] Update clear-all runtime tests to exercise processed imports using an
  isolated gift source, rather than the removed raw writer.

### 2. Verify contracts and document retained code

- [x] Update the gift specification and owning architecture documents to
  distinguish production projection from retained identity/legacy helpers.
- [x] Run focused startup, Bilibili client/identity/guard, processed import,
  remote controller/cursor, gift sync, clear-all, gift consumers, and lifecycle
  tests. All must pass with temporary data and no production server access.
- [x] Run `npm run verify:quick` for syntax, docs, and module boundaries. Run the
  full `npm test` gate because production gift writes and recovery are changing.
- [x] Review the touched diff, run `git diff --check`, inspect
  `git status --short`, and archive this plan with actual results.

## Verification commands

```powershell
node --experimental-vm-modules --test --test-concurrency=4 test/bilibili-startup-wiring.test.js test/server-bilibili-client-avatar.test.js test/processed-gift-import.test.js test/data-clear-all-runtime.test.js
npm run verify:quick
npm test
git diff --check
git status --short
```

## Failure handling and done when

If a check fails, inspect its owning scope and reverse only task-owned hunks if
necessary. Do not run the production app or touch user databases. Done means
production raw methods and automatic local finalization/repair are unreachable,
remote import/recovery and non-gift consumers retain their contracts, proportional
verification passes or a concrete unrelated blocker is recorded, and the final
diff contains only this task's changes.

## Results

- New regression assertions first failed on the exposed raw writer and old
  composition; they pass with processed-only assembly.
- Startup/client/import/diagnostic group: 25 passed. Clear-all/guard/legacy
  detector/import group: 37 passed. Remote delivery, gift sync, initialization,
  Bilibili, overtime, and server lifecycle/smoke group: 157 passed.
- `npm run verify:quick`: passed; 616 JavaScript files passed syntax checking,
  documentation checks passed, and all 13 architecture checks passed.
- `npm test`: 1,729 passed, 2 skipped, 0 failed (1,731 total).
- Final review removed the unused raw-deduplication store from production domain
  assembly and corrected the remaining startup documentation. The affected
  initialization/clear-all/smoke/startup/docs/boundary group was rerun: 46 passed;
  `node --check src/server/domain-services.js` passed.
- Final diff review and `git diff --check` passed. Existing unrelated changes
  remain intact; no runtime data or generated logs entered the worktree.
- No server changes, packaging, deployment, or production-session verification
  were performed. Identity parsing and isolated legacy helpers remain in source;
  production gift detection has no local fallback.
