# Gift interaction controls implementation plan

## Goal and ownership

Implement the accepted gift interaction contract in the Electron gift page.
`src/electron/cloud-sync-controller.js` owns confirmed preferences and serialized
complete Device settings writes. `license-ipc.js` and preload expose only a
validated `{key, enabled}` intent and sanitized state. The gift page consumes it.
The normative server contract is `D:/Work/lira-server/docs/protocol/gift-interaction.md`.

## Constraints and failure handling

Preserve existing user changes, local settings and all secret boundaries. No
new HTTP endpoint, sync scope, dependency, commit or runtime data. Ordinary
settings writes omit these flags and preserve server values. Failed requests
retain the last confirmed value, explicitly become unconfirmed and are checked
by the existing cloud refresh. Account changes discard the previous account's
display. Bilibili logout/account/room resets are server authoritative.

## Milestones and verification

- [x] Add controller intent/state, tests for independent flags, complete payloads,
  rejected enable, lost responses, account changes and serialization.
- [x] Add source-checked IPC and preload methods; verify narrow arguments,
  sanitized errors and denial of foreign windows/frames.
- [x] Add gift-page controls and focused renderer tests for pending, errors,
  logout/remote changes and cleanup; document requirement and IPC contract.
- [x] Run focused Node tests, docs/architecture checks, inspect touched diff,
  `git diff --check` and `git status --short`.

## Done when

The two controls reflect only confirmed cloud values, render distinct login,
invalid-login and timeout messages, show the required offline-disable warning,
and targeted tests pass. Reverse only task-owned patches if verification fails;
never reset the worktree. Real upstream/Electron UI checks must be stated
separately from deterministic tests.

## Completion evidence — 2026-09-15

- Added `specs/gift-interaction-controls.md` and the IPC registry; source and
  renderer tests cover the two controls, request serialization and account races.
- The combined cloud/runtime/isolation, IPC, Electron lifecycle, documentation
  and architecture invocation passed 103 tests. After adding three additional
  regressions and the shutdown-disposal assertion, the focused interaction and
  shutdown invocation passed 34 tests (8 interaction + 26 shutdown).
- Admin composition/style/layout/blindbox compatibility passed 36 tests.
- `npm run check` passed all 758 JavaScript files; changed JS was subsequently
  exercised by the focused tests. `node scripts/check-modularity.js` passed
  with 966 files and zero errors. The main composition reviewed ceiling changed
  from 723 to 732 for nine wiring/cleanup lines; no business logic moved to main.
- `git diff --check` passed. Existing user modifications remain uncommitted;
  the only overlap is the specific main entry in the modularity registry.
- No real Bilibili request, message, live-account write or packaged Electron
  launch was performed. Cloud/reset scenarios use mocks; real server gates/reset
  behavior is owned by the server implementation.

## Browser verification and race fix — 2026-09-15

Used the existing Playwright Chromium runtime with the real composed Admin HTML,
CSS and interaction module. Every resource request was intercepted and fulfilled
from local files; all unrelated scripts were removed and only a fake bridge was
injected. No live account or server was used. The browser was closed after QA.

- Mouse-clicked the two labels through all four combinations; checked pending
  preservation/disabled state, login-required, expired and timeout messages,
  unconfirmed off status and real toast, and the refresh button's recovery.
- Visually inspected screenshots at 1440×1000, 800×900 and 390×844. Both controls,
  error status and refresh button fit the viewport with no horizontal overflow.
  Browser-only mode leaves the desktop controls hidden. No page script errors
  or attempted external origins were observed.
- Reproduced a renderer race: a new-account false snapshot arrived while an old
  enable invoke was pending, then its old true result overwrote the newer view.
  Added a failing regression, then guarded change replies against newer,
  incompatible state events. Repeated the real-browser sequence: both controls
  remain false and no old success toast appears. All 9 interaction tests pass.
- The screenshots, isolated HTML and numerical region measurements are under
  `output/gift-interaction-qa-2026-09-15/` (gitignored). Main evidence:
  `desktop-initial.png`, `desktop-pending-off.png`,
  `desktop-off-unconfirmed.png`, `narrow-off-unconfirmed-800.png`,
  `compact-off-unconfirmed-390.png`, `desktop-account-race-fixed.png`, and
  `browser-qa-result.json`. These verify Chromium rendering, not native Electron
  window placement, DPI or packaged preload behavior.
