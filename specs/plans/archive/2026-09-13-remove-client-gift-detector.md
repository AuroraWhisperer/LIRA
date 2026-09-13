# Remove Client Gift Detector Implementation Plan

> Status: Completed on 2026-09-13. Executed inline without commits.

**Goal:** Delete the obsolete client raw gift detector, parser/accounting helpers,
repair routines, and their dedicated tests; the server owns all gift decisions.

**Architecture:** Replace the mixed detection service with a projection service
that imports validated server events and dispatches existing local consumers.
Extract only user identity hints from local Bilibili messages, independently of
gift amount, grouping, or blind-box classification.

**Tech Stack:** Existing Node.js 24 CommonJS, node:sqlite, node:test.

## Requirement and boundaries

The user explicitly rejected retaining local detection for compatibility after
the preceding server-only runtime change. This supersedes that change's decision
to keep a raw detector/repair branch for old tests. Preserve stored history,
database migrations, server DTO validation, source isolation, remote cursor and
transaction behavior, and local consumer idempotency. No changes to the remote
server, authorization, packaging, publication, or unrelated dirty files.

## Ownership and current evidence

- `gift/detection-service.js` still contains `detect`, local combo timers, and
  `processedOnly`; domain assembly merely hides them.
- `gift/event-service.js`, `storage/gift-event-store.js`, the raw gift parsers,
  `utils/gift-normalizers.js`, and `blind-box-config.js`'s name-matching map
  support that obsolete path. User identity handling still imports its parser.
- `gift/index.js` composes import/query/consumer services. Server gift imports,
  local statistics, overtime, and clear-all controls must retain their behavior.
- Dedicated capture/guard/repair tests assert the obsolete algorithms. Analysis,
  consumer retry, and database migration tests remain relevant and must be
  converted or retained, rather than deleted with those algorithms.
- Owners: gift domain and Bilibili identity; contracts are the server-authoritative
  gift spec and backend gift/protocol documents. Storage schema remains unchanged.

## Milestones

- [x] Replace the mixed service with `createGiftProjectionService` in
  `gift/projection-service.js`; delete raw detection, raw normalization,
  local finalization timers, repair exports and the `processedOnly` branch.
  Project the already-canonical `event.gift` directly:

  ```js
  const gift = { ...event.gift, platformId, cmd: REMOTE_GIFT_COMMAND,
    uid: '', rawJson: '' };
  ```

- [x] Delete raw parser/accounting helpers. Add a narrow identity extractor that
  returns only UID, name, avatar, and verified guard hints, including V2 identity
  fields. Message handling must never compute gift money or invoke `onGift`.
- [x] Delete obsolete raw-detection tests and convert useful analysis/effect/
  retry tests to server DTO fixtures. Preserve migration tests and add checks
  for identity-only extraction, no raw entrypoints, no local progress finalizing,
  unchanged server values, retry, pause/resume, and duplicate-final idempotency.
- [x] Update current owner docs and module-boundary baselines for removed files.
  Historical plans/ADRs stay historical; current docs must not describe a client
  raw detector or compatibility fallback as an available component.
- [x] Run focused affected tests, `npm run verify:quick`, then `npm test`; review
  the final diff, run `git diff --check`, and inspect `git status --short`.

## Verification and failure handling

Focused checks cover processed import, consumer retry, identity, guard metadata,
analysis, catalog/settings, remote gift controller/cursors, gift sync, clear-all,
and startup. They use synthetic packets and isolated temporary databases only.
If a check fails, repair only the affected scope; reverse task-owned hunks if
necessary, never reset the worktree or touch production data.

Done means no client raw gift detector/repair implementation remains, identity
handling does not depend on gift accounting, server results reach existing local
consumers correctly, verification passes or a concrete unrelated limitation is
recorded, and the task diff is reviewed. Archive this plan with actual results.

## Completion evidence

- Replaced the mixed detector with the server projection service and deleted raw
  detection, combo timers, price inference, blind-box matching, repair/store
  helpers, dedicated parser tests, and the orphaned raw message debug buffer.
- Extracted sender and verified guard hints into `users/gift-identity-hints.js`.
  The local message handler has no gift accounting callback or raw gift result.
- Preserved source-scoped imports, history/cursor transactions, frozen consumer
  eligibility, retries, and storage migrations. Recovery now excludes old local
  finals as well as leaving old local progress untouched.
- Final focused run: **111 passed, 0 failed**, covering identity, projection,
  imports, analysis, effects, startup, Bilibili client, diagnostics, clear-all,
  remote gift controller, gift sync storage, and module boundaries.
- `npm run verify:quick`: passed after the final source change.
- Latest `npm test`: **1712 passed, 1 failed, 2 skipped**. The sole failure is
  `test/danmaku-overlay.test.js:11` (`fixed danmaku overlay consumes snapshot and
  incremental feed events safely`), whose CSS assertion requires the previous
  outline nickname absolute/top/left/transform rules. Concurrent, unrelated
  edits in `public/css/overlays/danmaku.css` remove those rules. Neither that CSS
  nor its test was changed by this task. An earlier full run passed all 1713
  active tests before those unrelated edits arrived.
- Reviewed the affected diff, checked `git diff --check`, and inspected
  `git status --short`. Other tasks' changes are preserved. Test logs and helper
  scripts stay in the OS temporary directory; no runtime data or secrets were
  added. No server deployment, packaging, or publication was performed.
