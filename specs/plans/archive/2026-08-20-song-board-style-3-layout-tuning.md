# 点歌板风格 3 布局微调 Implementation Plan

> **For agentic workers:** Execute this plan inline task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让风格 3 的横向词条向左右略微延展，缩小左侧黄色序号装饰，并把横向内容的最大静止显示范围收紧到大航海徽章右侧，超出后自动往返滚动。

**Architecture:** 保留 `storybook` 的渲染结构和 `scheduleIdentityContentScroll()` 的真实宽度测量，只修改风格 3 的 PNG 及其专属 CSS 几何边界。继续由现有 `.identity-content-wrapper` / `.identity-content` 组合决定是否滚动，不增加设置键或新的滚动分支。

**Tech Stack:** Electron 43、Vanilla JavaScript ES modules、原生 CSS、PNG、`node:test`。

## Global Constraints

- 只改变点歌板风格 3；风格 1、2、4、5、6 的 DOM、样式和滚动行为保持不变。
- 保留 `/queue`、`overlayQueueStyle`、WebSocket 快照、身份字段格式与现有设置键。
- 词条外部保持真实透明；不增加依赖、构建步骤、页面或输入。
- 不创建提交；保留所有非本任务改动。

---

## Non-goals

- 不改变画框、标题、字号、纵向滚动速度或队列业务。
- 不重构通用身份滚动算法，也不新增风格 3 专属设置。

## Current Behavior

风格 3 的词条内容区使用 `inset: 24.5% 9.5% 17% 14.5%`，横向视口使用 `left: 23%`、`right: 5.5%`。现有滚动函数只在内容实际宽度超过视口宽度时启动，因此目前短内容会一直静止显示到词条最右端；左侧黄色饼干在素材中占比偏大。

## Ownership

- Owner: `public/css/overlays/base/storybook.css`、`public/img/overlays/song-board-style-3/entry.png`
- Contract: `specs/song-request-board-style-3_design.md`、`docs/architecture/frontend/overlays.md`
- Consumer: `public/js/overlays/queue-render.js`、OBS `/queue`
- Focused test: `test/frontend-queue.test.js`

## Proposed Changes

- 用图像编辑生成同画风、同画布、真实 alpha 的 `entry.png`，仅缩小黄色饼干序号区。
- 把风格 3 的列表容器左右各放宽约 2 个百分点。
- 把信息视口左缘随缩小后的黄色装饰略向左移，右缘收至大航海徽章右侧附近，使更长组合自动触发现有横向滚动。
- 更新聚焦回归断言，锁定新几何边界和 RGBA 资产。

### Task 1: 锁定新布局契约

**Files:**

- Modify: `test/frontend-queue.test.js`

**Interfaces:**

- Consumes: 打包后的 `storybook.css` 与仓库内 `entry.png`
- Produces: 风格 3 新 inset、视口边界和 PNG alpha 回归断言

- [x] **Step 1: 写失败的布局与资产测试**

  将旧的 `14.5% / 9.5%` 内容 inset 断言替换为目标值，并断言 `.storybook-info-viewport` 的新 `left` / `right`，同时读取 PNG IHDR 的 color type，要求为 `6`（RGBA）。

- [x] **Step 2: 运行聚焦测试并确认失败**

  Run: `node --test test/frontend-queue.test.js`

  Expected: 风格 3 新几何值尚未实现时 FAIL。

### Task 2: 生成并接入微调后的词条

**Files:**

- Modify: `public/img/overlays/song-board-style-3/entry.png`
- Modify: `public/css/overlays/base/storybook.css`

**Interfaces:**

- Consumes: `renderStorybookRow()` 现有 rank 与连续身份内容 DOM
- Produces: 同 URL 的 RGBA 词条素材和更窄的固定内容视口

- [x] **Step 1: 完成透明 PNG**

  保留 1536×1024 画布、蓝色长条、蝴蝶结和云朵，只把黄色饼干约缩小一成；确保外部为真实 alpha，而不是绘制的棋盘格。

- [x] **Step 2: 实现最小 CSS 调整**

  只改 `.queue-storybook .overlay-content`、`.storybook-rank` 与 `.storybook-info-viewport` 的百分比边界；保留现有背景缩放、字号和动画函数。

- [x] **Step 3: 运行聚焦测试并确认通过**

  Run: `node --test test/frontend-queue.test.js`

  Expected: PASS。

### Task 3: 桌面画面验证与收尾

**Files:**

- Modify: `specs/plans/2026-08-20-song-board-style-3-layout-tuning.md`

**Interfaces:**

- Consumes: Electron/Chromium 实际 CSS 布局与 PNG alpha
- Produces: 完成记录与验证证据

- [x] **Step 1: 在实际队列画面复核**

  验证词条左右略宽、黄色区域更轻、序号仍居中；短内容不滚动，达到大航海徽章右侧的组合开始往返滚动，文字不越过词条边缘。

- [x] **Step 2: 运行分层验证**

  Run: `npm run check`

  Run: `npm run verify:quick`

  Expected: 全部 PASS。

- [x] **Step 3: 审查最终差异**

  Run: `git diff --check`

  Run: `git diff -- public/css/overlays/base/storybook.css test/frontend-queue.test.js specs/plans/2026-08-20-song-board-style-3-layout-tuning.md`

  Run: `git status --short`

  Expected: 只有本计划列出的文件和二进制素材发生任务相关变化。

## Rollback Or Failure Handling

停止后先检查精确差异；只用定向 patch 还原上述 CSS、测试和计划记录，并恢复单个 `entry.png`。不使用 reset、blanket checkout 或递归删除。

## Done When

风格 3 词条在画框内向左右略微延展；黄色序号装饰明显但克制地变小；静止内容不超过大航海徽章右侧附近，超出部分由现有机制往返滚动；PNG 具备真实 alpha；聚焦测试、JavaScript 检查、快速验证和最终差异检查通过。

## Verification Results

- 图像资产为 1536×1024 RGBA PNG；深色背景合成检查未出现洋红残留。
- 819×1131 本地页面实测：示例内容总宽 292px，信息视口 262px，“提督”右缘为 262px，后续灯牌等级产生 30px 溢出并触发往返滚动。
- `node --test test/frontend-queue.test.js`: 22 passed, 0 failed。
- `npm run check`: 394 个 JavaScript 文件语法检查通过。
- `npm run verify:quick`: 文档、语法和架构验证全部通过。
- `npm test`: 711 passed, 0 failed, 1 skipped。
- `git diff --check`: 通过；仅报告工作区既有 LF/CRLF 转换警告。
- 最终状态中同时存在其他进行中的风格 4–6 相关改动；本任务未修改或回退这些并行内容。
