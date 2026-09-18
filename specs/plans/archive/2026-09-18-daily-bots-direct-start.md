# Daily bots: direct start and cloud database restore

Status: complete. The user's 2026-09-18 clarification supersedes the old
mandatory takeover UI: cloud database backups are restored as a whole; desktop
local history is not part of initial setup.

## Goal

Remove the old-data panel and allow a fresh account to enable check-in or fortune
directly. Restoring a tenant database must preserve totals, same-day results and
settings, and allow subsequent days to continue accumulating.

## Non-goals

No deployment, real database operations, local-database auto-import, schema
replacement, backup scheduler changes or removal of existing privileged APIs.

## Current behavior and ownership

Live's `danmaku-daily-bots.js` disables both switches until takeover is ready and
delegates legacy UI to `danmaku-daily-bot-takeover.js`. The HTML and CSS own the
panel. Server `daily-bot-store.js` rejects pending enable requests; the settings
service exposes pending as the runtime reason. Results and settings already live
in tenant `streamer.db`, included by the existing SQLite online backup.

## Compatibility constraints

Keep DeviceBearer, tenant scope, IPC actions, revision checks, table formats and
confirmed-state/account-generation UI behavior. Preserve ready/imported records
and active staged imports; never clear records or claim old clients were stopped.
Keep legacy endpoints for compatibility, without exposing them in the current UI.

## Proposed changes and milestones

1. Remove takeover markup, its renderer module and orphaned CSS; retain concise
   cloud status and the six existing controls. Verify using focused frontend tests.
2. In the existing immediate enable transaction, transition pending to
   ready/fresh-start and increment the takeover revision, without synthesizing
   `legacyStoppedAt`. Leave active imports protected. Pending/off reads as disabled.
   Verify direct enabling, revision/transaction safety and legacy API compatibility.
3. Extend the existing isolated backup test to restore real cloud daily-result
   tables and verify same-day deduplication, stable fortune, continued accumulation
   and reopening. Align the accepted spec, protocol, fixtures, requirements and a
   new ADR that supersedes only the old mandatory setup decision.

## Verification

- Live: `node --experimental-vm-modules --test test/daily-bot-frontend.test.js test/daily-bot-controller.test.js test/admin-page-composition.test.js test/ui-edit-state.test.js test/frontend-welcome.test.js`.
- Server: `node --require ./test/support/test-mode.cjs --test test/daily-bot-store.test.js test/daily-bot-http.test.js test/daily-bot-runtime.test.js test/daily-bot-bindings.test.js test/backup-wal.test.js`.
- Server documentation/contract gates: `npm run docs:check`.
- Both repositories: final touched diff, `git diff --check`, `git status --short`.

## Failure handling

Use only synthetic data in isolated temporary databases. An in-progress legacy
import remains guarded until its existing commit/cancel/expiry flow completes.
No source database or unrelated user edits are modified. Revert only task-owned
patches if validation reveals a contract conflict; do not reset or check out files.

## Done when

The panel and migration calls are absent from the UI, a new account can enable
directly, existing/restored data remains intact, focused tests pass, documentation
matches the new explicit requirement, and the final diff contains no generated or
sensitive data. Record results here and archive this plan after verification.

## Verification results

- Live focused frontend, controller, composition, edit-state and welcome tests:
  58 passed. Renderer syntax check passed.
- Server focused store, HTTP, runtime, binding and online backup tests: 16 passed.
  Restored synthetic databases preserve settings and same-day results, advance
  totals on the next date and remain idempotent after reopening.
- Server documentation/contract/architecture gates: 34 passed. Live documentation
  governance: 5 passed.
- Both repository diffs and status were reviewed; `git diff --check` passed.
  Unrelated concurrent work was preserved, including a concurrent ADR-0063;
  this task's decision is ADR-0064.
- No production database, deployment or commit operations were performed.
