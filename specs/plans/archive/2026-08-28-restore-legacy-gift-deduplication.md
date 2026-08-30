# Restore Legacy Gift Deduplication Implementation Plan

> **For agentic workers:** Execute this plan inline in the current task. The repository does not provide the `superpowers:executing-plans` skill, so follow the checked steps and verification commands directly. Do not create commits unless the user explicitly asks.

**Goal:** Restore the pre-v2.2.1 behavior that records only one gift when the same user produces otherwise identical same-command gift messages with different platform message IDs inside a five-second window.

**Architecture:** Keep the existing `packet -> MessageHandlers -> GiftDetectionService -> gift_events` pipeline and database schema. Extend the owning event-service fallback lookup after platform/combo identity lookup: preserve the existing cross-command `COMBO_SEND` match, then apply the legacy same-command fingerprint over user, gift ID/name, quantity, total price, and the existing ±5 second window when the message has no explicit combo/batch identity.

**Tech Stack:** Node.js 24 CommonJS, `node:sqlite`, `node:test`, Markdown architecture documentation.

## Global Constraints

- Preserve the current modular monolith, public HTTP/WebSocket payloads, `gift_events` schema, finalization lifecycle, consumer idempotency, and overtime settlement key.
- Restore the legacy five-second same-command behavior for messages without an explicit combo/batch identity; do not add a new setting, dependency, migration, or generalized fuzzy matcher.
- Accept the legacy trade-off that two genuinely separate identical gifts from one user within five seconds may be merged.
- Preserve unrelated changes in `public/css/license.css` and `public/pages/license.html`.
- Do not commit, branch, tag, release, or publish.

---

## Non-goals

- Do not redesign Bilibili packet identity or add cross-protocol canonical order IDs.
- Do not repair or delete existing persisted duplicate rows.
- Do not change gift prices, blind-box metadata, combo accumulation, sprint totals, overtime rules, or frontend rendering.

## Current Behavior

- `findRecentGiftCommandDuplicate` only returns a match when either the stored or incoming command is `COMBO_SEND`.
- Different `platformId` values for otherwise identical `SEND_GIFT` messages create separate final rows.
- `test/gift-capture-service.test.js` currently codifies this by inserting five identical `SEND_GIFT` payloads with different IDs and expecting five rows.
- The Admin recent-gift renderer replaces its list from the server snapshot, so the repeated cards originate in the ledger rather than DOM append behavior.
- During implementation, a literal restoration of the old SQL collapsed two messages carrying different explicit `batch_combo_id` values because the current detection ledger persists progress immediately. The fallback is therefore limited to messages without an explicit combo/batch identity; exact combo grouping and the existing cross-command branch remain authoritative.

## Ownership

- Owner: `src/bilibili/gift/event-service.js`.
- Caller: `src/bilibili/gift/detection-service.js`.
- Contract: `docs/architecture/backend/bilibili/gift.md` §2.1 and §8.
- Consumers: gift snapshots, sprint statistics, blind-box analysis, gift effects, and overtime settlement.
- Focused tests: `test/gift-capture-service.test.js`, `test/gift-detection-service.test.js`, and `test/overtime-service.test.js`.

## Compatibility Constraints

- Keep `(platform_id, uid)` as the exact platform identity and retain the unique index unchanged.
- Run the legacy fingerprint only after exact platform/combo identity lookup misses and the incoming message has no explicit combo/batch identity.
- Require `status='active'`, the same normalized command, uid, gift ID, gift name, quantity, and total price difference below `0.0001` within the existing ±5 second window.
- Return the existing row so finalization and downstream consumers remain idempotent by `gift_events.id`.

## Proposed Changes

- Modify `src/bilibili/gift/event-service.js` to restore the legacy same-command SQL fallback after the existing cross-command query.
- Update `test/gift-capture-service.test.js` so high-value `SEND_GIFT` and `BLIND_GIFT` messages with different IDs inside the window deduplicate, while otherwise identical messages outside the window remain distinct.
- Update `docs/architecture/backend/bilibili/gift.md` to describe both fallback branches and the known rapid-repeat trade-off.

## Milestones

### Task 1: Capture the restored legacy behavior

**Files:**

- Modify: `test/gift-capture-service.test.js`

**Interfaces:**

- Consumes: `createGiftService(context).add(gift)` and persisted `gift_events` rows.
- Produces: a regression test proving the five-second boundary for same-command messages with different platform IDs.

- [x] **Step 1: Rewrite the distinct-message-ID test to expect legacy deduplication**

Use the same user and gift fingerprint for three inputs in both a high-value `SEND_GIFT` scenario and a `BLIND_GIFT` scenario. Put the first two 100 ms apart and the third 5,101 ms after the first. Assert that each command retains two rows:

```js
const messageTimes = [1_800_000_000_000, 1_800_000_000_100, 1_800_000_005_101];
const scenarios = [
  {
    cmd: 'SEND_GIFT',
    giftId: 'high-value',
    giftName: '高价礼物',
    uid: '42',
    totalPrice: 1000,
  },
  {
    cmd: 'BLIND_GIFT',
    giftId: 'blind-output',
    giftName: '盲盒结果',
    uid: '43',
    totalPrice: 20,
  },
];

scenarios.forEach((scenario) => {
  messageTimes.forEach((messageTimestamp, index) =>
    service.add({
      platformId: `${scenario.cmd.toLowerCase()}-message-${index + 1}`,
      cmd: scenario.cmd,
      giftId: scenario.giftId,
      giftName: scenario.giftName,
      uid: scenario.uid,
      userName: 'Alice',
      num: 1,
      unitPrice: scenario.totalPrice,
      totalPrice: scenario.totalPrice,
      isBlindBox: scenario.cmd === 'BLIND_GIFT',
      blindBoxName: scenario.cmd === 'BLIND_GIFT' ? '测试盲盒' : '',
      blindBoxPrice: scenario.cmd === 'BLIND_GIFT' ? 10 : null,
      messageTimestamp,
    }),
  );
});

const countByCommand = db.giftDb.prepare(
  'SELECT COUNT(*) AS count FROM gift_events WHERE cmd = ?',
);
assert.equal(countByCommand.get('SEND_GIFT').count, 2);
assert.equal(countByCommand.get('BLIND_GIFT').count, 2);
```

- [x] **Step 2: Run the focused test and confirm the new assertion fails before implementation**

Run: `node --test test/gift-capture-service.test.js`

Expected: the rewritten test reports three rows instead of two for each command; unrelated cases pass.

### Task 2: Restore the legacy same-command fallback

**Files:**

- Modify: `src/bilibili/gift/event-service.js`

**Interfaces:**

- Consumes: normalized gift fields and `context.db.giftDb`.
- Produces: `findRecentGiftCommandDuplicate(context, gift)` returning an existing normalized row for either the existing `COMBO_SEND` cross-command rule or the restored same-command rule.

- [x] **Step 1: Add the same-command lookup after the cross-command lookup**

Keep the current query first. If it does not match and `extractComboRootKey(gift.comboId || gift.platformId)` is null, execute:

```js
if (extractComboRootKey(gift.comboId || gift.platformId)) return null;

const sameCmdRow = context.db.giftDb
  .prepare(
    `
  SELECT * FROM gift_events
  WHERE status = 'active'
    AND created_at BETWEEN ? AND ?
    AND cmd = ?
    AND uid = ? AND gift_id = ? AND gift_name = ? AND num = ?
    AND ABS(total_price - ?) < 0.0001
  ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
`,
  )
  .get(
    startIso,
    endIso,
    cmd,
    gift.uid,
    gift.giftId,
    gift.giftName,
    gift.num,
    gift.totalPrice,
  );
return sameCmdRow ? normalizeGiftRow(sameCmdRow) : null;
```

- [x] **Step 2: Run the focused gift-capture test**

Run: `node --test test/gift-capture-service.test.js`

Expected: all cases pass, including one row for different IDs inside five seconds and a second row outside the window.

### Task 3: Align the owner documentation and verify downstream behavior

**Files:**

- Modify: `docs/architecture/backend/bilibili/gift.md`

**Interfaces:**

- Consumes: the implemented event-service semantics.
- Produces: an accurate contract description for maintainers and future tests.

- [x] **Step 1: Update the deduplication description**

Document that fallback lookup first handles `SEND_GIFT`/`BLIND_GIFT` versus `COMBO_SEND`, then restores same-command matching by identical uid, gift ID/name, quantity, and price within ±5 seconds. State that this intentionally matches legacy behavior and may merge genuine rapid identical gifts.

- [x] **Step 2: Run affected detection and settlement tests**

Run: `node --test test/gift-capture-service.test.js test/gift-detection-service.test.js test/overtime-service.test.js`

Expected: all tests pass with zero failures.

- [x] **Step 3: Review the scoped diff and repository state**

Run: `git diff --check -- src/bilibili/gift/event-service.js test/gift-capture-service.test.js docs/architecture/backend/bilibili/gift.md specs/plans/2026-08-28-restore-legacy-gift-deduplication.md`

Run: `git diff -- src/bilibili/gift/event-service.js test/gift-capture-service.test.js docs/architecture/backend/bilibili/gift.md specs/plans/2026-08-28-restore-legacy-gift-deduplication.md`

Run: `git status --short`

Expected: no whitespace errors; only the four task-owned files plus the two pre-existing license files are modified/untracked.

## Verification

- Focused regression: `node --test test/gift-capture-service.test.js`.
- Downstream detection/settlement: `node --test test/gift-detection-service.test.js test/overtime-service.test.js`.
- Static review: scoped `git diff --check`, scoped diff inspection, and `git status --short`.

Verification result (2026-08-28): the combined focused command passed 35/35 tests with zero failures. The regression log showed both a ¥1000 `SEND_GIFT` and a `BLIND_GIFT` deduplicated inside the window, retained outside it, and kept different explicit combo batches separate.

## Rollback Or Failure Handling

If the focused test exposes a conflict with combo grouping or finalization, stop before broadening the matcher. Inspect only the four task-owned paths and reverse task-owned hunks with `apply_patch`; do not use reset, checkout, or broad deletion. Existing database rows remain untouched throughout.

## Done When

- Same-command identical gifts without an explicit combo/batch identity and with different platform IDs inside five seconds resolve to one `gift_events.id`.
- The same fingerprint outside five seconds creates a separate row.
- Messages carrying different explicit combo/batch identities remain separate.
- Existing combo progress, detection finalization, consumer idempotency, and overtime tests pass.
- The architecture document states the restored behavior and trade-off.
- Final diff contains no unrelated source changes or generated/runtime data.
