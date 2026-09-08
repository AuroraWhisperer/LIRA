# Desktop User Data Persistence Plan

Status: Complete (2026-09-08)

## Goal

Keep imported songs and all other desktop user data across LIRA updates by moving
packaged builds off the replaceable installation directory and safely migrating
the existing directory before an updater-driven uninstall can remove it.

## Non-goals

- No database schema or persisted-format changes.
- No changes to song import, cloud synchronization, IPC, or renderer behavior.
- No automatic recovery of data already deleted by a previous update.
- No change to the development checkout's `data/` directory.

## Current Behavior

Packaged Electron sets `userData` to `<install>/data`. The NSIS updater replaces
the installation and runs an uninstaller hook that removes `%APPDATA%/LIRA`.
Consequently the SQLite song database can be deleted during an update even though
song import committed successfully.

## Ownership

- Owner: `src/electron/` for Electron path selection and startup migration;
  `build/installer.nsh` for the pre-uninstall update bridge.
- Contracts: `docs/architecture/desktop/main.md`,
  `docs/architecture/backend/storage.md`, and
  `docs/architecture/engineering/build.md`.
- Consumers: the embedded server, authentication stores, local-media allowlist,
  update diagnostics, and Chromium persistent partitions.
- Tests: a focused user-data path/migration test plus existing Electron module,
  update, storage, and packaging checks.

## Compatibility Constraints

- Preserve every existing file and directory below the current desktop data root.
- Never overwrite an already initialized persistent destination from a stale
  legacy installation directory.
- Complete migration into a sibling staging directory before publishing it with
  a rename; on failure, keep the legacy source and fail closed.
- Keep `safeStorage`, session partitions, `local-media://` checks, database file
  names, and `SONG_PLUGIN_DATA_DIR` behavior intact.
- The old installed uninstaller deletes `%APPDATA%/LIRA`, so the new durable path
  must not be nested below that directory.

## Proposed Changes

- Add a focused Electron user-data module that resolves development and packaged
  paths and atomically migrates a legacy directory when the durable destination
  does not yet exist.
- Wire `main.js` to migrate before Electron opens the new `userData` directory.
- Update the NSIS `customInit` hook to stage and publish legacy data before the old
  uninstaller runs; stop deleting durable application data on uninstall.
- Update the owning architecture facts and add an ADR for the storage decision.

## Milestones

1. Path and migration owner implemented; verify atomic copy, preservation, and
   failure behavior with focused Node tests.
2. Electron and NSIS wiring implemented; verify static wiring and installer
   compilation through focused packaging checks.
3. Contracts updated; verify documentation governance, final diff, and status.

## Verification

- `node --test test/desktop-user-data.test.js`
- `node --test test/electron-main-modules.test.js test/packaging-scope.test.js`
- `npm run check`
- `npm run verify:docs`
- `npm run dist:win:local` if the focused checks do not compile the NSIS include.
- `git diff --check` and `git status --short`

Verification completed so far: `node --test test/desktop-user-data.test.js`, the
focused Electron/packaging/update tests, `npm run verify:quick`, the full
1316-test `npm test` suite, `git diff --check`, and a local
`electron-builder --win nsis --x64 --config.electronDist=node_modules/electron/dist`
all pass. Expected result: a legacy song database is copied intact exactly once,
an existing durable destination wins, migration failure does not publish a
partial target, and the Windows installer accepts the migration hook.

## Rollback Or Failure Handling

Stop before runtime initialization when migration cannot be completed. Keep the
legacy source untouched and remove only the uniquely named task-created staging
directory. Roll back only task-owned changes with a reverse patch; do not reset
the worktree or delete user data.

## Done When

- Packaged data resides outside the installation directory and survives updates.
- Existing install-local data migrates without overwrite or partial publication.
- Development data behavior and all persisted formats remain unchanged.
- Focused tests, documentation checks, installer compilation, diff check, and
  final scope review pass.
