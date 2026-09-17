# Local danmaku preview and browser-source asset caching

## Goal

Make eight danmaku styles recognizable through real thumbnails and descriptive labels. Preview locally at one stable URL, render samples once, and cache server overlay assets in browser sources. The user's correction explicitly places desktop preview on the local machine; only copied/opened live overlay links point to the server.

## Current behavior and ownership

- Client owner: `public/js/admin/danmaku-overlay-settings.js`, toolbox fragment and CSS. The current preview action opens the remote overlay with draft query parameters.
- Local renderer: `public/js/overlays/danmaku.js`, feed/message renderer and `public/css/overlays/danmaku/`. Seven styles, static preview, no style selector; cream is currently server-only.
- Server owner: `D:/Work/lira-server/src/app.js` and `public/overlay/`. Entry HTML and CSS/JS revalidate on each load; production images cache for one hour. SSE is already `no-store`.
- Contracts: client frontend app/overlays documents; server REQ-BILI-006, related acceptance criteria and `docs/protocol/public-overlay-api.md`.

## Compatibility and non-goals

Preserve style IDs, draft/apply flow, server-owned settings, tenant/auth boundaries, SSE and fixed live `/overlay` URL. Keep legacy preview query entries working. No Electron main/preload changes, database changes, service worker, deployment or commits. Preserve all pre-existing changes in both repositories.

## Changes and verification

1. [x] Client picker: real sample images, clearer names and descriptions; local preview action remains available without a server connection. Test local preview versus remote copy/open/apply routing.
2. [x] Local preview: all eight styles in one page, normalize address to `/danmaku?preview=1`, switching and reload use in-page history state; sample feed has no repeat timer or live subscription. Render cream using the established server CSS and existing local feed, preserving defaults for other consumers. Test style switching, no timers/connections and preview-only behavior.
3. [x] Server browser cache: content-versioned static asset URLs with long-lived cache headers; entry and legacy URLs revalidate, SSE remains uncached. Validate the revision before serving immutable files. Test unchanged/changed versions, nested dependencies, stale-version rejection and cache headers.
4. [x] Update owning documentation, inspect the UI in the browser renderer and run directly affected tests plus `git diff --check` in both repositories.

## Failure handling

If a check fails, fix the owning change. Undo only task-owned hunks/assets if needed; never reset unrelated working changes. Preview remains read-only; cached static assets never include account settings or messages.

## Done when

The local preview switches all styles without changing its displayed URL, automatically appending messages, or connecting to a server. Client copy/open still use the authorized server URL. Thumbnails match actual styles. Versioned server assets reuse the browser cache and invalidate on content change. Focused tests and final scoped diff review pass, with live-app limitations reported.

## Results

- Later user clarification requires complete examples in every style: four identity tiers with text/emotes, emote-only, gift notification and thanks reply. Seven examples remain available in each style; random examples also survive a narrower desktop viewport.
- Client: 43 focused tests passed across local preview, draft/apply, overlay renderer/fullscreen, style ownership, admin composition and usage guide.
- Server: asset-cache, static overlay, SSE and focused production entry/dependency tests passed. Protocol, documentation and architecture checks passed. Broader production asset enumeration encounters the pre-existing untracked `public/shared/console-theme.css` without a published route (404); this unrelated work was preserved.
- Chromium runtime: all eight styles share one displayed URL and retain seven examples/five emotes, with no broken images or API requests. After 30 simulated seconds the same seven nodes/messages remain. Reload retains the style. Only the local origin is requested.
- Cache runtime: initial page requested 18 overlay assets; a repeated visit requested none of them and all 18 reported zero transferred bytes from browser cache.
- Local review URL: `http://127.0.0.1:3219/danmaku?preview=1`, served from the workspace by an ignored helper under `output/danmaku-preview/`. Existing installed app on port 3000 was not restarted. Live Companion/OBS disk-cache retention was not tested; server changes are not deployed.
- Both scoped diffs and whitespace checks reviewed. No commits, packaging or deployment performed; no live account data used.
