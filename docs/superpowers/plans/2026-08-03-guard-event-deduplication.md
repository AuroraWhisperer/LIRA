# Guard Event Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store one gift event for each Bilibili guard purchase despite its GUARD_BUY and USER_TOAST_MSG protocol variants.

**Architecture:** Derive a stable guard purchase key from the purchaser, guard gift ID, and guard start timestamp. The parser assigns that key as the platform ID for all protocol variants so the existing gift-service upsert retains the highest reported payment amount once. The change deliberately does not invent multi-month package totals when Bilibili's event lacks a duration or order total.

**Tech Stack:** Node.js 24, CommonJS, `node:test`, SQLite via `node:sqlite`.

## Global Constraints

- Use Node.js 24 or newer with the repository's CommonJS style.
- Make no new network requests or add dependencies.
- Preserve existing user changes and run `npm run check` and `npm test` before delivery.

---

### Task 1: Parse Stable Guard Purchase IDs

**Files:**
- Modify: `src/bilibili/parsers/gift-parser.js`
- Test: `test/guard-gift.test.js`

**Interfaces:**
- Produces: `extractBilibiliWebGuardGiftMessage(packet, data).platformId` with the same value for matching `GUARD_BUY`, `USER_TOAST_MSG`, and `USER_TOAST_MSG_V2` messages.

- [x] **Step 1: Write the failing parser test**

```js
assert.equal(guardBuy.platformId, toastV1.platformId);
assert.equal(toastV1.platformId, toastV2.platformId);
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --experimental-vm-modules --test test/guard-gift.test.js`

Expected: FAIL because each command currently receives a separate fallback platform ID.

- [x] **Step 3: Add the shared purchase-key helper and use it for guard platform IDs**

```js
function buildBilibiliGuardPurchaseId(uid, giftId, startTime) {
  if (!uid || !giftId || !startTime) return '';
  return `guard:${uid}:${giftId}:${startTime}`;
}
```

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --experimental-vm-modules --test test/guard-gift.test.js`

Expected: PASS.

### Task 2: Verify Gift-Service Persistence

**Files:**
- Test: `test/guard-gift.test.js`

**Interfaces:**
- Consumes: parsed guard messages with a shared `platformId`.
- Produces: one `gift_events` row with the maximum reported total price.

- [x] **Step 1: Add the failing persistence assertion**

```js
assert.equal(rows.length, 1);
assert.equal(rows[0].total_price, 198);
```

- [x] **Step 2: Run the focused test to verify it passes with the parser change**

Run: `node --experimental-vm-modules --test test/guard-gift.test.js`

Expected: PASS because the existing platform-ID upsert preserves the higher `GUARD_BUY` amount.

### Task 3: Validate the Change

**Files:**
- Modify: `src/bilibili/parsers/gift-parser.js`
- Create: `test/guard-gift.test.js`

- [x] **Step 1: Run static syntax checks**

Run: `npm run check`

Expected: exit code 0.

- [x] **Step 2: Run the complete regression suite**

Run: `npm test`

Expected: exit code 0.
