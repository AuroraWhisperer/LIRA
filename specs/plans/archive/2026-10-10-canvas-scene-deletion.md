# Canvas Scene Deletion Implementation Plan

Status: Completed

## Goal and decisions

Allow every canvas preset to be deleted. Select a remaining preset after deletion and keep a persistent empty state after the last deletion. Mark the last applied preset as “当前输出”; this identifies the saved output, not whether streaming software is displaying it. Deleting that preset applies the first remaining saved preset, or a transparent empty output, with an explicit confirmation. Preserve the fixed source URL and other presets' unsaved drafts.

## Current behavior and ownership

`scene-service.js` and `scene-store.js` reject deletion of the fixed output and active preset. `component-preview-canvas-controller.js` assumes a preset always exists and creates one whenever the list is empty. `component-preview-presets.js` only labels output as “已应用”. Existing scene store/service tests and `canvas-editing.test.js` encode these restrictions.

Store owns atomic deletion/output switching. Service owns document normalization, encrypted browser URLs, owner/revision checks and publication notifications. The desktop canvas controller owns editable selection/drafts; the browser view owns the empty UI and confirmation.

## Compatibility and non-goals

- Keep current source IDs, credentials, account isolation, output sizes and security boundaries.
- Add an append-only songDb migration; retain a hidden fixed-output record after its editable preset is deleted. Existing documents and credentials migrate unchanged.
- Keep normal selection/save behavior: only explicit apply or confirmed deletion of the output preset changes output.
- No real user data access, commits, dependencies or unrelated cleanup. Preserve existing uncommitted edits.

## Milestones

- [x] Add migration for hidden output records and nullable active preset; make deletion and replacement publication one storage transaction. Verify old database upgrade/repetition, owner/revision conflicts, rollback, source stability, saved replacement and final empty output with scene store/service tests.
- [x] Support zero presets in the existing canvas controller/view without recreating a deleted scene on reopen. Preserve a valid empty display document for existing preview consumers; allow explicit new scene creation. Verify controller deletion/failure/draft behavior and the existing browser canvas editing flow.
- [x] Mark current output in selector/status and explain deletion effects in confirmation. Update API/storage/frontend references and scene user guidance. Review related backup, asset references, component entry points and draft recovery for empty/hidden scene impact.
- [x] Run focused scene/admin/transport tests, relevant migration tests, documentation/syntax/architecture gates and diff review. Unrelated gate failures are recorded below rather than changing concurrent work.

## Verification and limitations

Base commit: `6c4dab1e`; task edits are uncommitted. The shared checkout also contains unrelated and concurrent changes.

- `node --experimental-vm-modules --test --test-concurrency=4 test/scenes/*.test.js test/admin/component-preview-canvas-controller.test.js test/admin/component-preview-remote.test.js test/admin/component-preview-contracts.test.js test/admin/component-preview-drafts.test.js test/admin/component-preview-recovery.test.js test/admin/component-preview-output.test.js test/admin/canvas-editing.test.js test/transport/component-preview.test.js test/desktop/text-box-electron.test.js`: 435 passed.
- Following deletion confirmation/version checks and storage accessor cleanup, the scene store/service, canvas controller and browser editing suites passed 92 tests.
- Following output-conflict retry and source-directory changes, canvas controller and isolated desktop canvas entrypoint suites passed 21 tests. Empty output can still expose the original address; desktop text-box creation explicitly creates a new preset when needed.
- `npm run check`: passed, 1,420 JavaScript files. `git diff --check`: passed.
- `npm run verify:architecture`: 25 passed, one unrelated failure in existing `src/shared/danmaku-style-options.js` comment-only catch.
- `npm run verify:docs`, including the final run after archival: 8 passed, two unrelated concurrent changes blocked the gate: undocumented `GET /api/danmaku/events` and missing current status in `2026-10-10-danmaku-delivery-efficiency.md`. Scene contracts, guides and links were updated.
- No real user database, running user app, streaming-software session or installer was modified or used for acceptance. No commits or publishing performed. The guide section has no affected preset screenshot; the general introductory tour still describes the unchanged edit/apply entrypoints.

The browser reopen test must load a new document when using a new fragment capability: changing only `/c#...` in the same tab retains the old page connection. The test now navigates through a blank page, matching a newly opened editor window.

## Failure handling and completion

The store rolls back deletion, binding and publication together. Failed deletion retains frontend selection/draft. Migration preserves prior rows and capability material. Reverse only task-owned edits if implementation fails; never reset the shared checkout. Complete when continuous deletion, fixed source output, persistent empty/recreate behavior and clear output indication pass focused tests and the owning documentation matches.
