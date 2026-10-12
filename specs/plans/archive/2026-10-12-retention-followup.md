# Retention follow-up implementation and verification

Status: Complete

## Goal and authorization

The user explicitly authorizes fixing every clearly disposable or safely
compactable growth item from the storage audit, with parallel work, leaving only
genuine product retention choices unresolved. Continue the fan song work without
commits, publishing, stopping the installed user app, or direct live DB surgery.

## Owners and decisions

- `src/server/startup-retention.js` and `src/server.js`: run the already configured
  retention policies periodically while the app remains open; preserve disabled
  policies and dispose the owned timer before closing storage. Do not select new
  SC/gift retention dates or enable server gift deletion.
- Fan stores: v14 shares repeated data/original JSON from unedited automatic
  roster observations in scope-isolated templates, retaining every observation
  ID/source key/date. Discrete historical membership lookups consume these dates;
  they cannot be discarded or replaced with assumed continuous intervals. Edit
  expands the original evidence atomically, deletion/restore reclaims orphan
  templates, and backup public shapes remain unchanged. No-op saves do not append
  empty revisions; real changes and existing revision history remain.
- `src/storage/retention.js`, `song-store.js`, `src/ai/api-quota-store.js`:
  reclaim unused import batch summaries; expire song cooldown entries only beyond
  the maximum supported 999-day period, never just the current shorter setting;
  retain current/previous Beijing month quota counters and future counters for
  clock rollback. Do not remove current budgets, configuration or blacklists.
  The architecture gate rejects additional SQL in the legacy AI module: move
  this table's existing prepared statements and pruning to the storage adapter
  `ai-api-usage-store.js`, keeping the public quota API and domain rules unchanged;
  remove the now-empty legacy SQL baseline instead of raising its allowance.
- `test/storage/database-maintenance.test.js`, `query-optimization.test.js`,
  gift query owner and `specs/README.md`: diagnose and repair the previously
  observed gift migration/query/doc checks without weakening data-integrity or
  pagination assertions. Preserve the independently progressing gift feature.
- Remaining domains: inspect existing retention contracts and consumers before
  selecting any cleanup. Keep genuinely required facts and deduplication receipts;
  unresolved duration/product choices are reported explicitly.
- Companion server: its existing global maintenance cadence also invokes the
  existing 24-hour daily-bot import expiry for idle staging. Preserve its receipt,
  pending-state and tenant boundaries; no new lifetime or gift setting. The server
  worker owns its scoped implementation, plan, documentation and focused tests.

## Parallel boundaries and verification

- [x] Runtime cleanup worker: implementation, lifecycle/disabled-policy/failure
  tests; owns only startup-retention, server wiring and matching tests.
- [x] Roster compaction worker: consumer analysis then lossless duplicate removal,
  focused fan tests and migration/restore equivalence. Coordinate migration
  registration with the parent before editing shared files.
- [x] Storage check worker: repair isolated upgrade fixtures, verify genuine old
  DB upgrades and repeated startup, preserve seek/query evidence, fix spec index.
- [x] Parent: safe small-table cleanup, source/docs synchronization, integration
  review and directly affected suites, `check`, architecture, docs and diff checks.

## Verification evidence

- The three new small-table cases failed before the implementation (old quota
  months retained, 3 import batches retained, missing cooldown cleanup) and now
  pass. All 42 affected quota/audit/retention/import cases passed. The AI audit
  consumer test follows the renamed maintenance entry and disposes its timer.
- Runtime timer, shutdown/failure and server smoke: 29 passed. Legacy storage
  migration/query suites: 13 passed, using genuine old columns and idempotence
  checks rather than replaying a new schema under a forged old version.
- The previously failed spec-index evidence link is corrected; the final client
  documentation gate passed 10 tests after the plan archive and reference updates.
- Final integrated client run: 372 passed across all fan-profile tests and the
  affected storage, clear-all, server lifecycle/smoke, AI and song/queue suites.
  `LIRA_SERVER_ROOT` used the existing unchanged pinned checkout
  `tmp/guard-accompany-contract`. Logs are in ignored
  `tmp/fan-song-retention/followup-integration.log`.
- The quota SQL ownership correction followed the initial architecture failure;
  25 complete quota/tools/audit tests then passed. `npm run check`: 1500 files
  passed; `npm run verify:architecture`: 27 passed. The quota legacy SQL allowance
  is removed, not expanded.
- Roster-specific synthetic tests cover historical as-of membership/reminder
  equivalence, manual/decided evidence preservation, no-op saves, scoped template
  recycling, backup v1/v2 and recovery snapshots, rollback and repeated upgrades.
- Companion server: 48 complete affected tests passed using its existing Node
  v24.18.0 runtime; the default v24.21 invocation was rejected by the supported
  runtime guard and was not counted as verification. `npm run docs:check` passed
  55 tests; its plan closeout passed 16 documentation-governance tests. No runtime
  version guard or gift deletion setting was changed.

## Remaining retention decisions

- SC and dynamic-lottery tasks/results still provide business history, recovery
  and event deduplication. Display limits are not data-retention rules. No new
  expiry date was invented for these records.
- Fan roster observations now share repeated evidence, but each actual historical
  time remains. Real handwritten revisions and reminder handling also remain for
  correction history, backup and preventing repeat reminders. Further removal
  requires deciding which old dates/history may cease to be available.
- Server audit/authentication history and viewer-count samples have history
  consumers and no accepted automatic cutoff. Their retention dates remain a
  product choice.
- Checkin/fortune daily facts, PK IDs/cumulative sequence and terminal import
  receipts continue to protect cumulative totals and duplicate rejection. These
  are retained facts rather than abandoned staging. New unique fans/songs and
  required facts can still grow; this work does not promise a fixed database size.
- Existing bounded caches, playback history and device challenge/ended-session
  expiry were verified to have live call sites; no redundant cleanup was added.

The previous isolated desktop fixture cleanup was blocked by automatic approval
review. Do not bypass that denial. Keep its known status separate from business
storage correctness; do not launch another unmanaged fixture.

## Documentation and rollback

Update storage and AI references, fan specification and affected guidance after
rules are fixed. Update the prior fan plan only with actual new evidence. Existing
backup/restore and original fact contracts remain unless this plan records a
verified representation change. Data transformation and source removal must be
atomic and restart safe. Tests use synthetic data only. Roll back task-owned
patches by reviewed edits; never reset the dirty checkout or change unrelated
production settings.

Storage/AI/server references and the fan specification now match these changes.
This follow-up adds no UI workflow or user-facing limit beyond the earlier song
work, so those already-updated in-app guides remain valid without another edit.
Automatic migration/maintenance applies when the updated application or server
is installed and run; this task did not replace the installed app, deploy, or
modify real databases. SQLite may reuse reclaimed pages without shrinking the
file immediately; no online VACUUM was added.

## Done when

Clear waste is bounded/removed using verified rules; counters, reminders,
membership and deduplication remain correct; known in-scope verification failures
are resolved or precisely explained; documents match behavior; the final report
lists only genuine remaining decisions and deployment/approval limitations.
