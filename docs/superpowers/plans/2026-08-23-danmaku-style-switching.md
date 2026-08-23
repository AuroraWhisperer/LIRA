# 弹幕姬多样式切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保持唯一固定 `/danmaku` 地址，在 Admin 中让用户自由切换“聊天气泡”“直播信号带”“极简字幕”三套弹幕姬样式，并让已打开的直播页面实时同步选择。

**Architecture:** 新增白名单设置 `danmakuOverlayStyle`，通过现有 `/api/settings` 持久化并借助全量 WebSocket snapshot 广播。弹幕姬控制器只切换 `body.dataset.style`，三套视觉共用同一安全消息 DOM；Admin 的样式选择器保存设置并用查询参数刷新确定性预览。

**Tech Stack:** Node.js 24+, CommonJS backend, Vanilla JavaScript ES modules, native CSS, Electron 43, `node:test`.

## Global Constraints

- 固定页面仍只有 `/danmaku`，发送弹幕仍只在 Admin 中操作。
- 提供三套布局主题：`bubble`（聊天气泡）、`signal`（直播信号带）、`minimal`（极简字幕）。
- 选择持久化，启动默认保留当前 `signal` 行为；无效值由服务端拒绝。
- 三套样式共用现有弹幕流、Bilibili 表情安全渲染和图片代理，不复制消息业务逻辑。
- 不新增依赖、页面地址、进程、端口或数据库 schema；不覆盖并行用户改动；不创建提交。

---

### Task 1: 持久化样式契约

**Files:**
- Modify: `src/storage/settings-store.js`
- Modify: `src/server/routes/settings-routes.js`
- Test: `test/danmaku-overlay-settings.test.js`

**Interfaces:**
- Consumes: `POST /api/settings {danmakuOverlayStyle}`.
- Produces: snapshot `state.settings.danmakuOverlayStyle`，值只能是 `'bubble'|'signal'|'minimal'`。

- [x] **Step 1: 写默认值、合法值和非法值回归测试**
- [x] **Step 2: 运行测试并确认缺少默认设置与枚举校验**
- [x] **Step 3: 添加默认 `signal` 和服务端枚举规范化**
- [x] **Step 4: 运行设置测试确认通过**

### Task 2: 固定页面运行时切换三套视觉

**Files:**
- Modify: `public/js/overlays/danmaku.js`
- Modify: `public/css/overlays/danmaku.css`
- Test: `test/danmaku-overlay.test.js`

**Interfaces:**
- Consumes: snapshot `settings.danmakuOverlayStyle`；预览参数 `?preview=1&style=bubble|signal|minimal`。
- Produces: `body[data-style='bubble'|'signal'|'minimal']`，固定地址不变。

- [x] **Step 1: 补充 snapshot、预览参数和三套 CSS 的失败断言**
- [x] **Step 2: 实现 `normalizeStyle/applyStyle` 并在每次 snapshot 同步**
- [x] **Step 3: 将现有信号带规则限定到 signal，重建独立气泡与极简字幕视觉**
- [x] **Step 4: 运行 Overlay 回归测试**

### Task 3: Admin 自由切换与预览

**Files:**
- Modify: `public/pages/admin/toolbox/danmaku.html`
- Modify: `public/js/admin/danmaku-tool.js`
- Modify: `public/css/admin/other-features/danmaku-tool.css`
- Modify: `public/pages/admin/toolbox/usage-guide.html`
- Test: `test/frontend-admin-ai.test.js`

**Interfaces:**
- Consumes: `app:settings-state` 与现有 `saveSetting(key,value)`。
- Produces: `[data-danmaku-style]` 可视化主题卡；选择后保存并刷新 `/danmaku?preview=1&style=...` iframe。

- [x] **Step 1: 补充三个主题卡、保存和预览 URL 断言**
- [x] **Step 2: 实现状态回填、change 保存、失败回滚与预览刷新**
- [x] **Step 3: 为选择器和当前样式说明补充桌面布局**
- [x] **Step 4: 运行 Admin 回归测试**

### Task 4: 事实源与验收

**Files:**
- Modify: `docs/architecture/backend/storage.md`
- Modify: `docs/architecture/backend/api.md`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/frontend/overlays.md`

**Interfaces:**
- Consumes: 已实现的设置与页面行为。
- Produces: 与运行时一致的持久化、Admin 和 Overlay 契约说明。

- [x] **Step 1: 更新设置白名单、Admin 责任和 Overlay 样式契约**
- [x] **Step 2: 运行聚焦测试、`npm run check`、文档与架构门禁**
- [x] **Step 3: 用桌面浏览器检查三种样式切换、固定地址和控制台**
- [x] **Step 4: 审阅任务差异与并行用户改动，完成计划勾选**
