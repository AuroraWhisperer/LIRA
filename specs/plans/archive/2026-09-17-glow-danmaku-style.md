# Glow random danmaku implementation plan

**Status:** Complete, 2026-09-17. Implemented and verified locally; not deployed.

**Goal:** Add `glow` / 流光气泡 as a third random style: centered sender above a translucent rounded message frame, soft identity-colored glow, and text or emotes inside. Reuse the classic identity palette, including the streamer override.

**Architecture:** Extend the existing style enum and selectors in Live and lira-server. Reuse each shipped feed, message renderer, identity fields, random placement and expiry. Extract only the classic palette into a CSS owner shared by ranked and glow; no new runtime dependency, setting key or data migration.

**Tech stack:** Existing Electron/Node, browser ES modules, CSS, node:test and Playwright.

## Scope and ownership

- Live `public/css/overlays/danmaku/` and Server `public/overlay/styles/` own presentation; their entry CSS imports the shared palette and new style.
- Live `danmaku.js`, local preview HTML, Admin settings and Electron license IPC consume the added style. Server overlay app, Streamer editor and `src/modules/streamer/overlay-settings.js` own its live selection and persistence.
- Server REQ-BILI-006 / AC-BILI-005 and Device, management and public-overlay OpenAPI own the additive enum contract. No accepted architecture changes or new ADR are needed.
- Preserve unrelated Live license/usage-guide edits and Server `.impeccable/` content. Do not commit or deploy.

## Current behavior and compatibility

Eight styles exist, with outline and cream using timed random placement. Desktop previews are static and local; the server provides OBS through the existing authenticated configuration and public SSE. Classic already projects viewer/fan cyan, captain blue, admiral purple, governor red and streamer green from message identity.

Keep all prior styles, the signal default, 2–30 second duration, explicit apply, old stored values, identity precedence, safe emote rendering, tenant scope, IPC origin checks and credentials handling. The existing gift renderer remains supported with a compact distinct gift card. Do not change message lifecycle or placement algorithms.

## Milestones

- [x] Add palette reuse, glow CSS and style selectors in both repositories. Use the existing safe renderer without avatars or badges. Add real rendered thumbnails to the existing pickers.
- [x] Extend IPC/service enums and protocol docs. Update existing parameterized tests for save/read, preview, selection and offline lifecycle.
- [x] Add focused browser coverage using synthetic messages: nickname above frame, text/emotes inside, classic color equality for every identity including streamer override, bounded random placement, expiry and style switching. Inspect the resulting screenshot.
- [x] Run focused tests, one design detector pass, then final diff/status review in both repositories.

## Verification commands

Live:

```text
node --experimental-vm-modules --test test/server-danmaku-settings.test.js test/danmaku-overlay-ipc.test.js test/frontend-admin-danmaku.test.js test/danmaku-local-preview.test.js test/danmaku-style-ownership.test.js test/danmaku-overlay.test.js test/danmaku-overlay-fullscreen.test.js test/danmaku-overlay-renderer.test.js
```

Server:

```text
node --experimental-vm-modules --test test/overlay-settings-service.test.js test/overlay-settings-routes.test.js test/overlay-static.test.js test/overlay-preview.test.js test/overlay-protocol-contract.test.js test/streamer-overlay-edit-state.test.js test/streamer-manage-surface.test.js test/device-protocol-contract.test.js
npx playwright test e2e/overlay-glow.spec.js
```

Use isolated test storage and synthetic network interception. Check modified JavaScript syntax and `git diff --check` in both repositories. Expand testing only for an observed failure or concrete affected contract.

## Rollback and completion

If blocked, inspect and reverse only task-owned hunks/new files. Never reset either working tree. Done when the third random option previews, saves and renders correctly with shared identity colors, focused checks pass, relevant contracts agree, and both diffs contain only intended source, documentation, tests and picker assets.

## Results

- Live focused suite: 33 passed. The final draft-test formatting change was rechecked: 9 passed.
- Server focused suite: 54 passed. Final preview, protocol and documentation governance checks: 29 passed.
- Browser: `LIRA_GAMES_BROWSER_PORT=3239 npx playwright test e2e/overlay-glow.spec.js` — 2 passed, using synthetic events and intercepted local assets. Confirms classic color equality for all identities, streamer precedence, frame/name geometry, emote containment, bounded/stable random placement, expiry and switching back to outline.
- Local preview inspected with all six samples, real bundled emotes and the new thumbnail. A scoped 16px side inset prevents clipped glow; final screenshot confirmed the inset and six visible samples. Thumbnails are rendered from shipped CSS in both repositories.
- Modified JavaScript syntax checks passed. Both final `git diff --check` runs passed; source/test/contract diffs and working-tree status reviewed. Existing license/usage-guide changes and concurrent PK changes, including PK hunks in shared requirement documents, are preserved.
- Design detector: Live returned no findings. Server new CSS returned no findings; the existing management page has a dynamic image with no initial src, and its aliased linked stylesheets cannot be resolved by the standalone detector. Browser rendering provided the visual evidence.
- No live settings writes, production data access, commits, branches or deployment. OBS requires the corresponding server update before selecting the new style in production.
