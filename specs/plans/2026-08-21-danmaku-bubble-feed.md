# 你画我猜弹幕气泡组件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将“你画我猜”右侧固定列表改成可独立复用的弹幕气泡组件，让每条弹幕依据文本长度自动调整宽度与高度，同时保持现有会话、WebSocket 和头像代理契约不变。

**Architecture:** 新建 `public/js/overlays/danmaku-feed.js` 作为无状态 DOM 组件，暴露 `createDanmakuFeed(root, options)` 和纯文本尺寸计算函数。`games.js` 只负责创建组件、提供头像解析器/身份徽标策略并传入 `session.danmaku`；画布、计时、积分和网络逻辑保持在原入口。视觉样式继续由 `public/css/overlays/games.css` 管理，HTML 只增加弹幕区的标题壳。

**Tech Stack:** Vanilla JavaScript ES modules, DOM APIs, native CSS custom properties, `node:test` 静态回归检查。

## Global Constraints

- 保持 `/api/games/session`、`game:update`、`game:draw`、弹幕字段和头像代理行为不变。
- LIRA 主要目标是 Electron 桌面端；浏览器兼容只作为辅助检查。
- 不增加运行时依赖、构建步骤、进程或服务。
- 新前端模块使用显式 ESM import/export；DOM 文本一律使用 `textContent`，不引入 `innerHTML`。
- 只修改本任务涉及的 overlay HTML、CSS、JS 和聚焦测试/计划文件。

---

### Task 1: 建立可复用弹幕气泡模块

**Files:**
- Create: `public/js/overlays/danmaku-feed.js`
- Test: `test/games-overlay.test.js`

**Interfaces:**
- Consumes: `{ uid, name, message, avatarUrl, guardLevel, medalName, medalLevel }` 弹幕对象，以及 `resolveAvatarUrl`、`getGuardLabel` 两个注入回调。
- Produces: `createDanmakuFeed(root, options).render(items)`、`.destroy()` 和 `measureDanmakuText(message)`；渲染出的每条消息带 `--danmaku-width`、`--danmaku-height`、`--danmaku-lines` CSS 变量。

- [x] **Step 1: 写结构回归**

  在 `games-overlay.test.js` 增加对模块导出、长度测量变量、DOM 安全渲染和气泡 class 的静态断言，确保组件边界不会被重新内联到游戏入口。

- [x] **Step 2: 运行聚焦测试确认回归先失败**

  Run: `node --test test/games-overlay.test.js`

  Expected: FAIL，因为 `danmaku-feed.js` 尚不存在。

- [x] **Step 3: 实现模块**

  `measureDanmakuText` 按 Unicode 字符计算中英文混合文本的视觉长度和行数；`createDanmakuFeed` 使用 `DocumentFragment`、`textContent` 和注入回调创建头像、昵称、舰长徽标、灯牌徽标及消息正文。宽度从短气泡的 52% 逐步增长到 100%，高度按行数设置最小值，最多保留最近 120 条。

- [x] **Step 4: 运行聚焦测试确认通过**

  Run: `node --test test/games-overlay.test.js`

  Expected: PASS。

### Task 2: 将你画我猜接入组件并完成视觉容器

**Files:**
- Modify: `public/js/overlays/games.js`
- Modify: `public/pages/overlays/games.html`
- Modify: `public/css/overlays/games.css`
- Test: `test/games-overlay.test.js`

**Interfaces:**
- Consumes: Task 1 的 `createDanmakuFeed`；游戏入口继续调用 `renderDrawDanmaku(items)`，不改变会话状态结构。
- Produces: “弹幕画廊”标题、实时状态点、左右错落的气泡布局，以及在窄桌面/移动宽度下不溢出的降级布局。

- [x] **Step 1: 在游戏入口接线**

  将 `games.js` 改为模块脚本，导入组件；DOMContentLoaded 时创建一次 feed 实例，传入现有 `avatarSource` 和 `guardLabel`；保留 `renderDrawDanmaku` 作为游戏到组件的窄适配器，调度器和其余游戏渲染不变。

- [x] **Step 2: 更新弹幕区 HTML**

  在 `draw-danmaku-panel` 内增加标题栏和直播状态标记，保留 `drawDanmakuFeed` id 及空态文本，确保 OBS 浏览器源仍可直接加载。

- [x] **Step 3: 更新样式**

  将面板改为“弹幕画廊”视觉：深靛底、暖黄实时点、气泡圆角尾部和轻微交错对齐；使用组件写入的 CSS 变量控制宽高，长文本自然换行增高，短文本保持紧凑；加入 `prefers-reduced-motion` 和窄屏规则。

- [x] **Step 4: 运行聚焦测试与语法检查**

  Run: `node --test test/games-overlay.test.js test/esm-module-boundaries.test.js`

  Expected: PASS。

  Run: `npm run check`

  Expected: PASS。

### Task 3: 完成快速门禁与差异审查

**Files:**
- Inspect only: `git diff`, `git diff --check`, `git status --short`

- [x] **Step 1: 运行快速验证**

  Run: `npm run verify:quick`

  Expected: PASS。

- [x] **Step 2: 审查范围**

  确认没有修改后端协议、没有加入依赖、没有生成 `data/`、`logs/`、`tmp/` 或 `release/` 文件，且每一处改动都能对应本需求。

**Verification:** `node --test test/games-overlay.test.js`、`node --test test/esm-module-boundaries.test.js`、`npm run verify:docs`、`npm run verify:quick`、`npm test` 均通过；完整套件为 784 通过、1 跳过、0 失败。

**Done When:** `draw-danmaku-feed.js` 可被其他 overlay 以同一接口复用；你画我猜弹幕按文本长度呈现不同宽度/高度并保持身份信息与头像；聚焦测试、ESM 边界、语法检查和 `verify:quick` 全部通过。
