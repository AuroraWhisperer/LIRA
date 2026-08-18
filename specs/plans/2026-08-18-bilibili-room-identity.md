# Bilibili Current-Room Identity Implementation Plan

**Goal:** Ensure queue requester badges show only the fan medal and guard status belonging to the active livestream room, including users whose worn medal belongs to another room, while filling users omitted from the online榜 with the full-room fan-medal member snapshot.

**Architecture:** Keep parsing in `src/bilibili/utils/user-meta-extractor.js` and pass a verified-current-room marker through each Bilibili message source into `IdentityCache`. Add the platform's paginated `getFansMembersRank` as a low-priority snapshot poller; point-song message evidence remains authoritative and cannot be overwritten by snapshots. The queue/storage/public overlay contracts remain unchanged; only their upstream normalized values become room-scoped.

**Tech Stack:** Node.js 24 CommonJS, Bilibili DANMU_MSG/HTTP payloads, `node:test`.

## Non-goals

- No database schema or queue overlay contract changes.
- No homepage/profile lookup, guessed medal names, or fallback to another room's worn medal.
- No new network service or runtime dependency.

## Current Behavior

- A DANMU_MSG can expose both `info[3]` and `info[0][15].user.medal`; the current extractor chooses the nested target first and then may select the wrong candidate.
- History and SuperChat parsers do not consistently enforce current-room target IDs.
- `IdentityCache.resolve()` does not receive whether the incoming identity was verified for the current room, allowing stale values to merge.
- The existing online榜 poller is intentionally limited to three pages and cannot cover all fan-medal members.

## Ownership

- Owner: `src/bilibili/`, contract: `docs/architecture/backend/bilibili/protocol.md` and `docs/architecture/backend/bilibili/danmaku.md`.
- Consumers: `src/bilibili/danmaku/message-handlers.js`, `src/bilibili/danmaku-client.js`, queue service and overlay storage fields.
- Tests: `test/bilibili-user-meta.test.js`, `test/bilibili-identity-cache.test.js`, parser/message-handler tests.

## Compatibility Constraints

- Preserve `requesterMedalName`, `requesterMedalLevel`, and `requesterGuardLevel` fields and queue/database schemas.
- Preserve current-room online-rank enrichment and existing no-room-owner unit-test behavior.
- Keep `getFansMembersRank` pagination bounded by its `data.num` response and stop safely on empty/short pages; a malformed response must not create identities.
- Keep CommonJS style, context/security boundaries, and public Bilibili request contracts intact.

## Proposed Changes

- Select medals by each candidate's explicit `ruid`/`target_id` instead of mixing fields from separate candidates.
- Carry room-verification and evidence source into the internal identity cache without changing queue or database shapes.
- Page through `getFansMembersRank` every five minutes and cache only records verified against the current主播 UID.
- Preserve point-song DANMU_MSG/SC evidence over lower-priority HTTP snapshots.

## Milestones

1. Add failing regression for a current-room `info[3]` medal alongside a foreign nested medal; verify it fails.
2. Implement candidate selection by explicit `ruid/target_id` and independent guard extraction; run metadata tests.
3. Thread `currentRoomVerified` through history, SuperChat, live client, and identity cache; run source/cache tests.
4. Add full-room fan-medal API client/poller and source-priority cache merge; run poller and client tests.
5. Run focused tests, `npm run check`, `npm run verify:quick`, and inspect `git diff --check`/status.

## Verification

- `node --test test/bilibili-user-meta.test.js test/bilibili-identity-cache.test.js test/bilibili-superchat-parser.test.js test/bilibili-fans-medal-poller.test.js test/danmaku-client.test.js`
- `npm run check`
- `npm run verify:quick`
- `git diff --check` and `git status --short`

## Rollback Or Failure Handling

Stop after the focused regression if protocol semantics remain ambiguous. Inspect only the scoped diff and revert task-owned edits manually; do not reset or broadly delete files.

## Done When

The mixed-medal regression displays the current-room medal and correct guard level, foreign medals never populate queue identity fields, full-room fan-medal snapshots cover users omitted from the online榜 without overriding point-song evidence, all focused and quick gates pass, and only scoped source/tests/docs/plan files change.
