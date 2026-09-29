# Frontend modularity implementation plan

**Status:** Completed

**Archived:** 2026-09-29; scoped refactoring and regression checks completed.
Existing architecture/Electron test failures are recorded below, not treated as passes.

## Goal and scope

Reduce duplicated danmaku editing rules and separate gift display and SuperChat
rendering responsibilities without changing visible behavior. Apply the three
local refactorings approved on 2026-09-29. ADR-0020 shared-source distribution
remains deferred; no server checkout changes, runtime dependency, commit or release.

## Ownership and compatibility

- `public/js/shared/danmaku-style-options.js` owns style metadata; preserve its
  Node mirror and parity checks. Shared draft helpers own pure field conversion,
  immutable per-style edits and reset. Admin/preview retain their DOM bindings,
  authorization, scale conversion and save lifecycle.
- `public/js/overlays/danmaku-message-renderer.js` delegates SC DOM construction
  to a dedicated renderer. Feed queues, timer ownership, URL resolvers, plain-text
  rendering and the six visual variants remain unchanged.
- `public/css/admin/gift-display.css` remains the ordered stylesheet entrypoint;
  its children own common controls, history, export and display settings.
  Existing browser tests retain their assertions, divided by these responsibilities.
- HTTP/WS/IPC shapes, persisted configuration, page URLs and Electron privileges
  remain unchanged. Preserve all edits already in this worktree.

## Milestones

- [x] Add pure appearance draft helpers, use the existing style registry for names
  and membership, and centralize random-layout capability. Update both parameter
  editors and verify per-style reset, invalid input and scaled font editing.
- [x] Move SC palettes, contrast calculation and DOM construction into
  `public/js/overlays/danmaku-superchat-renderer.js`. Adapt existing renderer tests
  to resolve real module imports and retain feed/ordinary-message coverage.
- [x] Split gift CSS into `public/css/admin/gift-display/` modules; divide browser
  tests into display-settings, export-settings and banner-rendering files. Update
  browser test discovery and CSS bundle loading; preserve all existing test cases.
- [x] Update the frontend owner reference, review the task-only diff against the
  pre-edit snapshot, run focused checks and archive this plan with actual results.

## Verification

Baseline: 35 danmaku VM/contract tests and 22 gift/admin browser tests pass. The
size gate currently rejects gift-display.css (633 lines) and its test (632 lines).

Run affected danmaku and gift tests with `node --experimental-vm-modules --test`,
including the moved files and existing feed/renderer/IPC coverage. Run
`node scripts/check-modularity.js`, `npm run check`, `npm run verify:architecture`,
and the test-runner classification regression after moving test files. Finish
with `git diff --check` and `git status --short`. Broaden checks only for a
demonstrated contract, lifecycle or dependency regression.

## Failure handling and completion

Pre-edit copies of the touched files are saved outside the repository for a
task-only diff. If a refactor fails, correct or undo only its own changes; do not
restore from HEAD over user edits. Done when all three refactorings are in place,
focused checks pass, the two size failures are resolved without raising a
baseline, and the owning reference and plan evidence match the final code.

## Results and existing limitations

- 89 distinct focused tests passed: danmaku drafts, local preview (including a new
  scaled-font/per-style-reset regression), SC renderer, feed, IPC, snapshot
  stability, game renderer consumers, gift browser tests, CSS ownership and test
  runner classification. Re-runs are excluded from this count.
- Gift tests retain all 13 original cases in three files (216/141/294 lines).
  All 124 original gift CSS rule blocks retain their selectors and declarations;
  four owner files contain 26/261/251/215 lines. SC extraction and the moved test
  bodies were compared with the pre-edit snapshot.
- `npm run check`: passed, 1058 JavaScript files.
- `node scripts/check-modularity.js`: passed, 1357 files, zero errors; no baseline
  ceilings were raised.
- `npm run verify:architecture`: 21/22 passed. The existing comment-only catch in
  `public/js/admin/start-animation.js` fails the frozen empty-catch debt rule.
  This file was not modified by this refactoring.
- `node --test test/desktop/danmaku-canvas-electron.test.js`: fails at the existing
  drag assertion (line 39; x=40, y=440). Reproduced in a separate temporary source
  tree restored from the pre-edit snapshot, with identical bounds and coordinates.
  The test uses an isolated hidden Electron host and temporary user/session data;
  it does not interact with a running user app. Full desktop drag/save acceptance
  remains unverified; this unrelated failure was not changed or suppressed.
- Cleanup of the temporary baseline source tree was rejected by execution policy.
  The source copy and asset/dependency junctions remain outside the repository;
  no alternative deletion mechanism was used. Test-owned Electron processes and
  temporary user/session data were closed and cleaned by their existing teardown.
- Task-only diff reviewed against the saved snapshot; `git diff --check` passed.
  No runtime data, secrets, dependencies, server-source distribution or commits
  were added. ADR-0020 remains deferred.
