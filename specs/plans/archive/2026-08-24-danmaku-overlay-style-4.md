# 弹幕姬风格 4 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline task-by-task; repository instructions do not permit unsolicited subagent dispatch or commits.

**Goal:** 为固定 `/danmaku` 叠加层新增“身份横卡”风格 4：卡片为固定设计尺寸的长方形，普通用户与三档大航海使用四套颜色，左侧显示用户名和弹幕，右侧显示头像，并在浏览器源长宽比变化时整体等比缩放。

**Architecture:** 继续复用 `danmaku-feed.js` 输出的安全 DOM 和 `data-identity` 语义，只扩展既有 `danmakuOverlayStyle` 枚举、Admin 选择卡片和 overlay 主题 CSS。风格 4 使用 384×640 的设计视口、360px 初始卡片宽度和 64px 卡片高度；`danmaku.js` 根据实际浏览器源宽高取较小缩放比例，避免拉伸或裁切。

**Tech Stack:** Node.js 24+, Electron 43, Vanilla JavaScript ES modules, native CSS, `node:test`.

## Global Constraints

- 保持 `/danmaku`、snapshot、`danmaku:message`、头像代理和共享弹幕 DOM 结构不变。
- 保持 `danmakuOverlayStyle` 设置键及现有 `bubble|signal|minimal` 值兼容，只新增 `ranked` 合法值。
- 不增加依赖、构建步骤、进程、端口或浏览器优先的行为。
- 普通观众与粉丝牌用户共用非大航海颜色；舰长、提督、总督各使用独立颜色。
- 不提交或改动工作区内现有播放页相关用户修改。

---

## Goal

用户可在百宝箱的弹幕姬样式选择器中选中风格 4“身份横卡”，保存后已打开的固定弹幕姬同步切换。实际弹幕按身份色显示为等宽长方形，头像固定在右侧，用户名和正文位于左侧；任意浏览器源比例下只做统一缩放并保留透明空白，不拉伸内部元素。

## Non-goals

- 不新增卡片宽高的用户设置项；本次只定义要求中的初始设计尺寸。
- 不改变已有三套主题、画猜弹幕视觉、身份解析、灯牌/大航海字段或后端消息协议。
- 不为预览样本引入外部头像资源。

## Current Behavior

`/danmaku` 只接受 `bubble`、`signal`、`minimal` 三种样式。共享 `danmaku-feed.js` 已输出头像、身份区、正文和 `viewer|fan|captain|admiral|governor` 身份属性，但现有主题均把头像放在左侧，也没有固定设计视口的矩形条卡布局。

## Ownership

- Owner: `docs/architecture/frontend/overlays.md` §6.1 和 `docs/architecture/frontend/pages.md` 的 `/danmaku` 页面事实。
- Runtime: `public/js/overlays/danmaku.js`、`public/css/overlays/danmaku.css`、`public/pages/overlays/danmaku.html`。
- Settings/Admin: `src/server/routes/settings-routes.js`、`public/pages/admin/toolbox/danmaku.html`、`public/js/admin/danmaku-tool.js`、`public/css/admin/other-features/danmaku-tool.css`。
- Tests: `test/danmaku-overlay.test.js`、`test/danmaku-overlay-settings.test.js`、`test/toolbox-sidebar.test.js`。

## Compatibility Constraints

- `danmakuOverlayStyle` 缺失或非法时仍回退 `signal`。
- DOM 文本继续通过 `textContent` 渲染，图片继续经 `/api/bilibili/avatar` 白名单代理。
- `guardLevel` 映射保持 `3=舰长`、`2=提督`、`1=总督`。
- Electron/OBS 透明背景、固定 `/danmaku` 地址和 Admin `?preview=1&style=...` 契约保持不变。

## Proposed Changes

- `test/danmaku-overlay-settings.test.js`: 先断言 `ranked` 是唯一新增合法设置值。
- `test/danmaku-overlay.test.js`: 先断言风格 4 的运行时枚举、设计视口缩放、四身份配色、右头像/左文本和固定尺寸 CSS。
- `test/toolbox-sidebar.test.js`: 先断言 Admin 存在风格 4 选项和预览缩略图。
- `src/server/routes/settings-routes.js`: 将 `ranked` 加入设置白名单。
- `public/js/overlays/danmaku.js`: 将 `ranked` 加入前端枚举，导出纯缩放计算并在加载/resize 时同步 CSS 变量。
- `public/css/overlays/danmaku.css`: 添加身份横卡主题，不修改共享 DOM 组件。
- `public/pages/admin/toolbox/danmaku.html`、`public/js/admin/danmaku-tool.js`、`public/css/admin/other-features/danmaku-tool.css`: 添加第四张选择卡片、名称和确定性缩略图。
- `docs/architecture/frontend/overlays.md`、`docs/architecture/frontend/pages.md`、`docs/architecture/frontend/app.md`: 将四主题、Admin 消费方和等比缩放行为写回 owner 文档。
- `public/pages/admin/toolbox/usage-guide.html`、`UPDATE.md`: 同步用户帮助和当前版本变更说明。

## Milestones

### Milestone 1: 锁定设置与视觉契约

- [x] 在三个聚焦测试文件中加入 `ranked` 合法值、Admin 入口及以下 CSS/JS 断言：

```js
assert.match(
  script,
  /const OVERLAY_STYLES = new Set\(\['bubble', 'signal', 'minimal', 'ranked'\]\)/,
);
assert.equal(module.calculateRankedOverlayScale(192, 640), 0.5);
assert.match(styles, /body\[data-style='ranked'\]/);
assert.match(styles, /--ranked-card-width:\s*360px/);
assert.match(styles, /--ranked-card-height:\s*64px/);
```

- [x] 运行 `node --test test/danmaku-overlay-settings.test.js test/danmaku-overlay.test.js test/toolbox-sidebar.test.js`，预期因 `ranked` 尚未实现而失败。

### Milestone 2: 实现风格 4 与等比视口

- [x] 将后端和 overlay 枚举扩展为 `bubble|signal|minimal|ranked`。
- [x] 在 `danmaku.js` 中实现下列纯函数，并在 DOMContentLoaded 与 resize 时把结果写入 `--ranked-scale`：

```js
export function calculateRankedOverlayScale(viewportWidth, viewportHeight) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  const height = Math.max(0, Number(viewportHeight) || 0);
  if (!width || !height) return 1;
  return Math.min(width / 384, height / 640);
}
```

- [x] 在 `danmaku.css` 中以 384×640 设计视口、360×64 卡片、6px 间距实现 `ranked`；用 grid area 将 `.draw-danmaku-body` 放左侧、`.draw-danmaku-avatar` 放右侧，并对 `viewer/fan`、`captain`、`admiral`、`governor` 设置四套背景色。
- [x] 隐藏风格 4 的状态头和身份徽标，仅保留颜色表达身份；用户名与正文安全截断/换行，表情与头像保持共享渲染器行为。
- [x] 在 Admin 增加“身份横卡”选项和四条身份色缩略图，`DANMAKU_OVERLAY_STYLES.ranked` 驱动当前样式标签及预览 URL。
- [x] 重跑三个聚焦测试，预期全部通过。

### Milestone 3: 文档、门禁与差异审查

- [x] 更新 overlay/page owner 文档，明确第四主题、四档配色、右头像、初始尺寸和 `min(width/384, height/640)` 等比缩放。
- [x] 运行 `npm run verify:docs`、`npm run check`、`npm run verify:quick`，预期全部通过。
- [x] 运行 `git diff --check`、审查限定文件 diff 和 `git status --short`，确认没有覆盖播放页现有用户修改。
- [x] 完成后将本计划移至 `specs/plans/archive/2026-08-24-danmaku-overlay-style-4.md` 并勾选完成项。

## Verification

```powershell
node --test test/danmaku-overlay-settings.test.js test/danmaku-overlay.test.js test/toolbox-sidebar.test.js
npm run verify:docs
npm run check
npm run verify:quick
git diff --check
git status --short
```

预期聚焦测试和所有门禁退出码为 0；最终 diff 只包含风格 4 的设置、Admin、overlay、owner 文档、测试和已归档计划。

## Execution Results

- 首次聚焦测试按计划以 4 项缺失实现失败；实现后 13/13 通过。
- `npm run verify:docs` 5/5 通过，`npm run check` 检查 438 个 JavaScript 文件通过，`npm run verify:quick` 全部通过（含 9 项架构边界测试）。
- Playwright 在 384×640、192×640、768×640、768×1280 四种浏览器源尺寸下验证缩放倍率分别为 1、0.5、1、2；参考卡片为 360×64，所有尺寸均无页面或 feed 溢出。长用户名、两行长弹幕、四档身份色、右侧头像和 Admin 点击切换均通过截图检查；测试保存请求被拦截，没有写入真实用户设置。
- 完整 `npm test` 共 877 项，876 通过、1 项失败。唯一失败为未改动的 `test/clock-overlay.test.js` 仍匹配 `<h2>萌时钟</h2>`，而当前仓库 `public/pages/admin/toolbox/clock.html` 已是 `<h2 class="ui-page-title">萌时钟</h2>`；该既有跨任务不一致未在本计划中修复。
- `git diff --check` 退出码为 0；限定 diff 审查确认弹幕姬改动与工作区并行存在的播放页、Admin 字体层级等用户修改保持隔离。

## Rollback Or Failure Handling

若聚焦测试或视觉验证失败，只检查并反向编辑本计划列出的 task-owned 行；使用 `git diff -- <scoped files>` 逐文件定位，不使用 `git reset --hard`、目录级 checkout 或任何会覆盖工作区用户修改的操作。

## Done When

Admin 可保存并预览“身份横卡”；固定 `/danmaku` 接受并实时应用 `ranked`；四档身份颜色、右侧头像、左侧用户名/正文、360×64 初始卡片和 384×640 等比缩放均有聚焦回归；owner 文档一致，快速门禁和最终 diff 审查通过，且没有无关文件改动。
