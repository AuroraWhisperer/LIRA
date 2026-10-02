# Canvas component library implementation plan

Status: Completed

## Goal

Add 展示板、桌面歌词、直播小游戏、礼物滚动、盲盒盈亏榜、礼物许愿 to the current canvas. Games retain three categories (直播间互动、转盘、投票与评分) and six concrete choices. Each instance owns its appearance and uses existing geometry, draft recovery, save, publication and single-item output.

## Current behavior and ownership

`shared/scene-components.js` and `src/shared/scene-component-types.js` declare four render types. The picker uses `component-preview-definitions.js`; the scene document owns independent appearance and geometry. The existing eight overlay pages own rendering. `server/scene-components.js` projects only allowed display data; the scene capability stays in the parent, and children are opaque sandboxed frames.

## Decisions and compatibility

- Extend the current picker and panels, inheriting its CSS tokens and controls.
- New types are independent canvas instances. They do not introduce another global settings save owner. Existing four shared-default editors remain intact.
- Reuse existing rendering and domain services. Game sessions, wish targets, gift accounting and song library remain managed by their existing owners.
- Display reads may be asynchronous for wishes and gift profiles; recheck owner and source capability after completion. Unavailable gift data clears that component without exposing management state.
- Preserve the document schema version, original source URLs, default settings, Electron security, and all pre-existing working-tree edits. No database migration, dependency, commit or deployment.

## Milestones

- [x] Add explicit descriptors, picker categories and per-instance parameter panels; validate allowed configuration on the server.
- [x] Adapt the existing eight renderers to the credential-free component protocol and project real display data through the scene owner.
- [x] Verify independent variants, geometry, saving/reopening, publication and source isolation with focused contract and browser tests; update the component guide/specification.

## Verification

Verification used the existing isolated canvas fixture with synthetic data and an in-memory database. No real user data, live Bilibili session or running desktop application was used.

- Affected scene, preview, transport, game, lyric and blindbox tests: 225 passed with `node --experimental-vm-modules --test --test-concurrency=1` (local log: `tmp/canvas-focused-checks.log`).
- Browser regressions: `node --experimental-vm-modules --test --test-concurrency=1 test/admin/canvas-component-library.test.js test/admin/canvas-editing.test.js test/admin/component-preview-browser.test.js test/admin/component-preview-output.test.js test/admin/component-preview-drafts-browser.test.js test/admin/component-preview-recovery.test.js test/gifts/frontend-gift-feed.test.js test/gifts/frontend-gift-wishes.test.js` — 69 passed (`tmp/canvas-browser-regression.log`).
- Avatar reproduction confirmed the old proxy failed in sandboxed output. Gift banners now accept the scene's allowlisted image resolver; games reuse that resolver. `node --experimental-vm-modules --test --test-concurrency=1 test/admin/canvas-component-library.test.js test/gifts/frontend-gift-banner.test.js test/gifts/frontend-gift-feed.test.js test/games/games-overlay.test.js` — 27 passed (`tmp/canvas-avatar-checks.log`). The library test passed again after adding invalid-image URL assertions (`tmp/canvas-library-final.log`).
- The library check exercised all 13 choices, independent parameter changes, 400×300 geometry, save/reopen, publication, matching game sessions, actual projected display data and avatars, single-item output, and continued output after the editor closed. Sandboxed frames made no API requests. Screenshots: `tmp/canvas-component-library/`.
- `npm run verify:architecture` — 22 passed. `npm run check` — 1170 JavaScript files passed. Final changed-module syntax checks, `npm run verify:docs`, `git diff --check` and task-owned diff/status review complete the checks.

Existing four default-setting owners and their SQLite size constraints remain intact; the new components save independent appearance and geometry in the scene document. Desktop hardware performance and real OBS/Livehime sessions were not part of this isolated verification.

## Failure handling and done when

Save/publication failures retain the existing live version and draft. Stop stale asynchronous data on owner/capability changes. Reverse only task-owned edits using the saved baseline if needed; never restore whole files from HEAD over existing edits. Done when all requested choices have working parameters, saved dimensions and real renderer output, focused checks pass and documentation describes the final behavior.
