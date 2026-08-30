# 弹幕姬版块重排与画猜弹幕样式复用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重排百宝箱弹幕姬，让连接状态、弹幕气泡样式、点歌回复、AI 回复和固定回复各自成组，并让管理页预览与“你画我猜”共用同一个弹幕渲染接口。

**Architecture:** 保留现有 `public/js/overlays/danmaku-feed.js` 作为无状态弹幕 DOM 组件；管理页通过同一 ESM 接口渲染静态预览，小游戏继续把会话 `danmaku` 数据交给该组件。只调整 Admin fragment 的结构和 CSS，不新增设置键、HTTP 端点或运行时依赖。

**Tech Stack:** Electron desktop renderer, Vanilla JavaScript ES modules, native CSS, `node:test` static frontend checks.

## Global Constraints

- 保持 Node.js 24+、CommonJS 后端、Vanilla JavaScript ES modules、原生 CSS 和无构建前端。
- 以 Electron 桌面端布局为准，保留页面 URL、现有设置键和 `/games` WebSocket/HTTP 合同。
- 所有用户可见文本通过现有 DOM API/`textContent` 路径渲染；不把不可信弹幕内容插入 HTML。
- 保留工作区中与本任务无关的并行修改，不创建提交。

---

### Task 1: 重排弹幕姬 Admin fragment

**Files:**

- Modify: `public/pages/admin/toolbox/danmaku.html`
- Test: `test/frontend-admin-ai.test.js`

**Interfaces:**

- Consumes: existing `danmaku-tool.js` element IDs and AI/library editor IDs.
- Produces: connection section with `danmakuRefreshBtn`, a `danmakuStyleFeed` preview root, a single random-song reply group, an AI group, and a fixed-reply group containing check-in/fortune/DIY controls and editors.

- [x] **Step 1: Write the failing static assertions**

Assert the old heading is absent, refresh is inside the connection heading, the new preview root exists, and the group order is style → song reply → AI → fixed reply after connection.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/frontend-admin-ai.test.js`

Expected: FAIL because the current fragment still has the hero heading, refresh button outside connection, and the four switches/three editor panels are not grouped as requested.

- [x] **Step 3: Implement the smallest fragment change**

Remove the standalone hero heading, move its refresh button into the connection heading, add the shared-style preview section and manual sender to the first “弹幕姬” group, keep only random song reply in the second group, move AI into the third group, and wrap check-in/fortune/DIY toggles plus their existing details editors in the fourth “固定回复” group.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `node --test test/frontend-admin-ai.test.js`

Expected: PASS for the updated order and required IDs/text.

### Task 2: Render the shared bubble style in the Admin preview

**Files:**

- Modify: `public/js/admin/danmaku-tool.js`
- Modify: `public/css/admin/other-features/danmaku-tool.css`
- Modify: `public/css/admin/other-features.css` only if a shared stylesheet import is required
- Test: `test/frontend-admin-ai.test.js`

**Interfaces:**

- Consumes: `createDanmakuFeed(root, options)` from `public/js/overlays/danmaku-feed.js`.
- Produces: a preview populated with safe sample `{ name, message, guardLevel, medalName, medalLevel }` data; no persisted setting.

- [x] **Step 1: Write the failing static assertion**

Require the Admin module to import `createDanmakuFeed`, find `danmakuStyleFeed`, render sample data, and include the preview-specific layout class in the stylesheet.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/frontend-admin-ai.test.js`

Expected: FAIL because the module has no preview import/render and no preview styling.

- [x] **Step 3: Implement preview initialization and styles**

Initialize the component once during `init()`, inject a bounded sample list, reuse the existing class names/identity badge mapping, and add a compact desktop-first preview style with a mobile fallback and reduced-motion rule.

- [x] **Step 4: Run focused frontend checks**

Run: `node --test test/frontend-admin-ai.test.js test/games-overlay.test.js`

Expected: PASS; the existing games overlay still imports and consumes the same component.

### Task 3: Verify contracts and UI regression gates

**Files:**

- Modify: `public/pages/admin/toolbox/usage-guide.html` if its section description/order is stale
- Test: `test/frontend-admin-ai.test.js`, `test/games-overlay.test.js`

- [x] **Step 1: Update the user guide copy**

Describe the new five-area flow (connection status, 弹幕姬 style/send, 点歌回复, AI 回复, 固定回复) without changing unrelated guide content.

- [x] **Step 2: Run focused and repository checks**

Run: `node --test test/frontend-admin-ai.test.js test/games-overlay.test.js`, then `npm run check`, then `npm run verify:quick`.

Expected: all commands pass with no changed files outside the requested Admin/UI/docs/test scope and no diff-check whitespace errors.
