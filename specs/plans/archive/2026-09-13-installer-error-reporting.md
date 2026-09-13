# Installer Error Reporting Implementation Plan

**Goal:** Make installer migration failures visible and give a nontechnical user a simple way to return useful diagnostics, including when the installer never displays a window.

**Architecture:** Keep the NSIS migration before the old uninstaller, including its copy-then-rename and abort-on-failure behavior. Add progress, an error dialog and a local report at this boundary. A separate read-only Windows helper collects installer evidence without running an installer or reading application databases.

**Tech Stack:** Existing electron-builder / NSIS, Windows PowerShell 5.1, Node.js built-in tests.

## Evidence and uncertainty

- The published 4.1.0 installer and local installer have identical SHA-256 hashes. Both archive layers pass 7-Zip verification and the Electron runtime files are present.
- `customInit` synchronously copies legacy data before any installer page appears. Its failure path currently calls `Abort` without a dialog; NSIS exits immediately from `.onInit`.
- This is a confirmed reporting defect, not a confirmed diagnosis of the unavailable Windows 10 computer.

## Ownership and constraints

- Owner: `build/installer.nsh`; contract: ADR-0013 and `docs/architecture/engineering/build.md` section 6.
- Preserve data paths, successful migration behavior, existing destination precedence, old data on failure, registry cleanup, and silent updater operation.
- Do not change Electron, application code, signing policy, version, releases, tags, or unrelated working changes.
- Build the local test installer using the original 4.1.0 application payload so unrelated working changes are not shipped accidentally.
- Never execute the real installer against user data. NSIS behavioral tests replace all migration/report paths with explicit temporary fixture paths.

## Implementation and verification

### 1. Reproduce and repair migration reporting

- [x] Add `test/installer-migration.test.js` to compile an isolated NSIS harness when `LIRA_TEST_MAKENSIS` is explicitly set. Test successful migration, an existing destination, copy failure, and publish failure. Require a readable failure report and nonzero exit without publishing incomplete data.
- [x] Run the failure case against the original script and confirm that no report is produced.
- [x] Add a temporary progress banner for interactive migration, destroy it on both completion paths, and leave silent execution unattended.
- [x] Before aborting, save stage, copy result, source/destination and captured tool output to `%TEMP%/LIRA-install-error.txt`; show a concise error dialog. If writing the report fails, the dialog still contains the stage and code.
- [x] Run `node --test test/installer-migration.test.js test/installer-registry.test.js test/desktop-user-data.test.js` with the fixture compiler configured.

### 2. Make diagnostic collection usable for a beginner

- [x] Add `scripts/collect-install-diagnostics.ps1` and its `.cmd` launcher. Collect only Windows version/architecture, nearby LIRA installer size/hash/signature, current installer process names, the recent migration report, and recent LIRA-related crash/block events.
- [x] Save a Chinese-named report beside the helper, with a temporary-directory fallback. Do not upload anything, start/stop programs, change Windows settings, or read cookies, credentials, or databases.
- [x] Validate PowerShell 5.1 syntax and run with mocked Windows data in a temporary directory to verify filtering and useful output when no installer/error log exists.
- [x] Update build documentation and include short Chinese instructions with the local test bundle.

### 3. Compile and deliver

- [x] Extract the previously verified 4.1.0 payload to a temporary packaging directory; build NSIS with `--prepackaged`, `--publish never` and a distinct local filename/output directory.
- [x] Validate the resulting installer archive and confirm its application payload is unchanged.
- [x] Run the documentation gate, inspect the touched diff, `git diff --check`, and `git status --short`.

## Failure handling and completion

Keep the old published installer intact. On test/build failure inspect the isolated result and change only task-owned files. Remove temporary fixtures only after validating their absolute paths. Completion requires the confirmed reporting defect to be fixed, data-preservation checks and installer compilation to pass, and a usable local test bundle. The affected Windows 10 machine still needs to return evidence before its original failure can be diagnosed conclusively.

## Results

- Baseline NSIS tests reproduced missing reports for copy and publish failures. After the fix all five isolated scenarios pass, including report-write failure and unattended silent operation.
- Migration, registry, desktop data and Windows diagnostics checks: 16 passing tests. Documentation gate: 5 passing tests. New JavaScript test files pass syntax checks.
- The diagnostics tests run Windows PowerShell 5.1 against mock event records and fixture files; unrelated event text and application-data sentinels are excluded. The launcher resets only its own inherited module search path so PowerShell 7 environments do not hide the Windows PowerShell modules.
- The full NSIS build exposed an unused variable in the uninstaller compilation. Moving its declaration into `customInit` fixed the build without weakening compiler warnings.
- Local installer: `release/installer-diagnostics/lira-setup-4.1.0-installer-fix.exe`, 118,493,555 bytes. The original and rebuilt `app-64.7z` payloads have identical SHA-256 `E0709C02874F9FD5CEF61C8F81F2DC35D4E7BB8C8C0DBF8CA83952AA4944DB7A`.
- Both installer archive layers and the four-file distribution ZIP pass extraction integrity checks. The ZIP is `release/lira-win10-install-check.zip`; it contains the installer, Chinese-named collector launcher, its PowerShell script and Chinese instructions.
- Verification was performed on the available Windows 11 machine and isolated fixtures. No real installer was executed against user data. The unavailable Windows 10 machine's original failure remains unconfirmed. No commit, version change or publication was made.
