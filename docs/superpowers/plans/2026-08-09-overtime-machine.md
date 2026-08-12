# Overtime Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative overtime countdown driven exactly once by finalized paid-gift groups, with isolated gift-statistics and overtime consumers plus Admin and OBS interfaces.

**Architecture:** Keep the Node.js modular monolith and `gift-data.db`. One `GiftDetectionService` owns normalization, platform deduplication, combo aggregation, the persisted `progress/final` lifecycle, and event dispatch. A small registry fans the same standard event out to independent `GiftStatisticsConsumer` and `OvertimeConsumer` adapters; the overtime domain owns its state machine, settlement transactions, public contract, and timers without importing HTTP, WebSocket, Admin, or overlay modules.

**Tech Stack:** Node.js 24+, CommonJS, built-in `node:sqlite` `DatabaseSync`, native HTTP/WebSocket infrastructure, vanilla JavaScript/CSS/HTML, `node:test` and `node:assert/strict`.

## Global Constraints

- Preserve CommonJS, two-space indentation, semicolons, single quotes, synchronous SQLite, and existing repository conventions.
- Add no process, framework, external service, package dependency, public write endpoint, or custom-upload feature.
- Use the accepted defaults: countdown, offline elapsed time, transparent/built-in backgrounds, and paid gifts only.
- A `gift_events.id` can finalize, settle, randomly draw, increment time, and animate at most once.
- Detection is active when gift statistics or overtime is enabled; the consumers never overwrite each other's setting.
- Query functions are read-only and never flush or finalize gift lifecycle state.
- Clamp time to `0..3_599_999` seconds (`999:59:59`) and enabled rules to eight.
- Preserve unrelated working-tree edits and add no speculative abstractions.
- Run the focused test after each task, then `npm run check && npm test` before handoff.

## Module Boundaries

```text
raw gift -> GiftDetectionService -> gift_events ledger -> GiftConsumerRegistry
                                                        |-> GiftStatisticsConsumer
                                                        `-> OvertimeConsumer -> OvertimeService -> OvertimeStore

HTTP/WS -> overtime-contract -> OvertimeService
Admin/OBS <- serialized snapshots and overtime:update
```

- `src/bilibili/gift/detection-service.js`: lifecycle and timers only; no overtime rules or sprint totals.
- `src/bilibili/gift/consumer-registry.js`: isolated dispatch only; no raw packet parsing.
- `src/bilibili/gift/statistics-consumer.js`: sprint checkpoint and count only; no overtime state.
- `src/overtime/overtime-service.js`: commands and public state only; no HTTP request or DOM knowledge.
- `src/overtime/overtime-store.js`: SQL and transactions only; no broadcasting.
- `src/overtime/overtime-contract.js`: pure validation and serialization only.
- `src/server/overtime-routes.js`: authenticated transport adapter only; `server.js` stays composition wiring.

---

### Task 1: Shared Gift Detection Ledger and Consumer Isolation

**Files:**
- Create: `src/bilibili/gift/detection-service.js`
- Create: `src/bilibili/gift/consumer-registry.js`
- Create: `src/bilibili/gift/statistics-consumer.js`
- Modify: `src/bilibili/gift/event-service.js`
- Modify: `src/bilibili/gift/index.js`
- Modify: `src/bilibili/gift/query-service.js`
- Modify: `src/server/domain-services.js`
- Modify: `src/server.js`
- Modify: `src/storage/schema.js`
- Modify: `src/storage/database.js`
- Test: `test/gift-detection-service.test.js`
- Test: `test/gift-service.test.js`

**Interfaces:**
- Consumes: the current normalized gift input, `settings().enableGiftSprint`, and `getOvertimeEpoch()`.
- Produces: `createGiftDetectionService(context, options)` with `detect(input)`, `recover()`, `flushPending({ force })`, `getStatus()`, and `dispose()`.
- Produces: standard `{ phase, giftEventId, gift, eligibility }` events and `createGiftConsumerRegistry({ consumers, onError }).dispatch(event)`.
- Compatibility: `createGiftService(context, options)` keeps queries and exposes `add` as a temporary alias of `detect`.

- [x] **Step 1: Write failing migration, lifecycle, eligibility, and isolation tests**

```js
test('one quiet window finalizes a group once', () => {
  detection.detect(gift({ num: 1 }));
  clock.advance(8_000);
  detection.detect(gift({ num: 100 }));
  clock.advance(9_999);
  assert.deepEqual(phases(), ['progress', 'progress']);
  clock.advance(1);
  assert.deepEqual(phases(), ['progress', 'progress', 'final']);
});
```

- [x] **Step 2: Run the focused tests and confirm the v4 columns/service are missing**

```powershell
node --experimental-vm-modules --test test/gift-detection-service.test.js test/gift-service.test.js
```

- [x] **Step 3: Add the v4 ledger migration and focused modules**

```js
const event = Object.freeze({
  phase: row.detection_status,
  giftEventId: Number(row.id),
  gift: normalizeGiftRow(row),
  eligibility: Object.freeze({
    giftStatistics: Number(row.gift_stats_eligible) === 1,
    overtimeEpoch: Number(row.overtime_epoch) || 0
  })
});
registry.dispatch(event);
```

Append and backfill the seven section 10.0 fields. Index progress recovery and undelivered final events. Historical rows become final/delivered with overtime epoch zero.

- [x] **Step 4: Move sprint writes behind `GiftStatisticsConsumer` and make reads final-only**

```js
function handle(event) {
  if (event.phase !== 'final' || !event.eligibility.giftStatistics) return false;
  return store.deliverFinalGiftStatistics(event.giftEventId);
}
```

Recent/history/sprint/blind-box reads require `detection_status='final' AND gift_stats_eligible=1`; reset clears only `counted_in_sprint`. No query imports lifecycle flush code.

- [x] **Step 5: Verify phase 1 and legacy gift behavior**

```powershell
node --experimental-vm-modules --test test/gift-detection-service.test.js test/gift-service.test.js test/guard-gift.test.js
```

### Task 2: Overtime Persistence and Authoritative State Machine

**Files:**
- Create: `src/overtime/overtime-store.js`
- Create: `src/overtime/overtime-service.js`
- Create: `src/overtime/overtime-contract.js`
- Create: `src/overtime/index.js`
- Modify: `src/storage/schema.js`
- Modify: `src/storage/database.js`
- Test: `test/overtime-service.test.js`

**Interfaces:**
- Consumes: `giftDb`, injected clock/timer functions, and `onUpdate(message)`.
- Produces: `createOvertimeService(options)` with `getSnapshot`, `setTime`, `act`, `replaceRules`, `setBackground`, `getCurrentEpoch`, `observeGift`, `finalizeGift`, `recover`, and `dispose`.
- Produces: pure validation/serialization helpers in `overtime-contract.js`.

- [x] **Step 1: Write failing migration and transition tests**

```js
service.setTime({ remainingSeconds: 600 });
service.act('start');
clock.advance(10_000);
service.act('pause');
assert.equal(service.getSnapshot().effectiveRemainingMs, 590_000);
```

- [x] **Step 2: Run the focused test and confirm overtime modules/tables are missing**

```powershell
node --experimental-vm-modules --test test/overtime-service.test.js
```

- [x] **Step 3: Add state, rule, and settlement tables with safe singleton defaults**

```sql
CREATE TABLE overtime_machine_state (... CHECK (id = 1));
CREATE TABLE overtime_gift_rules (... PRIMARY KEY (gift_id));
CREATE TABLE overtime_settlements (... UNIQUE (gift_event_id));
```

Use exactly the columns, checks, and indexes in architecture sections 10.1–10.3.

- [x] **Step 4: Implement anchor materialization and one unref'ed zero timer**

```js
effectiveRemainingMs = Math.max(0, remainingMs - Math.max(0, nowMs - anchorAtMs));
```

Commands materialize first, clamp, increment one revision, emit one update, and reschedule. Timers longer than 24 hours are chunked.

- [x] **Step 5: Verify transitions, restart recovery, wall-clock rollback, validation, and disposal**

```powershell
node --experimental-vm-modules --test test/overtime-service.test.js
```

### Task 3: Final Settlement and Persistent Random Results

**Files:**
- Create: `src/overtime/overtime-consumer.js`
- Modify: `src/overtime/overtime-store.js`
- Modify: `src/overtime/overtime-service.js`
- Modify: `src/server/domain-services.js`
- Modify: `src/storage/database.js`
- Test: `test/overtime-service.test.js`
- Test: `test/gift-detection-service.test.js`

**Interfaces:**
- Consumes: standard progress/final events and current `enable_epoch`.
- Produces: `createOvertimeConsumer({ service })` with `isEnabled`, `getEpoch`, and `handle`.

- [x] **Step 1: Add failing fixed/random idempotency, epoch, recovery, and rollback tests**

```js
consumer.handle(progressEvent({ id: 7, num: 1, epoch: 3 }));
consumer.handle(finalEvent({ id: 7, num: 100, epoch: 3 }));
consumer.handle(finalEvent({ id: 7, num: 100, epoch: 3 }));
assert.equal(settlementCount(7), 1);
```

- [x] **Step 2: Run focused tests and confirm settlement behavior is absent**

```powershell
node --experimental-vm-modules --test test/overtime-service.test.js test/gift-detection-service.test.js
```

- [x] **Step 3: Implement final settlement as one `BEGIN IMMEDIATE` transaction**

```text
verify enabled/epoch -> ensure pending -> reload final gift/rule -> materialize clock
-> persist one rule/random snapshot -> apply/ignore -> update revision -> COMMIT
```

- [x] **Step 4: Add 1/2/4/8/16/30-second compensation and atomic gift clearing**

```js
const delaySeconds = Math.min(30, 2 ** Math.max(0, retryCount));
```

Gift clearing removes events, settlements, and their sequences atomically while preserving state and rules.

- [x] **Step 5: Verify AC-002 through AC-016 backend cases**

```powershell
node --experimental-vm-modules --test test/overtime-service.test.js test/gift-detection-service.test.js test/gift-service.test.js
```

### Task 4: Authenticated HTTP, Snapshot, and WebSocket Contract

**Files:**
- Create: `src/server/overtime-routes.js`
- Modify: `src/server/http-utils.js`
- Modify: `src/server/ws.js`
- Modify: `src/server/state-snapshot.js`
- Modify: `src/server.js`
- Test: `test/overtime-routes.test.js`

**Interfaces:**
- Consumes: authenticated parsed requests and domain APIs only.
- Produces: five `/api/overtime*` endpoints, `state.giftDetection`, `state.overtime`, and revisioned `overtime:update` messages.

- [x] **Step 1: Add failing auth, validation, snapshot, and broadcast tests**

```js
await assertApiRejects('/api/overtime/action', { action: 'launch' }, 400);
await assertApiAccepts('/api/overtime/action', { action: 'pause' }, 200);
```

- [x] **Step 2: Run tests and confirm the routes are absent**

```powershell
node --experimental-vm-modules --test test/overtime-routes.test.js
```

- [x] **Step 3: Add a thin route adapter and compose it in `server.js`**

```js
const result = overtimeRoutes.handle({ method, pathname, body, session });
if (result) return sendJson(response, result.status, result.body);
```

- [x] **Step 4: Extend snapshots and incremental WebSocket delivery**

```js
broadcast({ type: 'overtime:update', reason, state, adjustment });
```

Reconnect snapshots are always accepted; connected clients reject only stale incremental revisions.

- [x] **Step 5: Verify tokens, malicious input, snapshots, and broadcasts**

```powershell
node --experimental-vm-modules --test test/overtime-routes.test.js test/server-api.test.js test/websocket.test.js
```

### Task 5: Admin Overtime Panel

**Files:**
- Modify: `public/pages/admin.html`
- Create: `public/js/admin/overtime.js`
- Create: `public/css/admin/overtime.css`
- Modify: `public/js/admin.js`
- Modify: `public/css/admin.css`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: overtime APIs, local gift catalog, and shared Admin token/request helpers.
- Produces: clock controls, catalog search, rules, background, recent settlements, pending count, and OBS URL copy.

- [x] **Step 1: Add failing DOM/resource and safe-rendering assertions**

```js
assert.match(adminHtml, /id="overtimePanel"/);
assert.match(adminScript, /textContent\s*=/);
```

- [x] **Step 2: Run the regression test and confirm missing resources**

```powershell
node --experimental-vm-modules --test test/frontend-regressions.test.js
```

- [x] **Step 3: Fill the existing panel using DOM nodes and `textContent`**

```js
const option = document.createElement('button');
option.textContent = `${gift.name} · ${gift.id}`;
option.dataset.giftId = String(gift.id);
```

- [x] **Step 4: Add client feedback while retaining server-authoritative validation**

Enforce eight enabled rules, 2–10 outcomes, total weight 100000, and local validated image paths.

- [x] **Step 5: Verify controls, rule persistence, search, settlements, and URL copy**

```powershell
node --experimental-vm-modules --test test/frontend-regressions.test.js test/overtime-routes.test.js
```

### Task 6: Responsive OBS Overlay

**Files:**
- Create: `public/pages/overlays/overtime.html`
- Create: `public/js/overlays/overtime.js`
- Create: `public/css/overlays/overtime.css`
- Create: `public/img/overtime-machine/gift-placeholder.svg`
- Modify: `src/server/http-utils.js`
- Test: `test/overtime-overlay.test.js`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: injected token, full snapshots, live updates, and validated local images.
- Produces: a two-layer no-scroll OBS page with anchored interpolation and at most five live animations.

- [x] **Step 1: Add failing route, structure, scaling, and reconnect tests**

```js
assert.equal(resolvePage('/overtime'), 'pages/overlays/overtime.html');
assert.match(css, /container-type:\s*size/);
assert.match(script, /performance\.now\(\)/);
```

- [x] **Step 2: Run overlay tests and confirm missing resources**

```powershell
node --experimental-vm-modules --test test/overtime-overlay.test.js test/frontend-regressions.test.js
```

- [x] **Step 3: Implement background and foreground DOM layers**

```html
<main id="overtimeMachine" class="overtime-machine">
  <div id="overtimeBackground" class="overtime-background" aria-hidden="true"></div>
  <section class="overtime-foreground">...</section>
</main>
```

- [x] **Step 4: Implement anchored countdown and live-only adjustment animation**

```js
const elapsed = state.status === 'running' ? performance.now() - localAnchor : 0;
const remainingMs = Math.max(0, anchorRemainingMs - elapsed);
```

- [x] **Step 5: Verify 1920x1080, 800x800, 360x640, 320x180 and reduced motion**

```powershell
node --experimental-vm-modules --test test/overtime-overlay.test.js test/frontend-regressions.test.js
```

### Task 7: Full Regression and Acceptance Verification

**Files:**
- Modify only feature files that fail verification.
- Modify: `docs/architecture/11-overtime-machine-design.md` status only after all ACs pass.

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: repository checks and evidence mapped to AC-001–AC-016.

- [x] **Step 1: Run syntax validation**

```powershell
npm run check
```

- [x] **Step 2: Run the full suite**

```powershell
npm test
```

- [x] **Step 3: Inspect whitespace and working-tree scope**

```powershell
git diff --check
git status --short
```

- [x] **Step 4: Run all acceptance-focused tests together**

```powershell
node --experimental-vm-modules --test test/gift-detection-service.test.js test/overtime-service.test.js test/overtime-routes.test.js test/overtime-overlay.test.js test/frontend-regressions.test.js
```

- [x] **Step 5: Mark the architecture Accepted and report exact evidence**

Update the status only when the implementation matches the four accepted defaults and AC-001–AC-016. Report commands, results, risks, and preserved pre-existing modifications.
