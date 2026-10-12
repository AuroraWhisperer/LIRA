# Fan song retention implementation plan

Status: Awaiting Verification (2026-10-12).
- Accepted scope: current user request, superseding per-request fan song history.

## Goal and decisions

Keep one song summary per profile and normalized song/artist, its lifetime count
and latest three distinct Shanghai dates. Retain daily category counts for the
latest 30 Shanghai calendar days (today and 29 preceding dates), as confirmed by
the user. Do not retain per-request originals, queue states or revision history
for songs. Manual preferences and other profile records remain unchanged.
Clear terminal queue/request rows atomically and retain only bounded random
selection/mention context. Keep two automatic restore snapshots per scope.
Clean already-expired AI cache entries when initializing their existing store.

## Current behavior and ownership

- `queue-store.js` retains terminal rows; `requests` supplies random context and
  legacy import. `queue-history-store.js` will own bounded replacement context.
- `fan-record-store.js`, `profile-service.js`, `profile-facts.js` own fan songs;
  `profile-transfer.js` and `profile-merge.js` own backup/merge consumers.
- `database-migrations.js` appends migrations; existing migrations stay immutable.
- `fan-snapshot-retention.js` owns the per-scope two-snapshot bound.
- `public/js/admin/fans/view.js` owns compact music presentation.
- Contracts: `specs/fan-profiles.md`, storage/frontend/AI references and the
  toolbox work usage guide. Tests live in fan-profiles, songs, storage and AI.

## Compatibility and limits

- Preserve existing dirty checkout changes, scope isolation and atomic rollback.
- Convert existing fan songs and the retained snapshots before deleting old raw
  queue history; do not backfill missing fan records from historical requests.
- Bump complete fan backup format to v2; accept and compact v1 backups on import.
- Mark active requests already archived to prevent replay counting; deleted
  requests cannot be replayed into fan history. Do not introduce an unbounded
  receipt ledger. Preserve handwritten song notes in the compact record.
- Keep normal preferences, membership, reminders, cooldowns and library data.
- No arbitrary retention dates for SC, lotteries, server histories or audit logs;
  gift retention is separately in progress. No production database manipulation.

## Milestones

- [x] Persist compact songs, convert old songs/snapshots, preserve backup/merge
  round trips and active request replay protection. Verify with isolated music,
  migration, transfer and merge regression tests (counts, dates, scope, rollback).
- [x] Atomically delete terminal queues/requests; preserve last 10 random songs
  and latest identifiable random requester. Verify queue and random suites.
- [x] Cap snapshots at two and prune expired AI cache on initialization. Verify
  transfer/merge rollback and AI config/log/quota suites.
- [x] Render compact songs without per-request expansion and update the 30-day
  label, manual song form, affected guidance and contracts. View/form and usage
  guide tests passed.
- [ ] Complete isolated desktop visual/interaction verification and clean up
  its remaining temporary instance; see the tool limitation below.

## Verification and failure handling

Run affected suites with `node --experimental-vm-modules --test` and the matching
test files; run `npm run verify:docs`, `npm run check` and architecture gates for
the new persisted-format owner. Inspect the final scoped diff and run
`git diff --check`. Record unrelated failures separately without changing them.
Tests never migrate real user data. Migration failures roll back the version and
all conversion/deletion together; restore failures roll back snapshot pruning.
Rollback code only with reviewed task-specific patches, never checkout/reset.

## Verification evidence and remaining work (2026-10-12)

- Focused run: all `test/fan-profiles/*.test.js`, storage retention and database
  initialization, queue service/random/cooldown, and AI config/log/quota tests:
  299 passed. Contract tests used the pre-existing read-only matching server
  worktree at `tmp/guard-accompany-contract`; the main server checkout was not
  reset or changed. `test/admin/frontend-usage-guide.test.js`: 16 passed.
- `npm run check`: 1495 JavaScript files passed. `npm run verify:architecture`:
  27 passed. Focused logs are in ignored `tmp/fan-song-retention/`.
- Migration coverage verifies real old song rows and restore snapshots,
  idempotence, transactional rollback, active request replay protection,
  v1/v2 backup conversion, and merge/restore preservation. Repeating one song
  1000 times leaves one summary. Future daily buckets after clock rollback are
  retained but excluded from display until their date arrives.
- The broader storage run initially found gift v17 expectations, synthetic old
  migration replay fixtures and a spec-index evidence link error. The authorized
  [retention follow-up](archive/2026-10-12-retention-followup.md) repaired the fixtures and
  index without weakening data preservation or pagination checks: both storage
  suites passed 13 cases and the documentation gate passed 10 cases. The gift
  feature itself remains owned by its separate implementation task.
- Desktop QA launched only the existing isolated Electron fixture, with all
  data/session paths under `tmp/fan-song-retention-desktop-1791813578441` and
  synthetic fan data. The REPL timed out before returning interaction evidence.
  Automatic approval review then blocked the command to terminate the fixture
  and remove its directory, returning only "blocked by policy". No alternate
  cleanup or automation bypass was attempted. That instance/directory may
  remain; no user app was controlled or restarted. Desktop visual acceptance
  is not claimed and remains open.
- Specifications, storage/frontend/AI references and both affected in-app
  usage guide sections are synchronized. No production database was opened or
  migrated; existing data conversion runs when the updated app starts.

## Done when

Repeated requests grow counters and bounded recent data; terminal queues do not
accumulate; replay, backups, restore and merges preserve counts; two snapshots
remain; intended user-facing behavior and documentation agree; affected checks
pass or concrete independent limitations are reported.
