# Desktop authentication and IPC boundaries

Status: Implemented. Owner: Electron main. Approved scope: user audit follow-up, 2026-09-25.

## Requirements

- Complete Bilibili cookies may persist only through the existing Chromium partition and safeStorage snapshot. Retire plaintext export and its environment switch because the user confirmed external consumers have stopped. Remove obsolete plaintext files on encrypted persistence, restoration and logout without reading their contents.
- Privileged legacy music, playback, Bilibili and desktop IPC operations must validate the current main window, main frame and exact local origin before side effects. Preserve the legitimate page matrix in [preload.md](../docs/architecture/desktop/preload.md#1-安全模型); retain license-page desktop controls.
- An account operation must not leave an older login capable of restoring a revoked/replaced account. For each existing platform, logout, a new login or cloud replacement cancels the older login and waits for its pending snapshot writes. Imports/restoration/logout execute in request order; a newer replacement wins in full. Cancelled logins return `cancelled: true`, `snapshot: null`, `state.loggedIn: false`, so they cannot mark cloud credentials dirty. Shutdown cancels and drains owned login writes. Keep the existing authentication owner and encrypted formats.
- The supported product connects to the owner's single official LIRA server. Distinct streamer IDs must stay isolated in the existing dynamic-lottery partitions. Cross-server partition migration is outside the current business model.

## Acceptance criteria

- Encryption, restoration, account display and logout continue to work; the retired export switch cannot create a plaintext file, an old plaintext file is removed, and unavailable encryption has no plaintext fallback. Test: `test/bilibili-cookie-storage.test.js`.
- Every legacy IPC channel rejects missing callers, a different window, a subframe and a different origin before executing its action. Legal admin aliases retain music/Bilibili/playback capabilities; the license page retains desktop capabilities. Tests: `test/legacy-ipc-source.test.js`, `test/playback-snapshot-ordering.test.js` and isolated Electron validation.
- `test/desktop-auth-race-electron.test.js` uses isolated real Electron cookies, safeStorage and production auth functions. Login/logout, repeated login, cloud replacement, delayed closed-window writes and concurrent cloud imports reproduced six failures before repair; normal encrypted login remained successful. All cases pass after repair, including a debounced music snapshot during shutdown and the real preload IPC caller matrix. `test/electron-shutdown.test.js` verifies the composition root drains authentication before backend shutdown.
- Existing dynamic-lottery tests must demonstrate independent same-server accounts, encrypted persistence and invalidation of obsolete authorization results. No origin migration is added.
