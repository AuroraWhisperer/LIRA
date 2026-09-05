# Server-backed Gift Artwork Implementation Plan

> **For agentic workers:** Execute this plan task-by-task and keep the checkboxes current. Do not create commits unless the user explicitly requests one.

**Goal:** Remove the packaged Bilibili gift artwork catalog and personal-backpack expansion while keeping the overtime picker scoped to the configured room and resolving artwork by exact gift ID from LIRA Server.

**Architecture:** The room sale service remains the owner of live Bilibili panel IDs and configured blind-box expansion. The hybrid catalog joins that room-scoped snapshot to the already authenticated, normalized server catalog by exact ID and reuses the existing validated runtime image cache; no Markdown, manifest, or bundled gift image remains a runtime dependency.

**Tech Stack:** Node.js 24 CommonJS, Electron 43, vanilla JavaScript, node:test, electron-builder.

## Global Constraints

- Preserve the current-room meaning and response shape of `GET /api/overtime/gifts` and `POST /api/overtime/gifts/refresh`.
- Preserve exact gift IDs when names collide; never join artwork by name.
- Preserve session-token protection, configured HTTPS server-origin validation, image path/size/signature validation, and OBS same-origin image delivery.
- Preserve existing overtime rules and replace obsolete `/img/bilibili-gifts/...` artwork by gift ID when a server-backed image is available.
- Do not add a process, service, framework, dependency, schema migration, or client-supplied URL.
- Do not touch the user's unrelated build-integrity worktree changes.

---

## Goal

New source archives and installers contain no `public/img/bilibili-gifts/` tree or `public/img/bilibili-gifts.json`. Refresh requests only the Bilibili room panel/config endpoints, expands configured in-sale blind boxes, and decorates those exact IDs with server artwork.

## Non-goals

- Changing gift settlement, blind-box event detection, global server synchronization, license authorization, or OBS routes.
- Removing the on-demand `data/overtime-gift-images/` cache, which is outside source/install packages and provides validated same-origin images for Electron and OBS.
- Retrofitting already-built installer executables; verification uses a newly built artifact.

## Current Behavior

- `sale-catalog.js` requests `giftData`, `giftConfig`, and authenticated `bag_list`, then requires three Markdown files for image mapping.
- `hybrid-catalog.js` uses the server catalog only for explicit global search, not for current-room artwork.
- `public/js/admin/gifts/recent.js` reads the bundled JSON manifest and hardcodes five bundled blind-box image paths.
- `package.json` includes all of `public/**/*`, so roughly 56 MB of gift assets enter `app.asar`.

## Ownership

- Room membership: `src/bilibili/gift/sale-catalog.js` and `sale-catalog-parser.js`.
- Server metadata/artwork join: `src/bilibili/gift/hybrid-catalog.js`, `remote-catalog-cache.js`, and `remote-gift-image-cache.js`.
- Composition and rule image resolution: `src/server/domain-services.js` and `src/overtime/overtime-service.js`.
- Admin consumers: `public/js/admin/overtime.js` and `public/js/admin/gifts/recent.js`.
- Contracts: `specs/overtime-gift-sale-refresh_design.md`, `specs/remote-gift-catalog-sync_design.md`, and architecture fact-map documents.

## Compatibility Constraints

- Unknown or temporarily missing server artwork degrades to the existing placeholder without dropping a room gift.
- A remote-catalog failure retains the previous normalized cache; room refresh remains usable without artwork.
- `/api/overtime/gifts/local/search` remains registered but searches the locally persisted server catalog instead of removed Markdown files.
- Existing guard artwork stays bundled because it is outside the Bilibili gift cache.

## Milestone 1: Remove local mapping and backpack ownership

**Files:**

- Modify: `src/bilibili/gift/sale-catalog.js`
- Modify: `src/bilibili/gift/sale-catalog-parser.js`
- Modify: `src/server/domain-services.js`
- Modify: `src/server.js`
- Test: `test/gift-sale-catalog.test.js`

**Interfaces:**

- `createGiftSaleCatalogService({ dataDir, getRoomId, getBlindBoxConfig, fetchJson })` returns the existing room snapshot shape.
- `buildGiftCatalog(saleIds, configById)` emits gifts with an empty `imagePath` pending server decoration.

- [x] Remove `bag_list`, Cookie, Markdown parsing, filesystem image checks, and their exports.
- [x] Keep panel ID collection, excluded IDs, Bilibili config parsing, and price-aware blind-box expansion unchanged.
- [x] Update focused tests to assert only `gift_data` and `gift_config` are requested and same-name/different-ID blind-box outputs remain correct.
- [x] Run `node --test test/gift-sale-catalog.test.js` and expect all tests to pass.

## Milestone 2: Join room gifts to server artwork by ID

**Files:**

- Modify: `src/bilibili/gift/hybrid-catalog.js`
- Modify: `src/bilibili/gift/remote-gift-image-cache.js`
- Modify: `src/overtime/overtime-effects.js`
- Modify: `src/overtime/overtime-service.js`
- Test: `test/remote-overtime-catalog.test.js`
- Test: `test/overtime-service.test.js`

**Interfaces:**

- `mergeRoomCatalog(roomSnapshot, serverSnapshot)` copies only the exact-ID server `imagePath` into room gifts.
- `refresh()` refreshes room membership, obtains current/cached server metadata, caches matching artwork, and returns the room snapshot shape.
- `searchLocal()` filters the persisted server snapshot without a remote request; `searchRemote()` preserves forced conditional refresh.

- [x] Add exact-ID joining and per-gift image-cache fallback without making remote failure fatal to room refresh.
- [x] Resolve already cached image basenames synchronously for startup snapshots.
- [x] Treat legacy `/img/bilibili-gifts/...` rule artwork as replaceable by `resolveGiftImagePath(giftId)` while leaving the rule itself intact.
- [x] Run `node --test test/remote-overtime-catalog.test.js test/remote-gift-image-cache.test.js test/overtime-service.test.js` and expect all tests to pass.

## Milestone 3: Remove bundled consumers and assets

**Files:**

- Modify: `public/js/admin/gifts/recent.js`
- Modify: `package.json`
- Delete: `public/img/bilibili-gifts/`
- Delete: `public/img/bilibili-gifts.json`
- Modify: `scripts/refresh-bilibili-gift-sale.js`
- Delete: `scripts/sync-bilibili-backpack-gifts.js`
- Delete: `test/bilibili-gift-catalog.test.js`
- Test: `test/frontend-gifts.test.js`
- Test: `test/frontend-queue.test.js`

**Interfaces:**

- `loadGiftArtworkCatalog()` reads `GET /api/overtime/gifts` and maps validated returned `imagePath` values by gift ID.
- Blind-box chips retain their names/classes and use server-backed artwork for their fixed box IDs when present.

- [x] Replace manifest loading and hardcoded blind-box paths with the room catalog response.
- [x] Remove the obsolete backpack asset-maintenance command, keep the room-refresh diagnostic free of `publicDir`, and explicitly exclude the old asset paths from future packages.
- [x] Delete only the tracked obsolete scripts, manifest, mapping documents, and artwork tree after reference scans are clean.
- [x] Update frontend tests and run `node --test test/frontend-gifts.test.js test/frontend-queue.test.js test/overtime-routes.test.js`.

## Milestone 4: Contracts, packaging, and final verification

**Files:**

- Modify: `specs/overtime-gift-sale-refresh_design.md`
- Modify: `specs/remote-gift-catalog-sync_design.md`
- Modify: `specs/qixi-que-box-default_design.md`
- Modify: `docs/architecture/backend/overtime.md`
- Modify: `docs/architecture/backend/api.md`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/frontend/pages.md`
- Modify: `docs/architecture/engineering/build.md`
- Modify: `specs/README.md`

- [x] Update normative behavior, endpoint descriptions, asset ownership, and build documentation.
- [x] Run focused catalog, overtime, frontend, architecture, and packaging tests.
- [x] Run `npm run check`, justified architecture checks, and `git diff --check`.
- [x] Build a fresh Windows package and inspect `app.asar`/`win-unpacked` to confirm neither obsolete asset path is present.
- [x] Inspect `git status --short`, confirm unrelated user changes remain untouched, then move this completed plan to `specs/plans/archive/`.

## Rollback Or Failure Handling

Stop before deleting assets if any runtime consumer still references `/img/bilibili-gifts`. If a focused test fails, inspect and reverse only task-owned hunks with `apply_patch`; never use a destructive reset or blanket checkout. A remote outage must leave the last server metadata/image cache usable and must not overwrite the last room snapshot.

## Done When

- Personal backpack gifts are not requested or added.
- Current-room panel and configured blind-box entries remain, including exact-ID handling for duplicate names.
- Room, server-search, recent-gift, rule, and OBS image consumers use server-backed cached artwork or the placeholder.
- The old Markdown/JSON/image resources and maintenance scripts are gone and explicitly excluded from future packages.
- Focused and risk-based verification passes, a fresh package contains no old gift assets, documentation matches runtime, and the final diff contains no unrelated/generated/sensitive material.
