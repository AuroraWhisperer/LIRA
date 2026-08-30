# Bilibili V2 Gift Deduplication Implementation Plan

> **For agentic workers:** This plan is executed inline in the current task because the user explicitly requested implementation and live verification.

**Goal:** Correct `SEND_GIFT_V2` combo identity and cumulative quantity/price handling so one Bilibili gift combo produces one accurate LIRA gift event.

**Architecture:** Keep the existing packet → parser → gift detection service pipeline. The protobuf parser will expose the shared batch combo identity and progress totals through the existing `comboId`, `comboNum`, and `comboTotalPrice` fields; the detection service will continue to own merge/finalization. Add focused parser and service regression coverage, then replay a fresh authenticated capture from room `22625027` through a temporary database.

**Tech Stack:** Node.js 24+, CommonJS modules, `node:test`, SQLite test databases, Electron-authenticated Bilibili WebSocket capture.

## Global Constraints

- Do not send gifts, change account settings, expose cookies, or write captured events to the user database.
- Preserve existing JSON `SEND_GIFT`/`COMBO_SEND`, guard, blind-box, and free-gift behavior.
- Use the existing normalized `comboId`, `comboNum`, and `comboTotalPrice` contract; do not add a new persistence schema.

---

### Task 1: Correct the protobuf gift parser

**Files:**

- Modify: `src/bilibili/parsers/gift-parser.js:65-126`
- Modify: `docs/architecture/backend/bilibili/protocol.md:193-214`

**Interfaces:**

- Consumes the decoded `giftInfo` protobuf fields already returned by `decodeBilibiliGiftV2Proto`.
- Produces `comboId`, `comboNum`, and `comboTotalPrice` on the normalized parser result while retaining `platformId` compatibility.

- [x] Use `giftInfo[3]` as the per-packet quantity; do not treat `giftInfo[4]` (`gift_type`) as a quantity.
- [x] Read the shared batch identity from `giftInfo[12]`, return it as `comboId`, and prefer it as `platformId` when present.
- [x] Read current cumulative progress from the observed V2 extension fields (`giftInfo[11]` and `giftInfo[14]`), convert coin values with existing helpers, and retain `giftInfo[7]` as the per-packet total fallback.
- [x] Keep unit/total prices non-positive for non-gold gifts and preserve fallback behavior for older packets.

### Task 2: Add regression coverage

**Files:**

- Modify: `test/gift-capture-service.test.js`

**Interfaces:**

- Tests call the existing parser and `createGiftService` APIs only.

- [x] Add a synthetic protobuf fixture mirroring the captured V2 fields that asserts shared `comboId`, `num`, `comboNum`, `totalPrice`, and `comboTotalPrice`.
- [x] Add a service test feeding repeated progress packets plus `COMBO_SEND` and assert one final row with the final cumulative quantity and amount.
- [x] Run the focused test file and the JavaScript syntax checker.

### Task 3: Live-room verification

**Files:**

- Runtime only: `tmp/bilibili-room-22625027-gifts-*-after-fix*.ndjson` (ignored capture artifact)

- [x] Capture a fresh short gift-only stream with the local Electron Bilibili login state.
- [x] Replay it into a temporary database using the current parser/detection service.
- [x] Confirm completed combos no longer produce duplicate rows and compare the replayed totals with `COMBO_SEND` final values.
- [x] Run `git diff --check` and inspect status; leave unrelated user changes untouched.
