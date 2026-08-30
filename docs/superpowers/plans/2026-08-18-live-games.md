# 直播小游戏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在百宝箱新增“小游戏”标签，提供数字炸弹与五子棋的主播/观众交互、弹幕捕捉和 OBS 浏览器源链接。

**Architecture:** 新增 `src/games/` 领域模块封装数字炸弹、五子棋规则和会话状态；Bilibili 消息入口仅调用会话服务并由 WebSocket 广播 `game:update`。Admin 面板通过 `/api/games/*` 管理会话和观众列表，OBS `/games` 页面只渲染服务端会话状态并提交主播落子。

**Tech Stack:** Node.js CommonJS domain modules, Vanilla JS ES modules, static HTML/CSS, existing HTTP/WebSocket transport.

## Global Constraints

- 保持 Node.js 24+、CommonJS backend、Vanilla JS ES modules、无构建步骤。
- 维护现有 HTTP/WS 鉴权、上下文隔离、页面组合顺序和 OBS 可嵌入行为。
- 游戏规则由 `src/games/` 持有，UI 不复制服务端判定。
- 不新增运行时依赖；所有不可信文本使用 DOM `textContent`。

---

### Task 1: 游戏规则与会话领域

**Files:**

- Create: `src/games/number-bomb.js`
- Create: `src/games/gomoku.js`
- Create: `src/games/game-session-service.js`
- Test: `test/games.test.js`

- [ ] 编写数字炸弹 1–100 区间收窄、轮流、踩中炸弹结束的测试。
- [ ] 编写五子棋 15×15 棋盘、坐标解析、轮流和五连判定测试。
- [ ] 实现纯规则函数及会话服务（开始、主播落子、弹幕落子、观众列表、重置）。
- [ ] 运行 `node --test test/games.test.js`。

### Task 2: 服务端 API、弹幕和 WS 接线

**Files:**

- Create: `src/server/routes/game-routes.js`
- Modify: `src/server/api-routes.js`
- Modify: `src/server/api-context.js`
- Modify: `src/server.js`
- Modify: `src/server/bilibili-client.js`
- Modify: `src/server/ws.js` only if helper exposure is needed
- Test: `test/game-routes.test.js`

- [ ] 为 `/api/games/viewers`、`/api/games/session`、`/api/games/session/move` 提供鉴权路由。
- [ ] 在 Bilibili 弹幕入口登记观众并交给会话服务，广播 `game:update`。
- [ ] 将游戏服务注入 API context，保持路由无状态。
- [ ] 运行 `node --test test/game-routes.test.js` 及相关 Bilibili/WS 测试。

### Task 3: Admin 百宝箱小游戏面板

**Files:**

- Create: `public/pages/admin/toolbox/games.html`
- Create: `public/js/admin/games.js`
- Create: `public/css/admin/other-features/games.css`
- Modify: `public/pages/admin/toolbox/shell-start.html`
- Modify: `src/server/admin-page.js`
- Modify: `public/js/admin/index.js`
- Modify: `public/css/admin/other-features.css`
- Test: `test/toolbox-sidebar.test.js`

- [ ] 在左侧增加“小游戏” tab 和面板映射。
- [ ] 右侧展示数字炸弹/五子棋卡片、OBS 链接、观众选择、开始/结束/复制地址操作。
- [ ] 使用现有 `api`, `copyText`, `localOverlayOrigin`, `eventBus` 工具，不引入全局业务依赖。
- [ ] 运行 Admin 组合和 Toolbox 测试。

### Task 4: OBS 游戏浏览器源

**Files:**

- Create: `public/pages/overlays/games.html`
- Create: `public/js/overlays/games.js`
- Create: `public/css/overlays/games.css`
- Modify: `src/server/http-utils.js`
- Test: `test/games-overlay.test.js`

- [ ] 根据 `?game=number-bomb|gomoku` 渲染精美且可键盘操作的直播页面。
- [ ] 主播点击数字/棋盘提交落子；观众弹幕通过 `game:update` 同步。
- [ ] 增加响应式布局、焦点样式和 reduced-motion 处理。
- [ ] 运行叠加层测试、`npm run check` 和 `npm run verify:quick`。

### Task 5: 架构文档与完整验证

**Files:**

- Modify: `docs/architecture/frontend/pages.md`
- Modify: `docs/architecture/backend/api.md`
- Modify: `docs/architecture/backend/ws.md`
- Modify: `docs/architecture/engineering/ai-workflow.md`

- [ ] 登记 `/games` 页面、游戏 API、`game:update` 消息和 ROUTE-GAMES owner。
- [ ] 运行 `git diff --check`、`npm run verify:docs`、`npm test`。
