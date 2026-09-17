# Viewer welcome implementation

Status: complete (2026-09-17)

The user requests a welcome toggle and editable message library in the existing
danmaku fixed-reply section. The server owns entry recognition and sending.
The client reads and updates `/api/device/welcome-settings` through the existing
authorized license manager and narrow main-window IPC; no local welcome sender.

Owners: `public/js/admin/danmaku-welcome.js`, `public/pages/admin/toolbox/danmaku.html`,
license operations/client/IPC/preload. Contract: `docs/architecture/desktop/main.md`
and the server's `docs/protocol/viewer-welcome.md`. No local database changes.

Preserve pre-existing changes, Electron origin checks, account ownership guards,
other bots and styles. The switch writes only enabled; saving writes only messages.
Responses must be confirmed before showing saved state. Account changes clear drafts
and ignore late results; failed writes remain unconfirmed and can be refreshed.

1. Implement fixed remote calls and strict IPC input/response projection.
2. Add the existing switch-card and details/list UI patterns with 20 server defaults.
3. Verify validation, account races, editor mutations, failures and the composed UI.

Checks: `node --test test/welcome-settings-ipc.test.js test/danmaku-overlay-ipc.test.js`;
`node --experimental-vm-modules --test test/frontend-welcome.test.js test/frontend-admin-danmaku.test.js`;
`npm run verify:architecture`; `git diff --check`.

Done when UI and server semantics agree, checks pass, and touched diffs are reviewed.
Coordinated server plan: `D:/Work/lira-server/docs/superpowers/plans/2026-09-17-viewer-welcome.md`.

Verification: 41 focused welcome/IPC/composition/remote-client tests passed, as did
22 architecture checks, 5 documentation checks, and `git diff --check`. Read and save
responses preserve edits made in flight; an unauthorized account shows an explicit
disabled state. Two independent HTML fragments keep the existing page composition
small; reviewed file ceilings record the narrow composition/transport additions.

Visual checks used actual client fragments/CSS and a synthetic bridge in Chromium:
toggle, collapse/expand, add/delete/edit/save, scrolling, 20-row count and 1708px
overflow checked. Screenshots: `output/viewer-welcome-2026-09-17/`. Isolated Electron
launch did not complete; packaged runtime and real-room sending remain unverified.
No release, production writes or real messages were performed. Existing and
concurrent unrelated changes were preserved.
