# Install-local Data Implementation Plan

**Goal:** Keep LIRA application data in the selected installation directory, preserve it across upgrades and reinstallations, and prevent installation from copying data while the old application is running.

**Architecture:** `desktop-user-data.js` owns the runtime paths. A hidden first NSIS installation section confirms that the old application has exited, then copies its data to a complete sibling backup before the old uninstaller runs. The installer restores this backup before the new app can start. Previous AppData data is a compatibility source only.

**Tech Stack:** Existing Electron, electron-builder / NSIS, Node.js built-in tests.

## Requirement and evidence

- The user explicitly requires all application data to remain in the installation folder, not in a C-drive AppData directory. This supersedes ADR-0013's path decision while retaining its data-preservation requirement.
- Final clarification: do not require C:, D: or another drive. The installation folder owns `data/`, `logs/` and `updates/`. Prefer `D:\LIRA` only for a fresh install when D: exists; otherwise retain the original installer default. Existing installations and explicit choices take precedence.
- The returned Windows 10 reports show sharing violation 32 while copying Chromium Cookies, with LIRA still running. The original migration ran in `customInit`, before the builder's application-exit check.
- Four Electron processes alone are not evidence of four application instances or failed shutdown. Existing startup cleanup targets the owned server-port occupant; it does not run when an NSIS installer is launched.

## Owners, boundaries and compatibility

- Owners: `src/electron/desktop-user-data.js`, `src/electron/main.js`, `src/electron/update-manager.js`, `build/installer.nsh`.
- Contracts: desktop/main, desktop/update, engineering/build, backend/storage and ADR-0013 (superseded by an install-local decision).
- Keep the appId and installer identity so existing installations and updates remain associated with LIRA. The appId must no longer select the active data location.
- Preserve databases, encrypted credentials, Chromium partitions, renderer security and existing-directory precedence. Never merge or overwrite two different existing data directories silently.
- Old AppData contents remain intact until a complete local copy is published. Do not read or change real user databases during development.
- Preserve unrelated working changes. No version bump, branch, commit or publication.

## Changes and verification

- [x] Reverse the packaged runtime paths: active `<exe directory>/data`, compatibility source `%APPDATA%/com.aurorawhisperer.lira/data`. Keep development data unchanged. Extend focused path/migration tests, including an installation on C:.
- [x] Move preservation out of `customInit`. A native nsProcess check runs before the copy; the standard builder process check remains in place. A deterministic complete sibling backup is published only after robocopy returns 0–7, and never overwritten.
- [x] Restore data before the new application can launch. Support changed directories with copy-then-publish. Failure keeps the source or recovery backup. New uninstallers preserve data, logs and updates.
- [x] Retain visible errors and the diagnostics helper. Cover locked data, interrupted recovery, failed preservation/restoration, conflicting targets and silent operation with isolated NSIS fixtures.
- [x] Keep Electron session data and logs local. Keep the default updater's HTTP executor and redirect only its cache root to the installation folder.
- [x] Update owning contracts and supersede ADR-0013 with ADR-0015, including the final no-drive-restriction clarification.
- [x] Run focused data, installer, shutdown and updater tests; run documentation and relevant architecture/static gates. Inspect the touched diff, `git diff --check` and `git status --short`.
- [x] Build a distinct local installer from the verified 4.1.0 application payload plus only task-owned runtime changes. Verify installer integrity and packaged source paths before providing it.

## Failure handling and completion

Never execute a real installer against user data. Test harnesses replace application, AppData, temporary and registry paths with fixture paths. Keep the published installer and previous diagnostic bundle intact. If preservation or restoration fails, stop with the recovery location visible and do not start an empty application. Completion requires local paths, safe upgrade/recovery checks and a verified local installer; remote Windows 10 verification remains the user's next observation.

## Discoveries and verification evidence

- `customInit` is too early for process-sensitive copying. A hidden first section is needed before builder's old-uninstaller invocation; unelevated all-users execution defers to the elevated child. AppData compatibility lookup uses the current user's context even for an all-users install.
- NSIS `GetFullPathName` can produce an empty output for a missing target directory. Create the selected target first, normalize into a separate variable and reject empty/root/nested unsafe paths before computing any data paths. An early fixture exposed this by creating only two synthetic sentinel files at `D:\data`; their exact names/content and parent were verified and the two files plus empty directories were removed. No real user data was used or changed.
- nsExec output can be empty even when robocopy reports a sharing violation. `/UNILOG` preserves the actual filenames and errors in the UTF-16 diagnostic report.
- Passing a custom app adapter to `NsisUpdater` disables its Electron HTTP executor. The final code retains the default singleton and relocates the adapter cache property before its download helper is created; the actual library helper and executor are tested without network access.
- An actual Electron 43.2.0 probe using isolated synthetic state confirmed `userData`, `sessionData`, default session, persistent Bilibili partition, logs and crash dumps all resolve inside the selected fixture installation. Cookie flush succeeded. No real client was launched against user data.
- Directory selection fixtures cover fresh installs with and without D:, upgrades on C:/D:, and an explicit E: destination. Full NSIS compilation validates the directory-page hook and hidden-section integration.
- The published 4.1.0 source was compared with HEAD before copying the three task-owned runtime files into an isolated packaging tree. Initial `git apply` outside the checkout returned success without changing that tree; file/hash verification caught this before delivery. Final ASAR verification requires exactly those three changed files among 892 payload files.
- Recovery failure now exits before setting any Chromium profile paths, so it cannot create an empty `data/` that conflicts with the next installer recovery. A second native Electron probe verified both normal cookie persistence and this early-exit case against synthetic state.

## Completion results

- Focused suite: `node --test test/installer-directory.test.js test/installer-migration.test.js test/installer-diagnostics.test.js test/installer-registry.test.js test/desktop-user-data.test.js test/electron-shutdown.test.js test/update-manager.test.js test/electron-main-modules.test.js test/packaging-scope.test.js` — 63 passed, no skips, with the local NSIS compiler/plugin environment configured. After the final early-exit adjustment, the 30 affected shutdown/main-module tests passed again.
- `npm run verify:quick` — documentation, JavaScript static checks and architecture boundaries passed on the final runtime code.
- Full NSIS installer and embedded payload integrity checks passed. All 24 Electron payload files remain present; only `resources/app.asar` changed. Its 892 files differ only at the three task-owned runtime source files, whose SHA-256 values match the final working fixes. The original installer SHA-256 remains unchanged.
- Final installer: `release/installer-local-data/lira-setup-4.1.0-local-data.exe`, 118,509,426 bytes, SHA-256 `506949df4a4b48d8ca17faca18a3f630ef0ef52b5ead2759a9545c32528fd51a`.
- User bundle: `release/lira-install-fixed.zip`, 118,518,812 bytes, containing the installer, two diagnostic helper files and a plain Chinese installation/reporting guide. ZIP integrity passed. No release was published and no installer was run against real user data. Remote Windows 10 installation remains the final user-side confirmation.
