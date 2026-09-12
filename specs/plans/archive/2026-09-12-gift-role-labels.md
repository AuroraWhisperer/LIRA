# Gift role labels implementation plan

**Status:** Completed in source on 2026-09-12.

**Goal:** Keep desktop and server catalog displays consistent for direct gifts, box products and box outputs, using existing catalogs and verified relations without adding event transport fields.

**Architecture:** Catalog labels are disposable view data. Server event classification and settlement remain authoritative. Desktop schema 2 and server schema 3 each derive labels from their existing complete snapshots; activity identity must not be guessed by a shared name or ID. No database, settings, remote API, authentication or release changes.

**Scope:** Desktop gift picker (`public/js/admin/overtime.js`) and a small shared display helper; server public catalog code details/activity cards (`public/gifts/catalog-view.js`, `gift-variants.js`) and a display helper. Preserve all previous and concurrent modifications. No changes to selection behavior, catalog contents, image transport or settlement.

## Steps

- [x] Add regression cases using the existing shared synthetic heart-box fixture. Cover all three labels, same-name other IDs, shared pools, updated/removed relations and conflicting activity identities.
- [x] Build display indexes when a full catalog arrives; use existing fetches and update notifications. Render category and parent pool names with safe text APIs. Do not infer event classification from these labels.
- [x] Synchronize requirement, acceptance criteria and owning catalog documentation. Run affected picker/catalog and gift/import tests, inspect task diffs, syntax checks and `git diff --check` in both repositories.
- [x] Record validation results and archive. Report source completion separately from server deployment and installed-client release.

## Verification

Client: `node --experimental-vm-modules --test test/overtime-gift-picker.test.js test/frontend-gift-catalog-update.test.js test/frontend-gifts-panel.test.js test/processed-gift-import.test.js test/overtime-limits-roundtrip.test.js` — 40 passed. `npm run verify:docs` — 5 passed; `node --test test/module-boundaries.test.js` — 12 passed.

Server: `node --test test/gift-role.test.js test/gift-blind-box-page.test.js test/gift-cache.test.js test/gift-variant-valuation.test.js test/bilibili-blind-box-valuation.test.js` — 34 passed.

Browser: `node node_modules/@playwright/test/cli.js test e2e/gift-variants.spec.js --grep '1280px'` — 1 passed using existing isolated browser fixtures. Verified box labels, navigation to output labels and English display. Inspected the generated screenshot; no layout changes were needed.

## Final review

- Display helpers live in desktop `public/js/shared/gift-catalog-roles.js` and server `public/gifts/gift-role.js`. They use indexes derived from their existing schema-2/schema-3 snapshots, without persisting a new type or changing the event protocol. Unknown identities do not acquire labels.
- Desktop full-catalog updates replace the role lookup; a revision fence prevents an older pending picker response from restoring removed relations. Server code details update in place after the existing catalog fetch; activity cards receive the same lookup.
- Updated server asset URLs consistently to `20260912-gift-roles`, including the existing cache and browser tests. This only changes source resource URLs; no release was published.
- Server documentation/protocol checks passed. The broader governance command retains the pre-existing `test/room-monitor-overlay.test.js (602)` line-cap failure. A final architecture check confirms no task-owned file exceeds the cap; the unrelated file was preserved.
- Runtime syntax checks and both repository diff checks passed. Reviewed touched diffs against pre-task copies where other work existed. No live user data was modified; browser outputs are temporary test artifacts outside the repositories.
- Installed LIRA and the live server have not been updated. Deployment must include the preceding blind-box attribution/parser repairs together with these display changes. Old incorrectly classified ledger rows remain unchanged.

Existing global line-cap failures in unrelated files are not a reason to modify those files. Tests use synthetic fixtures and isolated state only. Rollback, if needed, reverses only task-owned hunks.
