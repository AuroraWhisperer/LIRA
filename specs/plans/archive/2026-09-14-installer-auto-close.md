# Installer Automatic Close Implementation Plan

**Goal:** Restore the installer prompt that offers to close a running LIRA, and continue installation only after the old processes have exited.

**Architecture:** Keep exit coordination in `build/installer-data.nsh`, before its existing data-preservation boundary. Request normal window closure through Windows messages for the previous or selected installation executable; retain the independent process-exit check before copying data.

**Tech Stack:** Existing NSIS/System/nsProcess plugins and Node.js native integration tests.

**Status:** Complete, 2026-09-14.

## Current behavior and ownership

The v4.1.1 preservation section runs before electron-builder's `CHECK_APP_RUNNING`. Its `liraWaitForAppExit` only asks interactive users to close the application manually. The built-in close flow is therefore unreachable until the user has already closed LIRA. Reusing that flow directly would also permit forced termination before application cleanup finishes.

- Owner: `build/installer-data.nsh`; caller: `build/installer.nsh` preservation section.
- Contracts: `docs/architecture/engineering/build.md` section 6 and ADR-0015.
- Consumers: manual installation and silent electron-updater installation.
- Existing verification: installer migration, directory, uninstall, desktop data, updater and Electron shutdown tests.

## Constraints and non-goals

- Preserve data paths, backup/restore ordering, failure reports, installer identity, updater contracts and Electron shutdown behavior.
- Send `WM_CLOSE` only to windows whose executable path exactly matches the old or selected installation. Do not forcibly terminate processes or close unrelated applications.
- Silent updates continue to wait for the application's own exit without interaction or extra close requests.
- Keep the existing process-name check as the final guard: any remaining matching process or check error must prevent data movement.
- No hot reload, version bump, release, branch or commit. Preserve the unrelated untracked report.

## Implementation and verification

### 1. Capture the regression in native fixtures

- [x] Add `test/installer-app-exit.test.js`. Compile hidden fixture windows with the existing NSIS compiler, using a unique executable name and isolated temporary directories.
- [x] Simulate only message-box responses; execute the real close, polling and backup functions. Cover approval in old and selected directories, cancellation, refusal, retry, another installation path, and silent shutdown. Assert that a delayed final write is present in the backup, and unsuccessful/cancelled closure leaves data untouched.
- [x] Run the new test against the old script and observe the approval regression.

### 2. Restore automatic closure at the preservation boundary

- [x] Add `liraRequestAppExit`: enumerate top-level windows, query each process executable with `PROCESS_QUERY_LIMITED_INFORMATION`, compare full old/selected executable paths, and post `WM_CLOSE`. Release process handles and the System callback.
- [x] Update `liraWaitForAppExit`: prompt once before closing; cancellation exits before data changes; poll every 250 ms for up to 10 seconds; only after that offer manual retry/cancel. Retry repeats the close request. Silent mode only polls and reports failure on timeout.
- [x] Run native close and migration tests. Confirm refused closure cannot reach preservation and unrelated paths receive no close request.

### 3. Verify compatibility and document the result

- [x] Update the build contract and Windows test coverage description.
- [x] With `LIRA_TEST_MAKENSIS` and `LIRA_TEST_NSIS_PLUGINS` configured from the local electron-builder cache, run the native close/migration suites and affected directory, uninstall, registry, diagnostics, desktop data, updater, shutdown and packaging tests using `node --experimental-vm-modules --test`.
- [x] Run `npm run verify:quick` for documentation, syntax and architecture compatibility. Full unrelated domain tests are not required for an installer-only change.
- [x] Archive the plan with actual results; final diff and status checks are the delivery gate.

## Failure handling and done criteria

An unsuccessful close never authorizes backup or uninstall. The installer offers retry/cancel, or fails unattended in silent mode. Tests never launch or stop real LIRA and all fixture cleanup validates its temporary root. Reverse only this task's edits if needed. Completion requires verified automatic close, preservation of the final pre-exit data, safe cancellation/refusal, unchanged silent behavior, and passing focused and quick checks.

## Results

- The old script failed the approved-close scenario with exit code 2 and passed silent exit, reproducing the manual-install regression.
- Final `node --experimental-vm-modules --test test/installer-app-exit.test.js`: 8 passed, no skips. The seven scenarios include both installation paths, cancellation, refusal without forced termination, retry, path isolation and silent exit. Two hidden fixture windows receive close requests and the backup contains the delayed final write.
- `test/installer-migration.test.js`: 15 passed, no skips, on the final installer code. The other eight affected test files listed above passed 58 tests with no skips. Together these establish 81 passing focused tests across the separate runs.
- `npm run verify:quick`: 5 documentation checks, syntax validation for 737 JavaScript files and 22 architecture checks passed. A subsequent fixture-only correction limits message counting to its two owned windows; the corrected native suite passed again.
- No real installation was run, no packaged installer was rebuilt and no release was published. The changed installation behavior takes effect in the next rebuilt installer.

Native API references: [NSIS callback handling](https://nsis.sourceforge.io/Docs/System/System.html), [Windows normal window closure](https://learn.microsoft.com/en-us/windows/win32/learnwin32/closing-the-window), and [process executable-path lookup](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew).
