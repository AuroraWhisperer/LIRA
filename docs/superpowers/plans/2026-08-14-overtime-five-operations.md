# Overtime Five Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add add, subtract, multiply, divide, and clear effects to fixed and random overtime gift rules while safely supporting up to 9,999 years.

**Architecture:** Store canonical effect objects in the existing rule JSON column so the database rule schema remains compatible, while translating legacy signed-second rules at the contract boundary. Keep countdown state as bounded safe integers, saturate arithmetic before multiplication can overflow, and use adaptive fixed-length calendar formatting in both admin and overlay views.

**Tech Stack:** Node.js 24 CommonJS service/storage modules, browser JavaScript modules, SQLite, node:test, existing HTML/CSS UI.

## Global Constraints

- Preserve existing signed-second rule inputs and stored version-1 outcomes.
- Use exactly five selectable operations: add, subtract, multiply, divide, clear.
- Division rounds down to whole seconds.
- Clamp remaining time to 9,999 365-day years.
- Do not add dependencies or refactor unrelated code.

---

### Task 1: Canonical effect validation and bounded state

**Files:**
- Modify: `src/overtime/overtime-contract.js`
- Modify: `src/storage/schema.js`
- Modify: `src/storage/database.js`
- Test: `test/overtime-service.test.js`

**Interfaces:**
- Consumes: legacy `fixedSeconds` and `{ seconds, weight }` outcomes.
- Produces: `fixedEffect` or `{ operation, value, weight }` outcomes; `MAX_OVERTIME_SECONDS` equal to 9,999 years.

- [ ] **Step 1: Write failing validation and migration tests**

```js
const [rule] = validateRules([{ giftId: 'x', mode: 'fixed', fixedEffect: { operation: 'multiply', value: 8 } }]);
assert.deepEqual(rule.fixedEffect, { operation: 'multiply', value: 8 });
assert.throws(() => validateRules([{ giftId: 'x', mode: 'fixed', fixedEffect: { operation: 'divide', value: 0 } }]));
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --experimental-vm-modules --test test/overtime-service.test.js`

- [ ] **Step 3: Validate effect objects and migrate the state bounds**

Implement `validateEffect`, translate signed seconds to add/subtract effects, raise the state ceiling to `9_999 * 365 * 24 * 60 * 60`, and append a gift database migration that recreates `overtime_machine_state` with the wider checks.

- [ ] **Step 4: Re-run the focused test**

Run: `node --experimental-vm-modules --test test/overtime-service.test.js`

---

### Task 2: Persist and apply all five effects

**Files:**
- Modify: `src/overtime/overtime-store.js`
- Modify: `src/overtime/overtime-service.js`
- Test: `test/overtime-service.test.js`

**Interfaces:**
- Consumes: validated `{ operation, value }` effects.
- Produces: bounded remaining milliseconds and adjustment payloads containing `effect`, `beforeSeconds`, and `afterSeconds`.

- [ ] **Step 1: Add failing settlement tests**

Cover multiplication, division rounding, clear, saturation at the ceiling, and legacy add/subtract rules.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --experimental-vm-modules --test test/overtime-service.test.js`

- [ ] **Step 3: Add version-2 JSON persistence and constant-time arithmetic**

Persist fixed effects and random effects in `outcomes_json`. Before multiplying, compare against `MAX_OVERTIME_MS / factor`; for division, floor the result to seconds; clear returns zero.

- [ ] **Step 4: Re-run the focused test**

Run: `node --experimental-vm-modules --test test/overtime-service.test.js`

---

### Task 3: Five-option rule editor and adaptive duration display

**Files:**
- Modify: `public/js/admin/overtime.js`
- Modify: `public/js/overlays/overtime.js`
- Modify: `public/css/admin/overtime.css`
- Modify: `public/css/overlays/overtime.css`
- Modify: `public/pages/admin.html`
- Test: `test/overtime-overlay.test.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: canonical fixed/random effects and adjustment payloads.
- Produces: five radio choices, operation-specific inputs, and fixed-length formatted clocks.

- [ ] **Step 1: Add failing browser-source regression tests**

Assert five operation values exist and formatter outputs include `1天 00:00` and `1年 0天 0小时` at the thresholds.

- [ ] **Step 2: Run the focused browser tests and confirm they fail**

Run: `node --experimental-vm-modules --test test/overtime-overlay.test.js test/frontend-regressions.test.js`

- [ ] **Step 3: Build the operation-aware editor and presentation**

Show duration fields for add/subtract, a bounded integer factor for multiply/divide, and no operand for clear. Update ticket labels, settlement animation copy, and the admin/overlay clocks with the three display tiers.

- [ ] **Step 4: Run focused browser tests**

Run: `node --experimental-vm-modules --test test/overtime-overlay.test.js test/frontend-regressions.test.js`

---

### Task 4: Full verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: all changes above.
- Produces: syntax-clean and regression-tested implementation.

- [ ] **Step 1: Run static JavaScript checks**

Run: `npm run check`

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

- [ ] **Step 3: Review the final diff**

Confirm every changed line belongs to five-operation rules, bounded time arithmetic, adaptive clock formatting, migration, or regression coverage.
