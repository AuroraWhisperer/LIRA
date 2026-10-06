# Canvas Partial Overflow Implementation Plan

**Status:** Completed

**Goal:** Every scene component can extend beyond the canvas while retaining at least 24 logical pixels on each axis inside it; editor and output clip the overflow.

**Architecture:** Reuse the scene document model, both existing document validators, and existing canvas clipping. Put the geometry rule in one shared frontend/Node module. Keep schema version 1 and the current size limits (32 pixels through the canvas dimension).

**Tech Stack:** Vanilla JavaScript ES modules, Node.js 24, existing node:test and Playwright fixtures.

## Boundaries And Current Behavior

Movement, resize, inspector fields, automatic sizing, and both validators currently require full containment. Editor extent and output version already use `overflow: hidden`. The document remains the owner of layout; no new renderer, database migration, runtime dependency, or remote-server change is needed. Standalone danmaku's internal region layout is unchanged. Existing user edits, credentials, publication revisions, and page URLs must be preserved.

## Ownership And Changes

- `public/js/shared/scene-geometry.js`: position limits, clamping, and geometry validity shared by editor and backend.
- `public/js/admin/scene-document-model.js`: movement, group spacing, resizing, canvas resizing, and shared-size propagation.
- `public/js/admin/scene-template.js` and `src/scenes/scene-contract.js`: consume the same geometry validity rule.
- `public/js/admin/scene-editor-inspector.js`, `scene-editor-stage.js`, and `scene-editor.js`: coordinate input, automatic height, and duplication follow the same limits.
- `specs/component-scenes.md` and the scene section of `docs/reference/frontend/overlays.md`: update the owning layout contract.
- Existing model, scene contract/service, canvas editing, and scene renderer tests: cover partial overflow, minimum intersection, saving, and clipping.

## Milestones

- [x] Add failing cases for all component types at each edge and corner, preserving group offsets and rejecting less than 24 pixels of overlap.
- [x] Implement the shared rule and update editing consumers. Position limits are `24 - width <= x <= canvas.width - 24` and the equivalent for height/y. Group movement intersects each unlocked item's permitted delta range. Resizing anchors the opposite edge and preserves the current maximum dimensions.
- [x] Verify save/publication round trips and real canvas clipping with existing isolated fixtures; update current docs and archive this completed plan.

## Verification

- `node --experimental-vm-modules --test test/scenes/scene-geometry.test.js test/admin/scene-document-model.test.js test/scenes/scene-component-contract.test.js test/scenes/scene-service.test.js`
- `node --experimental-vm-modules --test test/admin/canvas-editing.test.js test/scenes/scene-renderer.test.js test/admin/scene-editor.test.js test/admin/component-preview-canvas-controller.test.js test/scenes/scene-http.test.js`
- `npm run verify:quick` for the shared contract/module and specification changes.
- Inspect the touched diff, run `git diff --check`, and inspect `git status --short`.

## Failure Handling And Done When

On failure, keep the previous published scene and diagnose only affected paths. Reverse only this task's hunks if necessary; do not reset the worktree. Complete when each component can be partially outside, every component retains the minimum intersection, save/reload retains its coordinates, rendering clips outside the canvas, and focused checks plus the shared-contract gates pass. Record actual evidence below; no commits or publication to user data.

## Evidence

- The model tests reproduced the original full-containment behavior before implementation.
- The geometry/model/component-contract/service command passed all 71 tests, including every registered component type at all edges/corners, proportional clock resizing, locked items, group spacing, shared-size propagation, undo, and identical frontend/backend validation.
- The canvas editing fixture passed the new extreme corner drag, negative numeric input, save/publication and reload case. Its existing overflow resize/cancellation test also passed. The HTTP and canvas-controller tests passed.
- `node --experimental-vm-modules --test test/scenes/scene-renderer.test.js` passed all 3 tests after correcting a syntax error in the new test. The added real browser test publishes four partially outside clock layers and uses IntersectionObserver to verify the clipped visible rectangles inside a letterboxed canvas.
- `npm run verify:quick` passed: 10 documentation tests, syntax checks for 1245 JavaScript files, and 19 architecture checks. Impeccable's detector returned no findings for the changed UI modules.
- The broader UI run still had two failures caused by concurrent clock auto-height changes: `canvas layer menus hide and delete their own component and undo restores its configuration` captured height 210 before automatic correction to 203; `resize handles follow zoom, update the inspector, and keep one undo entry per completed gesture` still queried the old `高度` label instead of `高度（自动）`. Neither failure concerns overflow, and this task does not modify that separate behavior or those assertions. The broader suite is not claimed green.
- Existing work on clock sizing and browser sources was preserved, including its same-file edits; the new shared geometry covers those components too. Runtime checks used isolated synthetic fixtures and did not touch the user's running desktop or live data.
- Touched source and tests were reviewed; final diff/status and whitespace checks completed. Only this task's plan is archived; other active work remains active.
