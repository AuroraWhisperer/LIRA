# Feature: Source-partitioned gift ledger projection sync

- Status: Accepted
- Date: 2026-09-01

## Goal

Maintain a complete, source-partitioned local projection of the authenticated
streamer's authoritative paid gift ledger. The local gift page must remain
usable offline, must never expose another streamer during an authorization
switch, and must report whether its local history and statistics are complete.

## Context

The server-authoritative gift rollout established a live final-event cursor but
intentionally gave a fresh client a no-replay latest baseline. The local
`gift_events` table and the JSON cursor are not tenant-partitioned or committed
atomically, so they cannot support complete historical bootstrap, trustworthy
all-time statistics, or safe streamer switching.

This specification extends the existing design only when the server advertises
the gift-history bootstrap capability. A server without that capability keeps
the old live-event compatibility behavior and the client reports
`LEGACY_PARTIAL`; it never claims to have a complete ledger.

## Product Scope

- History contains paid gifts whose ledger rows are `final` and `active`.
- Super Chat is excluded and remains in its existing independent subsystem.
- The first statistics release supports `7d`, `30d`, `90d`, and `all` ranges.
- "Clear display" resets filters and does not delete projected ledger rows.
- Database-level gift clearing remains available, but atomically clears the
  local projection and synchronization state and then bootstraps again.
- Server gift ledger and delivery outbox rows are retained permanently in this
  protocol version. Deletion/tombstone synchronization is outside this change.
- Unique supporter counts are excluded because the display DTO intentionally
  contains no stable viewer identifier.

## Canonical Gift Contract

The canonical history predicate is:

```sql
detection_status = 'final'
AND status = 'active'
AND total_price > 0
AND num >= 1
AND (trim(gift_id) <> '' OR trim(gift_name) <> '')
AND datetime(created_at) IS NOT NULL
```

History and all-time analysis do not use `gift_stats_eligible` or
`counted_in_sprint` as visibility predicates. Those columns remain specific to
the live gift sprint consumer.

Both repositories implement equivalent pure canonical functions:

- `canonicalGiftId`: stringify, trim, and normalize to NFC.
- `canonicalGiftText`: stringify, collapse Unicode whitespace, trim, and
  normalize to NFC.
- `canonicalCoinType`: stringify, trim, lowercase, and normalize to NFC.
- Monetary values cross the wire as at most two decimal places and are converted
  to safe integer cents before comparison or aggregation.
- `createdAt` is parsed and emitted as UTC ISO 8601. `num` is a positive safe
  integer. An empty `userName` becomes `观众`.
- Ordinary gifts have `isBlindBox=false`, `blindBoxName=''`, and null blind-box
  money fields. For a blind box, value equals `totalPriceCents`; when cost is
  known, profit is always value minus cost. Unknown cost and profit remain null.

Canonical compatibility is verified against the shared
`gift-sync-v1.json` fixture once it is published by the server repository.

## Local Data Model

The gift database appends a migration with:

```sql
CREATE TABLE gift_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE gift_events
  ADD COLUMN source_id INTEGER REFERENCES gift_sources(id);

CREATE TABLE gift_sync_state (
  source_id INTEGER PRIMARY KEY REFERENCES gift_sources(id) ON DELETE CASCADE,
  sync_epoch TEXT,
  final_cursor INTEGER CHECK (final_cursor IS NULL OR final_cursor >= 0),
  bootstrap_complete INTEGER NOT NULL DEFAULT 0
    CHECK (bootstrap_complete IN (0, 1)),
  bootstrap_page_token TEXT,
  bootstrap_recovery_cursor INTEGER,
  bootstrap_sync_epoch TEXT,
  projection_generation INTEGER NOT NULL DEFAULT 1
    CHECK (projection_generation >= 1),
  last_validated_at TEXT,
  updated_at TEXT NOT NULL
);
```

Required indexes include source/time history lookup and the partial unique
remote key `(source_id, platform_id, cmd)` for
`cmd='LIRA_SERVER_GIFT'`. INSERT and UPDATE triggers fail closed with
`REMOTE_GIFT_SOURCE_REQUIRED` when a new remote row has no valid source.
Foreign-key enforcement is enabled for `gift-data.db`.

Existing rows remain `source_id=NULL`. In particular, legacy remote rows are not
assigned to a streamer because their origin cannot be proved and they do not
participate in any active-source query.

## Source Identity

`gift_sources.source_key` stores only a SHA-256 digest. Its exact input is:

```text
gift-source-v1\n<canonicalApiOrigin>\n<lowercase immutable accountName>
```

`canonicalApiOrigin` is produced with the WHATWG URL implementation. Userinfo,
path other than `/`, query, and fragment are rejected; the scheme and host are
canonicalized, IDN is converted by URL parsing, the default port and trailing
slash are removed. Every runtime requires a valid DNS hostname over HTTPS;
HTTP, localhost, IP literals, and invalid DNS labels are rejected. The key does
not include subdomain, mutable display name,
device ID, Device token, or internal streamer ID.

Electron main resolves the active source from the verified authorization
principal. Renderer requests cannot provide or override `sourceId`.

## Synchronization State And Transactions

`gift_sync_state` and projected gifts are the single synchronization source of
truth. The legacy JSON cursor is not read by the active path; it may only be
retained for diagnosis and archived after a successful bootstrap.

The storage owner provides transactions that atomically commit:

- one history page and its next page token;
- the final history page, completed state, epoch, and recovery cursor;
- one catch-up page and its monotonically increasing cursor;
- projection replacement, generation increment, and reset sync state.

`bootstrap_complete=1` requires a non-null epoch and final cursor and a null page
token. Any invalid/missing cursor, epoch mismatch, cursor ahead/too old, explicit
server rebuild, or local clear uses one `resetProjectionForRebuild(sourceId)`
transaction. It increments `projection_generation`, deletes only that source's
remote rows and related settlements, and resets cursor/token/epoch before a new
bootstrap. It never establishes a latest baseline over untrusted local rows.

A page is all-or-nothing. Invalid input or a canonical conflict rolls back both
rows and synchronization progress. An expired bootstrap token may retain the
same source/epoch/generation's partial rows and restart from page one so
idempotency absorbs them.

Remote-source rows are exempt from configurable age-based retention deletion.
Raw-payload scrubbing remains harmless because projected rows persist
`raw_json=''`.

## History-Only Import

History records have their own validator and importer and never enter the live
event importer. A projected record uses:

- `platform_id='lira-server:<eventId>'`, explicit captured `source_id`, and
  `cmd='LIRA_SERVER_GIFT'`;
- `detection_status='final'`, `status='active'`, and the server `createdAt`;
- `raw_json=''`, `uid=''`, `overtime_epoch=0`, `counted_in_sprint=0`,
  `gift_stats_eligible=0`, and `gift_stats_delivered=1`;
- first/last/final millisecond timestamps derived from `createdAt`.

It does not dispatch consumers, call `onGiftFinalized`, broadcast snapshots or
gift frames, or create overtime settlements. Re-import is successful only when
all canonical display fields, quantity, integer-cent money fields, blind-box
fields, coin type, and timestamp match. A same-source/event conflict fails the
whole page. The live importer also requires an explicit captured `sourceId` and
uses the same source-aware identity.

## Remote Protocol And State Machine

The main-process remote client supports:

- `GET /api/device/gift-history?pageToken=<opaque>` for history pages;
- epoch-aware `GET /api/device/gift-events?after=<cursor>&syncEpoch=<epoch>`;
- `X-Lira-Gift-Sync-Epoch` validation on the gift SSE response;
- a caller-owned `AbortSignal` for every HTTP request and stream.

The history DTO contains only `eventId` and the canonical gift display fields,
plus `nextPageToken`, `hasMore`, `recoveryCursor`, and `syncEpoch`. Tokens,
principal information, UID, room/streamer/internal IDs, command/platform/combo
IDs, raw packets, and complete response bodies are never logged.

The controller exposes these states:

```text
SOURCE_SWITCHING -> BOOTSTRAPPING -> CATCHING_UP -> LIVE
                                    \-> LEGACY_PARTIAL
any active state -> OFFLINE | ERROR
```

Every asynchronous operation captures and rechecks the immutable fence
`{sourceId, authorizationEpoch, controllerGeneration, projectionGeneration}`
before enqueueing, after awaits, and before a transaction. SSE is a dirty hint
during bootstrap/catch-up; pull is recovery truth. The controller serializes
imports, treats cursor gaps as catch-up work, and marks LIVE only after epoch and
latest-cursor validation with no dirty/gap/in-flight work.

On principal change, main first freezes the local gift API in
`SOURCE_SWITCHING`, increments controller generation, aborts HTTP and SSE, and
awaits `whenIdle()`. It then resolves the new source, exposes only that source,
and begins synchronization. A late response from the old source or a cleared
projection cannot write or advance state.

If `historyBootstrapVersion` is absent, the controller can retain compatible
live final delivery but sets `LEGACY_PARTIAL`; it does not mark bootstrap
complete or report complete statistics.

## Local Query And UI Contract

`GET /api/gifts/history` resolves `activeSourceId` internally and accepts
`query`, bounded time filters, `limit` up to 100, and an opaque/local keyset
cursor. Default ordering is `(created_at DESC, id DESC)` with a strict composite
boundary. There is no 3000-row preselection. Search uses parameterized
`instr(canonicalGiftText(gift_name), :query)` and the same expression for
`blind_box_name`; `%` and `_` are literal characters.

`GET /api/gifts/statistics` resolves the same active source and returns:

- `asOf`, range, `timeZone='Asia/Shanghai'`, `partial`, `syncState`,
  `syncedThroughCursor`, and `syncedAt`;
- summary event/item counts and integer-cent gift/blind-box totals;
- stable `topGifts` groups and day buckets, or month buckets for `all`.

All calculations use one event set captured at `asOf`, UTC half-open time
filters, and the canonical paid-final predicate. Only a fully validated LIVE
state returns `partial=false`; bootstrapping, catch-up, dirty, offline,
`LEGACY_PARTIAL`, switching, and error states remain partial.

The desktop client's recent-gift history drawer uses the traditional six-column
row table: time, gift, quantity, amount, user, and remarks. It retains name search,
`7d/30d/90d/all` range controls, sync/partial status, keyset history navigation,
and explicit loading/error/empty states. Summary, ranking, and trend dashboards
belong to the server web interface, not this drawer. The drawer requests history
only; the local statistics API remains available without changing its contract.
Resetting display clears UI filters only. New renderer modules use named ESM
imports/exports and do not add to `window.AdminApp`.

## Security

- Tokens and authorization epoch remain in Electron main only.
- Renderer-facing routes have no source selector and fail closed while there is
  no verified active source or while source switching is in progress.
- SQL is parameterized; sort/range fields use explicit allowlists.
- Wire objects are validated against explicit field allowlists and bounded
  lengths before storage.
- Page tokens, Device tokens, cookies, UID, raw packets, and full remote
  responses are never logged.

## Compatibility And Non-Goals

- Existing non-gift Bilibili handling, Super Chat, song requests, identity,
  games, gift sprint, overtime, overlays, and cloud settings remain active.
- The original no-replay baseline remains the compatibility contract for old
  servers and old clients. This specification supersedes that baseline only for
  a capable new client/server pair.
- No Redis, worker, pre-aggregation table, export-all endpoint, tombstone
  protocol, unique supporter metric, or renderer credential access is added.
- Performance architecture changes require measured failure of the documented
  query and final-to-SSE release gates.

## Acceptance Criteria

1. Different authorized streamers sharing an installation always query separate
   source partitions, including when their public event IDs are equal.
2. Switching principals freezes queries, aborts and drains old work, and never
   briefly exposes or writes the previous source.
3. A new/missing/untrusted projection bootstraps all canonical paid final active
   history for only the authenticated source and then catches up from the
   captured recovery cursor without a gap.
4. Multi-page bootstrap, crash replay, and token-expiry restart are idempotent;
   any invalid/conflicting row rolls back its entire page and progress marker.
5. Epoch mismatch, cursor ahead/too old, rebuild-required, and local clearing
   replace only the current source generation before rebuilding.
6. History-only imports persist the suppressed fields exactly and trigger no
   sprint, overtime, snapshot, frame, finalization callback, or consumer.
7. Same-source/event canonical conflicts fail closed. Same event ID in another
   source remains independent.
8. A late HTTP/SSE callback whose four-field fence is stale cannot write a row
   or advance token/cursor state.
9. A capable server reaches LIVE only after epoch/latest-cursor validation. An
   old server reaches `LEGACY_PARTIAL`, never complete.
10. Local history searches both gift and box names literally, pages beyond 3000
    rows with a composite keyset, and never accepts renderer `sourceId`.
11. Statistics use integer cents and the fixed time/range/blind-box semantics;
    only fully validated LIVE results report `partial=false`.
12. Clear-display changes no rows. Database gift/all clear resets projection
    generation and sync state in the same transaction and starts bootstrap.
13. Retention does not delete remote-source rows, and legacy null-source rows do
    not enter active-source results.
14. Remote DTOs and logs contain none of the prohibited identity, raw, internal,
    or credential fields.
15. Source identity accepts only a credential-free HTTPS root origin with a
    valid DNS hostname and rejects HTTP, localhost, IP literals, invalid DNS
    labels, non-root paths, queries, and fragments.
16. The desktop history drawer renders individual six-column rows without
    summary/ranking/trend panels or statistics requests, while preserving
    search, range, keyset navigation, and synchronization status.

## Done When

- Storage, canonical contract, importer, controller/fence, principal-switch,
  query/statistics, clear/rebuild, retention, API, and renderer tests pass.
- Shared fixture tests pass once the server fixture is present.
- Architecture, prior-design relationship, endpoint/storage documentation, and
  specification index reflect the implemented runtime.
- Focused tests, `npm run check`, `git diff --check`, and final scoped status/diff
  review pass without altering unrelated worktree changes.
