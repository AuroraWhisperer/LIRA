# Cloud-authoritative Streamer Sync Implementation Plan

> **For agentic workers:** Execute this plan inline task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking; do not commit, branch, release, or publish unless the user separately requests it.

**Goal:** Make the Streamer web console and Electron client converge on one cloud-owned live/song-request configuration, Bilibili login, and song library while the cloud monitor runs independently.

**Architecture:** Add versioned tenant scopes on the existing modular server, authenticated Device and Streamer APIs, and a server-mediated Bilibili QR flow. Add one Electron-main sync controller that applies cloud state directly to the local runtime and retries local mutations without exposing credentials to renderer code.

**Tech Stack:** Express 5, better-sqlite3, AES-256-GCM, Bilibili HTTPS QR endpoints, Electron 43, Node.js 24, Vanilla JS, node:test.

## Global Constraints

- Preserve unrelated dirty-worktree changes in both repositories.
- Derive `streamerId` only from authenticated Device or Streamer context.
- Keep Bilibili cookies and Device tokens out of browser responses, renderer IPC, URLs, logs, and audit detail.
- Keep the existing modular monolith, local routes, public song page, and local Bilibili listener.
- Use camelCase wire fields, parameterized SQL, and lowercase kebab-case new files.
- Update requirements, acceptance criteria, protocol/OpenAPI, tests, and the superseding ADR in the same behavior change.

---

### Task 1: Lock the new ownership decision

**Files:**
- Create: `D:/Work/Live/specs/cloud-authoritative-streamer-sync_design.md`
- Create: `D:/Work/lira-server/docs/architecture/decisions/0006-cloud-authoritative-streamer-sync.md`
- Modify: `D:/Work/lira-server/docs/architecture/decisions/README.md`
- Modify: `D:/Work/Live/specs/README.md`

**Interfaces:**
- Produces the exact synchronized setting list, last-successful-write semantics,
  credential boundary, and migration rule used by every later task.

- [x] **Step 1: Record current ownership and the conflict with ADR-0004**
- [ ] **Step 2: Add ADR-0006 superseding ADR-0004 for synchronized scopes**
- [ ] **Step 3: Index the accepted design and ADR**
- [ ] **Step 4: Verify the documents contain no placeholder or secret material**

Run: `npm run verify:docs` in `D:/Work/Live` and `npm run docs:check` in `D:/Work/lira-server`.

### Task 2: Implement server tenant state and revisions

**Files:**
- Create: `D:/Work/lira-server/src/lib/bilibili-room.js`
- Create: `D:/Work/lira-server/src/lib/streamer-sync-settings.js`
- Create: `D:/Work/lira-server/src/modules/streamer/cloud-state.js`
- Modify: `D:/Work/lira-server/src/storage/streamer-storage.js`
- Modify: `D:/Work/lira-server/src/lib/song-library.js`
- Modify: `D:/Work/lira-server/src/modules/device/song-sync.js`
- Test: `D:/Work/lira-server/test/cloud-state-sync.test.js`

**Interfaces:**
- Produces `getCloudState(streamerId)`, `updateCloudSettings(streamerId, input)`,
  monotonic song revisions, and strict room/settings normalization.
- Consumes only numeric authenticated tenant IDs and controlled storage handles.

- [ ] **Step 1: Write failing normalization, tenant isolation, initialization, and revision tests**
- [ ] **Step 2: Add the minimal tenant metadata schema and pure validators**
- [ ] **Step 3: Implement parameterized settings/song state operations**
- [ ] **Step 4: Restart the correct monitor after room/enable changes**
- [ ] **Step 5: Run `node --test test/cloud-state-sync.test.js`**

Expected: all cloud-state tests pass and another tenant remains unchanged.

### Task 3: Implement secure Bilibili QR and credential state

**Files:**
- Create: `D:/Work/lira-server/src/modules/bilibili/credential-service.js`
- Create: `D:/Work/lira-server/src/modules/bilibili/qr-login.js`
- Modify: `D:/Work/lira-server/src/storage/streamer-storage.js`
- Modify: `D:/Work/lira-server/package.json`
- Modify: `D:/Work/lira-server/package-lock.json`
- Test: `D:/Work/lira-server/test/bilibili-qr-login.test.js`

**Interfaces:**
- Produces `createQrLogin`, `pollQrLogin`, `getCredentialStatus`,
  `getDeviceCredentials`, `setDeviceCredentials`, and `clearCredentials`.
- Web DTOs contain status/UID only; raw cookie access is Device-only.

- [ ] **Step 1: Write failing QR state, cookie parsing, expiry, and response-redaction tests**
- [ ] **Step 2: Add QR SVG support and bounded upstream fetches**
- [ ] **Step 3: Encrypt successful credentials and verify the account UID**
- [ ] **Step 4: Ensure clear/set operations advance revision and never log secrets**
- [ ] **Step 5: Run `node --test test/bilibili-qr-login.test.js`**

Expected: mocked success persists ciphertext while every web response remains secret-free.

### Task 4: Expose authenticated Device and Streamer contracts

**Files:**
- Modify: `D:/Work/lira-server/src/routes/device.js`
- Modify: `D:/Work/lira-server/src/routes/streamer.js`
- Modify: `D:/Work/lira-server/src/modules/device/index.js`
- Test: `D:/Work/lira-server/test/device-cloud-sync.test.js`
- Test: `D:/Work/lira-server/test/streamer-cloud-sync.test.js`

**Interfaces:**
- Device: `GET /api/device/cloud-state`, `PUT /api/device/cloud-settings`,
  `GET/PUT/DELETE /api/device/bilibili-credentials`.
- Streamer: `GET/PUT /api/streamer/cloud-settings`,
  `GET/DELETE /api/streamer/bilibili-credentials`, and QR create/poll/image.
- Existing song reads/writes add `revision` and `initialized` response fields.

- [ ] **Step 1: Write failing auth, invalid input, and cross-tenant HTTP tests**
- [ ] **Step 2: Add thin route orchestration and stable error mapping**
- [ ] **Step 3: Add QR create rate limiting and no-store responses**
- [ ] **Step 4: Run the two focused HTTP suites**

Expected: unauthenticated calls fail, actor scope cannot be overridden, and no web JSON contains credentials.

### Task 5: Add Electron-main synchronization

**Files:**
- Create: `D:/Work/Live/src/electron/cloud-sync-controller.js`
- Modify: `D:/Work/Live/src/electron/license/remote-license-client.js`
- Modify: `D:/Work/Live/src/electron/license/license-manager.js`
- Modify: `D:/Work/Live/src/electron/bilibili-auth.js`
- Modify: `D:/Work/Live/src/electron/desktop-auth-controller.js`
- Modify: `D:/Work/Live/src/electron/main.js`
- Modify: `D:/Work/Live/src/electron/desktop-runtime.js`
- Test: `D:/Work/Live/test/cloud-sync-controller.test.js`

**Interfaces:**
- Controller consumes authorized main-process license calls plus runtime
  `get/applyCloudSettings`, `get/replaceCloudSongs`, and local-change events.
- Raw Bilibili credentials remain available only through a non-IPC manager method.

- [ ] **Step 1: Write failing bootstrap, polling, dirty retry, and dispose tests**
- [ ] **Step 2: Add internal remote methods with bounded response validation**
- [ ] **Step 3: Add safe cloud-cookie replacement in `persist:bilibili`**
- [ ] **Step 4: Wire the controller to authorization/resume/shutdown lifecycle**
- [ ] **Step 5: Run `node --test test/cloud-sync-controller.test.js test/remote-license-client.test.js test/bilibili-login-window.test.js`**

Expected: timers are unref'd/cleaned, secret methods are absent from preload, and all scopes converge.

### Task 6: Connect local settings and song mutations

**Files:**
- Modify: `D:/Work/Live/src/server.js`
- Modify: `D:/Work/Live/src/server/runtime-api-context.js`
- Modify: `D:/Work/Live/src/server/api-context.js`
- Modify: `D:/Work/Live/src/server/routes/settings-routes.js`
- Modify: `D:/Work/Live/src/server/routes/song-routes.js`
- Modify: `D:/Work/Live/src/server/domain-services.js`
- Modify: `D:/Work/Live/src/music/song-service.js`
- Test: `D:/Work/Live/test/cloud-runtime-sync.test.js`

**Interfaces:**
- Runtime exposes snapshot/apply methods and emits `settings` or `songs` dirty
  notifications after successful local mutations.
- Cloud song replacement nulls stale queue/request foreign IDs while preserving
  textual history and performs the new library insert in one transaction.

- [ ] **Step 1: Write failing runtime snapshot, settings apply, and song replacement tests**
- [ ] **Step 2: Implement the narrow runtime methods**
- [ ] **Step 3: Emit local dirty notifications only after successful writes**
- [ ] **Step 4: Run `node --test test/cloud-runtime-sync.test.js test/bilibili-runtime.test.js test/server-smoke.test.js`**

Expected: local UI routes continue to work and the controller receives exactly one coalescible dirty signal per mutation.

### Task 7: Extend the Streamer web console

**Files:**
- Modify: `D:/Work/lira-server/public/streamer/manage.html`
- Modify: `D:/Work/lira-server/public/streamer/manage.js`
- Modify: `D:/Work/lira-server/public/streamer/manage.css`
- Test: `D:/Work/lira-server/test/streamer-manage-surface.test.js`

**Interfaces:**
- Consumes only Streamer Cookie APIs; it cannot receive Device-only credential DTOs.

- [ ] **Step 1: Add a failing surface/secret-boundary test**
- [ ] **Step 2: Add accessible settings controls and save feedback**
- [ ] **Step 3: Add QR image/status polling, refresh, success, expiry, and unlink UI**
- [ ] **Step 4: Keep song CRUD and show cloud revision feedback**
- [ ] **Step 5: Run `node --test test/streamer-manage-surface.test.js test/public-surface.test.js`**

Expected: the page supports all requested writes and contains no Cookie/CSRF input or output field.

### Task 8: Update normative contracts and architecture maps

**Files:**
- Modify: `D:/Work/lira-server/docs/requirements/system-rules.md`
- Modify: `D:/Work/lira-server/docs/requirements/acceptance-criteria.md`
- Modify: `D:/Work/lira-server/docs/requirements/traceability.md`
- Modify: `D:/Work/lira-server/docs/protocol/client-server-api.md`
- Modify: `D:/Work/lira-server/docs/protocol/device-api.openapi.json`
- Modify: `D:/Work/lira-server/docs/protocol/management-api.md`
- Modify: `D:/Work/lira-server/docs/protocol/management-api.openapi.json`
- Modify: `D:/Work/lira-server/docs/operations/bilibili-monitoring-and-reconnect.md`
- Modify: `D:/Work/Live/docs/architecture/backend/api.md`
- Modify: `D:/Work/Live/docs/architecture/backend/storage.md`
- Modify: `D:/Work/Live/docs/architecture/desktop/main.md`
- Modify: `D:/Work/Live/docs/architecture/desktop/auth.md`
- Modify: `D:/Work/Live/specs/README.md`

**Interfaces:**
- OpenAPI remains the machine-readable field/status source; Markdown records
  lifecycle, retry, last-write, and credential exposure semantics.

- [ ] **Step 1: Update requirements and acceptance criteria to the implemented behavior**
- [ ] **Step 2: Update both OpenAPI contracts and protocol prose**
- [ ] **Step 3: Update client architecture ownership and spec status**
- [ ] **Step 4: Run both documentation governance suites**

### Task 9: Final verification and review

- [ ] **Step 1: Run focused server tests from Tasks 2–7**
- [ ] **Step 2: Run `npm test` in `D:/Work/lira-server`**
- [ ] **Step 3: Run focused client tests from Tasks 5–6**
- [ ] **Step 4: Run `npm run verify` in `D:/Work/Live`**
- [ ] **Step 5: Run `git diff --check` and inspect `git status --short` in both repositories**
- [ ] **Step 6: Confirm no Cookie, token, QR key, database, or generated runtime file entered either diff**

## Rollback Or Failure Handling

Stop the active sync controller and server test processes, inspect only the
task-owned hunks, and reverse them with targeted `apply_patch` edits. Do not use
`git reset`, blanket checkout, recursive deletion, or any operation that would
discard the user's existing dirty changes. Schema additions are additive and old
runtime code ignores them, so stopping before deployment leaves existing data
readable.

## Done When

Both authenticated surfaces can update the requested settings, Bilibili QR login,
and song library; Electron converges automatically without renderer credential
exposure; the cloud monitor is controlled by cloud state and survives client exit;
all contracts and tests agree; both full gates and diff reviews pass.
