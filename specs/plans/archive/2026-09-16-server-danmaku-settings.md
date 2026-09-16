# Server danmaku settings implementation plan

**Goal:** Both desktop danmaku links open the authenticated broadcaster's server
overlay. The desktop edits a draft, previews it without changing OBS, then
explicitly applies the style and fullscreen duration to the server.

**Status:** Complete, 2026-09-16. Implemented in both working trees; not deployed.

**Architecture:** The existing tenant overlay-settings service remains the sole
persisted owner. Add authenticated Device GET/PUT access through the Electron
main-process license bridge. Keep overlay events on the existing public Host-bound
SSE, independent of the desktop. This extends server ADR-0008's editor boundary;
record the extension in a new ADR and update normative contracts together.

**Tech stack:** Existing Node/Electron, vanilla ESM/CSS, SQLite; no dependencies.

## Boundaries and compatibility

- Preserve both repositories' existing uncommitted work; no commit or deployment.
- Existing desktop styles and integer duration 2–30 seconds (default 6).
  The concurrent `cream` style task extended the original seven to eight; its
  changes are preserved and use the same configuration flow.
- Existing Streamer GET/PUT stays supported and reads/writes the same settings.
- Legacy style-only PUT retains the stored duration; legacy stored rows default to 6.
- No new sync scope/revision, secret in renderer, client-supplied tenant identity,
  replay, or new upstream listener. DeviceBearer selects the owner; Host selects OBS.
- Preview is read-only sample rendering on the server page; it opens no live SSE.
- Unavailable account/server means empty disabled links and a retryable error,
  never a localhost fallback or a false save-success message.
- Draft edits survive delayed reads, saves and errors; authorization changes discard
  the previous account's draft and stale responses.

## Current behavior and owners

`public/js/admin/display.js` and `danmaku-tool.js` generate `/danmaku` on loopback.
The latter saves local settings immediately. Server `overlay-settings.js` stores
four styles, `/overlay` consumes server-owned live sessions, and the management
page edits this independent setting. The existing device profile provides the
configured public song origin, usable to derive the canonical `/overlay` link.

## Milestones

- [x] Extend the server service, Device routes, SSE settings and contracts with
  seven styles and `fullscreenDurationSeconds`; test auth, isolation, invalid
  values, backward compatibility and one tenant-only notification per save.
- [x] Serve the existing desktop feed/renderer and CSS assets from the server;
  retain SSE/live-session behavior and add isolated `preview=1` sample rendering.
  Test all style assets, preview isolation, timers and settings events.
- [x] Add narrow Electron get/update methods with validation and safe DTOs;
  wire both desktop addresses to the server, stage drafts and apply explicitly.
  Test no write on edit/preview, failures, late responses and account changes.
- [x] Update the web editor to the same styles/duration, test its draft
  behavior, inspect the UI, review scoped diffs and run final focused gates.

## Verification

Desktop: `node --experimental-vm-modules --test` on the new overlay UI/IPC tests,
`test/frontend-admin-danmaku.test.js`, `test/license-background.test.js`,
`test/license-manager-operations.test.js`, `test/remote-license-client.test.js`;
`npm run verify:quick` for the changed Electron and module boundaries.

Server: `node --test` on overlay settings, public SSE, event broker, parser,
room-monitor overlay, protocol, static/renderer and management draft tests;
`npm run docs:check` for API/documentation/architecture consistency.

Final: inspect each touched diff, `git diff --check`, `git status --short` in both
repositories. Tests use temporary tenant databases and synthetic credentials.

## Failure handling and done conditions

Failed apply retains the draft and reports the server error. OBS keeps the last
successful configuration. Reverse only task-owned edits if needed. Complete when
the same configured server URL appears in both desktop surfaces, preview cannot
publish changes, explicit apply persists and broadcasts both parameters, and
focused tests plus contract checks pass. Live deployment is outside this task.

## Verification results

- Desktop affected authorization, IPC and draft suites: 68 passed.
- Desktop `npm run verify:quick`: passed (docs, syntax and 22 architecture checks).
  The manager now exposes its existing operations factory directly; removing the
  duplicate method list also retired its obsolete size-exception record.
- Server affected overlay, auth/isolation, parser, SSE and web editor suites:
  57 passed; `npm run docs:check`: 34 passed.
- Browser `e2e/overlay-preview.spec.js`: 2 passed. Verified all supported styles,
  zero preview API/SSE requests, timed expiry and explicit web apply. Inspected
  screenshots of the server editor and identity preview.
- Reviewed task-owned source and contract diffs and preserved concurrent changes.
  `git diff --check` passed in both repositories. Test databases, logs and browser
  screenshots remained in temporary directories; no production requests or writes.
