# Local Paid Gift Catalog Bootstrap Implementation Plan

> Do not create commits. Preserve unrelated worktree changes in both the client
> and `D:/Work/lira-server` repositories.

## Goal

Implement the accepted one-time post-authorization initialization card and a
paid global gift mirror whose metadata and images support local-only lookup.

## Non-goals

- Personal backpack synchronization, static gift assets, or gift settlement
  changes.
- Broad login, cloud-sync, or catalog-service refactors.

## Current Behavior

The server client catalog exposes only its same-origin cached image path. The
client persists metadata but downloads images only on room/search demand. Both
the renderer and main process navigate immediately on authorization, and recent
gift artwork reads only the current-room response.

## Ownership

- Server wire model: `D:/Work/lira-server/src/modules/gifts/` and
  `docs/protocol/public-gifts-api.openapi.json`.
- Client metadata/assets: `src/bilibili/gift/`.
- Authorization navigation and IPC: `src/electron/main.js`, `preload.js`, and
  `ipc/license-ipc.js`.
- UI and consumers: `public/pages/license.html`, `public/js/license.js`,
  `public/css/license.css`, `public/js/admin/overtime.js`, and
  `public/js/admin/gifts/recent.js`.

## Compatibility Constraints

- Preserve context isolation, local session gating, safe storage, configured
  remote origin validation, and token boundaries.
- Preserve current-room gift membership and exact-ID behavior.
- Preserve unrelated modified files, especially build-integrity work.
- Never replace a valid local snapshot with a failed/empty refresh.

## Proposed Changes And Milestones

### 1. Public source URL contract

- [x] Add nullable validated `sourceUrl` to the flat server catalog query,
  requirements, OpenAPI, and contract tests.
- [x] Verify with focused server catalog and route tests.

### 2. Shared paid catalog initializer

- [x] Filter normalized persistence to positive-price gold gifts.
- [x] Extend the image cache for trusted Bilibili URLs, exact local mapping,
  progress, reuse, partial failures, and server fallback.
- [x] Add the versioned initialization state and shared CLI entry point.
- [x] Verify catalog, image-cache, initializer, and script tests.

### 3. Electron first-entry gate

- [x] Expose narrow initialization state/retry IPC without remote credentials.
- [x] Make main process the only Admin navigation owner.
- [x] Show catalog/image progress, retry, and partial-failure states in the
  centered license-page card.
- [x] Verify license IPC, UI, startup, and lifecycle tests.

### 4. Local global consumers

- [x] Expose a read-only global local catalog endpoint and make the old server
  search route a compatibility alias.
- [x] Switch Admin global search and recent/high-value artwork to local data.
- [x] Resolve room, blind-box, and persisted-rule artwork by exact ID.
- [x] Verify overtime routes, services, and frontend tests.

### 5. Documentation and packaging

- [x] Update architecture maps, design status/evidence, and build documentation.
- [x] Run client/server focused checks, `git diff --check`, and status review.
- [x] Build and inspect a fresh Windows artifact for removed static assets.
- [x] Move this plan to `specs/plans/archive/` only after all evidence passes.

## Verification

- Server: `node --test test/gift-client-catalog.test.js test/gift-public-routes.test.js test/public-gift-catalog-contract.test.js`.
- Client catalog: `node --test test/remote-catalog-cache.test.js test/remote-gift-image-cache.test.js test/gift-catalog-initializer.test.js test/remote-overtime-catalog.test.js test/overtime-routes.test.js`.
- Client UI/lifecycle: `node --test test/license-ui.test.js test/license-gate.test.js test/license-ipc.test.js test/frontend-gifts.test.js test/frontend-queue.test.js`.
- Static/final: `npm run check`, justified architecture checks,
  `git diff --check`, and `git status --short` in both repositories.

## Rollback Or Failure Handling

Stop on a protocol conflict or security regression. Reverse only task-owned
hunks with `apply_patch`; never reset either dirty repository. Failed downloads
leave valid files and the previous catalog intact. A failed first catalog fetch
without a local snapshot remains retryable on the initialization page.

## Done When

All acceptance criteria in `specs/local-gift-catalog-bootstrap_design.md` have
runtime/test evidence, both repository diffs are scoped and clean of generated
or sensitive data, and a newly built installer contains no removed static gift
assets.
