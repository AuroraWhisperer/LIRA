# Gift Catalog Background Updates Implementation Plan

Status: complete (2026-09-05).

## Goal

Check the gift catalog once per authorized desktop launch and every 12 hours
while the runtime is open. Download only new, changed, or missing artwork.
Show a single updating toast after first initialization, and refresh visible
artwork when files are ready.

## Non-goals

No remote push service, server deployment, gift detection/settlement changes,
blind-box mapping replacement, dependency additions, or production migration.

## Current Behavior

The remote cache polls every ten minutes. Completed initialization can skip
missing files; a 304 does not trigger asset recovery. CDN failure falls back
to bulk server downloads. Catalog notifications precede image readiness.
Recent artwork is cached indefinitely in the renderer.

## Ownership

- `src/bilibili/gift/remote-catalog-cache.js`: conditional HTTP cache and timer.
- `src/bilibili/gift/gift-catalog-initializer.js`: single-flight asset scan.
- `src/bilibili/gift/remote-gift-image-cache.js`: local image revisions/cache.
- `src/bilibili/gift/hybrid-catalog.js`: integration and ready notifications.
- `src/electron/main.js`: authorized launch and first-entry gate.
- Admin gift artwork, state events, and a dedicated update-toast module.
- Contracts: local gift bootstrap spec, backend API/overtime docs, ADR-0012.

## Compatibility Constraints

Preserve existing user changes, paid-only membership, exact-ID artwork lookup,
room membership, historical records/prices, blind-box settings, IPC sanitization,
trusted image origins, file limits/signatures, and local immutable image URLs.
Server wire fields remain unchanged. Server-only images remain supported;
CDN failures no longer trigger automatic network fallback to LIRA Server.

## Proposed Changes

- Keep the timer in the remote cache, allowing its owner to run the initializer
  on each tick; the initializer uses one conditional catalog request per check.
- Scan current cache availability on every check, including 304. Later scans
  report download progress only for missing/current-revision-invalid images.
- Include the validated server image path in CDN cache identity. An image
  revision must publish a changed source URL or server image path. Persist the
  last successfully downloaded basename by exact gift ID in a validated,
  atomically written image index so failed replacements retain old artwork.
- Emit the existing `gift-catalog:update` snapshot only after local files are
  ready; its image paths are local. Include artwork in renderer deduplication.
  Decorate room members by ID without importing global catalog membership.
- Reuse existing sanitized initialization IPC for an Admin-only progress toast.
  No toast for first initialization or unchanged checks; one toast updates in
  place and ends with success or partial-failure feedback.
  Add sanitized `background` and `completedAt` fields to cover updates that
  finish before Admin subscribes without mistaking restored disk state for a run.

## Milestones

- [x] Add image revision, retention, no-CDN-fallback regression tests; implement
  image cache changes and verify `test/remote-gift-image-cache.test.js`.
- [x] Add startup/12-hour/304 recovery/single-flight/readiness tests; implement
  initializer, remote timer, hybrid wiring, and authorized startup changes.
- [x] Implement/test live renderer artwork and background update toast.
- [x] Update contracts, review scoped diff, and complete focused verification.

## Verification

Run `node --experimental-vm-modules --test` on directly affected image cache,
initializer, remote catalog, hybrid integration, Electron license, and frontend
tests. Run `npm run check`, relevant architecture/security checks if required
by the actual diff, `git diff --check`, and `git status --short`.
Use temporary test state and mocked downloads; no real user data or server load
tests. Inspect the toast with the existing frontend test/runtime tools.

### Results

- Backend: 44 passed with
  `node --test --test-timeout=20000 --test-reporter=spec test/gift-catalog-background-updates.test.js test/gift-catalog-initializer.test.js test/remote-catalog-cache.test.js test/remote-gift-image-cache.test.js test/remote-overtime-catalog.test.js test/license-gate.test.js test/license-catalog-bootstrap.test.js test/initialize-gift-catalog-script.test.js test/overtime-routes.test.js`.
- Frontend: 78 passed with
  `node --experimental-vm-modules --test test/frontend-gift-catalog-update.test.js test/frontend-gifts.test.js test/frontend-admin-shell.test.js`.
- Login UI: 10 passed with
  `node --test --test-timeout=20000 --test-reporter=spec test/license-ui.test.js`.
- `npm run check`: 557 JavaScript files passed.
- `npm run verify:architecture`: 9 passed; legacy global usage stayed within
  the existing baseline. `npm run verify:docs`: 5 passed.
- Isolated Chromium used the actual toast module/CSS and a mocked license
  bridge. First/unchanged scans stayed silent; start/progress/completion reused
  one node; partial/fatal errors, auto-dismiss, and duplicate completion handling
  passed. DOM bounds fit 1100x760 and 780x600 with no page errors.
- Screenshot files were produced but not visually reviewed. The isolated
  Electron fixture failed to launch, so this is not full desktop verification.
  The temporary fixture, browser, and fixture server were cleaned up.
- Scoped diffs and status were reviewed; `git diff --check` passed. Existing
  unrelated changes and bundled-artwork deletions were preserved. No generated
  runtime data, credentials, commits, deployment, or packaging changes were made
  for this task.

### Discoveries And Limits

- Subsequent scans exclude gifts without any usable image URL, preventing
  repeat download toasts for entries that cannot be downloaded. Persisted
  completion counts still cover the full catalog.
- Artwork events update open global-search results and decorate future rule
  renders without changing rule settings or room membership.
- The server must publish a new catalog snapshot; this client change does not
  implement server publication or deployment. Changed image bytes need a changed
  source URL or validated server image URL. Overwriting bytes behind unchanged
  URLs is not detectable.
- Catalog metadata includes gift IDs, names, prices, types, and image URLs,
  not executable code. Blind-box mappings remain independent and unchanged.
- Real Bilibili downloads, production server capacity, and packaged Electron
  behavior were not tested.

## Failure Handling

Network failure keeps the last catalog and image mapping; retry on next launch,
scheduled check, or existing explicit retry. Do not delete old cache files.
Runtime stop clears the timer and suppresses late update notifications.
Reverse only task-owned hunks if needed; no blanket rollback or commits.

## Done When

Startup and 12-hour checks are verified; unchanged checks download no images;
changed/missing images recover without a catalog-version change; old images
survive replacement failures and restart; no CDN outage causes server fallback;
visible artwork updates without reload; progress toast stays quiet otherwise;
blind-box configuration/history remain untouched; tests and final diff pass.
