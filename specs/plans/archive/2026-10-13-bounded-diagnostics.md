# Bounded diagnostics implementation plan

Status: Completed. Owner: current logging remediation task, 2026-10-13.

## Goal and boundaries

Keep recent actionable failures on both sides without unbounded disk or in-memory
logging. Preserve HTTP/IPC/auth contracts and fatal process exit behavior. No new
runtime dependency, business-data cleanup, application deployment, or restart of
the user's client. Existing song-request CSS changes belong to another task.

## Current behavior and ownership

- Client `src/shared/log-size-limit.js`, `src/electron/{desktop-logger,terminal-log}.js`
  stop writing at capacity. AI has a bounded queue but the same capacity dead end.
- Desktop entry/main own process and webContents diagnostics. Renderer consoles,
  rejected promises and crashes currently have no persistent owner.
- Server `../lira-server/src/lib/logger.js` serializes unrestricted fields;
  `src/app.js` and `src/server-lifecycle.js` own HTTP and lifecycle failures.
- Server PM2/Nginx use host files without rotation; audit storage is append-only.
- Contract owners: client desktop/main and backend/ai references; server runtime,
  requirements and acceptance criteria. Existing related tests are extended.

## Decisions and compatibility

- Client separates desktop, terminal and AI normal/error files: normal 1 MiB and
  error 3 MiB, each with two archives, 36 MiB combined. Normal records expire after
  3 days, warnings/errors after 14 days. Startup/hourly maintenance extracts old
  mixed errors, redacts the AI error core and retires old ordinary records.
  Oversized input retains a bounded complete-line tail; legacy ai.log and its
  archives temporarily add at most 3 MiB. Failed extraction keeps source records.
  Unrelated files are preserved; unsafe targets fail closed.
- Existing AI serialization queue owns its writes; it reuses the same synchronous
  bounded writer. No cross-process shared writer is introduced.
- Error bursts use bounded deduplication state, preserve the first failures and
  report suppressed counts. Distinct errors have a separate overall rate budget.
- Main observes fatal exceptions without replacing Electron/Node exit semantics.
  webContents events capture console errors, load/preload failures and crashes;
  page content is only collected from the exact local application origin. Remote
  login windows contribute crash metadata only. No new renderer IPC privilege.
- Server logs preserve structured fields and safe error stack frames, bound JSON
  entries, tolerate cycles/getters, redact credentials and aggregate bursts.
  Audit retention converges to 90 days / newest 10,000 records through existing
  maintenance, with no production database cleanup during this task.
- Host logrotate separates ordinary files (2 archives / 3 days) and failures
  (13 archives / 14 days). PM2 thresholds are 2/1 MiB and Nginx 5/1 MiB: 49 MiB
  combined before compression, plus traffic during the one-minute check interval
  and oversized existing input. Nginx 5xx are separate, queries remain hidden.
  Host logging configuration is applied; application code follows normal release.

## Milestones and verification

- [x] Client rotation and burst control: existing desktop/terminal/AI tests plus
  rotation across restart, oversized files, disk failures and symlink rejection.
- [x] Desktop capture: emitter tests and an isolated real Electron fixture for
  console error, timer throw, rejected promise, preload/load failure and crash;
  verify remote-origin privacy, disposal and no duplicate event registration.
- [x] Server diagnostics and audit retention: pure logger tests, HTTP privacy,
  crash/shutdown tests, isolated SQLite retention and existing audit consumers.
  Use `tmp/runtime/node-v24.15.0/node.exe` for server database tests.
- [x] Host rotation: dry-run repository config against synthetic logs, verify
  archive counts/reopen, install scoped config and timer, inspect effective state
  and HTTP health without restarting the application.
- [x] Synchronize reference/operations/requirements and affected user guidance;
  run client `npm run verify:docs` and server `npm run docs:check`, focused JS and
  architecture checks justified by new owners, review both diffs and statuses.

## Failure handling and completion

Logging failures must not throw into business code; rotation must never follow
symlinks or touch unrelated files. Retention runs only against the injected owner
database. Host installation keeps pre-existing configuration intact and can be
reverted by removing only this task's timer/config. No reset/checkout rollback.
Complete when the above checks pass, policies and limitations are documented,
and no generated/runtime material enters either diff.

## Completion evidence

- Client: 104 focused tests passed, including real Electron startup/diagnostics,
  shutdown ownership, legacy extraction/failure/oversize, AI burst accounting,
  rotation/redaction and the usage guide. The new main dependencies are explicitly
  modelled in the shutdown harness; disposal is checked.
- Client architecture and documentation commands: 37 checks passed. `node
  scripts/check-js.js` validated 1,511 files, reusing unchanged syntax results.
- Server: 90 focused checks passed with Node 24.15.0. The `docs:check` file set plus
  the updated HTTP privacy suite passed 58 checks (55 documentation/architecture
  and three HTTP cases). Public API, IPC, UI layout and authentication are unchanged.
- Host: synthetic repeated rotation checked archive counts and expired empty-log
  cleanup; isolated Nginx checked 200/502 separation and query privacy. Installed
  scoped config/cron passed dry-run, permissions and active cron checks. Local and
  HTTPS health are healthy; this task did not restart the application process.
- Old Nginx access archive: extracted 46 retained 5xx records, removed 231,122
  expired records, retained the recent ordinary tail. No production audit database
  cleanup was executed. Application source is ready for the ordinary release,
  not installed into the user's running desktop or deployed to Node.
- Desktop/AI/Bilibili references, FAQ guidance, server requirements/acceptance,
  ownership and operations are synchronized. Other guides have no changed entry
  points or workflows. Both working diffs and statuses were checked; unrelated
  ongoing song and release-workflow edits are preserved. No commit was created.
