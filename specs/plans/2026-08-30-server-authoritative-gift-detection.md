# Server-authoritative Gift Detection Implementation Plan

> Status: Implemented; client full verification retains one unrelated pre-existing ESM-boundary failure (`public/js/overlays/danmaku-feed.js` references `xffffffff` as an identifier).

> **For agentic workers:** Execute each milestone against the existing dirty
> worktrees without commits. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LIRA Server the only raw Bilibili gift detector and make Electron
consume its privacy-minimized, processed gift events while all non-gift local
Bilibili features remain active.

**Architecture:** A per-Streamer server detector writes a tenant SQLite ledger
and an atomic final-delivery cursor, exposes final recovery through Device HTTP,
and accelerates online delivery through tenant-scoped SSE. Electron main owns
the authenticated stream/backfill/cursor lifecycle and projects events through a
dedicated idempotent local importer that reuses existing consumers without
calling the raw detector.

**Tech Stack:** Node.js 20+/24 CommonJS, Express 5, better-sqlite3/node:sqlite,
Electron 43, native fetch/SSE parsing, node:test.

## Global constraints

- Preserve both repositories' unrelated uncommitted changes; do not commit,
  branch, publish, format broadly, or use real user data.
- `streamerId` is resolved only at authenticated server/runtime boundaries;
  client payloads never select tenants.
- Keep Device tokens, Bilibili credentials, UID, raw packets, and remote stream
  handles out of renderer IPC, logs, and gift event responses.
- Keep server location configurable and preserve HTTPS plus explicit loopback
  development support.
- Keep the modular monolith; add no process, service, framework, or dependency.
- Preserve existing local gift history/statistics/overtime/overlay contracts and
  all non-gift local Bilibili behavior.
- Treat Bilibili upstream disconnect loss as an explicit limitation; do not
  claim upstream zero-loss recovery.

## Non-goals

- Cross-instance event fan-out or distributed RoomMonitor leadership.
- Bilibili historical replay during an upstream disconnect.
- Renderer access to the Device API or a new remote event UI contract.
- Replacing local gift persistence, overtime settlement, or local WebSocket
  snapshots with server implementations.

## Current behavior

- The desktop gift parser/detector owns combo identity, ±5-second compatibility
  duplicate matching, blind-box mapping and 10-second quiet finalization.
- The current uncommitted client change sets
  `LOCAL_BILIBILI_ACQUISITION_ENABLED = false`, which incorrectly stops the
  whole local Bilibili client and therefore also stops danmaku/song requests,
  Super Chat and games.
- The server worktree already contains the parser, detector, broker, final event
  service, tenant ledger migration and Device routes, but their integration and
  compatibility tests are incomplete. Admin history still queries legacy gift
  column names.
- Existing server and client worktrees contain other large feature branches;
  every final diff inspection must be path-scoped before the repository-wide
  status review.

## Ownership

- Server ingress/domain: `D:/Work/lira-server/src/modules/bilibili/`.
- Server tenant persistence: `D:/Work/lira-server/src/storage/streamer-storage.js`.
- Server Device contract: `D:/Work/lira-server/src/routes/device.js`,
  `docs/protocol/client-server-api.md`, and
  `docs/protocol/device-api.openapi.json`.
- Client gift ledger/consumers: `D:/Work/Live/src/bilibili/gift/` and
  `D:/Work/Live/src/storage/`.
- Client privileged network/lifecycle: `D:/Work/Live/src/electron/` and the
  composition roots `src/electron/main.js` / `src/server.js`.
- Synchronized blind-box setting: server Streamer cloud state and the client's
  `src/electron/cloud-sync-controller.js` plus local runtime snapshot methods.

## Compatibility constraints

- Do not delete existing server history rows or legacy guard/history tables.
- Do not change local renderer URLs, WebSocket message types, `gift:frame`, or
  local settings keys.
- Device API additions must use existing Device Bearer revocation and tenant
  checks and must not weaken Host/Origin, Electron isolation, or safeStorage.
- Existing clients and older cloud rows without `giftBlindBoxConfig` remain
  valid; absence means preserve-and-seed, not clear.
- Cursor replay must be idempotent across process crashes and repeated startup.

## Proposed files and responsibilities

- Server `gift-parser.js`: normalize supported Bilibili gift/guard commands.
- Server `gift-detector.js`: authoritative grouping, dedupe, cumulative values,
  blind-box mapping and finalization.
- Server `gift-event-broker.js` / `gift-event-service.js`: online fan-out and
  durable final cursor reads.
- Server `streamer-storage.js`: legacy migration plus final delivery outbox.
- Server `room-monitor.js` / `monitor-manager.js`: tenant-bound detector wiring
  and lifecycle.
- Server Admin history/read model: query the new ledger while retaining legacy
  history visibility.
- Client gift detection service: add `importProcessedEvent(event)` beside, but
  separate from, `detect(input)` and reuse final consumers exactly once.
- Client remote license client/operations/manager: add main-process-only final
  pull and gift SSE methods.
- Client remote gift controller/cursor store: validate, serialize, recover,
  reconnect, and clean up remote delivery.
- Client composition/runtime: expose the narrow importer and suppress only the
  local gift callback.
- Cloud settings: carry a validated `giftBlindBoxConfig` array and seed on
  absent remote state.
- Normative docs and ADR-0009: record the new state owner, protocol, privacy,
  frequency and failure semantics. ADR-0008 already belongs to server-owned
  danmaku overlay and must not be overwritten.

## Milestone 1: Server detector and tenant ledger

- [x] Port desktop parser behavior and add parser fixtures for normal, V2,
  combo, blind-box and guard command families.
- [x] Add detector tests with a fake clock for one first progress, cumulative
  maxima, explicit final, 10-second quiet final, platform identity, ±5-second
  compatibility dedupe, distinct batch IDs and blind-box totals.
- [x] Add storage migration tests starting from the legacy gift schema; assert
  row retention, final status, no legacy delivery replay and idempotent repeated
  initialization.
- [x] Verify finalization updates the gift row and inserts exactly one outbox
  cursor in one transaction, then publishes the final DTO.
- [x] Run syntax checks and the focused parser, detector, and
  `streamer-storage-gift-migration` tests.

## Milestone 2: Server Device delivery and legacy readers

- [x] Add broker isolation tests proving Streamer A events cannot reach B
  listeners and cleanup removes empty listener buckets.
- [x] Add Device route tests for 401, authenticated baseline, cursor pagination,
  validation errors, final-only recovery, SSE event name/headers, tenant
  isolation and payload field allowlisting.
- [x] Update Admin history and Streamer read-model gift queries to
  `user_name`, `gift_name`, `num`, `total_price`, `created_at` and final active
  rows; keep historical guard rows readable.
- [x] Add RoomMonitor dispatch tests for every supported gift command and prove
  legacy `recordGift`/`recordGuard` paths are not called.
- [x] Run the focused server Device, Admin, monitor, broker and storage tests.

## Milestone 3: Client processed-event projection

- [x] Add client tests for importing first progress, cumulative final,
  final-only backfill, invalid DTO rejection, repeated event ID idempotency and
  crash-style final replay without duplicate consumers.
- [x] Implement `importProcessedEvent()` inside the gift service without calling
  `detect()`, without UID/raw storage, and with first-phase local eligibility.
- [x] Expose a narrow `importProcessedGiftEvent()` runtime method through
  `src/server.js` and `src/electron/desktop-runtime.js`.
- [x] Prove one imported final still updates gift statistics, overtime history,
  snapshots and `gift:frame` through existing consumers/callbacks.
- [x] Run the focused gift-service/consumer tests plus the new importer test.

## Milestone 4: Client authenticated stream, cursor and lifecycle

- [x] Add remote-client tests for bounded Device gift pull, valid SSE parsing,
  ignored malformed/oversized events, abort, HTTP errors and absence of tokens
  in public/log-visible data.
- [x] Add main-process-only license operations for gift pull and SSE; expose no
  new preload or renderer IPC.
- [x] Implement an atomic cursor store with validated version/source/cursor and
  corrupt-file fallback that never reads real test user data.
- [x] Implement the remote gift controller: initial no-replay baseline, stream
  open, post-open catch-up, ordered pagination, serialized live delivery,
  exponential reconnect, source-key reset, and idempotent dispose.
- [x] Wire authorization transitions, power resume and `before-quit` cleanup in
  `main.js`.
- [x] Run the new controller/cursor tests plus
  `test/remote-license-client.test.js`, `test/license-background.test.js`,
  `test/license-protocol-e2e.test.js`, and `test/license-resume.test.js`.

## Milestone 5: Preserve non-gift local Bilibili behavior

- [x] Replace the whole-acquisition flag with
  `LOCAL_GIFT_DETECTION_ENABLED = false` at the composition boundary.
- [x] Keep `createBilibiliRuntime` enabled and suppress only the `onGift` call
  into `domainServices.gifts.add()`.
- [x] Update runtime/startup tests to prove client construction, danmaku/SC/game
  handlers and active room state remain enabled while local gifts are ignored.
- [x] Run the Bilibili runtime/startup and message-handler tests.
  `test/bilibili-startup-wiring.test.js`, relevant message/parser tests and the
  new suppression assertion.

## Milestone 6: Blind-box cloud settings compatibility

- [x] Send local `giftBlindBoxConfig` as a parsed array in the settings snapshot
  and validate it server-side with the same count/name/price bounds as detector
  configuration.
- [x] When initialized cloud settings omit the optional field, preserve the
  local setting, mark settings dirty, and seed it to the server before accepting
  subsequent revisions.
- [x] When the field is present, serialize the validated array back into the
  existing local JSON-string settings key without changing unrelated settings.
- [x] Add client/server tests for present, absent, invalid, empty and non-empty
  configurations and run both cloud-sync focused suites.

## Milestone 7: Normative documentation and ADR

- [x] Add server requirements and acceptance criteria for authoritative
  detection, tenant isolation, two-message frequency, final cursor recovery,
  privacy allowlist and explicit upstream loss limitation.
- [x] Update traceability, client/server protocol Markdown, Device OpenAPI,
  architecture data boundaries/multi-tenancy/overview, and Bilibili operations.
- [x] Add ADR-0009 covering server ownership, transactional outbox plus
  SSE, client projection, alternatives and consequences; update the ADR index.
- [x] Add this design to `specs/README.md` and update relevant Live architecture
  owner/consumer documents.
- [x] Run server `npm run docs:check` and client `npm run verify:docs`.

## Verification

- Server focused commands are listed in Milestones 1, 2 and 6; expected result
  is zero failures with isolated temporary tenant databases.
- Client focused commands are listed in Milestones 3–6; they pass with no
  network access to production.
- Run server `npm test` because tenant persistence, Device auth and public
  contract boundaries changed.
- Run client `npm run verify` because Electron lifecycle, persistence ownership,
  server-assisted behavior and cross-domain consumers changed. The run reaches
  the architecture gates; one unrelated pre-existing ESM-boundary failure
  remains in `public/js/overlays/danmaku-feed.js` (`xffffffff`).
- Run `git diff --check` in both repositories.
- Inspect the task-owned diff, then `git status --short` in both repositories;
  confirm no token, cookie, raw packet, database, cursor runtime file, generated
  asset or unrelated cleanup entered the task diff.

## Rollback or failure handling

Stop the remote gift controller before the local runtime closes. If verification
finds a blocker, leave unrelated worktree changes untouched, inspect only the
paths listed above, and reverse task-owned hunks with `apply_patch`; do not use
reset, blanket checkout or recursive deletion. Existing local gift rows and
server migrated history remain readable. Re-enabling the single local gift
callback is the behavioral fallback, but only after stopping remote delivery so
two detectors cannot count the same live gift.

## Done when

- Server parsing/detection is behaviorally covered for supported command,
  combo, dedupe, blind-box and finalization cases.
- Authenticated Device delivery is tenant-isolated, privacy-minimized,
  frequency-bounded and recoverable for committed final events.
- Electron imports each final event at most once, preserves all existing final
  consumers and keeps non-gift Bilibili features running.
- Blind-box configuration converges without an absent older cloud field erasing
  local data.
- Normative docs, OpenAPI, ADR-0009, tests and implementation agree.
- Server full gates and final diff/status reviews pass; the client focused gates
  pass, while the unrelated ESM-boundary failure and the explicit Bilibili
  upstream-disconnect loss limitation are recorded above and in the final
  report.
