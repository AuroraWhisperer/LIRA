# Image Asset Reorganization Plan

## Goal

Organize the static image assets under `public/img/` by UI responsibility and
keep every renderer and packaging reference valid after the move.

## Non-goals

- Do not recompress, delete, or otherwise alter image pixels.
- Do not move the existing Bilibili catalog, overtime-machine, overlay, or
  usage-guide directory contracts.
- Do not change persisted settings or API payload shapes.

## Current Behavior

The v3.6.19 asset tree groups the loose UI files under `admin/`, `playback/`,
and `shared/`, but several HTML/CSS/JavaScript consumers and electron-builder
filters still point at the former root paths. Guard gift rules also use the new
`admin/gifts/` artwork path while the overtime contract rejects that built-in
root.

## Ownership

- Static asset consumers: `public/pages/`, `public/js/`, and `public/css/`.
- Packaging filters: `package.json` electron-builder `files` list.
- Guard-rule image validation: `src/overtime/overtime-contract.js` and
  `docs/architecture/backend/api.md`.
- Focused checks: `test/playback-wesing.test.js` and
  `test/overtime-service.test.js`.

## Compatibility Constraints

- Keep `/img/bilibili-gifts.json`, `/img/bilibili-gifts/`, and
  `/img/overtime-machine/` paths unchanged.
- Keep source PNGs and WebP runtime siblings in the repository.
- Allow only the explicit built-in `admin/gifts` image root in overtime rules;
  retain traversal, protocol, and filename validation.

## Proposed Changes

1. Update local renderer paths and the package exclusion patterns to the
   organized directories.
2. Update the frontend resource inventory and the active WebP packaging plan.
3. Add `admin/gifts` to the overtime rule image whitelist and cover it with a
   focused service-contract assertion.

## Milestones

- Organized paths and references: verify all changed local files exist.
- Contract alignment: run the overtime service test and inspect the API row.
- Final validation: run syntax, focused frontend tests, and diff/status checks.

## Verification

- `npm run check`
- `node --test test/playback-wesing.test.js test/overtime-service.test.js`
- `git diff --check`
- Scan runtime files for stale `/img/` paths and confirm package exclusions
  match converted PNG/WebP pairs.

## Rollback Or Failure Handling

Inspect the scoped diff and revert only the text and contract changes from
this task; do not reset the repository or remove unrelated user changes.

## Done When

All organized runtime references resolve to files, the package excludes only
the converted source PNGs, guard rules accept their built-in artwork path, the
focused checks pass, and unrelated worktree changes remain untouched.
