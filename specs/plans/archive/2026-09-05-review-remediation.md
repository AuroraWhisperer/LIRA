# Review Remediation Implementation Plan

## Goal

Resolve the fourteen findings from the current repository review, preserve the
modular monolith and existing user changes, and report the actual enforcement
status of the module standard after verification.

## Architecture And Constraints

- Electron main continues to embed the Node backend; no new process, framework,
  runtime dependency, frontend build step, or database schema is introduced.
- Preserve HTTP paths/envelopes, WebSocket payloads, IPC channels, settings keys,
  persisted song identities, and last-successful-cloud-write conflict semantics.
- Do not change authentication, secret handling, network access policy, or other
  security boundaries. Do not contact real upstream services or publish builds.
- Settings normalization belongs to a settings contract; transactions belong to
  the settings store. Cloud and gift sync retain separate state machines.
- Song persistence belongs to storage; cross-domain consumers receive focused
  capabilities. Browser transports share connection mechanics, not domain state.
- Existing staged, unstaged, deleted, and untracked user material is preserved.
- No commits, tags, releases, or destructive rollback commands.

## Current Evidence

The preceding read-only review passed syntax checks for 557 JavaScript files and
80 existing tests. In-memory reproductions found partial settings commits,
unrelated local settings triggering cloud uploads, conflicting setting ranges,
late cloud writes after disposal, missing initial gift retry, redundant gift
pulls, a late wheel timer, and divergent song separators. Frontend inspection
also found request-result and cache-key races, duplicated transports and obsolete
playback code. The full worktree already contains unrelated in-progress changes.

## Ownership And Milestones

### 1. Atomic Settings And Cloud Field Contract

Files: `src/storage/settings-store.js`, a focused settings contract/application
module, `src/server/routes/settings-routes.js`, `src/server.js`,
`src/server/api-context.js`, and relevant settings/cloud tests.

Interfaces: retain `setSetting(key, value)`; add an atomic batch capability that
reports changed keys. Local and cloud adapters use the same synchronized field
normalizers; only changed synchronized keys request cloud upload.

- [x] Regressions: invalid second field leaves the first unchanged; a local-only
  theme change does not request cloud sync; local/cloud numeric bounds agree.
  Example assertions: `assert.equal(saved.paused, 'false')` after HTTP 400 and
  `assert.deepEqual(dirtyScopes, [])` after changing `themeOpacity`.
- [x] Implement validate-then-commit, focused wiring, and contract reuse.
- [x] Verify settings, cloud runtime, and affected overlay settings tests.

### 2. Remote Sync And SSE Transport

Files: `src/electron/cloud-sync-controller.js`,
`src/electron/remote-gift-controller.js`,
`src/electron/license/remote-license-client.js`, a local SSE reader helper, and
their tests. No shared cloud/gift state-machine abstraction.

- [x] Regressions: resolve a deferred cloud read after stop and assert no writes;
  fail gift discovery transiently and assert a scheduled retry; deliver a burst
  of invalidations and assert bounded pulls while preserving new arrivals.
- [x] Add lifecycle invalidation, retry recovery, and gift notification coalescing.
- [x] Reuse SSE stream reading/cleanup while retaining event-specific parsing.
- [x] Verify controller and remote-client protocol tests with fake transports.

### 3. Playback And Overlay Frontend

Files: `public/js/playback/content/loader.js`,
`public/js/playback/services/home-service.js`, owning playback composition and
handlers, `public/js/overlays/{queue,songs,overtime,blindbox}.js`, their page
entries where needed, a focused browser socket helper, and affected tests.

- [x] Regressions: resolve request B before A and retain B; switch provider during
  a request and assert QQ data never enters a NetEase cache key; background
  refresh must not overwrite the active page state.
- [x] Capture immutable request identity, share cacheable actions, and remove
  the unused second playback implementation after checking every consumer.
- [x] Extract overlay connection mechanics without changing message filters,
  reconnection/resnapshot semantics, URLs, or page loading order.
- [x] Verify focused frontend tests and native ESM boundary checks.

### 4. Song And Runtime Ownership

Files: `src/music/song-field-utils.js`, `src/music/random-song-filter.js`,
`src/music/song-service.js`, a song storage adapter,
`src/server/domain-services.js`, `src/games/wheel-session-service.js`,
`src/server.js`, and their tests.

- [x] Assert full-width slash fields match consistently; preserve complete
  artist names containing punctuation and existing tag matching contracts.
- [x] Move song SQL/transactions into storage while preserving domain-facing
  return objects and narrow the demonstrated broad dependency bag.
- [x] Add idempotent wheel disposal and runtime-owned timer cleanup; assert no
  publish after disposal, including stop/restart of the backend.
- [x] Verify song/queue/import/cloud replacement and runtime lifecycle tests.

### 5. Catalog Lookup And Release Correctness

Files: `src/bilibili/gift/hybrid-catalog.js`,
`src/bilibili/gift/remote-gift-image-cache.js`,
`src/server/domain-services.js`, `src/overtime/overtime-service.js`,
`scripts/publish-release.js`, and focused tests.

- [x] Assert resolving one legacy rule image does not decorate the entire gift
  directory, and catalog/image updates invalidate the lookup appropriately.
- [x] Replace full-snapshot lookups with the catalog's focused ID capability.
- [x] Make release preflight and success verification testable without running
  external commands; reject dirty/mismatched source state and do not accept old
  remote assets as evidence that a failed build succeeded.
- [x] Verify catalog/overtime and offline release tests; never run publication.

### 6. Acceptance And Module Standard

Files: directly owning architecture documents, module-boundary tests, and this
plan. Record changed ownership and real enforcement, not aspirational compliance.

- [x] Update owning contracts and strengthen regression gates for the changed
  boundaries. Keep documented legacy exceptions explicit and decreasing.
- [x] Run `npm run verify:quick`, then the full isolated repository test suite.
  Investigate any failures only as necessary for this change; separate unrelated
  pre-existing/environment failures from task regressions.
- [x] Review task diffs, `git diff --check`, and `git status --short`; confirm no
  generated runtime or sensitive material was introduced.
- [x] Report all fourteen finding outcomes and a rule-by-rule assessment of
  module-standard enforcement; archive this plan only after completion.

## Failure Handling

Each milestone has independent tests and can be reviewed before the next. On a
contract conflict, pause that milestone and record the concrete issue. Rollback,
if necessary, applies only task-owned edits after inspecting the overlapping
user changes; never reset or replace the worktree wholesale.

## Done When

Every review finding is either fixed with focused evidence or explicitly
reclassified with concrete code evidence; relevant full gates pass or their
external limitations are reported; owning documents match implementation; the
final module assessment distinguishes enforced rules from remaining legacy debt.

## Execution Notes

- The writing-plans execution subskills are unavailable. Execution uses the
  primary agent plus one bounded Luna worker at a time, with primary acceptance.
- Initial plan created before source edits; remediation is complete.
- Settings tests and related consumers passed. Remote sync/SSE tests: 48 passed.
- Gift point lookup/catalog tests: 19 passed; song field tests: 28 passed;
  wheel lifecycle tests: 4 passed; offline release tests: 4 passed.
- Artist punctuation remains an explicit compatibility mode: random matching
  preserves commas within names while library filters retain comma-separated
  imports. Both now share the same field parser and full-width slash support.
- Playback's main changes passed 24 focused tests. Parent acceptance identified
  one additional same-cache-key stale-write case; it is assigned back to Luna.
- Playback acceptance now also covers shared cached readers and overlapping
  background/explicit refreshes; per-key request records are cleaned up.
- The overlay connection adapter lives in `public/js/overlays/socket-client.js`,
  not shared utilities: it owns protocol resources and remains an adapter.
- An independent user task is implementing the blind-box v2 catalog in the same
  worktree. Its schema, settings, catalog, and Admin changes are preserved. Shared
  settings already extend the new common contract. Final checks must distinguish
  transient failures in that concurrent work from this remediation.
- SongStore migration passed 65 focused tests and 11 server smoke tests. Parent
  review restored the original SQL LIKE/collation filtering and stable ordering,
  protected supplied invalid update IDs from becoming inserts, removed an unused
  defaults capability and obsolete LIKE helper, and verified injected storage
  failure rollback. The old song-service SQL baseline has been removed.
- Parent bridge-only adjustments keep the concurrent blind-box feature's two
  new consumers inside the existing Admin compatibility boundary, without
  raising its debt budget or changing the feature.

## Final Acceptance

| Review Items | Outcome | Evidence |
| --- | --- | --- |
| 1, 3, 4: settings scope, atomicity, validation | Shared contract and atomic store batch; only changed synchronized fields upload | `test/settings-contract.test.js`, cloud runtime tests |
| 2, 5, 7: sync recovery, late responses, duplicate pulls | Cloud generation/abort checks; retryable gift initialization recovery and coalesced catch-up | Cloud/remote gift controller and remote client tests |
| 6: playback request/cache races | Immutable request identity, latest-per-key writes, shared in-flight cached readers | `test/playback-home-lifecycle.test.js` |
| 8: wheel resource lifecycle | Owned timer cancellation, idempotent disposal, runtime shutdown wiring | Wheel tests and module gate |
| 9: field parsing drift | Shared field parser with explicit artist punctuation compatibility | Random/song library tests |
| 10: artwork snapshot hot path | Indexed single-gift lookup without full-catalog image inspection | Remote catalog point-lookup tests |
| 11: publication false success | Clean source/tag gates, build failure handling, content digest verification | Offline publication tests |
| 12: repeated transports | One remote-client SSE reader/block parser; one adapter for four reviewed overlays | Remote client/overlay socket tests, ESM page tests |
| 13: song storage and broad context | SQL/transactions in SongStore; narrowed gift and command capabilities | Fake-store, rollback, query compatibility, smoke and module tests |
| 14: duplicate player | Obsolete player removed; current playback and persistence share history limits | Playback tests and no-reintroduction gate |

- `npm run verify:quick`: passed; 564 JavaScript files, 13 architecture checks,
  and 5 documentation checks.
- `npm test -- --test-reporter=tap`: 1218 passed, 0 failed, 0 skipped/cancelled.
- The first full run identified four stale schema-version assertions and the
  pre-v2 CLI fixture from the concurrent blind-box task. Fixtures now reflect
  schema v9 and the v2 URL/fields/cache names; legacy rows are additionally checked
  to retain a null blind-box ID. No runtime schema was changed by this task.
- Scoped diffs were reviewed and `git diff --check` passed. Existing LF/CRLF
  configuration warnings are not whitespace errors.
- No commit, tag, publication, production data mutation, or live server/OBS/
  Electron integration run was performed.

Module-standard assessment: the repaired paths have executable ownership and
lifecycle gates. Repository-wide status remains incrementally enforced because
other registered domain SQL, legacy Admin globals, generic shared utilities,
computed dependencies, and complete public-contract coverage are not fully
migrated or machine-enforced. See the owning modularity standard and legacy
boundary registry rather than treating a green test suite as full compliance.
