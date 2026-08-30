# Bilibili Guard Gift Accounting Hardening Implementation Plan

> **For agentic workers:** Execute this plan inline in the current task. Do not create commits unless the user explicitly requests them.

**Goal:** Keep a multi-month guard purchase as one gift event while preventing Bilibili companion toast messages and non-month promotional units from inflating cards or quantity-based settlement.

**Architecture:** Preserve the existing `packet -> parser -> MessageHandlers -> gift detection ledger -> snapshot` flow. Put protocol-specific source and unit interpretation in the Bilibili gift parser, keep the gift ledger schema unchanged, and reuse the existing guard-name normalizer when verified purchases update the room identity cache.

**Tech Stack:** Node.js 24+, CommonJS backend modules, `node:test`, SQLite `DatabaseSync`, Vanilla JavaScript admin renderer.

## Global Constraints

- Preserve the modular monolith, CommonJS backend style, public gift snapshot fields, database schema, and persisted rows.
- Continue ignoring `GUARD_BUY` for paid gift accounting; `USER_TOAST_MSG(_V2)` remains the Web source of paid order totals.
- Keep one database row and one recent-gift card per accepted purchase order.
- Do not add dependencies or touch unrelated dirty files.
- Do not create commits.

---

## Goal

Align LIRA's guard accounting with the current Bilibili Open Platform field contract and the actively maintained `xfgryujk/blivedm` handling pattern: filter the V2 companion message with `option.source = 2`, count `num` as months only when the unit is absent or month-based, and retain exact order-total accounting.

## Non-goals

- Add a separate aggregate for unique buyers, purchase events, or total guard months.
- Add a new persisted `guard_unit` column or change existing API/WS response shapes.
- Rework ordinary gift combo deduplication or historical gift records.
- Change card layout, styling, or wording.

## Current Behavior

- `GUARD_BUY` is ignored and toast order totals are stored once by platform identity.
- Month purchases preserve `num`, so a three-month captain is rendered as one `舰长 x3` card.
- V2 `option.source` is currently ignored, allowing the observed companion `source=2` message to reach fallback identity deduplication.
- `pay_info.unit` and `guard_unit` are currently ignored, so a non-month promotion can be treated as several months.
- `normalizeGuardLevelFromGift` reverses captain/governor when it must fall back from a numeric Web gift ID to the Chinese gift name.

## Ownership

- Owner: `src/bilibili/parsers/gift-parser.js`, `src/bilibili/danmaku/message-handlers.js`.
- Contract: `docs/architecture/backend/bilibili/protocol.md`.
- Consumers: `src/bilibili/gift/detection-service.js`, `src/overtime/overtime-service.js`, `public/js/admin/gifts/recent.js`.
- Focused tests: `test/guard-gift.test.js`.

## Compatibility Constraints

- Missing unit fields remain compatible and continue to treat `num` as the quantity/month count.
- Monthly values such as `月` continue to preserve 3/6/12-month quantities.
- Non-month unit strings use settlement quantity `1`; the authoritative order price remains unchanged.
- Distinct paid `payflow_id` values remain distinct purchase events.
- Legacy and V2 paid toast variants with the same platform identity remain one event.

## Proposed Changes

- Add a small parser predicate for V2 companion toast messages and use it before parsing/logging.
- Normalize Web and Open Platform guard quantities with the unit field.
- Reuse `detectGuardLevelFromName` for room-identity ingestion.
- Expand the focused guard regression to cover source filtering, unit handling, one-card snapshots, and correct identity levels.
- Update the protocol owner document with the source/unit rules.

### Task 1: Lock Protocol Behavior With Focused Regressions

**Files:**

- Modify: `test/guard-gift.test.js`

**Interfaces:**

- Consumes: `packetParser.extractBilibiliGiftMessage(packet)`, `createGiftService(context)`, `MessageHandlers.handleGift(packet)`.
- Produces: regression expectations for `source`, `unit`, snapshot cardinality, and room identity.

- [x] Add a season-captain case that feeds one paid V2 toast and its `source=2` companion, then asserts `service.getSnapshot().recent` has exactly one row with `num === 3` and the paid total.
- [x] Add Web and Open Platform non-month unit cases that assert the accounting quantity is `1` while the paid total is preserved.
- [x] Add a MessageHandlers case where numeric gift ID `10003` and name `舰长` ingest verified `guardLevel === 3`.
- [x] Run `node --test test/guard-gift.test.js`; the three new assertions failed before implementation and the four existing assertions passed.

### Task 2: Implement Source, Unit, And Identity Rules

**Files:**

- Modify: `src/bilibili/parsers/gift-parser.js`
- Modify: `src/bilibili/packet-parser.js`
- Modify: `src/bilibili/danmaku/message-handlers.js`

**Interfaces:**

- Consumes: raw `USER_TOAST_MSG_V2.data.option.source`, Web `pay_info.num/unit`, Open Platform `guard_num/guard_unit`.
- Produces: accepted paid gift objects with conservative quantities and `isBilibiliDuplicateGuardToast(packet)` for pre-dispatch filtering.

- [x] Implement `normalizeGuardQuantity(num, unit)` so absent/month units retain the positive integer and other non-empty units return `1`.
- [x] Implement and export `isBilibiliDuplicateGuardToast(packet)` for `USER_TOAST_MSG_V2` messages whose source is numeric/string `2`.
- [x] Apply both rules in the Web/Open guard parsers without changing price selection or persisted fields.
- [x] Skip duplicate companion toast packets in `MessageHandlers.handleGift` before diagnostics, and replace the reversed name mapping with `detectGuardLevelFromName`.
- [x] Run `node --test test/guard-gift.test.js`; all seven focused cases pass.

### Task 3: Document And Verify The Contract

**Files:**

- Modify: `docs/architecture/backend/bilibili/protocol.md`
- Modify: this plan with final verification results.

**Interfaces:**

- Consumes: verified parser behavior.
- Produces: current protocol owner documentation and completion evidence.

- [x] Update the Web/Open guard sections to document `source=2` filtering and non-month unit quantity handling.
- [x] Run `npm run check`; all 437 JavaScript files pass syntax checks.
- [x] Run `npm run verify:quick`; documentation, syntax, and architecture gates pass.
- [ ] Run `npm test`; expect the complete `node:test` suite to pass.
- [x] Review `git diff --check`, the scoped `git diff`, and `git status --short`; confirm only task-owned lines were added to already-clean relevant files.

### Verification Results

- `node --test test/guard-gift.test.js`: 7 passed, 0 failed.
- `node --test test/gift-detection-service.test.js test/overtime-service.test.js`: 26 passed, 0 failed.
- `npm run verify:docs`: 5 passed, 0 failed.
- `npm run check`: passed for 437 JavaScript files.
- `npm run verify:quick`: passed.
- `npm test`: attempted, but the full suite remains red in unrelated, pre-existing dirty admin UI work, including `test/opening-overlay.test.js` expecting the old `开场文案` markup while `public/pages/admin/toolbox/start-animation.html` already contains contextual-help markup. No unrelated failures were changed in this task.

## Rollback Or Failure Handling

If a focused regression reveals an incompatible real packet shape, stop after reviewing the task-owned diff and revise the parser predicate rather than changing the database or public snapshot. Reverse only the added source/unit logic and tests with a surgical patch; do not reset or overwrite unrelated user changes.

## Done When

- A three-month paid captain produces one final gift row/card with `num=3` and the exact paid total.
- The observed V2 `source=2` companion produces no gift row, diagnostics failure, or identity update.
- Non-month units do not multiply quantity-based settlement.
- Captain/prefect/governor name fallback maps to `3/2/1` respectively.
- Focused, quick, and full verification gates pass, protocol documentation matches runtime behavior, and the final diff contains no unrelated changes.
