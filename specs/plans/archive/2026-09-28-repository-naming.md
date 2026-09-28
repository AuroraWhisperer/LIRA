# Repository naming audit

Status: Complete (2026-09-28)

## Goal

Review every maintained file and directory name in this LIRA checkout and rename
only names that obscure their current responsibility. Update their consumers in
the same change.

## Scope and current behavior

The inventory covers tracked files and non-ignored untracked source: backend,
Electron, frontend code/pages/styles/assets, tests, scripts, tools, documentation,
specifications, and root configuration. Dependencies, generated output, captures,
screenshots, logs, and user data are excluded. The separate lira-server checkout
is outside this task.

The existing domain structure is appropriate. The misleading names are toolbox
navigation/styles called "other", song imports without a domain prefix, a planner
called "todo", music-only authentication without a domain prefix, a lyric parser
with an unspecific name, and reusable audit tools under a numbered run directory.

## Ownership and proposed changes

| Existing path | New path | Reason |
| --- | --- | --- |
| `public/js/admin/other.js` | `public/js/admin/toolbox-navigation.js` | Owns toolbox selection and sidebar navigation. |
| `public/css/admin/other-features.css` | `public/css/admin/toolbox.css` | Ordered toolbox stylesheet entry. |
| `public/css/admin/other-features/` | `public/css/admin/toolbox/` | Matches the toolbox page domain. |
| `public/js/admin/import.js` | `public/js/admin/song-import.js` | Reads and imports song tables. |
| `public/js/admin/todo.js` | `public/js/admin/streamer-planner.js` | Owns calendar, notes, and tasks. |
| `public/js/admin/todo-model.js` | `public/js/admin/streamer-planner-model.js` | Planner data normalization. |
| `public/js/admin/todo-view.js` | `public/js/admin/streamer-planner-view.js` | Planner rendering. |
| `test/toolbox-todo*.test.js` | `test/streamer-planner*.test.js` | Keeps planner tests discoverable with their owner. |
| `src/electron/auth-manager.js` | `src/electron/music-auth-manager.js` | QQ/NetEase session and cookie management. |
| `src/electron/login-window.js` | `src/electron/music-login-window.js` | QQ/NetEase login window, distinct from Bilibili and license login. |
| `test/auth-manager.test.js` | `test/music-auth-manager.test.js` | Matches the music authentication owner. |
| `src/music/lyrics.js` | `src/music/lyric-parser.js` | Parses LRC/QRC/YRC into the shared lyric line model. |
| `tools/audit3/` | `tools/repository-audit/` | Reusable repository inventory scripts. |

Cleanup follow-up (2026-09-28): the historical inventory scripts were moved to `tmp/cleanup-2026-09-28/tools/repository-audit/` for user deletion; the table records their earlier rename.

Consumers include ESM/CommonJS imports, VM test loaders and mocks, CSS imports,
the admin HTML shell, architecture documentation, historical source links, and
the modularity path registry. Owner routing is defined in
`docs/architecture/engineering/ai-workflow.md`; no ownership changes are needed.

## Compatibility and non-goals

Preserve existing uncommitted changes byte-for-byte except for necessary path
references. Preserve exported names, legacy bridge members, DOM selectors,
settings/localStorage keys, IPC/HTTP/WebSocket contracts, OBS routes, Electron
security and lifecycle, and behavior. Do not change dependencies, architecture,
historical document filenames, numbered style IDs, release entrypoints, or
generated/runtime directories. Broadly named modules with genuinely mixed roles
(for example display/forms/shared helpers) are not renamed to narrower misleading
names.

## Milestones and verification

1. Complete inventory and inspect candidate responsibilities and references.
   Verify the proposed names do not collide and consumers are accounted for.
2. Rename the scoped files/directories and update exact filename/path references.
   Verify old paths are absent outside this migration record; compare task edits
   against a pre-edit snapshot so unrelated changes remain intact.
3. Run existing focused admin/navigation/planner/import, stylesheet composition,
   music auth/login, parser/provider/WeSing tests. Run `npm run check`,
   `npm run verify:docs`, and `npm run verify:architecture` because static module
   paths and the modularity registry are affected. Inspect browser test isolation
   before running any browser-backed test; no user app restart is needed.
4. Inspect task-owned differences, `git diff --check`, and `git status --short`.
   Record exact validation results and archive this plan when complete.

## Failure handling

Preserve a temporary pre-edit snapshot of affected maintained files. Diagnose
missing references against that snapshot. If a rename cannot be verified, undo
only that rename and its reference edits; never reset or blanket-checkout the
working tree. Do not modify existing unrelated failures to make checks pass.

## Done when

Every maintained name has been inspected, selected new paths resolve, internal
references and documentation agree, existing contracts are unchanged, relevant
checks pass or an existing limitation is recorded, and the final diff preserves
pre-existing work.

## Results

- Inventoried 2,027 pre-existing maintained files across 141 directories, including
  the existing untracked cleanup plan. All major source, asset, test, engineering,
  and documentation directory names were reviewed. The separate server checkout
  was not modified.
- Renamed two directories and thirteen individual files: 47 file paths in total.
  Updated exact path references in 124 files, including 78 architecture/spec/report
  documents. Existing symbols and compatibility keys remain unchanged.
- Pre-edit baseline: 89 tests passed, zero failures or skips.
- Focused regression: 46 existing test files, 324 tests passed, zero failures or
  skips. This includes the isolated Chromium fixture and real Electron music-auth
  race fixture; the user's running application and account data were not used.
- `npm run check`: syntax passed for 1,031 JavaScript files.
- `npm run verify:docs`: 7 tests passed.
- `npm run verify:architecture`: 22 tests passed; the two moved modularity-registry
  paths retain their existing limits and all registry paths exist.
- Old filename/path scan: no stale source references outside this migration
  record. The fixture URL `/api/login-window` is an intentional unchanged test
  endpoint, not a reference to the renamed file.
- Snapshot verification confirmed every original file's bytes equal its original
  contents plus the reviewed path substitutions. Existing changes in the moved
  toolbox CSS and music login window were preserved.
- Reviewed source/reference diffs and working-tree status; `git diff --check`
  passed. A separately created test-directory-layout plan appeared during the
  task and was left untouched. No commits, dependency changes, runtime data, or
  generated artifacts were added.
- No runtime logic, page routes, storage formats, authentication semantics, or
  visual styles changed, so a full application launch/release build was not run.
