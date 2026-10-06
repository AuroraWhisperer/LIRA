# Canvas layers and scene presets

Status: Completed

Completed 2026-10-06. Current behavior is owned by `specs/component-scenes.md`
and the API, storage and component-source guide documents.

## Goal and accepted behavior

Bottom layers drag left-to-right, highest first. Only a release within the layer
strip commits one undoable ordering edit; outside release, Escape, cancellation
and blur restore the original order. Every new item, including backgrounds,
starts on top. Multiple scenes are reusable presets for one live canvas. Selecting
a preset edits it; Save and Apply alone replaces the shared live output.

## Current behavior and ownership

`component-preview-canvas-view.js` displays reversed document items without drag.
`component-preview-canvas-controller.js` binds the first scene to the desktop
controller/temporary browser relay. Scene service/store own revision checks,
encrypted browser URLs, publication and persistent source credentials. Existing
scene documents already store independent layouts; preserve their v1 format.

## Constraints and decisions

- Preserve all existing workspace edits, authentication and scene capabilities.
- Append a songDb migration for one owner-scoped canvas binding (stable output
  scene and last applied preset); do not move or rewrite existing scene drafts.
- A dedicated canvas publication checks both preset revision and live publication
  version and commits output, active preset and component sizes atomically.
- Keep browser scene actions narrowly bound to the authorized desktop canvas.
- Retain each preset's draft controller while switching; isolate browser recovery
  by preset identity. New controls reuse the current visual tokens and selects.
- No parallel live scenes, new services/dependencies, commits or real user data.

## Milestones and verification

- [x] Layer drag controller with temporary DOM feedback and release-only model
  edit. Extend `test/admin/canvas-editing.test.js` for commit, rollback and undo.
- [x] Append migration, store binding/publication and scene facade routes. Extend
  scene storage/service/HTTP tests for upgrade, isolation, stable credentials,
  stale publication and rollback. Preserve existing standalone scene publication.
- [x] Canvas preset controller, relay actions, selector/new/copy/save preset UI,
  editable preset name and per-preset recovery. Extend controller/transport tests
  and use the existing canvas-output fixture for end-to-end switching/publication.
- [x] Update component scene spec, API/storage/frontend contract and user guide.
  Run affected tests, syntax, architecture/docs gates and final diff/status review.

Commands: `node --experimental-vm-modules --test <affected test files>`;
`npm run check`; `npm run verify:architecture`; `npm run verify:docs`;
`git diff --check`. Use existing synthetic browser fixtures and inspect the final
canvas visually. Runtime/screenshot scratch belongs under repository `tmp/`.

## Failure handling and done when

Failed or stale saves/publications retain drafts and the old live output. Account
changes invalidate the session. Inspect changes against task-start copies in
`tmp/canvas-presets-baseline/`; reverse only task changes if needed, never reset
the dirty checkout. Done after the accepted interactions, preset persistence,
stable output, focused regression evidence and scoped diff review are complete.

## Verification evidence

- Focused storage, service, HTTP, browser-URL encryption, controller, publication,
  recovery and schema-dependent tests: 151 passed. The existing transport A03
  oversized danmaku fixture failed unchanged; the other 17 relay tests also passed
  after the final short-link update.
- Browser canvas editing, preset switching, source publication, component suites,
  short links and recovery: 26 passed across the affected files after updating
  background-order expectations. The new test covers save without publication,
  retained drafts, refresh, failed application and persistent source credentials.
- Existing isolated Electron canvas/real desktop bridge: passed. All data uses
  repository `tmp/` or in-memory databases; no running user app was controlled.
- Syntax check (1,276 JS files), architecture gates (19 tests), visual inspection
  and Impeccable detector (no findings) passed. Final documentation and whitespace
  checks are recorded in `tmp/canvas-presets-docs.log` and the task summary.
- Four unrelated failures were reproduced using task-start source copies:
  `component-preview-output.test.js` discard auto-height, editable clock height,
  and negative-coordinate assumptions; transport A03 oversized fixture. They
  remain unchanged. Evidence: `tmp/canvas-presets-baseline-results.log`.
- Browser contexts and fixture server were closed. Automatic approval rejected
  deletion of `tmp/canvas-presets-before/` with "blocked by policy"; this ignored
  synthetic verification copy remains. No credentials or generated files enter
  the source diff. No commits or publication were performed.
