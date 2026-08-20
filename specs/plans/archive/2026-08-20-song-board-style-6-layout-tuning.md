# 点歌板风格 6 布局微调 Implementation Plan

> **For agentic workers:** 本任务在当前会话内按单个可验证任务执行；仓库未提供 `superpowers:executing-plans`，因此直接遵循本计划与项目验证门禁，不创建提交。

**Goal:** 让风格 6 的首条词条稍微上移、歌曲顺序号在左侧花形圆圈内水平和垂直居中、右侧滚动信息窗的左右边缘各向内收一点，并略微缩小歌曲之间的间隔。

**Architecture:** 保留现有 `golden-lily` 渲染 DOM、素材、滚动算法和公共设置，仅修改该风格独立 CSS 中的几何值。静态回归测试锁定内容区、序号定位框和信息视口的目标位置。

**Tech Stack:** 原生 CSS、Node.js 24+、`node:test`。

## Global Constraints

- Electron 桌面客户端是视觉验证基线。
- 只修改风格 6，不改变风格 1–5、队列数据、设置键、DOM 结构或滚动算法。
- 保留工作区中与本任务无关的未跟踪文件，不自动创建 Git 提交。

---

## Goal

在不改变素材比例和队列行为的前提下，完成用户截图中三个局部对齐修正。

## Non-goals

- 不修改图片素材、字号、颜色、字段内容或动画速度。
- 不调整其他点歌板风格和浏览器响应式规则。

## Current Behavior

`public/css/overlays/base/golden-lily.css` 将内容区顶部设为 `20%`；序号定位框使用 `left: 7.5%`、`top: 15%` 和 `bottom: 19%`，其中心相对素材中的花形圆圈偏右偏下；信息视口使用 `left: 27.5%` 和 `right: 5.5%`，文字靠近两侧装饰。

## Ownership

- Owner: `public/css/overlays/base/golden-lily.css`
- Contract: `docs/architecture/frontend/overlays.md`
- Consumer: `/queue` overlay in Electron/OBS
- Focused test: `test/frontend-queue.test.js`

## Compatibility Constraints

风格标识 `golden-lily`、HTML 类名、横向往返滚动测量、纵向队列滚动、静态资源 URL 和 reduced-motion 行为保持不变。

## Proposed Changes

- 将 `.queue-golden-lily .overlay-content` 顶部从 `20%` 调为 `19%`。
- 将 `.golden-lily-rank` 调为 `left: 5.5%`、`top: 13%`、`bottom: 21%`，保持 `width: 18.5%` 与 `place-items: center`。
- 将 `.golden-lily-info-viewport` 调为 `left: 29%`、`right: 7%`。
- 将风格 6 的行间距从 `8px` 调为 `6px`，并同步 `renderGoldenLilyQueue()` 传给纵向滚动测量的 `rowGap`。
- 在聚焦测试中读取上述规则并断言目标值。

## Milestones

### Task 1: 锁定并实现风格 6 的局部对齐

**Files:**
- Modify: `test/frontend-queue.test.js`
- Modify: `public/css/overlays/base/golden-lily.css`
- Modify: `public/css/overlays/base/illustrated.css`
- Modify: `public/js/overlays/queue-render.js`
- Modify: `specs/plans/2026-08-20-song-board-style-6-layout-tuning.md`

**Interfaces:**
- Consumes: 现有 `.queue-golden-lily`、`.golden-lily-rank`、`.golden-lily-info-viewport` CSS 类。
- Produces: 仅风格 6 生效的目标几何值，不新增运行时接口。

- [x] **Step 1: 加入失败回归断言**

  从 CSS bundle 提取三个规则，断言 `inset: 19% 8.5% 8.5%`、序号的 `top/right/bottom/left` 目标值以及信息视口的左右内收值。

- [x] **Step 2: 运行聚焦测试并确认旧样式失败**

  Run: `node --experimental-vm-modules --test test/frontend-queue.test.js`
  Expected: 风格 6 布局断言失败；另有用户原有风格 3 工作导致的既有断言失败，不在本任务修改范围内。

- [x] **Step 3: 实现最小 CSS/滚动间距修改**

  只替换 Proposed Changes 中列出的百分比和风格 6 行间距；渲染 JavaScript 仅同步传给纵向滚动测量的 `rowGap`。

- [x] **Step 4: 运行验证并视觉复核**

  Run: `node --experimental-vm-modules --test test/frontend-queue.test.js`
  Run: `npm run check`
  Run: `npm run verify:quick`
  Expected: 全部通过；Electron 代表性视口中首条上移、序号居中、滚动窗左右留白增加。

- [x] **Step 5: 审查差异**

  Run: `git diff --check`
  Run: `git status --short`
  Expected: 无空白错误；仅出现本任务文件和用户原有未跟踪文件，不创建提交。

## Verification

- `node --experimental-vm-modules --test test/frontend-queue.test.js`
- `npm run check`
- `npm run verify:quick`
- Electron 代表性竖向视口截图复核。
- `git diff --check` 与 `git status --short`。

## Rollback Or Failure Handling

只通过定向补丁还原本计划列出的 CSS 百分比、测试断言和计划文件；不使用 reset、checkout 或宽泛删除，也不触碰原有未跟踪文件。

## Done When

- 首条词条相对当前位置稍微上移。
- 歌曲顺序号在左侧花形圆圈内水平、垂直居中。
- 滚动信息窗左边向右、右边向左各内收一点。
- 相邻歌曲的间隔略微缩小，纵向循环接缝保持同样间距。
- 聚焦测试、语法检查、快速门禁和最终差异检查通过，视觉复核无回归。

## Results

Completed on 2026-08-20.

- 首条内容区顶部从 `20%` 调整为 `19%`。
- 顺序号定位框中心对准素材花形圆圈中心；Electron 预览中 1、10、88、100 四种序号的中心误差均小于 `0.01px`。
- 信息视口左右边缘分别调整为 `29%` 与 `7%`，长文本仍只在视口内裁切。
- 风格 6 行间距从 `8px` 收紧为 `6px`，纵向滚动测量参数同步为 `6`。
- 风格 6 聚焦回归、队列 ESM 回归、`npm run check`、`npm run verify:quick`、完整 `npm test`（712 tests，711 passed，1 skipped，0 failed）均通过。
