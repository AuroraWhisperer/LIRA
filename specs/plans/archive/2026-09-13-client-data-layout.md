# Client Data Layout Implementation Plan

**Status:** Complete for the requested code/storage change; unrelated documentation gate failures are recorded below.

**Goal:** Separate browser profiles and rebuildable caches from durable LIRA data inside the selected installation, preserving existing databases, login state, media URLs and updater behavior.

**Architecture:** Keep the existing `data` root and five databases. Electron owns `data/browser`; music and gift caches use `data/cache`. A journaled, restartable directory migration runs before consumers open the relocated files. The installation-level `logs`, `updates`, `resources` and `locales` retain their roles.

**Tech Stack:** Electron 43, Node.js 24, CommonJS, native filesystem operations and node:test; no new dependency.

## Requirements and evidence

- Current user request authorizes research, code changes and storage reorganization. Data remains installation-local under ADR-0015.
- Microsoft VS Code portable mode groups user-data and extensions under `data`: https://code.visualstudio.com/docs/setup/portable
- JetBrains separates configuration, caches, plugins and logs: https://www.jetbrains.com/help/idea/directories-used-by-the-ide-to-store-settings-caches-plugins-and-logs.html
- Chromium profiles include persistent cookies/preferences as well as caches, especially on Windows: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md
- Electron supports setting `userData` and `sessionData` before ready: https://www.electronjs.org/docs/latest/api/app#appsetpathname-path
- These sources support separation by lifecycle, not a universal directory tree. LIRA keeps its five databases, uploads, encrypted credentials and public file URLs.

## Ownership and boundaries

- `src/shared/data-paths.js`: pure path mapping used by desktop, server and cache adapters.
- `src/storage/data-directory-migration.js`: restartable filesystem migration, without opening databases or reading credentials.
- `src/electron/desktop-user-data.js` and `main.js`: profile migration, stable single-instance lock, path wiring and old AppData compatibility.
- `src/server/runtime-config.js`, server initialization, gift cache adapters and initialization script: cache paths and migration before use.
- Owning documents: backend/storage.md, desktop/main.md, desktop/auth.md, desktop/update.md; new ADR records the refined layout.

## Compatibility and failure handling

- Keep `dataDir` as the durable business root, database names/schema, settings, safeStorage, session partition names, media URLs, HTTP/WS/IPC and updater source.
- Acquire the desktop single-instance lock against the old stable data root before relocating profiles; every newer launch uses this same lock identity.
- Enumerate only known legacy entries. Unknown user files remain untouched. Never merge or overwrite an existing destination.
- Publish a migration journal before same-volume renames. Interrupted renames resume from source/destination presence; missing entries or conflicting copies stop startup. Do not delete user files.
- No real user databases are used in tests. Validate native Electron profile persistence with temporary data only.
- Runtime/generated data is not committed; no branch, commit, release or installation is performed by this code change. Existing installed binaries continue to require a rebuilt version to use the new layout.

## Milestones and verification

- [x] Add pure path mapping and journaled migration tests: bytes preserved, SQLite companions untouched, credential/media files untouched, repeat execution, interruption, conflict, missing entry and unsafe path rejection. Run `node --test test/data-directory-migration.test.js test/desktop-user-data.test.js`.
- [x] Wire browser paths after the stable instance lock and before ready; update AppData session restore and updater cache root. Run desktop lifecycle/auth/updater tests and a temporary-profile Electron restart check.
- [x] Relocate music and gift cache files through their owners; retain virtual URLs. Run cache, initializer, HTTP image and server lifecycle tests.
- [x] Update ADR/owner docs and run `npm run verify:quick`, then `npm test` for the persistence/lifecycle boundary; attribute unrelated pre-existing failures without changing them.
- [x] Inspect final touched diff, `git diff --check` and `git status --short`; record results here and archive this plan when complete.

## Done when

Fresh profiles use the grouped directories; legacy profile cookies and partition cookies survive restart; interrupted migration resumes without overwrite; database/credential/media bytes remain untouched; old and new image URLs resolve identically; updater downloads stay at installation-level `updates/lira-updater`; focused tests and justified repository gates pass or remaining limitations are documented.

## Results and discoveries

- Final migration/startup/updater/native Electron selection: 22 passed, 0 failed. Coverage includes junction rejection, completion-journal write failure, resume, no overwrite, cookies in both profiles, localStorage, safeStorage and a live second-instance rejection.
- Cache adapters, gift initialization/background refresh, HTTP artwork and desktop shutdown were exercised by focused runs and the full suite.
- `npm run check`: passed for 616 JavaScript files at that run. Subsequent production edit changed only `let` to the existing main-module `var` convention; main startup and native tests passed afterward.
- `npm test`: 1712 tests; 1707 passed, 2 skipped, 3 failed. All failures were existing/concurrent gift-removal documentation references in `governance-docs.test.js`: engineering/test.md points at removed gift tests, ai-workflow.md points at gift-detection-service.test.js, and specs/README.md points at detection-service.js. `verify:quick` stops at these same three documentation checks; these unrelated changes were preserved.
- No database schema change, package installation, installed executable replacement or real-profile migration was performed. The implementation automatically migrates an existing installation when the rebuilt client first starts.
- Native verification confirmed Chromium does not recreate Network, Local State, Local Storage, Preferences or Partitions at the business root after migration. The lock remains associated with the original root.
- Repository-wide `git diff --check` also reports an unrelated trailing blank line in the concurrently edited `test/gift-analysis-service.test.js:205`. It was not changed by this task; the storage-change file selection is checked separately.
