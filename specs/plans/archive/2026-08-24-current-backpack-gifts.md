# Dynamic Current Backpack Gifts Implementation Plan

**Goal:** Make the overtime gift refresh include any number of gifts that the logged-in Bilibili account can currently send from its backpack, without scanning historical `bag_gift` metadata.

**Architecture:** `src/bilibili/gift/sale-catalog.js` requests the authenticated `bag_list` endpoint only when a Bilibili Cookie is available. It unions current positive, unexpired, room-compatible backpack IDs with panel and configured blind-box IDs. Electron authentication is passed through the server composition root; unauthenticated refreshes keep their existing panel-only behavior.

## Constraints

- Do not hardcode backpack gift IDs or a gift count.
- Do not enumerate `giftConfig` entries by `bag_gift`; it contains historical gifts.
- Do not expose or persist the Cookie through this feature.
- Preserve panel count, blind-box expansion, cache behavior, API shape, and local image lookup.

## Completed Work

- [x] Add a regression test for arbitrary current backpack IDs and exclude zero-quantity, expired, and other-room entries.
- [x] Add authenticated real-time backpack collection to the gift catalog owner.
- [x] Pass the Electron Bilibili Cookie provider through the server composition root.
- [x] Update the accepted specification from a five-ID allowlist to dynamic current-backpack behavior.
- [x] Run focused catalog, route, and overtime verification and review the final diff.

## Verification Results

- Confirmed the dynamic backpack tests failed before the collector and authentication wiring existed.
- `node --test test/gift-sale-catalog.test.js test/overtime-routes.test.js test/overtime-service.test.js` passed 30/30 tests, including Cookie forwarding and a previously unknown backpack gift ID.
- `npm run check` passed.
