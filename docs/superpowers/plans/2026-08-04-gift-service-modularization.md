# Gift Service Modularization Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current working tree. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the gift service into focused, low-coupling CommonJS modules under `src/bilibili/gift/` without changing its public API or runtime behavior.

**Architecture:** Keep `src/bilibili/gift/index.js` as a facade that composes event ingestion and read services. Place pure normalization, blind-box configuration, event persistence, general queries, and blind-box analysis in one-responsibility sibling modules with one-way dependencies.

**Tech Stack:** Node.js 24+, CommonJS, better-sqlite3-compatible database API, `node:test`.

## Global Constraints

- Preserve all current uncommitted blind-box analysis behavior.
- Preserve the exports and service methods currently exposed by `gift-service.js`.
- Add no dependencies and do not alter database schemas.
- Follow two-space indentation, semicolons, single quotes, and `'use strict'`.

---

### Task 1: Establish the Current Behavioral Baseline

**Files:**
- Test: `test/gift-service.test.js`
- Test: `test/guard-gift.test.js`

**Interfaces:**
- Consumes: existing `gift-service.js` exports.
- Produces: a known passing baseline for the refactor.

- [x] **Step 1: Run focused tests**

Run: `node --experimental-vm-modules --test --test-concurrency=1 test/gift-service.test.js test/guard-gift.test.js`

Expected: all focused tests pass before file movement.

### Task 2: Extract Pure Normalization and Blind-Box Configuration

**Files:**
- Create: `src/bilibili/gift/normalizer.js`
- Create: `src/bilibili/gift/blind-box-config.js`
- Modify: `src/bilibili/gift/index.js`

**Interfaces:**
- Produces: `normalizeGiftRow(row)`, `normalizeGiftInput(input)`, and `matchBlindBox(context, giftName)`.
- Consumes: shared utility normalization functions and `context.settings/state`.

- [x] **Step 1: Move normalization without behavior changes**

Move the two normalization functions and their exact field mappings into `gift/normalizer.js`.

- [x] **Step 2: Move blind-box configuration lookup**

Move configuration parsing, cache reuse, and name matching into `gift/blind-box-config.js`.

- [x] **Step 3: Run focused tests**

Run the Task 1 command and expect all tests to pass.

### Task 3: Extract Event Ingestion

**Files:**
- Create: `src/bilibili/gift/event-service.js`
- Modify: `src/bilibili/gift/index.js`

**Interfaces:**
- Produces: `createGiftEventService(context, options)`, `addGiftEvent(context, input, skipComboBuffer, nowMs)`, `flushStaleComboBuffers(context, options)`, and `repairGiftV2Events(context)`.
- Consumes: gift normalization and blind-box matching.

- [x] **Step 1: Move combo buffering and timer ownership**

Keep the 10-second pending age, force-flush semantics, timer injection, and `onGiftFlushed` callback unchanged.

- [x] **Step 2: Move persistence and deduplication**

Keep platform identity, cross-command deduplication, progress updates, logging, and SQL unchanged.

- [x] **Step 3: Move V2 repair**

Keep transaction and merge behavior unchanged.

- [x] **Step 4: Run focused tests**

Run the Task 1 command and expect all tests to pass.

### Task 4: Extract Query Services

**Files:**
- Create: `src/bilibili/gift/query-service.js`
- Create: `src/bilibili/gift/blind-box-analysis.js`
- Modify: `src/bilibili/gift/index.js`

**Interfaces:**
- General queries produce: `resetGiftSprintProgress`, `getGiftSnapshot`, `getGiftHistory`, `getGiftSprintSnapshot`, `searchGifts`, and `clearRecentGifts`.
- Blind-box queries produce: `getBlindBoxStats` and `getBlindBoxAnalysis`.
- Both consume `flushStaleComboBuffers(context)` before reads where the existing service does.

- [x] **Step 1: Move general read and cleanup operations**

Preserve pagination bounds, SQL ordering, sprint math, and deletion transaction behavior.

- [x] **Step 2: Move blind-box statistics and analysis**

Preserve today's bounded time window, filter options, sorting allowlists, aggregation, and pagination.

- [x] **Step 3: Reduce the facade**

Compose the event service with query functions and re-export the exact existing public symbols from `gift-service.js`.

- [x] **Step 4: Run focused tests**

Run the Task 1 command and expect all tests to pass.

### Task 5: Verify the Complete Refactor

**Files:**
- Verify: `src/bilibili/gift/index.js`
- Verify: all extracted modules and repository tests.

**Interfaces:**
- Produces: syntax-valid modules and unchanged repository behavior.

- [x] **Step 1: Check module size and imports**

Confirm `gift/index.js` is a small facade and no extracted module imports that facade.

- [x] **Step 2: Run static validation**

Run: `npm run check`

Expected: exit code 0.

- [x] **Step 3: Run the complete test suite**

Run: `npm test`

Expected: exit code 0 with no failed tests.
