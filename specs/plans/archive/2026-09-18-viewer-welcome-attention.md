# Viewer welcome and attention implementation plan

Implementation completed on 2026-09-18. Release contract pinning remains a separate integration prerequisite below.

**Goal:** Implement the user-selected design report at `D:/Work/lira-server/docs/design/viewer-welcome-and-attention-design-report.md`, with the supplied compact fixed-reply layout.

**Architecture:** The server remains the only welcome sender. A versioned Device resource shares the existing tenant switch and welcome library; the existing scheduler owns delayed sends. Electron exposes narrow, validated V2 operations; the renderer keeps independent parameter/library drafts.

**Tech stack:** Existing CommonJS server/Electron, vanilla ESM frontend, native CSS; pinned local pinyin dictionary as proposed in the report.

## Scope and decisions

- Adopt report phases A–C. Optional private attention notifications (phase D) are excluded.
- Compatibility defaults remain immediate welcome, no honor threshold, new switches off. Suggested parameters only edit the draft.
- Preserve all pre-existing changes in both workspaces; no commit, branch, deployment or real-room test sends.
- Honor level comes only from schema-backed V2 field 22/4/1; absent differs from zero. No claim of continued presence.
- The screenshot defines structure; use current theme/font tokens and first-load collapsed editor.

## Current behavior and ownership

Server: `src/storage/welcome-settings.js` owns tenant settings; `src/modules/danmaku/welcome-service.js` owns eligibility/cooldown; `src/lib/bilibili-entry.js` owns ingress parsing; `danmaku-send-scheduler.js` owns monotonic timing and bounded sends. Device and Admin writes must share domain cancellation. Protocol owners are `docs/protocol/viewer-welcome.md`, Device OpenAPI and gift-interaction timing.

Client: `src/electron/ipc/license-ipc.js`, license operations/remote client and preload own the privileged boundary. `public/js/admin/danmaku-welcome.js` owns account-isolated state. `danmaku.html`, welcome fragments and scoped CSS own fixed-reply layout. Existing local reply editors and PK keep their nodes and persistence.

## Milestones and verification

- [x] Server contract/storage: strict partial V2 config, atomic switch dependencies, V1 projection, field errors, shared Admin path; protocol, requirement/acceptance/traceability, fixture and draft ADR updated.
- [x] Ingress/render/runtime: honor parser, local rare-name pinyin, per-stage libraries and length fallbacks; snapshot flow, successful-first-stage continuation, planned-time TTL and cancellation on effective config changes.
- [x] Electron bridge: explicit V2 methods and strict response projection; GET-only 404 capability fallback, no write replay; IPC, remote requests and account isolation verified.
- [x] Frontend: two-column six-feature summary, single retained editor, three parameter rows, four independently saved libraries, collapsed sample preview and independent bottom pinyin toggle; drafts, failures and account changes verified.
- [x] Final review: relevant architecture/documentation/contract gates run, touched diffs and both working-tree statuses inspected, whitespace checks passed. Contract lock mismatch recorded below rather than bypassed.

## Failure handling and compatibility

No new local sender, tenant selector, credentials in renderer, sync revision or per-viewer timer. V1 responses remain exact. Pure disabling excludes invalid drafts and invalidates pending flows after successful persistence. Server rollback requires confirmed welcome/pinyin shutdown before restoring old binaries; no runtime database changes during development verification.

## Done when

Core report behavior and supplied layout are implemented, focused checks pass, documents and contracts describe the result, unrelated changes are preserved, and the final response distinguishes synthetic verification from unavailable real upstream field coverage.

## Evidence

The report is a user-authorized design input, not evidence of deployed functionality or verified upstream coverage. No production database, account configuration or live-room sends were used.

- Client: `node --experimental-vm-modules --test test/frontend-welcome.test.js test/frontend-admin-danmaku.test.js test/frontend-pk-report.test.js test/admin-page-composition.test.js test/admin-style-ownership.test.js test/welcome-v2-ipc.test.js test/welcome-settings-ipc.test.js test/pk-report-settings-ipc.test.js test/remote-license-client.test.js test/remote-license-response-budget.test.js test/license-retry.test.js` — 73 passed.
- Client: `npm run verify:quick` — documentation checks passed, 850 JavaScript files passed syntax, 22 architecture checks passed. A narrow `remote-danmaku-settings.js` helper keeps the existing remote-client size ceiling unchanged.
- Server: `node --test test/bilibili-entry.test.js test/welcome-settings.test.js test/welcome-service.test.js test/welcome-stages.test.js test/welcome-settings-http.test.js test/welcome-lifecycle.test.js test/danmaku-send-scheduler.test.js test/room-monitor-continuous.test.js` — 55 passed. `node --require ./test/support/test-mode.cjs --test test/admin-sync-compatibility.test.js` — 8 passed. The initial combined command omitted this older test's required test-mode preload; rerunning with the repository's test entry point passed.
- Server: `npm run docs:check` — 34 passed, including OpenAPI/route inventory and document governance. Earlier focused send-load checks also passed.
- Actual Electron: `node_modules/electron/dist/electron.exe scripts/verify-welcome-settings.cjs` — passed using real fragments/CSS/preload/IPC with synthetic settings. Checked one visible retained editor, local/server drafts and pagination, keyboard Tab/Enter/Space, disabled/error/unconfirmed/legacy states, light/dark tokens, widths 704/640/480/360/320 and 200% zoom. Compact height: 324px collapsed, about 620px with welcome parameters expanded. No horizontal overflow in checked states. This is targeted layout verification, not a complete accessibility certification.
- Both repositories: `git diff --check` passed; pre-existing unrelated edits and staged content preserved. Screenshots/logs stayed in temporary or ignored locations.

## Release and evidence limits

`npm run verify:contracts` correctly refuses the current server checkout: client lock expects `5ea7b01c8fc7b1cec34a43b01f99c403fd9d1577`, server HEAD is `d92f28a3d817f655ddd9bd7cc6d40a319b2ad910` with uncommitted changes. The existing lock is unchanged. Per `docs/architecture/engineering/test.md`, pinning must follow a committed, available server implementation; no commits were authorized. The V2 fixture/schema/HTTP/IPC tests pass independently, but the release gate needs the eventual committed revision and fixture hashes.

Honor parsing is covered by schema-based synthetic packets only. Real upstream field availability and pronunciation coverage for every nickname remain unverified. Private attention reminders are outside phases A–C. Nothing was deployed; ADR-0061 remains draft for review.
