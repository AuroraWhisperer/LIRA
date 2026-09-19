# Gift card aggregation and current sender presentation

**Status:** Complete (2026-09-19). User confirmed both scrolling cards and exported images. Implementation and focused verification are complete; the unrelated usage-guide CSS size failure and server deployment limitation are recorded below.

## Goal and boundaries

For today's Shanghai-date cards only, group selected/synchronized records by authenticated-source sender UID + exact gift ID + gift name. Sum quantities and each historical unit-price-times-quantity in integer cents. Apply the latest known sender name/avatar/guard evidence across all that sender's today cards. Same-rank renewals leave unrelated cards unchanged. Original ledger rows, history selection, statistics, settlement and other gift surfaces remain unchanged. Historical-date export rows retain their original presentation.

## Evidence and ownership

The existing processed-gift DTO deliberately omits UID and freezes per-event sender display evidence. Existing local rows therefore cannot be safely merged by name. Rather than changing that sync contract or rewriting rows, add an authenticated, read-only server query for today's gift event IDs and sender presentation evidence. It also resolves already-synchronized events. Domain/storage owners in `D:/Work/lira-server` provide the query; device transport and existing authorized local license operations carry it. The local application runtime fences results by gift source/revision and date, and exposes only today's presentation metadata to the gift-feed scope.

The pure card model lives in `public/js/shared/gift-card-model.js`, shared by the overlay and Node 24 export runtime; it has no DOM, storage, network, or domain-service dependencies. The banner renderer accepts an explicit derived card total, leaving ordinary per-event coloring unchanged. Export grouping happens before pagination/file layout, keeping preview and saved PNGs identical.

## Implementation and verification

- [x] Server: add today's paginated card-profile read model (UID sourced from tenant-owned gift rows, unknown stays null), device-auth route, protocol/OpenAPI/fixture, requirement and acceptance updates. Verify date/tenant/auth isolation, unknown identity, paging and unchanged raw rows.
- [x] Local: add validated metadata fetch through existing license operations, source/date fencing and read-only local overlay access; offline/unsupported-server reads preserve separate records and may reuse metadata only for the same source/day. No credentials or remote selectors reach renderers.
- [x] Cards: share grouping and profile projection, preserve stable anchors and ordering, use exact accumulated cents, sum quantities, avoid merging unknown IDs, and apply only to today. Scroll threshold uses merged-card count. Export only selected records, enrich names/frames using today's full sender observations, then paginate the derived cards.
- [x] Tests: pure grouping and mixed prices, same names/different IDs, distinct gift IDs/names, rename/upgrade/downgrade/unknown/same-rank renewal, older dates and midnight, raw-input immutability, overlay continuation, export layout/preview parity and source-switch races.
- [x] Run affected node:test/Chromium suites, security/access and module-boundary gates justified by the new endpoint, both repositories' documentation checks, syntax and final `git diff --check`/status reviews. Archive with exact results and disclose that deploying the server update remains outside this code-edit request.

Preserve all pre-existing edits in both repositories. No commits, branches, releases, deployments, new dependencies or destructive operations. Fail closed on stale source/date responses; unknown identities never merge by nickname. Rollback reverses only this task's changes, not existing gift/profile work.

## Verification results

- Live: `node --experimental-vm-modules --test test/gift-card-model.test.js test/gift-card-runtime.test.js test/remote-license-client.test.js test/remote-license-response-budget.test.js test/license-manager-operations.test.js test/frontend-gift-feed.test.js test/frontend-gift-display-settings.test.js test/gift-banner-feed.test.js test/overlay-http-access.test.js test/gift-routes.test.js` — 76 passed.
- Live: `node --experimental-vm-modules --test test/remote-license-client.test.js test/remote-license-response-budget.test.js test/remote-license-event-stream.test.js test/license-manager-operations.test.js test/gift-card-runtime.test.js test/gift-source-snapshot.test.js test/gift-export-controller.test.js` — 51 passed after transport/runtime extraction, before the additional boundary cases above.
- Live: Electron `scripts/verify-gift-export.cjs`, launched with Node `spawnSync` to wait for the Windows GUI executable — passed real transparent/white PNG writes, 40-row pagination, merged 2-to-1 export with quantity 5, latest nickname/governor frame and the 140-yuan pink tier. The generated merged PNG was visually inspected. Only synthetic records and temporary directories were used.
- Live: `npm run verify:docs` — 5 passed. `npm run verify:architecture` — 21 passed, 1 failed solely because the independently modified `public/css/admin/other-features/usage-guide.css` is 806 lines above its 798 ceiling; it was left untouched. This task extracted the gift read transport below 600 lines and removed its now-obsolete size registry entry.
- Server: `node --require ./test/support/test-mode.cjs --test test/gift-card-profiles.test.js test/gift-display-profile.test.js test/device-gift-history.test.js test/device-gift-events.test.js` — 15 passed, including auth/tenant/date boundaries, HTTP 400, no-store, 201-row pagination and unchanged existing delivery contracts. `npm run docs:check` — all 34 passed.
- Focused JavaScript syntax checks passed. Both working-tree diffs and statuses were reviewed, and `git diff --check` passed in both repositories. No generated images, user data or secrets were added by this task.

The companion server change is implemented locally in `D:/Work/lira-server` but has not been deployed. Without that endpoint or cached same-source/day evidence, cards retain separate rows and preview explains the incomplete identity merge. External nickname/rank changes become visible when new reliable server gift evidence is received; no external profile polling was added.
