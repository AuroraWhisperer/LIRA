# Component output dimensions

**Status:** Completed

Completed 2026-10-01. Implementation and isolated verification below satisfy the
local output contract. No production data, running user app or server deployment
was used.

## Goal

Canvas resizing and numeric edits save real component output dimensions. A saved
800 × 400 component occupies 800 × 400 CSS pixels in standalone sources and the
combined source, regardless of the streaming application's browser viewport.
Shared default components update their original source; independent instances
retain separate dimensions and get an address for that published instance.

## Current behavior and ownership

Scene items already persist geometry, but scene-renderer fits the publication to
the browser viewport and original sources size themselves from that viewport.
The scene service/store own publication. Existing component services retain
appearance and business-data ownership. No server deployment is needed for local
browser sources. Online danmaku URLs retain their separate server contract.

## Changes and compatibility

- Append an idempotent scene migration for owner-scoped default output dimensions.
  Publish the dimensions of shared items in the same SQLite transaction as the
  scene snapshot. This is the live default geometry; scene documents remain the
  editable draft and independent-instance owner. Conflicting shared sizes reject
  publication. No scene schema or existing appearance settings change.
- Expose only the authorized overlay's own dimensions through a read-only route;
  reuse existing overlay capabilities, Host/Origin and current owner boundaries.
  Unsized legacy sources retain their existing behavior.
- Use one shared frontend dimension reader in original local source renderers.
  Constrain their surface and internal layout to saved dimensions. Preview frames
  retain their parent's explicit viewport. Overtime retains automatic content
  height in the editor; its resulting saved rectangle is used for output.
- Add an optional item UUID to the existing scene source URL/output projection.
  It renders the same published configuration at (0,0), with no duplicated store.
  Its capability remains scene-scoped, not an item-only security credential.
  Add Copy Component Source for the selection without expanding preview relay
  authority. Copy never implicitly publishes.
- Keep editor fit/zoom; remove output viewport fitting. Shared references in one
  document share dimensions; independently added items remain independent.

## Milestones and verification

1. Storage/service: migration idempotence, restart, stale/failed publication,
   account isolation, shared-size disagreement, item output and revocation.
2. UI/output: real browser tests for resizing/save/reopen and original and item
   source DOM bounds at 800×400, 1920×1080, 2560×1440 and 3840×2160; preserve
   independent copies and the existing input-shortcut regression coverage.
3. Contracts/docs: focused scene/transport/overlay tests, syntax, modularity,
   server contracts, final touched diff, git diff --check and git status --short.

Commands: node --experimental-vm-modules --test (affected tests), npm run check,
npm run verify:modularity, npm run verify:contracts, git diff --check.

## Non-goals and failure handling

No OBS/Livehime scene-transform control, remote deployment, appearance-store
replacement or new framework. External manual source scaling remains external.
Draft save does not publish. Failed publication preserves live scene and live
dimensions. Keep unrelated concurrent changes; undo only this task's individual
hunks if necessary. All test data is isolated under tmp/ or in memory.

## Done when

Actual saved dimensions survive restart and appear in both original default and
independent source outputs at the tested viewport sizes; input/resize regression
checks pass, capability boundaries remain intact, documentation matches the
behavior, and only task-related changes are added to the existing working tree.

## Completion evidence

- Appended songDb v9 without changing v8. Migration/restart tests preserve old
  scene and business rows. A deliberately failing size trigger rolls back both
  size and scene publication; stale revisions and owner changes are covered.
- Original clock/queue/danmaku/overtime pages were measured at 800×400,
  1920×1080, 2560×1440 and 3840×2160. Saved 800×400 surface dimensions and actual
  content bounds stay constant. A running original source receives a new size
  after publication, retains it after refresh, and ignores draft-only saves.
- Browser editor tests save through its real relay/HTTP scene owner, copy default
  and independent URLs, verify independent appearance and dimensions, reuse the
  same URL after edits, reopen saved geometry and retain output after editor close.
- Isolated Electron test exercises the real preload/auth/IPC path. A failed
  appearance save leaves output dimensions unset; successful retry saves dimensions
  matching the scene document. The editor reopens the saved width and font size.
- Existing native input selection/clipboard/undo and resize/cancel/lock regressions
  pass (test/admin/canvas-editing.test.js: 3 tests). Two UI checks hit their existing
  5-second deadlines under a concurrent browser/Electron run; their isolated runs
  passed, including the final Electron size assertions. No timeout was raised.
- Focused regression command covering scene/store/HTTP/runtime, original overlays,
  queue layout, storage maintenance and transfer ran 136 tests. Two assertions
  needed the new source DTO and fixed-size CSS contract; affected suites were
  rerun with preview transport/registry tests (25 passed). Final scene/controller/
  editor group passed 69 tests. Browser source integration and staging checks pass.
- npm run check: 1,144 JavaScript files passed. npm run verify:modularity:
  0 errors. npm run verify:architecture: 22 passed. npm run verify:docs: 9 passed.
  npm run verify:contracts passed against the existing pinned checkout at
  tmp/release-5.0.13/server-contract (revision 01fb2b47d5e081f5dd559933991ade4819eb3428,
  10 fixtures); the adjacent development checkout has a different revision.
- Touched source/test/documentation diffs reviewed; git diff --check passed.
  Existing concurrent changes remain intact. Scratch logs stay under tmp/.

Limits: real OBS/Livehime manual transforms and online server danmaku URLs are not
controlled by this local renderer. Overtime retains measured automatic height.
