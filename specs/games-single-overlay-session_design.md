# Feature: 固定游戏 Overlay 链接与单会话互斥

## Goal

直播姬/OBS 只需保存一个 `/games` 地址。当前活动游戏由服务端会话决定并在同一页面自动切换；已有游戏未结束时，任何新的开始请求都被拒绝。

## Context

管理页当前为每款游戏显示专属 `?game=` 链接，并在开始游戏后自动打开该链接。Overlay 首次加载时读取查询参数并固定显示某款游戏；服务端 `start()` 会直接覆盖已有会话。多个窗口因此可能同时显示不同游戏，且切换游戏需要替换直播姬网址。

## Constraints

- 保持 Node.js 24+、CommonJS 后端、Vanilla JavaScript ES modules 和无构建前端。
- 保持现有 `/api/games/session`、`/api/games/session/move`、WebSocket `game:update` 和 session token 认证边界。
- 旧的 `/games?game=number-bomb|gomoku` 地址仍可访问，但不再决定显示哪款游戏。
- 不新增数据库、设置键、进程、依赖或第二个 Overlay 页面。

## Non-goals

- 不实现多个并行游戏会话。
- 不自动结束旧游戏，也不让前端绕过服务端冲突检查。
- 不改变数字炸弹、五子棋规则或观众权限判定。

## Architecture

- Frontend owner: `public/js/admin/games.js`、`public/pages/admin/toolbox/games.html`、`public/js/overlays/games.js`。
- Backend owner: `src/games/game-session-service.js`；路由 `src/server/routes/game-routes.js` 负责将会话冲突映射为 HTTP 409。
- Contract owners: `docs/architecture/backend/api.md`、`docs/architecture/backend/ws.md`、`docs/architecture/frontend/pages.md`。
- The service owns the invariant. The Admin disables start controls for immediate feedback, but a second Admin tab is still rejected by the service.

## Security

- All existing game endpoints remain behind the current session-token request pipeline.
- Server-side game and viewer validation remains unchanged; no client-provided URL or game label is trusted for authorization.
- Status and error text use existing JSON envelopes and DOM `textContent`/fixed copy; no untrusted HTML is introduced.

## Acceptance Criteria

1. The Admin exposes one copyable/openable `/games` address and no per-game copy buttons.
2. Starting a game does not open a new game-specific window.
3. A `/games` page renders the active session's game and switches when `game:update` changes it.
4. While a session exists, starting either game returns HTTP 409 and leaves the original session unchanged.
5. The Admin disables both start controls while a session exists and re-enables them after the explicit end action succeeds.
6. Existing query-string Overlay URLs remain reachable and follow the same current-session behavior.
7. The Admin presents opening the fixed `/games` page as step one and starting a game as step two.
8. The Overlay resolves its initial session snapshot before showing the empty state and retries transient empty/error responses briefly.

## Done When

Focused game tests, `npm run check`, `npm run verify:quick`, and the full `npm test` suite pass; API/page owner docs describe the fixed link and 409 conflict; final diff contains only task-owned changes plus preserved concurrent work.
