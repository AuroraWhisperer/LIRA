# Gift sprint text overlay implementation plan

**Status:** Completed

## Goal

Reduce gift-assistant tabs from 38px to 26px, unify wish source actions as
secondary buttons, and add a 月底冲刺 tab with a transparent text overlay showing
还差 N 个水晶球 from the existing sprint snapshot.

## Current behavior and ownership

- `public/css/admin/gift-display/settings.css` owns gift-assistant tab geometry.
- `public/pages/admin/toolbox/gift-wishes.html` uses a plain preview link beside
  secondary buttons; `admin/gifts/wishes.js` owns its address.
- `src/bilibili/gift/query-service.js#getGiftSprintSnapshot` already computes
  `remainingCrystalBalls = ceil(remainingRmb / 100)` for the current source.
- Admin state arrives through `Events.STATE_LOADED`; overlays use the existing
  scoped WebSocket snapshot and reconnect lifecycle.
- `src/server/access-policy.js` owns overlay pages/capabilities;
  `overlay-projection.js` owns the field allowlist.
- Contracts: `docs/reference/frontend/pages.md`, `frontend/overlays.md`,
  `backend/ws.md`.

## Boundaries and compatibility

Reuse existing sprint goals, reset behavior, and counting. No new settings,
database changes, gift calculations, or write endpoints. Preserve all existing
tabs (including in-progress 大航海感谢), routes, authorization, and user edits.
The new `gift-sprint` scope may read only the sprint fields needed for display.
No user-data access, real gift capture, commit, branch, or release.

## Milestones

- [x] Compact tabs and unify preview action; verify existing wish interactions.
- [x] Add shared text formatter/style, admin tab with copy/preview and navigation
  to the existing sprint form, and `/gift-sprint` browser-source page.
  Verify live updates, zero target, completed goal, and reset using synthetic state.
- [x] Register the new page and least-privilege snapshot projection. Verify HTTP
  serving/token scope, denied writes/private reads, and WebSocket projection.
- [x] Update contracts and built-in guide; inspect the rendered desktop surface
  using the existing isolated Electron QA pattern, run proportional gates, review
  task-owned diff, and archive this plan.

## Verification

Use `node --experimental-vm-modules --test` on affected gift frontend tests,
new sprint tests, overlay projection tests, WebSocket access-policy tests,
admin composition tests, and the existing desktop request-auth test.
Run `npm run check`, `npm run verify:architecture`, and `npm run verify:docs`
because the work adds a public overlay module and page contract. Run one
Impeccable detector pass on edited UI files. Review `git diff --check` and
`git status --short`; compare pre-existing edited files to task-start copies in
`tmp/gift-sprint-text/baseline`.

## Failure handling and done when

Reverse only task-owned hunks if a change must be withdrawn. Temporary QA uses
isolated storage under repository `tmp/` and owns its processes. Done when the
three requested changes work, the text uses server numbers without recounting,
the new credential cannot read other domains or mutate state, relevant checks
pass, and contract/diff review is complete.

## Results (2026-10-03)

- The focused gift, HTTP scope, snapshot projection, WebSocket, admin composition,
  and desktop credential checks passed (99 tests). New assistant/overlay browser
  checks were then split out of the existing wish test to respect its reviewed
  size ceiling; both browser files passed again (31 tests).
- Syntax, architecture (22 tests), governance documentation (9 tests), and
  affected admin style/usage-guide/gift-panel checks passed.
- The Impeccable detector returned no findings for the changed UI.
- An isolated Electron 43 fixture used the actual desktop preload and main-owned
  request authorization. Anonymous `/admin` returned 401, `/gift-sprint` returned
  200, and the authorized desktop loaded without a renderer management token.
- Computed tabs are 26px; all three wish source actions are 36px, semibold, and
  have no underline. Screenshot evidence is in `tmp/gift-sprint-text/`.
- Real scoped WebSocket snapshots kept admin and overlay text equal for 7, 3, 0,
  and reset to 10. Zero target hid the text. Goal navigation focused the existing
  input. Preview opening used the desktop external-URL handler; copy arguments
  were checked through a synthetic clipboard adapter (the hidden test window's
  native clipboard write was not asserted). Browser tests cover disconnect and
  reconnect. All data was synthetic; the owned Electron instance was closed.
- Existing user changes, including the 大航海感谢 tab, were preserved. No new
  configuration keys, storage, external services, or package dependencies.
