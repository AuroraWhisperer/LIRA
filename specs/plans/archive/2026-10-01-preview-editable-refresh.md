# Editable preview refresh

**Status:** Completed

## Goal

While the originating desktop controller remains open, returning after ten minutes
and refreshing the scene editor restores an editable, unsaved draft. An idle
transport lease can resume through the same authenticated desktop controller.

## Non-goals and compatibility

No automatic save/publication, persisted-format changes, new services or browser
admin authority. Explicit revocation, desktop closure, account/generation changes
and replacement sessions stay terminal. Preserve concurrent work in this checkout.

## Current behavior and ownership

- Browser `pagehide` calls `close`, revoking the session during a normal refresh.
- Browser mutation IDs restart at one while the relay retains the previous receipt.
- The two-minute transport lease deletes state even if the desktop later resumes.
- Owners: `src/server/component-preview-sessions.js`,
  `public/js/admin/component-preview-remote.js`, `component-preview-page.js`.
- Desktop exchange/close remains in `component-preview-dialog.js`; scoped HTTP
  routing/auth stays in `src/server/routes/component-preview-routes.js`.
- Contracts: `docs/reference/frontend/overlays.md` section 6.4 and
  `docs/reference/backend/api.md` browser component preview.

## Proposed changes

1. Separate page detach from explicit session close. Keep the desktop-owned draft
   and local recovery snapshot across refresh; release page timers/requests/views.
2. Attach each page using a unique attachment ID and the previously observed ID.
   Make attachment retries idempotent, fence stale page reads/mutations/close and
   late attachment retries, and scope command receipts to the current attachment.
   Keep accepted commands/ack ordering; wait for accepted operations to settle
   before restoring local drafts. Legacy untagged commands work before attachment.
3. Suspend expired leases instead of deleting the bounded component sessions.
   Browser requests cannot renew an expired lease; return a retryable response
   until the original authenticated desktop exchange validates owner/generation
   and renews it. Revocation cannot be undone by exchange or attachment.

## Milestones and verification

- [x] Reproduce refresh losing editability and cover ten minutes of idle browser,
  suspended transports, safe attachment/replay, stale requests and terminal revoke.
- [x] Implement lifecycle changes; verify pending edits survive reload and an
  explicit save after reload publishes exactly once through the desktop owner.
- [x] Update contracts, run affected tests and quick governance/architecture gates,
  inspect touched diffs, `git diff --check` and `git status --short`, then archive.

Commands:

```powershell
node --experimental-vm-modules --test test/transport/component-preview.test.js test/admin/component-preview-remote.test.js test/admin/component-preview-recovery.test.js test/admin/component-preview-drafts.test.js test/admin/component-preview-drafts-browser.test.js
node --test test/admin/component-preview-browser.test.js test/admin/component-preview-output.test.js test/desktop/danmaku-canvas-electron.test.js
npm run verify:quick
git diff --check
git status --short
```

Use fake time for long inactivity and existing isolated browser/Electron fixtures;
no real user state, app restart or external service calls. Remote server contracts
are unaffected by this local-only relay protocol.

## Results — 2026-10-01

- The initial reproduction failed at refresh (read-only recovery), expired lease
  resumption and page attachment. Ten minutes with desktop heartbeats already
  passed, confirming user input was not the lease's renewal mechanism.
- The first command above passed all 27 tests: editable refresh, unsent local
  edits, a lost publication response across refresh with exactly one publication,
  ten-minute inactivity/suspension, attachment retry/fencing, explicit revoke,
  owner/generation isolation, bounded queues and recovery conflict choices.
- After concurrent fallback/size-limit changes, the final focused run of
  `node --test test/transport/component-preview.test.js test/admin/component-preview-drafts-browser.test.js`
  passed all 17 tests, including the additional concurrent regressions.
- The combined browser/output/Electron command passed 7 of 9. All five browser
  tests and the first two output tests passed. Electron initially observed the
  intermediate `本次已应用，新修改仍需保存` status; its isolated rerun passed,
  including a real preload/IPC path, unsaved layout/parameters across refresh,
  subsequent edits, a save failure followed by one successful publication, and
  sandbox isolation.
- The remaining output regression also fails in isolation, before any refresh:
  publishing five independent layers reports `场景已变化，请再次保存并应用。`;
  saved controllers are clean and publishedVersion is still zero. The concurrently
  changed publication owner compares the submitted and saved scene documents.
  This separate publication work is tracked by `2026-10-01-canvas-audit-fixes`;
  no changes were made to its implementation or acceptance expectations here.
  Temporary diagnostic additions were removed.
- `npm run verify:quick` stopped at an unrelated governance failure: the concurrent
  `specs/plans/2026-10-01-canvas-audit-fixes.md` uses `Status: In Progress.` instead
  of the required status format. The other eight governance tests passed.
  Running its remaining gates independently passed syntax checks for 1152
  JavaScript files and all 22 architecture tests. No unrelated plan was edited.
- Final touched-diff review, `git diff --check` and status inspection completed.
  No credentials/generated artifacts entered the task diff; concurrent changes
  were preserved. No release was built/installed and no user app was restarted.

## Failure handling and done criteria

Keep local unsaved recovery on terminal failures. Reverse only task-owned hunks
if needed; no destructive rollback. Done when refresh can continue editing after
idle/reconnect, stale page requests cannot change or close the active attachment,
publication remains explicit and exactly once, security checks pass, and evidence
and limitations are recorded here. No commits, packaging or installation.
