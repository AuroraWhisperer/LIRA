# Independent live monitoring implementation plan

**Status:** Completed — 2026-09-29. Implementation, focused verification and isolated Electron inspection are complete. Server deployment was not part of this task.

**Goal:** Replace the desktop's combined reception control with separate danmaku and gift monitoring switches, both enabled by default and persisted on the server independently of desktop lifetime.

**Architecture:** Keep one authenticated Bilibili connection per streamer. Server ingress and consumer lifetimes enforce two independent channel settings. The desktop's local danmaku connection follows the danmaku switch; authoritative gift processing stays on the server.

**Tech Stack:** Existing Electron/Node.js, tenant SQLite settings, CommonJS backend, vanilla ESM/CSS frontend; no added dependencies or services.

## Requirements and boundaries

- `danmakuMonitoringEnabled` and `giftMonitoringEnabled` default true. Explicit choices persist across restarts; an existing explicit legacy stop is preserved on upgrade.
- Danmaku monitoring includes text, SC, entry/PK messages and the dependent song requests/replies. Gift monitoring covers gift detection and automatic gift thanks. Existing statistics/notification switches remain independent consumers.
- Remove the combined control from connection settings. Put compact switches in 弹幕姬 and 礼物, with impact explanations in existing `lira-help` controls.
- Closing the desktop does not stop cloud monitoring. Existing authorization, login requirements, tenant scope, reconnect policy and offline limitations remain intact.
- Stop newly disabled ingress before fan facts/history/detection. Already accepted gift groups finish settlement; no ledger deletion, cursor reset or history replay.
- Changing only one channel updates the current monitor in place, cancels that channel's pending replies, and preserves the other channel's socket/consumers. Both disabled stops the shared monitor.

## Owners and compatibility

- Live: settings defaults/store and `server/settings-contract.js` own persisted string values and cloud conversion; `server/bilibili-runtime.js` owns the local listener; admin settings form/state renderer own UI save and checked state.
- Server: `lib/streamer-sync-settings.js`, `storage/cloud-settings-store.js`, streamer cloud-state and Bilibili monitor manager/runtime own canonical booleans, tenant commit and enforcement.
- Add optional request fields and always return them from the updated server. Keep `enableBilibili` as the derived OR for legacy integrations. An old request without channel fields preserves existing separate choices when its combined value is unchanged; a changed legacy combined value sets both. Explicit channel fields take precedence.
- Existing legacy storage without channel values inherits the legacy combined setting, otherwise defaults true. Existing settings tables suffice; startup initialization is idempotent.
- User-authorized behavior updates the corresponding server requirements, acceptance criteria, protocol/OpenAPI/fixture and client reference docs together. One connection and existing ownership remain unchanged; no new architecture decision is needed.
- Preserve both worktrees' unrelated changes, no commit/branch/deployment or real-user data mutation.

## Delivery and verification

- [x] Persist/normalize/migrate the two flags; add focused tests for defaults, independent combinations, restart, invalid values, legacy requests and tenant isolation.
- [x] Enforce server ingress and independent activity lifetimes; test gift-only, danmaku-only, both on/off, in-place toggles, pending response cancellation and accepted gift completion.
- [x] Gate the local listener by danmaku monitoring, move UI controls, test independent saves and snapshot updates; inspect the actual isolated Electron page.
- [x] Update owning documentation and protocol fixtures; run focused suites, justified syntax/docs/contracts/architecture gates, inspect task diff and `git diff --check`/status in both repositories. Existing gate failures are recorded below, not counted as passes.

Focused commands will include:

```text
# Live
node --experimental-vm-modules --test test/settings/*.test.js test/bilibili/bilibili-runtime.test.js test/cloud-sync/cloud-runtime-sync.test.js test/admin/admin-page-composition.test.js test/admin/contextual-help.test.js
node scripts/check-js.js
npm run verify:docs
npm run verify:architecture
npm run verify:contracts
# Server (file list expanded through the repository test runner if needed)
node --require ./test/support/test-mode.cjs --test test/independent-monitoring.test.js test/cloud-state-sync.test.js test/cloud-state-atomicity.test.js test/admin-sync-compatibility.test.js test/room-monitor-continuous.test.js test/room-monitor-gift-batches.test.js test/room-monitor-overlay.test.js test/room-monitor-pk.test.js test/room-monitor-live-greeting.test.js test/monitor-startup-isolation.test.js
npm run docs:check
```

## Failure handling and completion

Use task-start snapshots and targeted diffs to reverse only task-owned hunks if needed. Tests use temporary databases and mocked Bilibili connections; Electron QA uses its existing isolated profile/data/port harness and closes its owned processes. No production restart or external messages.

Complete after channel independence, persisted defaults, compatibility, UI and contracts are verified, with any pre-existing gate failures recorded separately. Archive this plan and update its index only after those conditions are met.

## Completion evidence — 2026-09-29

The two immediate monitoring switches are placed in 弹幕姬 and 礼物. Both default on; explicit legacy disabled settings survive initialization. Settings persist independently and synchronize with canonical server booleans. The old combined control is removed, while its stored value remains a derived compatibility mirror. Channel-only updates retain the shared authenticated connection and unaffected consumers. Accepted gifts complete settlement after monitoring is disabled.

The user's final layout correction is included: gift switches and refresh share a content-sized, wrapping horizontal bar. Statistics status stays inline, help uses the existing question-mark component, and equal-width panels and the extra summary row are removed. Usage-guide text names the new control locations and distinguishes immediate toggles from forms that require Save.

### Automated verification

- Live focused suite: **108/108 passed** with `node --experimental-vm-modules --test test/settings/*.test.js test/bilibili/bilibili-runtime.test.js test/cloud-sync/cloud-runtime-sync.test.js test/cloud-sync/cloud-sync-response-validation.test.js test/admin/admin-page-composition.test.js test/admin/contextual-help.test.js test/admin/frontend-usage-guide.test.js test/ui/frontend-toast-business.test.js test/gifts/frontend-blindbox-mapping-refresh.test.js`.
- Server focused suite: **91/91 passed** with `node --require ./test/support/test-mode.cjs --test test/independent-monitoring.test.js test/cloud-state-sync.test.js test/cloud-state-atomicity.test.js test/admin-sync-compatibility.test.js test/room-monitor-continuous.test.js test/room-monitor-gift-batches.test.js test/room-monitor-overlay.test.js test/room-monitor-pk.test.js test/room-monitor-live-greeting.test.js test/monitor-startup-isolation.test.js test/settings-input-contract.test.js test/device-write-boundaries.test.js test/cloud-sync-http.test.js`. A later focused rerun after removing duplicate recent-buffer clearing passed **27/27**.
- Live JavaScript syntax: `node scripts/check-js.js`, **1053 files passed**.
- Documentation: Live `npm run verify:docs`, **9/9 passed**, including a rerun after plan archival; server `npm run docs:check`, **41/41 passed**. The final guide copy also passed `node --experimental-vm-modules --test test/admin/frontend-usage-guide.test.js`, **16/16**.
- Final compact-layout checks: **21 passed** across gift interaction controls, page composition and contextual help. `test/gifts/frontend-gifts-panel.test.js` failed during module loading because of the existing server revision mismatch below; its assertions did not run.
- OpenAPI formatting cleanup preserved parsed JSON exactly and removed unrelated compact-array expansion. Task diffs were reviewed against task-start snapshots; both repositories passed `git diff --check`, with no staged content or task-generated runtime material added.

### Isolated Electron inspection

The actual desktop preload, IPC and authorized main-process session were used with temporary data/profile/session paths, a random local port, synthetic authentication and an empty room ID. Anonymous `/admin` returned 401 and the authorized desktop request returned 200. No real Bilibili account or user data was used. The owned Electron process and local runtime were closed after inspection.

- Both new switches rendered once, initially checked. The old control was absent.
- Each switch submitted only its own flag; independent choices and the derived combined value survived reload. Both switches were restored on in the isolated fixture.
- Help popovers explained the affected features; refresh remained clickable beside the switches.
- At 1440- and 1100-pixel window widths, all five gift switches and refresh fit in a single **60-pixel-high, 1018-pixel-wide** bar. At 900 pixels, controls wrapped to two rows, **112 pixels** high, without horizontal overflow.
- The danmaku heading stayed in one compact **68-pixel-high** row at 1100 pixels.
- Screenshots: `C:/Users/Tom/.codex/visualizations/2026/09/29/01a0ea94-aac1-77b2-b894-673dd0cb5f69/monitoring-gifts-compact.jpg` and `monitoring-danmaku-compact.jpg` in the same directory.

### Existing limitations

- Live `verify:architecture` remains blocked by existing unreviewed file-size growth in `public/css/admin/gift-display.css` (633 lines) and `test/gifts/frontend-gift-display-settings.test.js` (632 lines), plus existing empty-catch debt in `public/js/admin/start-animation.js`. This task's danmaku CSS is below its 600-line review threshold.
- Live `verify:contracts` expects server revision `a28db3a2ccf5f0fec1626a4fe3bd97a7eb402d1b`; the server checkout is at `6fffbf2fd71f1231de6f7ba48ca44c4b23af030b`. The lock was not changed to mask this existing mismatch. The same check blocks the gift-panel test module described above.
- Updated server behavior is implemented and tested in the server worktree; it has not been deployed. No production restart, commit, branch, external message or real-account operation was performed.
