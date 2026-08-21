# Bilibili User Info Service Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current worktree. Do not create commits unless the user explicitly requests them.

**Goal:** Implement the accepted Bilibili user-info facade without changing existing HTTP, WebSocket, IPC, database, preload, avatar-proxy, or frontend event contracts.

**Architecture:** `src/bilibili/users/user-info-service.js` owns field merge policy, profile request coordination, room scope, room-run tokens, projections, and subscriptions. `IdentityCache` remains an in-memory storage/index compatibility primitive, while parsers and pollers submit normalized hints through injected ports. `src/server/bilibili-runtime.js` owns the shared service lifecycle and exposes only narrow profile resolution to games.

**Tech Stack:** Node.js 24+, CommonJS, `node:test`, existing zero-dependency Bilibili modules.

## Global Constraints

- Preserve the modular monolith; add no process, port, framework, build step, database schema, setting key, or runtime dependency.
- Keep the existing 10-minute in-memory TTL and a 30-second failed-profile negative cache.
- Accept only trusted normalized `https://*.hdslb.com` avatar URLs.
- Preserve all existing HTTP paths and response shapes, WebSocket/IPC contracts, frontend events, and persisted formats.
- Do not modify or discard unrelated worktree changes and do not create a commit.

## Goal, Non-goals, and Current Behavior

The implementation replaces distributed identity merging and implicit avatar hydration with the accepted facade. It does not add persistence, renderer APIs, or a user-history database. Current production code directly merges through `IdentityCache`, pollers write the cache, the game winner route fetches a Bilibili profile directly, and `onMessage() === true` triggers an avatar request.

## Ownership

- Owner: `src/bilibili/`
- Composition/lifecycle: `src/server/bilibili-runtime.js`, `src/server/bilibili-client.js`
- Contracts: `specs/bilibili-user-info-service_design.md`, `docs/architecture/adr/0010-bilibili-user-info-facade.md`, Bilibili architecture facts
- Consumers: Bilibili message delivery, viewer candidates, game avatar hydration, `/api/games/winner-profile`
- Focused tests: Bilibili service, parser, poller, client, runtime, and game-route tests

## Proposed File Structure

- Create `src/bilibili/users/user-info-service.js`: merge policy, projections, subscriptions, TTL, lifecycle, dedupe, negative cache.
- Create `src/bilibili/users/profile-provider.js`: narrow adapter over `fetchUserProfile(uid)`.
- Modify `src/bilibili/danmaku/identity-cache.js`: add exact service-owned storage/index operations; production consumers no longer invoke legacy merge methods.
- Modify parser/extractor, message-handler, poller, client, and runtime modules only where required to route identity data through the facade.
- Create focused tests for the new facade and migrate legacy tests to assert the accepted boundary.

---

### Task 1: Lock the service contract with focused tests

**Files:**
- Create: `test/bilibili-user-info-service.test.js`
- Modify: `test/bilibili-identity-cache.test.js`

**Interfaces:**
- Produces: `new UserInfoService({ identityCache, profileProvider, now, diagnostics })`
- Produces: `peek`, `ingestHint`, `ensure`, `listRecent`, `listOnline`, `replaceOnlineSnapshot`, `subscribe`, `setRoom`, `beginRoomRun`, `endRoomRun`, `dispose`

- [ ] Write failing `node:test` cases for name quality, SC/profile avatar freshness, room authority/absence, medal target ownership, field validation/projection, subscription filtering, A→B→A generation rejection, same-room run-token rejection, provider in-flight dedupe, negative cache, and dispose.
- [ ] Run `node --test test/bilibili-user-info-service.test.js`; expect module-not-found or missing-contract failures.
- [ ] Keep test inputs explicit, for example:

  ```js
  const scope = service.setRoom({ roomId: '100', ownerUid: '999' });
  const run = service.beginRoomRun();
  service.ingestHint({ uid: '123', name: 'Alice' }, { ...run, source: 'danmaku' });
  assert.deepEqual(service.peek('123', { fields: ['name'] }), { uid: '123', name: 'Alice' });
  ```

### Task 2: Implement the facade and storage adapter

**Files:**
- Create: `src/bilibili/users/user-info-service.js`
- Create: `src/bilibili/users/profile-provider.js`
- Modify: `src/bilibili/danmaku/identity-cache.js`

**Interfaces:**
- `BilibiliUserProfileProvider.fetchProfile(uid) -> Promise<{ name?, avatarUrl? }>`
- `IdentityCache.storeMerged(identity, { recent })`, `readMerged(uid)`, `listRecentUids()`, `replaceOnlineSnapshot(uids)`, `listOnlineUids()`, `clearRoomIndexes()`

- [ ] Implement strict UID/fields/source normalization before stale-room checks.
- [ ] Implement profile merge as quality/validity → freshness → source tie-break and room merge as verification → unexpired authority → freshness.
- [ ] Implement exact projections that always include `uid`, omit internal evidence/tokens, and include room `known:false` only when room fields are requested under a current scope.
- [ ] Implement one `profile:${uid}` promise, 30-second failure cache, lifecycle token, generation/run-token barriers, and exception-isolated subscriptions.
- [ ] Run the Task 1 test until all cases pass.

### Task 3: Normalize producers and poller ports

**Files:**
- Modify: `src/bilibili/parsers/superchat-parser.js`
- Modify: `src/bilibili/utils/user-meta-extractor.js`
- Modify: `src/bilibili/danmaku/message-handlers.js`
- Modify: `src/bilibili/danmaku/history-poller.js`
- Modify: `src/bilibili/danmaku/online-rank-poller.js`
- Modify: `src/bilibili/danmaku/fans-medal-poller.js`
- Modify tests for these modules

**Interfaces:**
- Poller sink: `{ ingestHint(hint, context), replaceOnlineSnapshot?(uids, context) }`
- Poller start: `start(roomRunContext)` where context is the frozen value returned by `beginRoomRun()`

- [ ] Add the SC `user_info.face -> avatarUrl` mapping and preserve medal `targetUid` through extractors.
- [ ] Have message handlers submit hints and adapt the returned snapshot back to existing message fields.
- [ ] Give every poller a local generation check after each await and immediately before each sink call.
- [ ] Make history polling non-reentrant, keep stable old→new order, and deduplicate before identity ingestion.
- [ ] Verify focused parser/poller/message-handler tests pass and no poller imports `IdentityCache` or calls profile/avatar APIs.

### Task 4: Coordinate the room runtime and explicit avatar flow

**Files:**
- Modify: `src/bilibili/danmaku-client.js`
- Modify: `src/server/bilibili-client.js`
- Modify: `src/server/bilibili-runtime.js`
- Modify: `test/danmaku-client.test.js`
- Modify: `test/server-bilibili-client-avatar.test.js`
- Modify: `test/bilibili-runtime.test.js`

**Interfaces:**
- `BilibiliDanmakuClient.ensureUserInfo(uid, options)` delegates to the facade.
- Runtime game resolver consumes `userInfoService.ensure(uid, { fields: ['name', 'avatarUrl'] })`.

- [ ] Set room scope after room resolution and call `beginRoomRun()` once for the coordinated producer group; reuse its context on individual poller restarts/reconnects.
- [ ] On client/runtime stop, end the current run; dispose the shared service only when the runtime itself stops.
- [ ] Remove `onMessage() === true`, `resolveDanmakuAvatar`, `avatarProfileRequests`, and `onAvatarResolved`.
- [ ] Explicitly call `ensure(...avatarUrl...)` only when draw-guess needs a missing avatar, then update the existing game session callback.
- [ ] Route winner-profile through the facade while preserving `{ avatarUrl, name }`.

### Task 5: Synchronize architecture facts and lifecycle evidence

**Files:**
- Modify: `docs/architecture/backend/bilibili/danmaku.md`
- Modify: `docs/architecture/backend/bilibili/protocol.md`
- Modify: `docs/architecture/engineering/ai-workflow.md`
- Modify: `docs/architecture/engineering/legacy-boundaries.md`
- Modify: `specs/bilibili-user-info-service_design.md`
- Modify: `specs/README.md`

- [ ] Document the service owner, producer ports, room-run lifecycle, explicit avatar flow, and focused tests without duplicating endpoint contracts.
- [ ] Mark the spec `Implemented` only after all required gates pass and update runtime evidence to the new owner/tests.

### Task 6: Verify and review

- [ ] Run focused tests:

  ```powershell
  node --test test/bilibili-user-info-service.test.js test/bilibili-superchat-parser.test.js test/bilibili-fans-medal-poller.test.js test/danmaku-client.test.js test/server-bilibili-client-avatar.test.js test/bilibili-runtime.test.js test/game-routes.test.js
  ```

- [ ] Run `npm run check`, `npm run verify:architecture`, `npm run verify:quick`, and `npm test`; expect zero failures on Node 24+.
- [ ] Run `git diff --check`, inspect `git diff` and `git status --short`, and confirm every task-owned line maps to the accepted specification.

## Rollback or Failure Handling

Stop at the first failing focused layer, inspect only task-owned hunks, and reverse only those hunks with `apply_patch`. Do not use broad checkout, reset, clean, or deletion commands; unrelated worktree changes must remain untouched.

## Done When

The facade is the sole production merge owner; all room-scoped producers use a shared valid context and injected sinks; implicit avatar resolution and direct game profile fetches are gone; compatibility contracts remain unchanged; focused, architecture, quick, and full test gates pass; facts and spec status match runtime evidence; final diff review is clean.

## Verification Results

- Node.js `v24.15.0`.
- Focused Bilibili/service/poller/client/runtime tests: passed.
- `npm run check`: passed (`407` JavaScript files).
- `npm run verify:docs`: passed.
- `npm run verify:architecture`: passed.
- `npm run verify:quick`: passed.
- `npm test`: passed (`768` passed, `1` skipped, `0` failed).
