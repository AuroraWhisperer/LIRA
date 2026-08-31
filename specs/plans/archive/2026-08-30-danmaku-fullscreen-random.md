# 全屏随机弹幕 Implementation Plan

**Goal:** 在保留现有固定区域弹幕样式的前提下，增加一种由客户端配置停留时间、在整个浏览器源内随机出现并自动消失的弹幕模式。

**Architecture:** 继续使用现有 `/danmaku` 页面、设置快照和共享弹幕 DOM 渲染器。新增一个持久化秒数设置，由 Admin 通过既有 `/api/settings` 白名单保存；overlay 只在新模式下启用绝对定位、随机位置和生命周期计时，固定模式的顺序渲染保持不变。身份数据仍可随消息传输，但全屏模式的展示层不使用身份徽章或身份颜色。

**Tech Stack:** Electron/OBS browser-source overlay, Node.js 24 CommonJS server, Vanilla JavaScript ES modules, native CSS, existing node:test and Playwright-compatible local preview.

## Global Constraints

- 保持 `signal` 默认值和既有四种固定区域样式的行为、URL、WebSocket 消息形状与安全边界。
- 新设置必须进入默认设置集合并由服务端验证；客户端校验不能替代服务端校验。
- 不新增进程、框架、运行时依赖、数据库表或公开端点。
- 不信任消息中的 HTML；继续通过现有 DOM node/textContent 路径渲染。
- 不提交、回滚或覆盖工作区中与本任务无关的已有修改。

## Current Behavior

- `/danmaku` 由 `public/js/overlays/danmaku.js` 接收 snapshot/incremental WebSocket 事件，并调用 `createDanmakuFeed`。
- `public/js/overlays/danmaku-feed.js` 为固定区域与游戏画廊生成顺序 DOM，消息保留在 feed 中，现有样式使用 `data-style` 切换。
- Admin 在 `public/pages/admin/toolbox/danmaku.html` 选择四种固定区域样式；`public/js/admin/danmaku-tool.js` 通过 `/api/settings` 保存 `danmakuOverlayStyle`。
- 先前增加的 `outline` 当前仍是固定区域描边样式；本次按用户澄清保留该持久 key，但把它改为独立的全屏随机行为。

## Ownership and Contracts

- Settings owner: `src/storage/settings-defaults.js`, `src/server/routes/settings-routes.js`, `src/storage/settings-store.js`。
- Overlay owner: `public/pages/overlays/danmaku.html`, `public/js/overlays/danmaku.js`, `public/js/overlays/danmaku-feed.js`, `public/css/overlays/danmaku.css`。
- Admin owner: `public/pages/admin/toolbox/danmaku.html`, `public/js/admin/danmaku-tool.js`, `public/css/admin/other-features/danmaku-tool.css`。
- Consumers: OBS/browser-source `/danmaku`, Admin preview iframe, existing game overlay feed importer。
- Proposed persisted key: `danmakuFullscreenDurationSeconds`, string value, default `6`, inclusive server range `2..30`.
- Existing style key: `outline`, UI label changed to `全屏随机`; keeping the key preserves already-saved selections while the user-approved behavior changes.

## Non-goals

- 不改变 Bilibili ingress、消息广播、身份判定、历史 feed buffer 或游戏弹幕画廊。
- 不让全屏随机模式修改或删除服务端缓存中的消息；只控制 overlay 展示节点。
- 不新增按用户、等级、房间或消息内容的权限/过滤规则。
- 不把全屏随机模式改成按顺序的队列，也不保证消息之间绝对不重叠。

## Proposed Changes

1. Keep `outline` in client/server style allowlists and add the duration default/normalizer.
2. Split Admin style choices visually into fixed-area and full-screen groups; expose a number input only for full-screen mode, save on change, and keep accessible status/error text.
3. Extend the shared feed with an opt-in full-screen layout mode (or equivalent overlay-owned lifecycle) that assigns bounded random CSS positions, renders only sender name and message, and removes each node after the configured duration. Clear timers on snapshot replacement, style switch, reload, and destroy.
4. Add full-screen CSS with transparent page background, absolute inset feed, translucent pill/card message treatment, no avatar/identity badges, and neutral content color independent of guard level.
5. Add focused tests for setting normalization, Admin grouping/control visibility wiring, random position bounds, timer removal/cleanup, identity suppression, and preservation of fixed modes.

## Milestones and Verification

1. **Contract tests first:** add failing tests for the new style key, duration range/default, and Admin control markup. Run the focused tests and confirm the expected failures.
2. **Settings/Admin implementation:** make the tests pass; verify invalid duration values return 400 without writes and valid values broadcast through the existing settings path.
3. **Overlay lifecycle:** implement opt-in random placement and expiration; test with fake timers/DOM or exported pure helpers so tests stay deterministic and do not use external services.
4. **Visual pass:** open `/danmaku?preview=1&style=outline` at a representative 16:9 viewport and a narrow viewport; confirm items remain inside the viewport, identity badges are absent, and fixed styles are unchanged.
5. **Final gates:** run the directly affected tests, `npm run check` if syntax coverage is needed, `git diff --check`, inspect the scoped diff, and inspect `git status --short` for accidental generated/runtime files.

## Rollback or Failure Handling

Stop at the first unresolved contract or lifecycle ambiguity. Inspect only the task-owned diff and remove/revert those hunks with `apply_patch`; never use destructive reset/blanket checkout. If visual verification exposes overflow or timer leaks, fix the owner layer and repeat the focused test rather than changing the server contract.

## Done When

- Admin can select `全屏随机`, configure a validated 2–30 second duration, and see the saved state reflected in an open overlay snapshot.
- Full-screen messages appear at bounded random positions, show only sender and content regardless of identity, and disappear after the configured duration; fixed modes remain sequential and unchanged.
- Focused tests, syntax/static checks as applicable, diff check, and scoped diff review pass with no task-owned generated or sensitive files.

## Verification Result (2026-08-30)

- Focused overlay/Admin tests: 43/43 passed.
- `npm run check`: passed (543 JavaScript files).
- `git diff --check`: passed.
- Local preview checked at 1280×720 and 390×844; items stayed within the viewport, identity badges were hidden, and the four fixed-area styles remained separate from the fullscreen option.
