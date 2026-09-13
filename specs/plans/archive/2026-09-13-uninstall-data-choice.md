# Uninstall Data Choice Implementation Plan

**Goal:** Normal uninstall removes program files, logs and update downloads, retains user data by default, and offers an unchecked data-deletion option with a second confirmation.

**Architecture:** Keep electron-builder's NSIS installer and lifecycle. A dedicated uninstall include owns the options page and removal policy; `--updated` always retains data, logs and downloads, including silent upgrades.

**Tech Stack:** Existing NSIS/MUI2/nsDialogs and Node.js test runner; no new dependencies.

## Scope and current behavior

`build/installer.nsh` currently skips `data`, `logs` and `updates` during every uninstall. The builder calls the same removal macro for upgrades, passing `--updated`. Existing `test/installer-migration.test.js` verifies preservation with isolated compiled NSIS fixtures.

The desktop can restore old data from `%APPDATA%/com.aurorawhisperer.lira/data` and old browser partitions from `%APPDATA%/lira`. Explicit data deletion also clears these two known current-user application roots so reinstall does not revive deleted settings or sessions. Uninstall must not remove sibling recovery backups, arbitrary user paths, or cloud data.

## Ownership and compatibility

- Owner: `build/installer.nsh` and new `build/installer-uninstall.nsh`.
- Consumers: electron-builder's `customUnWelcomePage`, `customUnInit`, and `customRemoveFiles` hooks; installation recovery in `build/installer-data.nsh`.
- Contracts: `docs/architecture/engineering/build.md` and ADR-0015.
- Tests: existing installer migration/directory/registry/diagnostics fixtures and new `test/installer-uninstall.test.js`.
- Preserve default installer paths, app identity, shortcuts/registry lifecycle, upgrade recovery, data formats and Electron security boundaries. Existing staged changes stay intact.
- Silent uninstall preserves data; deletion requires interactive checkbox selection and explicit confirmation. Upgrades preserve all three existing runtime directories regardless of selection state.
- Only enumerate installation children after rejecting an empty or drive-root installation path. Legacy cleanup uses fixed application-owned descendants of current-user AppData.

## Milestones

- [x] Add failing uninstall regression coverage: default retention, confirmed removal, silent retention, upgrade retention, legacy-source behavior, outside-path preservation, invalid installation root and production UI compilation.
- [x] Implement the unchecked NSIS option and confirmation. Confirm after the builder selects the actual installation and checks app exit; refusal continues uninstall with data retained. Apply normal-uninstall cleanup only after distinguishing upgrade mode.
- [x] Update migration fixtures for the new owner and upgrade mode, and update the owning documentation.
- [x] Run focused checks and the relevant repository gates, review the scoped diff and archive this plan with results.

## Verification

Set `LIRA_TEST_MAKENSIS` and `LIRA_TEST_NSIS_PLUGINS` to the locally cached builder compiler and Unicode plugins. Run:

```text
node --test test/installer-uninstall.test.js test/installer-migration.test.js test/installer-directory.test.js test/installer-registry.test.js test/installer-diagnostics.test.js
node --test test/packaging-scope.test.js test/update-manager.test.js test/desktop-user-data.test.js
npm run verify:quick
git diff --check
git status --short
```

All destructive tests use generated files under validated temporary fixture roots. Compile and execute the production NSIS removal policy there; compile the real options page into a fixture uninstaller. No installed LIRA or real user data participates.

## Failure handling and rollback

Reject unsafe installation roots before deleting files. A declined confirmation keeps data and continues normal uninstall. Deletion errors are reported and the original uninstaller remains available for retry. Revert only this task's edits by inspecting its diff; do not reset or overwrite staged work.

## Discoveries

- Native regression demonstrated that NSIS `RMDir /r` follows Windows junctions and deletes the target contents. The uninstall owner now walks ordinary directories and unlinks reparse points without following them. Fixtures cover links inside data, data-root links and legacy-root links, preserving outside fixture contents.
- Confirmation runs in `customUnInstall`, after the builder's installation-mode selection and app-exit check, so the approval applies to the selected installation. The options page only records the unchecked-by-default request.

## Done when

The normal uninstall defaults to retaining user data while removing logs/downloads; only confirmed interactive deletion removes the installation and known legacy user data. Upgrade and silent paths retain user data. Focused native tests and relevant checks pass or unrelated failures are recorded; documentation and final diff agree with the behavior.

## Results

- The full focused selection passed: 48 tests, zero failures or skips. This includes compiled, generated NSIS uninstallers with the production options page, 13 removal/safety scenarios, 14 installation-preservation scenarios, installer directory/registry/diagnostics, packaging scope, updater cache location and legacy desktop data handling.
- `npm run verify:quick` passed: documentation links, JavaScript syntax and architecture/modularity checks. The final touched JavaScript files also passed individual syntax checks; documentation checks passed again after the owning-doc updates.
- Fixture uninstaller launches now preserve NSIS's required unquoted trailing `_?=` path using `windowsVerbatimArguments`, ensuring the test waits for the actual uninstaller. Error dialogs are replaced with diagnostic output only inside isolated test copies, preserving failure exit codes without desktop popups. All test processes exited.
- The user must rebuild and install a new installer to receive the new uninstall UI. No installed application, user profile, real database, registry entry, release or staged change was modified by verification.

## Reference

The implementation uses the existing [electron-builder NSIS customization hooks](https://www.electron.build/v26/docs/nsis/) and NSIS [default-no MessageBox behavior](https://nsis.sourceforge.io/Reference/MessageBox).
