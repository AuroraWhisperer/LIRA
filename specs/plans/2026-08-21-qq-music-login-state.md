# QQ Music Login-State Detection Fix Implementation Plan

**Goal:** Keep the Electron client’s QQ Music login-completion signal tied to a real QQ Music credential, so the login window cannot close while only a generic QQ session is present.

**Architecture:** Keep the existing `persist:music-qq` session partition and IPC contract unchanged. The owning Electron auth manager uses value-based detection for the two cookies consumed as `authst` by the QQ Music client API; `p_skey`/`skey` remain available to provider GTK/Web fallbacks but do not complete the Electron login state.

**Tech Stack:** Electron 43 session cookies, Node.js 24 CommonJS, `node:test`, Markdown architecture documentation.

## Global Constraints

- Preserve context isolation, `safeStorage`, session partitions, and existing IPC channel/result shapes.
- Keep HTTP, IPC, persisted snapshot, and provider contracts backward-compatible.
- Make the smallest task-scoped change and preserve unrelated working-tree edits.
- Do not commit changes unless explicitly requested.

## Goal and Non-goals

The client shall report QQ as logged in when the active `persist:music-qq` session contains a non-empty `qqmusic_key` or `qm_keyst` cookie within the existing allowed QQ domains. A non-empty `p_skey` or `skey` alone is not sufficient because the client playlist API still requires `authst` from one of the two QQ Music cookies.

This does not import provider code into Electron, copy cookies from an external QQ Music/browser session, alter login-window navigation, or change the renderer’s status text.

## Current Behavior and Evidence

- `v3.5.18` used `authCookies: ['qqmusic_key', 'qm_keyst']`; `v3.6.12` broadened that list to include `p_skey` and `skey` while changing the check to non-empty values.
- `src/music/providers/qq-provider-client.js` still builds client `authst` only from `qm_keyst` or `qqmusic_key`, while `src/music/providers/qq-provider-utils.js` accepts all four names for GTK/Web compatibility.
- `src/electron/login-window.js` closes the in-client login window whenever `getMusicAuthState()` reports `loggedIn`; generic QQ cookies can therefore close it before the QQ Music credentials arrive.
- `public/js/playback/ui/playback-bar.js` renders “QQ音乐待登录” directly from `authState.loggedIn`.
- The current workspace’s `data/Partitions/music-qq/Network/Cookies` contains zero rows and no `data/music-auth/qq.cookies.enc`; this is diagnostic evidence for the current data directory, not a reason to read external application data.

## Ownership

- Runtime owner: `src/electron/auth-manager.js`.
- Login-window consumer: `src/electron/login-window.js`.
- Renderer consumer: `public/js/playback/ui/playback-bar.js`.
- Provider compatibility reference: `src/music/providers/qq-provider-utils.js` (`extractQQGtkSource`/`hasQQMusicAuthCookie`); this is intentionally broader than the Electron completion signal.
- Contract document: `docs/architecture/desktop/auth.md`.
- Focused regression: new `test/auth-manager.test.js` with a mocked Electron session.

## Proposed Changes

1. Restore QQ `authCookies` to `qqmusic_key` and `qm_keyst`, the credentials required by the client API.
2. Keep the value-based check so empty or expired cookie rows are not treated as logged in.
3. Add focused tests for both QQ Music credentials and for generic `p_skey`/`skey` cookies remaining logged out.
4. Update the desktop and provider authentication documents to state the intentional distinction.

## Milestones

### Milestone 1: Regression coverage

Add mocked-session tests that fail against the broadened detector when only `p_skey`/`skey` are present and pass only when a non-empty QQ Music credential is present.

Focused verification: `node --test test/auth-manager.test.js`.

### Milestone 2: Minimal runtime fix

Update `auth-manager.js` only for runtime behavior; retain the existing partition, domain filter, snapshot format, and IPC shape.

Focused verification: `node --test test/auth-manager.test.js test/qq-provider.test.js`.

### Milestone 3: Contract documentation and gates

Update `docs/architecture/desktop/auth.md`, then run syntax, architecture, quick, and final diff checks.

Verification: `npm run check`, `npm run verify:architecture`, `npm run verify:quick`, `git diff --check`, and `git status --short`.

## Rollback or Failure Handling

If a focused test or gate fails, inspect only the scoped diff and revert the task-owned edits with `git restore -- <task files>` after confirming no user changes overlap. Do not reset the repository or delete the existing `data/` directory.

## Done When

- In-client QQ login with a non-empty `qqmusic_key` or `qm_keyst` results in `loggedIn: true` and allows the existing login window to auto-close.
- A `p_skey`/`skey`-only intermediate session remains logged out so the login window stays open for the QQ Music credential.
- Empty/expired auth-cookie rows and unrelated cookies remain logged out.
- Focused tests and applicable project gates pass.
- The auth architecture document matches the implementation.
- Existing unrelated working-tree modifications remain untouched.

## Execution Notes

- History comparison identified the `v3.6.12` expansion of Electron `authCookies` as the regression; the provider’s four-cookie GTK/Web compatibility path predates it.
- The runtime fix restores the two-cookie completion boundary while retaining non-empty value checks.
- Focused and repository gates are recorded in the task response; unrelated pre-existing working-tree test failures are not part of this change.
