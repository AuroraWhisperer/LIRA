# 首次启动配置引导 Implementation Plan

> **For agentic workers:** Implement this plan task by task in the current worktree. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits unless the user explicitly requests one.

**Goal:** 在 LIRA 首次启动时提供一个按步骤验证的配置引导，帮助用户完成 Bilibili 直播基础配置、至少一个音乐账号登录、可选 AI 配置和直播画面接入；完成后不再自动弹出，但可从使用文档重新打开。

**Architecture:** 引导是现有 Admin 页面中的 Vanilla JS 模块和遮罩层，复用现有 `/api/settings`、`/api/ai/*`、`window.bilibiliAuth`、`window.musicAPI` 与已有地址生成逻辑。`src/storage/settings-store.js` 只增加三个字符串设置键保存引导完成版本/时间/可选跳过项；不新增 HTTP、WebSocket、IPC、数据库表、进程或运行时依赖。纯状态闸门与步骤定义独立于 DOM，Electron/Web 模式差异由能力探测处理。

**Tech Stack:** Node.js 24+、CommonJS backend、Vanilla JavaScript ES modules、原生 CSS、Electron 43、`node:test`。

## Global Constraints

- 保持模块化单体、Node.js 24+、CommonJS 后端、Vanilla JS ES 模块和无构建步骤。
- 不改变现有 HTTP 方法/路径/响应形状、WebSocket 消息、IPC 通道、Cookie 分区、`safeStorage`、`local-media://` 校验和页面 URL。
- 不在引导层读取、记录或广播 Cookie、API Key 或其他秘密；登录与密钥保存必须调用现有边界。
- Bilibili + 房间号是必做步骤；QQ/网易云至少完成一个；AI 和 OBS/直播姬地址是可选但必须有明确跳过/确认状态。
- 引导完成状态使用设置存储，不使用 localStorage 作为最终事实源；当前临时步骤不得在异常退出后伪造完成。
- 所有用户可见异步操作必须有禁用、加载、成功和失败状态；下一步不得在闸门未满足时可点击。
- 保留现有使用文档、功能页和登录入口；重新打开引导不得清除歌曲、队列、账号 Cookie、AI 密钥或主题。

## Current Behavior

- Admin 初始化在 `public/js/admin/app.js` 中统一启动设置、使用文档和百宝箱模块。
- Bilibili 登录只在 Electron 暴露 `window.bilibiliAuth`，已有 `getAuthState/login/logout`；Web 模式显示不可用。
- QQ 音乐/网易云登录只在 Electron 暴露 `window.musicAPI.getAuthState/login/logout`，播放器已有登录操作。
- 直播间号由 `public/js/admin/settings.js` 通过 `POST /api/settings` 保存，服务端在 `src/server/routes/settings-routes.js` 中白名单过滤并规范化 `roomId`。
- AI 配置由 `/api/ai/config` 读写，API Key 在 `src/ai/config-store.js` 通过现有密钥编解码器保存，公开配置只返回 `hasDeepSeekApiKey`。
- 使用文档已在 `public/pages/admin/toolbox/usage-guide.html` 提供账号登录、DeepSeek 和直播姬/OBS 说明，但没有从首次启动状态驱动的交互式步骤。
- `src/server.js#getState()` 会返回普通 settings，因此新增 onboarding 键会随现有状态快照可见；不得把秘密放入该对象。

## Ownership

- Admin owner: `public/js/admin/onboarding.js`, `public/pages/admin/toolbox/shell-start.html`, `public/css/admin/other-features/onboarding.css`, `public/js/admin/app.js`。
- Storage owner: `src/storage/settings-store.js` and existing `src/server/routes/settings-routes.js` whitelist behavior.
- Existing auth owners: `src/electron/bilibili-auth.js`, `src/electron/auth-manager.js`, `src/electron/preload.js`, `public/js/admin/settings.js`, `public/js/playback/operations/provider-operations.js`。
- Existing AI owner: `src/ai/config-store.js`, `src/server/routes/ai-routes.js`, `public/js/admin/ai-assistant-settings.js`。
- Contracts: `docs/architecture/desktop/auth.md`, `docs/architecture/desktop/preload.md`, `docs/architecture/backend/storage.md`, `docs/architecture/frontend/app.md`, proposed `docs/architecture/adr/0009-first-run-onboarding.md`。
- Focused tests: new `test/onboarding.test.js`, `test/settings-store.test.js` additions, `test/frontend-admin-shell.test.js`; existing Electron auth and AI route tests remain regression gates.

## User Route

| Step | Visible goal | Completion gate | Skip policy | Next action |
|---|---|---|---|---|
| `welcome` | 知道引导范围和桌面版要求 | 用户点击开始 | 不适用 | 进入 Bilibili |
| `bilibili` | 扫码登录并填写房间号 | `loggedIn`, 非空规范化房间号，点击刷新直播后连接状态不为配置缺失 | 不允许 | 进入音乐账号 |
| `music` | 登录 QQ 或网易云至少一个 | 任一平台 `loggedIn`；另一个可显示未登录 | 可跳过但完成页标记“未完成基础音乐配置” | 进入 AI |
| `ai` | 选择是否启用 AI 并测试 DeepSeek | 未启用可直接通过；启用要求 `hasDeepSeekApiKey`、地址/模型有效且测试成功 | 可跳过 | 进入画面 |
| `overlay` | 选择地址并确认添加到直播软件 | 至少选一个现有地址且勾选确认 | 可跳过，完成页标记 | 进入完成 |
| `complete` | 检查摘要和后续入口 | 用户点击完成 | 不适用 | 保存完成状态并关闭 |

## Proposed Files And Interfaces

### New `public/js/admin/onboarding.js`

Export these testable functions and initialize `window.AdminApp.onboarding`:

```js
export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STEPS = Object.freeze([
  'welcome', 'bilibili', 'music', 'ai', 'overlay', 'complete'
]);

export function normalizeOnboardingState(input = {});
export function getStepGate(stepId, state);
export function getNextStep(stepId, state);
export function isOnboardingComplete(settings, version = ONBOARDING_VERSION);
export function getIncompleteOptionalSteps(state);
export function createOnboardingController(deps);
export function initOnboarding();
```

`deps` must provide `{ document, window, api, toast, showError, getAppState, localOverlayOrigin }` so the controller is testable without Electron. The controller must expose `{ open, close, reset, next, previous, refresh, getState }`; `open()` renders the current step and traps focus inside the dialog, `close()` only closes after completion or explicit “退出引导” confirmation, `reset()` clears only the three onboarding settings keys, and `next()` rejects when `getStepGate()` is false.

The controller reads auth states only through these existing methods:

```js
window.bilibiliAuth?.getAuthState?.();
window.bilibiliAuth?.login?.();
window.musicAPI?.getAuthState?.('qq');
window.musicAPI?.getAuthState?.('netease');
window.musicAPI?.login?.('qq');
window.musicAPI?.login?.('netease');
```

It writes ordinary settings with:

```js
api('/api/settings', { roomId });
api('/api/settings', {
  onboardingVersion: String(ONBOARDING_VERSION),
  onboardingCompletedAt: new Date().toISOString(),
  onboardingSkippedOptional: skippedIds.join(',')
});
```

It reads/writes AI only through `/api/ai/config` and calls `POST /api/ai/test/deepseek`; the API key input is never copied into `stateService` or persisted by the frontend.

### New `public/pages/admin/toolbox/onboarding.html`

Add one dialog fragment inside the Admin composition, with stable IDs:

- `#liraOnboarding` (`role="dialog"`, `aria-modal="true"`, `hidden` by default)
- `#onboardingStepContent`, `#onboardingProgress`, `#onboardingStatus`
- `#onboardingBackBtn`, `#onboardingNextBtn`, `#onboardingSkipBtn`, `#onboardingCloseBtn`
- action targets `#onboardingBilibiliLogin`, `#onboardingMusicQqLogin`, `#onboardingMusicNeteaseLogin`, `#onboardingBilibiliRefresh`, `#onboardingAiEnable`, `#onboardingAiTest`, `#onboardingOverlayConfirm`, `#onboardingFinishBtn`

The fragment must not duplicate the full settings or AI forms. It contains compact links/buttons that select the existing page/feature when a user needs advanced configuration.

### New `public/css/admin/other-features/onboarding.css`

Style the full-viewport scrim, centered dialog, step header, progress indicator, status rows, disabled/loading buttons, error text, focus ring and narrow-screen layout. Use existing CSS variables and `prefers-reduced-motion`; do not add a marketing hero or an unrelated card system. Import it from `public/css/admin/other-features.css`.

### `src/storage/settings-store.js`

Add these defaults near other general settings:

```js
onboardingVersion: '',
onboardingCompletedAt: '',
onboardingSkippedOptional: ''
```

No migration table or schema change is needed because the existing settings bootstrap inserts missing default keys. The settings route whitelist derives from `DEFAULT_SETTINGS`, so no separate route list is required.

### `public/js/admin/app.js`

Import `./onboarding.js`, call `initOnboarding()` after `initUsageGuide()` and before feature navigation is finalized, and pass existing utility functions through `window.AdminApp.utils`. The module must not delay WebSocket/state initialization; auth refreshes are local to the open step.

### `public/pages/admin/toolbox/usage-guide.html` and `public/js/admin/usage-guide.js`

Add a compact “重新打开首次启动引导” action near the usage guide intro. It calls `window.AdminApp.onboarding.open({ reset: false })`. Keep the existing explanatory sections and anchors unchanged.

## Milestones

### Task 1: Define and persist onboarding state

**Files:**

- Modify: `src/storage/settings-store.js`
- Test: `test/settings-store.test.js` or the existing settings-store focused test file

**Interfaces:**

- Produces defaults for `onboardingVersion`, `onboardingCompletedAt`, and `onboardingSkippedOptional`.
- Preserves all existing settings and `getSettings()/setSetting()` behavior.

- [ ] Add a failing test that creates a temporary settings database and asserts all three keys exist as empty strings on first bootstrap.
- [ ] Run `node --test test/settings-store.test.js` (or the repository's exact focused settings test) and confirm failure before implementation.
- [ ] Add only the three default keys; do not add a new table or alter existing setting serialization.
- [ ] Re-run the focused settings test and `node --test test/server-smoke.test.js` settings assertions.

### Task 2: Implement the pure step machine and DOM controller

**Files:**

- Create: `public/js/admin/onboarding.js`
- Create: `test/onboarding.test.js`

**Interfaces:**

- Consumes: existing Admin utility `api`, `toast`, `showError`, `localOverlayOrigin`, existing state service, Bilibili/music preload bridges and AI endpoints.
- Produces: exported gate helpers and `window.AdminApp.onboarding` controller described above.

- [ ] Write failing unit tests for: Bilibili gate rejection without desktop bridge; room ID normalization requirement; music gate requiring QQ or NetEase; AI disabled/enabled branches; overlay confirmation; completed-version suppression; next/previous bounds; optional skip tracking.
- [ ] Run `node --test test/onboarding.test.js` and confirm the helpers/controller are missing or fail.
- [ ] Implement immutable step definitions, `normalizeOnboardingState`, `getStepGate`, `getNextStep`, `isOnboardingComplete` and `getIncompleteOptionalSteps` before adding DOM behavior.
- [ ] Implement event handlers with an operation token or disabled buttons so double clicks cannot start two login/save/test requests.
- [ ] Implement `open`, `close`, `reset`, `next`, `previous`, `refresh`, focus restoration and `aria` updates. Do not use `innerHTML` for untrusted account names, model errors or server messages; use `textContent`.
- [ ] Run `node --test test/onboarding.test.js` and confirm all pure/controller tests pass.

### Task 3: Compose the overlay and visual states

**Files:**

- Create: `public/pages/admin/toolbox/onboarding.html`
- Create: `public/css/admin/other-features/onboarding.css`
- Modify: `public/css/admin/other-features.css`
- Modify: `public/js/admin/app.js`
- Test: `test/frontend-admin-shell.test.js`

**Interfaces:**

- Consumes the IDs and callbacks from Task 2.
- Produces an accessible hidden-by-default dialog with stable step/action IDs and no duplicate settings forms.

- [ ] Add failing shell assertions for the dialog role, hidden default, required action IDs, CSS import and `app.js` onboarding initialization.
- [ ] Run `node --test test/frontend-admin-shell.test.js` and confirm the new assertions fail.
- [ ] Add `pages/admin/toolbox/onboarding.html` to `ADMIN_FRAGMENT_PATHS` in `src/server/admin-page.js` immediately after `pages/admin/toolbox/shell-start.html`, keeping the fragment order deterministic.
- [ ] Add the CSS import and implement scrim/dialog/progress/loading/error/focus/narrow layout states using existing variables.
- [ ] Import and initialize the module without delaying state/WebSocket startup.
- [ ] Run the focused shell test and `npm run check`.

### Task 4: Wire real login, room, AI and overlay actions

**Files:**

- Modify: `public/js/admin/onboarding.js`
- Modify: `public/pages/admin/toolbox/usage-guide.html`
- Modify: `public/js/admin/usage-guide.js`
- Test: `test/onboarding.test.js`
- Test: existing `test/electron-main-modules.test.js`, `test/ai-routes.test.js`, `test/bilibili-login-window.test.js` only when a contract regression is exposed

**Interfaces:**

- Consumes existing `window.bilibiliAuth`, `window.musicAPI`, `/api/settings`, `/api/ai/config`, `/api/ai/test/deepseek` and overlay URL builders.
- Produces the user route in this plan without changing any provider or IPC contract.

- [ ] Add tests for successful Bilibili login + room save + refresh, one-provider music completion, AI test failure retention, explicit optional skip, and completion persistence.
- [ ] Implement Bilibili login action followed by auth-state refresh; save room ID before calling the existing reconnect action.
- [ ] Implement QQ/NetEase login buttons independently; show both statuses without exposing cookie names or values.
- [ ] Implement AI enable toggle, config save/test and a password input. A failed test leaves the step incomplete and keeps the user-entered key only in the request body until the existing server response returns.
- [ ] Implement overlay selection from existing generated URLs and a required confirmation checkbox; do not attempt to call OBS/直播姬 or create a new URL contract.
- [ ] Add the usage-guide reopen action and verify it does not reset completion automatically.
- [ ] Run `node --test test/onboarding.test.js test/frontend-admin-shell.test.js test/ai-routes.test.js`.

### Task 5: Save completion, reset behavior and mode handling

**Files:**

- Modify: `public/js/admin/onboarding.js`
- Modify: `public/js/admin/other.js` only if navigation selection is needed for advanced links
- Modify: `test/onboarding.test.js`
- Modify: `test/server-smoke.test.js` for settings round-trip coverage

**Interfaces:**

- Consumes settings keys from Task 1 and controller from Tasks 2–4.
- Produces one-time auto-open behavior and a safe manual reset path.

- [ ] Add tests proving completed version suppresses auto-open, reset clears only onboarding keys, and web mode displays unavailable login capabilities without claiming success.
- [ ] On first Admin initialization, fetch current state and open only when `onboardingVersion !== ONBOARDING_VERSION` and no completed timestamp for that version exists.
- [ ] Persist completion atomically from the UI perspective by sending all three onboarding keys in one `/api/settings` request; only close after the request succeeds.
- [ ] Implement explicit “重新开始引导” confirmation that sends empty onboarding keys and reopens at `welcome`; never call database clear APIs or logout APIs.
- [ ] Add a completion summary listing skipped optional steps and links to their existing settings panels.
- [ ] Run focused onboarding, settings and server smoke tests.

### Task 6: Browser verification and documentation alignment

**Files:**

- Modify: `docs/architecture/README.md` to list ADR-0009 under architecture decisions
- Modify: `docs/architecture/engineering/ai-workflow.md` only if the final owner/test route needs a new route row
- Modify: `docs/architecture/frontend/app.md`, `docs/architecture/desktop/auth.md`, or `docs/architecture/backend/storage.md` only to record implemented facts owned by those documents
- Test/verify: no new runtime files

- [ ] Run `node --test test/onboarding.test.js test/frontend-admin-shell.test.js test/settings-store.test.js`.
- [ ] Run `npm run check` and `npm run verify:quick`.
- [ ] Start the app with `npm start` or `npm run desktop` and verify first-run behavior at desktop width and narrow width: scrim covers the app, focus stays in the dialog, disabled Next cannot advance, errors remain readable, and no content overlaps.
- [ ] Verify Electron: Bilibili, QQ and NetEase login buttons open only their existing allowed windows; Web mode clearly reports desktop-only actions.
- [ ] Verify refresh, app restart, manual reopen, optional skip and reset; ensure no secret appears in `/api/state`, WebSocket snapshots, DOM status text or logs.
- [ ] Run `npm test`, `npm run verify`, `git diff --check`, and `git status --short`; inspect that only planned files changed and no `data/`, `logs/`, `tmp/` or `release/` output is included.

## Failure Handling And Rollback

If a login bridge, API test or browser check fails, leave the current step open and record the failure in the plan; do not weaken the gate or bypass existing auth checks. Revert only Task-owned hunks with `apply_patch`. Do not use `git reset --hard`, blanket checkout, broad deletion, or database cleanup. If the new settings keys cause a bootstrap regression, remove only those default entries and their focused tests, preserving all existing settings rows.

## Done When

- First-run Admin shows the six-step route and cannot advance past an unmet required gate.
- Bilibili login + room ID and at least one music login are actually verified through existing status APIs; AI and overlay steps have explicit optional/confirmation states.
- Completion persists across refresh and restart; manual reopen/reset affects only onboarding keys.
- No new process, dependency, HTTP/WS/IPC contract, database table, secret exposure or login-window security relaxation is introduced.
- Focused tests, syntax, quick verification and full test gate pass; desktop/Web visual and mode checks pass.
- Architecture facts and the proposed ADR are updated consistently, and the final diff contains no unrelated or generated data.
