# QQ Music Login-State Detection Fix Implementation Plan

**Goal:** Make the Electron client recognize the same non-empty QQ authentication cookies that the QQ provider already accepts, so a successful in-client login is not shown as “QQ音乐待登录”.

**Architecture:** Keep the existing `persist:music-qq` session partition and IPC contract unchanged. Update the owning Electron auth manager to use value-based detection for the provider’s four supported QQ auth cookies, then document and test the corrected boundary; the existing renderer will display the corrected state without a UI-specific workaround.

**Tech Stack:** Electron 43 session cookies, Node.js 24 CommonJS, `node:test`, Markdown architecture documentation.

## Global Constraints

- Preserve context isolation, `safeStorage`, session partitions, and existing IPC channel/result shapes.
- Keep HTTP, IPC, persisted snapshot, and provider contracts backward-compatible.
- Make the smallest task-scoped change and preserve unrelated working-tree edits.
- Do not commit changes unless explicitly requested.

## Goal and Non-goals

The client shall report QQ as logged in when the active `persist:music-qq` session contains a non-empty `qqmusic_key`, `qm_keyst`, `p_skey`, or `skey` cookie within the existing allowed QQ domains.

This does not import provider code into Electron, copy cookies from an external QQ Music/browser session, alter login-window navigation, or change the renderer’s status text.

## Current Behavior and Evidence

- `src/electron/auth-manager.js` uses `authCookies: ['qqmusic_key', 'qm_keyst']` and checks cookie names only, while `src/music/providers/qq-provider-utils.js` accepts all four names with non-empty values.
- `src/electron/login-window.js` closes the in-client login window only when `getMusicAuthState()` reports `loggedIn`, so a detector false negative prevents the normal completion path.
- `public/js/playback/ui/playback-bar.js` renders “QQ音乐待登录” directly from `authState.loggedIn`.
- The current workspace’s `data/Partitions/music-qq/Network/Cookies` contains zero rows and no `data/music-auth/qq.cookies.enc`; this is diagnostic evidence for the current data directory, not a reason to read external application data.

## Ownership

- Runtime owner: `src/electron/auth-manager.js`.
- Login-window consumer: `src/electron/login-window.js`.
- Renderer consumer: `public/js/playback/ui/playback-bar.js`.
- Provider compatibility reference: `src/music/providers/qq-provider-utils.js` (`hasQQMusicAuthCookie`).
- Contract document: `docs/architecture/desktop/auth.md`.
- Focused regression: new `test/auth-manager.test.js` with a mocked Electron session.

## Proposed Changes

1. Expand QQ `authCookies` to the four names already accepted by the provider.
2. Change `getMusicAuthState()` to require a non-empty cookie value, preventing expired/empty cookie rows from being treated as logged in.
3. Add focused tests for each supported cookie, empty values, and unrelated key cookies.
4. Update the authentication fact document to match the runtime rule.

## Milestones

### Milestone 1: Regression coverage

Add mocked-session tests that fail against the current two-name/name-only detector and pass only when all four non-empty cookie cases are recognized.

Focused verification: `node --test test/auth-manager.test.js`.

### Milestone 2: Minimal runtime fix

Update `auth-manager.js` only; retain the existing partition, domain filter, snapshot format, and IPC shape.

Focused verification: `node --test test/auth-manager.test.js test/qq-provider.test.js`.

### Milestone 3: Contract documentation and gates

Update `docs/architecture/desktop/auth.md`, then run syntax, architecture, quick, and final diff checks.

Verification: `npm run check`, `npm run verify:architecture`, `npm run verify:quick`, `git diff --check`, and `git status --short`.

## Rollback or Failure Handling

If a focused test or gate fails, inspect only the scoped diff and revert the task-owned edits with `git restore -- <task files>` after confirming no user changes overlap. Do not reset the repository or delete the existing `data/` directory.

## Done When

- In-client QQ login with any supported non-empty auth cookie results in `loggedIn: true` and allows the existing login window to auto-close.
- Empty/expired auth-cookie rows and unrelated cookies remain logged out.
- Focused tests and applicable project gates pass.
- The auth architecture document matches the implementation.
- Existing unrelated modifications in `public/js/admin/metrics.js` and `src/server/system-metrics.js` remain untouched.

## Execution Notes

- The regression test failed before the runtime change for `p_skey` and for empty auth-cookie values, confirming both observed defects.
- After the runtime change, `node --test test/auth-manager.test.js test/qq-provider.test.js`, `npm run check`, and `npm run verify:architecture` passed.
- `npm run verify:quick` passed its documentation gate and syntax stage; the architecture stage was also run directly and passed.
