# Text box selection appearance

Status: Completed

## Goal and non-goals

Add a compact common/recent/custom color palette and selection-only stroke,
light shadow and clear-format actions to the existing floating toolbar. Keep
the current page layout and existing media, canvas and publish workflows.

## Current behavior and ownership

`public/js/admin/text-box-editor.js` owns selection serialization and native
undo; `shared/text-box-config.js` validates persisted nodes on both sides;
`shared/text-box-renderer.js` renders desktop, canvas and streaming output.
The current color input is native-only. Contract: `specs/component-scenes.md`
and `docs/reference/frontend/overlays.md`; user guidance:
`docs/guides/component-sources.md`. Tests live in `test/admin/text-box-editor.test.js`
and `test/scenes/text-box.test.js`.

## Compatibility and proposed changes

- Add optional boolean `stroke` and `shadow` to text nodes only. Version 1,
  omitted-field rendering, URL validation and scene byte limits stay compatible.
  Effects use fixed, font-relative renderer styles, never arbitrary CSS.
- Extend the selected-node transformation for effects and clear format; retain
  atomic media, unselected content, selection and native undo/redo.
- Keep palette/menu construction in a text-box format-controls module. Store
  at most six validated recent colors in local UI storage; missing/unavailable
  storage must not prevent formatting. Do not serialize palettes into scenes.
- Preserve unrelated workspace edits. No database migration, dependencies,
  new routes, privileges, or global text-box settings.

## Milestones and verification

1. Extend validation/rendering and toolbar controls; verify mixed selections,
   reset, default config compatibility and scene output in focused tests.
2. Inspect palette and More states together in the existing isolated Electron
   fixture; confirm selection retention, placement and final preview. Fix any
   findings in one batch with at most one visual confirmation.
3. Update owning docs and run:
   - `node --test test/admin/text-box-editor.test.js test/scenes/text-box.test.js test/admin/admin-page-composition.test.js`
   - `node --check` for changed JavaScript.
   - `npm run verify:docs` and `npm run verify:architecture` for the persisted
     contract and new frontend module.
   - Inspect task-owned diff, `git diff --check`, `git status --short`.

## Rollback and done when

On failure, inspect only this task's diff against its starting snapshots under
`tmp/text-box-appearance-baseline`; reverse only task-owned edits without Git
reset/checkout. Done when all three additions work on selected text, native
undo and media survive, old configs render unchanged, focused checks pass,
and actual verification is recorded here. Close only owned QA processes.

## Results

- Focused tests: 25/25 passed, covering selected-only colors/effects, mixed
  text/media reset with one-step undo, independent undo/redo, six recent colors,
  remount and listener cleanup, old configs, template import and sandboxed output.
- `node --check` passed for all six changed JavaScript sources/tests.
- Documentation gate: 10/10 passed. Architecture gate: 19/19 passed after using
  the established warning behavior when local preference storage is unavailable.
- Impeccable detector returned no findings. One batched Electron inspection
  and one confirmation checked idle/selected states, common/recent/custom colors,
  More toggles, Escape, clear/undo, dark/light preview and save/reload. No renderer
  errors. The confirmation corrected the font-size readout after range replacement
  and kept the shorter palette clear of the selected text; selection bounds also
  drive the fallback placement when there is insufficient room above.
- Screenshots: `tmp/text-box-qa/appearance-palette-final.png` and
  `tmp/text-box-qa/appearance-effects-final.png`. Used only the existing isolated
  Electron profile/database; the owned process was closed after verification.
- Reviewed task-owned diffs against the starting snapshots. No dependency,
  runtime/generated data or unrelated feature changes were introduced by this
  extension. No full suite or real streaming-software session was run.
