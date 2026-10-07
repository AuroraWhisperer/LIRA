# 大航海感谢独立设置

Status: Completed

## Goal

辉光和经典分别拥有启用、动画文字、保存与模拟预览；表单紧凑分组，在两者后接入现有更多样式库。

## Current Behavior / Ownership

`gift-guard-thanks.js` / `toolbox/gift.html` / `gift-guard-thanks.css` 目前共用一组设置和风格下拉框。`guard-thanks-config.js` 在 `runtime-transport.js` 的 final 礼物回调生成单事件；`gift-effects-component.js` 消费事件，画布文字设置覆盖事件文字。`component-style-client.js` 已挂载样式库。

## Compatibility Constraints / Non-goals

保留旧三个设置键和旧单事件构建函数；新增每种样式的 Enabled/TextMode 键。新键的默认空字符串表示尚未独立保存，读取时继承旧选择：仅旧选中样式继承开关，两者继承原文字。独立保存只提交本样式的两个键。无需改数据库结构或破坏性迁移；不修改真实数据，不改鉴权、记账、礼物边框或动画素材，不新增动画。

## Proposed Changes

- 共用纯设置解析模块供后端事件与管理页使用，避免兼容规则分叉。设置 HTTP 严格验证新增键，继续属于本地设置。
- runtime 为各启用风格生成 `gift:guard-thanks`，独立 eventId 后缀避免去重丢失；沿用同一队列顺序播放和场景广播。
- 管理页两区各自保存/错误/草稿与预览，标题放开关；文字与预览参数按用途成行。辉光不提供无效的观众输入。
- 更多样式只挂载一次于明确的共用区域。
- 画布动画文字新增“跟随样式设置”默认值，已有显式文字设置继续有效；未设置覆盖时使用事件/预览文字。

## Milestones / Verification

- [x] 设置和事件：验证旧 classic/aurora 启用兼容、各自覆盖、双启用/双关闭、无效 HTTP 值、持久化后重读、双事件进入场景且不互相去重。
- [x] 界面和预览：验证各自保存不覆盖另一草稿、失败保留草稿、保存中编辑保留、无效月数、正确样式和文字进入预览、样式库仅挂载一次。
- [x] `node --experimental-vm-modules --test test/gifts/guard-thanks.test.js test/gifts/gift-guard-thanks-admin.test.js test/scenes/scene-gift-events.test.js test/scenes/scene-extra-components.test.js`：27/27。
- [x] `node --experimental-vm-modules --test --test-name-pattern='gift settings open' test/admin/canvas-gift-components.test.js`：1/1；`--test-name-pattern='overlay queue' test/gifts/frontend-guard-thanks.test.js`：1/1。
- [x] 隔离 Electron 视觉检查：复用 `danmaku-canvas-editor.cjs` fixture 和真实 preload/鉴权，在 tmp 独立 profile 中挂载真实礼物设置片段、CSS、管理模块和下拉框；样式列表与保存响应使用合成数据。1426×849 视口无横向溢出，每区约 208px 高；验证开关、文字下拉框、保存请求只含本区键、无效月数错误，样式库仅一个。页面无错误，实例已关闭。截图：`tmp/guard-thanks-settings/desktop.png`。
- [x] `npm run check`、`npm run verify:architecture`（19/19）、`npm run verify:docs`（10/10）。更新设置、事件、页面引用文档；检查本次 diff、`git diff --check` 和 `git status --short`。

## Discoveries / Limits

- 通用 `FormsService.fillForm` 在专属设置渲染后执行，会把旧配置兼容得到的文字覆盖成原始空值；将该面板交给专属 renderer 管理，并用 `test/admin/frontend-admin-runtime.test.js` 验证（10/10）。
- 工作区已有预览复用修改，旧画布用例等待新窗口。只调整本次相关礼物用例，改为等待 focus 响应和选中组件；不改预览生产逻辑。
- 首次运行整个 `canvas-gift-components.test.js` 时，另一个月底冲刺用例在第 91 行等待新的外部 URL 超时。本次没有更改该用例或冲刺实现；该旧用例不作为本任务验收。未运行全量测试或真实直播。
- 测试实例已关闭；删除 `tmp/guard-thanks-settings/electron-Ajvtrt` 的请求被自动审批以“blocked by policy”拒绝，目录保留，不通过其他工具重试删除。

## Failure Handling / Done When

失败时保留用户草稿；旧配置保持可读。仅反向应用本任务 diff，不覆盖已有用户修改。以上用户行为、聚焦验证与文档一致性完成后归档；不提交或发布。
