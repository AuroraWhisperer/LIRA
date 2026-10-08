# Scene Preset Actions Implementation Plan

**Status:** Completed
**Goal:** Reduce new/copy preset latency and let users delete surplus presets safely.
**Architecture:** Keep desktop-owned drafts, the existing authenticated scene service and SQLite store, and the browser capability relay. No schema or credential changes.
**Tech Stack:** Electron, vanilla ESM, CommonJS, Node SQLite, existing Playwright fixtures.

## Current Behavior

There is no deletion action in the UI, controller, service or store. The desktop exchanges every 200 ms and the browser reads every 250 ms; command completion waits for another exchange. Isolated Electron measurements: new/copy 502–544 ms; synthetic safeStorage encryption/decryption each round to 0 ms.

## Ownership And Constraints

- `component-preview-dialog.js` owns desktop exchange scheduling; `component-preview-remote.js` owns browser polling and operation ordering. Preserve retry receipts, attachment ownership, generation checks and single-flight requests.
- `component-preview-canvas-controller.js` owns preset selection and draft controllers; `component-preview-presets.js` owns controls and confirmation. Preserve unrelated working-tree edits.
- `scene-service.js` validates owner/revision and protects bound output/active presets; `scene-store.js` atomically deletes by owner/revision and excludes bound references. The original bound output cannot be removed because its ID and credentials must remain stable.
- `scene-routes.js` owns the management endpoint; `component-preview-sessions.js` only relays deletion of the currently selected desktop-listed preset.
- Contracts: `docs/reference/backend/api.md`, `storage.md`, `frontend/app.md`, `specs/component-scenes.md`.
- Non-goals: deleting real user data during QA, changing live source identities, schema migration, new transport architecture, unrelated UI restyling.

## Milestones And Verification

- [x] Complete delete service/store/HTTP with expected revision, tenant isolation and binding protection. Test missing/stale/foreign IDs, fixed output, active preset and successful surplus deletion with unchanged publication/source.
- [x] Add current-preset delete command, confirmation and fallback selection; preserve drafts on cancellation/failure. Cover controller, relay and browser interactions with existing fixtures.
- [x] Push desktop results immediately after commands settle; increase browser read frequency only during pending mutations/operations without overlapping requests or idle polling changes. Measure new/copy again in the same isolated Electron fixture.
- [x] Run `node --experimental-vm-modules --test test/scenes/scene-service.test.js test/scenes/scene-store.test.js test/scenes/scene-http.test.js test/transport/component-preview.test.js test/admin/component-preview-canvas-controller.test.js test/admin/component-preview-remote.test.js`. Run affected browser editing/recovery and desktop fixture checks. Inspect changed UI and the skill detector, then review the touched diff, `git diff --check` and status.

## Results

- Initial focused run: 122 passed. Added store atomic-deletion and single-flight polling coverage afterward; affected four-file rerun: 88 passed. Added HTTP deletion coverage last; both HTTP deletion and all-management authorization cases passed.
- Browser editing, recovery, drafts, links and output: 26/27 initially passed; the preset test was updated to wait for confirmation close and the new selected preset after view remount, then passed. Extended it to verify protected deletion with recovered dirty drafts; the preset and affected recovery/retry cases all passed (3/3).
- Existing browser-controller and real Electron tests: 9/9 passed, including IPC saves, source identity, lifecycle and lost-response recovery.
- `npm run verify:quick`: passed (10 governance tests, syntax for 1324 files, 23 architecture checks). First run identified this plan's missing index entry, fixed before rerunning.
- Impeccable detector: no findings. Manual isolated Electron/browser QA checked confirmation, cancellation, deletion, fixed-source protection and retained unsaved drafts. All owned processes and the scratch directory were cleaned up.
- New/copy baseline: 544, 514, 530, 502 ms. Final repeated sample: 237, 214, 215, 214, 199, 214 ms. The first post-change sample also contained a 1062 ms outlier; these synthetic local measurements do not promise the same latency for every real scene or machine.
- Related finding: recovered-draft informational text hid action errors. Current action feedback now takes precedence, while pending recovery decisions remain first; the browser regression verifies that refused deletion explains why and keeps the dirty draft.
- No real user scenes were read or deleted. No schema, source credential, Electron privilege, package or release changes.

## Failure Handling And Done When

No local state is removed until the service confirms deletion. Refused deletion reports the service error and preserves the selected draft. Protected binding checks are also in the SQL statement. Reverse only task-owned hunks if verification fails. Done when surplus presets can be confirmed/deleted, protected/live data remains intact, measured interaction latency improves, affected tests pass and contract changes are recorded. Archive this plan with actual results at completion.
