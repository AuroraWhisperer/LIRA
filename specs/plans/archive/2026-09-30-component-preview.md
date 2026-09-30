# Component Preview Implementation Plan

**Status:** Completed. P1a/P1b implementation, local verification and pinned Server contract gate passed. No commits or branches. Further stages are tracked in 2026-09-30-component-workspace.md.

**Goal:** Implement approved P1a/P1b: four components share sandboxed preview and explicit two-entry editing/saving.

**Architecture:** Owning Admin modules create controllers independent of dialog lifetime. Adapters retain persistence/renderers. Shared chrome owns view state/cleanup. Clock gains an eight-field read-only socket projection.

**Tech Stack:** Electron 43, Node.js 24+, native ESM/CSS, existing HTTP/IPC/WebSocket, node:test.

## Global Constraints

- 保持当前 Electron 管理页中的 dialog 与 sandbox iframe 组合。
- 沿用原生 ESM 与 CSS，无需新增进程、框架或运行时依赖。
- 客户端表单和预览表单都是同一配置控制器的视图。
- 预览 iframe 只拿到展示投影，不取得管理员 token、DeviceBearer 或存储访问能力。
- P1a/P1b 是本次方案明确的近期范围；P2–P4 是未来方向，不自动扩大本轮实现任务。

## Non-goals

Scenes/publication, multiple instances, undo, new services, OBS control, business action/settlement changes.

## Current Behavior And Ownership

Approval: execute the two supplied `tmp/component-preview-*.md` documents, near-term P1 only.
- Danmaku settings owns IPC drafts; preserve generations/capability checks.
- Clock card autosaves, renderer reads once; clock-contract/projection/access-policy own contracts.
- Theme directly writes, queue-style-settings maps per-style keys, state-renderer/forms refill. Preserve other form drafts/shared-theme consumers.
- Overtime Admin owns background/actions, status view receives state, overlay renders. Keep rules/time/actions separate.

## Compatibility And Security

Keep URLs/settings/layouts/permissions/dependencies. One active preview; destroy renderer, not draft. Parent checks exact source/opaque origin; child checks direct parent/local origin. No credentials/full snapshots. Drag only changes its named region. Explicit clock URL fields override live config; updates reuse one timer. Isolate test ports/data/Electron storage, never restart the user's app.

## Tasks And Milestones

### Task 1: Controller

**Files:** New `public/js/admin/component-config-controller.js`, `test/admin/component-config-controller.test.js`.
**Interfaces:** `createComponentConfigController({ initial, read, persist })`: getState/edit/save/discard/subscribe/receive/reload/reset. saved/draft/dirty/loading/loaded/saving/error/conflict state. Persistence returns authoritative component config.
- [x] Test and implement race/failure/discard/external merge/duplicate save/reset.
```js
controller.edit({ fontSize: 32 });
const pending = controller.save();
controller.edit({ fontSize: 36 });
confirm({ fontSize: 32 });
await pending;
assert.equal(controller.getState().saved.fontSize, 32);
assert.equal(controller.getState().draft.fontSize, 36);
```
- [x] Run `node --experimental-vm-modules --test test/admin/component-config-controller.test.js`.

### Task 2: Dialog/Danmaku

**Files:** New shared dialog/CSS; danmaku settings/dialog/preview; draft/preview and lifecycle tests.
**Interfaces:** `openComponentPreview({ id, title, controller, url, createPanel, projectConfig, size, data })`; parent init/config/data/dispose, child ready/edit/status. Local references/namespaced IDs.
- [x] Shared background/fit/loading/save/discard/cleanup; parent parameters; controller drafts; renderer/region gestures and standalone preview retained.
- [x] Verify controller/dialog and both affected danmaku suites.

### Task 3: Clock

**Files:** Card/fragment/renderer, projection and clock tests. Existing access policy already permits scoped GET /api/state; no permission expansion required.
**Interfaces:** Keep eight-key `clockSettingsPayload(config)`; preview parent-only, live createOverlaySocket plus projected settings.
- [x] Explicit save/discard, suspend embedded renderer; confirm component-only responses; projected state read, no writes/other scopes.
- [x] Verify URL overrides/late HTTP/single timer with clock runtime/contract/projection suites.

### Task 4: Queue

**Files:** Theme/settings helper/state renderer/fragment/queue renderer and tests.
**Interfaces:** Flat component draft retains all styles; existing per-style mapper; persist dirty keys/final style only.
- [x] Presets/defaults/styles edit only; preserve A→B→A drafts; snapshots and both views use controller.
- [x] Sample renderer without business writes/network; verify multi-style saves/failures/late snapshots/payload scope with queue/Admin suites.

### Task 5: Overtime

**Files:** Admin/status view/fragment/shared-console-responsive CSS/renderer/tests.
**Interfaces:** `{ path, fit }` persists config endpoint; parent projects read-only state; source switch resets revision/invalidates old callbacks, retaining drafts.
- [x] Remove iframe/reloads/empty column; compact status/actions, time/appearance row, full-width rules/settlements. Keep business endpoints.
- [x] Verify high sample revision→lower actual/drafts/no writes/cleanup using overtime suites.

### Task 6: Integration

**Files:** Overlay/WS references, plan/index; QA under `tmp/`.
- [x] Focused suites and warranted JS/architecture/contract gates.
- [x] Isolated Electron: two save directions, draft retention, drag, clock suspension, four dialogs, overtime layout.
- [x] Review touched diff, `git diff --check`, `git status --short`; no generated/sensitive/unrelated changes.

## Done When

Eight near-term acceptance scenarios have focused evidence; desktop evidence passes or limitation is recorded. P2–P4 excluded; no dependencies/branches/commits.

## Rollback Or Failure Handling

Failure retains drafts; saves freeze snapshot, reset invalidates old target. Dispose dialog separately. Reverse only task-owned hunks, never destructive reset/checkout. Record missing prerequisites rather than false completion.

## Learning And Evidence

Read supplied references/owners for steps 1–3. Official URLs returned restricted-fetch errors on 2026-09-30; no fresh external verification claimed. Verify preview/publication isolation, one controller/two views and document/data/session separation with synthetic tests.

### Verification on 2026-09-30

- Focused controller, preview, danmaku, clock, queue, overtime, projection and WebSocket authorization suites: 118 passed.
- Admin suite: 114 passed, including its existing browser fixtures. Initial sandbox browser spawn failure was resolved by running those existing tests outside the filesystem sandbox.
- Final JavaScript syntax check: 1,072 files passed. Architecture checks: 22 passed. Documentation checks: 9 passed. Removed obsolete overtime size and theme empty-catch baselines after the owning code shrank.
- Impeccable detector: no findings for the changed preview CSS, overtime layout and three fragments.
- Isolated Electron 43 QA used real fragments, renderers, preload and authorized license IPC with synthetic settings. Ephemeral loopback HTTP and all Electron storage under repository tmp; never launched production main or used real accounts.
- QA inventory completed: clock page→dialog draft, dialog save→page, small iframe suspension/resume; queue A→B→A and all-style payload, failed save/retry; overtime no embedded iframe, sample 1000→actual 5 revision switch, draft fit retained, appearance-only write; danmaku keyboard/mouse region movement, narrow intent and both save entries.
- Lifecycle/security checks: repeated open remains one dialog, forged source/origin messages ignored, no duplicate IDs, no iframe-origin API requests, no renderer errors. Shared range observers and font registrations release on close.
- Native Electron capturePage screenshots inspected for all four dialogs and overtime layout. Playwright screenshots timed out in this environment; native capture succeeded. Scratch harness: tmp/component-preview-qa.cjs; screenshots: tmp/component-{clock,danmaku,queue-final,overtime,overtime-page}.png.
- At 800 CSS pixels, the overtime page stacks into one column without horizontal overflow. Final touched-diff review and git diff --check passed; concurrent unrelated edits remain untouched, and no generated or sensitive files were added to the patch.
- The harness uses synthetic HTTP state/persistence and the real license IPC boundary; it does not establish real-server deployment or OBS/Livehime receipt.

### Contract closure on 2026-09-30

- [x] npm run verify:contracts -- --runtime D:/Work/Live/tmp/p1-contract-01fb2b47 passed against pinned commit 01fb2b47d5e081f5dd559933991ade4819eb3428, including ten fixture hashes and runtime cleanliness.
- [x] With LIRA_SERVER_ROOT pointing to that isolated checkout, npm run test:contracts passed 133 tests with zero skips; npm run verify:roundtrip -- D:/Work/Live D:/Work/Live/tmp/p1-contract-01fb2b47 passed 5 tests.
- Original Server checkout remained at 9dcc7617b7a63c94ccd8950f3e736c669ad0240e; no contract lock or existing checkout was changed. The gift-picker test received a narrow mock for the extracted appearance module, retaining its original assertions.
- Logs: tmp/p1-contract-verifier.log, tmp/p1-contract-tests-fixed.log, tmp/p1-contract-roundtrip.log. Synthetic HTTP/SQLite evidence does not assert production authorization or deployment.
- User subsequently requested remaining stages; P2–P4 local completion evidence is recorded in 2026-09-30-component-workspace.md.
