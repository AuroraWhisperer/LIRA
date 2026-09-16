# Cream random danmaku style implementation plan

**Status:** Complete, 2026-09-16. Local implementation and verification only; not deployed.

**Goal:** Add a second random overlay style, `cream` / 奶油气泡, matching the supplied reference: external round avatar, cream speech bubble, pink border and highlight, pink nickname, dark message and soft shadow.

**Architecture:** Extend the existing server-owned overlay style enum. The desktop draft editor, narrow Electron IPC allowlist and server editor select the same value. Reuse the fullscreen feed's positioning and expiry; opt this variant into the existing safe avatar renderer. No new dependency or rendering framework.

## Current behavior and ownership

The in-progress server overlay integration already carries seven styles. `outline` is the only random style and its renderer omits avatars. Server `public/overlay/` owns OBS and preview rendering; `src/modules/streamer/overlay-settings.js` owns settings; Live `public/js/admin/danmaku-overlay-settings.js` and `src/electron/ipc/license-ipc.js` are consumers. REQ-BILI-006, AC-BILI-005 and the three overlay settings OpenAPI schemas own the contract.

## Compatibility and non-goals

Keep the first random style, default `signal`, 2–30 second duration, explicit apply, safe image policy, tenant scope, SSE and legacy local overlay behavior. Add only `cream` to existing enums; no schema migration or new settings key. Preserve concurrent/uncommitted integration work. No commit, deployment or production settings change.

## Milestones and verification

- [x] Add scoped cream CSS, renderer avatar option and fullscreen app selection. Verify actual DOM: avatar, no badges, bounded long text, expiry and original outline behavior.
- [x] Add the desktop/server selector and IPC/service allowlists. Verify preview creates no write; save accepts cream and keeps duration/tenant isolation.
- [x] Extend requirements, acceptance, OpenAPI and fixture for cream. Run the directly affected overlay settings, preview and IPC tests plus syntax checks.
- [x] Inspect the rendered overlay against the reference, run the one-pass design detector, inspect task-owned diffs, `git diff --check` and `git status --short` in both repositories.

## Verification results

- Live: `node --experimental-vm-modules --test test/server-danmaku-settings.test.js test/danmaku-overlay-ipc.test.js test/frontend-admin-danmaku.test.js` — 13 passed.
- Server: `node --test test/overlay-settings-service.test.js` — 1 passed; `node --experimental-vm-modules --test test/overlay-settings-routes.test.js test/overlay-protocol-contract.test.js test/overlay-static.test.js test/overlay-preview.test.js` — 14 passed.
- Server: `node --test test/streamer-overlay-edit-state.test.js test/streamer-manage-surface.test.js` — 14 passed.
- Server: `LIRA_GAMES_BROWSER_PORT=3239 npx playwright test e2e/overlay-cream.spec.js` — 2 passed. Uses synthetic messages, local avatar fixture and isolated test server. The first run needed test synchronization with ResizeObserver after resizing; no production layout change was required.
- Changed JS syntax checks and Device request/response fixture validation passed. Both repository diff checks passed. Screenshots and temporary baselines remain outside the repositories.
- Visual reviewer disposition: **ship**, no material defects in the reference comparison or 1280×720 / 640×360 captures. Documenter confirmed scoped style ownership and normative enum consistency; documented the new `showAvatar` option. Existing management OpenAPI prose saying “persists only style” is integration wording drift, outside this visual addition.
- Mechanical detector: the new warning is the speech-tip's 2px border, explicitly required by the reference; other findings were pre-existing UI. No global design metadata or unrelated repairs were added.

## Rollback and completion

Reverse only the cream additions if needed, preserving pre-existing and concurrent edits. Done when cream is selectable as the second random option, survives the existing save/read path, renders in preview and OBS with existing timed positioning, and focused verification passes or pre-existing failures are explicitly recorded.
