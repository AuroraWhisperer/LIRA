# Test Directory Layout Implementation Plan

**Goal:** Organize the desktop repository's tests by domain, update every live path consumer, and make focused verification easier without losing test coverage or changing runtime contracts.

**Architecture:** Keep Node's test runner, process isolation, existing helpers/fixtures and the five dependency groups. Domain directories describe ownership; execution groups continue to describe required runtimes. Extend the existing runner with recursive discovery and an optional domain filter.

**Tech Stack:** Node 24, CommonJS, node:test, existing VM/Chromium/Electron/NSIS fixtures.

**Status:** Implemented and verified. The follow-up media-fixture repair below closes the original intermittent Electron failure. The latest complete run passes 3,002/3,002 with no skips; the migration-stage results remain recorded below.

## Constraints and current behavior

- All 434 existing test files live directly under `test/`; 31 helpers and 11 fixture files already have separate directories.
- `scripts/run-tests.js` discovers only the first directory level. Package commands, governance records, documentation and test-relative imports reference the old paths.
- Preserve all existing scenarios, assertions, skip conditions, runtime groups, process isolation and default concurrency. No production changes, dependencies, commits or server repository changes.
- The working tree already contains business/documentation edits and a modified `frontend-admin-shell.test.js`. Initial bytes, hashes, staged content and group lists are saved at `C:/Users/Tom/AppData/Local/Temp/lira-test-layout-mfunNl`.
- The adjacent server checkout is newer than the locked contract revision. Use a separate local clone at the exact pinned commit for fixture verification; do not change the working server checkout or contract lock.
- A concurrent naming task renamed music authentication and streamer-planner files during preparation. No migration was applied until that task finished. The final migration baseline and original bytes are in `pre-migration/` and `state.json`; the earlier inventory remains in `before/` and `initial-state.json`.

## Ownership and compatibility

- Owner: `scripts/run-tests.js`; direct consumers: `package.json` and tests.
- Contract: `docs/reference/engineering/test.md`; related consumers: architecture routing, modularity registry, active specifications and documentation links.
- Domain folders group frontend/backend tests for the same feature together. Shared helpers and executable fixtures retain their current locations and ownership.
- Historical reports retain their recorded results; update navigable local file references without claiming a fresh historical execution.

## Milestones and verification

- [x] Capture the existing five disjoint groups and baseline full-run result. Record real failures/skips and elapsed time externally.
- [x] Produce and inspect a complete old-to-new mapping for 434 tests. Move each file one level deeper; adjust only location-dependent imports, root resolution, fixture paths and references.
- [x] Make the runner collect nested `*.test.js` files while excluding helpers/fixtures. Keep explicit dependency assignments and validate missing/duplicate entries. Add domain selection usable alone or intersected with an existing group; reject invalid or empty selections. Preserve Node flags, exit status and deterministic collection order.
- [x] Protect discovery/selection and execution with `test/engineering/run-tests.test.js`: nested files, helper/probe exclusion, partition completeness, domain/group intersections, invalid/empty selectors, Node option forwarding, process isolation and failure exit codes.
- [x] Update package commands, live documentation and governance paths. Explain domain ownership and focused commands in the existing test strategy rather than duplicate the complete inventory.
- [x] Compare all existing tests and five group memberships against the saved baseline. Run the new runner tests, `npm run verify:quick`, contract verification and the complete suite. Re-run only affected failures when needed; separate pre-existing failures and unavailable tools.
- [x] Compare baseline/final full-run measurements and measure one focused domain invocation. Report selection savings separately from any measured full-suite timing difference.
- [x] Review the task diff, `git diff --check`, final status, staged-content equality and preservation of unrelated initial files. Archive this completed plan with actual results.

## Failure handling

Migration uses a reviewed explicit mapping with repository-contained source/destination paths. Retain original bytes outside the repository and verify transformed contents. Investigate collection or import failures at their owning path; never remove tests, loosen assertions or change production behavior to make the migration pass. Revert only task-owned transformations if necessary.

## Done when

Every original test is collected exactly once in its original dependency group, paths and governance checks are valid, added selection behavior has focused regression coverage, full verification results and limitations are recorded, and unrelated user edits/staged content are preserved.

## Results and verification

- Moved all 434 tests into 25 domain directories. Kept the 31 helpers and 11 fixtures in place. Added one runner test file with five scenarios and a navigation-only `test/README.md`.
- Updated test-relative imports, fixture/root paths, package commands and references in 108 existing documentation/configuration files. Historical reports and archived plans retain literal execution history; navigable local test links are updated.
- Collection comparison preserves every original test's identity, list order and runtime-group membership. Final file counts: all 435; offline 402, browser 9, desktop 7, installer 5, contracts 12. The only addition is the runner test in offline.
- The first post-migration complete run exposed a location-dependent sandbox fallback in `capture-bilibili-events.test.js`. Its mocked loader now uses `createRequire(filename)` for the script's real dependencies. All 19 capture scenarios pass; no assertions or scenario names were removed.
- `node --experimental-vm-modules --test test/engineering/run-tests.test.js`: 5/5. Exercises real CLI collection and synthetic child tests, including distinct child PIDs, VM modules, name filtering and a deliberately failing child.
- `npm run verify:quick`: documentation 7/7, syntax check for 1,032 JavaScript files, architecture 22/22. The capture-loader follow-up also passed `node --check`; final documentation is rechecked after recording these results.
- `node scripts/verify-server-contract.js`: exact pinned revision and all registered fixture hashes verified using the temporary local clone. Complete runs configure the existing NSIS compiler/plugins and have zero skips.

| Run | Result | Wall time |
| --- | --- | ---: |
| Initial complete baseline | 2,996 pass, 1 Electron media failure | 69.982 s |
| Isolated pre-migration Electron lifecycle reproduction | Same video-load failure | 26.346 s |
| Fresh baseline after concurrent naming completed | 2,997/2,997 | 70.346 s |
| First migrated complete run | 2,988 pass, 14 capture-loader failures | 71.374 s |
| Final complete run after capture-loader repair | 3,001 pass, same pre-existing Electron media failure | 58.643 s |
| `node scripts/run-tests.js offline --domain=ai --test-reporter=tap` | 137/137 from 22 files | 0.944 s |

The remaining failure is `test/desktop/resource-lifecycle-electron.test.js`: its unchanged probe reports `特效视频加载失败。` with `clipBytes: 110`, exactly as in the initial baseline and isolated reproduction. Its fixture and production implementation were not changed by this task. The passing intermediate baseline and first migrated run also demonstrate that this failure is intermittent; no timing tolerance, skip or assertion was weakened.

The full-run timings are single observations with different pass/fail outcomes and five added scenarios, so they do not establish a stable speedup. Domain filtering reduces irrelevant work during development: the AI selection starts 22 files instead of the full 435, or the offline group's 402. Complete validation remains available with the same process isolation and concurrency defaults.

Task-only review compares moved tests against the post-naming snapshot. All unchanged imports still resolve to the same absolute target; non-path code is identical except for the capture sandbox's owning-module resolver. The other 1,484 snapshotted files, staged content and HEAD remain unchanged. Runtime logs, snapshots and the migration map live outside the repository.

Cleanup of empty temporary capture-fixture directories was rejected by automatic approval review with `blocked by policy`. The directories are retained; no alternative deletion method was attempted.

## Follow-up: deterministic media input (2026-09-28)

The failing lifecycle test recorded its own VP8 clip before checking the real
player. Failed runs returned an unplayable 110-byte recording, while a successful
run returned 1,019 bytes. Replace this variable input with
`test/fixtures/gift-effect-alpha.webm`, a fixed 64 × 32 synthetic color/alpha
clip decoded and checked in Electron before use. Its provenance is documented
in `test/fixtures/README.md`. The probe now reads that fixture; player scenarios,
assertions, protocol isolation and cleanup remain unchanged. Production code,
timeouts and skip conditions are unchanged.

- Focused command: `node --experimental-vm-modules --test test/gifts/gift-effect-resource-lifecycle.test.js test/desktop/resource-lifecycle-electron.test.js` — 11/11, including real playback, context loss, disposal and zero remaining windows/WebContents.
- `node --check test/fixtures/gift-effect-media-probe.cjs` and `git diff --check` pass.
- The first complete follow-up run passed the repaired Electron test but one unrelated HTTP test process exited with `0xc0000409`. Its isolated `test/overlays/overlay-http-access.test.js` recheck passed 6/6 without code changes.
- The final complete run, with the same pinned server fixture and NSIS configuration, passes **3,002/3,002, zero failures and zero skips**, in 60.004 seconds. Evidence: `C:/Users/Tom/AppData/Local/Temp/lira-test-layout-mfunNl/media-fixed-full-confirmed.log`.
