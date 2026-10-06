# Scene live update notifications

Status: Completed

## Goal

Deliver local scene updates promptly after their owning runtime changes, without paying a 750ms polling interval or repeatedly rebuilding idle display data. The user authorized this follow-up on 2026-10-05 after the browser-source performance investigation.

## Current behavior and ownership

`public/js/overlays/scene.js` serially reads `GET /api/scene/output` after each response plus 750ms. `src/scenes/scene-service.js` owns scene capability verification, published snapshots and active-version projection receipts. `src/server/scene-runtime.js` owns the cloud display and gift event buffers. Other live state already emits through runtime transport, music and game composition callbacks. External browser frames receive their provider data directly and are outside this data path.

## Decision and compatibility

Add an exact-path, scene-authorized `GET /api/scene/events` notification stream using fetch SSE with an Authorization header and omitted credentials. It sends only `ready`, `change` and `revoked` notifications; component data continues through the existing output API and its final authorization check. The generic `/ws` principal model is unchanged. A maximum of four streams per local runtime reserves HTTP/1 browser connections for output and asset requests; excess or unsupported streams retain polling.

The stream binds scene, optional item, current owner epoch and capability; authentic active projection receipts retain notifications for old renderers while a replacement prepares. Access and the real HTTP server's license/lifecycle status are checked before notifications and at a one-second heartbeat. Relevant type changes coalesce for 40ms; publication and rotation trigger revalidation. Stream close, slow readers and shutdown release timers and listeners. No tokens, external URLs, component data or business event identifiers appear in notifications.

The browser keeps one non-overlapping output request, coalesces event bursts with a 100ms minimum request-start interval, and checks every five seconds while notifications work. Stream failure falls back to 750ms polling with bounded reconnect delays. Renderer commits refresh subscription version/receipt. Requests/streams are aborted on pagehide; authorization failure clears output and disconnect/reconnect preserves existing cursor/reset and event-delivery semantics.

## Non-goals

No provider-page rewriting, frame-rate controls, Electron security changes, new dependencies/processes, database migrations, generic WebSocket privileges, remote Server changes or business-event replay. Slow display projection sources remain behind their current contracts.

## Files and milestones

- [x] Scene access and stream transport: add `getOutputAccess(input)` to the scene service; add `src/server/scene-output-events.js`; extend `routes/scene-routes.js` and its public route dispatch. Verify capability/owner/item/receipt isolation, post-open revocation, license expiry, bounded streams, coalescing, slow-client cleanup and shutdown in focused service/HTTP tests.
- [x] Runtime notifications: wire `scene-runtime.js`, `runtime-transport.js`, `music-runtime.js`, `server.js` and API context factories using narrow callbacks. Notify only after accepted cloud/gift changes or committed publication; test actual runtime event delivery without an ordinary WebSocket client.
- [x] Browser consumer: put output/notification lifecycle in `public/js/overlays/scene-source.js` and keep `scene.js` as page composition. Verify streaming chunks, fallback, single-flight requests, notification-during-read, bounded reconnect, projection change, revocation and disposal; use the existing synthetic scene output fixture for actual browser coverage.
- [x] Update ADR-0022, scene specification, HTTP/frontend references and component guide to describe the new path and fallback. Archive this plan with actual verification evidence.

## Verification

Run new focused tests first, then affected `test/scenes/*.test.js`, `test/server/runtime-event-publication.test.js`, browser source and output regressions. Run `npm run check`, `npm run verify:architecture`, `npm run verify:contracts`, and `npm run verify:docs` for the public contract and lifecycle change. Inspect the task's incremental diff, run `git diff --check` and `git status --short`. All runtime checks use isolated temporary state in `tmp/` or in-memory stores; no user app restart or real account events.

## Failure handling and done when

Keep existing polling functional if the new route is absent, saturated or disconnected. Preserve previous successful publication on renderer preparation failure and revoke it on authorization loss. Task-owned edits are reviewed against snapshots under `tmp/scene-live-updates/before`; preserve concurrent changes and do not commit or perform destructive rollback. Complete when notifications produce prompt synthetic browser updates, idle polling is reduced, isolation/recovery/cleanup tests pass, contracts are consistent and verification limitations are recorded.

## Completion evidence — 2026-10-05

The implementation also invalidates only the affected gift-wishes/gift-feed projection cache after wishes configuration or gift-catalog changes. Existing pending reads cannot overwrite a newly populated cache. Ordinary gift notifications retain shared cache reads. Runtime game notifications cover update, draw and patch events; a real isolated runtime test reproduces the missing draw notification before the fix and verifies all three afterward without ordinary WebSocket clients.

Browser integration verifies queue/cloud notification delivery in one read, no 750ms idle polling, retained frame identity, old projection subscriptions during failed preparation, subscription advance after commit, revocation, and fallback/recovery when the events endpoint is absent. The synthetic legacy renderer server now explicitly rejects the new notification route while checking its parent credential, preserving its child-credential assertions. Both browser-source test files are registered in the browser test group.

Final affected suite: **283 passed, 1 skipped, 0 failed**:

```powershell
node --experimental-vm-modules --test --test-concurrency=4 test/scenes/*.test.js test/server/runtime-event-publication.test.js test/server/server-lifecycle.test.js test/server/server-cleanup-failures.test.js test/server/server-modules.test.js test/server/http-websocket-boundary.test.js test/server/http-upgrade.test.js test/lyrics/lyric-generation-recovery.test.js test/admin/canvas-browser-source.test.js test/engineering/run-tests.test.js
```

`npm run check`, `npm run verify:architecture` (19 tests), `npm run verify:docs` (10 tests), and `git diff --check` passed. `npm run verify:contracts -- tmp/scene-live-updates/server-contract` verified all 10 fixtures at pinned Server commit `01fb2b47d5e081f5dd559933991ade4819eb3428`; the default adjacent checkout is at a different revision, so a temporary detached checkout was used and removed afterward. No dependency or lockfile changes, commits, real-user data, app restarts or deployment were needed.

The additional `test/admin/component-preview-output.test.js` run had **7 passed, 3 failed**. All three failed again in isolation with `--test-name-pattern="canvas discard|canvas save updates|empty editor adds"`: discard does not reach a clean canvas/clock state, a test still looks for editable clock height, and a test expects X=-1 to block publication. These failures occur in editor paths outside the new scene notification consumer; concurrent automatic clock sizing and canvas overflow work is preserved. This task does not claim those broader editor regressions passed. Logs are under `tmp/scene-live-updates/`.

These are synthetic local browser/runtime checks. Actual end-to-end latency and resource use in OBS or Bilibili Livehime have not been measured; external provider delivery and slow component data reads remain outside this optimization.
