# Transparent gift total implementation plan

Status: Complete, 2026-09-19. Source changes verified; no deployment performed.

**Goal:** In the transparent danmaku style, place the quantity beside the gift name and show the finalized gift's total RMB amount in the former quantity position.

**Architecture:** Extend the existing gift display projection with optional `giftTotalPrice` in RMB. The transparent style requests the amount layout through the existing feed/renderer options; the other styles keep their quantity layout.

**Tech Stack:** Existing CommonJS backend, ES module frontend, native CSS, Node test runner.

## Requirements and boundaries

- Current explicit user request authorizes showing the total amount. Existing text excluding all amounts must be updated with this narrowly scoped exception.
- Amount comes from finalized `total_price` locally and `event.gift.totalPrice` on the server. Do not multiply the already-total amount by quantity or query the current gift catalog.
- Preserve existing message types, authorization, tenant selection, gift settlement, persistence, and replay behavior. No deployment, commits, dependencies, or data changes.
- Other styles, ordinary chat, and the preceding 1.5× gift-card changes remain intact.
- Older messages may omit the amount; display `—`, never a fabricated zero or a quantity labeled as money.

## Current behavior and owners

- Client `src/bilibili/danmaku/feed-buffer.js` builds gift items; `src/server/overlay-projection.js` selects HTTP/WS display fields.
- Server `src/lib/bilibili-danmaku.js` builds the existing `gift` event; `public/overlay/app.js` normalizes it for the renderer.
- Client `public/js/overlays/` and server `public/overlay/` each own their feed and renderer. Their transparent CSS files own this layout.
- Client preview is synthetic. Formal OBS uses the server. Both need the same amount behavior.
- Server ADR-0058 excludes amounts. Add a successor decision limited to the display total and update REQ-BILI-006, AC-BILI-005, public-overlay protocol/schema/fixture, and relevant architecture text.

## Milestones

- [x] Add focused regression coverage for finalized totals, public projection, quantity/amount placement, old-message fallback, and style isolation. The new assertions failed before implementation.
- [x] Add optional numeric `giftTotalPrice`, copied from the finalized total. Add `showGiftTotal: style === 'transparent'` at each composition root and pass it through the feed to the renderer. Render the amount with a yen prefix and at most two fractional digits; append quantity beside the gift name.
- [x] Add transparent-only amount styling and a total to the client sample; update the owning contracts and ADR without changing the accepted historical ADR text.
- [x] Run directly affected tests, contract/documentation gates, and source preview inspection; archive this plan with verification limits below.

## Verification results

- Regression-first runs failed on missing amount projection, missing layout, and the old strict GiftEvent schema as expected.
- Client focused tests: 28 passed. Server focused tests: 35 passed; the separate renderer regression also passed. Decimal totals, missing totals, quantity placement, all nine style configurations, public field isolation, and finalized combo totals are covered.
- Current-source browser inspection: transparent gift shows `小花花 × 10` with `¥1` at the right; DOM measurements confirm quantity beside the name, amount to the right and inside the card, and retained 1.5× zoom. The synthetic total is 1 RMB for ten gifts, with no second multiplication.
- Client documentation gate passed. Architecture gate: 21 passed, one repository-size gate failed on unrelated `danmaku-tool.css` (603 lines), `usage-guide.css` (798/760), `queue-theme.html` (642/610), and `remote-license-client.js` (623/617).
- Server docs gate: 33 passed, one Device route-inventory gate failed because concurrent overlay-filter/viewer route work was not yet reflected in Device OpenAPI. This task does not edit those routes or the Device schema.
- Impeccable detector returned no findings. No full test suite, deployment, live message, or real-user-data test was run.

## Verification

Client:

```powershell
node --experimental-vm-modules --test test/danmaku-feed-buffer.test.js test/overlay-projection.test.js test/danmaku-overlay-renderer.test.js test/danmaku-local-preview.test.js test/danmaku-overlay.test.js test/danmaku-style-ownership.test.js
npm run verify:docs
npm run verify:architecture
```

Server:

```powershell
node --require ./test/support/test-mode.cjs --test test/overlay-gift.test.js test/overlay-preview.test.js test/overlay-protocol-contract.test.js test/overlay-public-sse.test.js test/overlay-static.test.js
npm run docs:check
```

Verify a synthetic total of 12.5 displays as `¥12.5`, quantity remains `× 10`, and no second multiplication occurs. Check the transparent layout and one unaffected style with current source assets. All checks use synthetic or isolated test data.

## Failure handling and done condition

If a check fails, fix only the affected behavior or report a verified pre-existing blocker. Rollback only task-owned patches, preserving all other working changes. Done when both producers/consumers agree on units, current source displays the requested arrangement, focused verification passes, and the reviewed diff contains no generated/runtime or sensitive files.
