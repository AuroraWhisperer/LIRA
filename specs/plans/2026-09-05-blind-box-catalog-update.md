# Blind Box Catalog Update Implementation Plan

> **For agentic workers:** Execute the checked milestones in order. This task is implemented inline because no separate execution skill is available; do not commit unless the user asks.

**Goal:** Publish one versioned official gift-and-blind-box package, combine it with tenant-private ID-based custom mappings for server-authoritative detection, and let the Electron client update metadata, artwork, settings, and blind-box presentation without rewriting historical events.

**Architecture:** `lira-server` owns the immutable official v2 catalog and computes each streamer's effective mapping from that snapshot plus a separately persisted custom layer. A gift group freezes the resolved blind-box identity and amount basis when it is created; the ledger and Device DTO carry an optional stable `blindBoxId`. `Live` caches a validated v2 snapshot atomically, continues to consume server-processed events, and uses the snapshot only for read-only catalog/UI behavior.

**Tech Stack:** Node.js 24+, CommonJS server modules, Electron 43 main process, vanilla ES modules, native CSS, SQLite, `node:test`, OpenAPI JSON.

## Global Constraints

- Keep `GET /api/public/gifts/catalog` v1 compatible; v2 is selected only by `?schemaVersion=2`.
- Keep official mappings public and read-only; never include `streamerId`, credentials, or tenant-private custom mappings in the public package.
- Keep `giftBlindBoxConfig` as the legacy optional setting and add `giftBlindBoxCustomConfigV2` without changing the old field's meaning.
- Missing `giftBlindBoxCustomConfigV2` means no v2 write; an explicit empty array clears only the tenant custom layer.
- Do not enable the local client gift detector or send remote events through it.
- Do not recalculate or rewrite historical gift facts, overtime rules, cursors, source partitions, or settled results.
- A catalog relation is only a possible parent; it cannot turn an ordinary gift packet into a blind-box event.
- Gold catalog metadata accepts `priceRaw >= 0`; paid event eligibility remains `totalPrice > 0`.
- Heart and lucky themes remain unchanged; all other confirmed blind boxes use the default purple gradient.

---

## Non-goals

- No server-side recent-gifts UI, remote public-catalog push channel, mapping admin console, or new image delivery pipeline.
- No award ID to gift ID conversion, Super Chat changes, zero-value gift accounting, historical replay, or automatic migration of ambiguous legacy name mappings.
- No new framework, service, process, or runtime dependency.

## Current Behavior

- The public flat catalog is v1-only and memoized by the latest successful gift sync run ID.
- Official ID relations are used by public detail pages, while detection reads a tenant name-based `giftBlindBoxConfig` map whose duplicate output names overwrite one another.
- The Electron cache drops blind-box fields and filters out zero-priced gold metadata.
- Remote event DTOs and ledger rows preserve only a blind-box name, cost, and profit.
- Recent-gift presentation enumerates five box names/classes and has no stable box ID.

## Ownership

- Official package owner: `D:/Work/lira-server/src/modules/gifts/blind-box-catalog.js` and `gift-catalog-queries.js`; HTTP orchestration: `src/routes/gifts-public.js`.
- Tenant custom settings owner: `D:/Work/lira-server/src/lib/gift-blind-box-config.js` and `src/modules/streamer/cloud-state.js`.
- Runtime detection and group lifetime owner: `D:/Work/lira-server/src/modules/bilibili/gift-parser.js`, `gift-detector.js`, and tenant `gift_events` storage.
- Device projection contract owner: `D:/Work/lira-server/src/lib/gift-history-contract.js`, `src/modules/bilibili/gift-event-service.js`, and `gift-history-service.js`.
- Client package/cache owner: `D:/Work/Live/src/bilibili/gift/remote-catalog-cache.js`, `gift-catalog-initializer.js`, and `hybrid-catalog.js`.
- Client private setting and display consumers: `D:/Work/Live/src/electron/cloud-sync-controller.js`, `public/js/admin/settings-blindbox.js`, `public/js/admin/gifts/recent.js`, overtime catalog consumers, analysis/overlay consumers, and related CSS.

## Compatibility Constraints

- Preserve v1 response shape, caching headers, old client behavior, and the ability of a v2 client to retain its previous verified package when a server lacks or rejects v2.
- Preserve DeviceBearer tenant resolution, cloud revision semantics, field-size limits, last-successful full-scope write behavior, and old-client writes that do not know the new optional field.
- Preserve `safeStorage`, renderer isolation, HTTPS/DNS origin validation, `local-media://` checks, and image host allow-lists.
- Evolve tenant SQLite through an idempotent migration; old rows keep a null `blind_box_id`.
- Preserve progress/final identity, delivery cursors, bootstrap recovery, and exactly-once downstream settlement behavior.

## Milestone 1: Accept And Lock The Wire Contracts

**Files:**

- Modify server normative requirements, acceptance criteria, traceability, client protocol, public/device OpenAPI, and protocol fixtures.
- Modify client gift catalog and server-authoritative gift design documents.
- Create an accepted server ADR for the official/private mapping split and group-frozen event facts.

- [x] Specify v1/v2 public responses, deterministic v2 version content, validation limits, `blindBoxes`, `isBlindBox`, and zero-price metadata.
- [x] Specify `giftBlindBoxCustomConfigV2`, takeover/migration status, mapping-state metadata, and missing-versus-empty semantics.
- [x] Specify nullable `blindBoxId` in realtime, pull, bootstrap, and history DTOs.
- [x] Add exact fixtures for same-name/different-ID outputs, multi-parent outputs, missing optional settings, explicit empty settings, and old history.
- [x] Verify with server contract/governance tests and JSON parsing.

## Milestone 2: Publish The Official V2 Snapshot

**Files:**

- Modify `D:/Work/lira-server/src/modules/gifts/blind-box-catalog.js` to expose normalized string-ID relations and validation helpers.
- Modify `D:/Work/lira-server/src/modules/gifts/gift-catalog-queries.js` to build an all-or-nothing v2 package and hash deterministic business content.
- Modify `D:/Work/lira-server/src/routes/gifts-public.js` to validate `schemaVersion` and keep separate v1/v2 ETags.
- Modify focused catalog and public-route tests.

- [x] Add failing tests showing a relation-only change affects v2 version/ETag and that v1 remains unchanged.
- [x] Add failing tests for duplicate IDs, missing relation references, historical inactive relation records, and zero-price gold metadata.
- [x] Build the validated snapshot from canonical rows plus verified relation references, sorting all arrays deterministically.
- [x] Keep v1 memoization by run ID and memoize v2 by its content digest.
- [x] Run catalog service, route, OpenAPI, and contract tests.

## Milestone 3: Persist Private V2 Mappings And Detect With The Effective Map

**Files:**

- Modify `D:/Work/lira-server/src/lib/gift-blind-box-config.js`, `streamer-sync-settings.js`, `src/modules/streamer/cloud-state.js`, `src/modules/device/cloud-sync.js`, `src/modules/bilibili/monitor-manager.js`, `gift-parser.js`, and `gift-detector.js`.
- Modify tenant storage only where takeover/migration state cannot be represented by the existing settings table.
- Modify cloud-state, parser, detector, and tenant-isolation tests.

- [x] Define and test canonical decimal IDs, NFC names, control-character rejection, size/price limits, duplicate-name rejection, official-name takeover, and official-ID collision rejection.
- [x] Preserve unsubmitted or ambiguous legacy mappings as migration state; do not switch a tenant to v2 until its state is confirmed.
- [x] Return read-only `{mode, catalogVersion, settingsRevision}` mapping state from authenticated cloud-state.
- [x] Parse a verified source box ID into `blindBoxId` without treating a relation-only match as proof of a blind-box event.
- [x] Resolve confirmed events in priority order: source ID, source name among candidate parents, unique parent ID, otherwise unknown source/cost.
- [x] Freeze the resolved source and catalog/settings basis on first insertion; progress updates only merge actual count/amount.
- [x] Prefer valid event amounts and costs; use mapped catalog amounts only for missing values on an identified source.
- [x] Run cloud-state, parser, detector, reconnect/recovery, and tenant-isolation tests.

## Milestone 4: Carry `blindBoxId` Through Ledger And Device Projection

**Files:**

- Modify `D:/Work/lira-server/src/storage/streamer-storage.js`, storage documentation, history contract, event/history services, Device OpenAPI/fixtures, and tests.
- Modify `D:/Work/Live/src/electron/remote-gift-controller.js`, processed-event import/storage projection, and related fixtures/tests.

- [x] Add an idempotent nullable `blind_box_id` migration and prove existing rows remain readable and unchanged.
- [x] Insert/update the ID only while a group is first established; preserve it through finalization and recovery.
- [x] Add nullable `blindBoxId` to every server DTO projection and reject invalid IDs.
- [x] Add the field to client main-process normalization and local projection without allowing renderer identity input.
- [x] Verify realtime, cursor pull, bootstrap, old history, duplicate final, and rebuild paths.

## Milestone 5: Cache And Apply The V2 Package In Electron

**Files:**

- Modify `D:/Work/Live/src/bilibili/gift/remote-catalog-cache.js`, `gift-catalog-initializer.js`, `hybrid-catalog.js`, main-process fetch composition, and focused tests.

- [x] Request `schemaVersion=2`, require `schemaVersion: 2` and a present valid `blindBoxes` array, and retain the previous v2 package on invalid/unsupported responses.
- [x] Accept known gold `priceRaw === 0` metadata without broadening paid-event handling.
- [x] Normalize, persist, clone, fingerprint, and atomically switch gifts plus official relations together.
- [x] Keep v1 and v2 completion/cache state distinct while reusing already current image files.
- [x] Emit one semantic update for a relation-only change and continue image repair after a 304.
- [x] Run remote-cache, initializer, background-update, image-cache, Electron bridge, and license bootstrap tests.

## Milestone 6: Edit Private Mappings And Update All Client Consumers

**Files:**

- Modify `D:/Work/Live/src/electron/cloud-sync-controller.js`, settings contract/bridge, `public/js/admin/settings-blindbox.js`, recent-gift rendering/CSS, room gift expansion, overtime catalog, blind-box analysis/OBS consumers, and focused tests.

- [x] Keep official mappings read-only and submit only `giftBlindBoxCustomConfigV2`; show saved/effective state only after server confirmation.
- [x] Preserve dirty drafts across refresh/failure and expose takeover or migration-pending records without reactivating them.
- [x] Expand room candidates only from a room-present box ID, dedupe by gift ID, and retain independently present gifts and overtime rules.
- [x] Replace fixed box-type gates with stable ID/name theme selection: heart and lucky retain current themes, all other confirmed/unknown blind-box events use the purple default.
- [x] Ensure relation metadata alone does not style or settle an ordinary gift event.
- [x] Use the official box gift ID to resolve recent-gift artwork and refresh on catalog updates.
- [x] Run frontend gifts, analysis, overtime, overlay, cloud sync, and processed-event tests; inspect the Electron screen for the affected card/settings surfaces.

## Milestone 7: Final Compatibility And Safety Gate

- [x] Run the focused server suites accumulated above, documentation governance, architecture governance, and security boundary tests.
- [x] Run the focused client suites accumulated above plus `git diff --check` in both repositories.
- [x] Inspect both diffs/statuses and confirm no user files, generated data, secrets, runtime cache, or unrelated changes were added.
- [x] Record exact verification results and any accepted limitation in this plan.

## Rollback Or Failure Handling

- Keep v1 and the last successful v2 package available throughout rollout; a failed v2 build/read leaves the previous validated package active.
- A failed private mapping write leaves the previous settings revision and detector mode active.
- A failed client write leaves the previous on-disk and in-memory v2 snapshot active; image failures keep old files/placeholders.
- To reverse task-owned work, inspect the path-limited diff and apply inverse patches only to lines introduced by this task. Do not reset, blanket-checkout, or delete the existing dirty worktrees.

## Done When

- Every report acceptance item has a corresponding passing focused test or an explicitly documented manual verification.
- v1 clients and old history remain readable; v2 clients receive and atomically apply official ID relations.
- Server detection demonstrably uses the effective tenant map for new groups, carries `blindBoxId`, and never reclassifies ordinary events from catalog possibility alone.
- Private mappings remain tenant-isolated, official mappings remain public/read-only, and takeover/migration state is server-owned.
- Electron shows correct artwork, identity, profit semantics, room-scoped candidates, and theme behavior without enabling local gift detection.
- Both repository diffs pass whitespace checks and final scope review.

## Progress And Verification Log

- 2026-09-05: Report accepted by user with the instruction to begin execution. Initial ownership and compatibility review completed; no implementation checks run yet.
- 2026-09-05: Milestones 1-6 implemented across `lira-server` and `Live`: public catalog v2 negotiation and deterministic business versions, official/private ID mappings and migration state, evidence-only detection with a frozen group basis, nullable `blindBoxId`, Electron v2 atomic caching, exact-ID room expansion, and read-only official mapping/recent-gift UI behavior.
- 2026-09-05: Added the append-only `Live` gift database v9 migration for nullable `gift_events.blind_box_id`; the v8-to-v9 regression and processed projection suites preserve old rows with `NULL` IDs.
- 2026-09-05: Server verification passed: 96/96 catalog, cloud-state, parser/detector, history/device API, OpenAPI, and governance tests; 19/19 management history/API/governance tests; 5/5 fixture/history checks; and 2/2 public OpenAPI contract checks.
- 2026-09-05: Client verification passed: 209/209 focused catalog/cache, cloud mapping, processed-event, analysis, overtime, overlay, and frontend tests. The final stale overtime route fixture was updated for `active` and `isBlindBox`; its focused rerun passed 8/8.
- 2026-09-05: Client final gates passed: JavaScript syntax check for 564 files, documentation governance 5/5, Electron URL/local-media/log-redaction plus ESM boundaries 37/37, and architecture/module boundaries 12/12. The earlier unrelated module-boundary failure no longer reproduced in the final worktree.
- 2026-09-05: Electron QA used an isolated temporary data directory and v2 fixture. At the as-launched 1441x900 window, official entries rendered without delete controls, a custom entry saved with the only delete control, dirty JSON survived state refresh and a simulated HTTP 503, and invalid JSON remained editable with a visible error. Recent cards selected exact-ID artwork and the heart, lucky, and default-purple computed themes; no page or console errors occurred.
- 2026-09-05: The deterministic 1009x617 renderer viewport check (the content area corresponding to the 1024x680 minimum window) had no horizontal document overflow; all recent cards, mapping inputs, chips, textarea, and save control stayed within their owning regions. Screenshot capture succeeded, but this model could not render the captured pixels for subjective aesthetic review, so signoff is limited to functional interaction, decoded-artwork, computed-style, and geometry evidence.
- 2026-09-05: `git diff --check` and `git diff --cached --check` passed in both repositories. Both worktrees were already heavily dirty; final review preserved unrelated staged/unstaged changes and found no task-created secret, runtime cache, user data, or retained QA artifact.
