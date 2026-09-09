# Server-Linked Gift Ledger Clear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop “全部礼物流水 → 清理数据库” action permanently clear the authenticated streamer's gift ledger on LIRA Server and its current local projection without allowing deleted server history to repopulate locally.

**Architecture:** Add one DeviceBearer-protected server action whose tenant comes only from the authenticated device. The server quiesces that tenant's gift detector, atomically removes the tenant gift ledger/outbox and rotates its sync epoch, closes old gift SSE connections, and resumes monitoring. The desktop main process calls that action first; only a confirmed remote success permits the local source-partitioned projection clear and empty bootstrap.

**Tech Stack:** Electron 43, Node.js 24+ client, Node.js 20+ Express 5 server, Vanilla JavaScript ES modules, CommonJS services, SQLite, `node:test`, OpenAPI JSON.

## Global Constraints

- Delete only the current authenticated Streamer's `gift_events` and `gift_event_deliveries`; preserve Super Chat, settings, credentials, songs, global gift catalog, and every other Streamer.
- Never accept `streamerId`, `sourceId`, room identity, or credentials from the renderer or request body as authorization evidence.
- Remote clear must succeed before local deletion. A remote failure leaves the local projection untouched.
- A successful server clear rotates `syncEpoch`, closes existing gift SSE connections, and prevents pending pre-clear detector timers from recreating deleted history.
- The fixed remote request body is `{ "confirm": true }`; extra request fields are invalid.
- No schema migration, new dependency, microservice, renderer credential access, commit, branch, release, or unrelated cleanup.
- Preserve the user's existing changes in both repositories.

---

## Current Behavior

`POST /api/database/clear-gifts` currently calls the local `clearGiftData`, resets only the active local source projection, and immediately starts remote bootstrap. LIRA Server intentionally has no gift-ledger deletion endpoint, so its full retained history is downloaded back into the just-cleared local source, potentially reimporting thousands of rows.

## Ownership And File Structure

- `D:/Work/lira-server/src/routes/device.js`: authenticated HTTP orchestration, exact confirmation validation, and per-device rate limiting.
- `D:/Work/lira-server/src/modules/device/gift-history-clear.js`: detector/SSE/storage/audit coordination for one authenticated tenant.
- `D:/Work/lira-server/src/storage/gift-ledger-clear.js`: atomic gift-ledger deletion transaction.
- `D:/Work/lira-server/src/storage/streamer-storage.js`: atomic tenant SQLite deletion and sync metadata rotation.
- `D:/Work/Live/src/electron/license/remote-license-client.js`: fixed Device endpoint and confirmation body.
- `D:/Work/Live/src/electron/license/license-operations.js`: authorized main-process-only response validation.
- `D:/Work/Live/src/server/routes/data-routes.js`: remote-first/local-second failure semantics.
- `D:/Work/Live/public/js/admin/gifts/history.js`: destructive confirmation and result copy.
- Existing gift projection, Device API, and architecture documents remain the owning contracts and are updated rather than duplicated.

## Security Checkpoint

- Authentication: existing DeviceBearer middleware remains mandatory.
- Authorization: route passes only `req.device.streamer_id`; no request-provided tenant selector reaches storage.
- Input: accept exactly one JSON field, `confirm: true`; the desktop remote client constructs it internally.
- SQL: fixed statements inside a tenant-selected SQLite transaction; no user text enters SQL.
- Output: counts and opaque sync epoch only; no UID, room, token, raw event, path, or credential data.
- Rate limit: at most five clear attempts per Device per minute.
- Audit: record the authenticated device action and structured server log without secrets or event contents.

## Milestone 1: Govern The New Destructive Contract

**Files:**
- Create: `D:/Work/lira-server/docs/architecture/decisions/0029-device-authorized-gift-ledger-clear.md`
- Modify: `D:/Work/lira-server/docs/architecture/decisions/README.md`
- Modify: `D:/Work/lira-server/docs/requirements/system-rules.md`
- Modify: `D:/Work/lira-server/docs/requirements/acceptance-criteria.md`
- Modify: `D:/Work/lira-server/docs/requirements/traceability.md`
- Modify: `D:/Work/lira-server/docs/protocol/client-server-api.md`
- Modify: `D:/Work/lira-server/docs/protocol/device-api.openapi.json`
- Modify: `D:/Work/lira-server/docs/protocol/error-codes.md`
- Modify: `D:/Work/lira-server/docs/operations/bilibili-monitoring-and-reconnect.md`
- Modify: `D:/Work/Live/specs/gift-ledger-projection-sync_design.md`
- Modify: `D:/Work/Live/docs/architecture/backend/api.md`
- Modify: `D:/Work/Live/docs/architecture/frontend/pages.md`

**Interfaces:**
- Produces: `POST /api/device/gift-history/clear` with exact body `{confirm: true}`.
- Produces: `{ok: true, deletedCounts: {giftEvents, giftEventDeliveries}, syncEpoch}`.
- Produces: `INVALID_GIFT_HISTORY_CLEAR_REQUEST` (400) and `TOO_MANY_GIFT_HISTORY_CLEAR_REQUESTS` (429).

- [x] **Step 1: Replace the absolute-retention rule with one narrow exception**

Document that normal retention still keeps ledger/outbox permanently, while an explicitly confirmed current-Device clear removes the whole authenticated tenant gift ledger and rotates the epoch. State that this is not single-row deletion, correction, retention, or cross-tenant administration.

- [x] **Step 2: Add the machine-readable endpoint**

Add this OpenAPI operation and concrete request/response schemas:

```json
{
  "operationId": "clearDeviceGiftHistory",
  "security": [{ "DeviceBearer": [] }],
  "requestBody": {
    "required": true,
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "additionalProperties": false,
          "required": ["confirm"],
          "properties": { "confirm": { "type": "boolean", "const": true } }
        }
      }
    }
  }
}
```

- [x] **Step 3: Verify documentation consistency**

Run: `node --test test/gift-sync-documentation-governance.test.js`

Expected: the test recognizes ADR-0029, the authenticated POST action, exact confirmation schema, new error codes, and remote-first client semantics.

## Milestone 2: Implement Tenant-Safe Server Deletion

**Files:**
- Create: `D:/Work/lira-server/src/modules/device/gift-history-clear.js`
- Create: `D:/Work/lira-server/src/storage/gift-ledger-clear.js`
- Modify: `D:/Work/lira-server/src/modules/device/index.js`
- Modify: `D:/Work/lira-server/src/storage/streamer-storage.js`
- Modify: `D:/Work/lira-server/src/routes/device.js`
- Modify: `D:/Work/lira-server/test/device-gift-history.test.js`

**Interfaces:**
- Consumes: authenticated `{streamerId, deviceId, ip}` from `req.device` and the connection.
- Produces: `storage.clearGiftLedger(streamerId)` returning deletion counts, new sync epoch, and update time.
- Produces: `deviceService.clearGiftHistory({streamerId, deviceId, ip})` returning the public success DTO.

- [x] **Step 1: Add failing storage/service assertions**

Seed two Streamers, final/progress rows and delivery rows, then assert that clearing Streamer A deletes all and only A's gift rows, resets `legacyFinalMaxId` to zero, changes A's epoch, leaves B unchanged, closes A's SSE, removes pending detector ownership, and records the authenticated device action.

- [x] **Step 2: Add failing route assertions**

Exercise unauthenticated, missing confirmation, extra `streamerId`, and valid requests. The valid request must derive its tenant from DeviceBearer and return only bounded counts plus the opaque epoch.

- [x] **Step 3: Implement the atomic storage owner**

Use a fixed immediate transaction equivalent to:

```js
const clear = db.transaction(() => {
  const deletedCounts = readGiftCounts(db);
  db.prepare('DELETE FROM gift_events').run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('gift_events','gift_event_deliveries')").run();
  db.prepare('UPDATE gift_sync_metadata SET sync_epoch=?,legacy_final_max_id=0,updated_at=? WHERE id=1')
    .run(crypto.randomUUID(), updatedAt);
  return { deletedCounts, syncEpoch, updatedAt };
});
return clear.immediate();
```

Foreign-key cascade removes delivery rows in the same transaction.

- [x] **Step 4: Coordinate detector, SSE, and audit**

Stop the tenant monitor, dispose its detector timers, clear storage, close tenant gift SSE subscribers, record counts for the authenticated device, and restart monitoring in `finally`. Never stop or inspect another tenant.

- [x] **Step 5: Run focused server tests**

Run: `node --test test/device-gift-history.test.js test/device-gift-epoch.test.js test/gift-sync-documentation-governance.test.js`

Expected: all tests pass; old bootstrap tokens/epochs are invalid after clear; other tenant data remains.

## Milestone 3: Make Desktop Clearing Remote-First

**Files:**
- Modify: `D:/Work/Live/src/electron/license/remote-license-client.js`
- Modify: `D:/Work/Live/src/electron/license/license-operations.js`
- Modify: `D:/Work/Live/src/electron/license/license-manager.js`
- Modify: `D:/Work/Live/src/electron/main.js`
- Modify: `D:/Work/Live/src/server.js`
- Modify: `D:/Work/Live/src/server/runtime-api-context.js`
- Modify: `D:/Work/Live/src/server/api-context.js`
- Modify: `D:/Work/Live/src/server/routes/data-routes.js`
- Modify: `D:/Work/Live/test/remote-license-client.test.js`
- Modify: `D:/Work/Live/test/license-manager.test.js`
- Modify: `D:/Work/Live/test/data-clear-all-recovery.test.js`
- Modify: `D:/Work/Live/test/server-modules.test.js`

**Interfaces:**
- Consumes: the fixed remote action through the existing authorized main-process token boundary.
- Produces: `licenseManager.clearGiftHistoryInternal({signal?})`.
- Produces: local clear route semantics: remote success → local clear → rebuild; remote failure → 502/503 and no local mutation; local failure after remote success → structured partial error plus rebuild.

- [x] **Step 1: Add the fixed remote client call and response checks**

The client sends only:

```js
request(
  'POST',
  '/api/device/gift-history/clear',
  { confirm: true },
  token,
  requestOptions,
);
```

Reject a successful HTTP response unless `ok === true`, both deletion counts are non-negative safe integers, and `syncEpoch` is a non-empty string no longer than 128 characters.

- [x] **Step 2: Inject the main-only operation into the local runtime**

Pass a closure from Electron main through the runtime context. Do not add preload, IPC, renderer globals, token parameters, or source selectors.

- [x] **Step 3: Enforce remote-first failure ordering**

Update only `POST /api/database/clear-gifts` so that it awaits the remote clear before invoking `context.data.clearGifts()`. A remote error returns `服务器礼物流水清理失败，本地数据未删除。`; a post-remote local error returns a structured partial response and starts reconciliation.

- [x] **Step 4: Run focused desktop integration tests**

Run: `node --test test/remote-license-client.test.js test/license-manager.test.js test/data-clear-all-recovery.test.js test/server-modules.test.js`

Expected: fixed endpoint/body/auth tests pass, the operation remains main-only, and call-order tests prove local deletion never runs before remote success.

## Milestone 4: Clarify The Destructive UI

**Files:**
- Modify: `D:/Work/Live/public/js/admin/gifts/history.js`
- Modify: `D:/Work/Live/test/frontend-gifts.test.js`

**Interfaces:**
- Consumes: existing local `POST /api/database/clear-gifts`.
- Produces: an explicit irreversible local-and-server confirmation and accurate success/failure feedback.

- [x] **Step 1: Add the frontend copy assertion**

Require the confirmation to include `本地和服务器`, `永久删除`, `无法恢复`, and the guarantee that remote failure leaves local data intact. Require the success toast to say both stores were cleared.

- [x] **Step 2: Replace misleading resynchronization copy**

Use:

```js
{
  title: '清空本地和服务器礼物流水',
  message: '此操作会永久删除当前账号在本地和服务器上的全部礼物流水，其他设备也会在下次同步时清空，且无法恢复。若服务器清理失败，本地数据不会删除。',
  confirmLabel: '全部清空',
}
```

On success show `本地和服务器礼物流水已清空`; keep established escaped error handling for failures.

- [x] **Step 3: Run the focused renderer test**

Run: `node --test test/frontend-gifts.test.js`

Expected: all gift drawer layout, escaping, pagination, stale-request, and new confirmation-copy assertions pass.

## Verification

Run in `D:/Work/lira-server`:

```powershell
node --test test/device-gift-history.test.js test/device-gift-epoch.test.js test/gift-sync-documentation-governance.test.js test/http-log-privacy.test.js
```

Run in `D:/Work/Live`:

```powershell
node --test test/remote-license-client.test.js test/license-manager.test.js test/data-clear-all-recovery.test.js test/server-modules.test.js test/frontend-gifts.test.js test/processed-gift-import.test.js test/remote-gift-controller.test.js test/gift-ledger-maintenance.test.js
```

Then run `git diff --check` and `git status --short` in both repositories, inspect only the task-owned diff, and confirm no runtime database, token, output, generated asset, or unrelated existing edit entered it.

## Rollback Or Failure Handling

If implementation cannot satisfy tenant isolation or detector quiescence, stop before exposing the endpoint. Reverse only the task-owned hunks with `apply_patch`; do not use reset, blanket checkout, broad deletion, or modify the user's pre-existing changes. During runtime, remote failure leaves local rows intact. If remote commit succeeds but local deletion fails, report a partial result and force epoch-based reconciliation so the non-authoritative local copy converges to the already-cleared server ledger.

## Execution Record

- 2026-09-09: Confirmed the original local-only route immediately restarted remote bootstrap against a permanently retained server ledger.
- 2026-09-09: Added and accepted ADR-0029, the DeviceBearer endpoint, tenant-scoped transaction, SSE/epoch invalidation, main-only remote client call, remote-first local route, and explicit UI copy.
- 2026-09-09: Extracted the transaction into `src/storage/gift-ledger-clear.js` after the full server gate reported that `streamer-storage.js` exceeded the repository's 600-line limit; the exported storage contract stayed unchanged.
- 2026-09-09: Focused verification passed for server tenant isolation/protocol/history/epoch/privacy and client remote request/authorization/order/projection/controller/UI behavior.
- 2026-09-09: Full tests passed in both repositories (`Live`: 1334/1334; `lira-server`: 682/682). `npm run verify:quick` passed in `Live`, both OpenAPI JSON parsing and both repository `git diff --check` checks passed, and task-owned diffs were reviewed without adding runtime data or secrets.

## Done When

- The screenshot's button clearly warns that both local and server gift history are permanently deleted.
- A valid click deletes only the authenticated Streamer's server ledger/outbox, rotates the epoch, cancels pre-clear detector work, clears the matching local projection, and rebuilds it as empty.
- Remote errors cannot trigger local deletion, and partial local failures cannot silently report success.
- A second Device converges by SSE closure and epoch mismatch without receiving old history.
- Directly affected server/client contract, storage, route, sync, and frontend tests pass.
- Both repository diffs are reviewed and contain no unrelated or sensitive material.
