# Song Import Update Implementation Plan

Status: Complete — 2026-09-13

> **For agentic workers:** Execute this delegated client task inline; no commits or deployment.

**Goal:** Implement report stage 4: preview and atomically update matching songs, and export stored source platforms.

**Architecture:** A pure music-owned planner derives changes from parsed rows and a full song snapshot. Two local API endpoints preview/apply; the store owns the transaction and reruns the planner before writes. UI keeps one preview and invalidates it on input changes. No database migration, dependency or cloud wire change.

**Tech Stack:** Existing CommonJS music/store/runtime, ESM admin, node:test, SQLite, isolated Electron renderer.

## Global constraints

- Preserve unrelated edits and the default add-only import behavior.
- Exact normalized name + artist matching; never delete unrelated songs.
- Missing fields preserve existing values; blank values preserve unless explicitly allowed to clear.
- Preview token binds source rows, clear option and complete current song snapshot; stale input/snapshot rejects before writes.
- Any invalid/conflicting input blocks update-mode commit; same-content file duplicates collapse.

## Tasks

- [x] Add pure `src/music/song-import-update.js`: `{rows, allowEmptyClear}` plus stored rows produce counts, row differences and private changes. Preview/apply facade returns only public DTO. Validate row limits, field types, enabled cells, lengths, duplicate identities; cover these with `test/song-import-update.test.js`.
- [x] Add `songStore.applyImportUpdate(buildPlan)`: BEGIN transaction, read current snapshot, validate token via planner, apply inserts/updates, record batch, COMMIT. Rollback failures and stale/conflict paths. Expose facade in domain-services and authenticated routes `import-preview`/`import-apply`; apply emits one snapshot + dirty scope.
- [x] Preserve raw column presence in text/XLSX update parsing, keeping default parsing unchanged. Export `source_platform`. Cover both formats, omitted/empty fields, repeated aliases and formula safety.
- [x] Add explicit update mode and paginated preview to admin. Bind original input+options to confirmation; changing input invalidates old responses; prevent double apply. Verify actual controls against isolated local runtime.
- [x] Update metadata spec, API, music/storage/frontend owners and index. Run focused node tests, syntax/architecture/docs gates and final diff review; archive when done.

## Failure handling

Only revert task-owned hunks if necessary. Keep preview read-only and return stable `SONG_IMPORT_PREVIEW_STALE` (409) / `SONG_IMPORT_PREVIEW_INVALID` (422) errors. No commit/deployment.

## Implementation and review results

All tasks completed. The preview token also binds the category snapshot so category changes invalidate prior previews. Store-side planning runs inside one transaction; route wiring includes both domain-services and api-context. Existing import batch schema is reused without a migration; the apply response carries updated counts.

Independent review reproduced two boundary failures and they are fixed: malformed JSON bodies (including `null`) return 400, and any changed result snapshot over 5000 songs is rejected, including pure updates to historical over-limit libraries. UI review also fixed the clear-option checkbox styling and separated a failed post-commit list refresh from a failed import; the latter now keeps local success and cloud-state feedback with a refresh instruction.

## Verification results

- Focused suite: `node --experimental-vm-modules --test test/song-import-update.test.js test/song-import-update-ui.test.js test/song-import-table.test.js test/song-file-codec.test.js test/song-request-form.test.js test/song-library-filter.test.js test/song-service-boundary.test.js test/cloud-runtime-sync.test.js test/cloud-sync-controller.test.js test/governance-docs.test.js test/module-boundaries.test.js test/esm-module-boundaries.test.js test/admin-page-composition.test.js` — 89 passed before adding the post-commit refresh regression.
- Full suite: `npm test` — 1718 tests, 1717 passed, 1 skipped, 0 failures. Log: `output/song-import-update-electron/full-test.log` (local generated evidence).
- Final added regression and docs: `node --experimental-vm-modules --test test/song-import-update-ui.test.js test/governance-docs.test.js` — 9 passed, including rejected `reloadSongs` after successful apply.
- `node scripts/check-js.js` — syntax check passed for 614 JavaScript files.
- Actual Electron 43 BrowserWindow used the real Admin renderer and `createServerRuntime` with an isolated temporary profile/SQLite database. Verified mixed insert/update/unchanged preview and apply, exactly one complete sync snapshot, stale preview refusal with zero sync, and explicit blank clearing preserving omitted clip/platform fields. No renderer errors. Final screenshot and JSON: `output/song-import-update-electron/preview.png` and `verification.json`.
- The Electron harness bypassed the production licensing shell using an isolated test license gate; no real account/user data was used. Cross-repository remote-server/public-page integration is owned by the parent task and recorded in the server repository.
- Final task diff inspected and `git -c core.safecrlf=false diff --check` passed. Existing unrelated edits were preserved. Generated evidence remains untracked; nothing was committed or deployed.
