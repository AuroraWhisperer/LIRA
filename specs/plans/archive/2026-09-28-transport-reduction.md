# Transport Reduction Implementation Plan

**Status:** Completed (2026-09-28). All three authorized changes are implemented and verified; independent repository-gate failures and the release-pin limitation are recorded below.

**Goal:** Remove repeated game canvas/chat payloads, bound fans-medal polling work, and use canonical song fields across the desktop and server.

**Architecture:** Extend the existing domain services, HTTP snapshots and WebSocket messages. Preserve the current identity TTL and full-library synchronization. No new service, runtime dependency or database migration.

**Tech Stack:** Node.js 24, CommonJS domain modules, browser ESM, Node test runner.

## Constraints and ownership

- Existing unrelated changes are preserved; no commits or publishing are requested.
- Game owner: `src/games/game-session-service.js`; consumers: overlay and Admin games modules; contract: `docs/reference/backend/ws.md`; requirements and acceptance: `specs/danmaku-draw-guess_design.md`.
- Polling owner: `src/bilibili/danmaku/fans-medal-poller.js`; identity merge remains in `UserInfoService`; contract: `docs/reference/backend/bilibili/danmaku.md`; requirements: `specs/bilibili-user-info-service_design.md`.
- Song owner: server `src/lib/song-library.js`, existing tenant store and desktop license/sync boundary. Update server REQ/AC-SONG-001, API descriptions, schemas and tests together. The user's single-tester requirement supersedes retaining legacy wire aliases. Internal SQLite and import field names remain separate contracts.
- Authorization, tenant boundaries, reveal-answer filtering, 5000-song and byte limits are retained.

## Milestones

- [x] Game transport: full snapshots on start/round change/recovery; ordered session-scoped chat/state/avatar deltas and existing drawing operations. Queue events during snapshot recovery; reject stale round drawing. Update both receivers and overlay projection.
- [x] Polling: idempotent same-context start, sequential page/time budget with continuation, generation-safe completion and bounded failure backoff. Healthy complete refresh target remains five minutes; expired evidence is not renewed on failure.
- [x] Songs: one canonical wire DTO for upload/download/public and management consumers; explicit local-to-wire mapping; remove wire alias fallback. Update OpenAPI semantic versions and migration description without changing Device authentication v2.

## Verification

Each milestone first adds focused regression assertions, then implements and reruns them. Representative assertions:

```js
assert.equal(Object.hasOwn(chatEvent, 'session'), false);
assert.equal(Object.hasOwn(chatEvent, 'state'), false);
assert.equal(JSON.stringify(chatEvent).includes('strokes'), false);
assert.deepEqual(recoveredCanvas, authorityCanvas);
assert.equal(pageCallsAfterSameRoomRestart, pageCallsBeforeRestart);
assert.equal(Object.hasOwn(songResponse, 'name'), false);
assert.equal(songResponse.enabled, false);
```

- Games: Node tests under `test/games/`, targeted overlay projection and frontend state tests, plus new snapshot/delta recovery tests.
- Poller: `node --test test/bilibili/bilibili-fans-medal-poller.test.js test/bilibili/bilibili-user-info-service.test.js` with fake clocks and deferred requests, no Bilibili network.
- Songs: server song projection/validation/sync/budget and HTTP/contract tests; desktop license/cloud-song tests and synthetic two-checkout roundtrip.
- Repository gates justified by public-contract changes: documentation, JS syntax, architecture and contract schema checks; inspect scoped diff, `git diff --check`, final status. No live account or real user database is used.

## Failure handling and completion

Task-owned pre-edit files are saved outside either repository under `D:/Work/lira-audit/08-transport-research-2026-09-28/implementation-baseline`. If a check fails, fix only related implementation/contract mismatches. Do not reset repositories or weaken contract checks to accept an invalid fixture.

Done when all three behaviors and their contracts are consistent, focused checks pass, and final scoped diff is reviewed. The pinned server contract checkout cannot truthfully identify uncommitted runtime changes as a published commit; any such release-only verification limit must be reported explicitly.

## Completion evidence

- Server: `npm test` — 1804/1804 passed. After the final input-schema metadata clarification, documentation, Device contract, projection and cloud HTTP checks passed 39/39.
- Client: `npm run test:offline` — 2740/2742 passed. Both failures predate this task and are in untouched files: the modularity registry lacks reviews for `public/css/admin/gift-display.css` and `test/gifts/frontend-gift-display-settings.test.js`; the empty-catch gate reports `public/js/admin/start-animation.js`. They were not altered or exempted.
- Client: `npm run check` — all 1038 JavaScript files passed syntax checks. Game receiver tests exercise chat/score/avatar merging, reconnect buffering, stale snapshots, retry limits, drawing replay and old-round queued operations. Poller tests use synthetic pages and a fake clock.
- Cross-checkout HTTP: `node scripts/verify-song-roundtrip.cjs --working-tree D:/Work/Live D:/Work/lira-server` — 5/5 passed, including 5000 songs, exact byte bounds, UTF-8 and transactional rejection. The 5000-song sample uploads 1,978,901 bytes and reads back 2,417,860 bytes.
- Synthetic before/after measurement: 1000 canvas points plus 100 later ordinary messages to one overlay: 3,165,374 -> 25,618 JSON body bytes; 1000-song Device snapshot: 517,337 -> 328,554 bytes. This excludes framing/compression and the initial canvas snapshot; it is not a production traffic measurement.
- Both working directories retain unrelated existing changes. Task-owned differences were reviewed against saved pre-edit copies; no schema migration, dependency, commit or deployment was introduced.
- Formal release still requires advancing `server-contract.lock.json` after the server changes have a committed revision. The explicit working-checkout roundtrip verifies the current pair and does not pretend to verify that release pin.
- Detailed logs and pre-edit evidence: `D:/Work/lira-audit/08-transport-research-2026-09-28`.
