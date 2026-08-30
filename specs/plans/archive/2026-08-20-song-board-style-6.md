# 点歌板风格 6 Implementation Plan

> **For agentic workers:** Execute this plan inline in the current task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits unless the user explicitly requests one.

**Goal:** 新增使用用户提供的奶油金唱片与铃兰素材的点歌板风格 6，并让每条词条左侧花形圆圈显示队列序号、右侧显示歌名、点歌人、大航海和灯牌等级。

**Architecture:** 保留现有 `/queue`、`overlayQueueStyle` 设置和插画点歌板渲染链路。新增一个命名样式、两张仓库内 PNG 与一个 CSS 模块；风格 6 复用既有转义、横向溢出滚动和纵向队列滚动，只在通用插画词条渲染器中提供可选序号节点。

**Tech Stack:** Electron 43 renderer、Vanilla JavaScript ES modules、原生 CSS、PNG、`node:test`。

## Global Constraints

- Electron 桌面客户端和 OBS `/queue` 浏览器源是用户可见目标。
- 不新增框架、打包器、依赖、进程、端口、设置键、数据库或公共 API。
- 保留风格 1–5、遗留 `festival` 归一化、队列顺序、HTTP/WS 契约和现有设置持久化格式。
- 队列来源的歌名、用户名和灯牌名继续经过既有 HTML 转义。
- 不覆盖或回退工作区中已有的风格 3–5 与其他用户改动，不自动提交。

---

## Goal

管理页可选择并保存“点歌板风格 6”。OBS 点歌队列使用奶油金唱片与铃兰框体；横向词条左侧花形圆圈承载从 1 开始的序号，右侧信息窗依次承载歌名、点歌人、大航海和灯牌等级，内容溢出时只在信息窗内往返滚动。

## Non-goals

- 不修改点歌、排序、身份计算、灯牌数据来源或后端持久化逻辑。
- 不给风格 6 增加独立的字体/滚动设置或可配置色板。
- 不重绘用户素材，不重新设计风格 1–5。

## Current Behavior

- `overlayQueueStyle` 已识别 `classic`、`identity`、`storybook`、`neon-vinyl` 与 `cherry-ribbon`。
- 风格 4/5 共用 `renderIllustratedAssetQueue()` / `renderIllustratedAssetRow()`，显式显示歌名、点歌人、大航海和灯牌等级，但隐藏队列序号。
- 用户提供的 `风格6-l.png` 为 1122×1402 ARGB 竖框，`风格6-s.png` 为 2172×724 ARGB 横向词条；两者均有透明外部区域且不包含需要执行的文字指令。

## Ownership

- Owner: `public/js/overlays/`、`public/css/overlays/`、`public/pages/overlays/queue.html`（`ROUTE-OVERLAYS`）。
- Admin consumer: `public/pages/admin/song/queue-theme.html` 与 `public/js/admin/theme.js`（`ROUTE-ADMIN`）。
- Persisted contract: `src/storage/theme-store.js` 继续存储同一个 `overlayQueueStyle` 字符串；接受值由 `docs/architecture/backend/storage.md` 记录。
- Tests: `test/frontend-queue.test.js` 与 `test/queue-overlay-esm.test.js`。

## Compatibility Constraints

- 风格 6 使用新值 `golden-lily`，未知值仍回退 `classic`。
- 继续复用 `identityQueueFontSize`、`identityQueueScrollSpeed` 和 `queueScrollMode`。
- `prefers-reduced-motion` 下停止横向与纵向动画。
- 框体外部保持透明；图片 URL 固定为仓库内 `/img/overlays/song-board-style-6/`。

## Design Plan

- Color: 唱片棕 `#6f4a24`、古金 `#b97916`、暖奶油 `#fff8df`、铃兰绿 `#65773b`、柔金阴影 `#d8aa55`。
- Type: 歌名与序号使用 `Microsoft YaHei` 粗体，字段标签使用更紧凑的 `Bahnschrift`/微软雅黑工具字体；不引入外部字体。
- Layout: 保持竖向 1122:1402 框体比例，内容区内按素材比例堆叠横条。

```text
┌──────── 奶油金唱片与铃兰框体 ────────┐
│   ( 1 )  歌名  点歌人  大航海  灯牌等级 │
│   ( 2 )  歌名  点歌人  大航海  灯牌等级 │
│   ( 3 )  歌名  点歌人  大航海  灯牌等级 │
└────────────────────────────────────┘
```

- Signature: 横条左端素材自带的花形唱片圆窗是唯一强调点，用深棕金序号形成清晰队列节奏；其余字段限制在右侧奶油信息窗内。
- Self-critique: 不额外叠加渐变、图标或动画装饰，避免与素材已有的唱片、音符、丝带和铃兰争抢注意力。

## Proposed Changes

- 新建 `public/img/overlays/song-board-style-6/frame.png` 与 `entry.png`，分别复制两张用户素材。
- 新建 `public/css/overlays/base/golden-lily.css` 并由 `public/css/overlays/base.css` 导入。
- 扩展插画样式集合、风格 6 renderer、可选序号 DOM 与 resize/滚动选择器。
- 在管理页加入第六个样式按钮，扩展共用设置说明和六列选择器。
- 扩展聚焦测试与架构契约文档中的风格枚举。

## Milestones

### Task 1: 建立失败回归覆盖

**Files:**

- Modify: `test/frontend-queue.test.js`
- Modify: `test/queue-overlay-esm.test.js`

**Interfaces:**

- Consumes: `normalizeQueueStyle(style)`、`renderGoldenLilyQueue()`、`renderGoldenLilyRow(item, index)`。
- Produces: 风格按钮、设置值、素材、DOM 字段与 ESM 链接的回归约束。

- [x] 增加断言：`golden-lily` 按钮与风格 6 文案存在，选择器为六列，归一化保留该值。
- [x] 增加断言：两张素材非空、CSS 被导入且引用正确 URL。
- [x] 增加断言：row 左侧输出从 1 开始的序号，右侧输出四个已转义字段。
- [x] 运行 `node --experimental-vm-modules --test test/frontend-queue.test.js test/queue-overlay-esm.test.js`，预期新断言在实现前失败。

### Task 2: 接入素材、管理选择和渲染

**Files:**

- Create: `public/img/overlays/song-board-style-6/frame.png`
- Create: `public/img/overlays/song-board-style-6/entry.png`
- Modify: `public/pages/admin/song/queue-theme.html`
- Modify: `public/css/admin/toasts/gifts.css`
- Modify: `public/js/admin/theme.js`
- Modify: `public/js/overlays/queue.js`
- Modify: `public/js/overlays/queue-render.js`
- Modify: `public/js/overlays/queue-scroll.js`

**Interfaces:**

- Consumes: 既有 `renderIllustratedAssetQueue()`、`renderIllustratedAssetRow()`、`escapeHtml()` 与身份格式函数。
- Produces: `renderGoldenLilyQueue(settings, current, waiting, content)` 和 `renderGoldenLilyRow(item, index)`。

- [x] 复制素材到固定目录，并验证尺寸分别为 1122×1402 与 2172×724。
- [x] 将 `golden-lily` 加入管理端与 overlay 端允许集合，保留所有回退规则。
- [x] 让插画 queue helper 把 `index` 传给 row renderer；仅风格 6 输出 `<span class="golden-lily-rank illustrated-rank">${index + 1}</span>`。
- [x] 将风格 6 接入 render、resize 与滚动选择器，使用既有内容转义和滚动调度。
- [x] 运行聚焦测试，预期全部通过。

### Task 3: 实现响应式素材布局

**Files:**

- Modify: `public/css/overlays/base.css`
- Modify: `public/css/overlays/base/illustrated.css`
- Create: `public/css/overlays/base/golden-lily.css`
- Modify: `public/pages/overlays/queue.html`

**Interfaces:**

- Consumes: `.illustrated-*` 公共布局类与 `--identity-queue-font-size`。
- Produces: `.queue-golden-lily` 框体、`.golden-lily-row` 词条、圆圈序号和右侧信息视口的响应式位置。

- [x] 将风格 6 纳入插画面板、隐藏标题、内容视口和 reduced-motion 规则。
- [x] 按 1122:1402 框体比例设置面板，按 2172:724 词条比例设置行高与背景。
- [x] 把序号定位在横条左侧花形圆圈中心，把信息视口限制在右侧长框内；校准字号与奶油金配色。
- [x] 更新静态资源查询版本，避免 Electron/OBS 继续使用旧 CSS/JS 缓存。

### Task 4: 更新契约并完成验证

**Files:**

- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/backend/storage.md`
- Modify: `specs/plans/2026-08-20-song-board-style-6.md`

**Interfaces:**

- Consumes: 已实现的 `golden-lily` 设置值与 DOM/CSS 行为。
- Produces: 与运行时一致的风格枚举和验证记录。

- [x] 将文档中的五种/风格 3–5 更新为六种/风格 3–6，并记录序号与四字段行为。
- [x] 运行聚焦测试、`npm run verify:docs`、`npm run check`、`npm run verify:quick`。
- [x] 在代表性竖向视口检查真实示例数据、长文本滚动、空队列和 reduced-motion。
- [x] 运行 `git diff --check`，审查 scoped diff、cached diff 与 `git status --short`，确认没有无关或敏感文件。

## Verification

- `node --experimental-vm-modules --test test/frontend-queue.test.js test/queue-overlay-esm.test.js` — expected PASS。
- `npm run verify:docs` — expected PASS。
- `npm run check` — expected PASS。
- `npm run verify:quick` — expected PASS。
- 视觉检查 — 左侧圆圈只显示序号，右侧显示歌名、点歌人、大航海、灯牌等级；长内容在右侧窗内滚动。
- `git diff --check` — expected no whitespace errors。

## Rollback Or Failure Handling

停止后只检查本计划列出的增量。通过定向 patch 撤销风格 6 的集合项、renderer、CSS import、按钮、文档与测试，并只移除新建的 `song-board-style-6` 和 `golden-lily.css`；不使用 reset、checkout 或宽泛删除，不触碰已有风格 3–5 改动。

## Done When

- 管理页能选择并保存风格 6，刷新后仍可恢复该值。
- 框体与词条使用用户提供的两张图片，透明区域和素材比例正确。
- 每条词条左侧花形圆圈显示正确序号，右侧完整显示歌名、点歌人、大航海和灯牌等级。
- 不可信文本被转义，横纵溢出与 reduced-motion 行为正确。
- 风格 1–5、legacy `festival` 与公共契约保持不变。
- 聚焦测试、文档验证、语法检查、快速门禁、视觉检查和最终差异审查通过。

## Results

Completed on 2026-08-20.

- 两张用户素材按原始字节复制到风格 6 目录；SHA-256 与下载源一致，尺寸分别为 1122×1402 和 2172×724。
- 聚焦回归在实现前按预期失败；实现后 25 tests passed、0 failed。空队列 DOM 与 reduced-motion CSS 也包含在聚焦覆盖内。
- 隔离浏览器视觉检查使用 600×760 与 420×630 视口、四条真实结构示例数据。两个视口中框体完整、1–4 序号居中于左侧花形圆圈、四字段位于右侧信息窗；窄视口 `panelFits=true`，没有横向裁切。长内容的 transform 在 1.8 秒采样间发生变化，控制台无 warning/error。
- `npm run verify:docs`、`npm run check`、`npm run verify:quick` 与 `git diff --check` 通过；完整测试为 705 tests、704 passed、1 skipped、0 failed。
- 没有 staged 内容。最终状态审查确认隔离预览服务器和临时脚本已清理；工作区原有风格 3–5 与其他未提交改动被保留。
